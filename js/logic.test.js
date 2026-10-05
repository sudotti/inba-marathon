const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { console, Math, Number, Object, Array };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "logic.js"), "utf8"),
  sandbox
);
const L = sandbox.MarathonLogic;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

function fresh() {
  const run = L.createRun("massa", 1);
  run.phase = "run";
  run.countdown = 0;
  run.ents = [];
  run.nextX = 999999;
  run.lastSolidX = 999999;
  run.speed = L.PX_PER_M * 5.3;
  return run;
}

function place(run, type, x, lift) {
  run.ents.push({ type, x, lift: lift || 0, hint: null, dead: false });
}

function overlapNow(run, type) {
  const run0 = fresh();
  run0.dist = 1000;
  run0.y = run.y;
  run0.state = run.state;
  if (run0.state === "slide") run0.slideT = 0.4;
  if (run0.state === "jump") run0.vy = 200;
  place(run0, type, run0.dist + L.playerRect(run0).x - run0.dist, run.lift);
  // Place the obstacle so it overlaps the body in x.
  run0.ents = [{
    type,
    x: L.playerRect(run0).x + 4,
    lift: run.lift || 0,
    hint: null,
    dead: false,
  }];
  const events = L.update(run0, 0, {});
  return { run: run0, events };
}

(function staticHits() {
  let r = overlapNow({ y: 0, state: "run" }, "hurdle");
  assert(r.run.phase === "dead", "standing hits a hurdle");
  r = overlapNow({ y: 0, state: "slide" }, "hurdle");
  assert(r.run.phase === "dead", "sliding hits a hurdle");
  r = overlapNow({ y: 140, state: "jump" }, "hurdle");
  assert(r.run.phase === "run", "a high jump clears a hurdle");
  r = overlapNow({ y: 0, state: "run" }, "banner");
  assert(r.run.phase === "dead", "standing hits a banner");
  r = overlapNow({ y: 0, state: "slide" }, "banner");
  assert(r.run.phase === "run", "sliding clears a banner");
  r = overlapNow({ y: 40, state: "jump" }, "banner");
  assert(r.run.phase === "dead", "jumping hits a banner");
  r = overlapNow({ y: 0, state: "run", lift: 40 }, "coin");
  assert(r.run.yen === 100, "a coin is worth 100 yen");
  assert(r.run.phase === "run", "a coin does not stop the run");
})();

function sweep(kind, action, speed) {
  const wins = [];
  for (let trigger = 30; trigger <= 520; trigger += 10) {
    const run = fresh();
    run.speed = speed;
    const ox = 700;
    place(run, kind, ox);
    let acted = false;
    let died = false;
    for (let f = 0; f < 500; f += 1) {
      const press = !acted && ox - run.dist < trigger;
      if (press) acted = true;
      const events = L.update(run, 1 / 60, {
        jump: action === "jump" && press,
        slide: action === "slide" && press,
      });
      if (events.some((e) => e.type === "die")) {
        died = true;
        break;
      }
      if (run.dist > ox + 220) break;
    }
    if (!died && run.dist > ox + 80) wins.push(trigger);
  }
  return wins;
}

const slow = L.PX_PER_M * 5.3;
const fast = L.PX_PER_M * 11;
const jumpSlow = sweep("hurdle", "jump", slow);
const slideSlow = sweep("banner", "slide", slow);
const jumpFast = sweep("hurdle", "jump", fast);
const slideFast = sweep("banner", "slide", fast);
const jumpIntoBanner = sweep("banner", "jump", slow);
const slideIntoHurdle = sweep("hurdle", "slide", slow);

console.log("jump slow", jumpSlow[0], "-", jumpSlow[jumpSlow.length - 1], "n", jumpSlow.length);
console.log("slide slow", slideSlow[0], "-", slideSlow[slideSlow.length - 1], "n", slideSlow.length);
console.log("jump fast", jumpFast[0], "-", jumpFast[jumpFast.length - 1], "n", jumpFast.length);
console.log("slide fast", slideFast[0], "-", slideFast[slideFast.length - 1], "n", slideFast.length);
console.log("jump vs banner", jumpIntoBanner.length, "slide vs hurdle", slideIntoHurdle.length);

assert(jumpSlow.length >= 6, "jump window at the start is wide enough");
assert(slideSlow.length >= 6, "slide window at the start is wide enough");
assert(jumpFast.length >= 4, "jump window stays usable when fast");
assert(slideFast.length >= 4, "slide window stays usable when fast");
assert(jumpIntoBanner.length === 0, "jumping never clears a banner");
assert(slideIntoHurdle.length === 0, "sliding never clears a hurdle");

(function openingIsGentle() {
  const run = L.createRun("kenny", 2);
  const earlySolids = run.ents.filter((e) => e.type !== "coin" && e.x < 1100);
  assert(earlySolids.length === 0, "the first stretch is only 100-yen coins");
  let guard = 0;
  while (run.dist < 4000 && guard < 2000) {
    L.update(run, 1 / 60, {});
    guard += 1;
    if (run.phase === "dead") break;
  }
  assert(run.phase === "dead", "doing nothing eventually hits an obstacle");
  assert(run.yen >= 100, "coins are reachable before the first mistake");
})();

if (!process.exitCode) console.log("ok");
