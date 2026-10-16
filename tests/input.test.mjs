import test from "node:test";
import assert from "node:assert/strict";

// input.js listens for keys on `window` as it loads; Node has no window.
globalThis.window ??= { addEventListener() {} };
const { createPadStartEdge } = await import("../js/input.js");

const pad = (index, { a = false, start = false, jump = false } = {}) => ({
  index,
  axes: [0, 0],
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: (i === 0 && (a || jump)) || (i === 9 && start) })),
});

test("pad start counts once per press, not while A or Start stays down", () => {
  const edge = createPadStartEdge();
  assert.equal(edge([pad(0)]), false);
  assert.equal(edge([pad(0, { a: true })]), true);
  assert.equal(edge([pad(0, { a: true })]), false, "held");
  assert.equal(edge([pad(0)]), false, "released");
  assert.equal(edge([pad(0, { start: true })]), true, "Start counts too");
});

test("A held as jump through the end of the match doesn't pick a mode on the result screen", () => {
  const edge = createPadStartEdge();
  edge([pad(0)]);
  edge([pad(0, { jump: true })]); // pressed during the last round: main.js polls every tick, in every phase
  for (let tick = 0; tick < 300; tick++) assert.equal(edge([pad(0, { jump: true })]), false, `tick ${tick}`);
  assert.equal(edge([pad(0)]), false);
  assert.equal(edge([pad(0, { a: true })]), true, "a fresh press after the screen shows does");
});

test("the first press of a pad the page hasn't seen yet counts", () => {
  // Browsers expose a pad only once a button is pressed: that press is often the A meant to start.
  const edge = createPadStartEdge();
  assert.equal(edge([]), false);
  assert.equal(edge([pad(0, { a: true })]), true);
});

test("each pad is tracked on its own", () => {
  const edge = createPadStartEdge();
  assert.equal(edge([pad(0, { a: true }), pad(1)]), true);
  assert.equal(edge([pad(0, { a: true }), pad(1)]), false, "pad 0 held, pad 1 up");
  assert.equal(edge([pad(0, { a: true }), pad(1, { start: true })]), true, "pad 1 pressed");
  assert.equal(edge([pad(0), pad(1, { start: true })]), false, "pad 0 released, pad 1 held");
});
