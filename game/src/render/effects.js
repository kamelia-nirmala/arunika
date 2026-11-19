// Rain, drift smoke, skid marks, muzzle flash — cheap sprites and points,
// no post-processing pass (keeps the frame budget for the city itself).
import * as THREE from 'three';
import { clamp } from '../random.js';

function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(200,200,200,0.55)');
  grad.addColorStop(1, 'rgba(200,200,200,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
export function buildEffects(scene) {
  // Rain: one Points cloud recycled around the camera.
  const N = 900;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 90;
    pos[i * 3 + 1] = Math.random() * 40;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0x9fb8c8, size: 0.14, transparent: true, opacity: 0 }));
  rain.frustumCulled = false;
  scene.add(rain);
  // Smoke pool.
  const tex = puffTexture();
  const puffs = [];
  for (let i = 0; i < 24; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    s.scale.set(1, 1, 1); scene.add(s);
    puffs.push({ s, life: 0 });
  }
  // Skid marks: dark quads that fade after 25 s.
  const skids = [];
  const skidMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55 });
  const skidGeo = new THREE.PlaneGeometry(0.35, 1.4);
  for (let i = 0; i < 60; i++) {
    const m = new THREE.Mesh(skidGeo, skidMat.clone());
    m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m);
    skids.push({ m, life: 0 });
  }
  let skidI = 0;
  // Muzzle flash light.
  const flash = new THREE.PointLight(0xffc860, 0, 12);
  scene.add(flash);
  return {
    rain, rainPos: pos, puffs, skids, flash,
    puff(x, y, z, scale) {
      const p = puffs.find((q) => q.life <= 0) || puffs[0];
      p.s.position.set(x, y, z); p.s.scale.set(scale, scale, 1);
      p.s.material.opacity = 0.5; p.life = 0.9;
    },
    skid(x, y, z, heading) {
      const s = skids[skidI++ % skids.length];
      s.m.position.set(x, y + 0.03, z); s.m.rotation.z = heading;
      s.m.visible = true; s.m.material.opacity = 0.55; s.life = 25;
    },
    muzzle(x, y, z) { flash.position.set(x, y, z); flash.intensity = 26; },
    update(dt, camPos, raining) {
      rain.material.opacity = raining ? 0.55 : 0;
      if (raining) {
        const arr = rainGeo.attributes.position.array;
        for (let i = 0; i < N; i++) {
          arr[i * 3 + 1] -= 34 * dt;
          arr[i * 3] += 4 * dt;
          if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = 40;
        }
        rainGeo.attributes.position.needsUpdate = true;
        rain.position.set(camPos.x, 0, camPos.z);
      }
      for (const p of puffs) {
        if (p.life > 0) {
          p.life -= dt;
          p.s.material.opacity = clamp(p.life, 0, 0.5);
          p.s.scale.x += dt * 2; p.s.scale.y += dt * 2;
          p.s.position.y += dt * 0.8;
        } else p.s.material.opacity = 0;
      }
      for (const s of skids) {
        if (s.life > 0) {
          s.life -= dt;
          s.m.material.opacity = clamp(s.life / 25, 0, 1) * 0.55;
          if (s.life <= 0) s.m.visible = false;
        }
      }
      if (flash.intensity > 0) flash.intensity = Math.max(0, flash.intensity - dt * 400);
    },
  };
}
