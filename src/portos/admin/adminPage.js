/**
 * /admin: the port asset portal.
 *
 * Port staff sign in, pick an asset class, and add, edit or remove assets;
 * import a class from CSV or Excel; export it to CSV; and read the change
 * history. Every save goes to the server (server/portos/adminApi.js), which
 * checks the whole registry before committing, so the scenario builder and
 * the 3D twin never read a registry with a broken reference.
 */
import '../page/scenarios.css';
import './admin.css';
import { ASSET_CLASSES, ASSET_GROUPS } from '../assetClasses.js';
import { TWIN_PATH } from '../scenarioStore.js';
import { mountSiteNav } from '../nav/siteNav.js';
import {
  assetFromText,
  assetsFromRows,
  assetsToCsv,
  classFields,
  classesByGroup,
  describeChange,
  displayValue,
  formatValue,
  nextId,
  parseCsv,
  readXlsx,
} from './adminModel.js';

const API = '/api/portos/admin';
const GROUP_LABELS = ASSET_GROUPS || {
  fixed: 'Berths, buildings and yards',
  che: 'Cargo-handling equipment',
  harbor_craft: 'Tugs and harbor craft',
  rail: 'Rail',
  electrical: 'Electrical',
};
const BOOKKEEPING = new Set(['rev', 'updatedAt', 'updatedBy']);

const esc = (text) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        ch
      ],
  );
