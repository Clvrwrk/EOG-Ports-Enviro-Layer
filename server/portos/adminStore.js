/**
 * Server-side store for the port asset admin portal (/admin).
 *
 * One SQLite file holds the edited asset registry, a change history row for
 * every create, update and delete, and staff sign-in sessions. The file lives
 * in a data directory outside the repository (PORTOS_DATA_DIR, a Coolify
 * volume in production), so records port staff enter never reach the public
 * repo. On first open the registry is seeded from the code's seed registry.
 *
 * The store never trusts a write: every change is checked against the whole
 * registry with the injected `validate` function (validateRegistry) before it
 * is committed, and a save that names a stale `rev` is refused so two staff
 * editing the same asset cannot silently overwrite each other.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_HISTORY = 500;

let sqlite = null;
/** node:sqlite without its one-time ExperimentalWarning (see nominatimGate.js). */
function sqliteModule() {
  if (sqlite) return sqlite;
  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
    if (type === 'ExperimentalWarning' && /SQLite/.test(String(warning)))
      return;
    return emitWarning.call(this, warning, ...rest);
  };
  try {
    sqlite = process.getBuiltinModule('node:sqlite');
  } finally {
    process.emitWarning = emitWarning;
  }
  return sqlite;
}

/** A refused change: `status` is the HTTP status the API answers with. */
export class AdminError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const hashToken = (token) =>
  createHash('sha256').update(String(token)).digest('hex');

/** Strip bookkeeping keys a client may echo back; keep the asset's own data. */
export function cleanAsset(asset) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset))
    throw new AdminError(400, 'An asset must be an object');
  const out = {};
  for (const [key, value] of Object.entries(asset)) {
    if (key === 'rev' || key === 'updatedAt' || key === 'updatedBy') continue;
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  if (typeof out.id !== 'string' || !/^[A-Za-z0-9][\w.-]{0,79}$/.test(out.id))
    throw new AdminError(
      400,
      'Asset id must be 1-80 letters, digits, dot, dash or underscore',
    );
  if (typeof out.class !== 'string' || !out.class)
    throw new AdminError(400, `Asset ${out.id} has no class`);
  return out;
}

/**
 * Open (creating and seeding if needed) the admin store.
 *
 * @param {object} options
 * @param {string} options.dir data directory, or ':memory:' for tests
 * @param {{ portId: string, specs: object, assets: object[] }} options.seed
 * @param {(registry: object) => string[]} options.validate
 * @param {() => number} [options.now]
 */
