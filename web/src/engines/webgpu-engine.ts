import type { Engine, FrameSource } from '../engine';
import { hashCells, type Grid } from '../grid';
import { uploadCells } from './upload';

const WORKGROUP = 16;
// Bounds a single submit so huge live batches never build one giant command buffer.
const MAX_DISPATCHES_PER_SUBMIT = 256;

export class WebGpuEngine implements Engine {
  private pipeline: GPUComputePipeline | null = null;
  private buffers: [GPUBuffer, GPUBuffer] | null = null;
  // bindGroups[i] reads buffers[i] and writes buffers[1 - i].
  private bindGroups: [GPUBindGroup, GPUBindGroup] | null = null;
  private params: GPUBuffer | null = null;
  private current = 0;
  private size = 0;

  constructor(
    readonly id: string,
    private readonly device: GPUDevice,
    private readonly shaderCode: string,
  ) {}

  async init(grid: Grid): Promise<void> {
    this.release();
    this.pipeline ??= await this.device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: this.device.createShaderModule({ code: this.shaderCode }), entryPoint: 'main' },
    });
    // Without error scopes an allocation failure leaves the engine silently running on invalid buffers.
    this.device.pushErrorScope('out-of-memory');
    this.device.pushErrorScope('validation');
    const bytes = grid.size * grid.size * 4;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const a = this.device.createBuffer({ size: bytes, usage });
    const b = this.device.createBuffer({ size: bytes, usage });
    uploadCells(grid.cells, grid.size, (offset, data) => this.device.queue.writeBuffer(a, offset, data));
    const params = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(params, 0, new Uint32Array([grid.size, 0, 0, 0]));
    const layout = this.pipeline.getBindGroupLayout(0);
    const bind = (src: GPUBuffer, dst: GPUBuffer) =>
      this.device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: src } },
          { binding: 2, resource: { buffer: dst } },
        ],
      });
    this.buffers = [a, b];
    this.bindGroups = [bind(a, b), bind(b, a)];
    this.params = params;
    this.current = 0;
    this.size = grid.size;
    const validation = await this.device.popErrorScope();
    const outOfMemory = await this.device.popErrorScope();
    const error = outOfMemory ?? validation;
    if (error) {
      this.release();
      throw new Error(`WebGPU could not set up a ${grid.size}×${grid.size} grid: ${error.message}`);
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  async step(n: number): Promise<void> {
    const bindGroups = this.need().bindGroups;
    const groups = Math.ceil(this.size / WORKGROUP);
    for (let left = n; left > 0; left -= MAX_DISPATCHES_PER_SUBMIT) {
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.need().pipeline);
      // Dispatches in one pass are ordered with storage barriers between them: one per generation.
      for (let i = 0; i < Math.min(left, MAX_DISPATCHES_PER_SUBMIT); i++) {
        pass.setBindGroup(0, bindGroups[this.current]);
        pass.dispatchWorkgroups(groups, groups);
        this.current ^= 1;
      }
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  async frame(): Promise<FrameSource> {
    return { kind: 'gpu', size: this.size, buffer: this.need().buffers[this.current] };
  }

  async hash(): Promise<string> {
    const { buffers } = this.need();
    const bytes = this.size * this.size * 4;
    const staging = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffers[this.current], 0, staging, 0, bytes);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const h = hashCells(new Uint32Array(staging.getMappedRange()));
    staging.unmap();
    staging.destroy();
    return h;
  }

  dispose(): void {
    this.release();
  }

  private need(): {
    pipeline: GPUComputePipeline;
    buffers: [GPUBuffer, GPUBuffer];
    bindGroups: [GPUBindGroup, GPUBindGroup];
  } {
    if (!this.pipeline || !this.buffers || !this.bindGroups) throw new Error('engine used before init');
    return { pipeline: this.pipeline, buffers: this.buffers, bindGroups: this.bindGroups };
  }

  private release(): void {
    this.buffers?.forEach((b) => b.destroy());
    this.params?.destroy();
    this.buffers = null;
    this.bindGroups = null;
    this.params = null;
  }
}
