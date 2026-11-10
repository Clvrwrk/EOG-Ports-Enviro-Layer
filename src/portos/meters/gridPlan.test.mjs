import assert from 'node:assert/strict';
import test from 'node:test';
import { TWIN_LAYOUT } from '../twin/layout.js';
import {
  MAX_BENDS,
  TRANSFORMER_KVA,
  bendIndexFor,
  emptyGridPlan,
  gridPlanEdits as edits,
  normalizeGridPlan,
  sourceLabel,
} from './gridPlan.js';
import { loadGridPlan, saveGridPlan } from './gridPlanStore.js';
import {
  buildNetwork,
  edgeLabel,
  networkCard,
  networkFlows,
} from './network.js';
import { plugLayout } from './plugs.js';
import { SAMPLE_REGISTRY } from './registry.js';

const plugMap = plugLayout(SAMPLE_REGISTRY);
const auto = buildNetwork(SAMPLE_REGISTRY, TWIN_LAYOUT, plugMap);
const meterIds = SAMPLE_REGISTRY.meters.map((m) => m.id);
const somewhere = [34.1485, -119.2085];

test('a plan keeps only what the formulas can read', () => {
  const { plan, problems } = normalizeGridPlan({
    feedAt: ['34.1', -119.2],
    sources: [
      { id: 'T1', at: [34.14812345678, -119.2], kva: 1500 },
      { id: 'T2', at: [34.15, -119.21], kva: 'three' },
      { id: 'T1', at: [34.15, -119.21], kva: 500 },
      { id: 'T3', at: 'by the gate' },
    ],
    fedFrom: { 'sample-reefers': 'T1', 'sample-shore': 'T9' },
    routes: {
      'service:sample-reefers': [[34.1, -119.2]],
      'bad route': [[34.1, -119.2]],
      'service:sample-shore': [[34.1, 'west']],
    },
  });
  assert.equal(plan.feedAt, null);
  assert.deepEqual(plan.sources, [
    { id: 'T1', at: [34.1481235, -119.2], kva: 1500 },
    { id: 'T2', at: [34.15, -119.21], kva: null },
  ]);
  assert.deepEqual(plan.fedFrom, { 'sample-reefers': 'T1' });
  assert.deepEqual(Object.keys(plan.routes), ['service:sample-reefers']);
  assert.equal(problems.length, 7);
  assert.deepEqual(normalizeGridPlan(null), {
    plan: emptyGridPlan(),
    problems: [],
  });
  // A clean plan comes back unchanged and without problems.
  assert.deepEqual(normalizeGridPlan(plan, { meterIds }), {
    plan,
    problems: [],
  });
});

test('a new bend lands on the stretch of the line it is nearest to', () => {
  const path = [
    [0, 0],
    [0, 1],
    [1, 1],
  ];
  assert.equal(bendIndexFor(path, [0.01, 0.5]), 0);
  assert.equal(bendIndexFor(path, [0.5, 1.01]), 1);
  const edge = auto.edges.find((e) => e.kind === 'service');
  let plan = edits.addBend(emptyGridPlan(), edge.id, edge.path, somewhere);
  const bends = plan.routes[edge.id];
  assert.equal(bends.length, edge.path.length - 2 + 1);
  assert.ok(bends.some((p) => p[0] === somewhere[0] && p[1] === somewhere[1]));
  const drawn = buildNetwork(SAMPLE_REGISTRY, TWIN_LAYOUT, plugMap, plan);
  const redrawn = drawn.edges.find((e) => e.id === edge.id);
  assert.equal(redrawn.drawn, true);
  // The ends stay where the line connects.
  assert.deepEqual(redrawn.path[0], edge.path[0]);
  assert.deepEqual(redrawn.path.at(-1), edge.path.at(-1));
  assert.deepEqual(redrawn.path.slice(1, -1), bends);
  const index = bends.findIndex((p) => p[0] === somewhere[0]);
  plan = edits.moveBend(plan, edge.id, redrawn.path, index, [34.149, -119.209]);
  assert.deepEqual(plan.routes[edge.id][index], [34.149, -119.209]);
  plan = edits.removeBend(
    plan,
    edge.id,
    [redrawn.path[0], ...plan.routes[edge.id], redrawn.path.at(-1)],
    index,
  );
  assert.equal(plan.routes[edge.id].length, bends.length - 1);
  plan = edits.resetRoute(plan, edge.id);
  assert.deepEqual(plan, emptyGridPlan());
  // A line cannot grow past the limit.
  const long = [[0, 0], ...Array(MAX_BENDS).fill([0, 0.5]), [0, 1]];
  const full = emptyGridPlan();
  assert.equal(edits.addBend(full, 'x', long, [0, 0.2]), full);
});

