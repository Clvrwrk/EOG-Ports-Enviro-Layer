/**
 * Pure helpers for the /admin asset portal: which fields a class shows,
 * turning form and spreadsheet text into typed values and back, CSV and
 * Excel (.xlsx) reading, CSV writing, and describing a change for the
 * history view. No DOM, so the same code runs in tests.
 */
import { ASSET_CLASSES, readValue, tidyText } from '../assetClasses.js';
import { fleetModel } from '../fleet/catalog.js';

/**
 * Every field an asset of `cls` can carry, in form order. Classes declare
 * `fields`; a class that only lists `required` keys gets text fields.
 */
export function classFields(cls) {
  const definition = ASSET_CLASSES[cls];
  if (!definition) return [];
  if (Array.isArray(definition.fields)) return definition.fields;
  return definition.required
    .filter((key) => key !== 'class')
    .map((key) => ({ key, label: key, type: 'text', required: true }));
}

/** Class ids grouped by section, in ASSET_GROUPS order when available. */
export function classesByGroup(groups) {
  const order = groups ? Object.keys(groups) : [];
  const out = new Map(order.map((group) => [group, []]));
  for (const [cls, definition] of Object.entries(ASSET_CLASSES)) {
    if (!out.has(definition.group)) out.set(definition.group, []);
    out.get(definition.group).push(cls);
  }
  return out;
}

const roundCoord = (value) => Math.round(value * 1e7) / 1e7;

/** Parse "lat, lon" (or "lat lon") into [lat, lon], or null. */
export function parsePoint(text) {
  const parts = String(text)
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  return parts.map(roundCoord);
}

/** Parse a point list: JSON [[lat, lon], ...] or "lat, lon; lat, lon; ...". */
export function parsePointList(text) {
  const raw = String(text).trim();
  if (raw.startsWith('[')) {
    try {
      const value = JSON.parse(raw);
      if (Array.isArray(value) && value.every((p) => Array.isArray(p)))
        return value.map((p) => p.map(Number).map(roundCoord));
    } catch {
      return null;
    }
    return null;
  }
  const points = raw.split(';').map((part) => parsePoint(part));
  return points.every(Boolean) ? points : null;
}

/**
 * Turn the text a person typed (or a spreadsheet cell) into the value the
 * registry stores. Empty text means "not set" (undefined). Returns
 * { value } or { error } when the text does not fit the field.
 */
export function parseValue(field, input) {
  if (input === undefined || input === null) return { value: undefined };
  if (!['point', 'area', 'line'].includes(field.type))
    return readValue(field, input);
  const text = String(input).trim();
  if (!text) return { value: undefined };
  if (field.type === 'point') {
    const value = parsePoint(text);
    return value ? { value } : { error: 'must be "lat, lon"' };
  }
  const value = parsePointList(text);
  const min = field.type === 'area' ? 3 : 2;
  return value && value.length >= min
    ? { value }
    : { error: `must be ${min}+ points "lat, lon; lat, lon; ..."` };
}

/**
 * The values already used for a `choice` field across every asset, sorted,
 * so a form offers "Oxnard Harbor District" instead of a blank box.
 */
