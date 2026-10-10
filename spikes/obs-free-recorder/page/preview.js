// Preview page. Draws the final composite from the two low-res preview feeds
// with the same layouts.json the export would use, and emits the sync markers
// (white flash + 1 kHz beep on wall-clock boundaries). It measures preview
// delay on both paths, at the moment it has decoded a preview frame:
//  - screen path: its own on-screen ms clock, read back out of the screen feed;
//  - camera path: the time from a flash (drawn at wall time W) until the camera
//    feed brightens, so camera capture, the 4K → CUDA → MJPEG branch and the
//    transport are all in it. The camera must see the flash (the DELL, or the
//    light on your face).
// Neither includes this page's composite or the display's scan-out, so neither
// is full glass-to-glass.
//
// Keys: 1 Camera · 2 Code · 3 No Face · M marker · F flash now · C clap
//       T end of take (saves the ghost frame) · G ghost overlay · Q stop
//
// Baseline mode (?baseline=1): the composite is OBS Virtual Camera instead.

const BITS = 24;
const MOD = 2 ** BITS;
const CELLS = BITS + 2; // [white, black] start marker + 24 data bits
const CELL = 24; // physical pixels per cell on the captured monitor

const params = new URLSearchParams(location.search);
const baseline = params.has("baseline");
const config = await (await fetch("/config")).json();
const layouts = config.layouts;
const $ = (id) => document.getElementById(id);
const composite = $("composite").getContext("2d");
composite.imageSmoothingQuality = "high";

const state = {
  scene: "Code",
  ghost: false,
  ghostImg: null,
  feeds: { screen: null, camera: null },
  fps: { screen: 0, camera: 0 },
  counts: { screen: 0, camera: 0 },
  latency: [],
  latencyBatch: [],
  markers: 0,
  nextFlash: Infinity,
  beepScheduledFor: 0,
  flashUntil: 0,
  audio: null,
};

const post = (ev) =>
  fetch("/event", {
    method: "POST",
    body: JSON.stringify({ wallMs: Date.now(), ...ev }),
  }).catch(() => {});

// ---------- on-screen ms clock, encoded as a strip of black/white cells ----------
const strip = $("strip");
const dpr = devicePixelRatio;
strip.width = CELLS * CELL;
strip.height = CELL;
strip.style.width = `${(CELLS * CELL) / dpr}px`;
strip.style.height = `${CELL / dpr}px`;
const stripCtx = strip.getContext("2d");
function drawStrip(value) {
  for (let i = 0; i < CELLS; i++) {
    const bit = i === 0 ? 1 : i === 1 ? 0 : (value >> (BITS - 1 - (i - 2))) & 1;
    stripCtx.fillStyle = bit ? "#fff" : "#000";
    stripCtx.fillRect(i * CELL, 0, CELL, CELL);
  }
}

// Reads the strip back out of a captured frame. `scale` maps physical screen px to frame px.
const probe = new OffscreenCanvas(CELLS * CELL, CELL);
const probeCtx = probe.getContext("2d", { willReadFrequently: true });
function decodeStrip(source, scale) {
  const w = Math.max(CELLS, Math.round(CELLS * CELL * scale));
  const h = Math.max(1, Math.round(CELL * scale));
  probeCtx.drawImage(source, 0, 0, w, h, 0, 0, w, h);
  const px = probeCtx.getImageData(0, 0, w, h).data;
  const lum = (i) => {
    const x = Math.floor((i + 0.5) * (w / CELLS));
    const o = (Math.floor(h / 2) * w + x) * 4;
    return 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
  };
  if (lum(0) < 160 || lum(1) > 96) return null; // start marker missing: flash, or wrong monitor
  let v = 0;
  for (let i = 0; i < BITS; i++) v = (v << 1) | (lum(i + 2) > 128 ? 1 : 0);
  return v >>> 0;
}
function recordLatency(decoded) {
  if (decoded === null) return;
  const lat = ((((Date.now() % MOD) - decoded) % MOD) + MOD) % MOD;
  if (lat > 5000) return;
  state.latency.push(lat);
  state.latencyBatch.push(lat);
  if (state.latency.length > 300) state.latency.shift();
}

