struct Params { size: u32 }

const TILE: u32 = 16u;
const HALO: u32 = 18u; // TILE + 2

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> cur: array<u32>;
@group(0) @binding(2) var<storage, read_write> next: array<u32>;

var<workgroup> tile: array<u32, 324>; // HALO * HALO

@compute @workgroup_size(16, 16)
fn main(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let n = params.size;
  let ox = wg.x * TILE;
  let oy = wg.y * TILE;
  // 256 invocations cooperatively load the 18×18 tile, halo included; outside cells read as dead.
  for (var i = li; i < HALO * HALO; i += TILE * TILE) {
    let gx = i32(ox + i % HALO) - 1;
    let gy = i32(oy + i / HALO) - 1;
    var v = 0u;
    if (gx >= 0 && gy >= 0 && gx < i32(n) && gy < i32(n)) {
      v = cur[u32(gy) * n + u32(gx)];
    }
    tile[i] = select(0u, 1u, v != 0u);
  }
  workgroupBarrier();

  let x = ox + lid.x;
  let y = oy + lid.y;
  if (x == 0u || y == 0u || x >= n - 1u || y >= n - 1u) {
    return;
  }
  let c = (lid.y + 1u) * HALO + lid.x + 1u;
  let count = tile[c - HALO - 1u] + tile[c - HALO] + tile[c - HALO + 1u]
            + tile[c - 1u] + tile[c + 1u]
            + tile[c + HALO - 1u] + tile[c + HALO] + tile[c + HALO + 1u];
  next[y * n + x] = select(0u, 1u, count == 3u || (tile[c] == 1u && count == 2u));
}
