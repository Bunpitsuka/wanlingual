// app.js — 画面の配線。解析は features.js、判定は classify.js、保存は store.js、マイクは mic.js。
import { analyzeSamples, mixdown } from './features.js';
import { CATS, CAT, predict, top, growth } from './classify.js';
import { loadSamples, saveSamples, loadDogName, saveDogName, loadOwnerName, saveOwnerName, exportJSON, importJSON } from './store.js';
import { Listener, platformNotes } from './mic.js';
import { share } from './share.js';
import { loadConfig as loadRecsConfig, links as recLinks, DISCLOSURE } from './recs.js';

const $ = id => document.getElementById(id);
let samples = loadSamples();
let current = null;        // {f, pred, source}
let last = null;           // 直近の判定（シェア用）{f, pred, conf, quote}
let recsCfg = null;        // affiliate.json（無ければ null）
let listener = null;
let lastMicAt = 0;

// ---------- 育成メーター ----------
function renderGrowth() {
  const g = growth(samples);
  $('lvLabel').textContent = 'LV.' + g.n;
  $('stage').textContent = g.stage;
  $('track').style.width = Math.round(g.progress * 100) + '%';
  $('next').textContent = g.nextStage ? `次の「${g.nextStage}」まであと ${g.toNext} 回` : '最大まで育ちました';
  $('acc').textContent = g.accuracy == null ? '—' : Math.round(g.accuracy * 100) + '%';
  $('accN').textContent = g.recentCount ? `直近${g.recentCount}回` : '直近20回';
}

// ---------- 描画 ----------
function draw(a) {
  const cv = $('wave'), ctx = cv.getContext('2d'); const W = cv.width, H = cv.height;
  const css = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, W, H);
  if (!a) { ctx.fillStyle = css.getPropertyValue('--line'); ctx.fillRect(0, H / 2 - 1, W, 2); return; }
  const n = a.rms.length; ctx.fillStyle = css.getPropertyValue('--line');
  for (let i = 0; i < W; i++) { const f = Math.floor(i / W * n); const h = Math.max(1, a.rms[f] / (a.peak || 1) * H * 0.9); ctx.fillRect(i, H / 2 - h / 2, 1, h); }
  ctx.fillStyle = css.getPropertyValue('--accent'); ctx.globalAlpha = 0.35;
  for (const e of a.events) { const x0 = e.start / a.total * W, x1 = (e.start + e.dur) / a.total * W; ctx.fillRect(x0, 0, Math.max(2, x1 - x0), H); }
  ctx.globalAlpha = 1;
}
function renderBars(s) {
  const el = $('bars'); el.innerHTML = '';
  [...CATS].sort((a, b) => (s ? s[b.k] : 0) - (s ? s[a.k] : 0)).forEach(c => {
    const v = s ? Math.round(s[c.k] * 100) : 0;
    const d = document.createElement('div'); d.className = 'bar';
    d.innerHTML = `<span>${c.label}</span><i><b style="width:${v}%"></b></i><span>${s ? v + '%' : '—'}</span>`;
    el.appendChild(d);
  });
}
const fmt = (v, u, d = 0) => v > 0 ? v.toFixed(d) + u : '—';
function renderFeat(f) {
  $('feat').innerHTML = f ? `<span>吠え ${f.n}回</span><span>長さ ${fmt(f.dur * 1000, 'ms')}</span><span>間隔 ${f.n >= 2 ? fmt(f.gap * 1000, 'ms') : '—'}</span><span>ピッチ ${fmt(f.f0, 'Hz')}</span><span>明るさ ${fmt(f.cent, 'Hz')}</span>` : '';
}
function renderChoices(predK) {
  const el = $('choices'); el.innerHTML = '';
  for (const c of CATS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.k = c.k; b.className = c.k === predK ? 'pred' : '';
    b.innerHTML = `${c.label}<small>${c.hint}</small>`; b.addEventListener('click', () => label(c.k)); el.appendChild(b);
  }
  const sk = document.createElement('button'); sk.type = 'button'; sk.className = 'skip'; sk.textContent = 'わからない（記録しない）';
  sk.addEventListener('click', () => { $('answer').classList.remove('on'); current = null; });
  el.appendChild(sk);
}
function renderHist() {
  const el = $('hist'); el.innerHTML = '';
  const list = samples.slice(-10).reverse();
  if (!list.length) { el.innerHTML = '<li><span>まだ記録がありません</span></li>'; return; }
  for (const s of list) {
    const li = document.createElement('li'); const L = k => (CAT[k] || {}).label || '—'; const hit = s.pred === s.label;
    li.innerHTML = `<span>正解 <b>${L(s.label)}</b> <span class="${hit ? 'hit' : 'miss'}">${s.pred ? (hit ? '／判定も同じ' : '／判定は' + L(s.pred)) : ''}</span>${s.src === 'mic' ? ' <small>🎤</small>' : ''}</span><time>${new Date(s.t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>`;
    el.appendChild(li);
  }
}
let toastT;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }

