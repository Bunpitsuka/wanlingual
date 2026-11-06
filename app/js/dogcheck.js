// dogcheck.js — 「犬の声か、それ以外か」を YAMNet で確かめる前段（plan #14 の実装 ②。設計メモは docs/plan.md）。
//
// 既定はオフ。localStorage の `wl.dogcheck` が 'on' のときだけ、監視を始めたあとに裏で
//   1) 実験室の純粋関数（app/lab/yamnet.js。同じオリジン）
//   2) TensorFlow.js（jsdelivr の固定バージョン。<script> を動的に足す）
//   3) YAMNet のモデル（TF Hub v1、約 15MB。初回のみ、2 回目からはブラウザのキャッシュ）
// を読む。読めるまで・読めなかったとき・オフのときは、check() が null を返すだけで、本体は従来どおり音量だけで動く。
// 音声は端末の外に出さない（モデルを端末に落として、端末の中で推論する）。
//
// このファイルは犬らしさを出すところまで（②）。しきい値未満の音を薄く表示して吠え回数から外すのは app.js 側（③。捨てはしない）。

export const KEY = 'wl.dogcheck';
/** 犬らしさ（犬系 7 クラスの最大値）がこれ以上なら「犬」。docs/accuracy.md 2026-11-03〜05 の計測で決定 */
export const THRESHOLD = 0.3;

const storageOf = s => { try { return s ?? globalThis.localStorage ?? null; } catch { return null; } };

/** 設定がオンか（既定はオフ。localStorage が使えない環境もオフ） */
export function isEnabled(storage) {
  try { return storageOf(storage)?.getItem(KEY) === 'on'; } catch { return false; }
}
/** 設定を書く。オフは項目ごと消す。書けたら true */
export function setEnabled(on, storage) {
  try { const s = storageOf(storage); if (!s) return false; if (on) s.setItem(KEY, 'on'); else s.removeItem(KEY); return true; } catch { return false; }
}
/**
 * URL の `?dogcheck=on` / `?dogcheck=off` を設定に反映する（設定画面のトグル＝④ ができるまでの、実機で試すための入口）。
 * 戻り値: 'on' | 'off' | null（指定なし・それ以外の値は何もしない）
 */
export function applyUrlParam(search, storage) {
  let v = null;
  try { v = new URLSearchParams(search || '').get('dogcheck'); } catch { return null; }
  if (v === 'on' || v === '1') { setEnabled(true, storage); return 'on'; }
  if (v === 'off' || v === '0') { setEnabled(false, storage); return 'off'; }
  return null;
}

/** <script> を足して読み込む（ブラウザ専用）。tf が既に読まれていれば足さない */
function loadScript(url) {
  return new Promise((ok, ng) => {
    if (globalThis.tf) return ok();
    const s = document.createElement('script');
    s.src = url; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => ok();
    s.onerror = () => { s.remove(); ng(new Error('TensorFlow.js が読み込めません（CDN に届かないか、オフライン）')); };
    document.head.appendChild(s);
  });
}

export class DogCheck {
  /**
   * @param {object} [deps] テスト用に差し替えられる入口
   * @param {()=>Promise<object>} [deps.importLab]  実験室の純粋関数（app/lab/yamnet.js）を読む
   * @param {(url:string)=>Promise<void>} [deps.loadScript]  tfjs の <script> を足す
   * @param {()=>any} [deps.getTf]  読み込んだ tf（グローバル）を返す
   * @param {(state:string)=>void} [deps.onState]  状態が変わったとき（'loading' | 'ready' | 'failed'）
   */
  constructor(deps = {}) {
    this.importLab = deps.importLab || (() => import('../lab/yamnet.js'));
    this.loadScript = deps.loadScript || loadScript;
    this.getTf = deps.getTf || (() => globalThis.tf);
    this.onState = deps.onState || (() => {});
    this.threshold = deps.threshold ?? THRESHOLD;
    /** 'idle'（まだ読んでいない）| 'loading' | 'ready' | 'failed' */
    this.state = 'idle';
    this.error = null;
    this.busy = false;
    this.lab = null; this.tf = null; this.model = null;
    this._loading = null;
  }

  _set(state) { this.state = state; try { this.onState(state); } catch {} }

  /**
   * モデルを裏で読む。何度呼んでもよい（読み込み中は同じ Promise、読めていれば何もしない、失敗していたらやり直す）。
   * 例外は投げない。戻り値: 読めたら true
   */
  load() {
    if (this.state === 'ready') return Promise.resolve(true);
    if (this._loading) return this._loading;
    this.error = null; this._set('loading');
    this._loading = (async () => {
      try {
        const lab = await this.importLab();
        await this.loadScript(`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@${lab.TFJS_VERSION}/dist/tf.min.js`);
        const tf = this.getTf();
        const model = await lab.loadYamnet(tf);
        this.lab = lab; this.tf = tf; this.model = model;
        this._set('ready');
        return true;
      } catch (e) {
        this.error = String(e?.message || e);
        this._set('failed');
        return false;
      } finally { this._loading = null; }
    })();
    return this._loading;
  }

  /**
   * 犬らしさを出す。wide: mic.js の onCluster 第 3 引数（塊の前に実音を足した最低 2 秒の波形）、sr: そのサンプルレート。
   * 戻り値: { isDog, dog, dogTop, ms, sec } か、判定できないとき null（未準備・読み込み失敗・前の推論がまだ終わっていない・推論の失敗）。
   * null のとき本体は従来どおり動く（設計メモの状態 (a)）。例外は投げない。
   */
  async check(wide, sr) {
    if (this.state !== 'ready' || this.busy || !wide?.length || !(sr > 0)) return null;
    this.busy = true;
    try {
      const r = await this.lab.classify(this.tf, this.model, this.lab.resampleTo16k(wide, sr));
      return { isDog: r.dog >= this.threshold, dog: r.dog, dogTop: r.dogTop, ms: r.ms, sec: wide.length / sr };
    } catch (e) {
      this.error = String(e?.message || e);
      return null;
    } finally { this.busy = false; }
  }
}
