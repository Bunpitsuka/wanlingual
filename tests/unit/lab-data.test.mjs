// 検証データの選び方と、しきい値表の集計の単体テスト（ネット不要）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickEsc50, NON_DOG, PER_CLASS } from '../lab/fetch-data.mjs';
import { thresholdReport, clusterReport, minSecReport, clusterCell, eventDistReport, eventToneReport } from '../lab/report.mjs';

const csv = ['filename,fold,target,category,esc10,src_file,take',
  ...Array.from({ length: 45 }, (_, i) => `${5 - (i % 5)}-${1000 + i}-A-0.wav,1,0,dog,True,${1000 + i},A`),
  ...NON_DOG.flatMap(c => Array.from({ length: 7 }, (_, i) => `1-${2000 + i}-A-5.wav,1,5,${c},False,${2000 + i},A`)),
  '1-3000-A-10.wav,1,10,rain,False,3000,A',
].join('\n');

test('ESC-50: dog は全部、犬以外は各クラス先頭 5 本、他クラスは入れない', () => {
  const p = pickEsc50(csv);
  assert.equal(p.filter(r => r.category === 'dog').length, 45);
  for (const c of NON_DOG) assert.equal(p.filter(r => r.category === c).length, PER_CLASS);
  assert.equal(p.filter(r => r.category === 'rain').length, 0);
  const dogs = p.filter(r => r.category === 'dog').map(r => r.file);
  assert.deepEqual(dogs, [...dogs].sort(), 'ファイル名順で安定している');
});

test('しきい値表: 犬の拾い率と犬以外の誤判定率が出る。片方しか無ければ空', () => {
  const dog = (d, i) => ({ file: `d${i}`, category: 'dog', source: 'ESC-50', dog: d, dogMean: d / 2 });
  const cat = (d, i) => ({ file: `c${i}`, category: 'cat', source: 'ESC-50', dog: d, dogMean: d / 2 });
  const rows = [0.9, 0.8, 0.5, 0.2].map(dog).concat([0.05, 0.35].map(cat), [{ file: 'bark4.wav', category: '合成', source: 'fixtures', dog: 0.01, dogMean: 0 }]);
  const md = thresholdReport(rows);
  assert.match(md, /本物の犬 4 本 vs 犬以外 2 本/);
  assert.match(md, /\| 0\.3 \| 3\/4（75%） \| 1\/2（50%） \| cat 1 \|/);
  assert.match(md, /\| 0\.4 \| 3\/4（75%） \| 0\/2（0%） \| — \|/);
  assert.equal(thresholdReport(rows.filter(r => r.category === 'dog')), '');
});

test('塊ごとの表: 塊単位の拾い率・誤判定率と「全部落ちる犬の本」が出る。塊が無ければ空', () => {
  const c = (dog, dogSum, dogTop = 'Bark') => ({ start: 0, end: 0.5, n: 1, dog, dogSum, dogTop });
  const rows = [
    { file: 'd1', category: 'dog', source: 'ESC-50', clusters: [c(0.9, 0.95), c(0.5, 0.6)] },
    { file: 'd2', category: 'dog', source: 'ESC-50', clusters: [c(0.2, 0.35, 'Whimper (dog)')] }, // 最大なら 0.3 で落ちる、合計なら通る
    { file: 'd3', category: 'dog', source: 'ESC-50', clusters: [] },
    { file: 'c1', category: 'cat', source: 'ESC-50', clusters: [c(0.05, 0.1), c(0.35, 0.4)] },
    { file: 'bark4.wav', category: '合成', source: 'fixtures', clusters: [c(0.01, 0.02)] },
  ];
  const md = clusterReport(rows);
  assert.match(md, /犬 3 本 → 3 塊、犬以外 1 本 → 2 塊/);
  assert.match(md, /塊が 1 つも出なかった本: 犬 1\/3、犬以外 0\/1/);
  assert.match(md, /\| 0\.3 \| 2\/3（67%） \| 1\/2（50%） \| 3\/3（100%） \| 1\/2（50%） \| 1／0 \|/);
  assert.match(md, /Bark 2、Whimper \(dog\) 1/);
  assert.equal(clusterReport(rows.map(r => ({ ...r, clusters: undefined }))), '');
  assert.equal(clusterCell(rows[0].clusters), '2塊: 90/50%');
  assert.equal(clusterCell([]), '0塊');
  assert.equal(clusterCell(undefined), '—');
});

