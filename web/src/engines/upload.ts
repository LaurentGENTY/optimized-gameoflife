// Converts the u8 grid to the GPU's u32 layout in bounded chunks, so an 8192² grid
// never needs a 256 MiB temporary array on the JS heap.
export function uploadCells(
  cells: Uint8Array,
  size: number,
  write: (byteOffset: number, data: Uint32Array) => void,
  chunkCells = 1 << 20,
): void {
  const total = size * size;
  for (let start = 0; start < total; start += chunkCells) {
    const end = Math.min(total, start + chunkCells);
    const out = new Uint32Array(end - start);
    for (let i = start; i < end; i++) {
      const x = i % size;
      const y = (i - x) / size;
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      out[i - start] = !border && cells[i] !== 0 ? 1 : 0;
    }
    write(start * 4, out);
  }
}
