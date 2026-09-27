// Keyboard + gamepad -> per-player sim inputs.

const held = new Set();
const pressedOnce = new Set();

window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(e.code)) e.preventDefault();
  if (!held.has(e.code)) pressedOnce.add(e.code);
  held.add(e.code);
});
window.addEventListener("keyup", (e) => held.delete(e.code));
window.addEventListener("blur", () => held.clear());

// Solo scheme: arrows or WASD to move/aim, Z/Space/K jump, X/J fire, C/L/Shift special.
export function keyboardInput() {
  const any = (...codes) => codes.some((c) => held.has(c));
  return {
    left: any("ArrowLeft", "KeyA"),
    right: any("ArrowRight", "KeyD"),
    up: any("ArrowUp", "KeyW"),
    down: any("ArrowDown", "KeyS"),
    jump: any("KeyZ", "Space", "KeyK"),
    fire: any("KeyX", "KeyJ"),
    special: any("KeyC", "KeyL", "ShiftLeft", "ShiftRight"),
  };
}

export function consumePress(code) {
  const had = pressedOnce.has(code);
  pressedOnce.delete(code);
  return had;
}

// Menus call this so a tap/click behaves exactly like pressing that key.
export function simulatePress(code) {
  pressedOnce.add(code);
}

export function clearPresses() {
  pressedOnce.clear();
}

export function connectedPads() {
  return [...(navigator.getGamepads?.() ?? [])].filter(Boolean);
}

export function padInput(pad) {
  const b = (i) => Boolean(pad.buttons[i]?.pressed);
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  return {
    left: ax < -0.4 || b(14),
    right: ax > 0.4 || b(15),
    up: ay < -0.4 || b(12),
    down: ay > 0.4 || b(13),
    jump: b(0),
    fire: b(2) || b(5) || b(7),
    special: b(1) || b(4) || b(6),
  };
}

export function padStartPressed(pad) {
  return Boolean(pad.buttons[9]?.pressed || pad.buttons[0]?.pressed);
}

export function mergeInputs(a, b) {
  if (!b) return a;
  return {
    left: a.left || b.left,
    right: a.right || b.right,
    up: a.up || b.up,
    down: a.down || b.down,
    jump: a.jump || b.jump,
    fire: a.fire || b.fire,
    special: a.special || b.special,
  };
}
