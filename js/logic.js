/* 印旛村市民マラソン
   x は右が正。y は路面からの高さ（上が正）。矩形は {x, y, w, h} で y が下辺。 */
(function (root) {
  var PX_PER_M = 48;
  var GRAVITY = 1700;
  var JUMP_V = 980;
  var SLIDE_TIME = 0.9;
  var BUFFER = 0.14;
  var BASE_MPS = 5.3;
  var MAX_EXTRA_MPS = 6.0;

  var METRICS = {
    pxPerM: PX_PER_M,
    hurdle: { w: 40, h: 116 },
    banner: { w: 70, y: 156, h: 220 },
    playerStand: { x: -22, w: 44, h: 190 },
    playerSlide: { x: -46, w: 108, h: 96 },
    coin: { w: 36, h: 36 },
  };

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createRun(id, seed) {
    var run = {
      id: id,
      phase: "countdown",
      countdown: 1.7,
      t: 0,
      deadT: 0,
      dist: 0,
      speed: PX_PER_M * BASE_MPS,
      vy: 0,
      y: 0,
      state: "run",
      slideT: 0,
      yen: 0,
      jumpBuf: 0,
      slideBuf: 0,
      squash: 0,
      ents: [],
      nextX: 640,
      lastSolidX: -99999,
      scriptI: 0,
      hintJump: true,
      hintSlide: true,
      rng: mulberry32(seed == null ? 1 : seed),
    };
    ensureSpawn(run);
    return run;
  }

  function playerRect(run) {
    var box = run.state === "slide" ? METRICS.playerSlide : METRICS.playerStand;
    return { x: run.dist + box.x, y: run.y, w: box.w, h: box.h };
  }

  function entRect(e) {
    if (e.type === "coin") {
      return { x: e.x, y: e.lift, w: METRICS.coin.w, h: METRICS.coin.h };
    }
    if (e.type === "hurdle") {
      return { x: e.x, y: 0, w: METRICS.hurdle.w, h: METRICS.hurdle.h };
    }
    return { x: e.x, y: METRICS.banner.y, w: METRICS.banner.w, h: METRICS.banner.h };
  }

  function overlap(a, b) {
    if (a.x + a.w <= b.x || b.x + b.w <= a.x) return false;
    if (a.y + a.h <= b.y || b.y + b.h <= a.y) return false;
    return true;
  }

  function targetSpeed(dist) {
    var meters = dist / PX_PER_M;
    return PX_PER_M * (BASE_MPS + Math.min(MAX_EXTRA_MPS, meters / 110));
  }

  function startJump(run) {
    run.state = "jump";
    run.vy = JUMP_V;
    run.y = 0;
    run.jumpBuf = 0;
    run.slideT = 0;
    return { type: "jump" };
  }

  function startSlide(run) {
    run.state = "slide";
    run.slideT = SLIDE_TIME;
    run.y = 0;
    run.vy = 0;
    run.slideBuf = 0;
    return { type: "slide" };
  }

  function pushCoin(run, x, lift) {
    run.ents.push({ type: "coin", x: x, lift: lift, dead: false, hint: null });
  }

  function pushSolid(run, x, type) {
    var hint = null;
    if (type === "hurdle" && run.hintJump) {
      hint = "jump";
      run.hintJump = false;
    }
    if (type === "banner" && run.hintSlide) {
      hint = "slide";
      run.hintSlide = false;
    }
    run.ents.push({ type: type, x: x, hint: hint, dead: false });
    var width = type === "hurdle" ? METRICS.hurdle.w : METRICS.banner.w;
    run.lastSolidX = x + width;
  }

  var OPENING = ["coins", "arc", "hurdle", "coins", "banner"];

  function ensureSpawn(run) {
    var horizon = run.dist + Math.max(980, run.speed * 2.4);
    var guard = 0;
    while (run.nextX < horizon && guard < 24) {
      guard += 1;
      var kind = run.scriptI < OPENING.length ? OPENING[run.scriptI++] : rollKind(run);
      if (kind === "coins") {
        var i;
        for (i = 0; i < 5; i += 1) pushCoin(run, run.nextX + i * 74, 46);
        run.nextX += 430;
      } else if (kind === "arc") {
        var lifts = [42, 108, 156, 108, 42];
        var n;
        for (n = 0; n < lifts.length; n += 1) pushCoin(run, run.nextX + n * 80, lifts[n]);
        run.nextX += 460;
      } else {
        var gap = Math.max(620, run.speed * 1.45);
        var x = Math.max(run.nextX, run.lastSolidX + gap);
        if (kind === "banner") {
          pushSolid(run, x, "banner");
          pushCoin(run, x + 8, 28);
          pushCoin(run, x + 78, 28);
          run.nextX = run.lastSolidX + 120;
        } else if (kind === "pair") {
          pushSolid(run, x, "hurdle");
          pushCoin(run, x + 70, 150);
          var x2 = run.lastSolidX + gap;
          pushSolid(run, x2, "banner");
          pushCoin(run, x2 + 6, 28);
          run.nextX = run.lastSolidX + 120;
        } else {
          pushSolid(run, x, "hurdle");
          pushCoin(run, x + 64, 148);
          pushCoin(run, x + 132, 120);
          run.nextX = run.lastSolidX + 120;
        }
      }
    }
  }

  function rollKind(run) {
    var meters = run.nextX / PX_PER_M;
    var r = run.rng();
    if (meters > 150 && r < 0.18) return "pair";
    if (meters > 55 && r < 0.48) return "banner";
    if (meters > 30 && r < 0.78) return "hurdle";
    return r < 0.45 ? "arc" : "coins";
  }

  function update(run, dt, input) {
    if (dt < 0) dt = 0;
    if (dt > 0.034) dt = 0.034;
    var events = [];
    if (input && input.jump) run.jumpBuf = BUFFER;
    if (input && input.slide) run.slideBuf = BUFFER;

    if (run.phase === "countdown") {
      run.countdown -= dt;
      run.t += dt;
      if (run.countdown <= 0) {
        run.phase = "run";
        run.countdown = 0;
        run.speed = PX_PER_M * BASE_MPS;
      }
      return events;
    }

    if (run.phase === "dead") {
      run.deadT += dt;
      run.t += dt;
      run.dist += run.speed * dt * Math.max(0, 1 - run.deadT * 2.2);
      run.vy -= GRAVITY * dt;
      run.y += run.vy * dt;
      if (run.y < 0) {
        run.y = 0;
        run.vy = 0;
      }
      return events;
    }

    var want = targetSpeed(run.dist);
    run.speed += (want - run.speed) * Math.min(1, dt * 1.4);
    run.dist += run.speed * dt;
    run.t += dt;
    if (run.squash > 0) run.squash = Math.max(0, run.squash - dt);

    if (run.state === "jump") {
      run.vy -= GRAVITY * dt;
      run.y += run.vy * dt;
      if (run.y <= 0) {
        run.y = 0;
        run.vy = 0;
        run.squash = 0.12;
        if (run.slideBuf > 0) events.push(startSlide(run));
        else run.state = "run";
      }
    } else if (run.state === "slide") {
      run.y = 0;
      run.vy = 0;
      run.slideT -= dt;
      if (run.jumpBuf > 0) events.push(startJump(run));
    } else if (run.jumpBuf > 0) {
      events.push(startJump(run));
    } else if (run.slideBuf > 0) {
      events.push(startSlide(run));
    }

    run.jumpBuf = Math.max(0, run.jumpBuf - dt);
    run.slideBuf = Math.max(0, run.slideBuf - dt);

    ensureSpawn(run);

    var body = playerRect(run);
    var i;
    for (i = 0; i < run.ents.length; i += 1) {
      var e = run.ents[i];
      if (e.dead) continue;
      if (e.x + 120 < run.dist - 400) {
        e.dead = true;
        continue;
      }
      if (!overlap(body, entRect(e))) continue;
      if (e.type === "coin") {
        e.dead = true;
        run.yen += 100;
        events.push({ type: "coin", x: e.x, lift: e.lift });
      } else {
        run.phase = "dead";
        run.deadT = 0;
        run.vy = 460;
        events.push({ type: "die" });
        break;
      }
    }

    if (run.phase !== "dead" && run.state === "slide" && run.slideT <= 0) {
      run.state = "run";
    }

    if (run.ents.length > 120) {
      run.ents = run.ents.filter(function (e) {
        return !e.dead && e.x > run.dist - 700;
      });
    }
    return events;
  }

  root.MarathonLogic = {
    createRun: createRun,
    update: update,
    playerRect: playerRect,
    entRect: entRect,
    overlap: overlap,
    METRICS: METRICS,
    PX_PER_M: PX_PER_M,
    JUMP_V: JUMP_V,
    GRAVITY: GRAVITY,
    SLIDE_TIME: SLIDE_TIME,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
