import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PORT_OF_HUENEME,
  distanceNm,
  pointInRing,
  portForPath,
  portPath,
  zoneFor,
} from './ports.js';

test('port URLs follow /<category>/<state>/<name>', () => {
  assert.equal(portPath(PORT_OF_HUENEME), '/ports/california/port-of-hueneme');
  assert.equal(
    portForPath('/ports/california/port-of-hueneme'),
    PORT_OF_HUENEME,
  );
  assert.equal(
    portForPath('/Ports/California/Port-of-Hueneme/'),
    PORT_OF_HUENEME,
  );
  assert.equal(portForPath('/ports/california'), null);
  assert.equal(portForPath('/ports/texas/port-of-hueneme'), null);
  assert.throws(
    () => portPath({ category: 'ports', state: 'new york', slug: 'x' }),
    /Invalid port path segment/,
  );
});

test('geofence rings are closed and the berths sit inside the harbor', () => {
  const g = PORT_OF_HUENEME.geofences;
  for (const ring of [g.harbor, ...g.berths, ...g.anchorages]) {
    assert.deepEqual(ring[0], ring.at(-1));
    assert.ok(ring.length >= 4);
  }
  // Berths are clipped from the harbor, so a vertex may sit on its edge.
  const onEdge = (lon, lat) =>
    g.harbor.some(([x1, y1], i) => {
      const [x2, y2] = g.harbor[(i + 1) % g.harbor.length];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((lon - x1) * (x2 - x1) + (lat - y1) * (y2 - y1)) /
            ((x2 - x1) ** 2 + (y2 - y1) ** 2 || 1),
        ),
      );
      const px = x1 + t * (x2 - x1);
      const py = y1 + t * (y2 - y1);
      return distanceNm(lon, lat, px, py) * 1852 < 2;
    });
  for (const ring of g.berths) {
    for (const [lon, lat] of ring) {
      assert.ok(
        pointInRing(lon, lat, g.harbor) || onEdge(lon, lat),
        `berth vertex ${lon},${lat} lies outside the harbor`,
      );
    }
  }
  assert.equal(g.status, 'osm-derived');
  assert.match(g.source.license, /ODbL/);
});

test('zones resolve from berth outward to the inventory boundary', () => {
  assert.equal(zoneFor(PORT_OF_HUENEME, -119.209, 34.151), 'berth');
  assert.equal(zoneFor(PORT_OF_HUENEME, -119.2095, 34.0428), 'approach');
  assert.equal(zoneFor(PORT_OF_HUENEME, -119.2095, 33.4), null);
});

test('small-distance approximation is about 60 nm per degree of latitude', () => {
  const d = distanceNm(-119.2, 34, -119.2, 35);
  assert.ok(Math.abs(d - 60) < 1e-9);
});

test('validation targets keep the published 2019 totals', () => {
  const v2019 = PORT_OF_HUENEME.validation.find((v) => v.year === 2019);
  assert.equal(v2019.categories.oceanGoingVessels.noxTons, 121);
  assert.equal(v2019.categories.total.co2eTonnes, 17905);
});
