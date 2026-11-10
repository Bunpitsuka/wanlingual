// app.js — 画面の配線。解析は features.js、判定は classify.js、保存は store.js、マイクは mic.js。
import { analyzeSamples, mixdown } from './features.js';
import { CATS, CAT, predict, top, growth, tally, explain } from './classify.js';
import { loadSamples, saveSamples, loadDogName, saveDogName, loadOwnerName, saveOwnerName, exportJSON, importJSON } from './store.js';
import { Listener, platformNotes } from './mic.js';
import { share } from './share.js';
import { loadConfig as loadRecsConfig, links as recLinks, DISCLOSURE } from './recs.js';
import { mascotSvg } from './mascot.js';
import { DogCheck, isEnabled as dogcheckEnabled, setEnabled as setDogcheckEnabled, applyUrlParam as dogcheckUrlParam } from './dogcheck.js';
import { utteranceOptions } from './voice.js';

const $ = id => document.getElementById(id);
let samples = loadSamples();
let current = null;        // {f, pred, source}
let last = null;           // 直近の判定（シェア用）{f, pred, conf, quote}
let recsCfg = null;        // affiliate.json（無ければ null）
let listener = null;
let lastMicAt = 0;
let lastStageIndex = -1;
let micStartedAt = 0, micBarks = 0, micTimer = null;
let installEvt = null;     // Android Chrome の beforeinstallprompt
let dogcheck = null;       // 犬の声チェック（YAMNet。既定オフ。plan #14 ②）
let resultSeq = 0;         // 判定を表示するたびに進む（遅れて届いた犬らしさを古い判定に付けないため）

