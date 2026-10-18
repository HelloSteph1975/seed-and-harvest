import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 4215;
export const DEMO_PORT = 4217;

export function defaultDataDir(demo = false) {
  return path.join(os.homedir(), 'Documents', demo ? 'Seed & Harvest Demo Data' : 'Seed & Harvest Data');
}

export function parsePort(value, source) {
  const s = String(value).trim();
  const n = /^\d+$/.test(s) ? Number(s) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`The port in ${source} must be a whole number from 1 to 65535 (got ${JSON.stringify(value)}).`);
  }
  return n;
}

export function readConfigFile(file) {
  if (!fs.existsSync(file)) return {};
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}). If it has a Windows path, use double backslashes (\\\\), like "D:\\\\Garden Data".`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file} must hold a JSON object, like { "port": 4215 }.`);
  return data;
}

// SEED_HARVEST_CONTENT_DIR (tests only) swaps the starter library for another folder.
export function readContentDir(env) {
  const dir = env.SEED_HARVEST_CONTENT_DIR;
  if (!dir) return undefined;
  const ok = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  if (!ok) throw new Error(`SEED_HARVEST_CONTENT_DIR must be an existing folder (got ${JSON.stringify(dir)}).`);
  return path.resolve(dir);
}

const contentOpt = env => { const contentDir = readContentDir(env); return contentDir ? { contentDir } : {}; };

export function loadConfig({ env = process.env, root = process.cwd(), demo = false } = {}) {
  if (demo) {
    const port = env.SEED_HARVEST_DEMO_PORT ? parsePort(env.SEED_HARVEST_DEMO_PORT, 'SEED_HARVEST_DEMO_PORT') : DEMO_PORT;
    return { dataDir: env.SEED_HARVEST_DEMO_DATA_DIR || defaultDataDir(true), port, demo: true, ...contentOpt(env) };
  }
  const p = path.join(root, 'config.json');
  const file = readConfigFile(p);
  let port = DEFAULT_PORT;
  if (env.SEED_HARVEST_PORT) port = parsePort(env.SEED_HARVEST_PORT, 'SEED_HARVEST_PORT');
  else if (file.port !== undefined && file.port !== null) port = parsePort(file.port, p);
  return { dataDir: env.SEED_HARVEST_DATA_DIR || file.dataDir || defaultDataDir(false), port, demo: false, ...contentOpt(env) };
}
