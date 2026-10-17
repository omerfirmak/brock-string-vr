import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const STRING_LENGTH = 3.0;          // metres, nose to far end
const STRING_RADIUS = 0.0015;
const BEAD_RADIUS = 0.009;          // ~18 mm beads, like a real Brock string
// Where the string starts, relative to the point between your eyes (camera space).
const NOSE_OFFSET = new THREE.Vector3(0, -0.035, -0.025);
const STRING_PITCH = THREE.MathUtils.degToRad(-6); // string slopes down slightly
const MIN_DIST = 0.05;
const MAX_DIST = STRING_LENGTH - 0.05;

const BEAD_DEFS = [
  { name: 'RED', css: '#ff5a54', color: 0xe0302f, dist: 0.4, tone: 660 },
  { name: 'YELLOW', css: '#ffd23f', color: 0xf5c518, dist: 1.0, tone: 523 },
  { name: 'GREEN', css: '#4cd66f', color: 0x22b14c, dist: 2.0, tone: 392 },
];

const TRACK_RANGES = [
  { label: 'wide', near: 0.3, far: 2.0 },
  { label: 'close', near: 0.15, far: 1.2 },
  { label: 'near point', near: 0.07, far: 0.6 },
];

const NPC_START = 0.6;

const MODES = [
  {
    id: 'FREE', title: 'Free practice',
    desc: 'Fixate each bead. You should see two strings crossing exactly AT the bead, forming an X.',
    vr: 'Stick: move bead · Trigger: next bead · A/X: reset beads',
    kb: '↑↓: move bead · Space: next bead · R: reset beads',
  },
  {
    id: 'JUMPS', title: 'Bead jumps',
    desc: 'Jump your eyes to the bright bead when it changes. Re-form the X at each bead as fast as you can.',
    vr: 'Stick: interval · Trigger: pause · A/X: random/sequential',
    kb: '↑↓: interval · Space: pause · R: random/sequential',
  },
  {
    id: 'TRACK', title: 'Smooth tracking',
    desc: 'Follow the bead as it slides along the string. Keep the X on the bead the whole way.',
    vr: 'Stick: speed · Trigger: pause · A/X: change range',
    kb: '↑↓: speed · Space: pause · R: change range',
  },
  {
    id: 'NPC', title: 'Near point test',
    desc: 'The bead approaches your nose. Press when it doubles or the X falls apart.',
    vr: 'Trigger: start / mark break · Stick: speed · A/X: clear results',
    kb: 'Space: start / mark break · ↑↓: speed · R: clear results',
  },
];

// ---------------------------------------------------------------------------
// Persisted settings
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'brock-string-vr-v1';
const DEFAULTS = {
  dists: BEAD_DEFS.map((b) => b.dist),
  interval: 3,
  random: false,
  trackSpeed: 0.1,
  trackRange: 0,
  npcSpeed: 0.03,
  npcResults: [],
};

const clamp = THREE.MathUtils.clamp;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function loadSettings() {
  let raw = {};
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    raw = {};
  }
  const s = { ...DEFAULTS, dists: [...DEFAULTS.dists], npcResults: [] };
  if (Array.isArray(raw.dists) && raw.dists.length === 3 && raw.dists.every(isNum)) {
    s.dists = raw.dists.map((d) => clamp(d, MIN_DIST, MAX_DIST));
  }
  if (isNum(raw.interval)) s.interval = clamp(raw.interval, 1, 10);
  if (typeof raw.random === 'boolean') s.random = raw.random;
  if (isNum(raw.trackSpeed)) s.trackSpeed = clamp(raw.trackSpeed, 0.02, 0.5);
  if (Number.isInteger(raw.trackRange)) s.trackRange = clamp(raw.trackRange, 0, TRACK_RANGES.length - 1);
  if (isNum(raw.npcSpeed)) s.npcSpeed = clamp(raw.npcSpeed, 0.01, 0.1);
  if (Array.isArray(raw.npcResults)) {
    s.npcResults = raw.npcResults
      .filter((r) => r && isNum(r.cm) && isNum(r.t))
      .slice(-20);
  }
  return s;
}

