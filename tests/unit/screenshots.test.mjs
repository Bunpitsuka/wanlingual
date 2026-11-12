// tools/screenshots.mjs（docs/screenshots/ を E2E の絵から更新する）の単体テスト。実際の docs には触らない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SHOTS, syncShots } from '../../tools/screenshots.mjs';

test('docs に置く絵は E2E の名前（project-name.png）で、重複が無い', () => {
  assert.ok(SHOTS.length >= 6);
  for (const [f] of SHOTS) assert.match(f, /^(android-chrome|iphone-safari-emulated)-[a-z-]+\.png$/);
  assert.equal(new Set(SHOTS.map(([f]) => f)).size, SHOTS.length);
});

test('syncShots: 新しい絵だけコピーし、同じ絵は触らず、元が無ければ「無い」と返す。--check ならコピーしない', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-shots-'));
  const src = path.join(tmp, 'src'), dst = path.join(tmp, 'dst');
  fs.mkdirSync(src); fs.mkdirSync(dst);
  const [a, b] = SHOTS.map(([f]) => f);
  fs.writeFileSync(path.join(src, a), 'new');
  fs.writeFileSync(path.join(src, b), 'same'); fs.writeFileSync(path.join(dst, b), 'same');
  const dry = syncShots({ src, dst, dryRun: true });
  assert.deepEqual(dry.find(r => r.file === a), { file: a, src: path.join(src, a), dst: path.join(dst, a), exists: true, changed: true });
  assert.equal(fs.existsSync(path.join(dst, a)), false, '--check ではコピーしない');
  const res = syncShots({ src, dst });
  assert.equal(fs.readFileSync(path.join(dst, a), 'utf8'), 'new');
  assert.equal(res.find(r => r.file === b).changed, false);
  assert.ok(res.filter(r => !r.exists).length === SHOTS.length - 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});
