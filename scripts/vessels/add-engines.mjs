#!/usr/bin/env node
/**
 * Add engine and shore-power data to the public ship inventory.
 *
 *   node scripts/vessels/add-engines.mjs INVENTORY.json ENGINES.jsonl... \
 *     [--box BOX.json] [--out OUT.json]
 *
 * ENGINES.jsonl: one line per ship, read from its BalticShipping.com page:
 *   { imo, engineMake, engineModel, engineKw, url, ok }
 * BOX.json (optional): container ship capacity and shore-power findings:
 *   [{ imo, teu, teuSource, reeferPlugs, reeferPlugsSource, shorePower,
 *      shorePowerSource, shorePowerQuote }]
 *
 * For every ship it records the EPA ship type and subtype (EPA-420-B-22-011
 * Table 3.4) and the Appendix E default auxiliary and boiler loads for that
 * subtype. Those loads are fleet averages, not this ship's measured loads, so
 * they are always listed in `estimated`. A subtype read from a size proxy
 * (gross tonnage instead of TEU or vehicle capacity) is marked too.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_AUX_KW,
  DEFAULT_BOILER_KW,
  OGV_FACTOR_SOURCE,
} from '../../src/emissions/ogvFactors.js';
import { subtypeFor } from '../../src/emissions/ogvMethod.js';
import {
  normalizeInventory,
  validateInventory,
} from '../../src/portos/vessels/registry.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const [, value] = args.splice(i, 2);
  return value;
};
const boxPath = flag('--box');
const outPath = flag('--out');
const [inventoryPath, ...enginePaths] = args;
if (!inventoryPath || !enginePaths.length) {
  console.error(
    'usage: add-engines.mjs INVENTORY.json ENGINES.jsonl... [--box BOX.json] [--out OUT.json]',
  );
  process.exit(2);
}

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const engines = new Map();
for (const path of enginePaths)
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.ok && row.imo) engines.set(String(row.imo), row);
  }
const box = new Map(
  (boxPath ? JSON.parse(readFileSync(boxPath, 'utf8')) : []).map((row) => [
    String(row.imo),
    row,
  ]),
);

/**
 * Two-stroke crosshead engines (MAN B&W, Sulzer/Wartsila RT and X, Mitsubishi
 * UEC) are slow speed; trunk-piston engines (MaK, Wartsila 32/38/46, MAN
 * 48/60, Pielstick, Daihatsu) are medium speed. Null when the model does not
 * say.
 */
function engineTypeFor(make, model) {
  const m = String(model ?? '').toUpperCase();
  const t = `${make ?? ''} ${m}`.toUpperCase();
  if (/STEAM|TURBINE/.test(t)) return 'ST';
  // Bore/stroke in cm ("L48/60", "7L58/64") or a MaK "M43C" model.
  if (
    /\d{0,2}\s?[LV]\s?\d{2}\/\d{2}\b|\bM\d{2}C?\b|\bMAK\b|PIELSTICK|DAIHATSU/.test(
      t,
    )
  )
    return 'MSD';
  if (
    /\d{1,2}\s?(S|K|L|G)\d{2}\s?(MC|ME)|RTA|RT-?FLEX|\bRT\b|\bX\d{2}|UEC|B&W/.test(
      t,
    )
  )
    return 'SSD';
  return null;
}

// Gross tonnage stands in for TEU or vehicle capacity when those are not
// public. Bands chosen so the known ships fall in their right TEU band.
const TEU_FROM_GT = [
  [13_000, 900],
  [24_000, 1_500],
  [40_000, 2_500],
  [Infinity, 4_000],
];
const VEHICLES_FROM_GT = [
  [35_000, 3_000],
  [Infinity, 6_000],
];
const fromGt = (bands, gt) => bands.find(([upper]) => gt < upper)?.[1] ?? null;

/** EPA ship type for the registry's ship type, and how to size it. */
function epaType(vessel) {
  switch (vessel.vesselType) {
    case 'Vehicles Carrier':
      return 'Vehicle Carrier';
    case 'Container Ship':
      return 'Container Ship';
    case 'Refrigerated Cargo Ship':
      return 'Reefer';
    case 'Chemical/Oil Products Tanker':
      return 'Chemical Tanker';
    case 'Crude Oil Tanker':
      return 'Oil Tanker';
    case 'General Cargo Ship':
    case 'Heavy Load Carrier':
      return 'General Cargo';
    case 'Bulk Carrier':
      return 'Bulk Carrier';
    case 'Research Vessel':
      return 'Other Service';
    default:
      return null;
  }
}

