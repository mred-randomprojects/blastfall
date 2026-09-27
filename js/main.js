import { createRound, step, TICK_HZ, NO_INPUT, makeRng, CHARACTERS, CHARACTER_IDS } from "./sim.js";
import { createBot, botInput } from "./bot.js";
import { createRenderer, CHAR_COLORS, colorsFor } from "./render.js";
import { keyboardInput, consumePress, clearPresses, connectedPads, padInput, padStartPressed, mergeInputs, simulatePress } from "./input.js";
import { initTouchControls, isTouchDevice, touchInput, setTouchControlsVisible, setSpecialInfo, isIOS, isStandalone, goFullscreen } from "./touch.js";
import * as sfx from "./audio.js";
import { loadPolicy } from "./ai/policy.js";
import { createAgent, agentStep } from "./ai/agent.js";

// Trained model the "vs AI" modes use: models/<run>/latest.json (override with ?run=name&gen=gen_0100)
const params = new URLSearchParams(location.search);
const AI_RUN = params.get("run") ?? "v1";
const AI_FILE = params.get("gen") ?? "latest";
let aiPolicy = null;
let aiInfo = "loading…";
async function loadAi() {
  try {
    const res = await fetch(`models/${AI_RUN}/${AI_FILE}.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    aiPolicy = loadPolicy(await res.json());
    aiInfo = `${AI_RUN} · iter ${aiPolicy.meta.iter} · ${(aiPolicy.meta.decisions / 1e6).toFixed(1)}M decisions`;
  } catch {
    aiPolicy = null;
    aiInfo = `no model at models/${AI_RUN}/${AI_FILE}.json yet`;
  }
  if (phase === "title" || phase === "matchEnd") showOverlay(phase);
}
loadAi();

const LEVELS = ["easy", "normal", "hard"];
const WINS_NEEDED = 5;
const COUNTDOWN_TICKS = 50;
const ROUND_END_TICKS = 100;
const HITSTOP_TICKS = 3;

const BLURBS = {
  volt: "Burst in your aim direction. Invulnerable while dashing — go straight through blasts.",
  aegis: "A bubble for ¾ s: enemy missiles bounce straight back at the shooter, blasts are blocked. Can't fire while it's up.",
  ember: "A heavy shell with double blast radius. Slower, and the recoil kicks you backwards.",
};

const canvas = document.getElementById("game");
const overlayEl = document.getElementById("overlay");
const renderer = createRenderer(canvas);
const TOUCH = isTouchDevice();
if (TOUCH) document.body.classList.add("touch");

let level = "normal";
let mode = null; // "cpu" | "2p" | "watch" | "ai" | "aiwatch"
let phase = "title"; // title | select | countdown | playing | roundEnd | matchEnd | paused
let pausedFrom = null;
let state = createRound(1);
let chars = ["volt", "ember"];
let picks = [0, 2]; // cursor on the select screen, per player
let locked = [false, false];
let score = [0, 0];
let round = 0;
let seed = (Date.now() & 0xffff) + 1;
let bots = [null, null];
let agents = [null, null];
let lastEvents = [];
let phaseTimer = 0;
let hitstop = 0;
let names = ["P1", "P2"];
const padPrev = new Map();

showOverlay("title");

/* ---------- flow ---------- */

function chooseMode(m) {
  mode = m;
  clearPresses();
  if (m === "ai" || m === "aiwatch") loadAi(); // pick up the newest weights
  if (m === "watch" || m === "aiwatch") {
    const rng = makeRng(seed * 13);
    chars = [CHARACTER_IDS[Math.floor(rng() * 3)], CHARACTER_IDS[Math.floor(rng() * 3)]];
    startMatch();
    return;
  }
  phase = "select";
  locked = [false, false];
  picks = [0, m === "2p" ? 2 : 0];
  for (const pad of connectedPads()) padPrev.set(pad.index, padSnapshot(pad));
  showOverlay("select");
}

function startMatch() {
  score = [0, 0];
  round = 0;
  const who = { cpu: ["You", "CPU"], "2p": ["P1", "P2"], watch: ["CPU A", "CPU B"], ai: ["You", "AI"], aiwatch: ["AI A", "AI B"] }[mode];
  names = who.map((w, i) => `${w} · ${CHARACTERS[chars[i]].name}`);
  hideOverlay();
  startRound();
}

function startRound() {
  round += 1;
  state = createRound(seed++, chars);
  bots = [
    mode === "watch" ? createBot(0, makeRng(seed * 3 + 1), level) : null,
    mode === "cpu" || mode === "watch" ? createBot(1, makeRng(seed * 3 + 2), level) : null,
  ];
  agents = [
    mode === "aiwatch" && aiPolicy ? createAgent(0, aiPolicy, makeRng(seed * 5 + 1)) : null,
    (mode === "ai" || mode === "aiwatch") && aiPolicy ? createAgent(1, aiPolicy, makeRng(seed * 5 + 2)) : null,
  ];
  lastEvents = [];
  phase = "countdown";
  phaseTimer = COUNTDOWN_TICKS;
  sfx.playRoundStart();
}

/* ---------- character select ---------- */

function padSnapshot(pad) {
  const i = padInput(pad);
  return { left: i.left, right: i.right, confirm: i.jump || Boolean(pad.buttons[9]?.pressed), back: Boolean(pad.buttons[1]?.pressed) };
}

function padEdges(pad) {
  const now = padSnapshot(pad);
  const prev = padPrev.get(pad.index) ?? now;
  padPrev.set(pad.index, now);
  return { left: now.left && !prev.left, right: now.right && !prev.right, confirm: now.confirm && !prev.confirm, back: now.back && !prev.back };
}

function selectTick() {
  const pads = connectedPads();
  const edges = pads.map(padEdges);
  const kb = {
    left: consumePress("ArrowLeft") || consumePress("KeyA"),
    right: consumePress("ArrowRight") || consumePress("KeyD"),
    confirm: consumePress("Enter") || consumePress("KeyZ") || consumePress("KeyX") || consumePress("Space") || consumePress("KeyJ") || consumePress("KeyK"),
    back: consumePress("Backspace"),
  };
  // who controls which cursor (same mapping as in-game)
  const controls = [[kb], []];
  if (mode === "cpu" || mode === "ai") {
    if (edges[0]) controls[0].push(edges[0]);
  } else {
    if (edges.length >= 1) controls[1].push(edges[edges.length - 1]);
    if (edges.length >= 2) controls[0].push(edges[0]);
  }

  let changed = false;
  for (const i of [0, 1]) {
    for (const c of controls[i]) {
      if (c.back && locked[i]) {
        locked[i] = false;
        changed = true;
      }
      if (locked[i]) continue;
      if (c.left) picks[i] = (picks[i] + 2) % 3;
      if (c.right) picks[i] = (picks[i] + 1) % 3;
      if (c.confirm) {
        locked[i] = true;
        sfx.playPickup();
      } else if (c.left || c.right) sfx.playJump();
      changed ||= c.left || c.right || c.confirm;
    }
  }
  if ((mode === "cpu" || mode === "ai") && locked[0] && !locked[1]) {
    picks[1] = Math.floor(makeRng(seed * 17)() * 3);
    locked[1] = true;
  }
  if (locked[0] && locked[1]) {
    chars = [CHARACTER_IDS[picks[0]], CHARACTER_IDS[picks[1]]];
    startMatch();
    return;
  }
  if (changed) showOverlay("select");
}

/* ---------- per tick ---------- */

function gatherInputs() {
  const pads = connectedPads();
  const kb = mergeInputs(keyboardInput(), touchInput());
  const inputs = [NO_INPUT, NO_INPUT];
  if (mode === "cpu" || mode === "ai") {
    inputs[0] = mergeInputs(kb, pads[0] ? padInput(pads[0]) : null);
  } else if (mode === "2p") {
    // keyboard is always P1; the last pad is P2; with 2+ pads the first also drives P1
    const p2 = pads.length >= 1 ? padInput(pads[pads.length - 1]) : NO_INPUT;
    const p1pad = pads.length >= 2 ? padInput(pads[0]) : null;
    inputs[0] = mergeInputs(kb, p1pad);
    inputs[1] = p2;
  }
  for (const b of bots) if (b) inputs[b.id] = botInput(b, state, lastEvents);
  for (const a of agents) if (a) inputs[a.id] = agentStep(a, state, lastEvents).input;
  return inputs;
}

function tick() {
  if (consumePress("Escape")) {
    if (phase === "paused") {
      phase = pausedFrom;
      hideOverlay();
    } else if (phase === "select") {
      phase = "title";
      showOverlay("title");
      return;
    } else if (phase === "countdown" || phase === "playing" || phase === "roundEnd") {
      pausedFrom = phase;
      phase = "paused";
      showOverlay("paused");
    }
  }

  if (phase === "select") {
    selectTick();
    return;
  }

  if (phase === "title" || phase === "matchEnd" || phase === "paused") {
    if (phase === "paused") {
      if (consumePress("KeyQ")) {
        phase = "title";
        showOverlay("title");
      }
      return;
    }
    if (consumePress("Tab")) {
      level = LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length];
      showOverlay(phase);
      return;
    }
    if (consumePress("Digit1") || consumePress("Enter") || connectedPads().some(padStartPressed)) chooseMode("cpu");
    else if (consumePress("Digit2")) chooseMode("2p");
    else if (consumePress("Digit3")) chooseMode("watch");
    else if (consumePress("Digit4") && aiPolicy) chooseMode("ai");
    else if (consumePress("Digit5") && aiPolicy) chooseMode("aiwatch");
    return;
  }

  if (phase === "countdown") {
    phaseTimer -= 1;
    if (phaseTimer <= 0) phase = "playing";
    return;
  }

  if (hitstop > 0) {
    hitstop -= 1;
    return;
  }

  const events = step(state, gatherInputs());
  lastEvents = events;
  renderer.onEvents(events, state);
  playSounds(events);
  if (events.some((e) => e.type === "hit" && e.damage >= 10)) hitstop = HITSTOP_TICKS;

  if (phase === "playing" && state.over) {
    phase = "roundEnd";
    phaseTimer = ROUND_END_TICKS;
    if (state.winner >= 0) score[state.winner] += 1;
  } else if (phase === "roundEnd") {
    phaseTimer -= 1;
    if (phaseTimer <= 0) {
      if (score[0] >= WINS_NEEDED || score[1] >= WINS_NEEDED) {
        phase = "matchEnd";
        clearPresses();
        showOverlay("matchEnd");
      } else {
        startRound();
      }
    }
  }
}

function playSounds(events) {
  for (const e of events) {
    if (e.type === "fire") {
      if (e.heavy) sfx.playCannon();
      else sfx.playLaunch(state.players[e.player].stacks.speed);
    } else if (e.type === "explode") sfx.playExplosion(e.radius);
    else if (e.type === "hit") sfx.playHit();
    else if (e.type === "death") sfx.playDeath();
    else if (e.type === "jump" || e.type === "walljump") sfx.playJump();
    else if (e.type === "doublejump") sfx.playDoubleJump();
    else if (e.type === "dash") sfx.playDash();
    else if (e.type === "shield") sfx.playShield();
    else if (e.type === "reflect") sfx.playReflect();
    else if (e.type === "hang") sfx.playHang();
    else if (e.type === "dodge" || e.type === "block") sfx.playDodge();
    else if (e.type === "land") sfx.playLand();
    else if (e.type === "pickup") sfx.playPickup();
    else if (e.type === "pickupSpawn") sfx.playSpawn();
  }
}

/* ---------- overlays ---------- */

function solo() {
  return mode === "cpu" || mode === "ai";
}

function bannerFor() {
  if (phase === "countdown") return { banner: phaseTimer > COUNTDOWN_TICKS / 2 ? `ROUND ${round}` : "FIGHT!" };
  if (phase === "roundEnd") {
    if (state.winner === -1) return { banner: "DRAW" };
    return { banner: `${names[state.winner]} wins the round`, bannerColor: colorsFor(state, state.winner).body };
  }
  return {};
}

function MODE_MENU() {
  return `
  <div class="menu">
    <button data-key="Digit1"><kbd>1</kbd> You vs CPU</button>
    <button data-key="Digit4" ${aiPolicy ? "" : "disabled"}><kbd>4</kbd> You vs trained AI</button>
    <button data-key="Tab" class="small"><kbd>Tab</kbd> CPU level: <b>${level.toUpperCase()}</b></button>
    <button data-key="Digit5" class="small" ${aiPolicy ? "" : "disabled"}><kbd>5</kbd> Watch AI vs AI</button>
    <button data-key="Digit3" class="small"><kbd>3</kbd> Watch CPU vs CPU</button>
    <button data-key="Digit2" class="small"><kbd>2</kbd> Two players <span class="dim">(P2: gamepad)</span></button>
  </div>
  <div class="dim ai-info">AI: ${aiInfo}</div>
  ${fullscreenButton()}`;
}

function fullscreenButton() {
  if (!TOUCH || isStandalone()) return "";
  if (isIOS()) return `<div class="install-hint">Fullscreen on iPhone: Share ⎋ → <b>Add to Home Screen</b>, then open it from there</div>`;
  const can = document.documentElement.requestFullscreen && !document.fullscreenElement;
  return can ? `<button class="fs" data-act="fullscreen">⛶ Fullscreen</button>` : "";
}

function showOverlay(kind) {
  overlayEl.hidden = false;
  if (kind === "title") {
    const help = TOUCH
      ? `<div class="controls">
          <div><b>Left thumb</b> anywhere on the left half: move &amp; aim (8 directions)</div>
          <div><b>JUMP</b> double jump in the air, wall-jump, climb off ledges · <b>FIRE</b> hold to keep firing · <b>special</b> depends on your fighter</div>
        </div>`
      : `<div class="controls">
          <div><b>Move / aim</b> Arrows or WASD (hold a direction while firing; diagonals work)</div>
          <div><b>Jump</b> Z · Space · K &nbsp; <span class="dim">(double jump in the air, wall-jump, climb off ledges)</span></div>
          <div><b>Fire</b> X · J &nbsp; <span class="dim">(missiles fall once the motor burns out; aim down + fire to rocket-jump)</span></div>
          <div><b>Special</b> C · L · Shift &nbsp; <span class="dim">(depends on your character)</span></div>
          <div><b>Wall slide / ledge hang</b> hold toward a wall or ledge while falling; Down to let go · <b>Pause</b> Esc</div>
        </div>`;
    overlayEl.innerHTML = `
      <h1>BLASTFALL</h1>
      <p class="sub">missile duel</p>
      ${MODE_MENU()}
      ${help}`;
  } else if (kind === "select") {
    const cards = CHARACTER_IDS.map((id, i) => {
      const ch = CHARACTERS[id];
      const c = CHAR_COLORS[id];
      const tags = [0, 1]
        .filter((p) => picks[p] === i && !(solo() && p === 1))
        .map((p) => `<span class="tag ${locked[p] ? "locked" : ""}">${solo() ? "YOU" : `P${p + 1}`}${locked[p] ? " ✓" : ""}</span>`)
        .join("");
      const active = [0, 1].some((p) => picks[p] === i && !(solo() && p === 1));
      return `
        <button class="card ${active ? "active" : ""}" data-pick="${i}" style="--c:${c.body};--d:${c.dark}">
          <div class="tags">${tags}</div>
          <div class="swatch"></div>
          <div class="cname">${ch.name}</div>
          <div class="special">${ch.specialName} · ${(ch.cooldown / TICK_HZ).toFixed(0)}s</div>
          <div class="blurb">${BLURBS[id]}</div>
        </button>`;
    }).join("");
    const hint = TOUCH
      ? `Tap a fighter to pick it · <button class="link" data-key="Escape">back</button>`
      : `<kbd>←</kbd><kbd>→</kbd> choose · <kbd>Enter</kbd>/<kbd>Z</kbd> lock in (or click)${mode === "2p" ? " · P2: d-pad + A" : ""} · <kbd>Esc</kbd> back`;
    overlayEl.innerHTML = `
      <h2>CHOOSE YOUR FIGHTER</h2>
      <div class="cards">${cards}</div>
      <p class="dim">${hint}</p>`;
  } else if (kind === "paused") {
    overlayEl.innerHTML = `<h1>PAUSED</h1><div class="menu one">
      <button data-key="Escape"><kbd>Esc</kbd> Resume</button>
      <button data-key="KeyQ"><kbd>Q</kbd> Quit to title</button></div>`;
  } else if (kind === "matchEnd") {
    const w = score[0] > score[1] ? 0 : 1;
    overlayEl.innerHTML = `
      <h1 style="color:${colorsFor(state, w).body}">${names[w].split(" · ")[0] === "You" ? "YOU WIN" : `${names[w]} WINS`}</h1>
      <p class="sub">${score[0]} – ${score[1]}</p>
      ${MODE_MENU()}`;
  }
}

// Menus are tappable/clickable: buttons either replay a key press or pick a fighter.
overlayEl.addEventListener("click", (e) => {
  const el = e.target.closest("[data-key],[data-pick],[data-act]");
  if (!el || el.disabled) return;
  // on phones, starting a mode is a user gesture: use it to go fullscreen (where allowed)
  if (TOUCH && /^Digit[1-5]$/.test(el.dataset.key ?? "")) goFullscreen();
  if (el.dataset.key) simulatePress(el.dataset.key);
  else if (el.dataset.pick !== undefined && phase === "select") {
    picks[0] = Number(el.dataset.pick);
    locked[0] = true;
    sfx.playPickup();
    showOverlay("select");
  } else if (el.dataset.act === "fullscreen") {
    goFullscreen();
    el.remove();
  }
});

function hideOverlay() {
  overlayEl.hidden = true;
}

initTouchControls();
const pauseBtn = document.getElementById("pauseBtn");
pauseBtn.addEventListener("click", () => simulatePress("Escape"));
const HUD_SPECIAL = { dash: "DASH", shield: "SHIELD", cannon: "CANNON" };

window.addEventListener("keydown", sfx.unlockAudio);
window.addEventListener("pointerdown", sfx.unlockAudio);

let last = performance.now();
let acc = 0;
const DT = 1 / TICK_HZ;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= DT) {
    tick();
    acc -= DT;
  }
  const inPlay = phase === "countdown" || phase === "playing" || phase === "roundEnd";
  const humanP1 = mode === "cpu" || mode === "ai" || mode === "2p";
  setTouchControlsVisible(inPlay && humanP1);
  pauseBtn.hidden = !(TOUCH && inPlay);
  if (inPlay && humanP1) {
    const me = state.players[0];
    setSpecialInfo(HUD_SPECIAL[CHARACTERS[me.char].special], me.specialCooldown / CHARACTERS[me.char].cooldown);
  }
  renderer.update(dt, state);
  renderer.draw(state, { names, score, ...bannerFor() });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