// Camera path: mean luma of the camera picture; the first frame after a flash
// that rises well above the running level gives one delay sample per flash.
const lumaProbe = new OffscreenCanvas(16, 9);
const lumaCtx = lumaProbe.getContext("2d", { willReadFrequently: true });
function meanLuma(source, sx, sy, sw, sh) {
  lumaCtx.drawImage(source, sx, sy, sw, sh, 0, 0, 16, 9);
  const px = lumaCtx.getImageData(0, 0, 16, 9).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4)
    sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  return sum / (px.length / 4);
}
const cam = { level: null, measuredFlash: 0, batch: [], samples: [] };
function lastFlashWall(now) {
  if (config.syntheticPeriodMs)
    return (
      Math.floor(now / config.syntheticPeriodMs) * config.syntheticPeriodMs
    );
  return state.lastFlashWall ?? 0;
}
function cameraFrame(luma) {
  const now = Date.now();
  const W = lastFlashWall(now);
  const since = now - W;
  if (cam.level === null) cam.level = luma;
  if (since > 1500 || W === cam.measuredFlash) {
    // Outside a flash: track the room's level slowly.
    if (since > 1500) cam.level += 0.1 * (luma - cam.level);
    return;
  }
  if (luma - cam.level > Math.max(10, 0.25 * cam.level)) {
    cam.measuredFlash = W;
    cam.batch.push(since);
    cam.samples.push(since);
    if (cam.samples.length > 50) cam.samples.shift();
  }
}

setInterval(() => {
  if (state.latencyBatch.length) {
    post({
      type: "latency",
      source: baseline ? "obs-virtual-camera" : "rig-screen-feed",
      samples: state.latencyBatch,
    });
    state.latencyBatch = [];
  }
  if (cam.batch.length) {
    post({
      type: "latency",
      source: baseline ? "obs-virtual-camera camera-feed" : "rig-camera-feed",
      samples: cam.batch,
    });
    cam.batch = [];
  }
}, 5000);

