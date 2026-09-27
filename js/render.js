// Canvas renderer + "juice" (particles, shake, flashes). Reads sim state and
// sim events; never changes the simulation.

import { MAP, TILE, COLS, ROWS, WIDTH, HEIGHT, T, TICK_HZ, CHARACTERS, suddenDeathSeconds } from "./sim.js";

// Colors per character; `alt` is used by player 2 in a mirror match.
export const CHAR_COLORS = {
  volt: { body: "#4fd6ff", dark: "#1b6f99", glow: "rgba(79,214,255,", alt: { body: "#9fb4ff", dark: "#3b4a9a", glow: "rgba(159,180,255," } },
  aegis: { body: "#6ee06e", dark: "#23802f", glow: "rgba(110,224,110,", alt: { body: "#c6f06a", dark: "#5f7f1c", glow: "rgba(198,240,106," } },
  ember: { body: "#ff5a4a", dark: "#98201a", glow: "rgba(255,90,74,", alt: { body: "#ff9a3d", dark: "#9a4a10", glow: "rgba(255,154,61," } },
};

export function colorsFor(state, id) {
  const [a, b] = state.players;
  const c = CHAR_COLORS[state.players[id].char];
  return id === 1 && a.char === b.char ? c.alt : c;
}

const HUD_LABEL = { dash: "DASH", shield: "SHIELD", cannon: "CANNON" };