const when = (ms) =>
  new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const plural = (n, word) =>
  `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

const app = document.getElementById('app');
const state = {
  session: null,
  registry: null,
  cls: Object.keys(ASSET_CLASSES)[0],
  view: 'class', // class | history | import
  selectedId: null,
  creating: false,
  filter: '',
  problems: [],
  notice: null,
  history: [],
  importPlan: null,
  busy: false,
};

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.problems = body?.problems || [];
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-Portos-Admin'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

const assets = () => state.registry?.assets || [];
const assetsOf = (cls) => assets().filter((a) => a.class === cls);
const selected = () => assets().find((a) => a.id === state.selectedId) || null;
const strip = (asset) =>
  Object.fromEntries(
    Object.entries(asset).filter(([k]) => !BOOKKEEPING.has(k)),
  );

function say(text, tone = '') {
  state.notice = text ? { text, tone } : null;
}

async function loadRegistry() {
  state.registry = await api('/registry');
}

async function loadHistory(assetId) {
  const query = assetId
    ? `?assetId=${encodeURIComponent(assetId)}&limit=50`
    : '?limit=200';
  state.history = (await api(`/history${query}`)).entries;
}

// ---------------------------------------------------------------- views

function header() {
  const who = state.session?.signedIn
    ? `<span class="notice">Signed in as <strong>${esc(state.session.name)}</strong></span>
       <button class="btn" data-action="signout">Sign out</button>`
    : '';
  return `<header>
    <div>
      <h1>Port asset admin</h1>
      <p class="sub">Port of Hueneme · the equipment, berths, buildings and meters the scenario builder and 3D twin run on</p>
    </div>
    <div class="toolbar" style="margin:0">
      <a href="/scenarios">Scenario builder</a>
      <a href="${TWIN_PATH}">3D twin</a>
      ${who}
    </div>
  </header>`;
}

function signInView() {
  const s = state.session;
  if (s && !s.configured)
    return `<div class="card signin">
      <h2>The admin portal is locked</h2>
      <p class="notice">${
        s.tooShort
          ? 'The staff password is shorter than 8 characters, so sign-in is turned off.'
          : 'No staff password is set on this server yet.'
      } An administrator sets <code>PORTOS_ADMIN_PASSWORD</code> (8+ characters) in the server's environment, and <code>PORTOS_DATA_DIR</code> to a persistent folder, then restarts the app.</p>
    </div>`;
  return `<form class="card signin" data-form="signin">
    <h2>Staff sign-in</h2>
    <p class="notice">Your name goes on every change you make, in the asset history.</p>
    <label for="si-name">Your name</label>
    <input type="text" id="si-name" name="name" autocomplete="name" required maxlength="60" />
    <label for="si-pass">Staff password</label>
    <input type="password" id="si-pass" name="password" autocomplete="current-password" required />
    ${state.notice ? `<p class="notice ${state.notice.tone}" role="alert">${esc(state.notice.text)}</p>` : ''}
    <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>Sign in</button>
  </form>`;
}

function navView() {
  const groups = classesByGroup(GROUP_LABELS);
  let buttons = '';
  let options = '';
  for (const [group, classes] of groups) {
    if (!classes.length) continue;
    buttons += `<h3>${esc(GROUP_LABELS[group] || group)}</h3>`;
    options += `<optgroup label="${esc(GROUP_LABELS[group] || group)}">`;
    for (const cls of classes) {
      const current = state.view === 'class' && state.cls === cls;
      const n = assetsOf(cls).length;
      buttons += `<button class="cls" data-cls="${cls}" aria-current="${current}">
        <span>${esc(ASSET_CLASSES[cls].label)}</span><span class="count">${n}</span></button>`;
      options += `<option value="${cls}" ${current ? 'selected' : ''}>${esc(ASSET_CLASSES[cls].label)} (${n})</option>`;
    }
    options += '</optgroup>';
  }
  const extra = (view, label) =>
    `<button class="cls" data-view="${view}" aria-current="${state.view === view}"><span>${label}</span></button>`;
  options += `<option value="view:history" ${state.view === 'history' ? 'selected' : ''}>Recent changes</option>`;
  return `<nav class="card admin-nav" aria-label="Asset classes">
    <label class="sr-only" for="nav-select">Asset class</label>
    <select id="nav-select">${options}</select>
    <div class="groups">${buttons}
      <div class="extra">${extra('history', 'Recent changes')}</div>
    </div>
  </nav>`;
}

function tableColumns(cls) {
  const fields = classFields(cls);
  const pick = ['id', 'label', 'status'];
  for (const f of fields)
    if (f.required && !pick.includes(f.key) && pick.length < 7)
      pick.push(f.key);
  for (const f of fields)
    if (
      ['make', 'model', 'year', 'kw', 'meterId'].includes(f.key) &&
      !pick.includes(f.key) &&
      pick.length < 8
    )
      pick.push(f.key);
  return pick.map((key) => fields.find((f) => f.key === key)).filter(Boolean);
}

function classView() {
  const cls = state.cls;
  const columns = tableColumns(cls);
  const needle = state.filter.trim().toLowerCase();
  const rows = assetsOf(cls).filter(
    (a) => !needle || JSON.stringify(strip(a)).toLowerCase().includes(needle),
  );
  const body = rows.length
    ? rows
        .map(
          (
            a,
          ) => `<tr data-id="${esc(a.id)}" tabindex="0" aria-selected="${a.id === state.selectedId}">
          ${columns.map((f) => `<td>${esc(displayValue(f, a[f.key]))}</td>`).join('')}
          <td class="notice">${esc(a.updatedBy || '')}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="${columns.length + 1}" class="empty">${
        needle
          ? 'No assets match.'
          : 'None yet. Add one, or import a CSV or Excel file.'
      }</td></tr>`;
  return `<section class="card">
    <h2>${esc(ASSET_CLASSES[cls].label)} <span class="notice">· ${plural(assetsOf(cls).length, 'asset')}</span></h2>
    <div class="toolbar">
      <button class="btn primary" data-action="new">Add</button>
      <label class="btn" for="import-file">Import CSV or Excel</label>
      <input class="sr-only" type="file" id="import-file" accept=".csv,.xlsx,text/csv" />
      <button class="btn" data-action="export">Export CSV</button>
      <input class="grow" type="search" id="filter" placeholder="Filter" value="${esc(state.filter)}" aria-label="Filter assets" />
    </div>
    ${state.notice ? `<p class="notice ${state.notice.tone}" role="status">${esc(state.notice.text)}</p>` : ''}
    <div class="table-scroll"><table class="assets">
      <thead><tr>${columns.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th>Last edit by</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

function refOptions(field, value) {
  const allowed = [].concat(field.refClass || []);
  const targets = assets().filter((a) => allowed.includes(a.class));
  const ids = targets.map((a) => a.id);
  const extra = value && !ids.includes(value) ? [value] : [];
  return `<option value=""></option>${[...extra, ...ids]
    .map((id) => {
      const t = targets.find((a) => a.id === id);
      const text = t?.label ? `${id} · ${t.label}` : id;
      return `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(text)}</option>`;
    })
    .join('')}`;
}