test('塊を最低 2〜3 秒に広げた比較表: 範囲ごと・しきい値ごとの拾い率と、救われた／落ちた塊が出る。無ければ空', () => {
  const c = (dog, start, end) => ({ start, end, n: 1, dog, dogSum: dog, dogTop: 'Bark', ms: Math.round((end - start) * 300) });
  const rows = [
    { file: 'd1.wav', category: 'dog', source: 'ESC-50', clusters: [c(0.9, 1, 2), c(0.1, 3, 4)], clustersMin: { 2: [c(0.95, 0, 2), c(0.5, 2, 4)], 3: [c(0.97, 0, 3), c(0.6, 1, 4)] } },
    { file: 'd2.wav', category: 'dog', source: 'ESC-50', clusters: [c(0.02, 2, 3)], clustersMin: { 2: [c(0.05, 1, 3)], 3: [c(0.35, 0, 3)] } },  // 3 秒で救われる
    { file: 'd3.wav', category: 'dog', source: 'ESC-50', clusters: [c(0.4, 2, 3)], clustersMin: { 2: [c(0.2, 1, 3)], 3: [c(0.25, 0, 3)] } },  // 広げると落ちる
    { file: 'c1.wav', category: 'cat', source: 'ESC-50', clusters: [c(0.05, 1, 2)], clustersMin: { 2: [c(0.1, 0, 2)], 3: [c(0.32, 0, 3)] } },  // 3 秒で誤判定
    { file: 'bark4.wav', category: '合成', source: 'fixtures', dog: 0.01 },
  ];
  const md = minSecReport(rows);
  assert.match(md, /\| そのまま \| 1\.00／1\.00 秒 \| 300 ms（10–90%: 300–300） \| 40% \| 0\.3 \| 2\/4（50%） \| 0\/1（0%） \| 1（d2） \|/);
  assert.match(md, /\| 最低 2 秒 \| 2\.00／2\.00 秒 \| 600 ms（10–90%: 600–600） \| 50% \| 0\.3 \| 2\/4（50%） \| 0\/1（0%） \| 2（d2、d3） \|/);
  assert.match(md, /\| 最低 3 秒 \| 3\.00／3\.00 秒 \| 900 ms（10–90%: 900–900） \| 60% \| 0\.3 \| 3\/4（75%） \| 1\/1（100%） \| 1（d3） \|/);
  assert.match(md, /最低 2 秒にすると（しきい値 0\.3）: 救われた犬の塊 1（d1#2 10→50%）、逆に落ちた犬の塊 1（d3#1 40→20%）、新たに誤判定した犬以外の塊 0/);
  assert.match(md, /最低 3 秒にすると（しきい値 0\.3）: 救われた犬の塊 2（d1#2 10→60%、d2#1 2→35%）、逆に落ちた犬の塊 1（d3#1 40→25%）、新たに誤判定した犬以外の塊 1（c1#1 5→32%）/);
  assert.equal(minSecReport(rows.map(r => ({ ...r, clustersMin: undefined }))), '');
  assert.equal(minSecReport(rows.filter(r => r.category === 'dog')), '');
});

test('dogcheckReport: 本体 dogcheck.js を本物のモデルに通した結果を 1 段落にする', async () => {
  const { dogcheckReport } = await import('../lab/report.mjs');
  assert.equal(dogcheckReport(null), '');
  const ok = { state: 'ready', error: null, loadMs: 4210, first: { isDog: true, dog: 0.861, dogTop: 'Bark', ms: 1203, sec: 2 }, second: { isDog: true, dog: 0.861, dogTop: 'Bark', ms: 870, sec: 2 } };
  const md = dogcheckReport(ok, { file: '1-100032-A-0.wav', labDog: 0.86 });
  assert.match(md, /読み込み 4\.2 秒で ready/);
  assert.match(md, /1-100032-A-0\.wav の最初の塊（前を足して 2\.00 秒）→ 犬らしさ 86%（実験室と同じ 86%）、犬/);
  assert.match(md, /1 回目 1203 ms、2 回目 870 ms/);
  assert.match(dogcheckReport(ok, { file: 'a.wav', labDog: 0.5 }), /ずれている/);
  assert.match(dogcheckReport({ ...ok, first: { ...ok.first, isDog: false, dog: 0.02 } }, { file: 'a.wav' }), /犬らしさ 2%、犬以外っぽい/);
  const ng = dogcheckReport({ state: 'failed', error: 'TensorFlow.js が読み込めません', loadMs: 30, first: null, second: null });
  assert.match(ng, /読み込めず（state: failed、TensorFlow\.js が読み込めません）/);
});

test('CC0 の声 1 回ごとの長さ・間隔の分布: 中央値・25–75%・境目を超える割合が出る。CC0 が無ければ空', () => {
  const ev = (start, dur) => ({ start, dur });
  const rows = [
    // くんくん 相当: 1 回が長め（0.8 秒）で間隔が広い
    { file: 'whimper.wav', category: 'dog(cc0)', source: 'CC0', seconds: 10, events: [ev(0, 0.8), ev(2, 0.9), ev(4, 0.5), ev(6, 1.2)] },
    // 吠え 相当: 短くて間隔が短い
    { file: 'bark.wav', category: 'dog(cc0)', source: 'CC0', seconds: 5, events: [ev(0, 0.15), ev(0.4, 0.15), ev(0.8, 0.2)] },
    { file: 'nothing.wav', category: 'dog(cc0)', source: 'CC0', seconds: 3, events: [] },
    { file: '1-100032-A-0.wav', category: 'dog', source: 'ESC-50', seconds: 5, events: [ev(0, 0.15)] }, // ESC-50 は表に出さない
  ];
  const md = eventDistReport(rows);
  assert.match(md, /\| whimper\.wav \| 10 \| 4 \| 900（800–1200） \| 75% \| 25% \| 1200 \| 1200（1100–1500） \| 0% \| 100% \|/);
  assert.match(md, /\| bark\.wav \| 5 \| 3 \| 150（150–200） \| 0% \| 100% \| 200 \| 250（250–250） \| 100% \| 0% \|/);
  assert.match(md, /\| nothing\.wav \| 3 \| 0 \| — \| — \| — \| — \| — \| — \| — \|/);
  assert.doesNotMatch(md, /1-100032/);
  assert.equal(eventDistReport(rows.filter(r => r.source !== 'CC0')), '');
});

test('CC0 の声 1 回ごとの f0・cent・level の分布: 低い／高い・こもった／明るい の割合と、最大の声からの dB 差が出る。f0 が無ければ空', () => {
  const ev = (f0, cent, level) => ({ start: 0, dur: 0.1, f0, cent, level });
  const rows = [
    // うなり 相当: 低くてこもった声。音量はそろっている（0.1 と 0.05 = 6 dB 差）
    { file: 'growl.wav', category: 'dog(cc0)', source: 'CC0', events: [ev(300, 1200, 0.1), ev(310, 1250, 0.1), ev(0, 1300, 0.05), ev(320, 1400, 0.1)] },
    // くんくん 相当: 高くて明るい声、小さい声が混ざる（0.2 → 0.02 = 20 dB 下）
    { file: 'whimper.wav', category: 'dog(cc0)', source: 'CC0', events: [ev(600, 1700, 0.2), ev(700, 1800, 0.02)] },
    { file: 'nothing.wav', category: 'dog(cc0)', source: 'CC0', events: [] },
    { file: '1-100032-A-0.wav', category: 'dog', source: 'ESC-50', events: [ev(500, 1500, 0.1)] }, // ESC-50 は表に出さない
  ];
  const md = eventToneReport(rows);
  // f0 が取れたのは 4 回中 3 回。f0 300/310/320 → 中央値 310、低い ≤320 は 100%、高い 0%、幅 20。cent 1200/1250/1300/1400 → 1300（1250–1400）、こもった 75%。音量は 0.1 が 3 回（-20 dBFS）と 0.05 が 1 回（6 dB 下）
  assert.match(md, /\| growl\.wav \| 4 \| 75% \| 310（300–320） \| 100% \| 0% \| 20 \| 1300（1250–1400） \| 75% \| 0% \| -20\.0（-20\.0–-20\.0） \| 0\.0（0\.0–6\.0） \|/);
  assert.match(md, /\| whimper\.wav \| 2 \| 100% \| 700（600–700） \| 0% \| 100% \| 100 \| 1800（1700–1800） \| 0% \| 100% \| -14\.0（-34\.0–-14\.0） \| 20\.0（0\.0–20\.0） \|/);
  assert.match(md, /\| nothing\.wav \| 0 \| — \| — \| — \| — \| — \| — \| — \| — \| — \| — \|/);
  assert.doesNotMatch(md, /1-100032/);
  assert.equal(eventToneReport(rows.filter(r => r.source !== 'CC0')), '');
  assert.equal(eventToneReport(rows.map(r => ({ ...r, events: r.events.map(({ start, dur }) => ({ start, dur })) }))), '', '長さ・間隔だけの古い events なら出さない');
});

test('MFCC の表: ESC-50 吠えの平均±σ を基準に、CC0 と犬以外で |z| ≥ 2 の係数を挙げる。吠えが 2 本未満なら空', async () => {
  const { mfccReport } = await import('../lab/report.mjs');
  // 吠え 4 本: c1 が 10/12/14/16（平均 13、σ ≒ 2.24）、c2〜c12 は全部 1/−1 の交互（平均 0、σ 1）
  const bark = (i, c1) => ({ file: `d${i}`, category: 'dog', source: 'ESC-50', mfcc: { frames: 100, mean: [50, c1, ...Array.from({ length: 11 }, () => (i % 2 ? 1 : -1))] } });
  const rows = [bark(1, 10), bark(2, 12), bark(3, 14), bark(4, 16),
    // くんくん 相当: c1 は吠えと同じ、c3 だけ +5（z = +5）
    { file: 'whimper.wav', category: 'dog(cc0)', source: 'CC0', mfcc: { frames: 30, mean: [40, 13, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0] } },
    // うなり 相当: 全部吠えの平均どおり → 離れた係数なし
    { file: 'growl.wav', category: 'dog(cc0)', source: 'CC0', mfcc: { frames: 20, mean: [40, 13, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } },
    { file: 'nothing.wav', category: 'dog(cc0)', source: 'CC0', mfcc: { frames: 0, mean: [] } }, // 声が無ければ表に出さない
    // 猫 2 本: c1 の平均が 4（z = (4−13)/2.24 ≒ −4.0）
    { file: 'c1', category: 'cat', source: 'ESC-50', mfcc: { frames: 10, mean: [40, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } },
    { file: 'c2', category: 'cat', source: 'ESC-50', mfcc: { frames: 10, mean: [40, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } },
  ];
  const md = mfccReport(rows);
  assert.match(md, /\| ESC-50 吠え（基準） \| 4 \| 400 \| 13\.0±2\.2 \| 0\.0±1\.0 \|/);
  assert.match(md, /\| whimper\.wav \| 1 \| 30 \| 13\.0 \| 0\.0 \| 5\.0 \|.*\| c3\(\+5\.0σ\) \|/);
  assert.match(md, /\| growl\.wav \| 1 \| 20 \|.*\| — \|\n/);
  assert.doesNotMatch(md, /nothing\.wav/);
  assert.match(md, /\| 犬以外: cat \| 2 \| 20 \| 4\.0 \|.*\| c1\(−4\.0σ\) \|/);
  assert.match(md, /CC0 2 本のうち.*\*\*1\/2\*\*。犬以外 1 クラスのうち.*1\/1/);
  assert.equal(mfccReport(rows.filter(r => r.category !== 'dog')), '');
  assert.equal(mfccReport([rows[0], ...rows.slice(4)]), '', '吠えが 1 本では σ が出ないので空');
  assert.match(mfccReport(rows.filter(r => r.source !== 'CC0')), /CC0 の 5 本.*はこの実行では取れていない/);
});
