// recs.js — 「本当の気持ち」に合わせたおすすめ（検索リンク）。affiliate.json に ID が入るまでは何も出さない。
export const RECS = {
  alarm: [
    { q: 'クレート カバー 犬', label: 'クレートのカバー', why: '物音に反応しやすい子は、暗くて囲われた「巣」があると落ち着きやすい' },
    { q: 'ノーズワーク 知育玩具 犬', label: 'ノーズワークのおもちゃ', why: '来客前に鼻を使う遊びで気をそらす' },
  ],
  threat: [
    { q: '犬 吠え癖 しつけ 本', label: '吠え癖のしつけ本', why: '威嚇の吠えは「叱る」より原因を減らす。まず仕組みを知る' },
    { q: 'トレーニング おやつ 犬 小粒', label: '小粒のごほうび', why: '落ち着いた瞬間にすぐ渡せる小さいおやつが効く' },
  ],
  demand: [
    { q: 'コング 犬 おもちゃ', label: '中におやつを詰めるおもちゃ', why: '「待てば出てくる」を覚えると要求吠えが減りやすい' },
    { q: '早食い防止 食器 犬', label: '早食い防止の食器', why: 'ごはんの時間が長くなり、満足しやすい' },
  ],
  play: [
    { q: 'ロープ おもちゃ 犬 引っ張り', label: '引っ張りっこのロープ', why: '誘いに短くでも応えると、吠えて誘う回数が減る' },
    { q: '犬 ボール 投げる おもちゃ', label: '投げて遊ぶボール', why: '散歩で発散しきれない日の5分用' },
  ],
  lonely: [
    { q: '留守番 おもちゃ 犬 知育', label: '留守番用の知育おもちゃ', why: '出かける直前に渡すと、留守番＝いいこと、に変わる' },
    { q: 'ペットカメラ 自動給餌', label: 'ペットカメラ', why: '外から様子を見て声をかけられる。吠えのタイミングも分かる' },
  ],
  excited: [
    { q: '犬 おやつ ご褒美', label: 'お出迎え用のごほうび', why: '帰宅時は落ち着いてから渡す。興奮の吠えが短くなる' },
    { q: 'ハーネス 犬 引っ張り防止', label: '引っ張り防止ハーネス', why: 'うれしさで飛び出す子の散歩が楽になる' },
  ],
};

export const DISCLOSURE = '当アプリは Amazon アソシエイト・楽天アフィリエイトの参加者です。リンク経由の購入で紹介料を得ることがあります。音声や判定結果は送信しません。';

export function amazonUrl(q, tag) {
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}${tag ? '&tag=' + encodeURIComponent(tag) : ''}`;
}
export function rakutenUrl(q, id) {
  const target = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(q)}/`;
  return id ? `https://hb.afl.rakuten.co.jp/hgc/${encodeURIComponent(id)}/?pc=${encodeURIComponent(target)}&m=${encodeURIComponent(target)}` : target;
}

// 設定を読む。無い／壊れている／IDが空 → null（表示しない）
export async function loadConfig(url = './affiliate.json') {
  try {
    const res = await fetch(url, { cache: 'no-cache' }); if (!res.ok) return null;
    const c = await res.json();
    if (c.enabled === false) return null;
    const amazonTag = (c.amazonTag || '').trim(), rakutenId = (c.rakutenId || '').trim();
    if (!amazonTag && !rakutenId) return null;
    return { amazonTag, rakutenId };
  } catch { return null; }
}

// 表示用のリンク一覧。設定が無ければ []
export function links(k, cfg) {
  if (!cfg) return [];
  return (RECS[k] || []).map(r => ({
    ...r,
    amazon: cfg.amazonTag ? amazonUrl(r.q, cfg.amazonTag) : null,
    rakuten: cfg.rakutenId ? rakutenUrl(r.q, cfg.rakutenId) : null,
  }));
}