function fieldInput(field, asset, isNew) {
  const value = asset?.[field.key];
  const id = `f-${field.key}`;
  const name = `name="${esc(field.key)}" id="${id}"`;
  switch (field.type) {
    case 'bool':
      return `<select ${name}><option value=""></option>
        <option value="yes" ${value === true ? 'selected' : ''}>Yes</option>
        <option value="no" ${value === false ? 'selected' : ''}>No</option></select>`;
    case 'enum':
      return `<select ${name}><option value=""></option>${(field.options || [])
        .map(
          (o) =>
            `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`,
        )
        .join('')}</select>`;
    case 'ref':
      return `<select ${name}>${refOptions(field, value)}</select>`;
    case 'spec': {
      const specs = state.registry?.specs || {};
      return `<select ${name}><option value=""></option>${Object.entries(specs)
        .map(
          ([key, spec]) =>
            `<option value="${esc(key)}" ${key === value ? 'selected' : ''}>${esc(spec.label || key)}</option>`,
        )
        .join('')}</select>`;
    }
    case 'area':
    case 'line':
      return `<textarea ${name} placeholder="lat, lon; lat, lon; ...">${esc(formatValue(field, value))}</textarea>`;
    default: {
      const mode = ['number', 'year'].includes(field.type)
        ? 'inputmode="decimal"'
        : '';
      const placeholder =
        field.type === 'point' ? 'placeholder="34.1490, -119.2080"' : '';
      const locked = field.key === 'id' && !isNew ? 'readonly' : '';
      return `<input type="text" ${name} ${mode} ${placeholder} ${locked} value="${esc(formatValue(field, value))}" />`;
    }
  }
}

function editorView() {
  const isNew = state.creating;
  const asset = isNew ? { id: nextId(state.cls, assets()) } : selected();
  if (!asset) return '';
  const cls = isNew ? state.cls : asset.class;
  const fields = classFields(cls);
  const problems = state.problems.length
    ? `<div class="problems" role="alert"><strong>Not saved.</strong><ul>${state.problems
        .map((p) => `<li>${esc(p)}</li>`)
        .join('')}</ul></div>`
    : '';
  const historyItems = isNew ? '' : historyList(state.history);
  return `<aside class="card editor" aria-label="Asset editor">
    <h2>${isNew ? `New ${esc(ASSET_CLASSES[cls].label.toLowerCase())}` : esc(asset.label || asset.id)}</h2>
    ${isNew ? '' : `<p class="meta">${esc(ASSET_CLASSES[cls].label)} · revision ${asset.rev} · last edit by ${esc(asset.updatedBy)}, ${esc(when(asset.updatedAt))}</p>`}
    <form data-form="asset" novalidate>
      ${fields
        .map(
          (f) => `<div class="field">
          <label for="f-${esc(f.key)}">${esc(f.label)}${f.unit ? ` (${esc(f.unit)})` : ''}${f.required ? ' <span class="req" aria-label="required">*</span>' : ''}</label>
          ${fieldInput(f, asset, isNew)}
          ${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}
        </div>`,
        )
        .join('')}
      ${problems}
      <div class="actions">
        <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>${isNew ? 'Add asset' : 'Save changes'}</button>
        <button class="btn" type="button" data-action="close">Cancel</button>
        ${isNew ? '' : '<button class="btn danger" type="button" data-action="delete">Delete</button>'}
      </div>
    </form>
    ${isNew ? '' : `<h2 style="margin-top:20px">History</h2>${historyItems}`}
  </aside>`;
}

