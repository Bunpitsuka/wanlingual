// PCM WAV の読み込み（16bit / 24bit / 32bit float、モノラル化）。検証スクリプト共用。
import fs from 'node:fs';

/** WAV → { x: Float32Array（モノラル）, sr } */
export function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF: ' + file);
  let off = 12, sr = 0, ch = 1, bits = 16, fmt = 1, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(off + 8); ch = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22); }
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + Math.min(size, b.length - off - 8)); break; }
    off += 8 + size + (size & 1);
  }
  if (!data) throw new Error('no data chunk: ' + file);
  const bps = bits / 8, n = Math.floor(data.length / bps / ch), x = new Float32Array(n);
  const read = (i) => {
    if (fmt === 3 && bits === 32) return data.readFloatLE(i * 4);
    if (bits === 16) return data.readInt16LE(i * 2) / 32768;
    if (bits === 24) return ((data[i * 3] | (data[i * 3 + 1] << 8) | (data[i * 3 + 2] << 16)) << 8 >> 8) / 8388608;
    if (bits === 32) return data.readInt32LE(i * 4) / 2147483648;
    if (bits === 8) return (data[i] - 128) / 128;
    throw new Error(`unsupported wav (${bits}bit fmt ${fmt}): ${file}`);
  };
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) s += read(i * ch + c); x[i] = s / ch; }
  return { x, sr };
}
