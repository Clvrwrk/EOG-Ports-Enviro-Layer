/**
 * Data cards for port assets: { title, rows } with rows as [label, value],
 * the same shape as the meter and site cards, so the twin and the admin
 * portal can show any asset.
 *
 * Pure: no Cesium, no DOM.
 */
import { ASSET_CLASSES, ASSET_GROUPS } from '../assetClasses.js';

const n0 = (value) => Math.round(value).toLocaleString('en-US');

/** Readable text for one field value, or null to skip it. */
function formatValue(field, value, registry) {
  if (value === undefined || value === null || value === '') return null;
  switch (field.type) {
    case 'bool':
      return value ? 'Yes' : 'No';
    case 'number':
      return field.unit ? `${n0(value)} ${field.unit}` : n0(value);
    case 'enum':
      return (
        field.options.find((option) => option.value === value)?.label ?? value
      );
    case 'ref': {
      const target = registry?.assets.find((asset) => asset.id === value);
      return target?.label ?? value;
    }
    case 'spec':
      return registry?.specs?.[value]?.label ?? value;
    case 'point':
    case 'area':
    case 'line':
      return null;
    default:
      return String(value);
  }
}

const SKIP = new Set(['id', 'label', 'notes', 'source', 'approximate']);

/** Card for one asset. `extraRows` are appended (e.g. live scenario figures). */
export function assetCard(asset, registry, extraRows = []) {
  const definition = ASSET_CLASSES[asset.class];
  const rows = [
    ['Type', definition?.label ?? asset.class],
    ['Inventory', ASSET_GROUPS[definition?.group] ?? 'Other'],
  ];
  for (const field of definition?.fields ?? []) {
    if (SKIP.has(field.key)) continue;
    const text = formatValue(field, asset[field.key], registry);
    if (text != null) rows.push([field.label, text]);
  }
  rows.push(...extraRows);
  if (asset.approximate) rows.push(['Position', 'Approximate, needs a survey']);
  if (asset.notes) rows.push(['Note', asset.notes]);
  if (asset.source) rows.push(['Source', asset.source]);
  return { title: asset.label ?? asset.id, rows };
}

/** Card for the whole registry: asset counts by inventory section. */
export function registryCard(registry, site = null) {
  const counts = {};
  for (const asset of registry.assets) {
    const group = ASSET_CLASSES[asset.class]?.group ?? 'other';
    counts[group] = (counts[group] ?? 0) + 1;
  }
  const rows = Object.entries(ASSET_GROUPS)
    .filter(([group]) => counts[group])
    .map(([group, label]) => [label, `${counts[group]} records`]);
  if (site) {
    rows.push([
      'Terminal',
      `${site.terminalAcresOwned} acres owned, up to ${site.terminalAcresJointUse} joint use`,
    ]);
    rows.push(['Reefer plugs on port', n0(site.reeferPlugsOnPort)]);
    rows.push([
      'Rail',
      `${site.railMiles} miles, about ${n0(site.railCarloadsPerYear)} carloads a year`,
    ]);
  }
  rows.push([
    'Data',
    registry.overlay
      ? 'Public seed plus port records'
      : 'Public sources only; port records not loaded',
  ]);
  return { title: 'Port assets', rows };
}
