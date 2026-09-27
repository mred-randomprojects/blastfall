# Blastfall — asset prompts (ChatGPT image generation)

Drop every result into `art/` with the file name given. I slice, key out the background and snap to the pixel grid myself.

## Style block — paste at the start of EVERY prompt

> Pixel art game asset for a 2D side-view platformer. Crisp hard pixel edges, no anti-aliasing, no blur, limited palette (max ~14 colors), dark outlines, readable at small size. Solid flat magenta background (#FF00FF) everywhere there is no art — not white, not a checkerboard. No text, no labels, no grid lines, no UI.

(Magenta instead of "transparent": ChatGPT often fakes transparency with a painted checkerboard, and white collides with light pixels. Magenta keys out cleanly.)

## Sprite-sheet rules — add to every character sheet

> Character faces right. Every frame sits in an equal-size square cell, cells in a strict grid with equal spacing, character centered horizontally in its cell, feet on the same baseline in every frame, identical scale in every frame. Do NOT draw the launcher/weapon — hands empty (the weapon is a separate sprite).

---

## 1. Characters — distinct silhouettes

Do each character in 3 steps: **design sheet** (locks in the look) → **sheet A** (movement) → **sheet B** (moves + special). Always attach the previous image(s) of that character as reference.

### Volt (blue) — the dasher: light, fast, agile
Use your existing blue sheet as the design reference (skip the design step).

`volt_a.png` — attach the blue sheet:
> Using the attached character as the exact reference (same helmet, visor, armor, colors, proportions), draw a sprite sheet WITHOUT the shoulder launcher. Row 1: idle, 4 frames (subtle breathing). Row 2: run cycle, 6 frames. Row 3: jump — takeoff, rising, falling, landing crouch (4 frames). Row 4: double jump — a mid-air forward somersault, 4 frames.

`volt_b.png` — attach blue sheet + volt_a:
> Same character, same scale and style. Row 1: wall slide — pressed against a wall on the RIGHT side of the cell, one hand and one foot on the wall, 2 frames. Row 2: ledge hang — hanging from both hands at the top-right corner of the cell, legs dangling, 2 frames. Row 3: DASH — body stretched almost horizontal, leaning hard forward, with a trail of blue energy streaks behind, 3 frames. Row 4: hurt — recoiling backwards, 2 frames.

### Aegis (green) — the defender: heavy, broad, a shield projector
`aegis_design.png`:
> A heavy defensive power-armor soldier, visibly bulkier and wider than a normal trooper: broad rounded shoulders, thick chest plate, short sturdy legs, a large hexagonal energy-shield emitter mounted on the left forearm (glowing green panel). Dome helmet with a narrow horizontal green visor slit. Armor colors: forest green, olive and dark gray, with glowing lime accents. Side view facing right, full body, idle pose, shown 3 times at the same size in a row. Pixel-art platformer sprite, character about 26 pixels tall.

`aegis_a.png` / `aegis_b.png`: same prompts as Volt's A and B, attaching `aegis_design.png` instead. For sheet B, replace the DASH row with:
> Row 3: SHIELD — plants his feet and raises the forearm emitter forward, a glowing green hexagon-pattern energy dome bursting out around him, 3 frames.

### Ember (red) — the bombardier: hulking, heavy weapon
`ember_design.png`:
> A hulking heavy-weapons trooper: tall, top-heavy, barrel chest, a backpack ammo drum with glowing orange vents, heavy boots, angular horned helmet with an orange T-shaped visor. Armor colors: crimson, dark maroon and charcoal, with orange-yellow glowing accents. Side view facing right, full body, idle pose, shown 3 times at the same size in a row. Pixel-art platformer sprite, character about 28 pixels tall.

`ember_a.png` / `ember_b.png`: same prompts as Volt's A and B, attaching `ember_design.png`. For sheet B, replace the DASH row with:
> Row 3: SUPER-CANNON FIRE — bracing hard with legs apart, then being shoved backwards by huge recoil, 3 frames (hands positioned as if holding a big cannon at shoulder height).

---

## 2. Weapons (rotated in code to the 8 aim directions)

`launchers.png`:
> Three shoulder-held rocket launchers, side view, pointing right, horizontal, in one row with space between them. 1) A sleek compact blue-and-gunmetal launcher with a cyan light strip. 2) A squat, boxy green-and-olive launcher with armored plating. 3) A massive, long crimson-and-charcoal heavy cannon with a wide muzzle and orange vents. Each about 20–30 pixels long.

`projectiles.png`:
> In one row with space between them: 1) a small rocket missile pointing right, gray body, red nose cone, fins at the back, about 10 pixels long. 2) a big heavy cannon shell pointing right, dark iron with glowing orange bands, about 16 pixels long. 3) a 4-frame loop of a small rocket-exhaust flame pointing left.

---

## 3. Icons (16×16 each)

`powerups.png`:
> Three 16x16 pixel-art power-up icons in a row, glowing orbs with a symbol inside: 1) red/pink orb with an expanding blast-ring symbol (blast radius), 2) yellow orb with a double chevron » (missile speed), 3) purple orb with a jagged starburst (damage).

`abilities.png`:
> Three 16x16 pixel-art ability icons in a row, square badge style with a dark frame: 1) blue — a running figure with speed lines (dash), 2) green — a hexagonal shield (reflect shield), 3) red — a big cannon shell with a burst (super-cannon).

---

## 4. Select-screen portraits

`portraits.png` — attach the three design sheets:
> Three character bust portraits in a row, each 96x96 pixels, same pixel-art style as the attached sprites but larger and more detailed, facing slightly right, dramatic rim lighting in the character's color: Volt (blue, agile, confident), Aegis (green, bulky, stoic, shield emitter visible), Ember (red, hulking, grinning, cannon over shoulder).

---

## 5. Level

`tileset.png`:
> A 16x16-pixel tileset for a sci-fi rooftop arena at night, arranged on a strict grid: a platform block's top-left, top-middle, top-right, middle-left, middle, middle-right, bottom-left, bottom-middle, bottom-right pieces (a 3x3 set), plus a thin single-row floating-platform piece (left, middle, right end). Dark purple-gray metal panels with rivets, a bright violet glowing edge along the top surfaces.

`bg_far.png`:
> A 480x272 pixel-art night sky background for a side-view game: deep indigo-to-purple gradient, scattered stars, a large pale moon upper left. No ground, no buildings. (Opaque — no magenta needed for this one.)

`bg_city.png`:
> A 480x136 pixel-art silhouette layer of a distant futuristic city skyline at night, dark purple silhouettes with a few tiny lit windows (yellow and cyan), antenna towers. Flat magenta background above the skyline.

---

## Optional

`logo.png`:
> The word "BLASTFALL" as a chunky pixel-art game logo, orange-to-yellow gradient letters with a dark outline and small explosion sparks around it.
