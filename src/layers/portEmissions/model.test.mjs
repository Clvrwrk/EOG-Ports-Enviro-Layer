import assert from 'node:assert/strict';
import test from 'node:test';
import { PORT_OF_HUENEME } from '../../emissions/ports.js';
import {
  formatRange,
  geofenceShapes,
  portHeadline,
  portStats,
  vesselLabel,
} from './model.js';

test('ranges print as one number when both ends match', () => {
  assert.equal(formatRange([400, 800]), '400-800');
  assert.equal(formatRange([1080, 1080]), '1080');
  assert.equal(formatRange([0.0123, 0.0456], 3), '0.012-0.046');
});

test('the layer outlines the harbor and every berth', () => {
  const shapes = geofenceShapes(PORT_OF_HUENEME);
  assert.deepEqual(
    shapes.map((s) => s.role),
    ['harbor', 'berth'],
  );
});

test('the headline says what is modeled and waits for vessels', () => {
  assert.deepEqual(portHeadline(PORT_OF_HUENEME, null), [
    'PORT OF HUENEME',
    'Waiting for live AIS vessels',
  ]);
  const lines = portHeadline(PORT_OF_HUENEME, {
    byMode: { hotelling: 2, maneuvering: 1 },
    atBerthAuxKwNow: [900, 1880],
    hotellingHours: 12.34,
    tonnes: { nox: [0.01, 0.15], co2: [7.2, 7.9] },
  });
  assert.equal(lines[1], '2 at berth · 1 under way in the inventory area');
  assert.match(lines[2], /900-1880 kW \(modeled\)/);
  assert.match(lines[3], /12\.3 berth-hours, NOx 0\.01-0\.15 t/);
});

test('only ships at berth get a load label', () => {
  assert.equal(vesselLabel({ mode: 'transit', name: 'X' }), null);
  assert.equal(
    vesselLabel({ mode: 'hotelling', name: 'X', auxKw: [400, 800] }),
    'X · 400-800 kW aux (range)',
  );
  assert.equal(
    vesselLabel({
      mode: 'hotelling',
      name: 'X',
      auxKw: [1080, 1080],
      known: true,
    }),
    'X · 1080 kW aux',
  );
});

test('stats report idle, waiting and live states', () => {
  assert.equal(portStats(PORT_OF_HUENEME, null, false).status, 'idle');
  assert.equal(portStats(PORT_OF_HUENEME, null, true).status, 'degraded');
  assert.equal(
    portStats(
      PORT_OF_HUENEME,
      { vessels: [{}], byMode: { hotelling: 1 } },
      true,
    ).coverage,
    'Port of Hueneme · 1 at berth',
  );
});
