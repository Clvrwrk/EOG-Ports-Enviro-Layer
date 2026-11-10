#!/usr/bin/env node
/**
 * Build the ship inventory files from the workbook call summary and the
 * registry lookups.
 *
 *   node scripts/vessels/build-inventory.mjs CALLS.json LOOKUPS.json \
 *     --particulars OUT.json --calls OUT-calls.json
 *
 * CALLS.json comes from extract_workbook_calls.py. LOOKUPS.json is a list
 * of { mmsi, imo, callsign, flag, shipType, yearBuilt, grossTonnage,
 * deadweight, lengthM, beamM, draftM, renamedTo, source, matched, note }
 * read from a public vessel registry page per ship.
 *
 * Writes two files: the particulars (public registry facts only, safe to
 * publish if the port agrees ship names may be shown) and the call history
 * (the port's schedule data; keep it under public/private/).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  cargoClassFromType,
  normalizeVessel,
  validateInventory,
} from '../../src/portos/vessels/registry.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const [callsPath, lookupsPath] = args;
const particularsOut = flag('--particulars');
const callsOut = flag('--calls');
if (!callsPath || !lookupsPath || !particularsOut || !callsOut) {
  console.error(
    'usage: build-inventory.mjs CALLS.json LOOKUPS.json --particulars OUT --calls OUT',
  );
  process.exit(2);
}

const calls = JSON.parse(readFileSync(callsPath, 'utf8'));
const lookups = new Map(
  JSON.parse(readFileSync(lookupsPath, 'utf8')).map((row) => [
    String(row.mmsi),
    row,
  ]),
);

const vessels = [];
const history = {};
for (const call of calls) {
  const found = lookups.get(String(call.mmsi));
  const matched = Boolean(found?.matched && found.imo);
  const record = normalizeVessel({
    name: call.name,
    mmsi: call.mmsi,
    imo: matched ? found.imo : null,
    callsign: matched ? found.callsign : null,
    // The port's schedule records the flag at the time of the call.
    flag: call.workbookFlag ?? (matched ? found.flag : null),
    vesselType: matched ? found.shipType : null,
    cargoClass: cargoClassFromType(call.workbookType),
    particulars: matched ? found : {},
    renamedTo: matched ? found.renamedTo : null,
    note: found?.note ?? null,
    source: matched
      ? `Particulars: ${found.source}. Cargo class and flag: port vessel schedule.`
      : 'Cargo class and flag: port vessel schedule. Registry lookup did not match this ship.',
  });
  // Two MMSIs can resolve to the same IMO (a ship that changed flag).
  const twin = vessels.find((v) => v.id === record.id);
  if (twin) {
    const h = history[twin.id];
    h.count += call.count;
    h.hoursAtBerth += call.hoursAtBerth;
    for (const [k, n] of Object.entries(call.berths))
      h.berths[k] = (h.berths[k] ?? 0) + n;
    for (const [k, n] of Object.entries(call.years))
      h.years[k] = (h.years[k] ?? 0) + n;
    continue;
  }
  vessels.push(record);
  history[record.id] = {
    count: call.count,
    hoursAtBerth: call.hoursAtBerth,
    berths: call.berths,
    years: call.years,
  };
}

const inventory = {
  port: 'port-of-hueneme',
  generated: new Date().toISOString().slice(0, 10),
  sources: [
    'Ship list: Port of Hueneme vessel schedule 2021-2023 (POH utilization workbook V23MFE).',
    'Particulars: VesselFinder public vessel pages (vesselfinder.com), read 2026-11.',
  ],
  vessels,
};
const problems = validateInventory(inventory);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
writeFileSync(particularsOut, `${JSON.stringify(inventory, null, 1)}\n`);
writeFileSync(
  callsOut,
  `${JSON.stringify(
    {
      source:
        'Port of Hueneme vessel schedule 2021-2023 (POH utilization workbook V23MFE): call counts only.',
      vessels: history,
    },
    null,
    1,
  )}\n`,
);
const matched = vessels.filter((v) => v.imo).length;
console.log(`${vessels.length} ships, ${matched} matched to a registry IMO`);
