// Ship points for Hueneme's berths, for naming the berth a ship tied up at.
// Ids match the scenario registry (src/portos/hueneme.js). Berths 1 and 2 are
// the points port staff surveyed for the twin (src/portos/twin/layout.js).
// Every berth's stretch of wharf face comes from the berth boundary table in
// the Port of Hueneme Port & Terminal Plan (CARB At-Berth, revised June 2025);
// berths 4 and 5 and the Navy Terminal show at their segment's midpoint. Berth 3 and
// berths 6 to 9 are not in that plan, so a stay there reads as "berth unknown"
// rather than a guess.

import { SURVEYED } from '../portos/twin/layout.js';

const dms = (d, m, s) => d + m / 60 + s / 3600;
const PLAN_SOURCE = 'Port & Terminal Plan, June 2025, berth table';
const LAT_SOUTH_WHARF = dms(34, 8, 51);
const LAT_NORTH_WHARF = dms(34, 8, 55);
const W = (m, s) => -dms(119, m, s);

// Wharf-face segments [[lon, lat], [lon, lat]] from the plan's table.
const PLAN_SEGMENTS = {
  'berth-1': [
    [W(12, 31), LAT_SOUTH_WHARF],
    [W(12, 21), LAT_SOUTH_WHARF],
  ],
  'berth-2': [
    [W(12, 21), LAT_SOUTH_WHARF],
    [W(12, 10), LAT_SOUTH_WHARF],
  ],
  'berth-4': [
    [W(12, 21), LAT_NORTH_WHARF],
    [W(12, 12), LAT_NORTH_WHARF],
  ],
  'berth-5': [
    [W(12, 12), LAT_NORTH_WHARF],
    [W(12, 7), LAT_NORTH_WHARF],
  ],
  'navy-terminal': [
    [W(12, 22), LAT_NORTH_WHARF],
    [W(12, 22), dms(34, 9, 5)],
  ],
};
const mid = ([[lon1, lat1], [lon2, lat2]]) => ({
  lon: (lon1 + lon2) / 2,
  lat: (lat1 + lat2) / 2,
});

// Points are for display (surveyed where we have them); matching uses the
// wharf segment, since a ship lies along the wharf.
const surveyed = Object.fromEntries(
  Object.entries(SURVEYED)
    .filter(([key]) => /^berth\d+$/.test(key))
    .map(([key, [lat, lon]]) => [`berth-${key.slice(5)}`, { lon, lat }]),
);

export const HUENEME_BERTH_POINTS = Object.freeze(
  Object.entries(PLAN_SEGMENTS).map(([id, segment]) =>
    Object.freeze({
      id,
      ...(surveyed[id] ?? mid(segment)),
      segment,
      source: surveyed[id] ? `surveyed point; ${PLAN_SOURCE}` : PLAN_SOURCE,
    }),
  ),
);

/**
 * How each berth is used, from the Port & Terminal Plan (June 2025).
 * terminal: 'south' (Wharf 1) | 'north' (Wharf 2) | 'navy' (on Naval Base
 * Ventura County, not Port property; berthing needs Navy approval).
 * shorePower: in service in the baseline. The South Terminal system served
 * reefers until a storm destroyed it on 2023-12-21; its rebuild is due late
 * 2027 to early 2028. plannedShorePower: the North Terminal system, due Q1
 * 2028. A berth without shore power gets it only when a scenario adds it.
 */
export const HUENEME_BERTH_USE = Object.freeze({
  'berth-1': Object.freeze({
    terminal: 'south',
    mainUse: ['reefer', 'tanker'],
    shorePower: true,
    shorePowerOutage: Object.freeze({ from: '2023-12-21', to: null }),
  }),
  'berth-2': Object.freeze({
    terminal: 'south',
    mainUse: ['reefer', 'tanker'],
    shorePower: true,
    shorePowerOutage: Object.freeze({ from: '2023-12-21', to: null }),
  }),
  'berth-4': Object.freeze({
    terminal: 'north',
    mainUse: ['ro-ro'],
    shorePower: false,
    plannedShorePower: '2028-Q1',
  }),
  'berth-5': Object.freeze({
    terminal: 'north',
    mainUse: ['ro-ro'],
    shorePower: false,
    plannedShorePower: '2028-Q1',
  }),
  'berth-3': Object.freeze({
    terminal: null,
    mainUse: [],
    shorePower: false,
    note: 'not in the June 2025 terminal plan',
  }),
  // Berths 6-9 are the Navy Terminal (6 joint use, 7-9 Navy), matching the
  // asset registry. The plan gives only the terminal's overall wharf line, so
  // AIS places a stay there as 'navy-terminal', not a single berth.
  'berth-6': Object.freeze({
    terminal: 'navy',
    jointUse: true,
    mainUse: [],
    shorePower: false,
  }),
  'berth-7': Object.freeze({
    terminal: 'navy',
    mainUse: [],
    shorePower: false,
  }),
  'berth-8': Object.freeze({
    terminal: 'navy',
    mainUse: [],
    shorePower: false,
  }),
  'berth-9': Object.freeze({
    terminal: 'navy',
    mainUse: [],
    shorePower: false,
  }),
  'navy-terminal': Object.freeze({
    terminal: 'navy',
    berths: Object.freeze(['berth-6', 'berth-7', 'berth-8', 'berth-9']),
    mainUse: [],
    shorePower: false,
    note: 'low use: under 20 regulated calls a year (2021-2023)',
  }),
});

/** Berths whose shore power is in the baseline (the South Terminal system). */
export const HUENEME_SHORE_POWER_BERTHS = Object.freeze(
  Object.entries(HUENEME_BERTH_USE)
    .filter(([, b]) => b.shorePower)
    .map(([id]) => id),
);

/** Berths with shore power planned but not built (North Terminal, 2028). */
export const HUENEME_PLANNED_SHORE_POWER_BERTHS = Object.freeze(
  Object.entries(HUENEME_BERTH_USE)
    .filter(([, b]) => b.plannedShorePower)
    .map(([id]) => id),
);
