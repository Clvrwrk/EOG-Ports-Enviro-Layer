#!/usr/bin/env node
/**
 * Builds public/models/port/lhm-420.glb: a low-poly mobile harbour crane in
 * the shape of a Liebherr LHM 420, for the Port of Hueneme twin.
 *
 * Original geometry, laid out by eye from Liebherr's published LHM 420 photos
 * (X-shaped undercarriage on four outrigger pads, wheel bogies under the
 * chassis, yellow machine house with a white power-pack, dark grey tapered
 * tower with the cabin high up, rear A-frame, white four-chord lattice boom).
 * No logos or lettering. Dimensions are approximate.
 *
 * Model conventions (public/models/README.md): metres, glTF +Y up, front
 * (the boom) toward local -X, origin on the ground under the slewing centre.
 *
 *   node scripts/build-lhm-crane.mjs [out.glb] [--boom-deg 45]
 */
import { resolve } from 'node:path';
import { add, createModelKit, scale } from './model-kit.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const out = resolve(
  args.find((a) => a.endsWith('.glb')) ?? 'public/models/port/lhm-420.glb',
);
const BOOM_DEG = flag('--boom-deg', 45);

const MATERIALS = {
  grey: [0.27, 0.3, 0.33],
  dark: [0.16, 0.18, 0.2],
  yellow: [0.95, 0.68, 0.05],
  white: [0.9, 0.91, 0.92],
  rubber: [0.06, 0.06, 0.07],
  glass: [0.35, 0.5, 0.6],
};

const kit = createModelKit(MATERIALS);
const { box, beam, prism, wheel } = kit;

// ---- the crane ---------------------------------------------------------
// Front (boom side, toward the ship) is -X. z is across the chassis.

// Chassis: long beam along the quay (z), carried on wheel bogies.
const CHASSIS_Y = 2.6;
box('grey', [0, CHASSIS_Y, 0], [4.2, 1.8, 15]);
for (const side of [-1, 1]) {
  // Two bogie rows, eight axles each side.
  for (let i = 0; i < 8; i += 1) {
    const z = -6.3 + i * 1.8;
    box('dark', [side * 1.6, 1.35, z], [0.6, 0.9, 0.6]);
    wheel([side * 1.6, 0.55, z - 0.35], 0.55, 0.45);
    wheel([side * 1.6, 0.55, z + 0.35], 0.55, 0.45);
  }
}

// X-shaped outriggers to four pads.
const PAD = 7.2;
for (const sx of [-1, 1])
  for (const sz of [-1, 1]) {
    beam(
      'grey',
      [sx * 1.6, CHASSIS_Y + 0.3, sz * 3.5],
      [sx * PAD, 1.4, sz * PAD],
      1.1,
      1.3,
    );
    box('dark', [sx * PAD, 0.9, sz * PAD], [0.6, 1.2, 0.6]);
    box('grey', [sx * PAD, 0.15, sz * PAD], [3.2, 0.3, 2.2]);
  }

// Slewing ring and machine house (yellow) with the white power-pack.
prism('dark', [0, 0], CHASSIS_Y + 0.9, CHASSIS_Y + 1.6, 2.6, 2.6, 12);
const HOUSE_Y0 = CHASSIS_Y + 1.6;
box('dark', [1.2, HOUSE_Y0 + 0.4, 0], [10, 0.8, 6.2]);
box('yellow', [1.2, HOUSE_Y0 + 2.0, 0], [10, 2.4, 6]);
box('grey', [1.2, HOUSE_Y0 + 3.3, 0], [10, 0.25, 6.1]);
box('white', [4.2, HOUSE_Y0 + 4.5, 1.2], [2.6, 2.2, 2.2]);
box('white', [4.2, HOUSE_Y0 + 4.5, -1.4], [2.6, 2.2, 1.8]);
box('dark', [5.3, HOUSE_Y0 + 6.1, 1.2], [0.25, 1.0, 0.25]); // exhaust
const HOUSE_TOP = HOUSE_Y0 + 3.4;

