// store.js — 学習データはこの端末（localStorage）だけに保存する。音声そのものは保存しない。
const KEY = 'wanlingual.samples.v1';
const DOG = 'wanlingual.samples.v1.dog';
const OWNER = 'wanlingual.owner';
const MAX = 2000;

function read(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : v; } catch { return fallback; } }
function write(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }

export function loadSamples() {
  try { const j = read(KEY, null); const a = j ? JSON.parse(j) : []; return Array.isArray(a) ? a : []; } catch { return []; }
}
export function saveSamples(samples) { return write(KEY, JSON.stringify(samples.slice(-MAX))); }
export function loadDogName() { return read(DOG, 'モカ'); }
export function saveDogName(v) { return write(DOG, v); }
export function loadOwnerName() { return read(OWNER, '飼い主'); }
export function saveOwnerName(v) { return write(OWNER, v); }
export function exportJSON(dog, samples) { return JSON.stringify({ app: 'wanlingual', v: 1, dog, exported: new Date().toISOString(), samples }); }
export function importJSON(text) {
  const j = JSON.parse(text);
  const arr = Array.isArray(j) ? j : j.samples;
  if (!Array.isArray(arr)) throw new Error('形式が違います');
  return arr.filter(s => s && typeof s.label === 'string' && s.f && typeof s.f.n === 'number');
}
