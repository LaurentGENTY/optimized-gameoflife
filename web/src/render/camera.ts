export interface Camera {
  zoom: number; // CSS pixels per cell
  x: number; // cell coordinate at the canvas top-left corner
  y: number;
}

const MIN_ZOOM = 1 / 64;
const MAX_ZOOM = 64;

export function fitCamera(gridSize: number, width: number, height: number): Camera {
  const zoom = Math.min(width, height) / gridSize;
  return { zoom, x: -(width / zoom - gridSize) / 2, y: -(height / zoom - gridSize) / 2 };
}

export function zoomAt(cam: Camera, factor: number, px: number, py: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  const cx = cam.x + px / cam.zoom;
  const cy = cam.y + py / cam.zoom;
  return { zoom, x: cx - px / zoom, y: cy - py / zoom };
}

export function panBy(cam: Camera, dxPx: number, dyPx: number): Camera {
  return { zoom: cam.zoom, x: cam.x - dxPx / cam.zoom, y: cam.y - dyPx / cam.zoom };
}

export function screenToCell(cam: Camera, px: number, py: number): [number, number] {
  return [Math.floor(cam.x + px / cam.zoom), Math.floor(cam.y + py / cam.zoom)];
}