const settings = loadSettings();
let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // storage unavailable (private mode etc.) - settings just won't persist
    }
  }, 400);
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

const state = {
  mode: 0,
  selected: 0,
  hud: true,
  jumps: { running: true, timer: 0, target: 0, count: 0 },
  track: { running: true, pos: TRACK_RANGES[settings.trackRange].far, dir: -1 },
  npc: { phase: 'idle', pos: NPC_START, last: null },
  sessionStart: performance.now(),
};

// ---------------------------------------------------------------------------
// Renderer, scene, environment
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
// Mild supersampling for the thin string; more risks dropped frames (and reprojection ghosting).
renderer.xr.setFramebufferScaleFactor(1.2);
renderer.xr.setFoveation(0);
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x30343b);
scene.fog = new THREE.Fog(0x30343b, 6, 20);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0, 1.6, 0);
scene.add(camera); // must be in the scene so head-locked children render

scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 3, 1);
scene.add(sun);

// Deliberately plain room: a busy background competes with fusion.
scene.add(new THREE.GridHelper(20, 20, 0x474c57, 0x3b3f47));
const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 6),
  new THREE.MeshStandardMaterial({ color: 0x393d45 }),
);
wall.position.set(0, 3, -5);
scene.add(wall);

// ---------------------------------------------------------------------------
// The Brock string: near end at your nose, far end tied to a fixed point in the
// room (like a doorknob). Keeping the far end world-locked matters in VR: the
// compositor's timewarp reprojects everything as if it were world-fixed, so
// fully head-locked content judders and ghosts when you move your head.
// ---------------------------------------------------------------------------

const STRING_COLOR = 0xdcdcdc; // not pure white: high contrast smears on LCD headsets
const Z_NEG = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const _headPos = new THREE.Vector3();
const _headQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _yaw = new THREE.Quaternion();
const _aim = new THREE.Quaternion();
const nosePos = new THREE.Vector3();
const stringDir = new THREE.Vector3(0, 0, -1);
const anchor = new THREE.Vector3(); // far end, world space
let stringLen = STRING_LENGTH;

// Unit-length string along -Z; scaled to the current nose→anchor length each frame.
const stringGeo = new THREE.CylinderGeometry(STRING_RADIUS, STRING_RADIUS, 1, 8, 1, true);
stringGeo.rotateX(Math.PI / 2);
stringGeo.translate(0, 0, -0.5);
const stringMesh = new THREE.Mesh(stringGeo, new THREE.MeshBasicMaterial({ color: STRING_COLOR }));
scene.add(stringMesh);

const knot = new THREE.Mesh(
  new THREE.SphereGeometry(STRING_RADIUS * 3, 8, 6),
  new THREE.MeshBasicMaterial({ color: STRING_COLOR }),
);
scene.add(knot);

function readHead() {
  camera.updateMatrixWorld();
  camera.getWorldPosition(_headPos);
  camera.getWorldQuaternion(_headQuat);
  _euler.setFromQuaternion(_headQuat, 'YXZ');
  _yaw.setFromAxisAngle(UP, _euler.y);
}

// Tie the far end STRING_LENGTH ahead of your nose, along your current gaze
// (ignoring head roll) tilted down slightly.
function placeString() {
  readHead();
  nosePos.copy(NOSE_OFFSET);
  camera.localToWorld(nosePos);
  _aim.setFromEuler(new THREE.Euler(_euler.x + STRING_PITCH, _euler.y, 0, 'YXZ'));
  anchor.copy(Z_NEG).applyQuaternion(_aim).multiplyScalar(STRING_LENGTH).add(nosePos);
}

