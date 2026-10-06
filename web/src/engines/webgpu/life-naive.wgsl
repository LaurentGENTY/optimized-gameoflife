struct Params { size: u32 }

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> cur: array<u32>;
@group(0) @binding(2) var<storage, read_write> next: array<u32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = params.size;
  let x = id.x;
  let y = id.y;
  // Dead border like the reference kernel; also drops out-of-grid invocations.
  if (x == 0u || y == 0u || x >= n - 1u || y >= n - 1u) {
    return;
  }
  var count = 0u;
  for (var dy = 0u; dy < 3u; dy++) {
    for (var dx = 0u; dx < 3u; dx++) {
      if (dx != 1u || dy != 1u) {
        count += select(0u, 1u, cur[(y + dy - 1u) * n + x + dx - 1u] != 0u);
      }
    }
  }
  let me = cur[y * n + x] != 0u;
  next[y * n + x] = select(0u, 1u, count == 3u || (me && count == 2u));
}
