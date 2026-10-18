// Small per-browser conveniences (like the last place picked). Storage can be blocked or
// cleared, so every read and write is allowed to fail quietly.
export function readLocal(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function writeLocal(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* not saved; that's fine */ }
}
