import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { validateRegistry } from '../assetClasses.js';
import { HUENEME_REGISTRY } from '../hueneme.js';
import {
  assetFromText,
  assetsFromRows,
  assetsToCsv,
  classFields,
  describeChange,
  nextId,
  parseCsv,
  parseValue,
  readXlsx,
} from './adminModel.js';

const field = (cls, key) => classFields(cls).find((f) => f.key === key);

test('every class has fields with an id first', () => {
  for (const asset of HUENEME_REGISTRY.assets) {
    const fields = classFields(asset.class);
    assert.ok(fields.length, asset.class);
    assert.ok(fields.some((f) => f.key === 'id'));
  }
});

test('parseValue turns typed text into stored values', () => {
  assert.deepEqual(parseValue({ type: 'number' }, '1,500'), { value: 1500 });
  assert.ok(parseValue({ type: 'number' }, 'lots').error);
  assert.deepEqual(parseValue({ type: 'bool' }, 'Yes'), { value: true });
  assert.deepEqual(parseValue({ type: 'bool' }, 'no'), { value: false });
  assert.deepEqual(parseValue({ type: 'text' }, '  '), { value: undefined });
  assert.deepEqual(parseValue({ type: 'point' }, '34.149, -119.208'), {
    value: [34.149, -119.208],
  });
  assert.deepEqual(
    parseValue({ type: 'area' }, '34.1, -119.2; 34.2, -119.2; 34.2, -119.1'),
    {
      value: [
        [34.1, -119.2],
        [34.2, -119.2],
        [34.2, -119.1],
      ],
    },
  );
  assert.ok(parseValue({ type: 'area' }, '34.1, -119.2').error);
  const options = [{ value: 'tier4f', label: 'Tier 4 final' }];
  assert.deepEqual(parseValue({ type: 'enum', options }, 'tier 4 final'), {
    value: 'tier4f',
  });
});

test('CSV export and import round-trip a class', () => {
  const utrs = HUENEME_REGISTRY.assets.filter((a) => a.class === 'utr');
  const csv = assetsToCsv('utr', utrs);
  const { assets, errors } = assetsFromRows(parseCsv(csv), 'utr');
  assert.deepEqual(errors, []);
  assert.deepEqual(assets, utrs);
});

test('CSV parsing handles quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n'), [
    ['a', 'b'],
    ['x, y', 'say "hi"'],
  ]);
});

test('import matches columns by label and reports bad rows', () => {
  const rows = [
    ['ID', 'Utility', 'Rate schedule', 'Colour'],
    ['meter-a', 'SCE', 'SCE-TOU-8-D', 'blue'],
    ['', 'SCE', 'SCE-TOU-8-D', ''],
  ];
  const labelOf = (key) => field('meter', key)?.label;
  rows[0][1] = labelOf('utility') || 'utility';
  rows[0][2] = labelOf('tariffId') || 'tariffId';
  const { assets, errors, unknownColumns } = assetsFromRows(rows, 'meter');
  assert.equal(assets.length, 1);
  assert.equal(assets[0].id, 'meter-a');
  assert.equal(assets[0].tariffId, 'SCE-TOU-8-D');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Row 3/);
  assert.deepEqual(unknownColumns, ['Colour']);
});

test('a class column lets one file hold several classes', () => {
  const { assets, errors } = assetsFromRows(
    [
      ['class', 'id', 'utility', 'tariffId', 'meterId', 'kw'],
      ['meter', 'm-1', 'SCE', 'SCE-TOU-8-D', '', ''],
      ['charger', 'c-1', '', '', 'm-1', '150'],
    ],
    'utr',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    assets.map((a) => [a.class, a.id]),
    [
      ['meter', 'm-1'],
      ['charger', 'c-1'],
    ],
  );
  assert.equal(assets[1].kw, 150);
  const registry = {
    ...HUENEME_REGISTRY,
    assets: [...HUENEME_REGISTRY.assets, ...assets],
  };
  assert.deepEqual(
    validateRegistry(registry).filter((p) => /\b(m-1|c-1)\b/.test(p)),
    [],
  );
});

test('assetFromText keeps fields the form did not show and flags required ones', () => {
  const { asset, errors } = assetFromText(
    'charger',
    { id: 'c-9', kw: '' },
    { id: 'c-9', class: 'charger', futureField: 'kept' },
  );
  assert.equal(asset.futureField, 'kept');
  assert.ok(errors.some((e) => /required/.test(e)));
});

