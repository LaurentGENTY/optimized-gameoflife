import type { FrameSource } from '../engine';
import { heatColor, threadColor } from '../monitor/colors';
import type { Camera } from './camera';
import shaderCode from './grid.wgsl?raw';

// View struct in grid.wgsl: 8 scalars (32 bytes), then palette: array<vec4f, 16> aligned at byte 32.
const UNIFORM_BYTES = 32 + 16 * 16;

export type OverlayMode = 'off' | 'thread' | 'heat';

export interface Overlay {
  mode: OverlayMode;
  tilesPerSide: number;
  tileSize: number;
  values: Float32Array;
}

export class GridRenderer {
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniforms: GPUBuffer;
  private readonly uniformData = new ArrayBuffer(UNIFORM_BYTES);
  private uploadBuffer: GPUBuffer | null = null;
  private boundBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private gridSize = 0;
  private cellFormat = 0;
  // Always bound (the shader declares it); at least 4 bytes when the overlay is off.
  private overlayBuffer: GPUBuffer;
  private overlay: Omit<Overlay, 'values'> | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
  ) {
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('canvas has no WebGPU context');
    this.context = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    const module = device.createShaderModule({ code: shaderCode });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.uniforms = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.overlayBuffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  }

  setOverlay(o: Overlay | null): void {
    if (!o || o.mode === 'off' || o.values.length === 0) {
      this.overlay = null;
      return;
    }
    const bytes = o.values.byteLength;
    if (this.overlayBuffer.size !== bytes) {
      this.overlayBuffer.destroy();
      this.overlayBuffer = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.bindGroup = null; // rebuilt against the new overlay buffer
      if (this.boundBuffer) this.rebind(this.boundBuffer);
    }
    this.device.queue.writeBuffer(this.overlayBuffer, 0, o.values);
    this.overlay = { mode: o.mode, tilesPerSide: o.tilesPerSide, tileSize: o.tileSize };
  }

  setFrame(frame: FrameSource): void {
    if (frame.kind === 'gpu') {
      this.bind(frame.buffer, frame.size, 1);
      return;
    }
    // writeBuffer and storage bindings need a 4-byte multiple.
    const bytes = Math.ceil(frame.cells.byteLength / 4) * 4;
    if (!this.uploadBuffer || this.uploadBuffer.size !== bytes) {
      this.uploadBuffer?.destroy();
      this.uploadBuffer = this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }
    const data = frame.cells.byteLength === bytes ? frame.cells : padTo(frame.cells, bytes);
    this.device.queue.writeBuffer(this.uploadBuffer, 0, data);
    this.bind(this.uploadBuffer, frame.size, 0);
  }

  // Drops the reference to an engine-owned GPU buffer before that engine is disposed.
  clear(): void {
    this.boundBuffer = null;
    this.bindGroup = null;
  }

  // Returns true when the backing store changed and a redraw is needed.
  resize(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  draw(cam: Camera): void {
    if (!this.bindGroup) return;
    const dpr = window.devicePixelRatio || 1;
    const u32 = new Uint32Array(this.uniformData);
    const f32 = new Float32Array(this.uniformData);
    u32[0] = this.gridSize;
    u32[1] = this.cellFormat;
    f32[2] = cam.zoom * dpr;
    f32[4] = cam.x;
    f32[5] = cam.y;
    const o = this.overlay;
    u32[3] = o ? (o.mode === 'thread' ? 1 : 2) : 0;
    u32[6] = o?.tilesPerSide ?? 0;
    u32[7] = o?.tileSize ?? 1;
    if (o) {
      for (let i = 0; i < 16; i++) {
        const c = o.mode === 'thread' ? threadColor(i) : heatColor(i === 0 ? 0 : 1);
        f32.set([c[0], c[1], c[2], 1], 8 + i * 4);
      }
    }
    this.device.queue.writeBuffer(this.uniforms, 0, this.uniformData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.uploadBuffer?.destroy();
    this.uniforms.destroy();
    this.overlayBuffer.destroy();
    this.context.unconfigure();
  }

  private bind(buffer: GPUBuffer, size: number, format: number): void {
    if (buffer !== this.boundBuffer || !this.bindGroup) this.rebind(buffer);
    this.gridSize = size;
    this.cellFormat = format;
  }

  private rebind(buffer: GPUBuffer): void {
    this.boundBuffer = buffer;
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: { buffer } },
        { binding: 2, resource: { buffer: this.overlayBuffer } },
      ],
    });
  }

}

function padTo(src: Uint8Array, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  out.set(src);
  return out;
}
