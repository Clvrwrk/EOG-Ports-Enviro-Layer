#!/usr/bin/env node
/**
 * Builds public/models/port/utr.glb: a low-poly electric terminal tractor
 * (UTR / yard tractor) for the Port of Hueneme twin.
 *
 * Original geometry, laid out by eye from photos of Orange EV's e-TRIEVER:
 * white body and single-seat cab with a roof-top HVAC unit and amber beacons,
 * black bumper and side battery boxes, an orange lift boom carrying the fifth
 * wheel on the rear deck, single front axle and dual rear wheels. No logos or
 * lettering. Dimensions are approximate.
 *
 * Model conventions (public/models/README.md): metres, glTF +Y up, front
 * toward local -X, origin on the ground at the middle of the vehicle.
 *
 *   node scripts/build-utr-model.mjs [out.glb]
 */
import { resolve } from 'node:path';
import { createModelKit } from './model-kit.mjs';

const out = resolve(
  process.argv.slice(2).find((a) => a.endsWith('.glb')) ??
    'public/models/port/utr.glb',
);

const kit = createModelKit({
  white: [0.88, 0.9, 0.92],
  black: [0.05, 0.05, 0.06],
  rubber: [0.04, 0.04, 0.05],
  hub: [0.62, 0.64, 0.66],
  orange: [0.95, 0.4, 0.04],
  amber: [1.0, 0.55, 0.0],
  glass: [0.3, 0.45, 0.55],
});
const { box, beam, prism, wheel } = kit;

// x runs front (-) to back (+); z is across; overall about 5.9 x 2.6 x 3.8 m.
const FRONT = -2.95;

// Frame rails and the rear deck.
for (const z of [-0.45, 0.45]) box('black', [0, 0.85, z], [5.6, 0.3, 0.2]);
box('black', [1.55, 1.12, 0], [2.7, 0.12, 1.5]); // deck plate

// Front: black bumper, white lower body / battery-and-motor housing.
box('black', [FRONT + 0.12, 0.75, 0], [0.24, 0.6, 2.6]);
box('white', [FRONT + 0.95, 1.3, 0], [1.5, 1.1, 2.5]);
box('black', [FRONT + 0.2, 1.25, -0.25], [0.04, 0.3, 1.0]); // grille panel
for (const z of [-1.0, 1.0])
  box('amber', [FRONT + 0.2, 1.25, z], [0.05, 0.16, 0.16]);

// Cab: single seat, offset toward the left (+z), white with dark glazing.
const CAB = { x0: FRONT + 0.15, x1: -0.75, y0: 1.85, y1: 3.45, z: 0.2, w: 2.1 };
const cabX = (CAB.x0 + CAB.x1) / 2;
const cabL = CAB.x1 - CAB.x0;
box(
  'white',
  [cabX, (CAB.y0 + CAB.y1) / 2, CAB.z],
  [cabL, CAB.y1 - CAB.y0, CAB.w],
);
// Windscreen, side and rear windows (thin glass panels just proud of the cab).
box('glass', [CAB.x0 - 0.01, 2.85, CAB.z], [0.03, 0.95, CAB.w - 0.3]);
for (const side of [-1, 1])
  box(
    'glass',
    [cabX - 0.1, 2.85, CAB.z + side * (CAB.w / 2 + 0.01)],
    [cabL - 0.6, 0.85, 0.03],
  );
box('glass', [CAB.x1 + 0.01, 2.9, CAB.z], [0.03, 0.75, CAB.w - 0.6]);
// Roof HVAC unit and amber beacons.
box('white', [cabX + 0.2, CAB.y1 + 0.2, CAB.z], [1.1, 0.4, 1.3]);
box('black', [cabX - 0.38, CAB.y1 + 0.12, CAB.z], [0.08, 0.15, 1.2]);
for (const z of [-0.7, 1.1])
  box(
    'amber',
    [CAB.x0 + 0.2, CAB.y1 + 0.1, CAB.z + z * 0.85],
    [0.18, 0.2, 0.18],
  );
// Mirror post and mirror on the right front corner.
box('white', [FRONT + 0.5, 2.6, -1.2], [0.12, 2.6, 0.12]);
box('hub', [FRONT + 0.45, 3.0, -1.4], [0.08, 0.6, 0.35]);
// Step and grab handle under the door.
box('black', [cabX, 1.0, 1.32], [0.6, 0.08, 0.3]);

// Side battery boxes behind the cab.
for (const side of [-1, 1])
  box('black', [-0.05, 1.15, side * 1.0], [1.5, 0.95, 0.55]);

// Orange lift boom and the fifth wheel on the deck.
for (const z of [-0.55, 0.55])
  beam('orange', [-0.2, 0.95, z], [2.2, 1.35, z], 0.18, 0.28);
box('orange', [2.25, 1.35, 0], [0.3, 0.3, 1.3]);
prism('black', [1.75, 0], 1.35, 1.55, 0.85, 0.8, 12);
box('black', [2.4, 1.48, 0], [0.5, 0.12, 0.35]); // kingpin slot

// Wheels: single front axle, dual rear wheels, with rear fenders.
const R = 0.55;
for (const side of [-1, 1]) {
  wheel([FRONT + 1.0, R, side * 1.05], R, 0.38, 'hub');
  wheel([1.8, R, side * 0.85], R, 0.33, 'hub');
  wheel([1.8, R, side * 1.2], R, 0.33, 'hub');
  box('black', [1.8, 1.25, side * 1.05], [1.3, 0.08, 0.8]);
}

kit.writeGlb(out, {
  generator: 'scripts/build-utr-model.mjs',
  extras: { title: 'Electric terminal tractor (e-TRIEVER style)' },
});
