// mp3 等を WAV に変換する（ffmpeg の代わり。2026-11-20）。
//
// lab-yamnet の run が 2 晩つづけて apt-get install ffmpeg で止まった（11-19: 30 分、11-20: 6 分の timeout）ので、
// 変換は Playwright の Chromium（E2E と yamnet-check が使うので必ず入っている）の Web Audio API に任せる。
// decodeAudioData は AudioContext のサンプリング周波数にリサンプルしてしまうので、先に mp3 のヘッダから sr を読み、
// その sr の OfflineAudioContext を作って「元の sr のまま」取り出す（c3 の sr 依存を見るために元の sr を残したい。accuracy.md 2026-11-19）。
import fs from 'node:fs';
import path from 'node:path';

const MPEG_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }; // version bits → sr 表（MPEG-1 / 2 / 2.5）

/** mp3 のヘッダ（ID3v2 は飛ばす）からサンプリング周波数を読む。見つからなければ null */
export function mp3SampleRate(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let i = 0;
  if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {       // "ID3"
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    i = 10 + size + ((b[5] & 0x10) ? 10 : 0);                                      // footer があれば +10
  }
  for (const end = Math.min(b.length - 3, i + (1 << 20)); i < end; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;                     // frame sync 11 bit
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, srIdx = (b[i + 2] >> 2) & 3;
    if (ver === 1 || layer === 0 || srIdx === 3) continue;                         // 予約値
    const sr = MPEG_SR[ver][srIdx];
    // 次のフレームも同じヘッダで始まるか（偶然の sync を避ける）。長さ = 144 × bitrate / sr（Layer III、padding 込み）。bitrate 表は省き、次の 2 byte だけ比べる
    const next = i + frameLength(b, i, ver, layer, sr);
    if (next > 0 && next + 1 < b.length && (b[next] !== 0xff || (b[next + 1] & 0xfe) !== (b[i + 1] & 0xfe))) continue;
    return sr;
  }
  return null;
}

const BITRATES = { // kbps。[version][layer] → index 1〜14
  '3-1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],      // MPEG-1 Layer III
  '3-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],     // MPEG-1 Layer II
  '3-3': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],  // MPEG-1 Layer I
  '2-1': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],          // MPEG-2/2.5 Layer III
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
};
function frameLength(b, i, ver, layer, sr) {
  const brIdx = b[i + 2] >> 4, pad = (b[i + 2] >> 1) & 1;
  if (brIdx === 0 || brIdx === 15) return 0; // free format / 予約 → 次フレームの確認は飛ばす
  const kbps = BITRATES[`${ver === 3 ? 3 : 2}-${layer}`][brIdx];
  if (layer === 3) return Math.floor((12 * kbps * 1000 / sr + pad) * 4);          // Layer I
  const samples = layer === 1 && ver !== 3 ? 576 : 1152;                          // MPEG-2 Layer III は 576
  return Math.floor(samples / 8 * kbps * 1000 / sr + pad);
}

/** Float32 モノラル → 16bit PCM WAV */
export function writeWav(file, x, sr) {
  const n = x.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, b);
}

/**
 * mp3 等のファイルを Chromium で復号して、隣に同名の .wav（16bit モノラル、元の sr）を置く。
 * 戻り値: [{ file, wav, sr, seconds }]（失敗した本は { file, error }）。ffmpeg は使わない。
 */
export async function toWavWithChromium(files, { log = console.warn } = {}) {
  const todo = files.filter(f => !/\.wav$/i.test(f) && !fs.existsSync(f.replace(/\.[^.]+$/, '.wav')));
  if (!todo.length) return [];
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const out = [];
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>decode</title>');
    for (const file of todo) {
      try {
        const bytes = fs.readFileSync(file);
        const sr = /\.mp3$/i.test(file) ? mp3SampleRate(bytes) : null;
        if (!sr) log(`sr をヘッダから読めず 44100 とみなす: ${path.basename(file)}`);
        const r = await page.evaluate(async ([arr, sr]) => {
          const ctx = new OfflineAudioContext(1, 1, sr);
          const buf = await ctx.decodeAudioData(Uint8Array.from(arr).buffer);
          const mono = new Float32Array(buf.length);
          for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
          return { sr: buf.sampleRate, mono: Array.from(mono) };
        }, [Array.from(bytes), sr || 44100]);
        const wav = file.replace(/\.[^.]+$/, '.wav');
        writeWav(wav, Float32Array.from(r.mono), r.sr);
        out.push({ file, wav, sr: r.sr, seconds: +(r.mono.length / r.sr).toFixed(2) });
      } catch (e) {
        log(`Chromium で変換できず: ${path.basename(file)} - ${e?.message || e}`);
        out.push({ file, error: String(e?.message || e) });
      }
    }
  } finally { await browser.close(); }
  return out;
}
