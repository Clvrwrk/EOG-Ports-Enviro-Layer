#!/usr/bin/env node
// Rebuild Hueneme ship calls from NOAA MarineCadastre AIS extracts and print
// each call's timeline and emissions under a baseline and a scenario.
//
// Usage: node scripts/ais/reconstruct-calls.mjs <file.csv[.gz]> [...more]
//        [--json out.json]
// Cut daily files to the port first with tools/ais/extract_marinecadastre.py.

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  groupByVessel,
  parseMarineCadastreRow,
  splitCalls,
} from '../../src/emissions/aisCalls.js';
import {
  craftRoleFor,
  reconstructCall,
} from '../../src/emissions/callEvents.js';
import { callEmissions } from '../../src/emissions/callEmissions.js';
import { HUENEME_BERTH_POINTS } from '../../src/emissions/huenemeBerths.js';
import { PORT_OF_HUENEME } from '../../src/emissions/ports.js';
import {
  OGV_AIS_FAMILIES,
  aisFamily,
} from '../../src/emissions/vesselRegistry.js';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;

function readCsv(path) {
  const buf = readFileSync(path);
  const text = (path.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8');
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const cols = head.split(',');
  return lines.map((line) => {
    const v = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
  });
}

const records = args
  .flatMap(readCsv)
  .map(parseMarineCadastreRow)
  .filter(Boolean);
let dataStartMs = Infinity;
let dataEndMs = -Infinity;
for (const r of records) {
  if (r.t < dataStartMs) dataStartMs = r.t;
  if (r.t > dataEndMs) dataEndMs = r.t;
}
const byVessel = groupByVessel(records);
const info = new Map();
for (const r of records) {
  const cur = info.get(r.mmsi) ?? {};
  info.set(r.mmsi, {
    name: cur.name ?? r.name,
    aisVesselType: cur.aisVesselType ?? r.aisVesselType,
    lengthM: cur.lengthM ?? r.lengthM,
    imo: cur.imo ?? r.imo,
  });
}

const craft = [];
for (const [mmsi, recs] of byVessel) {
  const role = craftRoleFor(info.get(mmsi));
  if (role)
    craft.push({
      mmsi,
      name: info.get(mmsi).name,
      role,
      records: recs.sort((a, b) => a.t - b.t),
    });
}

const iso = (ms) =>
  Number.isFinite(ms)
    ? new Date(ms).toISOString().slice(5, 16).replace('T', ' ')
    : '—';
const h = (x) => (x === null || x === undefined ? '—' : x.toFixed(2));
const out = [];

console.log(
  `craft seen: ${craft.map((c) => `${c.name ?? c.mmsi} (${c.role})`).join(', ') || 'none'}`,
);
for (const [mmsi, recs] of byVessel) {
  const meta = info.get(mmsi);
  if (craftRoleFor(meta)) continue;
  if (!OGV_AIS_FAMILIES.includes(aisFamily(meta.aisVesselType))) continue;
  // Family 6 also holds crew and passenger boats; ocean-going ships only.
  if (!(meta.lengthM >= 100)) continue;
  for (const call of splitCalls(recs, PORT_OF_HUENEME)) {
    if (call.kind !== 'port-call') continue;
    const rebuilt = reconstructCall(call, craft, {
      berthPoints: HUENEME_BERTH_POINTS,
      shipLengthM: meta.lengthM,
      dataStartMs,
      dataEndMs,
    });
    if (rebuilt.milestones.allFastMs === null) continue;
    // Placeholder until ships are matched to the inventory's particulars: a
    // 2010 reefer with a 12 MW main engine, service speed 21 kn.
    const vessel = {
      shipType: 'Reefer',
      subtype: 'All Reefer',
      keelYear: 2010,
      propulsion: { engineType: 'SSD', installedKw: 12000, serviceSpeedKn: 21 },
    };
    const base = callEmissions(call, rebuilt, { vessel });
    const scen = callEmissions(call, rebuilt, {
      vessel,
      scenario: { shorePower: true, tugPowertrain: 'electric' },
    });
    const m = rebuilt.milestones;
    console.log(
      `\n${meta.name ?? mmsi} (MMSI ${mmsi}, ${meta.lengthM ?? '?'} m) berth ${rebuilt.berthId ?? 'unknown'}${rebuilt.berthMatch ? ` (${rebuilt.berthMatch.distanceM} m)` : ''}`,
    );
    const tag = (k) => (rebuilt.sources[k]?.startsWith('assumed') ? '*' : '');
    console.log(
      `  pilot on ${iso(m.pilotOnMs)}${tag('pilotOnMs')} | first tug fast ${iso(m.tugFirstFastMs)} | all fast ${iso(m.allFastMs)}`,
    );
    console.log(
      `  let go ${iso(m.letGoMs)} | last tug release ${iso(m.tugLastReleaseMs)} | pilot off ${iso(m.pilotOffMs)}${tag('pilotOffMs')}   (* = assumed)`,
    );
    console.log(
      `  hours: inbound ${h(rebuilt.phases.inbound.hours)}, at berth ${h(rebuilt.phases.atBerth.hours)}, outbound ${h(rebuilt.phases.outbound.hours)}`,
    );
    for (const j of rebuilt.craftJobs)
      console.log(
        `  ${j.role} ${j.name ?? j.mmsi} ${j.leg}: alongside ${iso(j.contactStartMs)}–${iso(j.contactEndMs)} (${h(j.contactHours)} h), job ${h(j.jobHours)} h`,
      );
    for (const f of rebuilt.flags) console.log(`  flag: ${f}`);
    console.log(
      `  CO2e t: baseline ${h(base.total.co2e)} (ship ${h(base.ship.tonnes.co2e)}, craft ${h(base.craftTonnes.co2)}) → shore power + e-tugs ${h(scen.total.co2e)}; NOx t ${h(base.total.nox)} → ${h(scen.total.nox)}`,
    );
    out.push({
      mmsi,
      name: meta.name,
      lengthM: meta.lengthM,
      ...rebuilt,
      baseline: base.total,
      scenario: scen.total,
    });
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