function updateString() {
  nosePos.copy(NOSE_OFFSET);
  camera.localToWorld(nosePos);
  stringDir.subVectors(anchor, nosePos);
  stringLen = Math.max(stringDir.length(), 0.1);
  stringDir.divideScalar(stringLen);
  stringMesh.position.copy(nosePos);
  stringMesh.quaternion.setFromUnitVectors(Z_NEG, stringDir);
  stringMesh.scale.set(1, 1, stringLen);
  knot.position.copy(anchor);
}

const beadGeo = new THREE.SphereGeometry(BEAD_RADIUS, 32, 16);
const beads = BEAD_DEFS.map((def) => {
  const mat = new THREE.MeshStandardMaterial({
    color: def.color, emissive: def.color, emissiveIntensity: 0.3, roughness: 0.4,
  });
  const mesh = new THREE.Mesh(beadGeo, mat);
  scene.add(mesh);
  return { ...def, mesh, mat, base: new THREE.Color(def.color) };
});

const DIM_FACTOR = 0.3;
function setBead(i, dist, look) {
  const b = beads[i];
  b.mesh.visible = look !== 'hidden';
  if (!b.mesh.visible) return;
  // Bead distances are measured from the nose along the string.
  b.mesh.position.copy(nosePos).addScaledVector(stringDir, Math.min(dist, stringLen - 0.02));
  if (look === 'dim') {
    b.mat.color.copy(b.base).multiplyScalar(DIM_FACTOR);
    b.mat.emissiveIntensity = 0.04;
  } else {
    b.mat.color.copy(b.base);
    b.mat.emissiveIntensity = look === 'target' ? 0.75 : 0.3;
  }
}

// ---------------------------------------------------------------------------
// In-world info panel (world-locked; placed front-left of wherever you're facing)
// ---------------------------------------------------------------------------

// Layout is in 1024x560 units, drawn at HUD_RES x resolution so text stays sharp.
const HUD_W = 1024;
const HUD_H = 560;
const HUD_RES = 2;
const hudCanvas = document.createElement('canvas');
hudCanvas.width = HUD_W * HUD_RES;
hudCanvas.height = HUD_H * HUD_RES;
const hudCtx = hudCanvas.getContext('2d');
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
hudTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const hud = new THREE.Mesh(
  new THREE.PlaneGeometry(0.7, 0.7 * (HUD_H / HUD_W)),
  new THREE.MeshBasicMaterial({ map: hudTex, transparent: true }),
);
scene.add(hud);

// Panel position relative to your head, using only head yaw so it stays level.
const HUD_OFFSET = new THREE.Vector3(-0.55, -0.1, -1.2);

function placeHud() {
  readHead();
  hud.position.copy(HUD_OFFSET).applyQuaternion(_yaw).add(_headPos);
  hud.lookAt(_headPos); // +Z of the plane faces you
}

// Re-tie the string and bring the panel in front of you.
function recenter() {
  placeString();
  placeHud();
}
recenter();
let needsRecenter = false;

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const cm = (m) => `${Math.round(m * 100)} cm`;

function statusLines() {
  const mode = MODES[state.mode].id;
  if (mode === 'FREE') {
    const b = beads[state.selected];
    return [
      { text: `Selected: ${b.name}  at ${cm(settings.dists[state.selected])}`, color: b.css },
      { text: beads.map((x, i) => `${x.name[0]} ${cm(settings.dists[i])}`).join('   ') },
    ];
  }
  if (mode === 'JUMPS') {
    const b = beads[state.jumps.target];
    return [
      { text: `Look at: ${b.name}`, color: b.css },
      {
        text: `Every ${settings.interval.toFixed(1)} s · ${settings.random ? 'random' : 'sequential'} · `
          + `${state.jumps.count} jumps${state.jumps.running ? '' : ' · PAUSED'}`,
      },
    ];
  }
  if (mode === 'TRACK') {
    const r = TRACK_RANGES[settings.trackRange];
    return [
      { text: `Bead at ${cm(state.track.pos)}${state.track.running ? '' : ' · PAUSED'}`, color: beads[0].css },
      { text: `Speed ${cm(settings.trackSpeed)}/s · range ${r.label} (${cm(r.near)}–${cm(r.far)})` },
    ];
  }
  // NPC
  const results = settings.npcResults;
  const best = results.length ? Math.min(...results.map((r) => r.cm)) : null;
  const recent = results.slice(-5).map((r) => r.cm).join(', ');
  let first;
  if (state.npc.phase === 'idle') first = 'Fixate the red bead, then press to start';
  else if (state.npc.phase === 'running') first = `Approaching… ${cm(state.npc.pos)}`;
  else first = state.npc.last.reachedNose
    ? `Held fusion all the way to ${state.npc.last.cm} cm - press to retry`
    : `Broke at ${state.npc.last.cm} cm - press to retry`;
  return [
    { text: first, color: beads[0].css },
    { text: `Speed ${cm(settings.npcSpeed)}/s · best ${best ?? '–'} cm · recent: ${recent || '–'}` },
  ];
}

