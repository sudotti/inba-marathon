(function () {
  var L = globalThis.MarathonLogic;
  var W = 540;
  var H = 960;
  var FEET = 640;
  var PLAYER_X = 178;
  var RUN_H = 228;

  var CAST = [
    {
      id: "massa",
      name: "マッサ",
      line: "巻き髪、クリームの服、銀のチェーン",
      portrait: "assets/portraits/massa.jpg",
    },
    {
      id: "nakki",
      name: "ナッキー",
      line: "金のチェーン、ジーンズ、茶色の靴",
      portrait: "assets/portraits/nakki.jpg",
    },
    {
      id: "kenny",
      name: "ケニー",
      line: "黒いくせ毛、白T、青い靴",
      portrait: "assets/portraits/kenny.png",
    },
  ];

  var params = new URLSearchParams(location.search);
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var canvas = document.getElementById("view");
  var ctx = canvas.getContext("2d");
  var phone = document.getElementById("phone");
  var hud = document.getElementById("hud");
  var yenEl = document.getElementById("yen");
  var whoEl = document.getElementById("who");
  var distEl = document.getElementById("dist");
  var clockEl = document.getElementById("clock");
  var coach = document.getElementById("coach");
  var bar = document.getElementById("bar");
  var overlay = document.getElementById("overlay");
  var titleBest = document.getElementById("title-best");
  var overFlag = document.getElementById("over-flag");
  var overYen = document.getElementById("over-yen");
  var overMeta = document.getElementById("over-meta");

  var bank = {};
  var mode = "title";
  var character = CAST[0];
  var run = null;
  var paused = false;
  var last = 0;
  var cam = 0;
  var demo = 0;
  var jumps = 0;
  var slides = 0;
  var shownOver = false;
  var yenShown = 0;
  var pops = [];
  var dusts = [];
  var lastStep = 0;
  var audioCtx = null;
  var muted = localStorage.getItem("inba-marathon-mute") === "1";
  var pending = { jump: false, slide: false };

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function boot() {
    var jobs = CAST.map(function (c) {
      return Promise.all([
        loadImage("assets/sprites/" + c.id + "/run.png"),
        loadImage("assets/sprites/" + c.id + "/jump.png"),
        loadImage("assets/sprites/" + c.id + "/slide.png"),
      ]).then(function (imgs) {
        var runImg = imgs[0];
        var scale = runImg ? RUN_H / runImg.height : 1;
        bank[c.id] = {
          run: runImg,
          jump: imgs[1],
          slide: imgs[2],
          runH: RUN_H,
          jumpH: imgs[1] ? imgs[1].height * scale : RUN_H,
          slideH: imgs[2] ? imgs[2].height * scale : 110,
        };
      });
    });
    buildPicks();
    bind();
    fit();
    reflectMute();
    showBest();
    var screen = params.get("screen");
    if (params.get("preview")) {
      var found = CAST.filter(function (c) { return c.id === params.get("preview"); })[0] || CAST[0];
      startRun(found, true);
    } else if (screen === "select") {
      show("select");
    } else {
      show("title");
    }
    return Promise.all(jobs);
  }

  function buildPicks() {
    var box = document.getElementById("picks");
    CAST.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pick";
      b.innerHTML = '<img alt="" src="' + c.portrait + '"><span><strong>' + c.name + '</strong><small>' + c.line + '</small></span>';
      b.addEventListener("click", function () { startRun(c, false); });
      box.appendChild(b);
    });
  }

  function bind() {
    document.getElementById("to-select").addEventListener("click", function () { show("select"); });
    document.getElementById("back").addEventListener("click", function () { show("title"); });
    document.getElementById("pause").addEventListener("click", function () {
      if (mode === "run" && run && run.phase !== "dead") show("pause");
    });
    document.getElementById("resume").addEventListener("click", function () { show("run"); });
    document.getElementById("quit").addEventListener("click", function () { show("title"); });
    document.getElementById("retry").addEventListener("click", function () { startRun(character, true); });
    document.getElementById("reselect").addEventListener("click", function () { show("select"); });
    document.getElementById("mute").addEventListener("click", function () {
      muted = !muted;
      localStorage.setItem("inba-marathon-mute", muted ? "1" : "0");
      reflectMute();
      if (!muted) unlock();
    });
    document.getElementById("btn-jump").addEventListener("pointerdown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      pending.jump = true;
      unlock();
    });
    document.getElementById("btn-slide").addEventListener("pointerdown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      pending.slide = true;
      unlock();
    });

    var sx = 0;
    var sy = 0;
    var tracking = false;
    canvas.addEventListener("pointerdown", function (e) {
      tracking = true;
      sx = e.clientX;
      sy = e.clientY;
      unlock();
    });
    canvas.addEventListener("pointerup", function (e) {
      if (!tracking) return;
      tracking = false;
      var dy = e.clientY - sy;
      var dx = e.clientX - sx;
      if (Math.abs(dy) < 28 || Math.abs(dy) < Math.abs(dx)) return;
      if (dy < 0) pending.jump = true;
      else pending.slide = true;
    });

    window.addEventListener("keydown", function (e) {
      if (e.repeat) return;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W" || e.key === " ") {
        e.preventDefault();
        pending.jump = true;
        unlock();
      } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
        e.preventDefault();
        pending.slide = true;
        unlock();
      } else if (e.key === "Escape" && mode === "run") {
        show("pause");
      }
    });
    window.addEventListener("resize", fit);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", fit);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && mode === "run" && run && run.phase === "run") show("pause");
    });
  }

  function fit() {
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    phone.style.width = Math.round(W * s) + "px";
    phone.style.height = Math.round(H * s) + "px";
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function show(next) {
    mode = next;
    paused = next === "pause";
    ["title", "select", "pause", "over"].forEach(function (name) {
      document.getElementById("screen-" + name).hidden = name !== next;
    });
    overlay.hidden = next === "run";
    hud.hidden = next !== "run" && next !== "pause";
    bar.hidden = next !== "run";
    coach.hidden = true;
    if (next === "title") showBest();
  }

  function showBest() {
    var yen = Number(localStorage.getItem("inba-marathon-best-yen") || 0);
    var dist = Number(localStorage.getItem("inba-marathon-best-dist") || 0);
    titleBest.textContent = yen > 0 || dist > 0
      ? "自己ベスト " + yenText(yen) + " / " + distText(dist)
      : "まだ記録がありません";
  }

  function startRun(c, quick) {
    character = c;
    run = L.createRun(c.id, (Date.now() % 100000) + 1);
    if (quick) run.countdown = 0.45;
    jumps = 0;
    slides = 0;
    shownOver = false;
    yenShown = 0;
    pops = [];
    dusts = [];
    whoEl.textContent = c.name;
    if (params.get("gallery")) {
      run.phase = "run";
      run.countdown = 0;
      run.ents = [
        { type: "coin", x: run.dist + 40, lift: 48, hint: null, dead: false },
        { type: "coin", x: run.dist + 110, lift: 150, hint: null, dead: false },
        { type: "hurdle", x: run.dist + 190, hint: "jump", dead: false },
        { type: "banner", x: run.dist + 300, hint: "slide", dead: false },
      ];
      run.nextX = 999999;
      run.lastSolidX = 999999;
    }
    var pose = params.get("pose");
    if (pose === "jump") {
      run.phase = "run";
      run.countdown = 0;
      run.state = "jump";
      run.y = 160;
      run.vy = 0;
    } else if (pose === "slide") {
      run.phase = "run";
      run.countdown = 0;
      run.state = "slide";
      run.slideT = 2;
      run.y = 0;
    }
    show("run");
    unlock();
  }

  function reflectMute() {
    document.getElementById("mute").textContent = muted ? "音オフ" : "音オン";
  }

  function unlock() {
    if (muted) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function tone(freq, dur, type, gain) {
    if (muted || !audioCtx) return;
    var t = audioCtx.currentTime;
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur);
  }

  function play(events) {
    events.forEach(function (e) {
      if (e.type === "coin") {
        tone(880, 0.07, "triangle", 0.05);
        tone(1320, 0.1, "triangle", 0.04);
        pops.push({ x: e.x, lift: e.lift + 24, life: 0.75 });
      } else if (e.type === "jump") {
        jumps += 1;
        tone(420, 0.08, "sine", 0.04);
      } else if (e.type === "slide") {
        slides += 1;
        tone(180, 0.09, "sawtooth", 0.02);
      } else if (e.type === "die") {
        tone(140, 0.22, "square", 0.04);
      }
    });
  }

  function yenText(n) {
    return "¥" + Math.floor(n).toLocaleString("ja-JP");
  }

  function distText(px) {
    var m = px / L.PX_PER_M;
    if (m < 1000) return Math.floor(m) + " m";
    return (m / 1000).toFixed(2) + " km";
  }

  function clockText(t) {
    var s = Math.max(0, Math.floor(t));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  function finish(run) {
    var bestYen = Number(localStorage.getItem("inba-marathon-best-yen") || 0);
    var bestDist = Number(localStorage.getItem("inba-marathon-best-dist") || 0);
    var yenRecord = run.yen > bestYen;
    var distRecord = run.dist > bestDist;
    if (yenRecord) localStorage.setItem("inba-marathon-best-yen", String(run.yen));
    if (distRecord) localStorage.setItem("inba-marathon-best-dist", String(run.dist));
    overYen.textContent = yenText(run.yen);
    overMeta.textContent = distText(run.dist) + "　" + clockText(run.t);
    if (yenRecord && run.yen > 0) overFlag.textContent = "自己ベスト";
    else overFlag.textContent = "リタイア";
    var note = "自己ベスト " + yenText(Math.max(bestYen, run.yen));
    if (distRecord) note += "　距離も更新";
    overMeta.textContent += "\n" + note;
    show("over");
  }

  function loop(now) {
    if (!last) last = now;
    var dt = Math.min(0.034, (now - last) / 1000);
    last = now;
    if (mode === "title" || mode === "select") demo += dt;
    if (mode === "run" && run && !params.get("still")) {
      var events = L.update(run, dt, { jump: pending.jump, slide: pending.slide });
      pending.jump = false;
      pending.slide = false;
      play(events);
      if (run.phase === "dead" && run.deadT > 0.7 && !shownOver) {
        shownOver = true;
        finish(run);
      }
    } else {
      pending.jump = false;
      pending.slide = false;
    }
    draw(dt);
    if (!(params.get("still") && mode === "run")) requestAnimationFrame(loop);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    var shake = 0;
    if (!reduced && run && run.phase === "dead" && run.deadT < 0.35) {
      shake = (1 - run.deadT / 0.35) * 7;
    }
    ctx.save();
    if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    var worldCam;
    if (run && (mode === "run" || mode === "pause" || mode === "over")) worldCam = run.dist - PLAYER_X;
    else worldCam = demo * 90;
    cam = worldCam;

    drawSky();
    drawLake(worldCam);
    drawHills(worldCam);
    drawPaddies(worldCam);
    drawHouses(worldCam);
    drawShoulder();
    drawArch(worldCam);
    drawRoad(worldCam);
    drawMarkers(worldCam);
    if (run && (mode === "run" || mode === "pause" || mode === "over")) {
      drawEnts(run, worldCam);
      drawDust(worldCam);
      drawPlayer(run);
      drawPops(run, worldCam);
      paintHud(run);
    }
    ctx.restore();
  }

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, FEET);
    g.addColorStop(0, "#7eb6e8");
    g.addColorStop(0.55, "#b7ddf4");
    g.addColorStop(1, "#ffe6c4");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255, 226, 150, 0.95)";
    ctx.beginPath();
    ctx.arc(430, 128, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    drawCloud(70, 96, 1);
    drawCloud(250, 70, 0.7);
    drawCloud(390, 150, 0.55);
  }

  function drawCloud(x, y, s) {
    ctx.beginPath();
    ctx.ellipse(x, y, 34 * s, 16 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 26 * s, y + 4 * s, 24 * s, 14 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 24 * s, y + 6 * s, 20 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLake(camX) {
    var x = -((camX * 0.12) % 80);
    ctx.fillStyle = "#6aafd2";
    ctx.fillRect(0, 268, W, 58);
    ctx.fillStyle = "rgba(223, 244, 252, 0.75)";
    for (var i = -1; i < 10; i += 1) {
      ctx.fillRect(x + i * 80, 292, 36, 3);
    }
  }

  function drawHills(camX) {
    var shift = (camX * 0.2) % 540;
    ctx.fillStyle = "#a9c98a";
    ctx.beginPath();
    ctx.moveTo(-40, 360);
    for (var x = -40; x <= W + 40; x += 40) {
      var h = 24 + Math.sin((x + shift) * 0.02) * 16;
      ctx.lineTo(x, 330 - h);
    }
    ctx.lineTo(W + 40, 390);
    ctx.fill();
  }

  function drawPaddies(camX) {
    var shift = (camX * 0.38) % 64;
    for (var row = 0; row < 3; row += 1) {
      var y = 392 + row * 28;
      ctx.fillStyle = row % 2 ? "#8fb85c" : "#c5d97a";
      ctx.fillRect(0, y, W, 28);
      ctx.fillStyle = "rgba(90, 140, 120, 0.35)";
      for (var i = -1; i < 12; i += 1) ctx.fillRect(i * 64 - shift, y + 12, 40, 2);
    }
  }

  function drawHouses(camX) {
    var origin = camX * 0.55;
    var start = Math.floor(origin / 220) - 1;
    for (var i = start; i < start + 6; i += 1) {
      var r = rng(i * 19 + 4);
      var x = i * 220 - origin;
      var w = 46 + r() * 22;
      var h = 28 + r() * 14;
      var base = 448;
      ctx.fillStyle = "#f4e6cf";
      ctx.fillRect(x, base - h, w, h);
      ctx.fillStyle = "#c45548";
      ctx.beginPath();
      ctx.moveTo(x - 4, base - h);
      ctx.lineTo(x + w / 2, base - h - 14);
      ctx.lineTo(x + w + 4, base - h);
      ctx.fill();
      ctx.fillStyle = "#7daa52";
      ctx.beginPath();
      ctx.arc(x + w + 8, base - 6, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawShoulder() {
    var g = ctx.createLinearGradient(0, 448, 0, FEET);
    g.addColorStop(0, "#d5e29a");
    g.addColorStop(1, "#f0ddb4");
    ctx.fillStyle = g;
    ctx.fillRect(0, 448, W, FEET - 448);
  }

  function drawArch(camX) {
    var x = 420 - camX;
    if (x < -160 || x > W + 20) return;
    ctx.fillStyle = "#f7f1e6";
    ctx.fillRect(x, FEET - 250, 150, 36);
    ctx.strokeStyle = "#241c17";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, FEET - 250, 150, 36);
    ctx.fillStyle = "#d23b32";
    ctx.fillRect(x, FEET - 250, 8, 36);
    ctx.fillStyle = "#241c17";
    ctx.font = "700 18px 'Hiragino Maru Gothic ProN', 'Hiragino Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("スタート", x + 75, FEET - 232);
    ctx.fillStyle = "#c45548";
    ctx.fillRect(x + 6, FEET - 250, 6, 250);
    ctx.fillRect(x + 138, FEET - 250, 6, 250);
  }

  function drawRoad(camX) {
    ctx.fillStyle = "#e7dcc8";
    ctx.fillRect(0, FEET, W, 78);
    ctx.fillStyle = "#fffaf3";
    ctx.fillRect(0, FEET, W, 4);
    var shift = -((camX) % 36);
    for (var i = -1; i < 20; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? "#d4544a" : "#fffaf3";
      ctx.fillRect(shift + i * 18, FEET + 70, 18, 8);
    }
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    var dash = -((camX * 1) % 56);
    for (var d = -1; d < 14; d += 1) ctx.fillRect(dash + d * 56, FEET + 34, 22, 4);
    ctx.fillStyle = "#6ea354";
    ctx.fillRect(0, FEET + 78, W, H - FEET - 78);
    ctx.fillStyle = "#5f9248";
    var grass = -((camX * 1.15) % 28);
    for (var g = -1; g < 24; g += 1) ctx.fillRect(grass + g * 28, FEET + 96, 3, 16);
  }

  function drawMarkers(camX) {
    var every = 50 * L.PX_PER_M;
    var i0 = Math.floor(camX / every);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 14px 'Hiragino Maru Gothic ProN', 'Hiragino Sans', sans-serif";
    for (var i = i0; i < i0 + 3; i += 1) {
      if (i <= 0) continue;
      var x = i * every - camX;
      ctx.fillStyle = "#f4e6cf";
      ctx.fillRect(x, FEET - 46, 8, 46);
      ctx.strokeStyle = "#241c17";
      ctx.strokeRect(x, FEET - 46, 8, 46);
      var meters = i * 50;
      var label = meters % 1000 === 0 ? meters / 1000 + "km" : meters + "m";
      ctx.fillStyle = "#241c17";
      ctx.fillText(label, x + 4, FEET - 58);
    }
  }

  function drawEnts(run, camX) {
    run.ents.forEach(function (e) {
      if (e.dead) return;
      var x = e.x - camX;
      if (x < -180 || x > W + 180) return;
      if (e.type === "coin") drawCoin(x, e.lift, run.t + e.x);
      else if (e.type === "hurdle") drawHurdle(x);
      else drawBanner(x);
      if (e.hint && e.x > run.dist - 20) drawHint(x, e.hint);
    });
  }

  function drawCoin(x, lift, t) {
    var y = FEET - lift - 18 + Math.sin(t * 5) * 3;
    var spin = Math.abs(Math.sin(t * 6)) * 0.65 + 0.35;
    ctx.save();
    ctx.fillStyle = "rgba(36,28,23,0.15)";
    ctx.beginPath();
    ctx.ellipse(x + 18, FEET + 4, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(x + 18, y);
    ctx.scale(spin, 1);
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fillStyle = "#f2f4f7";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#b7c0ca";
    ctx.stroke();
    ctx.fillStyle = "#241c17";
    ctx.font = "800 12px 'Hiragino Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("100", 0, 1);
    ctx.restore();
  }

  function drawHurdle(x) {
    var h = L.METRICS.hurdle.h;
    var w = L.METRICS.hurdle.w;
    var drawW = 78;
    var left = x + w / 2 - drawW / 2;
    ctx.fillStyle = "#f4efe6";
    ctx.fillRect(left + 6, FEET - h + 10, 8, h - 10);
    ctx.fillRect(left + drawW - 14, FEET - h + 10, 8, h - 10);
    ctx.strokeStyle = "#241c17";
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 6, FEET - h + 10, 8, h - 10);
    ctx.strokeRect(left + drawW - 14, FEET - h + 10, 8, h - 10);
    var stripes = 6;
    var stripeW = drawW / stripes;
    for (var i = 0; i < stripes; i += 1) {
      ctx.fillStyle = i % 2 ? "#f7f4ee" : "#d23b32";
      ctx.fillRect(left + i * stripeW, FEET - h - 6, stripeW, 18);
    }
    ctx.strokeRect(left, FEET - h - 6, drawW, 18);
  }

  function drawBanner(x) {
    var m = L.METRICS.banner;
    var top = FEET - (m.y + m.h);
    ctx.strokeStyle = "rgba(36,28,23,0.45)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, top - 18);
    ctx.lineTo(x + m.w, top - 18);
    ctx.stroke();
    ctx.fillStyle = "#8a5a3a";
    ctx.fillRect(x - 3, top - 36, 8, 28);
    ctx.fillRect(x + m.w - 5, top - 36, 8, 28);
    for (var i = 0; i < 6; i += 1) {
      ctx.fillStyle = i % 2 ? "#fffaf3" : "#d23b32";
      ctx.fillRect(x + i * (m.w / 6), top, m.w / 6, m.h);
    }
    ctx.strokeStyle = "#241c17";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, top, m.w, m.h);
  }

  function drawHint(x, hint) {
    var y = hint === "jump" ? FEET - L.METRICS.hurdle.h - 36 : FEET - L.METRICS.banner.y - 28;
    ctx.fillStyle = "rgba(255,248,238,0.94)";
    roundRect(x - 8, y - 16, hint === "jump" ? 86 : 96, 28, 14);
    ctx.fill();
    ctx.strokeStyle = "#241c17";
    ctx.stroke();
    ctx.fillStyle = "#241c17";
    ctx.font = "700 14px 'Hiragino Maru Gothic ProN', 'Hiragino Sans', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(hint === "jump" ? "ジャンプ" : "スライド", x, y);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPlayer(run) {
    var set = bank[run.id];
    var img = set && set.run;
    var target = RUN_H;
    if (set && run.state === "slide" && set.slide) {
      img = set.slide;
      target = set.slideH;
    } else if (set && run.state === "jump" && set.jump) {
      img = set.jump;
      target = set.jumpH;
    }
    var bob = run.state === "run" && run.phase !== "dead" ? Math.sin(run.t * 13) * 4 : 0;
    var foot = FEET - run.y - bob;
    var squash = run.squash > 0 ? 1 - Math.min(0.18, run.squash) : 1;
    ctx.fillStyle = "rgba(36, 28, 23, " + (0.22 * Math.max(0.25, 1 - run.y / 180)) + ")";
    ctx.beginPath();
    ctx.ellipse(PLAYER_X, FEET + 6, 28 + run.y * 0.02, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!img) return;
    var scale = target / img.height;
    var dw = img.width * scale;
    var dh = target * squash;
    ctx.save();
    ctx.translate(PLAYER_X, foot);
    if (run.phase === "dead") ctx.rotate(Math.min(0.7, run.deadT * 1.6));
    else if (run.state === "run") ctx.rotate(Math.sin(run.t * 13) * 0.04);
    ctx.drawImage(img, -dw / 2, -dh, dw, dh);
    ctx.restore();
    if (run.state === "run" && run.phase === "run") {
      var step = Math.sin(run.t * 13);
      if (step > 0 && lastStep <= 0) {
        dusts.push({ x: run.dist - 10, life: 0.35, vx: -30 });
      }
      lastStep = step;
    }
    if (params.get("box")) {
      var box = L.playerRect(run);
      ctx.strokeStyle = "rgba(210, 59, 50, 0.9)";
      ctx.strokeRect(box.x - (run.dist - PLAYER_X), FEET - (box.y + box.h), box.w, box.h);
    }
  }

  function drawDust(camX) {
    dusts.forEach(function (d) {
      d.life -= 0.016;
      d.x += d.vx * 0.016;
      var x = d.x - camX;
      ctx.globalAlpha = Math.max(0, d.life / 0.35);
      ctx.fillStyle = "#e7dcc8";
      ctx.beginPath();
      ctx.arc(x, FEET - 4, 5 + (0.35 - d.life) * 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    dusts = dusts.filter(function (d) { return d.life > 0; });
  }

  function drawPops(run, camX) {
    ctx.font = "800 18px 'Hiragino Maru Gothic ProN', 'Hiragino Sans', sans-serif";
    ctx.textAlign = "center";
    pops.forEach(function (p) {
      p.life -= 0.016;
      p.lift += 18 * 0.016;
      ctx.globalAlpha = Math.max(0, p.life / 0.75);
      ctx.fillStyle = "#241c17";
      ctx.fillText("+100", p.x - camX, FEET - p.lift);
      ctx.globalAlpha = 1;
    });
    pops = pops.filter(function (p) { return p.life > 0; });
    if (run.phase === "countdown" && run.countdown > 0) {
      var cue = run.countdown > 1.05 ? "位置について" : run.countdown > 0.45 ? "よーい" : "ドン";
      ctx.fillStyle = "rgba(255,248,238,0.94)";
      roundRect(70, 250, 400, 88, 18);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#241c17";
      ctx.stroke();
      ctx.fillStyle = "#241c17";
      ctx.font = "800 40px 'Hiragino Maru Gothic ProN', 'Hiragino Sans', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(cue, W / 2, 294);
    }
  }

  function paintHud(run) {
    if (yenShown !== run.yen) {
      yenEl.classList.add("pop");
      yenShown = run.yen;
      window.setTimeout(function () { yenEl.classList.remove("pop"); }, 120);
    }
    yenEl.textContent = yenText(run.yen);
    distEl.textContent = distText(run.dist);
    clockEl.textContent = clockText(run.phase === "countdown" ? 0 : run.t);
    var teach = mode === "run" && run.phase === "run" && (jumps === 0 || slides === 0) && run.t < 12;
    coach.hidden = !teach;
  }

  boot().then(function () { requestAnimationFrame(loop); });
})();