function historyList(entries, showAsset = false) {
  if (!entries.length) return '<p class="empty">No changes yet.</p>';
  const verbs = {
    seed: 'Loaded from seed data',
    create: 'Added',
    update: 'Edited',
    delete: 'Deleted',
    import: 'Imported',
  };
  return `<ul class="history">${entries
    .map((e) => {
      const changes =
        e.action === 'update' || (e.action === 'import' && e.before)
          ? describeChange(e.before, e.after)
          : [];
      const diff = changes.length
        ? `<ul class="diff">${changes
            .map(
              (c) =>
                `<li>${esc(c.label)}: ${c.from ? `<del>${esc(c.from)}</del>` : '<em>blank</em>'} → ${c.to ? `<ins>${esc(c.to)}</ins>` : '<em>blank</em>'}</li>`,
            )
            .join('')}</ul>`
        : '';
      const target = showAsset
        ? ` <button class="btn" style="padding:1px 6px" data-open="${esc(e.assetId)}" ${e.action === 'delete' ? 'disabled' : ''}>${esc(e.assetId)}</button>`
        : '';
      return `<li><div><strong>${verbs[e.action] || esc(e.action)}</strong>${target} by ${esc(e.by)}</div>
        <div class="when">${esc(when(e.at))}</div>${diff}</li>`;
    })
    .join('')}</ul>`;
}

function historyView() {
  return `<section class="card"><h2>Recent changes</h2>${historyList(state.history, true)}</section>`;
}

function importView() {
  const plan = state.importPlan;
  const list = (items) =>
    `<ul>${items
      .slice(0, 50)
      .map((x) => `<li>${esc(x)}</li>`)
      .join(
        '',
      )}${items.length > 50 ? `<li>…and ${items.length - 50} more</li>` : ''}</ul>`;
  return `<section class="card">
    <h2>Import ${esc(plan.fileName)}</h2>
    <p class="notice">${plural(plan.rows, 'row')} read. ${plural(plan.created.length, 'new asset')}, ${plural(plan.updated.length, 'change')} to existing assets, ${plan.unchanged} unchanged.</p>
    ${plan.unknownColumns.length ? `<p class="notice">Ignored columns (not fields of this class): ${esc(plan.unknownColumns.join(', '))}</p>` : ''}
    ${plan.errors.length ? `<div class="problems"><strong>Fix these rows in the file, then import it again.</strong>${list(plan.errors)}</div>` : ''}
    ${state.problems.length ? `<div class="problems" role="alert"><strong>The server refused the import.</strong>${list(state.problems)}</div>` : ''}
    ${plan.created.length ? `<h2 style="margin-top:14px">New</h2><p class="notice">${esc(plan.created.join(', '))}</p>` : ''}
    ${plan.updated.length ? `<h2 style="margin-top:14px">Changed</h2><p class="notice">${esc(plan.updated.join(', '))}</p>` : ''}
    <div class="toolbar" style="margin-top:16px">
      <button class="btn primary" data-action="import-confirm" ${plan.errors.length || !(plan.created.length + plan.updated.length) || state.busy ? 'disabled' : ''}>Import ${plural(plan.created.length + plan.updated.length, 'asset')}</button>
      <button class="btn" data-action="import-cancel">Cancel</button>
    </div>
  </section>`;
}

function render() {
  const focusId = document.activeElement?.id;
  if (!state.session?.signedIn) {
    app.innerHTML = `<div class="portos-wrap">${header()}${signInView()}</div>`;
  } else {
    const editing =
      state.view === 'class' && (state.creating || state.selectedId);
    const main =
      state.view === 'history'
        ? historyView()
        : state.view === 'import'
          ? importView()
          : classView();
    app.innerHTML = `<div class="portos-wrap">${header()}
      <div class="admin-layout ${editing ? 'with-editor' : ''}">${navView()}<main>${main}</main>${editing ? editorView() : ''}</div>
    </div>`;
  }
  // render() replaces the page, so the breadcrumb bar goes back on each time.
  mountSiteNav({ host: app.querySelector('.portos-wrap') });
  if (focusId) document.getElementById(focusId)?.focus();
}