export function openAdminStore({ dir, seed, validate, now = Date.now }) {
  const { DatabaseSync } = sqliteModule();
  let file = ':memory:';
  if (dir !== ':memory:') {
    mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'portos-admin.sqlite');
  }
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS assets (
      port_id TEXT NOT NULL,
      id TEXT NOT NULL,
      class TEXT NOT NULL,
      data TEXT NOT NULL,
      rev INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (port_id, id)
    );
    CREATE TABLE IF NOT EXISTS history (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      port_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      action TEXT NOT NULL,
      before TEXT,
      after TEXT,
      at INTEGER NOT NULL,
      by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS history_asset ON history (port_id, asset_id, seq);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
  `);

  const portId = seed.portId;
  const q = {
    count: db.prepare('SELECT COUNT(*) AS n FROM assets WHERE port_id = ?'),
    all: db.prepare(
      'SELECT data, rev, updated_at, updated_by FROM assets WHERE port_id = ? ORDER BY class, id',
    ),
    one: db.prepare(
      'SELECT data, rev, updated_at, updated_by FROM assets WHERE port_id = ? AND id = ?',
    ),
    insert: db.prepare(
      'INSERT INTO assets (port_id, id, class, data, rev, updated_at, updated_by) VALUES (?, ?, ?, ?, 1, ?, ?)',
    ),
    update: db.prepare(
      'UPDATE assets SET class = ?, data = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE port_id = ? AND id = ?',
    ),
    remove: db.prepare('DELETE FROM assets WHERE port_id = ? AND id = ?'),
    log: db.prepare(
      'INSERT INTO history (port_id, asset_id, action, before, after, at, by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    historyAsset: db.prepare(
      'SELECT seq, asset_id, action, before, after, at, by FROM history WHERE port_id = ? AND asset_id = ? ORDER BY seq DESC LIMIT ?',
    ),
    historyAll: db.prepare(
      'SELECT seq, asset_id, action, before, after, at, by FROM history WHERE port_id = ? ORDER BY seq DESC LIMIT ?',
    ),
    sessionAdd: db.prepare(
      'INSERT INTO sessions (token_hash, name, expires) VALUES (?, ?, ?)',
    ),
    sessionGet: db.prepare(
      'SELECT name, expires FROM sessions WHERE token_hash = ?',
    ),
    sessionDrop: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    sessionPrune: db.prepare('DELETE FROM sessions WHERE expires < ?'),
  };

  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  const rowAsset = (row) => ({
    ...JSON.parse(row.data),
    rev: row.rev,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  });

  if (q.count.get(portId).n === 0) {
    transaction(() => {
      const at = now();
      for (const asset of seed.assets) {
        const data = cleanAsset(asset);
        q.insert.run(
          portId,
          data.id,
          data.class,
          JSON.stringify(data),
          at,
          'seed',
        );
        q.log.run(
          portId,
          data.id,
          'seed',
          null,
          JSON.stringify(data),
          at,
          'seed',
        );
      }
    });
  }

  const assets = () => q.all.all(portId).map(rowAsset);
  const plain = (list) =>
    list.map(({ rev: _r, updatedAt: _a, updatedBy: _b, ...rest }) => rest);

  /** The registry as the simulator reads it (no bookkeeping fields). */
  const registry = () => ({
    portId,
    source: 'admin portal',
    specs: seed.specs,
    assets: plain(assets()),
  });

  /** Refuse a candidate asset list the validator finds problems with. */
  const check = (list, touched) => {
    const problems = validate({ portId, specs: seed.specs, assets: list });
    // Problems that only concern untouched assets were already there (for
    // example a seed placeholder); don't block an unrelated edit on them.
    const mentions = (problem, id) =>
      new RegExp(`(^|[\\s:])${id.replace(/[.]/g, '\\.')}([\\s:]|$)`).test(
        problem,
      );
    const mine = touched
      ? problems.filter((p) => touched.some((id) => mentions(p, id)))
      : problems;
    if (mine.length)
      throw new AdminError(422, 'The change was not saved', mine);
  };

  function saveAsset({ asset, by, rev }) {
    const data = cleanAsset(asset);
    return transaction(() => {
      const at = now();
      const existing = q.one.get(portId, data.id);
      if (existing) {
        if (rev !== undefined && Number(rev) !== existing.rev)
          throw new AdminError(
            409,
            `${data.id} was changed by ${existing.updated_by} since you opened it. Reload to see their change.`,
          );
        const before = existing.data;
        if (before === JSON.stringify(data)) return rowAsset(existing);
        const list = plain(assets()).map((a) => (a.id === data.id ? data : a));
        check(list, [data.id]);
        q.update.run(data.class, JSON.stringify(data), at, by, portId, data.id);
        q.log.run(
          portId,
          data.id,
          'update',
          before,
          JSON.stringify(data),
          at,
          by,
        );
      } else {
        if (rev !== undefined)
          throw new AdminError(404, `${data.id} no longer exists`);
        check([...plain(assets()), data], [data.id]);
        q.insert.run(portId, data.id, data.class, JSON.stringify(data), at, by);
        q.log.run(
          portId,
          data.id,
          'create',
          null,
          JSON.stringify(data),
          at,
          by,
        );
      }
      return rowAsset(q.one.get(portId, data.id));
    });
  }

  function deleteAsset({ id, by, rev }) {
    return transaction(() => {
      const existing = q.one.get(portId, id);
      if (!existing) throw new AdminError(404, `${id} does not exist`);
      if (rev !== undefined && Number(rev) !== existing.rev)
        throw new AdminError(409, `${id} was changed since you opened it`);
      const list = plain(assets()).filter((a) => a.id !== id);
      // Anything still pointing at the deleted asset breaks.
      check(list, [id]);
      q.remove.run(portId, id);
      q.log.run(portId, id, 'delete', existing.data, null, now(), by);
      return { id };
    });
  }

  /**
   * Create or update many assets in one transaction (CSV/Excel import).
   * All rows are checked together, so rows may reference each other.
   */
  function importAssets({ rows, by }) {
    if (!Array.isArray(rows) || !rows.length)
      throw new AdminError(400, 'Nothing to import');
    if (rows.length > 5000)
      throw new AdminError(413, 'Import at most 5,000 rows at a time');
    const incoming = rows.map(cleanAsset);
    const seen = new Set();
    for (const row of incoming) {
      if (seen.has(row.id))
        throw new AdminError(422, 'The import was not saved', [
          `asset ${row.id}: appears twice in the file`,
        ]);
      seen.add(row.id);
    }
    return transaction(() => {
      const current = plain(assets());
      const byId = new Map(current.map((a) => [a.id, a]));
      for (const row of incoming) byId.set(row.id, row);
      check([...byId.values()], [...seen]);
      const at = now();
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      for (const row of incoming) {
        const existing = q.one.get(portId, row.id);
        const json = JSON.stringify(row);
        if (!existing) {
          q.insert.run(portId, row.id, row.class, json, at, by);
          q.log.run(portId, row.id, 'import', null, json, at, by);
          created += 1;
        } else if (existing.data !== json) {
          q.update.run(row.class, json, at, by, portId, row.id);
          q.log.run(portId, row.id, 'import', existing.data, json, at, by);
          updated += 1;
        } else unchanged += 1;
      }
      return { created, updated, unchanged };
    });
  }

  function history({ assetId, limit = 100 } = {}) {
    const n = Math.max(1, Math.min(MAX_HISTORY, Number(limit) || 100));
    const rows = assetId
      ? q.historyAsset.all(portId, assetId, n)
      : q.historyAll.all(portId, n);
    return rows.map((row) => ({
      seq: row.seq,
      assetId: row.asset_id,
      action: row.action,
      before: row.before ? JSON.parse(row.before) : null,
      after: row.after ? JSON.parse(row.after) : null,
      at: row.at,
      by: row.by,
    }));
  }

  function createSession(name) {
    const token = randomBytes(32).toString('base64url');
    q.sessionPrune.run(now());
    q.sessionAdd.run(hashToken(token), name, now() + SESSION_TTL_MS);
    return { token, maxAgeSeconds: SESSION_TTL_MS / 1000 };
  }

  function checkSession(token) {
    if (!token) return null;
    const row = q.sessionGet.get(hashToken(token));
    if (!row) return null;
    if (row.expires < now()) {
      q.sessionDrop.run(hashToken(token));
      return null;
    }
    return { name: row.name };
  }

  const endSession = (token) => token && q.sessionDrop.run(hashToken(token));

  return {
    portId,
    assets,
    registry,
    saveAsset,
    deleteAsset,
    importAssets,
    history,
    createSession,
    checkSession,
    endSession,
    close: () => db.close(),
  };
}
