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

function fresh(id) {
  const run = L.createRun(id || "nakki", 1);
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

function sweep(kind, action, speed, id) {
  const wins = [];
  for (let trigger = 30; trigger <= 520; trigger += 10) {
    const run = fresh(id);
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

const kennyJumpBanner = sweep("banner", "jump", slow, "kenny");
console.log("kenny jump vs banner", kennyJumpBanner.length);
assert(kennyJumpBanner.length === 0, "kenny's higher jump still hits banners");

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

function release(id) {
  const run = L.createRun(id, 3);
  let guard = 0;
  while (run.phase === "countdown" && guard < 80) {
    L.update(run, 0.05, {});
    guard += 1;
  }
  return run;
}

(function speedsMatchTheCast() {
  assert(L.stats("massa").speed === 0.7, "massa speed stat is 0.7");
  assert(L.stats("nakki").speed === 1, "nakki speed stat is 1");
  assert(L.stats("kenny").speed === 1.3, "kenny speed stat is 1.3");
  assert(Math.abs(release("massa").speed - L.PX_PER_M * 5.3 * 0.7) < 1e-6, "massa starts at 0.7");
  assert(Math.abs(release("nakki").speed - L.PX_PER_M * 5.3) < 1e-6, "nakki starts at 1");
  assert(Math.abs(release("kenny").speed - L.PX_PER_M * 5.3 * 1.3) < 1e-6, "kenny starts at 1.3");

  function ratio(id) {
    const run = release(id);
    run.y = 900;
    let guard = 0;
    while (run.dist < 8000 && guard < 6000) {
      L.update(run, 1 / 60, {});
      run.y = 900;
      guard += 1;
    }
    const meters = run.dist / L.PX_PER_M;
    const curve = L.PX_PER_M * (5.3 + Math.min(6, meters / 110));
    return run.speed / curve;
  }
  const massa = ratio("massa");
  const nakki = ratio("nakki");
  const kenny = ratio("kenny");
  console.log("cruise", massa.toFixed(3), nakki.toFixed(3), kenny.toFixed(3));
  assert(Math.abs(massa - 0.7) < 0.04, "massa holds 0.7 along the course");
  assert(Math.abs(nakki - 1) < 0.04, "nakki holds the base curve");
  assert(Math.abs(kenny - 1.3) < 0.04, "kenny holds 1.3 along the course");
})();

function jumpApex(id) {
  const run = fresh(id);
  L.update(run, 1 / 60, { jump: true });
  const vy = run.vy;
  let top = run.y;
  let guard = 0;
  while (run.state === "jump" && guard < 400) {
    L.update(run, 1 / 60, {});
    if (run.y > top) top = run.y;
    guard += 1;
  }
  return { vy, top };
}

(function kennyJumpsHigherButStaysUnderBanners() {
  const nakki = jumpApex("nakki");
  const kenny = jumpApex("kenny");
  const massa = jumpApex("massa");
  const bannerTop = L.METRICS.banner.y + L.METRICS.banner.h;
  console.log("apex", massa.top.toFixed(1), nakki.top.toFixed(1), kenny.top.toFixed(1), "banner", bannerTop);
  assert(nakki.vy === L.JUMP_V, "nakki uses the base jump");
  assert(massa.vy === L.JUMP_V, "massa uses the base jump");
  assert(Math.abs(kenny.vy - L.JUMP_V * 1.12) < 1e-6, "kenny jump is 1.12");
  assert(kenny.top > nakki.top + 40, "kenny's apex is clearly higher");
  assert(kenny.top < bannerTop - 8, "kenny's feet stay under the banner");
})();

function census(id, seed) {
  const run = L.createRun(id, seed);
  run.phase = "run";
  run.countdown = 0;
  run.y = 900;
  const seen = new Set();
  const n = { hurdle: 0, banner: 0, coin: 0 };
  let guard = 0;
  while (run.dist < 24000 && guard < 9000) {
    L.update(run, 0.034, {});
    run.y = 900;
    run.ents.forEach((e) => {
      const key = e.type + ":" + e.x + ":" + (e.lift || 0);
      if (seen.has(key)) return;
      seen.add(key);
      n[e.type] += 1;
    });
    guard += 1;
  }
  assert(run.dist >= 24000, id + " reached the sample distance");
  return n;
}

(function castChangesTheCourse() {
  const total = { massa: { hurdle: 0, coin: 0 }, nakki: { hurdle: 0, coin: 0 }, kenny: { hurdle: 0, coin: 0 } };
  for (let seed = 1; seed <= 8; seed += 1) {
    ["massa", "nakki", "kenny"].forEach((id) => {
      const n = census(id, seed);
      total[id].hurdle += n.hurdle;
      total[id].coin += n.coin;
    });
  }
  console.log("census", JSON.stringify(total));
  assert(total.massa.hurdle < total.nakki.hurdle * 0.7, "massa sees fewer hurdles");
  assert(total.massa.hurdle < total.kenny.hurdle * 0.7, "massa sees fewer hurdles than kenny");
  assert(total.nakki.coin > total.kenny.coin * 1.35, "nakki sees more coins than kenny");
  assert(total.nakki.coin > total.massa.coin * 1.15, "nakki sees more coins than massa");
})();

(function tutorialHurdleStays() {
  function firstSolid(id) {
    const run = L.createRun(id, 4);
    run.phase = "run";
    run.countdown = 0;
    run.y = 900;
    let guard = 0;
    while (guard < 2500) {
      L.update(run, 0.034, {});
      run.y = 900;
      const solid = run.ents.find((e) => e.type === "hurdle" || e.type === "banner");
      if (solid) return solid.type;
      guard += 1;
    }
    return null;
  }
  assert(firstSolid("massa") === "hurdle", "massa still meets the tutorial hurdle");
  assert(firstSolid("nakki") === "hurdle", "nakki still meets the tutorial hurdle");
  assert(firstSolid("kenny") === "hurdle", "kenny still meets the tutorial hurdle");
})();

if (!process.exitCode) console.log("ok");
