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
  // Zoomed out, one pixel covers several cells: light it if any of them is alive
  // (capped at 8×8 reads), otherwise sparse structures flicker or vanish.
  let span = min(8u, u32(ceil(1.0 / view.zoom)));
  var lit = false;
  for (var dy = 0u; dy < span && !lit; dy++) {
    for (var dx = 0u; dx < span && !lit; dx++) {
      let x = u32(c.x) + dx;
      let y = u32(c.y) + dy;
      if (x < view.gridSize && y < view.gridSize && alive(y * view.gridSize + x)) {
        lit = true;
      }
    }
  }
  var color = vec3f(0.12, 0.12, 0.15);
  if (lit) {
    color = vec3f(1.0, 1.0, 0.0); // easypap's yellow
  }
  // The dead border ring is never part of a tile.
  let interior = c.x >= 1.0 && c.y >= 1.0 && c.x < n - 1.0 && c.y < n - 1.0;
  if (view.overlayMode != 0u && interior) {
    let tx = (u32(c.x) - 1u) / view.tileSize;
    let ty = (u32(c.y) - 1u) / view.tileSize;
    let v = overlay[ty * view.tilesPerSide + tx];
    if (v >= 0.0) {
      // Same rule as threadColor(): hue t % 8, at 60% brightness for every thread >= 8.
      let t = u32(v);
      var tint = view.palette[t % 8u].rgb * select(1.0, 0.6, t >= 8u);
      if (view.overlayMode == 2u) {
        tint = mix(view.palette[0].rgb, view.palette[1].rgb, v);
      }
      color = mix(color, tint, 0.55);
    }
  }
  return vec4f(color, 1.0);
}
