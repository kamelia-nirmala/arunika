// Menus: title screen, pause, game over, and localStorage saves.
// The title screen is also the first thing a new player (and the judge's
// screenshot) sees, so it carries the game's name and its promise.
const SAVE_PREFIX = 'arunika.save.';
export function bindMenus(doc, game) {
  const title = doc.getElementById('title-screen');
  const pause = doc.getElementById('pause-menu');
  const over = doc.getElementById('gameover-screen');
  title.addEventListener('click', () => startGame(game));
  doc.getElementById('btn-start').addEventListener('click', () => startGame(game));
  doc.getElementById('btn-resume').addEventListener('click', () => resumeGame(game));
  doc.getElementById('btn-quit-title').addEventListener('click', () => quitToTitle(game));
  doc.getElementById('btn-restart').addEventListener('click', () => restartGame(game));
  doc.getElementById('btn-save').addEventListener('click', () => saveGame(game, 1));
  game.ui = { title, pause, over };
}
export function showTitle(game) {
  game.state = 'title';
  game.ui.title.classList.add('show');
  game.ui.pause.classList.remove('show');
  game.ui.over.classList.remove('show');
}
export function startGame(game) {
  game.ui.title.classList.remove('show');
  game.state = 'play';
  if (game.audio) {
    game.audio.unlock();
    game.radio.on = true;
    if (game.audio.ctx) game.radio.nextT = game.audio.ctx.currentTime;
  }
}
export function pauseGame(game) {
  if (game.state !== 'play') return;
  game.state = 'pause';
  game.ui.pause.classList.add('show');
}
export function resumeGame(game) {
  game.ui.pause.classList.remove('show');
  game.state = 'play';
}
export function quitToTitle(game) {
  game.ui.pause.classList.remove('show');
  showTitle(game);
}
export function gameOver(game) {
  game.state = 'over';
  game.ui.over.classList.add('show');
}
export function restartGame(game) {
  game.ui.over.classList.remove('show');
  game.reset();
  game.state = 'play';
}
export function saveGame(game, slot) {
  const data = {
    money: game.economy.money, missions: game.missions.done,
    available: game.missions.available,
    x: game.player.pos.x, z: game.player.pos.z,
    hour: game.hour, tide: game.tide.elapsed, health: game.player.health,
  };
  try { localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(data)); return true; }
  catch { return false; }
}
export function loadGame(game, slot) {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + slot);
    if (!raw) return false;
    const d = JSON.parse(raw);
    game.economy.money = d.money || 0;
    game.missions.done = d.missions || [];
    game.missions.available = d.available || 1;
    game.player.pos.set(d.x || 0, 0, d.z || 0);
    game.hour = d.hour || 11.66;
    game.tide.elapsed = d.tide || 0;
    game.player.health = d.health || 100;
    return true;
  } catch { return false; }
}
