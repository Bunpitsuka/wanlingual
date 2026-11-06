// sw.js の単体テスト。本物の Service Worker は使わず、self / caches / fetch を差し替えて「どの通信に手を出すか」だけを確かめる。
// 目的: 犬の声チェックの tfjs（jsdelivr）と YAMNet のモデル（tfhub / kaggle、約 15MB）を Service Worker のキャッシュに入れないこと
// （plan.md 設計メモ 7-ii。入れると VERSION を上げるたびに消えて読み直しになる）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../app/sw.js'), 'utf8');
const ORIGIN = 'https://bunpitsuka.github.io';

/** sw.js を偽の環境で読み込み、fetch イベントを 1 つ流せるようにする */
function boot({ online = true } = {}) {
  const listeners = {};
  const store = new Map(); // キャッシュ名 → Map(url → 応答)
  const open = async name => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return { put: async (req, res) => { m.set(req.url || String(req), res); }, addAll: async list => { for (const u of list) m.set(u, { ok: true }); } };
  };
  const caches = {
    open,
    match: async req => { for (const m of store.values()) if (m.has(req.url)) return m.get(req.url); return undefined; },
    keys: async () => [...store.keys()],
    delete: async k => store.delete(k),
  };
  const fetched = [];
  const fetch = async req => {
    fetched.push(req.url);
    if (!online) throw new Error('offline');
    return { ok: true, type: 'basic', url: req.url, clone() { return { ok: true, cloned: req.url }; } };
  };
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  vm.runInNewContext(src, { self, caches, fetch, location: { origin: ORIGIN }, URL, Promise, console });
  /** fetch イベントを流す。戻り値: { handled（respondWith したか）, response } */
  const request = async (url, method = 'GET') => {
    let responded = null;
    listeners.fetch({ request: { url, method }, respondWith: p => { responded = Promise.resolve(p); } });
    const response = responded ? await responded : null;
    await new Promise(r => setTimeout(r, 0)); // 裏のキャッシュ書き込みを待つ
    return { handled: !!responded, response };
  };
  const cached = () => [...store.values()].flatMap(m => [...m.keys()]);
  return { request, cached, fetched, listeners, store };
}

test('sw.js: tfjs（jsdelivr）と YAMNet のモデル（tfhub / kaggle / storage）には手を出さず、キャッシュにも入れない', async () => {
  const sw = boot();
  const urls = [
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1/model.json?tfjs-format=file',
    'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1/group1-shard1of4.bin?tfjs-format=file',
    'https://www.kaggle.com/models/google/yamnet/frameworks/tfJs/variations/tfjs/versions/1/model.json',
    'https://storage.googleapis.com/kagglesdsdata/models/yamnet/group1-shard1of4.bin',
  ];
  for (const u of urls) {
    const r = await sw.request(u);
    assert.equal(r.handled, false, `${u} は Service Worker が触らない`);
  }
  assert.deepEqual(sw.fetched, [], 'Service Worker からは取りに行かない（ブラウザに任せる）');
  assert.deepEqual(sw.cached(), [], 'キャッシュに何も入らない');
});

test('sw.js: フォントはネットワーク優先でキャッシュし、オフラインではキャッシュから返す', async () => {
  const css = 'https://fonts.googleapis.com/css2?family=DotGothic16&display=swap';
  const woff = 'https://fonts.gstatic.com/s/dotgothic16/v1/a.woff2';
  const sw = boot();
  for (const u of [css, woff]) {
    const r = await sw.request(u);
    assert.equal(r.handled, true);
    assert.equal(r.response.url, u);
  }
  assert.deepEqual(sw.cached().sort(), [css, woff].sort());

  // 同じキャッシュのままオフラインにする
  const off = boot({ online: false });
  for (const [k, m] of sw.store) off.store.set(k, m);
  const r = await off.request(css);
  assert.equal(r.handled, true);
  assert.deepEqual(r.response, { ok: true, cloned: css });
});

test('sw.js: 自分のファイルは従来どおり扱い、GET 以外は触らない', async () => {
  const sw = boot();
  const own = await sw.request(`${ORIGIN}/wanlingual/js/app.js`);
  assert.equal(own.handled, true);
  assert.ok(sw.cached().includes(`${ORIGIN}/wanlingual/js/app.js`));
  const post = await sw.request(`${ORIGIN}/wanlingual/api`, 'POST');
  assert.equal(post.handled, false);
});

test('sw.js: 事前キャッシュに tfjs・モデルを入れていない／dogcheck.js は入っている', () => {
  const shell = src.match(/const SHELL = \[([^\]]+)\]/)[1];
  assert.ok(shell.includes('./js/dogcheck.js'));
  assert.ok(!/jsdelivr|tfhub|kaggle|lab\//.test(shell));
});
