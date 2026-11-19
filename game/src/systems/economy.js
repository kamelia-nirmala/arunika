// Economy: mission pay, smuggling (pays more at high tide), the chop shop,
// and garage upgrades that change how a car drives.
export function createEconomy() {
  return { money: 0, upgrades: { engine: 0, brakes: 0, tires: 0 } };
}
export function earn(ec, n) { ec.money += n; return ec.money; }
export function spend(ec, n) {
  if (ec.money < n) return false;
  ec.money -= n; return true;
}
// Chop shop (Loji Cempaka): a stolen car sells for its base value minus damage.
export function chopValue(car) {
  const base = car.kind === 'truck' ? 900 : car.kind === 'sedan' ? 1400 : 800;
  return Math.max(100, Math.round(base * (1 - car.damage / 130)));
}
// Garage upgrade: +8% top speed, -10% braking distance, +6% grip per level (max 3).
export function upgradeCost(ec, which) {
  return 1200 * (ec.upgrades[which] + 1);
}
export function buyUpgrade(ec, which) {
  if (ec.upgrades[which] >= 3) return false;
  const cost = upgradeCost(ec, which);
  if (!spend(ec, cost)) return false;
  ec.upgrades[which]++;
  return true;
}
export function applyUpgrades(car, ec) {
  car.spec = { ...car.spec };
  car.spec.top *= 1 + 0.08 * ec.upgrades.engine;
  car.spec.brake *= 1 + 0.1 * ec.upgrades.brakes;
  car.spec.grip *= 1 + 0.06 * ec.upgrades.tires;
}