const PICKUP_STYLE = {
  radius: { color: "#ff4d6d", label: "Blast" },
  speed: { color: "#ffd23f", label: "Speed" },
  damage: { color: "#b36bff", label: "Damage" },
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const fx = {
    particles: [],
    shake: 0,
    flash: 0,
    hurt: [0, 0],
    squash: [0, 0],
    time: 0,
  };
  const bg = buildBackground();
  let scale = 1;
  let cur = null; // latest sim state, for per-character colors
  const col = (id) => colorsFor(cur, id);

  function resize() {
    // crisp integer scaling on big screens; fill the screen (fractional) on phones
    const fit = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT);
    const s = fit >= 2 ? Math.floor(fit) : fit;
    const dpr = window.devicePixelRatio || 1;
    scale = s;
    canvas.style.width = `${Math.floor(WIDTH * s)}px`;
    canvas.style.height = `${Math.floor(HEIGHT * s)}px`;
    canvas.width = Math.round(WIDTH * s * dpr);
    canvas.height = Math.round(HEIGHT * s * dpr);
    ctx.imageSmoothingEnabled = false;
  }
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));

  function spawn(p) {
    if (fx.particles.length < 900) fx.particles.push(p);
  }

  function onEvents(events, state) {
    cur = state;
    for (const e of events) {
      if (e.type === "fire") {
        const big = e.heavy ? 2 : 1;
        spawn({ kind: "flash", x: e.x + e.dx * 8, y: e.y + e.dy * 8, age: 0, life: 0.07 * big, r0: 3 * big, r1: 9 * big, color: "#fff4c2" });
        fx.shake = Math.min(12, fx.shake + 1.2 * big * big);
      } else if (e.type === "shield") {
        spawn({ kind: "ring", x: e.x, y: e.y, age: 0, life: 0.3, r0: 4, r1: T.shieldRadius + 4, color: col(e.player).body });
      } else if (e.type === "reflect") {
        spawn({ kind: "ring", x: e.x, y: e.y, age: 0, life: 0.25, r0: 2, r1: 12, color: "#ffffff" });
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2;
          spawn({ kind: "spark", x: e.x, y: e.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, g: 0, age: 0, life: 0.2 });
        }
        spawn({ kind: "text", x: e.x, y: e.y - 8, vy: -40, age: 0, life: 0.8, text: "REFLECT", color: col(e.player).body });
        fx.shake = Math.min(10, fx.shake + 2);
      } else if (e.type === "block") {
        spawn({ kind: "text", x: e.x, y: e.y - 4, vy: -40, age: 0, life: 0.8, text: "BLOCK", color: col(e.player).body });
      } else if (e.type === "explode") {
        const r = e.radius;
        spawn({ kind: "flash", x: e.x, y: e.y, age: 0, life: 0.12, r0: r * 0.3, r1: r * 0.9, color: "#fff6d8" });
        spawn({ kind: "ring", x: e.x, y: e.y, age: 0, life: 0.35, r0: r * 0.2, r1: r, color: "#ffcf6b" });
        const n = Math.round(10 + r * 0.5);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 60 + Math.random() * (140 + r * 4);
          spawn({ kind: "spark", x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, g: 380, age: 0, life: 0.25 + Math.random() * 0.35 });
        }
        for (let i = 0; i < 10; i++) {
          spawn({
            kind: "smoke",
            x: e.x + (Math.random() - 0.5) * r * 0.8,
            y: e.y + (Math.random() - 0.5) * r * 0.6,
            vx: (Math.random() - 0.5) * 30,
            vy: -20 - Math.random() * 30,
            g: -10,
            age: -Math.random() * 0.15,
            life: 0.7 + Math.random() * 0.7,
            r: 3 + Math.random() * (r * 0.18),
            dark: Math.random() < 0.45,
          });
        }
        fx.shake = Math.min(14, fx.shake + 3 + r * 0.12);
      } else if (e.type === "hit") {
        fx.hurt[e.player] = 0.18;
        spawn({ kind: "text", x: e.x, y: e.y - 4, vy: -40, age: 0, life: 0.8, text: `${Math.round(e.damage)}`, color: e.player === e.by ? "#ffb3b3" : "#ffffff" });
      } else if (e.type === "death") {
        fx.flash = 0.25;
        const c = col(e.player);
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 80 + Math.random() * 260;
          spawn({ kind: "chunk", x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, g: 500, age: 0, life: 0.8 + Math.random() * 0.8, size: 1 + Math.random() * 3, color: Math.random() < 0.6 ? c.body : c.dark });
        }
        fx.shake = Math.min(18, fx.shake + 10);
      } else if (e.type === "doublejump") {
        fx.squash[e.player] = -0.3;
        spawn({ kind: "ring", x: e.x, y: e.y, age: 0, life: 0.25, r0: 2, r1: 10, color: "#e8e4ff" });
      } else if (e.type === "dash") {
        spawn({ kind: "ring", x: e.x, y: e.y, age: 0, life: 0.3, r0: 4, r1: 16, color: col(e.player).body });
        fx.shake = Math.min(10, fx.shake + 1.5);
      } else if (e.type === "dodge") {
        spawn({ kind: "text", x: e.x, y: e.y - 4, vy: -40, age: 0, life: 0.8, text: "DODGE", color: "#7dffcf" });
      } else if (e.type === "hang") {
        for (let i = 0; i < 3; i++) dust(e.x, e.y);
      } else if (e.type === "jump" || e.type === "walljump") {
        fx.squash[e.player] = -0.25;
        for (let i = 0; i < 5; i++) dust(e.x, e.y);
      } else if (e.type === "land") {
        fx.squash[e.player] = Math.min(0.35, e.speed * 0.05);
        for (let i = 0; i < 6; i++) dust(e.x, e.y);
      } else if (e.type === "pickup") {
        const col = PICKUP_STYLE[e.kind].color;
        spawn({ kind: "ring", x: e.x, y: e.y, age: 0, life: 0.4, r0: 4, r1: 20, color: col });
        spawn({ kind: "text", x: e.x, y: e.y - 10, vy: -30, age: 0, life: 1.0, text: `+${PICKUP_STYLE[e.kind].label}`, color: col });
      } else if (e.type === "pickupSpawn") {
        spawn({ kind: "ring", x: e.x, y: e.y, age: 0, life: 0.5, r0: 16, r1: 3, color: PICKUP_STYLE[e.kind].color });
      }
    }
  }

  function dust(x, y) {
    spawn({ kind: "smoke", x: x + (Math.random() - 0.5) * 8, y: y - 1, vx: (Math.random() - 0.5) * 50, vy: -10 - Math.random() * 15, g: 0, age: 0, life: 0.3 + Math.random() * 0.2, r: 1.5 + Math.random() * 1.5, dark: false, dust: true });
  }

  function update(dt, state) {
    cur = state;
    fx.time += dt;
    fx.shake *= Math.exp(-7 * dt);
    fx.flash = Math.max(0, fx.flash - dt);
    for (let i = 0; i < 2; i++) {
      fx.hurt[i] = Math.max(0, fx.hurt[i] - dt);
      fx.squash[i] *= Math.exp(-12 * dt);
    }
    // missile exhaust trails
    for (const p of state.players) {
      if (p.alive && p.dashTicks > 0) spawn({ kind: "ghost", x: p.x, y: p.y, age: 0, life: 0.2, owner: p.id });
    }
    for (const m of state.missiles) {
      const sp = Math.hypot(m.vx, m.vy) || 1;
      // flame while the motor burns, then just a thin smoke trail as it falls
      spawn({ kind: "trail", x: m.x - (m.vx / sp) * 4, y: m.y - (m.vy / sp) * 4, age: 0, life: m.heavy ? 0.4 : 0.25, r: (m.heavy ? 2.5 : 1.5) + m.radius * 0.03, owner: m.owner, burning: m.age <= T.missileThrustTicks });
    }
    for (let i = fx.particles.length - 1; i >= 0; i--) {
      const p = fx.particles[i];
      p.age += dt;
      if (p.age < 0) continue;
      if (p.age >= p.life) {
        fx.particles.splice(i, 1);
        continue;
      }
      if (p.vx !== undefined) {
        p.vy += (p.g ?? 0) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.vy !== undefined) {
        p.y += p.vy * dt;
      }
    }
  }

  function draw(state, overlay) {
    cur = state;
    const dpr = window.devicePixelRatio || 1;
    const s = scale * dpr;
    const sx = (Math.random() - 0.5) * fx.shake;
    const sy = (Math.random() - 0.5) * fx.shake;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#07060d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s, 0, 0, s, sx * s, sy * s);

    ctx.drawImage(bg, 0, 0);
    drawTiles();

    for (const p of state.players) if (p.alive) drawAim(p);

    for (const pk of state.pickups) drawPickup(pk);
    drawParticles(false);
    for (const m of state.missiles) drawMissile(m);
    for (const p of state.players) if (p.alive) drawPlayer(p);
    drawParticles(true);

    if (fx.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${fx.flash * 1.6})`;
      ctx.fillRect(-20, -20, WIDTH + 40, HEIGHT + 40);
    }

    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawHud(state, overlay);
  }

  function drawTiles() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (MAP[r][c] !== "#") continue;
        const x = c * TILE;
        const y = r * TILE;
        const openAbove = r > 0 && MAP[r - 1][c] !== "#";
        const openBelow = r < ROWS - 1 && MAP[r + 1][c] !== "#";
        ctx.fillStyle = "#2a2440";
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#231e36";
        if ((r + c) % 2 === 0) ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        if (openAbove) {
          ctx.fillStyle = "#6a5acd";
          ctx.fillRect(x, y, TILE, 2);
          ctx.fillStyle = "#43397a";
          ctx.fillRect(x, y + 2, TILE, 2);
        }
        if (openBelow) {
          ctx.fillStyle = "#15111f";
          ctx.fillRect(x, y + TILE - 2, TILE, 2);
        }
      }
    }
  }

  function drawAim(p) {
    const cx = p.x + T.playerW / 2;
    const cy = p.y + T.playerH / 2;
    const ready = p.cooldown === 0;
    ctx.strokeStyle = ready ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + p.aimX * 9, cy + p.aimY * 9);
    ctx.lineTo(cx + p.aimX * 15, cy + p.aimY * 15);
    ctx.stroke();
  }

  function drawPlayer(p) {
    const c = col(p.id);
    const sq = fx.squash[p.id];
    const w = T.playerW * (1 + sq * 0.6);
    const h = T.playerH * (1 - sq);
    const x = p.x + T.playerW / 2 - w / 2;
    const y = p.y + T.playerH - h;

    // glow
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 1, x + w / 2, y + h / 2, 16);
    g.addColorStop(0, `${c.glow}0.35)`);
    g.addColorStop(1, `${c.glow}0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - 12, y - 12, w + 24, h + 24);

    const hurt = fx.hurt[p.id] > 0;
    // invulnerable (dash) => flicker
    if (p.invuln > 0 && Math.floor(fx.time * 30) % 2 === 0) ctx.globalAlpha = 0.35;
    ctx.fillStyle = hurt ? "#ffffff" : c.dark;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    ctx.fillStyle = hurt ? "#ffffff" : c.body;
    ctx.fillRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(w) - 2, Math.round(h) - 3);

    // hands gripping the ledge
    if (p.hanging !== 0) {
      ctx.fillStyle = c.body;
      const hx = p.hanging > 0 ? p.x + T.playerW : p.x - 2;
      ctx.fillRect(Math.round(hx), Math.round(p.y + 2), 2, 3);
    }

    // eyes look where you aim
    const ex = Math.round(x + w / 2 + p.aimX * 2);
    const ey = Math.round(y + h * 0.35 + p.aimY * 2);
    ctx.fillStyle = "#0b0b14";
    ctx.fillRect(ex - 3, ey, 2, 3);
    ctx.fillRect(ex + 1, ey, 2, 3);

    // launcher
    const cx = p.x + T.playerW / 2;
    const cy = p.y + T.playerH / 2 + 1;
    ctx.strokeStyle = "#d8d8e8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + p.aimX * 8, cy + p.aimY * 8);
    ctx.stroke();

    // reflect shield bubble
    if (p.shieldTicks > 0) {
      const fade = Math.min(1, p.shieldTicks / 10);
      const pulse = 1 + Math.sin(fx.time * 40) * 0.06;
      ctx.globalAlpha = 0.18 * fade;
      ctx.fillStyle = c.body;
      ctx.beginPath();
      ctx.arc(cx, cy - 1, T.shieldRadius * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9 * fade;
      ctx.strokeStyle = c.body;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const a = (k / 6) * Math.PI * 2 + fx.time * 2;
        const hx = cx + Math.cos(a) * T.shieldRadius * pulse;
        const hy = cy - 1 + Math.sin(a) * T.shieldRadius * pulse;
        if (k === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // tiny HP bar over the head
    const bw = 16;
    const bx = Math.round(p.x + T.playerW / 2 - bw / 2);
    const by = Math.round(p.y - 6);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(bx - 1, by - 1, bw + 2, 4);
    ctx.fillStyle = hpColor(p.hp / T.maxHp);
    ctx.fillRect(bx, by, Math.max(0, Math.round((bw * p.hp) / T.maxHp)), 2);
    // special cooldown: thin bar that fills up; bright when ready
    const ready = p.specialCooldown === 0;
    ctx.fillStyle = ready ? "#ffffff" : "rgba(255,255,255,0.35)";
    ctx.fillRect(bx, by + 3, Math.round(bw * (1 - p.specialCooldown / CHARACTERS[p.char].cooldown)), 1);
    ctx.globalAlpha = 1;
  }

  function drawMissile(m) {
    const c = col(m.owner);
    const sp = Math.hypot(m.vx, m.vy) || 1;
    const dx = m.vx / sp;
    const dy = m.vy / sp;
    const len = 5 + sp * 0.5;
    ctx.strokeStyle = c.body;
    ctx.lineWidth = m.heavy ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(m.x - dx * len, m.y - dy * len);
    ctx.lineTo(m.x, m.y);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    const hs = m.heavy ? 5 : 3;
    ctx.fillRect(Math.round(m.x) - (hs >> 1), Math.round(m.y) - (hs >> 1), hs, hs);
  }

  function drawPickup(pk) {
    const st = PICKUP_STYLE[pk.kind];
    const bob = Math.sin(fx.time * 4 + pk.id) * 2;
    const x = pk.x;
    const y = pk.y + bob;
    const g = ctx.createRadialGradient(x, y, 1, x, y, 14);
    g.addColorStop(0, st.color);
    g.addColorStop(0.35, st.color + "88");
    g.addColorStop(1, st.color + "00");
    ctx.fillStyle = g;
    ctx.fillRect(x - 14, y - 14, 28, 28);
    ctx.fillStyle = "#0b0b14";
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = st.color;
    ctx.fillStyle = st.color;
    ctx.lineWidth = 1;
    if (pk.kind === "radius") {
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    } else if (pk.kind === "speed") {
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 3);
      ctx.lineTo(x, y);
      ctx.lineTo(x - 3, y + 3);
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 3, y);
      ctx.lineTo(x, y + 3);
      ctx.stroke();
    } else {
      ctx.fillRect(x - 0.5, y - 3.5, 1, 7);
      ctx.fillRect(x - 3.5, y - 0.5, 7, 1);
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }

  function drawParticles(front) {
    for (const p of fx.particles) {
      if (p.age < 0) continue;
      const t = p.age / p.life;
      const isFront = p.kind === "text" || p.kind === "flash" || p.kind === "ring" || p.kind === "spark" || p.kind === "chunk";
      if (isFront !== front) continue;
      if (p.kind === "flash") {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 1 - t;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * t, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "ring") {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 2 * (1 - t) + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * (1 - (1 - t) * (1 - t)), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === "spark") {
        ctx.fillStyle = t < 0.4 ? "#fff3b0" : t < 0.7 ? "#ffb347" : "#d9480f";
        ctx.globalAlpha = 1 - t * 0.6;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
      } else if (p.kind === "ghost") {
        ctx.fillStyle = col(p.owner).body;
        ctx.globalAlpha = 0.4 * (1 - t);
        ctx.fillRect(Math.round(p.x), Math.round(p.y), T.playerW, T.playerH);
      } else if (p.kind === "chunk") {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 1 - t;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      } else if (p.kind === "smoke") {
        ctx.fillStyle = p.dust ? "#8a82a8" : p.dark ? "#2b2533" : "#6d6577";
        ctx.globalAlpha = (1 - t) * (p.dust ? 0.5 : 0.7);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 + t * 0.8), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "trail") {
        ctx.fillStyle = p.burning && t < 0.3 ? "#ffe8a3" : p.burning ? col(p.owner).dark : "#4a4458";
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "text") {
        ctx.globalAlpha = 1 - t * t;
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#000";
        ctx.fillText(p.text, p.x + 1, p.y + 1);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawHud(state, overlay) {
    ctx.font = "bold 8px monospace";
    ctx.textBaseline = "top";
    for (const p of state.players) {
      const c = col(p.id);
      const left = p.id === 0;
      const bw = 90;
      const x = left ? 20 : WIDTH - 20 - bw;
      const y = 4;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x - 2, y - 2, bw + 4, 31);

      // special: name + countdown (seconds) + fill bar
      const ch = CHARACTERS[p.char];
      const ready = p.specialCooldown === 0;
      const sy = y + 18;
      ctx.fillStyle = "#1a1726";
      ctx.fillRect(x, sy + 9, bw, 2);
      ctx.fillStyle = ready ? c.body : c.dark;
      ctx.fillRect(x, sy + 9, Math.round(bw * (1 - p.specialCooldown / ch.cooldown)), 2);
      ctx.textAlign = "left";
      ctx.fillStyle = ready ? "#ffffff" : "#8a84a6";
      ctx.fillText(HUD_LABEL[ch.special], x, sy);
      ctx.textAlign = "right";
      ctx.fillStyle = ready ? c.body : "#ffffff";
      ctx.fillText(ready ? "READY" : `${(p.specialCooldown / TICK_HZ).toFixed(1)}s`, x + bw, sy);
      ctx.fillStyle = "#1a1726";
      ctx.fillRect(x, y, bw, 5);
      ctx.fillStyle = hpColor(p.hp / T.maxHp);
      const w = Math.round((bw * p.hp) / T.maxHp);
      ctx.fillRect(left ? x : x + bw - w, y, w, 5);
      ctx.fillStyle = c.body;
      ctx.textAlign = left ? "left" : "right";
      ctx.fillText(overlay.names[p.id], left ? x : x + bw, y + 7);
      // stacks
      let i = 0;
      for (const kind of ["radius", "speed", "damage"]) {
        for (let k = 0; k < p.stacks[kind]; k++) {
          ctx.fillStyle = PICKUP_STYLE[kind].color;
          const px = left ? x + bw - 3 - i * 4 : x + i * 4;
          ctx.fillRect(px, y + 9, 3, 5);
          i++;
        }
      }
    }
    // score + timer
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(WIDTH / 2 - 34, 2, 68, 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(`${overlay.score[0]}  -  ${overlay.score[1]}`, WIDTH / 2, 4);
    const secs = Math.max(0, Math.ceil((T.maxTicks - state.tick) / TICK_HZ));
    const sd = suddenDeathSeconds(state) > 0;
    ctx.fillStyle = sd ? (Math.floor(fx.time * 4) % 2 ? "#ff4d6d" : "#ffd23f") : "#9a93b8";
    ctx.fillText(sd ? `SUDDEN DEATH ${secs}` : `${secs}s`, WIDTH / 2, 14);

    if (overlay.banner) {
      ctx.font = "bold 16px monospace";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, HEIGHT / 2 - 18, WIDTH, 36);
      ctx.fillStyle = overlay.bannerColor ?? "#fff";
      ctx.fillText(overlay.banner, WIDTH / 2, HEIGHT / 2);
    }
  }

  return { onEvents, update, draw };
}

function hpColor(f) {
  return f > 0.6 ? "#5ee37a" : f > 0.3 ? "#ffd23f" : "#ff4d6d";
}

function buildBackground() {
  const c = document.createElement("canvas");
  c.width = WIDTH;
  c.height = HEIGHT;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, HEIGHT);
  grad.addColorStop(0, "#120c2b");
  grad.addColorStop(0.6, "#1f1340");
  grad.addColorStop(1, "#3a1d4d");
  g.fillStyle = grad;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  // stars
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.6})`;
    g.fillRect(Math.floor(r() * WIDTH), Math.floor(r() * HEIGHT * 0.7), 1, 1);
  }
  // distant skyline silhouettes
  g.fillStyle = "#1a1030";
  let x = 0;
  while (x < WIDTH) {
    const w = 10 + Math.floor(r() * 30);
    const h = 30 + Math.floor(r() * 80);
    g.fillRect(x, HEIGHT - h, w, h);
    x += w + Math.floor(r() * 6);
  }
  return c;
}