// ------------------------------------------------------------- actions

async function refresh(message) {
  await loadRegistry();
  if (state.selectedId && !selected()) state.selectedId = null;
  if (state.selectedId) await loadHistory(state.selectedId);
  if (message) say(message, 'ok');
  render();
}

function openClass(cls) {
  Object.assign(state, {
    cls,
    view: 'class',
    selectedId: null,
    creating: false,
    problems: [],
    filter: '',
    importPlan: null,
  });
  say('');
  render();
}

async function openAsset(id) {
  const asset = assets().find((a) => a.id === id);
  if (!asset) return;
  Object.assign(state, {
    cls: asset.class,
    view: 'class',
    selectedId: id,
    creating: false,
    problems: [],
  });
  await loadHistory(id);
  render();
  const editor = document.querySelector('.editor');
  // On narrow screens the editor sits below the table.
  if (editor && window.matchMedia('(max-width: 1100px)').matches)
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else document.getElementById('f-label')?.focus();
}

function formValues(form) {
  const values = {};
  for (const element of form.elements)
    if (element.name) values[element.name] = element.value;
  return values;
}

async function saveAsset(form) {
  const isNew = state.creating;
  const existing = isNew ? null : selected();
  const cls = isNew ? state.cls : existing.class;
  const { asset, errors } = assetFromText(
    cls,
    formValues(form),
    isNew ? {} : strip(existing),
  );
  if (errors.length) {
    state.problems = errors;
    render();
    return;
  }
  state.busy = true;
  render();
  try {
    if (isNew) {
      if (assets().some((a) => a.id === asset.id))
        throw new ApiError(422, {
          error: 'Not saved',
          problems: [`ID ${asset.id} is already used`],
        });
      await api('/assets', { method: 'POST', body: { asset } });
    } else
      await api(`/assets/${encodeURIComponent(asset.id)}`, {
        method: 'PUT',
        body: { asset, rev: existing.rev },
      });
    state.creating = false;
    state.selectedId = asset.id;
    state.problems = [];
    await refresh(isNew ? `Added ${asset.id}.` : `Saved ${asset.id}.`);
  } catch (error) {
    state.problems = error.problems?.length ? error.problems : [error.message];
    if (error.status === 401)
      state.session = { ...state.session, signedIn: false };
    render();
  } finally {
    state.busy = false;
    render();
  }
}

