import { openDb } from './db/connection.js';
import { seedStarter } from './services/starter.js';
import { readEpoch } from './services/epoch.js';
import { untrashLivePhotos } from './services/photos.js';
import { sendToRecycleBin } from './lib/recycle.js';

// Opening (and reopening after a restore) always tops up starter content.
function open(dataDir, contentDir) {
  const db = openDb(dataDir);
  seedStarter(db, contentDir ? { content: contentDir } : undefined);
  return db;
}

export function createContext(config) {
  const ctx = {
    config,
    now: config.now ?? (() => new Date()),
    fetch: config.fetch ?? globalThis.fetch,
    recycle: config.recycle ?? sendToRecycleBin,
    db: open(config.dataDir, config.contentDir),
    epoch: readEpoch(config.dataDir),
    reopen() {
      ctx.db = open(config.dataDir, config.contentDir);
      untrashLivePhotos(ctx.db, config.dataDir);
      return ctx.db;
    },
  };
  untrashLivePhotos(ctx.db, config.dataDir);
  return ctx;
}
