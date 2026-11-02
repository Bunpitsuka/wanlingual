// 検証データの選び方と、しきい値表の集計の単体テスト（ネット不要）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickEsc50, NON_DOG, PER_CLASS } from '../lab/fetch-data.mjs';
import { thresholdReport } from '../lab/report.mjs';

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
