import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../server/db/connection.js';
import { migrations } from '../../server/db/migrations.js';

let dir;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// A data folder saved by the Stage 4 app (database version 9) with a planting, tasks and log entries.
function version9() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-m10-'));
  const raw = new DatabaseSync(path.join(dir, 'garden.db'));
  raw.exec('PRAGMA foreign_keys = ON;');
  for (let i = 0; i < 9; i++) raw.exec(migrations[i]);
  raw.exec('PRAGMA user_version = 9');
  raw.exec(`INSERT INTO places (id, name) VALUES (1, 'Springfield');
    INSERT INTO spaces (id, place_id, name, kind) VALUES (1, 1, 'Bed', 'bed'), (2, 1, 'Pot', 'container');
    INSERT INTO plants (id, name, kind) VALUES (1, 'Fig', 'fruit_tree');
    INSERT INTO plantings (id, space_id, plant_id, how_started, start_on) VALUES (1, 1, 1, 'mature', '2027-03-01'), (2, 2, 1, 'mature', '2027-03-01');
    INSERT INTO tasks (id, planting_id, kind, due_on, done_on, auto, edited) VALUES (5, 1, 'plant', '2027-03-01', '2027-03-01', 1, 0), (6, 2, 'other', '2027-04-01', NULL, 0, 0);
    UPDATE tasks SET title = 'Stake it' WHERE id = 6;
    INSERT INTO planting_log (id, planting_id, on_date, kind, note, task_id) VALUES (9, 1, '2027-03-01', 'planted', NULL, 5), (10, 1, '2027-03-05', 'note', 'New leaves', NULL);`);
  raw.close();
}

describe('migration 10', () => {
  it('a version 9 database with tasks and log entries upgrades with every row, id and link kept', () => {
    version9();
    const db = openDb(dir);
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(migrations.length);
    expect(db.prepare('SELECT id, planting_id, kind, title, done_on FROM tasks ORDER BY id').all()).toEqual([
      { id: 5, planting_id: 1, kind: 'plant', title: null, done_on: '2027-03-01' }, { id: 6, planting_id: 2, kind: 'other', title: 'Stake it', done_on: null }]);
    expect(db.prepare('SELECT id, kind, note, task_id FROM planting_log ORDER BY id').all()).toEqual([
      { id: 9, kind: 'planted', note: null, task_id: 5 }, { id: 10, kind: 'note', note: 'New leaves', task_id: null }]);
    db.close();
  });

  it('foreign_key_check is empty after the upgrade', () => {
    version9();
    const db = openDb(dir);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(fs.readdirSync(path.join(dir, 'backups')).some(f => f.startsWith('pre-migrate-'))).toBe(true);
    db.close();
  });

  it('the new task and log kinds save, and an unknown kind is still refused', () => {
    version9();
    const db = openDb(dir);
    for (const k of ['prune', 'mulch', 'protect', 'check_pot']) db.prepare("INSERT INTO tasks (planting_id, kind, due_on, season_key) VALUES (1, ?, '2027-02-01', 'x')").run(k);
    for (const k of ['mulched', 'protected', 'moved', 'repotted']) db.prepare("INSERT INTO planting_log (planting_id, on_date, kind) VALUES (1, '2027-02-01', ?)").run(k);
    expect(() => db.prepare("INSERT INTO tasks (planting_id, kind, due_on) VALUES (1, 'dance', '2027-02-01')").run()).toThrow();
    expect(() => db.prepare("INSERT INTO planting_log (planting_id, on_date, kind) VALUES (1, '2027-02-01', 'sang')").run()).toThrow();
    db.close();
  });

  it('plantings in container spaces start marked as in a container', () => {
    version9();
    const db = openDb(dir);
    expect(db.prepare('SELECT id, in_container FROM plantings ORDER BY id').all()).toEqual([{ id: 1, in_container: 0 }, { id: 2, in_container: 1 }]);
    db.close();
  });
});