// ---------- 判定の表示（ファイル／マイク共通） ----------
function showResult(a, source) {
  draw(a); renderFeat(a.feats);
  if (a.feats.n === 0) {
    renderBars(null); $('predBig').textContent = '？'; $('predConf').textContent = '鳴き声が見つかりません'; $('quote').textContent = '';
    return false;
  }
  const s = predict(a.feats, samples); renderBars(s); const c = top(s);
  const dog = $('dogName').value.trim() || 'モカ', owner = $('ownerName').value.trim() || '飼い主';
  $('predBig').textContent = c.label;
  $('predConf').textContent = `たぶん ${Math.round(s[c.k] * 100)}%（推測です）`;
  $('quote').textContent = c.line(dog, owner);
  current = { f: a.feats, pred: c.k, source };
  last = { f: a.feats, pred: c.k, conf: s[c.k], quote: c.line(dog, owner) };
  $('sharebox').hidden = true; $('recs').hidden = true;
  renderChoices(c.k); $('answer').classList.add('on');
  $('result').classList.remove('idle');
  if (source === 'mic') { try { navigator.vibrate?.(80); } catch {} }
  $('answer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return true;
}

async function runFile(file) {
  const st = $('status'); st.textContent = '解析中…'; $('answer').classList.remove('on'); current = null;
  try {
    const ab = await file.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC();
    const buf = await ac.decodeAudioData(ab); ac.close?.();
    const a = analyzeSamples(mixdown(buf), buf.sampleRate);
    st.textContent = showResult(a, 'file') ? '' : 'もう少し近くで、大きめに録ってみてください。';
  } catch (err) { console.error(err); st.textContent = 'このファイルを読み込めませんでした。m4a / mp3 / wav の録音を試してください。'; }
}

function label(k) {
  if (!current) return;
  samples.push({ t: Date.now(), label: k, pred: current.pred, f: current.f, src: current.source });
  saveSamples(samples); renderGrowth(); renderHist();
  $('answer').classList.remove('on');
  toast(current.pred === k ? '的中！この特徴を覚えました' : `なるほど。この声は「${CAT[k].label}」と覚えました`);
  current = null;
  renderRecs(k);
}

// ---------- 気持ち別おすすめ（affiliate.json に ID があるときだけ） ----------
function renderRecs(k) {
  const items = recLinks(k, recsCfg); const el = $('recs');
  if (!items.length) { el.hidden = true; return; }
  const dog = $('dogName').value.trim() || 'モカ';
  $('recsTitle').textContent = `${dog}が「${CAT[k].label}」のときに`;
  const ul = $('recList'); ul.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    const shops = [it.amazon && `<a href="${it.amazon}" target="_blank" rel="noopener sponsored">Amazonで探す</a>`, it.rakuten && `<a href="${it.rakuten}" target="_blank" rel="noopener sponsored">楽天で探す</a>`].filter(Boolean).join('');
    li.innerHTML = `<b>${it.label}</b><p class="why">${it.why}</p><div class="shops">${shops}</div>`;
    ul.appendChild(li);
  }
  $('recsNote').textContent = DISCLOSURE;
  el.hidden = false;
}

// ---------- マイク監視 ----------
function setMicUI(on) {
  $('micBtn').textContent = on ? '監視をやめる' : '🎤 マイクで監視を始める';
  $('micBtn').classList.toggle('primary', !on);
  $('micState').textContent = on ? '監視中… 吠えたら自動で判定します' : '';
  $('meter').classList.toggle('on', on);
  document.body.classList.toggle('listening', on);
}
async function toggleMic() {
  if (listener?.running) { await listener.stop(); listener = null; setMicUI(false); return; }
  const btn = $('micBtn'); btn.disabled = true;
  try {
    listener = new Listener({
      onCluster: (x, sr) => {
        const a = analyzeSamples(x, sr, { thrAbs: 0.01 });
        if (a.feats.n === 0) return;
        if (Date.now() - lastMicAt < 1500) return; // 連打防止
        lastMicAt = Date.now();
        $('status').textContent = '';
        showResult(a, 'mic');
      },
      onLevel: (rms, thr) => {
        const pct = Math.min(100, Math.round(rms / (thr * 2.5) * 100));
        $('meterBar').style.width = pct + '%';
        $('meterBar').classList.toggle('hot', rms > thr);
      },
      onStatus: s => { if (s === 'stopped' && listener) { listener = null; setMicUI(false); } },
    });
    await listener.start();
    setMicUI(true);
    toast('聞いています。画面はこのままにしてください');
  } catch (err) {
    console.error(err); listener = null; setMicUI(false);
    $('status').textContent = err?.name === 'NotAllowedError' ? 'マイクの使用が許可されませんでした。ブラウザの設定で許可してください。' : (err?.message || 'マイクを開始できませんでした');
  } finally { btn.disabled = false; }
}
// 画面が隠れたら監視を止める（iOS はバックグラウンド録音ができない）
document.addEventListener('visibilitychange', () => { if (document.hidden && listener?.running) { listener.stop(); listener = null; setMicUI(false); toast('画面が隠れたので監視を止めました'); } });

