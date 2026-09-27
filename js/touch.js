// On-screen controls for phones (landscape): a floating joystick for the left
// thumb (move + 8-way aim) and JUMP / FIRE / SPECIAL buttons for the right.
// Uses pointer events, so it also works with a mouse (handy for testing).

const DEAD_ZONE = 14; // px before the stick counts as pushed
const MAX_TRAVEL = 44; // px the knob can move from its centre

const state = { left: false, right: false, up: false, down: false, jump: false, fire: false, special: false };
let root = null;
let specialBtn = null;
let enabled = false;

export function isTouchDevice() {
  return new URLSearchParams(location.search).has("touch") || matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

export function touchInput() {
  return state;
}

export function setTouchControlsVisible(visible) {
  if (root) root.hidden = !(visible && enabled);
  if (!visible) releaseAll();
}

// label: "DASH" | "SHIELD" | "CANNON"; frac: 0 = ready, 1 = just used
export function setSpecialInfo(label, frac) {
  if (!specialBtn) return;
  if (specialBtn.dataset.label !== label) {
    specialBtn.dataset.label = label;
    specialBtn.querySelector("span").textContent = label;
  }
  specialBtn.style.setProperty("--cd", `${Math.round(frac * 360)}deg`);
  specialBtn.classList.toggle("ready", frac === 0);
}

// Keep receiving a finger's events even if it slides off the element. Never
// let a failed capture (pointer already gone) swallow the press itself.
function capture(el, id) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* ignore */
  }
}

function releaseAll() {
  for (const k of Object.keys(state)) state[k] = false;
}

export function initTouchControls() {
  enabled = isTouchDevice();
  root = document.createElement("div");
  root.id = "touch";
  root.hidden = true;
  root.innerHTML = `
    <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div></div>
    <button class="tbtn fire" aria-label="Fire"><span>FIRE</span></button>
    <button class="tbtn jump" aria-label="Jump"><span>JUMP</span></button>
    <button class="tbtn special" aria-label="Special"><span>SPECIAL</span></button>`;
  document.body.appendChild(root);
  specialBtn = root.querySelector(".special");

  // --- joystick: appears wherever the thumb lands in the left zone
  const zone = root.querySelector(".stick-zone");
  const base = root.querySelector(".stick-base");
  const knob = root.querySelector(".stick-knob");
  let stickId = null;
  let ox = 0;
  let oy = 0;

  const setDir = (dx, dy) => {
    const len = Math.hypot(dx, dy);
    const k = len > MAX_TRAVEL ? MAX_TRAVEL / len : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    state.left = state.right = state.up = state.down = false;
    if (len < DEAD_ZONE) return;
    // cardinal directions get wider sectors than diagonals, so running
    // left/right doesn't accidentally aim diagonally
    const a = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180, 0 = right, 90 = down
    const abs = Math.abs(a);
    const horiz = abs < 62.5 ? 1 : abs > 117.5 ? -1 : 0;
    const vert = a > 27.5 && a < 152.5 ? 1 : a < -27.5 && a > -152.5 ? -1 : 0;
    state.right = horiz === 1;
    state.left = horiz === -1;
    state.down = vert === 1;
    state.up = vert === -1;
  };

  zone.addEventListener("pointerdown", (e) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    capture(zone, e.pointerId);
    const r = zone.getBoundingClientRect();
    ox = e.clientX;
    oy = e.clientY;
    base.style.left = `${ox - r.left}px`;
    base.style.top = `${oy - r.top}px`;
    base.classList.add("active");
    setDir(0, 0);
    e.preventDefault();
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stickId) return;
    setDir(e.clientX - ox, e.clientY - oy);
  });
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    base.classList.remove("active");
    setDir(0, 0);
  };
  zone.addEventListener("pointerup", endStick);
  zone.addEventListener("pointercancel", endStick);

  // --- buttons: held while a finger is on them
  for (const [cls, key] of [["fire", "fire"], ["jump", "jump"], ["special", "special"]]) {
    const btn = root.querySelector(`.${cls}`);
    const down = (e) => {
      capture(btn, e.pointerId);
      state[key] = true;
      btn.classList.add("pressed");
      e.preventDefault();
    };
    const up = () => {
      state[key] = false;
      btn.classList.remove("pressed");
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
  }

  // no long-press menus / text selection on the controls
  root.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("blur", releaseAll);
}