// ---------- 育成メーター ----------
function renderGrowth() {
  const g = growth(samples);
  $('lvLabel').textContent = 'LV.' + g.n;
  $('stage').textContent = g.stage;
  const m = $('mascot');
  if (g.stageIndex !== lastStageIndex) {
    m.innerHTML = mascotSvg(g.stageIndex);
    if (lastStageIndex >= 0) toast(`「${g.stage}」に育ちました！`);
    lastStageIndex = g.stageIndex;
  }
  m.classList.remove('pop'); void m.offsetWidth; m.classList.add('pop');
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
/** 判定の「なぜ」（plan #22）。効いた特徴を 1〜3 個。決め手が無ければそう言う（6 択の推測なので迷うのが普通） */
function renderWhy(reasons) {
  const el = $('why');
  if (!reasons) { el.textContent = ''; return; }
  el.innerHTML = '<b>こう見ました:</b>' + (reasons.length ? reasons.map(r => `<span>${r}</span>`).join('・') : 'はっきりした決め手はなく、迷っています');
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
function renderTally() {
  const el = $('tally'); el.innerHTML = '';
  const t = tally(samples);
  el.hidden = !t.length;
  for (const c of t) {
    const span = document.createElement('span');
    span.className = 'chip';
    span.title = `${c.label}: 教えた ${c.n} 回のうち、判定も同じだったのは ${c.hits} 回`;
    span.innerHTML = `<b>${c.label}</b> ${c.n}<small>${c.n ? `（当たり ${c.hits}）` : ''}</small>`;
    el.appendChild(span);
  }
}
function renderHist() {
  renderTally();
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

/** 1位と2位の差で「自信」を3段階に。6択の推測なので % だけだと低く見えるため */
function confidenceLevel(s, k) {
  const sorted = Object.values(s).sort((a, b) => b - a);
  const margin = (sorted[0] || 0) - (sorted[1] || 0);
  const n = samples.length;
  if (margin >= 0.15 || (n >= 15 && margin >= 0.08)) return { label: '高め', cls: 'hi' };
  if (margin >= 0.05) return { label: 'まあまあ', cls: 'mid' };
  return { label: '低め', cls: 'lo' };
}

// ---------- 判定の表示（ファイル／マイク共通） ----------
function showResult(a, source) {
  resultSeq++;
  clearNotDog();
  draw(a); renderFeat(a.feats);
  if (a.feats.n === 0) {
    renderBars(null); $('predBig').textContent = '？'; $('predConf').textContent = '鳴き声が見つかりません'; $('quote').textContent = ''; renderWhy(null);
    return false;
  }
  const s = predict(a.feats, samples); renderBars(s); const c = top(s);
  const dog = $('dogName').value.trim() || 'モカ', owner = $('ownerName').value.trim() || '飼い主';
  $('predBig').textContent = c.label;
  const lvl = confidenceLevel(s, c.k);
  $('predConf').innerHTML = `たぶん ${Math.round(s[c.k] * 100)}%（推測です）<span class="lvl ${lvl.cls}">自信 ${lvl.label}</span>`;
  $('quote').textContent = c.line(dog, owner);
  renderWhy(explain(a.feats, c.k, samples));
  current = { f: a.feats, pred: c.k, source };
  last = { f: a.feats, pred: c.k, conf: s[c.k], quote: c.line(dog, owner) };
  $('sharebox').hidden = true; $('recs').hidden = true;
  renderChoices(c.k); $('answer').classList.add('on');
  $('result').classList.remove('idle');
  if (source === 'mic') { micBarks++; renderMicState(); try { navigator.vibrate?.(80); } catch {} }
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
  // 「犬の声ではないかも」と薄くした判定でも、飼い主が教えたらその時点で犬の声として扱う（吠え回数に戻し、通常どおり保存）
  if (current.notDog) { clearNotDog(); if (current.source === 'mic') { micBarks++; renderMicState(); } }
  samples.push({ t: Date.now(), label: k, pred: current.pred, f: current.f, src: current.source });
  saveSamples(samples);
  $('answer').classList.remove('on');
  toast(current.pred === k ? '的中！この特徴を覚えました' : `なるほど。この声は「${CAT[k].label}」と覚えました`);
  renderGrowth(); renderHist(); // 段階が上がったときはこちらのトーストが勝つ
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

// ---------- 犬の声チェック（YAMNet。既定オフ。plan #14 の実装 ②・③） ----------
// 設定 wl.dogcheck がオンのときだけ、監視を始めたあとに裏でモデルを読む。読めるまで・読めないとき・オフのときは何も変わらない。
// 判定は待たせずに先に出し、犬らしさは届いたら数字で添える（②）。
// 犬らしさがしきい値未満なら、出ている判定を薄くして「犬の声ではないかも」と添え、吠え回数から外す（③）。
// 捨てはしない: 飼い主が気持ちを教えたら犬の声として通常どおり保存する（くんくん・息は YAMNet が落としやすいため）。
function clearNotDog() { $('result').classList.remove('notdog'); $('dogNote').hidden = true; }
function startDogCheck() {
  if (!dogcheckEnabled()) return;
  if (!dogcheck) dogcheck = new DogCheck({
    onState: s => {
      if (s === 'ready') toast('犬の声チェックの準備ができました');
      else if (s === 'failed') toast('犬の声チェックは読み込めませんでした（判定はこれまでどおり動きます）');
      renderDogcheckState();
    },
  });
  dogcheck.load();
  renderDogcheckState();
}
// ④ 設定のトグル。URL の ?dogcheck=on/off と同じ設定（localStorage wl.dogcheck）を変える。既定はオフ
function renderDogcheckState() {
  const on = dogcheckEnabled();
  $('dogcheckToggle').checked = on;
  const el = $('dogcheckState');
  if (!on) { el.textContent = ''; return; }
  const s = dogcheck?.state;
  el.textContent = s === 'ready' ? '準備できています。犬らしさは判定のあとに「犬らしさ ◯%」と出ます。'
    : s === 'loading' ? '読み込んでいます…（初回だけ時間がかかります）'
    : s === 'failed' ? '読み込めませんでした（電波のあるところで監視を始め直すと、もう一度読みます）。判定はこれまでどおり動きます。'
    : 'オン。マイク監視を始めると裏で読み込みます。';
}
function toggleDogCheck(on) {
  if (!setDogcheckEnabled(on)) { toast('この端末では設定を保存できませんでした'); renderDogcheckState(); return; }
  if (on) {
    if (listener?.running) { startDogCheck(); toast('犬の声チェックをオンにしました。読み込んでいます…'); }
    else toast('犬の声チェックをオンにしました。監視を始めると読み込みます');
  } else {
    dogcheck = null; // 以後の判定には掛けない（出ている判定はそのまま）。読み込み済みの tf はページを閉じるまで残る
    toast('犬の声チェックをオフにしました');
  }
  renderDogcheckState();
}
async function runDogCheck(wide, sr) {
  if (!dogcheck || !wide) return;
  const seq = resultSeq, d = dogcheck;
  const r = await d.check(wide, sr);
  if (!r || seq !== resultSeq || d !== dogcheck) return; // 判定できなかった、次の判定に進んでいた、または途中で設定をオフにした
  if (current) current.dog = r;
  const span = document.createElement('span');
  span.id = 'dogChip';
  span.textContent = `犬らしさ ${Math.round(r.dog * 100)}%（${(r.ms / 1000).toFixed(1)}秒）`;
  $('feat').appendChild(span);
  // ③ 犬以外っぽい音。まだ答えを待っている判定（current）にだけ掛ける。もう教えた・「わからない」を押したあとなら何もしない
  if (!r.isDog && current && !current.notDog) {
    current.notDog = true;
    $('result').classList.add('notdog'); $('dogNote').hidden = false;
    if (current.source === 'mic' && micBarks > 0) { micBarks--; renderMicState(); }
  }
}

// ---------- マイク監視 ----------
function renderMicState() {
  if (!listener?.running) { $('micState').textContent = ''; return; }
  const sec = Math.floor((Date.now() - micStartedAt) / 1000);
  const t = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('micState').textContent = micBarks ? `監視中 ${t}・吠え ${micBarks}回` : `監視中 ${t}… 吠えたら自動で判定します`;
}
function setMicUI(on) {
  $('micBtn').textContent = on ? '監視をやめる' : '🎤 マイクで監視を始める';
  $('micBtn').classList.toggle('primary', !on);
  $('meter').classList.toggle('on', on);
  document.body.classList.toggle('listening', on);
  clearInterval(micTimer); micTimer = null;
  if (on) { micStartedAt = Date.now(); micBarks = 0; micTimer = setInterval(renderMicState, 1000); }
  renderMicState();
}
async function toggleMic() {
  if (listener?.running) { await listener.stop(); listener = null; setMicUI(false); return; }
  const btn = $('micBtn'); btn.disabled = true;
  try {
    listener = new Listener({
      onCluster: (x, sr, ctx) => {
        const a = analyzeSamples(x, sr, { thrAbs: 0.01 });
        if (a.feats.n === 0) return;
        if (Date.now() - lastMicAt < 1500) return; // 連打防止
        lastMicAt = Date.now();
        $('status').textContent = '';
        if (showResult(a, 'mic')) runDogCheck(ctx?.wide, sr);
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
    startDogCheck();
  } catch (err) {
    console.error(err); listener = null; setMicUI(false);
    $('status').textContent = err?.name === 'NotAllowedError' ? 'マイクの使用が許可されませんでした。ブラウザの設定で許可してください。' : (err?.message || 'マイクを開始できませんでした');
  } finally { btn.disabled = false; }
}
// 画面が隠れたら監視を止める（iOS はバックグラウンド録音ができない）
document.addEventListener('visibilitychange', () => { if (document.hidden && listener?.running) { listener.stop(); listener = null; setMicUI(false); toast('画面が隠れたので監視を止めました'); } });

// ---------- 注意書き・ホーム画面に追加 ----------
function renderNotes() {
  const p = platformNotes();
  const el = $('platformNote');
  if (!p.mic) el.textContent = 'このブラウザはマイクに対応していません。録音ファイルの読み込みは使えます。';
  else if (p.ios) el.textContent = 'iPhoneは画面を点けてアプリを前面にしている間だけ監視できます（バックグラウンド録音はできません）。' + (p.standalone ? '' : ' Safari の共有ボタン → 「ホーム画面に追加」で全画面・オフラインで使えます。');
  else el.textContent = '監視中は画面を消さないでください。' + (p.standalone || installEvt ? '' : ' ブラウザのメニューから「ホーム画面に追加」できます。');
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installEvt = e; $('installBtn').hidden = false; renderNotes();
});
window.addEventListener('appinstalled', () => { installEvt = null; $('installBtn').hidden = true; toast('ホーム画面に追加しました'); renderNotes(); });
$('installBtn').addEventListener('click', async () => {
  if (!installEvt) return;
  try { installEvt.prompt(); await installEvt.userChoice; } catch {}
  installEvt = null; $('installBtn').hidden = true; renderNotes();
});

// ---------- 配線 ----------
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', e => { const f = e.target.files[0]; if (f) runFile(f); e.target.value = ''; });
$('micBtn').addEventListener('click', toggleMic);
$('dogName').value = loadDogName(); $('ownerName').value = loadOwnerName();
$('dogName').addEventListener('change', () => saveDogName($('dogName').value.trim() || 'モカ'));
$('ownerName').addEventListener('change', () => saveOwnerName($('ownerName').value.trim() || '飼い主'));
// 読み上げ（plan #22）: 端末にある日本語の声を選び、気持ちごとに高さ・速さを少し変える（voice.js）。声の一覧は端末によって遅れて届く
let voices = [];
function refreshVoices() { try { voices = speechSynthesis.getVoices() || []; } catch { voices = []; } }
if ('speechSynthesis' in window) { refreshVoices(); try { speechSynthesis.addEventListener('voiceschanged', refreshVoices); } catch {} }
$('speak').addEventListener('click', () => {
  const t = $('quote').textContent; if (!t || !('speechSynthesis' in window)) return;
  try {
    if (!voices.length) refreshVoices();
    const o = utteranceOptions(last?.pred, voices);
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = o.lang; u.pitch = o.pitch; u.rate = o.rate; if (o.voice) u.voice = o.voice;
    speechSynthesis.speak(u);
  } catch {}
});
$('share').addEventListener('click', async () => {
  if (!last) return;
  const g = growth(samples); const c = CAT[last.pred];
  const r = { dog: $('dogName').value.trim() || 'モカ', label: c.label, conf: last.conf, quote: last.quote, lv: g.n, stage: g.stage, stageIndex: g.stageIndex, n: last.f.n, dur: last.f.dur, f0: last.f.f0 };
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

dogcheckUrlParam(location.search); // ?dogcheck=on / off（URL を送るだけで実機で試せる入口。設定のトグルと同じ項目を変える。既定はオフ）
$('dogcheckToggle').addEventListener('change', e => toggleDogCheck(e.target.checked));
draw(null); renderBars(null); renderGrowth(); renderHist(); renderNotes(); setMicUI(false); renderDogcheckState();
loadRecsConfig().then(c => { recsCfg = c; });

// PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('sw', e)));
}
window.__wl = { get samples() { return samples; }, analyzeSamples, predict, setRecsConfig(c) { recsCfg = c; }, get dogcheck() { return dogcheck; }, get micBarks() { return micBarks; } }; // テスト用フック
