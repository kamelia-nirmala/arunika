// Mission engine: walks a job's objective chain, plants a pulsing beacon
// at the current target, and reports progress, failure, and completion.
import * as THREE from 'three';
import { JOBS } from './jobs.js';
import { showDialog } from './dialogue.js';

export function createMissions(scene) {
  const geo = new THREE.CylinderGeometry(2.2, 2.2, 30, 12, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true,
    opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const beacon = new THREE.Mesh(geo, mat);
  beacon.visible = false;
  scene.add(beacon);
  return {
    scene, beacon, job: null, obj: 0, timer: 0, kills: 0,
    available: 1, done: [], failed: null, toast: null,
  };
}
export function currentObjective(m) {
  if (!m.job) return null;
  return m.job.objectives[m.obj] || null;
}
export function startMission(m, id, onStart) {
  const job = JOBS.find((j) => j.id === id);
  if (!job) return false;
  m.job = job; m.obj = 0; m.timer = 0; m.kills = 0; m.failed = null;
  showDialog(job.dialog, () => { if (onStart) onStart(); });
  return true;
}
function moveBeacon(m, o, time) {
  m.beacon.visible = !!o;
  if (!o) return;
  m.beacon.position.set(o.x, 15, o.z);
  m.beacon.material.opacity = 0.25 + 0.15 * Math.sin(time * 4);
  m.beacon.rotation.y = time * 0.5;
}
export function updateMissions(m, dt, game, time) {
  const o = currentObjective(m);
  moveBeacon(m, o, time);
  if (!o) return null;
  const p = game.player;
  const d = Math.hypot(p.pos.x - o.x, p.pos.z - o.z);
  if (o.time) {
    m.timer += dt;
    // 'survive' is the exception: its time is the GOAL (stay alive that
    // long), not a limit — failing when the timer passes it would make the
    // objective impossible (the timer never lands exactly on the value).
    if (o.kind !== 'survive' && m.timer > o.time) { m.failed = 'Waktu habis'; return failMission(m); }
  }
  let done = false;
  switch (o.kind) {
    case 'goto': case 'deliver': case 'escape':
      done = d < o.r;
      break;
    case 'survive':
      done = d < o.r && m.timer >= o.time;
      break;
    case 'kill':
      done = m.kills >= (o.count || 1);
      break;
    case 'stealth':
      done = d < o.r && game.wanted.stars === 0;
      if (game.wanted.stars > 0 && d < o.r + 20) { m.failed = 'Terlihat penjaga'; return failMission(m); }
      break;
  }
  if (!done) return null;
  m.obj++; m.timer = 0;
  if (m.obj >= m.job.objectives.length) return completeMission(m, game);
  return { event: 'objective', text: currentObjective(m).text };
}
function failMission(m) {
  const job = m.job;
  m.job = null; m.beacon.visible = false;
  return { event: 'failed', title: job.title, reason: m.failed || 'Gagal' };
}
function completeMission(m, game) {
  const job = m.job;
  m.done.push(job.id);
  m.available = Math.min(9, m.available + 1);
  m.job = null; m.beacon.visible = false;
  game.economy.money += job.reward;
  return { event: 'complete', title: job.title, reward: job.reward };
}
export function missionMarker(m) {
  const o = currentObjective(m);
  return o ? { x: o.x, z: o.z } : null;
}
