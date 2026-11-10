import assert from 'node:assert/strict';
import test from 'node:test';
import { CALL_PROFILE, SPECS } from '../hueneme.js';
import { runScenario } from '../scenario.js';
import { DEFAULT_DECISIONS, scenarioFromDecisions } from '../twin/frame.js';
import { SURVEYED, lonLatToOffset } from '../twin/layout.js';
import {
  MOVES_PER_CALL,
  MOVE_TYPES,
  PLACES,
  SEGMENT_KINDS,
  YARD_SPECS,
  YARD_ZONES,
  ZONE_METRICS,
  ZONE_TYPES,
  callsByType,
  electricShare,
  movesPerYear,
  segmentEnergy,
  yardModel,
  zoneCard,
} from './model.js';
import { chipColor } from './section.js';

const zoneIds = new Set(YARD_ZONES.map((zone) => zone.id));
const origin = { lat: SURVEYED.berth1[0], lon: SURVEYED.berth1[1] };

test('every zone has a known type, known move ends and a source', () => {
  assert.equal(zoneIds.size, YARD_ZONES.length, 'zone ids are unique');
  for (const zone of YARD_ZONES) {
    assert.ok(ZONE_TYPES[zone.type], zone.id);
    assert.ok(zone.source, zone.id);
    for (const ends of zone.places)
      for (const code of ends.split('>')) assert.ok(PLACES[code], ends);
  }
});

test('drawn zones sit at the port, within 1.5 km of berth 1', () => {
  for (const zone of YARD_ZONES.filter((z) => z.outline)) {
    assert.ok(zone.outline.length >= 3, zone.id);
    for (const point of zone.outline) {
      const { east, north } = lonLatToOffset(origin, point);
      assert.ok(Math.hypot(east, north) < 1500, `${zone.id} ${point}`);
    }
  }
});

test('every move segment names a known machine and zone', () => {
  for (const move of MOVE_TYPES) {
    assert.ok(move.segments.length > 0, move.id);
    for (const code of move.places.split('>')) assert.ok(PLACES[code], move.id);
    for (const segment of move.segments) {
      const kind = SEGMENT_KINDS[segment.kind];
      assert.ok(kind, `${move.id} ${segment.kind}`);
      assert.ok(SPECS[kind.specId] || YARD_SPECS[kind.specId], kind.specId);
      assert.ok(zoneIds.has(segment.zone), `${move.id} ${segment.zone}`);
      assert.ok(segment.minutes > 0, move.id);
    }
  }
  const codes = Object.values(SEGMENT_KINDS).map((k) => k.code);
  assert.equal(new Set(codes).size, codes.length, 'chip letters are unique');
});

test('moves per call only name known vessel types and move types', () => {
  const types = new Set(CALL_PROFILE.map((row) => row.type));
  const moves = new Set(MOVE_TYPES.map((m) => m.id));
  for (const [type, perCall] of Object.entries(MOVES_PER_CALL)) {
    if (type === 'source') continue;
    assert.ok(types.has(type), type);
    for (const [id, count] of Object.entries(perCall)) {
      assert.ok(moves.has(id), id);
      assert.ok(Number.isFinite(count) && count >= 0, id);
    }
  }
});

test('without a run, moves follow the call profile', () => {
  const calls = callsByType(null);
  const roro = CALL_PROFILE.find((r) => r.type === 'Ro-Ro/Vehicles Carrier');
  assert.equal(calls[roro.type], roro.callsPerYear);
  const moves = movesPerYear(null);
  assert.equal(moves['vehicle-in'], roro.callsPerYear * 1500);
});

test('segment energy splits a machine hour between grid and diesel', () => {
  const diesel = segmentEnergy('utr', 1, 0);
  assert.equal(diesel.kwh, 0);
  assert.equal(diesel.dieselGallons, SPECS.utr.dieselGph);
  assert.ok(diesel.noxKg > 0);
  const electric = segmentEnergy('utr', 1, 1);
  assert.equal(electric.kwh, SPECS.utr.kwhPerHour);
  assert.equal(electric.dieselGallons, 0);
  assert.equal(electric.noxKg, 0);
  assert.ok(electric.co2Kg < diesel.co2Kg);
  const car = segmentEnergy('drive', 1, 0);
  assert.equal(car.gasolineGallons, YARD_SPECS.cargo_vehicle.gasolineGph);
  assert.equal(segmentEnergy('nope', 1, 0).co2Kg, 0);
});

test('the yard model follows the scenario fleet mix', () => {
  const allDiesel = runScenario(
    scenarioFromDecisions({
      ...DEFAULT_DECISIONS,
      utrs: 'diesel',
      cranes: 'diesel',
    }),
  );
  const allElectric = runScenario(
    scenarioFromDecisions({
      ...DEFAULT_DECISIONS,
      utrs: 'electric',
      cranes: 'plug-in',
    }),
  );
  assert.equal(electricShare('utr', allDiesel), 0);
  assert.ok(electricShare('utr', allElectric) > 0.9);
  // Machines outside the scenario fleet keep their own share.
  assert.equal(
    electricShare('truck_on_terminal', allElectric),
    YARD_SPECS.truck_on_terminal.electricShare,
  );

  const dirty = yardModel(allDiesel);
  const clean = yardModel(allElectric);
  assert.equal(dirty.totals.moves, clean.totals.moves, 'same cargo');
  assert.ok(clean.totals.co2Kg < dirty.totals.co2Kg);
  assert.ok(clean.totals.kwh > dirty.totals.kwh);
  const yardOf = (model) =>
    model.zones.find((z) => z.id === 'zone-reefer-yard');
  assert.ok(yardOf(clean).totals.noxKg < yardOf(dirty).totals.noxKg);

  // Zone totals add up to the port total, and every move lands in a zone.
  const sum = clean.zones.reduce((acc, z) => acc + z.totals.co2Kg, 0);
  assert.ok(Math.abs(sum - clean.totals.co2Kg) < 1e-6 * clean.totals.co2Kg);
  const box = clean.moves.find((m) => m.id === 'reefer-box-in');
  const reeferCalls = callsByType(allElectric).Refrigerated;
  assert.equal(box.count, reeferCalls * 450);
  assert.equal(box.segments[1].code, 'U');
  assert.ok(box.perMove.co2Kg > 0);
  assert.ok(yardOf(clean).moves >= box.count);
});

test('zone cards and metrics read the model', () => {
  const model = yardModel(null);
  const apron = model.zones.find((z) => z.id === 'zone-apron-south');
  const card = zoneCard(apron, model);
  assert.equal(card.title, apron.label);
  const rows = Object.fromEntries(card.rows);
  assert.equal(rows.Type, 'Berth apron');
  assert.match(rows['Move types'], /Reefer box/);
  assert.equal(zoneCard(null, model), null);
  for (const metric of Object.values(ZONE_METRICS))
    for (const zone of model.zones) assert.ok(metric.of(zone) >= 0);
  const lot = model.zones.find((z) => z.id === 'zone-auto-lot');
  assert.match(Object.fromEntries(zoneCard(lot, model).rows).Outline, /survey/);
});

test('segment chips run from diesel orange to electric green', () => {
  assert.equal(chipColor(0), 'rgb(255,140,58)');
  assert.equal(chipColor(1), 'rgb(124,255,138)');
});
