// 検証データの選び方と、しきい値表の集計の単体テスト（ネット不要）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickEsc50, NON_DOG, PER_CLASS } from '../lab/fetch-data.mjs';
import { thresholdReport, clusterReport, minSecReport, clusterCell } from '../lab/report.mjs';

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
  const c = (dog, start, end) => ({ start, end, n: 1, dog, dogSum: dog, dogTop: 'Bark' });
  const rows = [
    { file: 'd1.wav', category: 'dog', source: 'ESC-50', clusters: [c(0.9, 1, 2), c(0.1, 3, 4)], clustersMin: { 2: [c(0.95, 0, 2), c(0.5, 2, 4)], 3: [c(0.97, 0, 3), c(0.6, 1, 4)] } },
    { file: 'd2.wav', category: 'dog', source: 'ESC-50', clusters: [c(0.02, 2, 3)], clustersMin: { 2: [c(0.05, 1, 3)], 3: [c(0.35, 0, 3)] } },  // 3 秒で救われる
    { file: 'd3.wav', category: 'dog', source: 'ESC-50', clusters: [c(0.4, 2, 3)], clustersMin: { 2: [c(0.2, 1, 3)], 3: [c(0.25, 0, 3)] } },  // 広げると落ちる
    { file: 'c1.wav', category: 'cat', source: 'ESC-50', clusters: [c(0.05, 1, 2)], clustersMin: { 2: [c(0.1, 0, 2)], 3: [c(0.32, 0, 3)] } },  // 3 秒で誤判定
    { file: 'bark4.wav', category: '合成', source: 'fixtures', dog: 0.01 },
  ];
  const md = minSecReport(rows);
  assert.match(md, /\| そのまま \| 1\.00／1\.00 秒 \| 40% \| 0\.3 \| 2\/4（50%） \| 0\/1（0%） \| 1（d2） \|/);
  assert.match(md, /\| 最低 2 秒 \| 2\.00／2\.00 秒 \| 50% \| 0\.3 \| 2\/4（50%） \| 0\/1（0%） \| 2（d2、d3） \|/);
  assert.match(md, /\| 最低 3 秒 \| 3\.00／3\.00 秒 \| 60% \| 0\.3 \| 3\/4（75%） \| 1\/1（100%） \| 1（d3） \|/);
  assert.match(md, /最低 2 秒にすると（しきい値 0\.3）: 救われた犬の塊 1（d1#2 10→50%）、逆に落ちた犬の塊 1（d3#1 40→20%）、新たに誤判定した犬以外の塊 0/);
  assert.match(md, /最低 3 秒にすると（しきい値 0\.3）: 救われた犬の塊 2（d1#2 10→60%、d2#1 2→35%）、逆に落ちた犬の塊 1（d3#1 40→25%）、新たに誤判定した犬以外の塊 1（c1#1 5→32%）/);
  assert.equal(minSecReport(rows.map(r => ({ ...r, clustersMin: undefined }))), '');
  assert.equal(minSecReport(rows.filter(r => r.category === 'dog')), '');
});
