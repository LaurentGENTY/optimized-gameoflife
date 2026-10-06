import type { FrameSource } from '../engine';
import type { Camera } from './camera';
import shaderCode from './grid.wgsl?raw';

const UNIFORM_BYTES = 32;

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
    this.context.unconfigure();
  }

  private bind(buffer: GPUBuffer, size: number, format: number): void {
    if (buffer !== this.boundBuffer) {
      this.boundBuffer = buffer;
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniforms } },
          { binding: 1, resource: { buffer } },
        ],
      });
    }
    this.gridSize = size;
    this.cellFormat = format;
  }
}

function padTo(src: Uint8Array, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  out.set(src);
  return out;
}
