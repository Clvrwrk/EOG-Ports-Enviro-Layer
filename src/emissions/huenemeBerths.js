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
