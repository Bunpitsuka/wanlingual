// sw.js — オフライン用。アプリ本体は事前キャッシュ、フォントはキャッシュしつつネットワーク優先。
// それ以外の外部オリジン（犬の声チェックの tfjs＝jsdelivr、YAMNet のモデル＝tfhub / kaggle、約 15MB）には手を出さない:
// ここのキャッシュに入れると VERSION を上げるたびに消えて読み直しになるので、ブラウザ自身の HTTP キャッシュに任せる。
const VERSION = 'wl-v12';
/** Service Worker のキャッシュに入れてよい外部オリジン（フォントだけ） */
const CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const SHELL = ['./', './index.html', './css/app.css', './js/app.js', './js/features.js', './js/classify.js', './js/store.js', './js/mic.js', './js/share.js', './js/recs.js', './js/mascot.js', './js/dogcheck.js', './js/voice.js', './affiliate.json', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // 自分のファイル: キャッシュ優先、裏で更新
    e.respondWith(caches.match(req).then(hit => {
      const fetching = fetch(req).then(res => { if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone())); return res; }).catch(() => hit);
      return hit || fetching;
    }));
  } else if (CACHEABLE_HOSTS.includes(url.hostname)) {
    // フォント: ネットワーク優先、失敗したらキャッシュ
    e.respondWith(fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') caches.open(VERSION).then(c => c.put(req, res.clone())).catch(() => {});
      return res;
    }).catch(() => caches.match(req)));
  }
  // その他の外部オリジンは respondWith しない（ブラウザがふつうに取りに行く）
});
