import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RATE_SHEETS, demandDriver, rateSheetInput } from '../demandDriver.js';
import { HUENEME_REGISTRY } from '../hueneme.js';
import { runScenario } from '../scenario.js';
import { scenarioFromDecisions, twinFrame } from '../twin/frame.js';
import { TWIN_LAYOUT } from '../twin/layout.js';
import { allocateScenario } from './allocate.js';
import {
  buildNetwork,
  networkCard,
  networkFlows,
  pathLength,
  pointAlong,
} from './network.js';
import {
  PLUGS_PER_GANG,
  plugCard,
  plugKwhToday,
  plugLayout,
  plugTelemetry,
} from './plugs.js';
import { dayProfile, meterKwAt } from './profile.js';
import { SAMPLE_REGISTRY } from './registry.js';

const specs = HUENEME_REGISTRY.specs;
const result = runScenario(
  scenarioFromDecisions({ shorePower: true, utrs: 'electric' }),
);
const allocation = allocateScenario(result, SAMPLE_REGISTRY, specs);
const plugMap = plugLayout(SAMPLE_REGISTRY);
const network = buildNetwork(SAMPLE_REGISTRY, TWIN_LAYOUT, plugMap);
const busiest = result.siteKw.indexOf(Math.max(...result.siteKw));

test('reefer plugs are laid out in racks of twenty behind their meter', () => {
  assert.equal(plugMap.plugs.length, 120);
  assert.equal(plugMap.gangs.length, 120 / PLUGS_PER_GANG);
  assert.ok(plugMap.plugs.every((p) => p.meterId === 'sample-reefers'));
  assert.equal(new Set(plugMap.plugs.map((p) => p.id)).size, 120);
});

test('plug telemetry adds up to the meter and repeats', () => {
  for (const kw of [0, 40, 310, 900]) {
    const readings = plugTelemetry(plugMap.plugs, 1234, kw);
    const total = [...readings.values()].reduce((acc, r) => acc + r.kw, 0);
    assert.ok(Math.abs(total - kw) < 1e-6, `sum ${total} for ${kw}`);
  }
  const a = plugTelemetry(plugMap.plugs, 777, 300);
  const b = plugTelemetry(plugMap.plugs, 777, 300);
  assert.deepEqual([...a.values()], [...b.values()]);
  const states = new Set([...a.values()].map((r) => r.state));
  assert.ok(states.has('empty') && states.has('cooling'));
});

test('a plug card shows state, temperatures and where it is fed from', () => {
  const readings = plugTelemetry(plugMap.plugs, 777, 300);
  const reading = [...readings.values()].find((r) => r.state === 'cooling');
  const kwh = plugKwhToday(plugMap.plugs, reading.plug.id, 777, () => 300);
  assert.ok(kwh > 0);
  const card = plugCard(reading, {
    meterLabel: 'Reefer rows',
    kwhToday: kwh,
    rackKw: 60,
  });
  const labels = card.rows.map(([label]) => label);
  for (const label of ['Set point', 'Power now', 'Fed from', 'Source'])
    assert.ok(labels.includes(label), label);
  assert.match(card.rows.at(-1)[1], /Simulated/);
});

test('the network reaches every meter and the loads behind them', () => {
  const ids = new Set(network.edges.map((e) => e.id));
  for (const meter of SAMPLE_REGISTRY.meters)
    assert.ok(ids.has(`service:${meter.id}`), meter.id);
  const kinds = new Set(network.nodes.map((n) => n.kind));
  for (const kind of ['feed', 'transformer', 'vault', 'outlet', 'charger', 'rack'])
    assert.ok(kinds.has(kind), kind);
  // Every route is drawn at right angles: each leg keeps a latitude or a
  // longitude.
  for (const edge of network.edges.filter((e) => e.kind !== 'feeder' || e.id !== 'feeder:riser'))
    for (let i = 1; i < edge.path.length; i += 1)
      assert.ok(
        edge.path[i][0] === edge.path[i - 1][0] ||
          edge.path[i][1] === edge.path[i - 1][1],
        edge.id,
      );
});

