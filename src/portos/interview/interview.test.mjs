import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveredSupply } from '../delivered.js';
import { runScenario } from '../scenario.js';
import {
  decodeScenario,
  encodeScenario,
  normalizeScenario,
  summarize,
} from '../scenarioStore.js';
import { TARIFFS, adjustTariff } from '../tariffs.js';
import { yearSteps } from '../touCalendar.js';
import {
  applyPatch,
  describeChanges,
  guidedAnswer,
  guidedStart,
  numberIn,
} from './interviewCore.js';

const base = runScenario({});

test('adjustTariff scales energy and demand charges, deferred ones too', () => {
  const tou8 = TARIFFS['SCE-TOU-8-D'];
  const up = adjustTariff(tou8, { energyPct: 10, demandPct: 50 });
  assert.equal(up.energy.summer.on, tou8.energy.summer.on * 1.1);
  assert.equal(up.demand.facilitiesPerKw, tou8.demand.facilitiesPerKw * 1.5);
  assert.equal(
    up.demand.timeRelated[0].perKw,
    tou8.demand.timeRelated[0].perKw * 1.5,
  );
  assert.match(up.name, /energy \+10%, demand \+50%/);
  const ev = adjustTariff(TARIFFS['SCE-TOU-EV-9'], { demandPct: 100 });
  assert.equal(
    ev.demand.deferred.facilitiesPerKw,
    TARIFFS['SCE-TOU-EV-9'].demand.deferred.facilitiesPerKw * 2,
  );
  assert.equal(adjustTariff(tou8, { energyPct: 0 }), tou8);
});

test('a rate change moves the bill and nothing else', () => {
  const run = runScenario({ tariffAdjust: { energyPct: 20, demandPct: 0 } });
  assert.ok(Math.abs(run.totals.energyCost - base.totals.energyCost * 1.2) < 1);
  assert.equal(run.totals.demandCost, base.totals.demandCost);
  assert.equal(run.totals.kwh, base.totals.kwh);
});

test('delivered energy covering 45% of load cuts meter energy by 45%', () => {
  const run = runScenario({
    delivered: { sharePct: 45, profile: 'share', pricePerKwh: 0.12 },
  });
  const t = run.totals;
  assert.ok(Math.abs(t.deliveredKwh / t.siteKwh - 0.45) < 1e-9);
  assert.ok(Math.abs(t.kwh - base.totals.kwh * 0.55) < 1);
  assert.ok(Math.abs(t.peakKw - base.totals.peakKw * 0.55) < 1);
  assert.ok(Math.abs(t.deliveredCost - t.deliveredKwh * 0.12) < 1e-6);
  assert.ok(t.electricityCost < base.totals.electricityCost);
  assert.equal(
    summarize(run).spend,
    t.electricityCost + t.deliveredCost + t.dieselCost,
  );
});

test('shaped supply never exports and reports what it curtails', () => {
  const calendar = yearSteps(2026);
  const load = new Float64Array(calendar.length).fill(100);
  for (const profile of ['baseload', 'solar', 'peak']) {
    const out = deliveredSupply(load, calendar, {
      sharePct: 45,
      profile,
      pricePerKwh: 0,
    });
    for (const value of out.kw) assert.ok(value <= 100 + 1e-9);
    assert.ok(
      Math.abs(out.kwh + out.curtailedKwh - out.targetKwh) < 1e-6,
      profile,
    );
  }
  const flat = deliveredSupply(load, calendar, {
    sharePct: 45,
    profile: 'baseload',
  });
  assert.ok(Math.abs(flat.kw[0] - 45) < 1e-9);
  assert.equal(flat.curtailedKwh, 0);
});

test('new fields survive cleaning and share links', () => {
  const scenario = normalizeScenario({
    tariffAdjust: { energyPct: 12.34, demandPct: 999 },
    delivered: { sharePct: 45, profile: 'nonsense', pricePerKwh: 0.14 },
  });
  assert.deepEqual(scenario.tariffAdjust, {
    energyPct: 12.3,
    demandPct: 300,
    customerPct: 0,
  });
  assert.deepEqual(scenario.delivered, {
    sharePct: 45,
    profile: 'share',
    pricePerKwh: 0.14,
  });
  assert.deepEqual(decodeScenario(encodeScenario(scenario)), scenario);
  assert.equal(
    normalizeScenario({ delivered: { sharePct: 0 } }).delivered,
    null,
  );
  assert.equal(
    normalizeScenario({ tariffAdjust: { energyPct: 0 } }).tariffAdjust,
    null,
  );
});

