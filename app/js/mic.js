// mic.js — マイク常時監視。吠えのまとまり（クラスター）を検出したら、その区間の波形を返す。
// 設計: ScriptProcessorNode（iOS Safari を含め最も広く動く）で 256 サンプルごとの RMS を取り、
// 直近 6 秒のリングバッファを保持。RMS が適応しきい値を超えた区間をイベント、
// イベントが 700ms 途切れたらクラスター終了 → onCluster(x, sr) を呼ぶ。
// 特徴量の計算は features.analyzeSamples() に任せ、ファイル読み込みと同じ関数で統一する。

export class Listener {
  /**
   * @param {object} opts
   * @param {(x:Float32Array, sr:number)=>void} opts.onCluster  クラスター確定時（波形はコピー）
   * @param {(level:number, thr:number, listening:boolean)=>void} [opts.onLevel]  メーター表示用（約20fps）
   * @param {(msg:string)=>void} [opts.onStatus]
   */
  constructor(opts) {
    this.onCluster = opts.onCluster;
    this.onLevel = opts.onLevel || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.hop = 256;
    this.ringSec = 6;
    this.clusterGapMs = 700;     // これ以上静かならクラスター終了
    this.maxClusterSec = 6;      // 長すぎるクラスターは強制確定
    this.minEventMs = 45;
    this.mergeGapMs = 90;
    this.preRollSec = 0.25;
    this.postRollSec = 0.12;
    this.running = false;
  }

  async start() {
    if (this.running) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !navigator.mediaDevices?.getUserMedia) throw new Error('この端末のブラウザはマイク監視に対応していません');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false,
    });
    this.ac = new AC();
    if (this.ac.state === 'suspended') await this.ac.resume();
    this.sr = this.ac.sampleRate;
    const ring = Math.ceil(this.ringSec * this.sr);
    this.ring = new Float32Array(ring);
    this.ringPos = 0;          // 次に書く位置
    this.total = 0;            // 累計サンプル数（絶対位置）
    this.floor = 0.003;        // 適応ノイズ床
    this.floorInit = 0;
    this.inEvent = false;
    this.eventStart = 0; this.eventEnd = 0; this.lastEventEnd = -1;
    this.clusterStart = -1; this.events = 0;
    this.hopBuf = new Float32Array(this.hop); this.hopFill = 0;
    this.lastLevelEmit = 0;

    this.src = this.ac.createMediaStreamSource(this.stream);
    // ScriptProcessor は非推奨だが iOS Safari を含め現状いちばん確実に動く
    this.proc = this.ac.createScriptProcessor(2048, 1, 1);
    this.proc.onaudioprocess = e => this._onAudio(e.inputBuffer.getChannelData(0));
    this.src.connect(this.proc);
    // 出力につながないと処理が走らないブラウザがあるので、無音のゲインを挟む
    this.sink = this.ac.createGain(); this.sink.gain.value = 0;
    this.proc.connect(this.sink); this.sink.connect(this.ac.destination);
    this.running = true;
    this.onStatus('listening');
    this._wakeLock();
  }

  async stop() {
    this.running = false;
    try { this.proc && (this.proc.onaudioprocess = null); this.proc?.disconnect(); this.src?.disconnect(); this.sink?.disconnect(); } catch {}
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch {}
    try { await this.ac?.close(); } catch {}
    try { await this.lock?.release(); } catch {}
    this.lock = null;
    this.onStatus('stopped');
  }

  async _wakeLock() {
    try { if ('wakeLock' in navigator) this.lock = await navigator.wakeLock.request('screen'); } catch {}
  }

  _onAudio(chunk) {
    if (!this.running) return;
    const r = this.ring, L = r.length;
    for (let i = 0; i < chunk.length; i++) {
      r[this.ringPos] = chunk[i];
      this.ringPos = (this.ringPos + 1) % L;
      this.total++;
      this.hopBuf[this.hopFill++] = chunk[i];
      if (this.hopFill === this.hop) { this._onHop(); this.hopFill = 0; }
    }
  }

  _onHop() {
    const h = this.hopBuf;
    let s = 0; for (let i = 0; i < h.length; i++) s += h[i] * h[i];
    const rms = Math.sqrt(s / h.length);
    const now = this.total; // サンプル単位の絶対時刻
    // 適応ノイズ床: 静かなときはゆっくり追従、うるさいときはほぼ動かさない
    if (this.floorInit < this.sr * 0.5) { this.floor = this.floor * 0.9 + rms * 0.1; this.floorInit += this.hop; }
    else if (!this.inEvent) this.floor = this.floor * 0.995 + rms * 0.005;
    const thr = Math.max(this.floor * 4, 0.012);
    const msToS = ms => Math.round(ms / 1000 * this.sr);

    if (rms > thr) {
      if (!this.inEvent) {
        // 直前のイベントからの切れ目が短ければ同一イベントとして結合
        if (this.lastEventEnd >= 0 && now - this.lastEventEnd < msToS(this.mergeGapMs)) { this.inEvent = true; }
        else { this.inEvent = true; this.eventStart = now; }
        if (this.clusterStart < 0) this.clusterStart = this.eventStart;
      }
      this.eventEnd = now;
    } else if (this.inEvent) {
      this.inEvent = false;
      if (this.eventEnd - this.eventStart >= msToS(this.minEventMs)) { this.events++; this.lastEventEnd = this.eventEnd; }
    }

    // クラスター終了判定
    if (this.clusterStart >= 0) {
      const quiet = !this.inEvent && this.lastEventEnd >= 0 && now - this.lastEventEnd >= msToS(this.clusterGapMs);
      const tooLong = now - this.clusterStart >= this.maxClusterSec * this.sr;
      const stale = !this.inEvent && this.events === 0 && now - this.clusterStart >= msToS(this.clusterGapMs);
      if (quiet || tooLong) this._emitCluster(now);
      else if (stale) { this.clusterStart = -1; this.events = 0; this.lastEventEnd = -1; }
    }

    if (now - this.lastLevelEmit >= this.sr / 20) { this.lastLevelEmit = now; this.onLevel(rms, thr, true); }
  }

  _emitCluster(now) {
    const sr = this.sr, L = this.ring.length;
    const from = Math.max(this.clusterStart - Math.round(this.preRollSec * sr), now - L);
    const to = Math.min(now, (this.lastEventEnd >= 0 ? this.lastEventEnd : now) + Math.round(this.postRollSec * sr));
    const len = Math.max(0, to - from);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = this.ring[(this.ringPos - (now - from) + i + L * 2) % L];
    const events = this.events;
    this.clusterStart = -1; this.events = 0; this.lastEventEnd = -1; this.inEvent = false;
    if (events > 0 && len > sr * 0.1) this.onCluster(out, sr);
  }
}

/** 対応状況のざっくり判定（UIの注意書き用） */
export function platformNotes() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  return { ios, standalone, wakeLock: 'wakeLock' in navigator, mic: !!navigator.mediaDevices?.getUserMedia };
}
