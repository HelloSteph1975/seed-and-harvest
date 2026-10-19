import { getSettings } from './settings.js';

// The optional link to Hearth & Larder. A harvest's larder part goes there through its API, after the save
// has finished: a slow or closed Hearth & Larder never holds up or blocks a save here. Each harvest keeps
// its own state (off, pending, sent, failed, removed) so the screens can show it and Send again can retry.
const SOURCE = 'seed-and-harvest';
const KG_PER_LB = 0.45359237;
const TIMEOUT_MS = 5000;
const NOT_ANSWERING = 'Hearth & Larder is not answering';

const ROW = `SELECT h.*, COALESCE(pp.name, tp.name) AS crop_name, v.name AS variety_name,
  COALESCE(ps.name, ts.name) AS space_name, pc.name AS place_name
  FROM harvests h
  LEFT JOIN plantings pl ON pl.id = h.planting_id LEFT JOIN plants pp ON pp.id = pl.plant_id LEFT JOIN spaces ps ON ps.id = pl.space_id
  LEFT JOIN plant_varieties v ON v.id = pl.variety_id AND v.deleted_at IS NULL
  LEFT JOIN trays tr ON tr.id = h.tray_id LEFT JOIN plants tp ON tp.id = tr.plant_id LEFT JOIN spaces ts ON ts.id = tr.space_id
  LEFT JOIN places pc ON pc.id = COALESCE(ps.place_id, ts.place_id)
  WHERE h.id = ?`;

// None of these bump `version`: the link's bookkeeping must not make an open form go stale.
function setState(db, id, state, { error = null, sentAt } = {}) {
  if (sentAt === undefined) db.prepare('UPDATE harvests SET larder_state = ?, larder_error = ? WHERE id = ?').run(state, error, id);
  else db.prepare('UPDATE harvests SET larder_state = ?, larder_error = ?, larder_sent_at = ? WHERE id = ?').run(state, error, sentAt, id);
}

// Called inside a save: the harvest waits for its send, or is off when the link is.
export function markPending(db, id) {
  setState(db, id, getSettings(db).larder_link ? 'pending' : 'off');
}

function payload(row, units) {
  const weight = row.unit === 'kg';
  const lb = weight && units === 'us';
  const quantity = lb ? row.larder_qty / KG_PER_LB : row.larder_qty;
  return {
    crop: row.variety_name ? `${row.crop_name} (${row.variety_name})` : row.crop_name,
    quantity: Math.round(quantity * 1000) / 1000,
    unit: weight ? (lb ? 'lb' : 'kg') : row.unit,
    harvested_on: row.harvested_on,
    note: `From Seed & Harvest: ${[row.space_name, row.place_name].filter(Boolean).join(', ')}`,
  };
}

const signal = ctx => AbortSignal.timeout(ctx.config.larderTimeoutMs ?? TIMEOUT_MS);

// Returns null when Hearth & Larder took it, or a short reason when it did not.
async function call(ctx, url, opts) {
  let res;
  try { res = await ctx.fetch(url, { ...opts, signal: signal(ctx) }); } catch { return NOT_ANSWERING; }
  return res.ok ? null : `Hearth & Larder said no (${res.status})`;
}

// Sends one harvest's current state: its larder part (PUT), or its removal (DELETE) when the part is 0 or the
// harvest is in the Trash. A removal is only sent for a harvest that reached Hearth & Larder before.
export async function syncHarvest(ctx, id) {
  const settings = getSettings(ctx.db);
  const row = ctx.db.prepare(ROW).get(id);
  if (!row) { await sendOwedRemoval(ctx, settings, id); return; }
  if (!settings.larder_link) { setState(ctx.db, id, 'off'); return; }
  const url = `${settings.larder_url}/api/harvests/external/${SOURCE}/${id}`;
  const remove = row.deleted_at != null || !(row.larder_qty > 0);
  if (remove && !row.larder_sent_at) { setState(ctx.db, id, row.larder_state === 'removed' ? 'removed' : 'off'); return; }
  const error = remove
    ? await call(ctx, url, { method: 'DELETE' })
    : await call(ctx, url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(row, settings.units)) });
  if (error) setState(ctx.db, id, 'failed', { error });
  else if (remove) setState(ctx.db, id, 'removed', { sentAt: null });
  else setState(ctx.db, id, 'sent', { sentAt: new Date(ctx.now()).toISOString() });
}

// A harvest emptied from the Trash while its copy was still in Hearth & Larder (or the removal had not gone
// through): the removal is kept in the outbox until Hearth & Larder takes it.
export function owesRemoval(ctx, row) {
  if (!row.larder_sent_at || row.larder_state === 'removed') return;
  ctx.db.prepare('INSERT OR IGNORE INTO larder_outbox (harvest_id) VALUES (?)').run(row.id);
  ctx.larder.queue(row.id);
}

async function sendOwedRemoval(ctx, settings, id) {
  if (!settings.larder_link || !ctx.db.prepare('SELECT 1 FROM larder_outbox WHERE harvest_id = ?').get(id)) return;
  const error = await call(ctx, `${settings.larder_url}/api/harvests/external/${SOURCE}/${id}`, { method: 'DELETE' });
  if (!error) ctx.db.prepare('DELETE FROM larder_outbox WHERE harvest_id = ?').run(id);
}

// One send at a time, in order, each after the save that asked for it has finished.
export function createLarder(ctx) {
  let chain = Promise.resolve();
  const waiting = new Set();
  return {
    queue(id) {
      if (waiting.has(id)) return;
      waiting.add(id);
      chain = chain
        .then(() => new Promise(resolve => setImmediate(resolve)))
        .then(() => { waiting.delete(id); return syncHarvest(ctx, id); })
        .catch(err => console.error('Could not send a harvest to Hearth & Larder:', err.message));
    },
    idle: () => chain,
  };
}

// For a save that just changed harvest `id`.
export function harvestChanged(ctx, id) {
  markPending(ctx.db, id);
  ctx.larder.queue(id);
}

// At startup: every harvest still waiting, or that failed, gets one more try.
export function retryPending(ctx) {
  for (const { id } of ctx.db.prepare("SELECT id FROM harvests WHERE larder_state IN ('pending', 'failed') ORDER BY id").all()) ctx.larder.queue(id);
  for (const { harvest_id: id } of ctx.db.prepare('SELECT harvest_id FROM larder_outbox ORDER BY harvest_id').all()) ctx.larder.queue(id);
  return ctx.larder.idle();
}

// Turning the link on: every harvest that should be in Hearth & Larder (or taken out of it) gets sent.
export function sendAll(ctx) {
  const rows = ctx.db.prepare(`SELECT id FROM harvests WHERE (deleted_at IS NULL AND larder_qty > 0)
    OR (larder_sent_at IS NOT NULL AND larder_state != 'removed') ORDER BY id`).all();
  for (const { id } of rows) harvestChanged(ctx, id);
  return retryPending(ctx);
}

export async function testLink(ctx) {
  const { larder_url } = getSettings(ctx.db);
  let res;
  try { res = await ctx.fetch(`${larder_url}/api/health`, { signal: signal(ctx) }); } catch { return { ok: false, code: 'not_answering', error: NOT_ANSWERING }; }
  const json = await res.json().catch(() => null);
  return res.ok && json?.ok ? { ok: true } : { ok: false, code: 'said_no', status: res.status, error: `Hearth & Larder said no (${res.status})` };
}
