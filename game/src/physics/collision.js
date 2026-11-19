// 2D collision: building footprints are AABBs; cars and people are circles.
// The city registers its boxes here; physics resolves against them.
// Boxes also carry a height h (default: very tall) so the chase camera can
// test the same boxes in 3D.
const boxes = [];
export function addBox(x0, z0, x1, z1, h = 1e6) {
  boxes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h });
}
export function clearBoxes() { boxes.length = 0; }
export function boxCount() { return boxes.length; }
// Thin vertical occluders with no collision box: palm trunks, lamp poles,
// the bridge pylon. {x, z, r, y0, y1}.
const cylinders = [];
export function addOccluderCylinder(x, z, r, y0, y1) {
  cylinders.push({ x, z, r, y0, y1 });
}
export function clearOccluders() { cylinders.length = 0; }
export function occluderCount() { return cylinders.length; }
// Nearest blocking fraction t in [0, 1] along the segment
// (ax,ay,az)->(bx,by,bz); 1 means the segment is clear. Boxes are tested
// as 3D AABBs (y 0..h), cylinders as vertical columns. If the segment
// starts inside a solid, the exit face counts as the blocker.
export function cameraBlockT(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let best = 1;
  for (const b of boxes) {
    let t0 = 0, t1 = 1, ok = true;
    if (Math.abs(dx) < 1e-9) { if (ax < b.x0 || ax > b.x1) ok = false; }
    else {
      let ta = (b.x0 - ax) / dx, tb = (b.x1 - ax) / dx;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (ok) {
      if (Math.abs(dz) < 1e-9) { if (az < b.z0 || az > b.z1) ok = false; }
      else {
        let ta = (b.z0 - az) / dz, tb = (b.z1 - az) / dz;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
    }
    if (ok) {
      if (Math.abs(dy) < 1e-9) { if (ay < 0 || ay > b.h) ok = false; }
      else {
        let ta = (0 - ay) / dy, tb = (b.h - ay) / dy;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
    }
    if (ok && t1 >= t0) {
      const tb = t0 >= 0 ? t0 : (t1 <= 1 ? t1 : 1);
      if (tb < best) best = tb;
    }
  }
  for (const c of cylinders) {
    const ox = ax - c.x, oz = az - c.z;
    const a = dx * dx + dz * dz;
    if (a < 1e-9) continue;
    const bq = 2 * (ox * dx + oz * dz);
    const cq = ox * ox + oz * oz - c.r * c.r;
    const disc = bq * bq - 4 * a * cq;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    let t = (-bq - sq) / (2 * a);
    if (t < 0) t = (-bq + sq) / (2 * a); // segment starts inside: exit face
    if (t < 0 || t > 1 || t >= best) continue;
    const y = ay + dy * t;
    if (y >= c.y0 - 0.05 && y <= c.y1 + 0.05) best = t;
  }
  return best;
}
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
