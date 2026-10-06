struct View {
  gridSize: u32,
  cellFormat: u32,    // 0 = packed u8 (CPU engines), 1 = u32 (GPU engines)
  zoom: f32,          // device pixels per cell
  overlayMode: u32,   // 0 = off, 1 = tile → thread, 2 = tile → duration (heat)
  origin: vec2f,      // cell coordinate at the top-left device pixel
  tilesPerSide: u32,
  tileSize: u32,
  palette: array<vec4f, 16>, // thread colours; heat uses 0 (low) and 1 (high)
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> cells: array<u32>;
@group(0) @binding(2) var<storage, read> overlay: array<f32>; // per tile, -1 = skipped

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
  var color = vec3f(0.12, 0.12, 0.15);
  if (alive(u32(c.y) * view.gridSize + u32(c.x))) {
    color = vec3f(1.0, 1.0, 0.0); // easypap's yellow
  }
  // The dead border ring is never part of a tile.
  let interior = c.x >= 1.0 && c.y >= 1.0 && c.x < n - 1.0 && c.y < n - 1.0;
  if (view.overlayMode != 0u && interior) {
    let tx = (u32(c.x) - 1u) / view.tileSize;
    let ty = (u32(c.y) - 1u) / view.tileSize;
    let v = overlay[ty * view.tilesPerSide + tx];
    if (v >= 0.0) {
      var tint = view.palette[u32(v) % 16u].rgb;
      if (view.overlayMode == 2u) {
        tint = mix(view.palette[0].rgb, view.palette[1].rgb, v);
      }
      color = mix(color, tint, 0.55);
    }
  }
  return vec4f(color, 1.0);
}
