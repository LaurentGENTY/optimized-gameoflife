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