let hudSignature = '';
function updateHud() {
  hud.visible = state.hud;
  if (!state.hud) return;

  const mode = MODES[state.mode];
  const elapsed = formatTime((performance.now() - state.sessionStart) / 1000);
  const controls = renderer.xr.isPresenting
    ? `${mode.vr} · B/Y: next mode · Grip: recenter · Stick click: hide panel`
    : `${mode.kb} · M: next mode · H: hide`;
  const status = statusLines();

  const sig = JSON.stringify([state.mode, elapsed, controls, status]);
  if (sig === hudSignature) return;
  hudSignature = sig;

  const ctx = hudCtx;
  const W = HUD_W;
  const H = HUD_H;
  const pad = 36;
  ctx.setTransform(HUD_RES, 0, 0, HUD_RES, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(12, 14, 19, 0.88)';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 28);
  ctx.fill();

  ctx.textBaseline = 'top';
  let y = pad;

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 46px system-ui, sans-serif';
  ctx.fillText(`${state.mode + 1}/${MODES.length}  ${mode.title}`, pad, y);
  ctx.font = '32px system-ui, sans-serif';
  ctx.fillStyle = '#8b93a3';
  const tw = ctx.measureText(elapsed).width;
  ctx.fillText(elapsed, W - pad - tw, y + 10);
  y += 68;

  ctx.font = '32px system-ui, sans-serif';
  ctx.fillStyle = '#c9ced8';
  for (const line of wrapLines(ctx, mode.desc, W - pad * 2)) {
    ctx.fillText(line, pad, y);
    y += 42;
  }
  y += 18;

  for (const s of status) {
    ctx.font = s.color ? 'bold 38px system-ui, sans-serif' : '30px system-ui, sans-serif';
    ctx.fillStyle = s.color ?? '#e5e8ee';
    ctx.fillText(s.text, pad, y);
    y += s.color ? 52 : 42;
  }

  ctx.font = '26px system-ui, sans-serif';
  ctx.fillStyle = '#7d8595';
  const ctrlLines = wrapLines(ctx, controls, W - pad * 2);
  let cy = H - pad - ctrlLines.length * 34;
  for (const line of ctrlLines) {
    ctx.fillText(line, pad, cy);
    cy += 34;
  }

  hudTex.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Audio cues
// ---------------------------------------------------------------------------

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function beep(freq, dur = 0.12) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// ---------------------------------------------------------------------------
// Mode logic
// ---------------------------------------------------------------------------

function setMode(i) {
  state.mode = (i + MODES.length) % MODES.length;
  state.jumps.timer = 0;
  state.jumps.running = true;
  state.track.pos = TRACK_RANGES[settings.trackRange].far;
  state.track.dir = -1;
  state.track.running = true;
  state.npc.phase = 'idle';
  state.npc.pos = NPC_START;
  beep(440, 0.08);
}

function advanceJumpTarget() {
  const j = state.jumps;
  if (settings.random) {
    let next;
    do next = Math.floor(Math.random() * beads.length); while (next === j.target);
    j.target = next;
  } else {
    j.target = (j.target + 1) % beads.length;
  }
  j.count++;
  beep(beads[j.target].tone);
}

function recordNpc(dist, reachedNose) {
  const result = { cm: Math.round(dist * 100), t: Date.now() };
  settings.npcResults.push(result);
  if (settings.npcResults.length > 20) settings.npcResults.shift();
  state.npc.last = { ...result, reachedNose };
  state.npc.phase = 'result';
  saveSettings();
  beep(330, 0.25);
}

// Primary action: trigger / Space / pinch
function onAction() {
  const mode = MODES[state.mode].id;
  if (mode === 'FREE') {
    state.selected = (state.selected + 1) % beads.length;
    beep(beads[state.selected].tone, 0.08);
  } else if (mode === 'JUMPS') {
    state.jumps.running = !state.jumps.running;
  } else if (mode === 'TRACK') {
    state.track.running = !state.track.running;
  } else if (mode === 'NPC') {
    if (state.npc.phase === 'running') {
      recordNpc(state.npc.pos, false);
    } else {
      state.npc.phase = 'running';
      state.npc.pos = NPC_START;
      beep(523, 0.08);
    }
  }
}

// Secondary action: A/X button / R key
function onSecondary() {
  const mode = MODES[state.mode].id;
  if (mode === 'FREE') {
    settings.dists = BEAD_DEFS.map((b) => b.dist);
  } else if (mode === 'JUMPS') {
    settings.random = !settings.random;
  } else if (mode === 'TRACK') {
    settings.trackRange = (settings.trackRange + 1) % TRACK_RANGES.length;
    state.track.pos = clamp(
      state.track.pos, TRACK_RANGES[settings.trackRange].near, TRACK_RANGES[settings.trackRange].far,
    );
  } else if (mode === 'NPC') {
    settings.npcResults = [];
    state.npc.phase = 'idle';
    state.npc.pos = NPC_START;
  }
  saveSettings();
  beep(392, 0.08);
}

// Continuous adjustment: thumbstick / arrow keys. `amount` is roughly ±dt.
function onAdjust(amount) {
  const mode = MODES[state.mode].id;
  if (mode === 'FREE') {
    const i = state.selected;
    const d = settings.dists[i];
    // Finer control close to the face, faster far away.
    settings.dists[i] = clamp(d + amount * (0.1 + d * 0.5), MIN_DIST, MAX_DIST);
  } else if (mode === 'JUMPS') {
    settings.interval = clamp(settings.interval + amount * 2, 1, 10);
  } else if (mode === 'TRACK') {
    settings.trackSpeed = clamp(settings.trackSpeed + amount * 0.1, 0.02, 0.5);
  } else if (mode === 'NPC') {
    settings.npcSpeed = clamp(settings.npcSpeed + amount * 0.03, 0.01, 0.1);
  }
  saveSettings();
}

function update(dt) {
  const mode = MODES[state.mode].id;

  if (mode === 'FREE') {
    beads.forEach((_, i) => setBead(i, settings.dists[i], i === state.selected ? 'target' : 'normal'));
  } else if (mode === 'JUMPS') {
    const j = state.jumps;
    if (j.running) {
      j.timer += dt;
      if (j.timer >= settings.interval) {
        j.timer = 0;
        advanceJumpTarget();
      }
    }
    beads.forEach((_, i) => setBead(i, settings.dists[i], i === j.target ? 'target' : 'dim'));
  } else if (mode === 'TRACK') {
    const t = state.track;
    const r = TRACK_RANGES[settings.trackRange];
    if (t.running) {
      t.pos += t.dir * settings.trackSpeed * dt;
      if (t.pos <= r.near) { t.pos = r.near; t.dir = 1; }
      if (t.pos >= r.far) { t.pos = r.far; t.dir = -1; }
    }
    setBead(0, t.pos, 'target');
    setBead(1, 0, 'hidden');
    setBead(2, 0, 'hidden');
  } else if (mode === 'NPC') {
    const n = state.npc;
    if (n.phase === 'running') {
      n.pos -= settings.npcSpeed * dt;
      if (n.pos <= MIN_DIST) {
        n.pos = MIN_DIST;
        recordNpc(n.pos, true);
      }
    }
    setBead(0, n.pos, 'target');
    setBead(1, 0, 'hidden');
    setBead(2, 0, 'hidden');
  }

  updateHud();
}

// ---------------------------------------------------------------------------
// Input: XR controllers
// ---------------------------------------------------------------------------

const prevButtons = new Map();
const STICK_DEADZONE = 0.2;

function pollGamepads(dt) {
  const session = renderer.xr.getSession();
  if (!session) return;
  for (const src of session.inputSources) {
    if (src.hand || !src.gamepad) continue; // hands are handled via 'select'
    const gp = src.gamepad;
    const key = src.handedness;
    const prev = prevButtons.get(key) ?? [];
    const pressed = gp.buttons.map((b) => b.pressed);
    const edge = (i) => pressed[i] && !prev[i];

    // xr-standard mapping: 0 trigger, 1 grip, 3 stick click, 4 A/X, 5 B/Y
    if (edge(0)) onAction();
    if (edge(1)) { state.hud = true; needsRecenter = true; }
    if (edge(3)) state.hud = !state.hud;
    if (edge(4)) onSecondary();
    if (edge(5)) setMode(state.mode + 1);
    prevButtons.set(key, pressed);

    const y = gp.axes.length >= 4 ? gp.axes[3] : (gp.axes[1] ?? 0);
    if (Math.abs(y) > STICK_DEADZONE) onAdjust(-y * dt); // push forward = farther / more
  }
}

renderer.xr.addEventListener('sessionstart', () => {
  ensureAudio();
  prevButtons.clear();
  document.getElementById('help').style.display = 'none';
  hudSignature = '';
  needsRecenter = true;
  renderer.xr.getSession().addEventListener('select', (e) => {
    if (e.inputSource.hand) onAction(); // pinch with hand tracking
  });
});

renderer.xr.addEventListener('sessionend', () => {
  document.getElementById('help').style.display = '';
  hudSignature = '';
  // Restore the desktop preview viewpoint (XR overwrote the camera pose).
  camera.position.set(0, 1.6, 0);
  camera.quaternion.identity();
  recenter();
});

// ---------------------------------------------------------------------------
// Input: keyboard (desktop preview)
// ---------------------------------------------------------------------------

const heldKeys = new Set();
window.addEventListener('keydown', (e) => {
  ensureAudio();
  if (e.repeat) return;
  switch (e.code) {
    case 'Space': onAction(); e.preventDefault(); break;
    case 'KeyR': onSecondary(); break;
    case 'KeyM': setMode(state.mode + 1); break;
    case 'KeyH': state.hud = !state.hud; break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
      setMode(Number(e.code.slice(-1)) - 1);
      break;
    case 'ArrowUp': case 'ArrowDown':
      heldKeys.add(e.code);
      e.preventDefault();
      break;
    default:
  }
});
window.addEventListener('keyup', (e) => heldKeys.delete(e.code));
window.addEventListener('blur', () => heldKeys.clear());
window.addEventListener('pointerdown', ensureAudio);

function pollKeyboard(dt) {
  if (heldKeys.has('ArrowUp')) onAdjust(dt);
  if (heldKeys.has('ArrowDown')) onAdjust(-dt);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let xrFrames = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (renderer.xr.isPresenting) {
    // Pull this frame's head pose into `camera` now (render() would otherwise do
    // it later), so the nose end of the string doesn't lag a frame behind.
    renderer.xr.updateCamera(camera);
    xrFrames++;
    // Skip the first few frames, before tracking has delivered a real pose.
    if (needsRecenter && xrFrames > 3) {
      recenter();
      needsRecenter = false;
    }
  } else {
    xrFrames = 0;
  }
  pollGamepads(dt);
  pollKeyboard(dt);
  updateString();
  update(dt);
  renderer.render(scene, camera);
});