test('applyPatch merges nested objects and fleet rows', () => {
  let s = normalizeScenario({});
  s = applyPatch(s, { delivered: { sharePct: 45 } });
  s = applyPatch(s, { delivered: { profile: 'solar', pricePerKwh: 0.1 } });
  assert.deepEqual(s.delivered, {
    sharePct: 45,
    profile: 'solar',
    pricePerKwh: 0.1,
  });
  s = applyPatch(s, { fleet: { utr: { electric: 27, diesel: 0 } } });
  s = applyPatch(s, { fleet: { utr: { chargers: 14 } }, bogus: 1 });
  assert.deepEqual(s.fleet.utr, { electric: 27, diesel: 0, chargers: 14 });
  assert.equal('bogus' in s, false);
  s = applyPatch(s, { delivered: null });
  assert.equal(s.delivered, null);
  assert.deepEqual(describeChanges({}, { tariffAdjust: { energyPct: 8 } }), [
    'Rate change: energy +8%',
  ]);
});

test('numberIn reads percents and prices', () => {
  assert.equal(numberIn('+12%'), 12);
  assert.equal(numberIn('-10%'), -10);
  assert.equal(numberIn('$0.14/kWh'), 0.14);
  assert.equal(numberIn('1,500 kW'), 1500);
  assert.equal(numberIn('Not known yet'), null);
});

/** Drive the guided interview with a list of answers. */
function interview(answers) {
  let scenario = normalizeScenario({});
  let { state, turn } = guidedStart(scenario);
  const asked = [turn.question];
  for (const text of answers) {
    ({ state, turn } = guidedAnswer(state, text, scenario));
    scenario = applyPatch(scenario, turn.patch);
    asked.push(turn.question);
    if (turn.done) break;
  }
  return { scenario, turn, asked };
}

test('guided: a small change is a short interview', () => {
  const { scenario, turn, asked } = interview([
    'Electricity rate change',
    'Energy rates',
    '+12%',
    'Finish',
  ]);
  assert.equal(turn.done, true);
  assert.equal(asked.length, 5);
  assert.equal(scenario.tariffAdjust.energyPct, 12);
  assert.equal(turn.name, 'Rate change');
});

test('guided: each answer picks the next question', () => {
  const energy = interview(['Electricity rate change', 'Energy rates']);
  const demand = interview(['Electricity rate change', 'Demand charges']);
  const both = interview(['Electricity rate change', 'Both', '+5%']);
  assert.match(energy.asked.at(-1), /energy rates/);
  assert.match(demand.asked.at(-1), /demand charges/);
  assert.match(both.asked.at(-1), /demand charges/);
  const swap = interview([
    'Electricity rate change',
    'Switch to another rate',
    TARIFFS['SCE-TOU-EV-9'].name,
  ]);
  assert.match(swap.asked.at(-1), /CPUC/);
});

test('guided: delivered energy for 45% of load plus fleet electrification', () => {
  const { scenario, turn } = interview([
    'Delivered energy (PPA, solar, microgrid)',
    '45%',
    'Fuel cell or firm PPA (around the clock)',
    '$0.14',
    'Electrify equipment',
    'UTRs (yard tractors)',
    'All of it',
    'Avoid the 4-9 p.m. peak',
    'Finish',
  ]);
  assert.equal(turn.done, true);
  assert.deepEqual(scenario.delivered, {
    sharePct: 45,
    profile: 'baseload',
    pricePerKwh: 0.14,
  });
  assert.equal(scenario.fleet.utr.diesel, 0);
  assert.equal(scenario.fleet.utr.electric, 27);
  assert.equal(scenario.strategy, 'avoid-peak');
  assert.equal(turn.name, 'Delivered energy + electrified fleet');
  const run = runScenario(scenario);
  assert.ok(run.totals.deliveredKwh > 0);
  assert.ok(run.totals.dieselGallons < base.totals.dieselGallons);
});

test('guided: an unreadable answer asks again', () => {
  const { asked, scenario } = interview([
    'Change in ship calls (trade, new service)',
    'lots',
  ]);
  assert.match(asked.at(-1), /ship calls change/);
  assert.equal(scenario.callScale, 1);
});