// ---------- 注意書き ----------
function renderNotes() {
  const p = platformNotes();
  const el = $('platformNote');
  if (!p.mic) el.textContent = 'このブラウザはマイクに対応していません。録音ファイルの読み込みは使えます。';
  else if (p.ios) el.textContent = 'iPhoneは画面を点けてアプリを前面にしている間だけ監視できます（バックグラウンド録音はできません）。' + (p.standalone ? '' : ' 共有メニューから「ホーム画面に追加」すると全画面で使えます。');
  else el.textContent = '監視中は画面を消さないでください。' + (p.standalone ? '' : ' ブラウザのメニューから「ホーム画面に追加」できます。');
}

// ---------- 配線 ----------
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', e => { const f = e.target.files[0]; if (f) runFile(f); e.target.value = ''; });
$('micBtn').addEventListener('click', toggleMic);
$('dogName').value = loadDogName(); $('ownerName').value = loadOwnerName();
$('dogName').addEventListener('change', () => saveDogName($('dogName').value.trim() || 'モカ'));
$('ownerName').addEventListener('change', () => saveOwnerName($('ownerName').value.trim() || '飼い主'));
$('speak').addEventListener('click', () => {
  const t = $('quote').textContent; if (!t || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'ja-JP'; u.pitch = 1.4; u.rate = 1.05; speechSynthesis.speak(u); } catch {}
});
$('share').addEventListener('click', async () => {
  if (!last) return;
  const g = growth(samples); const c = CAT[last.pred];
  const r = { dog: $('dogName').value.trim() || 'モカ', label: c.label, conf: last.conf, quote: last.quote, lv: g.n, stage: g.stage, n: last.f.n, dur: last.f.dur, f0: last.f.f0 };
  const how = await share(r, {
    onFallback: (dataUrl, text, copied) => {
      $('shareImg').src = dataUrl; $('sharebox').hidden = false;
      $('shareNote').textContent = copied ? '投稿文をコピーしました。画像を保存して、Threads や X に貼ってください。' : '画像を保存して、Threads や X に貼ってください。';
    },
  });
  if (how === 'copied') toast('投稿文をコピーしました');
});
$('export').addEventListener('click', async () => {
  const txt = exportJSON($('dogName').value.trim(), samples);
  try { await navigator.clipboard.writeText(txt); toast(`学習データをコピーしました（${samples.length}件）`); }
  catch { const ta = $('ioText'); ta.value = txt; ta.hidden = false; ta.select(); toast('コピーできない環境です。選択してコピーしてください'); }
});
$('import').addEventListener('click', () => {
  const ta = $('ioText');
  // 1回目: 貼り付け欄を開く。2回目（貼り付け済み）: 読み込む。
  if (ta.hidden || !ta.value.trim()) { ta.hidden = false; ta.value = ''; ta.placeholder = 'ここに学習データ（JSON）を貼り付けて、もう一度「読み込む」を押す'; ta.focus(); return; }
  try { const arr = importJSON(ta.value); samples = arr; saveSamples(samples); renderGrowth(); renderHist(); ta.hidden = true; toast(`${arr.length}件を読み込みました`); }
  catch (e) { toast('読み込めませんでした: ' + e.message); }
});
let resetArmed = false;
$('reset').addEventListener('click', () => {
  if (!resetArmed) { resetArmed = true; $('reset').textContent = '本当にリセット？（もう一度押す）'; setTimeout(() => { resetArmed = false; $('reset').textContent = 'リセット'; }, 4000); return; }
  samples = []; saveSamples(samples); renderGrowth(); renderHist(); resetArmed = false; $('reset').textContent = 'リセット'; toast('リセットしました');
});

draw(null); renderBars(null); renderGrowth(); renderHist(); renderNotes(); setMicUI(false);
loadRecsConfig().then(c => { recsCfg = c; });

// PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('sw', e)));
}
window.__wl = { get samples() { return samples; }, analyzeSamples, predict, setRecsConfig(c) { recsCfg = c; } }; // テスト用フック