function classify(vessel, boxRow) {
  const shipType = epaType(vessel);
  if (!shipType) return null;
  const p = vessel.particulars ?? {};
  const size = { dwt: p.deadweight, grossTonnage: p.grossTonnage };
  let proxy = null;
  if (shipType === 'Container Ship') {
    if (boxRow?.teu) size.teu = boxRow.teu;
    else if (p.grossTonnage) {
      size.teu = fromGt(TEU_FROM_GT, p.grossTonnage);
      proxy = 'TEU band estimated from gross tonnage';
    }
  }
  if (shipType === 'Vehicle Carrier' && p.grossTonnage) {
    size.vehicles = fromGt(VEHICLES_FROM_GT, p.grossTonnage);
    proxy = 'vehicle capacity band estimated from gross tonnage';
  }
  const subtype = subtypeFor(shipType, size);
  if (!subtype) return null;
  const basis = [
    `${OGV_FACTOR_SOURCE.edition} Table 3.4, from the registry ship type "${vessel.vesselType}"`,
    proxy,
  ]
    .filter(Boolean)
    .join('; ');
  return { shipType, subtype, basis, proxy: Boolean(proxy) };
}

let withEngine = 0;
let withLoads = 0;
let withShorePower = 0;
for (const vessel of inventory.vessels) {
  const estimated = new Set(
    (vessel.estimated ?? []).filter((f) => !f.startsWith('engines.')),
  );
  const lookup = vessel.imo ? engines.get(String(vessel.imo)) : null;
  const boxRow = vessel.imo ? box.get(String(vessel.imo)) : null;
  const epa = classify(vessel, boxRow);
  const main = lookup
    ? {
        make: lookup.engineMake ?? null,
        model: lookup.engineModel ?? null,
        kw: lookup.engineKw ?? null,
        engineType: engineTypeFor(lookup.engineMake, lookup.engineModel),
        source: lookup.url,
      }
    : null;
  if (main?.kw) withEngine += 1;
  if (main && !main.engineType) estimated.add('engines.main.engineType');
  const auxKw = epa ? DEFAULT_AUX_KW[epa.shipType]?.[epa.subtype] : null;
  const boilerKw = epa ? DEFAULT_BOILER_KW[epa.shipType]?.[epa.subtype] : null;
  if (auxKw) {
    withLoads += 1;
    estimated.add('engines.auxKw');
    estimated.add('engines.boilerKw');
  }
  if (epa?.proxy) estimated.add('engines.epa.subtype');
  vessel.engines =
    main || epa
      ? {
          main: main ?? {
            make: null,
            model: null,
            kw: null,
            engineType: null,
            source: null,
          },
          epa: epa
            ? { shipType: epa.shipType, subtype: epa.subtype, basis: epa.basis }
            : null,
          auxKw: auxKw ? { ...auxKw } : null,
          boilerKw: boilerKw ? { ...boilerKw } : null,
          loadsSource: auxKw
            ? `${OGV_FACTOR_SOURCE.edition} Appendix E Tables E.1 and E.2 (${epa.shipType}, ${epa.subtype}): fleet-average defaults, not measured on this ship`
            : null,
          reeferPlugs: boxRow?.reeferPlugs ?? null,
          teu: boxRow?.teu ?? null,
        }
      : null;
  const sources = [
    boxRow?.teu ? `TEU: ${boxRow.teuSource}` : null,
    boxRow?.reeferPlugs ? `Reefer plugs: ${boxRow.reeferPlugsSource}` : null,
  ].filter(Boolean);
  if (sources.length && vessel.engines)
    vessel.engines.capacitySource = sources.join(' ');
  if (typeof boxRow?.shorePower === 'boolean' && boxRow.shorePowerSource) {
    withShorePower += 1;
    vessel.shorePower = {
      capable: boxRow.shorePower,
      source: boxRow.shorePowerSource,
      note: boxRow.shorePowerQuote ?? null,
    };
  } else vessel.shorePower = null;
  vessel.estimated = [...estimated];
}

const problems = validateInventory(normalizeInventory(inventory));
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
inventory.sources = [
  ...(inventory.sources ?? []).filter(
    (s) => !/balticshipping|Appendix E/i.test(s),
  ),
  'Main engines: BalticShipping.com vessel pages (https://www.balticshipping.com/vessel/imo/<IMO>), one per ship, linked in each record.',
  `Auxiliary and boiler loads: ${OGV_FACTOR_SOURCE.edition} Appendix E defaults by EPA ship type and subtype, marked estimated.`,
];
writeFileSync(
  outPath ?? inventoryPath,
  `${JSON.stringify(inventory, null, 2)}\n`,
);
console.log(
  `${inventory.vessels.length} ships: ${withEngine} main engines, ${withLoads} with default hotel loads, ${withShorePower} with shore-power evidence`,
);
