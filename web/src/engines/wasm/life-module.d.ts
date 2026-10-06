declare module '*/life-seq.mjs' {
  interface LifeSeqModule {
    HEAPU8: Uint8Array;
    _life_init(dim: number): number;
    _life_cells(): number;
    _life_compute_seq(nbIter: number): void;
    _life_finalize(): void;
  }
  const factory: (options?: Record<string, unknown>) => Promise<LifeSeqModule>;
  export default factory;
}

declare module '*/life-simd.mjs' {
  interface LifeSimdModule {
    HEAPU8: Uint8Array;
    _life_init(dim: number): number;
    _life_cells(): number;
    _life_compute_seq(nbIter: number): void;
    _life_compute_tiled(nbIter: number): void;
    _life_tiles_computed(): number;
    _life_finalize(): void;
  }
  const factory: (options?: Record<string, unknown>) => Promise<LifeSimdModule>;
  export default factory;
}

declare module '*/life-mt.mjs' {
  interface LifeMtModule {
    HEAPU8: Uint8Array;
    _life_init(dim: number): number;
    _life_cells(): number;
    _life_compute_tiled_mt(nbIter: number): void;
    _life_threads_start(n: number): number;
    _life_tiles_computed(): number;
    _life_finalize(): void;
  }
  const factory: (options?: Record<string, unknown>) => Promise<LifeMtModule>;
  export default factory;
}

declare module '*/life-mt-trace.mjs' {
  interface LifeMtTraceModule {
    HEAPU8: Uint8Array;
    _life_init(dim: number): number;
    _life_cells(): number;
    _life_compute_tiled_mt(nbIter: number): void;
    _life_threads_start(n: number): number;
    _life_tiles_computed(): number;
    _life_finalize(): void;
    _life_nb_tiles(): number;
    _life_trace_buffer(): number;
    _life_trace_capacity(): number;
    _life_trace_count(): number;
    _life_now(): number;
  }
  const factory: (options?: Record<string, unknown>) => Promise<LifeMtTraceModule>;
  export default factory;
}
