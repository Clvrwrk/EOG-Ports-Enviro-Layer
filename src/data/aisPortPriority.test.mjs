import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aisStreamRows,
  ingestAisStreamEnvelope,
  isPortPriorityPosition,
} from '../../server/providers/vessels/ais-store.js';

const report = (mmsi, latitude, longitude) => ({
  MessageType: 'PositionReport',
  Message: { PositionReport: { UserID: Number(mmsi), Sog: 0, Cog: 0 } },
  MetaData: {
    MMSI: mmsi,
    latitude,
    longitude,
    time_utc: '2026-11-06 06:00:00.000000000 +0000 UTC',
  },
});

test('positions in a port approach area are priority, elsewhere not', () => {
  assert.equal(isPortPriorityPosition(34.15, -119.21), true);
  assert.equal(isPortPriorityPosition(53.4, 6.2), false);
  assert.equal(isPortPriorityPosition(Number.NaN, -119.21), false);
});

test('port-area vessels come first even when newer traffic fills the cap', () => {
  ingestAisStreamEnvelope(report('366000001', 34.15, -119.21));
  for (let i = 0; i < 20; i += 1)
    ingestAisStreamEnvelope(report(String(244000100 + i), 53.4, 6.2 + i / 100));
  const rows = aisStreamRows(5);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].mmsi, '366000001');
  assert.equal(
    '_portPriority' in rows[0],
    false,
    'internal flag stays private',
  );
});