test('describeChange lists changed fields only', () => {
  const changes = describeChange(
    { id: 'g', class: 'gate', lanes: 2, label: 'Main' },
    { id: 'g', class: 'gate', lanes: 3, label: 'Main' },
  );
  assert.deepEqual(
    changes.map((c) => [c.key, c.from, c.to]),
    [['lanes', '2', '3']],
  );
});

test('nextId picks the first unused number', () => {
  assert.equal(
    nextId('reach_stacker', [{ id: 'reach-stacker-01' }]),
    'reach-stacker-02',
  );
});

/** A minimal .xlsx: workbook, rels, shared strings and one sheet. */
function xlsx(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

test('readXlsx reads the first sheet with shared and inline strings', async () => {
  const buffer = xlsx({
    'xl/workbook.xml':
      '<workbook><sheets><sheet name="Gates" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/gates.xml"/></Relationships>',
    'xl/sharedStrings.xml':
      '<sst><si><t>id</t></si><si><t>lanes</t></si><si><r><t>gate</t></r><r><t>-main</t></r></si></sst>',
    'xl/worksheets/gates.xml':
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Fish &amp; chips</t></is></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>4</v></c></row>' +
      '</sheetData></worksheet>',
  });
  const rows = await readXlsx(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length),
  );
  assert.deepEqual(rows, [
    ['id', 'lanes', '', 'Fish & chips'],
    ['gate-main', '4'],
  ]);
});

test('fleetFromRegistry counts active units, hybrids as electric', async () => {
  const { fleetFromRegistry } = await import('./registrySource.js');
  const fleet = fleetFromRegistry({
    specs: { utr: {}, harbor_crane: {} },
    assets: [
      { id: 'a', class: 'utr', specId: 'utr', powertrain: 'diesel' },
      { id: 'b', class: 'utr', specId: 'utr', powertrain: 'electric' },
      {
        id: 'c',
        class: 'utr',
        specId: 'utr',
        powertrain: 'electric',
        status: 'planned',
      },
      {
        id: 'd',
        class: 'mobile_harbor_crane',
        specId: 'harbor_crane',
        powertrain: 'hybrid',
      },
      { id: 'e', class: 'utr', specId: 'utr', powertrain: 'hydrogen' },
    ],
  });
  assert.deepEqual(fleet, {
    utr: { electric: 1, diesel: 1, chargers: 1 },
    harbor_crane: { electric: 1, diesel: 0, chargers: 1 },
  });
});

test('fetchAdminRegistry is null unless signed in, and never throws', async () => {
  const { fetchAdminRegistry } = await import('./registrySource.js');
  const reply = (body) => ({ ok: true, json: async () => body });
  assert.equal(
    await fetchAdminRegistry(async () => reply({ signedIn: false })),
    null,
  );
  assert.equal(
    await fetchAdminRegistry(async () => {
      throw new Error('offline');
    }),
    null,
  );
  const registry = await fetchAdminRegistry(async (url) =>
    url.endsWith('/session')
      ? reply({ signedIn: true, name: 'Dana' })
      : reply({
          portId: 'p',
          specs: {},
          assets: [
            { id: 'x', class: 'gate', rev: 3, updatedAt: 1, updatedBy: 'Dana' },
          ],
        }),
  );
  assert.deepEqual(registry.assets, [{ id: 'x', class: 'gate' }]);
  assert.equal(registry.signedInAs, 'Dana');
});

test('choice lists offer the names already used, one spelling each', async () => {
  const { choiceValues, snapChoice } = await import('./adminModel.js');
  const assets = [
    { operator: 'Oxnard Harbor District' },
    { operator: 'oxnard  harbor district' },
    { operator: 'Yara' },
    { operator: '' },
    {},
  ];
  const known = choiceValues(assets, 'operator');
  assert.deepEqual(known, ['Oxnard Harbor District', 'Yara']);
  assert.equal(
    snapChoice(' OXNARD harbor   district ', known),
    'Oxnard Harbor District',
  );
  assert.equal(
    snapChoice('Fresh Del Monte Produce', known),
    'Fresh Del Monte Produce',
  );
  assert.equal(snapChoice('   ', known), '');
});

test('a spreadsheet with words in number columns is refused row by row', () => {
  const rows = parseCsv('id,lanes,hoursPerDay\ngate-a,2,16\ngate-b,three,16\n');
  const plan = assetsFromRows(rows, 'gate');
  assert.ok(
    plan.errors.some((e) => /gate-b|row 3/i.test(e) && /number/.test(e)),
    plan.errors.join('\n'),
  );
});