test('an incoming transformer takes its meters off the backbone', () => {
  let plan = edits.addSource(emptyGridPlan(), somewhere);
  assert.equal(plan.sources[0].id, 'T1');
  assert.equal(sourceLabel(plan.sources[0]), 'Incoming transformer 1');
  plan = edits.sizeSource(plan, 'T1', TRANSFORMER_KVA[3]);
  assert.equal(
    sourceLabel(plan.sources[0]),
    'Incoming transformer 1 (500 kVA)',
  );
  assert.equal(edits.sizeSource(plan, 'T1', 123).sources[0].kva, null);
  plan = edits.feedMeter(plan, 'sample-reefers', 'T1');
  assert.equal(edits.feedMeter(plan, 'sample-reefers', 'T1'), plan);
  const network = buildNetwork(SAMPLE_REGISTRY, TWIN_LAYOUT, plugMap, plan);
  const feeder = network.edges.find((e) => e.id === 'feeder:source:T1');
  assert.equal(feeder.from, 'feed');
  assert.equal(feeder.capacityKw, 500);
  assert.deepEqual(feeder.meterIds, ['sample-reefers']);
  const service = network.edges.find((e) => e.id === 'service:sample-reefers');
  assert.equal(service.from, 'source:T1');
  assert.deepEqual(service.path[0], somewhere);
  assert.match(edgeLabel(network, SAMPLE_REGISTRY, feeder), /transformer 1/);
  // Every meter is still reached exactly once.
  const services = network.edges.filter((e) => e.kind === 'service');
  assert.equal(
    services.length,
    auto.edges.filter((e) => e.kind === 'service').length,
  );
  // Power is conserved, and the transformer is flagged past its size.
  const meterKw = new Map(meterIds.map((id) => [id, 100]));
  meterKw.set('sample-reefers', 700);
  const flows = networkFlows(network, { meterKw });
  assert.equal(flows.get(feeder.id).kw, 700);
  assert.equal(flows.get(feeder.id).over, true);
  const fromFeed = network.edges
    .filter((e) => e.from === 'feed')
    .reduce((sum, e) => sum + flows.get(e.id).kw, 0);
  assert.ok(Math.abs(fromFeed - (700 + 100 * (meterIds.length - 1))) < 1e-6);
  const card = networkCard(network, flows, SAMPLE_REGISTRY, {
    kind: 'node',
    id: 'source:T1',
  });
  assert.match(card.title, /Incoming transformer 1/);
  // Removing it sends the meter back to the backbone.
  const back = edits.removeSource(plan, 'T1');
  assert.deepEqual(back.fedFrom, {});
  assert.deepEqual(
    buildNetwork(SAMPLE_REGISTRY, TWIN_LAYOUT, plugMap, back).edges.map(
      (e) => e.id,
    ),
    auto.edges.map((e) => e.id),
  );
});

test('the feed can be moved and the backbone cannot be hand-drawn', () => {
  const plan = edits.moveFeed(emptyGridPlan(), somewhere);
  const network = buildNetwork(SAMPLE_REGISTRY, TWIN_LAYOUT, plugMap, plan);
  assert.deepEqual(network.nodes.find((n) => n.id === 'feed').at, somewhere);
  assert.ok(network.edges.some((e) => e.fixed));
  assert.ok(
    network.edges
      .filter((e) => e.fixed)
      .every((e) => /^feeder:\d+$/.test(e.id)),
  );
});

test('the plan is read from the server, or this browser without one', async () => {
  const plan = edits.addSource(emptyGridPlan(), somewhere);
  const json = (body, ok = true, status = 200) => ({
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  });
  const server = await loadGridPlan('port-of-hueneme', async () =>
    json({ plan, rev: 4, canSave: true, updatedBy: 'a@portofh.org' }),
  );
  assert.deepEqual(server, {
    plan,
    rev: 4,
    where: 'server',
    updatedBy: 'a@portofh.org',
  });
  const reader = await loadGridPlan('port-of-hueneme', async () =>
    json({ plan, rev: 4, canSave: false }),
  );
  assert.equal(reader.where, 'browser');
  assert.deepEqual(reader.plan, plan);
  const offline = await loadGridPlan('port-of-hueneme', async () => {
    throw new Error('offline');
  });
  assert.deepEqual(offline.plan, emptyGridPlan());
  let sent = null;
  const saved = await saveGridPlan(
    { plan, rev: 4, where: 'server' },
    'port-of-hueneme',
    async (url, init) => {
      sent = { url, init };
      return json({ rev: 5 });
    },
  );
  assert.deepEqual(saved, { ok: true, rev: 5, where: 'server' });
  assert.equal(sent.init.method, 'PUT');
  assert.equal(sent.init.headers['X-Portos-Admin'], '1');
  assert.deepEqual(JSON.parse(sent.init.body), { plan, rev: 4 });
  const stale = await saveGridPlan(
    { plan, rev: 1, where: 'server' },
    'port-of-hueneme',
    async () => json({ error: 'changed' }, false, 409),
  );
  assert.deepEqual(stale, { ok: false, error: 'changed', problems: undefined });
});