test('flows conserve power from the feed down to the branches', () => {
  const meterKw = new Map(
    SAMPLE_REGISTRY.meters.map((m) => [
      m.id,
      meterKwAt(m, allocation, result, busiest),
    ]),
  );
  const total = [...meterKw.values()].reduce((a, b) => a + b, 0);
  const rackKw = new Map();
  for (const r of plugTelemetry(
    plugMap.plugs,
    busiest,
    meterKw.get('sample-reefers'),
  ).values())
    rackKw.set(r.plug.gangId, (rackKw.get(r.plug.gangId) ?? 0) + r.kw);
  const flows = networkFlows(network, {
    meterKw,
    frame: twinFrame(result, busiest),
    rackKw,
  });
  assert.ok(Math.abs(flows.get('feeder:riser').kw - total) < 1e-6);
  for (const meter of SAMPLE_REGISTRY.meters) {
    const branches = network.edges.filter(
      (e) => e.kind === 'branch' && e.meterId === meter.id,
    );
    if (!branches.length) continue;
    const sum = branches.reduce((acc, e) => acc + flows.get(e.id).kw, 0);
    assert.ok(Math.abs(sum - meterKw.get(meter.id)) < 1e-6, meter.id);
  }
  // The day graph and the network agree on the port's load.
  const profile = dayProfile(SAMPLE_REGISTRY, allocation, result, busiest);
  assert.ok(Math.abs(profile.nowKw - total) < 1e-6);
  const card = networkCard(network, flows, SAMPLE_REGISTRY, {
    kind: 'node',
    id: 'feed',
  });
  assert.match(card.rows[0][1], /kW/);
});

test('a service over its rating is flagged', () => {
  const meterKw = new Map([['sample-utr-chargers', 5000]]);
  const flows = networkFlows(network, { meterKw });
  assert.equal(flows.get('service:sample-utr-chargers').over, true);
  assert.equal(flows.get('service:sample-warehouse').over, false);
});

test('points along a path run from its start to its end', () => {
  const path = [
    [34.1, -119.2],
    [34.1, -119.19],
    [34.11, -119.19],
  ];
  assert.deepEqual(pointAlong(path, 0), path[0]);
  assert.deepEqual(pointAlong(path, 1), path[2]);
  assert.ok(pathLength(path) > 1900 && pathLength(path) < 2100);
});

test('rate sheets map to tariffs and change the bill', () => {
  assert.deepEqual(rateSheetInput('nope'), rateSheetInput('tou8'));
  const bill = (rate) =>
    runScenario(scenarioFromDecisions({ utrs: 'electric', rate })).totals;
  const tou8 = bill('tou8');
  const ev9 = bill('ev9');
  const ev9demand = bill('ev9demand');
  assert.ok(tou8.demandCost > 0);
  assert.equal(ev9.demandCost, 0);
  assert.ok(ev9demand.electricityCost > ev9.electricityCost);
  assert.equal(Object.keys(RATE_SHEETS).length, 4);
});

test('the demand driver names the peak interval and what caused it', () => {
  const driver = demandDriver(result, specs);
  assert.equal(driver.billed, true);
  assert.equal(driver.months.length, 12);
  const { top } = driver;
  assert.equal(result.meterKw[top.step], top.kw);
  assert.equal(result.calendar[top.step].month, top.month);
  assert.ok(top.causes.length > 0);
  const drawn = top.causes.reduce((acc, c) => acc + c.kw, 0);
  assert.ok(Math.abs(drawn - top.kw) < 1, `${drawn} vs ${top.kw}`);
  assert.ok(top.perKw > 0 && top.hoursAtPeak > 0);
  const quiet = demandDriver(
    runScenario(scenarioFromDecisions({ rate: 'ev9' })),
    specs,
  );
  assert.equal(quiet.billed, false);
  assert.ok(quiet.top);
});

test('the site map has structures, roads and credit for its source', () => {
  const site = JSON.parse(
    readFileSync(
      new URL('../../../public/data/port/hueneme-site.json', import.meta.url),
      'utf8',
    ),
  );
  assert.match(site.source, /OpenStreetMap/);
  assert.ok(site.structures.length > 50 && site.roads.length > 50);
  for (const item of site.structures) {
    assert.ok(item.outline.length >= 3 && item.height > 0);
    for (const [lat, lon] of item.outline)
      assert.ok(lat > 34.13 && lat < 34.16 && lon < -119.19 && lon > -119.22);
  }
});