// ---------- preview feeds (length-prefixed JPEGs over a streaming fetch) ----------
async function readFeed(name) {
  for (;;) {
    try {
      const res = await fetch(`/feed/${name}`);
      const reader = res.body.getReader();
      let buf = new Uint8Array(0);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const merged = new Uint8Array(buf.length + value.length);
        merged.set(buf);
        merged.set(value, buf.length);
        buf = merged;
        while (buf.length >= 4) {
          const len = new DataView(buf.buffer, buf.byteOffset).getUint32(0);
          if (buf.length < 4 + len) break;
          const jpeg = buf.slice(4, 4 + len);
          buf = buf.slice(4 + len);
          const bmp = await createImageBitmap(
            new Blob([jpeg], { type: "image/jpeg" })
          );
          state.feeds[name]?.close();
          state.feeds[name] = bmp;
          state.counts[name]++;
          if (name === "screen")
            recordLatency(decodeStrip(bmp, bmp.width / (screen.width * dpr)));
          else cameraFrame(meanLuma(bmp, 0, 0, bmp.width, bmp.height));
        }
      }
    } catch {
      /* server restarting: retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---------- baseline: today's OBS Virtual Camera preview ----------
async function openVirtualCam() {
  const probeStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });
  probeStream.getTracks().forEach((t) => t.stop());
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "videoinput"
  );
  const obs = cams.find((d) => /OBS Virtual Camera/i.test(d.label));
  if (!obs) throw new Error("OBS Virtual Camera not found. Start it in OBS.");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: obs.deviceId }, width: 1280 }, // what CVM opens today
    audio: false,
  });
  const video = $("vcam");
  video.srcObject = stream;
  await video.play();
  // The Code scene's face cam, in Virtual Camera pixels, for the camera path.
  const face = layouts.scenes.Code.find((i) => i.source === "camera").dest;
  const onFrame = () => {
    state.counts.screen++;
    const k = video.videoWidth / layouts.canvas.w;
    // Code / No Face scenes put the full screen at canvas (0,0) at scale 1.
    recordLatency(decodeStrip(video, k));
    cameraFrame(
      meanLuma(
        video,
        Math.max(0, face.x * k),
        Math.max(0, face.y * k),
        face.w * k,
        face.h * k
      )
    );
    video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
  state.feeds.vcam = video;
}

// ---------- sync markers ----------
function scheduleNextFlash(now) {
  const every = config.flashEveryMs;
  if (!every) return;
  state.nextFlash = Math.ceil((now + 1000) / every) * every;
}
function beepAt(wallMs) {
  const ctx = state.audio;
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 1000;
  gain.gain.value = 0.6;
  osc.connect(gain).connect(ctx.destination);
  const at = ctx.currentTime + Math.max(0, (wallMs - Date.now()) / 1000);
  osc.start(at);
  osc.stop(at + 0.25);
}
function flashNow(reason) {
  const now = Date.now();
  state.lastFlashWall = now;
  state.flashUntil = now + 250;
  $("flash").style.display = "block";
  post({ type: "flash", reason, wallMs: now });
  state.markers++;
}

// ---------- render loop ----------
function render() {
  const now = Date.now();
  drawStrip(now % MOD);
  $("clock").textContent = new Date(now).toISOString().slice(11, 23);

  // Beep is scheduled ahead on the audio clock; the flash goes up on the frame nearest the boundary.
  if (
    state.nextFlash - now < 400 &&
    state.beepScheduledFor !== state.nextFlash
  ) {
    state.beepScheduledFor = state.nextFlash;
    beepAt(state.nextFlash);
  }
  if (now + 8 >= state.nextFlash) {
    flashNow(state.nextFlash === state.firstFlash ? "start" : "scheduled");
    scheduleNextFlash(now);
  }
  if (state.flashUntil && now >= state.flashUntil) {
    state.flashUntil = 0;
    $("flash").style.display = "none";
  }

  const { w, h } = layouts.canvas;
  composite.globalAlpha = 1;
  composite.fillStyle = "#000";
  composite.fillRect(0, 0, w, h);
  if (baseline) {
    if (state.feeds.vcam) composite.drawImage(state.feeds.vcam, 0, 0, w, h);
  } else {
    for (const item of layouts.scenes[state.scene]) {
      const src = state.feeds[item.source];
      if (!src) continue;
      const { crop: c, dest: d } = item;
      composite.drawImage(
        src,
        c.x * src.width,
        c.y * src.height,
        c.w * src.width,
        c.h * src.height,
        d.x,
        d.y,
        d.w,
        d.h
      );
    }
  }
  if (state.ghost && state.ghostImg) {
    composite.globalAlpha = 0.4;
    composite.drawImage(state.ghostImg, 0, 0, w, h);
  }
  requestAnimationFrame(render);
}

setInterval(() => {
  for (const k of ["screen", "camera"]) {
    state.fps[k] = state.counts[k];
    state.counts[k] = 0;
  }
  const s = [...state.latency].sort((a, b) => a - b);
  const q = (p) =>
    s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : "–";
  $("scene").textContent = baseline
    ? "BASELINE: OBS Virtual Camera (use OBS scene Code)"
    : `Scene: ${state.scene}`;
  $("hud").textContent = [
    `mode ${config.mode}${baseline ? " (baseline)" : ""}   file time ${((Date.now() - config.t0Ms) / 1000).toFixed(1)} s`,
    `feeds: screen ${state.fps.screen} fps, camera ${state.fps.camera} fps`,
    `preview delay, screen path (clock → decoded here): p50 ${q(0.5)} ms, p95 ${q(0.95)} ms (n=${s.length})`,
    `preview delay, camera path (flash → decoded here): ${cam.samples.length ? `p50 ${[...cam.samples].sort((a, b) => a - b)[Math.floor(cam.samples.length / 2)]} ms (n=${cam.samples.length})` : "– (camera hasn't seen a flash yet)"}`,
    s.length === 0
      ? "! no clock decoded: is this page fullscreen on the captured monitor (try --screen)?"
      : "",
    `markers ${state.markers}, next flash in ${Number.isFinite(state.nextFlash) ? Math.round((state.nextFlash - Date.now()) / 1000) + " s" : "–"}`,
    `ghost ${state.ghost ? "ON" : "off"}${state.ghostImg ? "" : " (no previous take yet)"}`,
    "",
    "1 Camera  2 Code  3 No Face",
    "M marker  F flash+beep now  C clap",
    "T end take (saves ghost)  G ghost  Q stop",
  ].join("\n");
}, 1000);

async function loadGhost() {
  const res = await fetch("/ghost");
  if (!res.ok) return;
  state.ghostImg = await createImageBitmap(await res.blob());
}

function setScene(scene) {
  state.scene = scene;
  post({ type: "scene", scene });
}

addEventListener("keydown", async (e) => {
  const key = e.key.toLowerCase();
  if (layouts.keys[key] && !baseline) return setScene(layouts.keys[key]);
  if (key === "m") {
    state.markers++;
    return post({ type: "marker" });
  }
  if (key === "c") return post({ type: "clap" });
  if (key === "f") {
    beepAt(Date.now());
    return flashNow("manual");
  }
  if (key === "g") return (state.ghost = !state.ghost);
  if (key === "t") {
    const blob = await new Promise((r) =>
      $("composite").toBlob(r, "image/png")
    );
    await fetch("/ghost", { method: "POST", body: blob });
    post({ type: "take-end" });
    state.ghostImg = await createImageBitmap(blob);
    return;
  }
  if (key === "q" && confirm("Stop the recording?")) post({ type: "stop" });
});

$("start").addEventListener("click", async () => {
  $("start").remove();
  await document.documentElement.requestFullscreen().catch(() => {});
  state.audio = new AudioContext();
  await state.audio.resume();
  const now = Date.now();
  // First marker ~20 s in, then every flashEveryMs on the wall clock.
  if (config.flashEveryMs) {
    state.firstFlash = Math.ceil((now + 20000) / 1000) * 1000;
    state.nextFlash = state.firstFlash;
  }
  post({
    type: "page-start",
    screen: { w: screen.width, h: screen.height, dpr },
  });
});

if (baseline) openVirtualCam().catch((e) => alert(e.message));
else {
  readFeed("screen");
  readFeed("camera");
}
loadGhost();
requestAnimationFrame(render);