export function choiceValues(assets, key) {
  const seen = new Map();
  for (const asset of assets || []) {
    const value = asset?.[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const tidy = tidyText(value);
    const folded = tidy.toLowerCase();
    if (!seen.has(folded)) seen.set(folded, tidy);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * A new `choice` entry, snapped to an existing value that differs only in
 * case or spacing ("oxnard harbor district " becomes "Oxnard Harbor
 * District"), so one name is never stored two ways.
 */
export function snapChoice(text, known) {
  const tidy = tidyText(text ?? '');
  if (!tidy) return '';
  const folded = tidy.toLowerCase();
  return known.find((value) => value.toLowerCase() === folded) ?? tidy;
}

const CATALOG_FILLS = ['powertrain', 'make', 'model', 'ratedKw'];

/**
 * The fields a fleet catalog model fills in on an asset of class `cls`:
 * powertrain, make, model and rated power, where the class has that field
 * and the catalog knows the value. Picking from the catalog means these
 * are never typed.
 */
export function catalogFill(cls, catalogId) {
  const model = catalogId ? fleetModel(catalogId) : null;
  if (!model) return {};
  const keys = new Set((ASSET_CLASSES[cls]?.fields || []).map((f) => f.key));
  return Object.fromEntries(
    CATALOG_FILLS.filter((key) => keys.has(key) && model[key] != null).map(
      (key) => [key, model[key]],
    ),
  );
}

/** Show a stored value as text (form inputs, tables, CSV cells). */
export function formatValue(field, value) {
  if (value === undefined || value === null) return '';
  switch (field?.type) {
    case 'bool':
      return value ? 'yes' : 'no';
    case 'multi':
      return Array.isArray(value) ? value.join('; ') : String(value);
    case 'point':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'area':
    case 'line':
      return Array.isArray(value)
        ? value.map((p) => p.join(', ')).join('; ')
        : String(value);
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

/** A short label for a stored value in tables (enum labels, point counts). */
export function displayValue(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field?.type === 'enum') {
    const option = field.options?.find((o) => o.value === value);
    return option ? option.label : String(value);
  }
  if (field?.type === 'multi' && Array.isArray(value))
    return value
      .map((v) => field.options?.find((o) => o.value === v)?.label ?? v)
      .join(', ');
  if (field?.type === 'area') return `${value.length}-point outline`;
  if (field?.type === 'line') return `${value.length}-point line`;
  return formatValue(field, value);
}

/**
 * Build an asset of `cls` from text values keyed by field key. Returns
 * { asset, errors } where errors are readable "Label: problem" lines.
 * Keys a class does not declare are kept as text (so data from a newer
 * schema is not lost on save).
 */
export function assetFromText(cls, values, extra = {}) {
  const fields = classFields(cls);
  const asset = { ...extra, class: cls };
  const errors = [];
  for (const field of fields) {
    if (!(field.key in values)) continue;
    const { value, error } = parseValue(field, values[field.key]);
    if (error) errors.push(`${field.label}: ${error}`);
    else if (value === undefined) delete asset[field.key];
    else asset[field.key] = value;
  }
  for (const field of fields)
    if (field.required && asset[field.key] === undefined)
      errors.push(`${field.label}: required`);
  return { asset, errors };
}

// ---------------------------------------------------------------- CSV

const csvCell = (text) =>
  /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/** CSV for assets of one class: one column per field, header = field keys. */
export function assetsToCsv(cls, assets) {
  const fields = classFields(cls);
  const lines = [['class', ...fields.map((f) => f.key)].join(',')];
  for (const asset of assets)
    lines.push(
      [cls, ...fields.map((f) => formatValue(f, asset[f.key]))]
        .map(csvCell)
        .join(','),
    );
  return `${lines.join('\r\n')}\r\n`;
}

/** Parse CSV (RFC 4180: quotes, doubled quotes, CRLF) into rows of cells. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text).replace(/^﻿/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Turn spreadsheet rows (first row = header) into assets. Each column is
 * matched to a field by key or label, ignoring case and punctuation. A
 * `class` column picks each row's class; otherwise every row is `cls`.
 * Returns { assets, errors, unknownColumns }.
 */
export function assetsFromRows(rows, cls) {
  if (!rows.length)
    return { assets: [], errors: ['The file is empty'], unknownColumns: [] };
  const [header, ...body] = rows;
  const classCol = header.findIndex((h) => norm(h) === 'class');
  const assets = [];
  const errors = [];
  const unknown = new Set();
  body.forEach((cells, index) => {
    const line = index + 2;
    const rowClass =
      classCol >= 0 && cells[classCol]?.trim() ? cells[classCol].trim() : cls;
    if (!ASSET_CLASSES[rowClass]) {
      errors.push(`Row ${line}: unknown class ${rowClass || '(blank)'}`);
      return;
    }
    const fields = classFields(rowClass);
    const values = {};
    header.forEach((name, col) => {
      if (col === classCol) return;
      const field = fields.find(
        (f) => norm(f.key) === norm(name) || norm(f.label) === norm(name),
      );
      if (!field) {
        if (String(name).trim()) unknown.add(String(name).trim());
        return;
      }
      values[field.key] = cells[col] ?? '';
    });
    const { asset, errors: rowErrors } = assetFromText(rowClass, values);
    if (rowErrors.length)
      errors.push(
        ...rowErrors.map((e) => `Row ${line} (${asset.id || 'no id'}): ${e}`),
      );
    else assets.push(asset);
  });
  return { assets, errors, unknownColumns: [...unknown] };
}

// --------------------------------------------------------------- Excel

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** List a zip's entries: { name -> { method, offset, size } }. */
function zipEntries(bytes) {
  let end = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 65557);
    i -= 1
  )
    if (u32(bytes, i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('Not an Excel (.xlsx) file');
  const count = u16(bytes, end + 10);
  let p = u32(bytes, end + 16);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('Damaged .xlsx file');
    const method = u16(bytes, p + 10);
    const size = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function zipText(bytes, entry) {
  const p = entry.local;
  const start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
  const data = bytes.subarray(start, start + entry.size);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error('Unsupported .xlsx compression');
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const unescapeXml = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, '&');

const textRuns = (xml) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((m) => unescapeXml(m[1]))
    .join('');

const columnIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, ''))
    n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/**
 * Read the first worksheet of an .xlsx file into rows of text cells.
 * Handles shared strings, inline strings, numbers and booleans; formulas
 * read as their cached value.
 */
export async function readXlsx(buffer) {
  const bytes = new Uint8Array(buffer);
  const entries = zipEntries(bytes);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = entries.get('xl/workbook.xml');
  const rels = entries.get('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const first = (await zipText(bytes, workbook)).match(
      /<sheet\b[^>]*\br:id="([^"]+)"/,
    );
    if (first) {
      const relXml = await zipText(bytes, rels);
      const rel = [...relXml.matchAll(/<Relationship\b[^>]*>/g)]
        .map((m) => m[0])
        .find((tag) => tag.includes(`Id="${first[1]}"`));
      const target = rel?.match(/Target="([^"]+)"/)?.[1];
      if (target)
        sheetPath = target.startsWith('/')
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//, '')}`;
    }
  }
  const sheet = entries.get(sheetPath);
  if (!sheet) throw new Error('The workbook has no worksheet');
  const shared = [];
  const sst = entries.get('xl/sharedStrings.xml');
  if (sst)
    for (const m of (await zipText(bytes, sst)).matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ))
      shared.push(textRuns(m[1]));
  const xml = await zipText(bytes, sheet);
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cell of rowMatch[1].matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const attrs = cell[1];
      const inner = cell[2] || '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let text = '';
      if (type === 's') text = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') text = textRuns(inner);
      else if (type === 'b') text = raw === '1' ? 'true' : 'false';
      else if (raw !== undefined) text = unescapeXml(raw);
      const col = ref ? columnIndex(ref) : row.length;
      while (row.length < col) row.push('');
      row[col] = text;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// ------------------------------------------------------------- history

/** Field-by-field differences between two versions of an asset. */
export function describeChange(before, after) {
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  const cls = after?.class || before?.class;
  const fields = classFields(cls);
  const changes = [];
  for (const key of keys) {
    const a = before?.[key];
    const b = after?.[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const field = fields.find((f) => f.key === key) || {
      key,
      label: key,
      type: 'text',
    };
    changes.push({
      key,
      label: field.label,
      from: displayValue(field, a),
      to: displayValue(field, b),
    });
  }
  return changes;
}

/** A readable id suggestion for a new asset: `${cls}-NN`, first unused. */
export function nextId(cls, assets) {
  const prefix = cls.replace(/_/g, '-');
  const used = new Set(assets.map((a) => a.id));
  for (let n = 1; ; n += 1) {
    const id = `${prefix}-${String(n).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
}
