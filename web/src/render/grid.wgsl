struct View {
  gridSize: u32,
  cellFormat: u32, // 0 = packed u8 (CPU engines), 1 = u32 (GPU engines)
  zoom: f32,       // device pixels per cell
  _pad0: f32,
  origin: vec2f,   // cell coordinate at the top-left device pixel
  _pad1: vec2f,
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> cells: array<u32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn alive(idx: u32) -> bool {
  if (view.cellFormat == 0u) {
    let word = cells[idx >> 2u];
    return ((word >> ((idx & 3u) * 8u)) & 0xffu) != 0u;
  }
  return cells[idx] != 0u;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = floor(view.origin + pos.xy / view.zoom);
  let n = f32(view.gridSize);
  if (c.x < 0.0 || c.y < 0.0 || c.x >= n || c.y >= n) {
    return vec4f(0.04, 0.04, 0.06, 1.0);
  }
  if (alive(u32(c.y) * view.gridSize + u32(c.x))) {
    return vec4f(1.0, 1.0, 0.0, 1.0); // easypap's yellow
  }
  return vec4f(0.12, 0.12, 0.15, 1.0);
}
