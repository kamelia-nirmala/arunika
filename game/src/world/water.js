// Water: the river, the harbour basin, and the tide that raises/lowers them.
// The tide tube in the HUD reads the same value the world renders.
import * as THREE from 'three';
import { CITY, PALETTE } from '../config.js';
import { clamp } from '../random.js';

export function buildWater(scene) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.water, transparent: true,
    opacity: 0.82, roughness: 0.15, metalness: 0.35 });
  // River band (full width) + harbour basin in Sagara Hilir (east).
  const river = new THREE.Mesh(geo, mat);
  river.rotation.x = -Math.PI / 2;
  river.scale.set(CITY.maxX - CITY.minX + 40, CITY.riverZ1 - CITY.riverZ0, 1);
  river.position.set(0, -2, (CITY.riverZ0 + CITY.riverZ1) / 2);
  const basin = new THREE.Mesh(geo, mat.clone());
  basin.rotation.x = -Math.PI / 2;
  basin.scale.set(180, 60, 1);
  basin.position.set(270, -2, -420);
  // Mud flat: exposed only at low tide (the surut shortcut across the river).
  const mud = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: PALETTE.mud,
    transparent: true, opacity: 0, roughness: 1 }));
  mud.rotation.x = -Math.PI / 2;
  mud.scale.set(16, 90, 1);
  mud.position.set(180, -1.6, -315);
  scene.add(river, basin, mud);
  return { river, basin, mud };
}
// Tide value 0..1 from elapsed seconds; returns the water surface height.
export function tideLevel(t) { return -2 + t * 2.2; }
export function updateWater(water, tide, time = 0) {
  const y = tideLevel(tide);
  water.river.position.y = y;
  water.basin.position.y = y;
  // Slow shimmer so the river reads as water, not a painted plane.
  const shimmer = 0.8 + 0.03 * Math.sin(time * 0.6);
  water.river.material.opacity = shimmer;
  water.basin.material.opacity = shimmer;
  // Mud appears as the tide drops below 0.35 and vanishes above it.
  water.mud.material.opacity = clamp((0.35 - tide) * 4, 0, 0.95);
  water.mud.position.y = -1.6 + Math.max(0, tide - 0.2);
}