// Tower: tapered dark grey column with a cabin near the top.
const TOWER_TOP = 31;
prism('dark', [0, 0], HOUSE_TOP, TOWER_TOP, 1.9, 1.15, 8);
box('dark', [0, TOWER_TOP + 0.6, 0], [3.4, 1.2, 2.6]); // tower head
box('grey', [-2.3, 24.6, 0], [2.6, 2.6, 2.4]); // cabin
box('glass', [-3.62, 24.9, 0], [0.05, 1.5, 2.0]);
box('grey', [-0.8, 23.1, 0], [4.2, 0.2, 3.4]); // cabin platform

// Rear A-frame / portal behind the tower.
const FRAME_X = 6.4;
for (const sz of [-1, 1]) {
  beam(
    'dark',
    [FRAME_X, HOUSE_TOP, sz * 2.4],
    [1.0, TOWER_TOP + 0.4, sz * 0.9],
    0.35,
  );
  beam('dark', [FRAME_X, HOUSE_TOP, sz * 2.4], [FRAME_X, 21, sz * 2.4], 0.3);
}
beam('dark', [FRAME_X, 21, -2.4], [FRAME_X, 21, 2.4], 0.3);
beam('dark', [FRAME_X, 21, 2.4], [1.5, 21, 1.4], 0.25);
beam('dark', [FRAME_X, 21, -2.4], [1.5, 21, -1.4], 0.25);

// Boom: white four-chord lattice, foot low on the tower, pointing -X.
const FOOT = [-1.7, 13.5, 0];
const BOOM_LEN = 46;
const t = (BOOM_DEG * Math.PI) / 180;
const dir = [-Math.cos(t), Math.sin(t), 0];
const up = [Math.sin(t), Math.cos(t), 0]; // perpendicular, in the luff plane
const across = [0, 0, 1];
const halfW = (s) => 1.25 - 0.55 * s; // tapers toward the tip
const halfH = (s) => 1.0 - 0.45 * s;
const chord = (s, iu, ia) =>
  add(
    add(add(FOOT, scale(dir, s * BOOM_LEN)), scale(up, iu * halfH(s))),
    scale(across, ia * halfW(s)),
  );
const corners = [
  [-1, -1],
  [-1, 1],
  [1, 1],
  [1, -1],
];
const SEG = 12;
for (const [iu, ia] of corners)
  beam('white', chord(0, iu, ia), chord(1, iu, ia), 0.28);
for (let k = 0; k <= SEG; k += 1) {
  const s = k / SEG;
  for (let c = 0; c < 4; c += 1) {
    const [iu, ia] = corners[c];
    const [ju, ja] = corners[(c + 1) % 4];
    beam('white', chord(s, iu, ia), chord(s, ju, ja), 0.12);
    if (k < SEG) {
      const s2 = (k + 1) / SEG;
      beam('white', chord(s, iu, ia), chord(s2, ju, ja), 0.1);
    }
  }
}
const TIP = add(FOOT, scale(dir, BOOM_LEN));
box('dark', TIP, [1.6, 1.6, 1.4]); // head sheaves
// Luffing cylinder from the house to the boom.
beam('grey', [-2.6, HOUSE_TOP + 0.5, 0], add(FOOT, scale(dir, 9)), 0.7);
// Hoist ropes from the tower head to the boom tip, then a hanging hook.
beam('dark', [0, TOWER_TOP + 0.6, 0.4], add(TIP, [0, 0.4, 0.4]), 0.08);
beam('dark', [0, TOWER_TOP + 0.6, -0.4], add(TIP, [0, 0.4, -0.4]), 0.08);
const HOOK_Y = 18;
beam('dark', TIP, [TIP[0], HOOK_Y + 1.2, 0], 0.1);
box('yellow', [TIP[0], HOOK_Y + 0.6, 0], [1.4, 1.2, 1.0]);

kit.writeGlb(out, {
  generator: 'scripts/build-lhm-crane.mjs',
  extras: { title: 'Mobile harbour crane (LHM 420 style)', boomDeg: BOOM_DEG },
});
