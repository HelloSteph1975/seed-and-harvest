import fs from 'node:fs';
import path from 'node:path';
import { transaction } from '../db/connection.js';

export const CONTENT_DIR = path.join(import.meta.dirname, '..', 'content');

export const readJson = (dir, rel) => {
  const file = path.join(dir, rel);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
};

// Seeds one simple table from a list of starter rows. Skips rows already here (edited or in the
// Trash) and rows the owner deleted forever. Returns how many rows were added.
export function seedSimple(db, table, columns, rows) {
  const removed = db.prepare('SELECT 1 FROM starter_removed WHERE starter_key = ?');
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE starter_key = ?`);
  const cols = [...columns, 'starter_key', 'is_starter', 'content_version'];
  const insert = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  let added = 0;
  for (const e of rows) {
    if (exists.get(e.starter_key) || removed.get(e.starter_key)) continue;
    insert.run(...columns.map(c => e[c] ?? null), e.starter_key, 1, e.content_version ?? 1);
    added++;
  }
  return added;
}

// Tops up starter content. Stage 1 has none yet; the plant library adds its tables here.
export function seedStarter(db, { content = CONTENT_DIR } = {}) {
  return transaction(db, () => {
    void content;
    return 0;
  });
}