async function deleteAsset() {
  const asset = selected();
  if (!asset || !window.confirm(`Delete ${asset.id}? Its history is kept.`))
    return;
  try {
    await api(`/assets/${encodeURIComponent(asset.id)}?rev=${asset.rev}`, {
      method: 'DELETE',
    });
    state.selectedId = null;
    await refresh(`Deleted ${asset.id}.`);
  } catch (error) {
    state.problems = error.problems?.length
      ? [
          `Other assets still point at ${asset.id}. Change them first:`,
          ...error.problems,
        ]
      : [error.message];
    render();
  }
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: name,
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function planImport(file) {
  say('');
  state.problems = [];
  try {
    const rows = /\.xlsx$/i.test(file.name)
      ? await readXlsx(await file.arrayBuffer())
      : parseCsv(await file.text());
    const {
      assets: incoming,
      errors,
      unknownColumns,
    } = assetsFromRows(rows, state.cls);
    const current = new Map(assets().map((a) => [a.id, strip(a)]));
    const created = [];
    const updated = [];
    let unchanged = 0;
    const merged = [];
    for (const asset of incoming) {
      const before = current.get(asset.id);
      // Columns the file leaves out keep their current values.
      const next =
        before && before.class === asset.class
          ? { ...before, ...asset }
          : asset;
      if (!before) created.push(asset.id);
      else if (JSON.stringify(before) !== JSON.stringify(next))
        updated.push(asset.id);
      else {
        unchanged += 1;
        continue;
      }
      merged.push(next);
    }
    state.importPlan = {
      fileName: file.name,
      rows: Math.max(0, rows.length - 1),
      assets: merged,
      created,
      updated,
      unchanged,
      errors,
      unknownColumns,
    };
    state.view = 'import';
    state.selectedId = null;
    state.creating = false;
  } catch (error) {
    say(`Could not read ${file.name}: ${error.message}`, 'bad');
  }
  render();
}

async function confirmImport() {
  const plan = state.importPlan;
  state.busy = true;
  render();
  try {
    const result = await api('/import', {
      method: 'POST',
      body: { rows: plan.assets },
    });
    state.importPlan = null;
    state.view = 'class';
    state.problems = [];
    await refresh(
      `Imported ${plan.fileName}: ${plural(result.created, 'new asset')}, ${plural(result.updated, 'update')}.`,
    );
  } catch (error) {
    state.problems = error.problems?.length ? error.problems : [error.message];
  } finally {
    state.busy = false;
    render();
  }
}

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.dataset.form === 'signin') {
    // Read before render(): rendering rebuilds the form and empties it.
    const values = {
      name: document.getElementById('si-name').value,
      password: document.getElementById('si-pass').value,
    };
    state.busy = true;
    say('');
    render();
    try {
      const result = await api('/session', { method: 'POST', body: values });
      state.session = { ...state.session, ...result };
      await loadRegistry();
    } catch (error) {
      say(error.message, 'bad');
    } finally {
      state.busy = false;
      render();
    }
  } else if (form.dataset.form === 'asset') saveAsset(form);
});

app.addEventListener('click', async (event) => {
  const target = event.target.closest('button, tr[data-id]');
  if (!target) return;
  if (target.dataset.cls) return openClass(target.dataset.cls);
  if (target.dataset.view === 'history') {
    Object.assign(state, {
      view: 'history',
      selectedId: null,
      creating: false,
    });
    await loadHistory();
    return render();
  }
  if (target.dataset.open) return openAsset(target.dataset.open);
  if (target.matches('tr[data-id]')) return openAsset(target.dataset.id);
  switch (target.dataset.action) {
    case 'signout':
      await api('/session', { method: 'DELETE' }).catch(() => {});
      state.session = { ...state.session, signedIn: false, name: null };
      state.registry = null;
      return render();
    case 'new':
      Object.assign(state, { creating: true, selectedId: null, problems: [] });
      render();
      return document.getElementById('f-id')?.focus();
    case 'close':
      Object.assign(state, { creating: false, selectedId: null, problems: [] });
      return render();
    case 'delete':
      return deleteAsset();
    case 'export':
      return download(
        `${state.registry.portId}-${state.cls}.csv`,
        assetsToCsv(state.cls, assetsOf(state.cls)),
      );
    case 'import-confirm':
      return confirmImport();
    case 'import-cancel':
      Object.assign(state, { importPlan: null, view: 'class', problems: [] });
      return render();
    default:
  }
});

app.addEventListener('keydown', (event) => {
  const row = event.target.closest?.('tr[data-id]');
  if (row && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openAsset(row.dataset.id);
  }
});

app.addEventListener('input', (event) => {
  if (event.target.id === 'filter') {
    state.filter = event.target.value;
    render();
  }
});

app.addEventListener('change', async (event) => {
  if (event.target.id === 'import-file' && event.target.files?.[0]) {
    planImport(event.target.files[0]);
  } else if (event.target.id === 'nav-select') {
    const value = event.target.value;
    if (value === 'view:history') {
      Object.assign(state, {
        view: 'history',
        selectedId: null,
        creating: false,
      });
      await loadHistory();
      render();
    } else openClass(value);
  }
});

(async function start() {
  try {
    state.session = await api('/session');
    if (state.session.signedIn) await loadRegistry();
  } catch (error) {
    state.session = { configured: true, signedIn: false };
    say(`The admin server did not answer: ${error.message}`, 'bad');
  }
  render();
})();
