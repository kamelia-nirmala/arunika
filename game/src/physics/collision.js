// 2D collision: building footprints are AABBs; cars and people are circles.
// The city registers its boxes here; physics resolves against them.
const boxes = [];
export function addBox(x0, z0, x1, z1) {
  boxes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
}
export function clearBoxes() { boxes.length = 0; }
export function boxCount() { return boxes.length; }
// Push a circle out of every box it overlaps. Returns {hit, nx, nz}.
export function resolveCircle(p, r) {
  let hit = false, nx = 0, nz = 0;
  for (const b of boxes) {
    const cx = Math.max(b.x0, Math.min(p.x, b.x1));
    const cz = Math.max(b.z0, Math.min(p.z, b.z1));
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (r - d) / d;
        p.x += dx * push; p.z += dz * push; nx += dx / d; nz += dz / d;
      } else {
        // Centre inside the box: push out along the smallest axis.
        const pl = p.x - b.x0, pr = b.x1 - p.x, pt = p.z - b.z0, pb = b.z1 - p.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) { p.x = b.x0 - r; nx -= 1; }
        else if (m === pr) { p.x = b.x1 + r; nx += 1; }
        else if (m === pt) { p.z = b.z0 - r; nz -= 1; }
        else { p.z = b.z1 + r; nz += 1; }
      }
    }
  }
  return { hit, nx, nz };
}
// Circle vs circle (car vs car, car vs person). Returns overlap depth or 0.
export function circleHit(ax, az, ar, bx, bz, br) {
  const dx = bx - ax, dz = bz - az;
  const d = Math.hypot(dx, dz), min = ar + br;
  if (d >= min || d < 1e-6) return 0;
  return min - d;
}
export function pointInBox(x, z, b) { return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1; }
