// Ship points for Hueneme's berths, for naming the berth a ship tied up at.
// Ids match the scenario registry (src/portos/hueneme.js). Berths 1 and 2 are
// the points port staff surveyed for the twin (src/portos/twin/layout.js);
// berths without a surveyed point are left out until they are surveyed, so an
// unmatched stay reads as "berth unknown" rather than a guess.

import { SURVEYED } from '../portos/twin/layout.js';

export const HUENEME_BERTH_POINTS = Object.freeze(
  Object.entries(SURVEYED)
    .filter(([key]) => /^berth\d+$/.test(key))
    .map(([key, [lat, lon]]) =>
      Object.freeze({ id: `berth-${key.slice(5)}`, lon, lat }),
    ),
);

/**
 * How each berth is used, from Port of Hueneme staff (via Chris, 2026-11-10).
 * operator: 'poh' | 'shared' (US Navy and POH) | 'navy'. Navy-only berths are
 * outside the port's own call inventory.
 */
export const HUENEME_BERTH_USE = Object.freeze({
  'berth-1': Object.freeze({ operator: 'poh', mainUse: null }),
  'berth-2': Object.freeze({ operator: 'poh', mainUse: null }),
  'berth-3': Object.freeze({
    operator: 'poh',
    mainUse: null,
    note: 'not used very often',
  }),
  'berth-4': Object.freeze({ operator: 'poh', mainUse: 'ro-ro' }),
  'berth-5': Object.freeze({ operator: 'shared', mainUse: null }),
  'berth-6': Object.freeze({ operator: 'shared', mainUse: null }),
  'berth-7': Object.freeze({ operator: 'navy', mainUse: null }),
  'berth-8': Object.freeze({ operator: 'navy', mainUse: null }),
  'berth-9': Object.freeze({ operator: 'navy', mainUse: null }),
});
