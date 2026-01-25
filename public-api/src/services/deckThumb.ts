// デッキ画像URLリゾルバ
// 役割: 公式サイトの thumbs/confirm ページURLから、実際の画像（png/jpg）URLを抽出して返します。
// 方針:
// - URLが既に画像拡張子（.png/.jpg/.jpeg）ならそのまま返します。
// - `/deck/thumbs.html/deckID/<id>/` または `/deck/confirm.html/deckID/<id>` などのHTMLページの場合、
//   ページ内容を fetch して `<img src="...">` の最初の画像リンクを抽出します。
// - 抽出結果はメモリキャッシュで短時間保持し、同一 `deckId` への再取得を抑制します。

// deprecated: moved to admin-api. do not use.

const ORIGIN = 'https://www.pokemon-card.com';

// 入力URLから deckId を推定します（複数フォーマット対応）。
function extractDeckId(url: string): string | null {
  try {
    const u = new URL(url, ORIGIN);
    const m = u.pathname.match(/\/deck\/(?:confirm|thumbs)\.html\/deckID\/([A-Za-z0-9_-]+)/);
    if (m && m[1]) return m[1];
    const q = u.searchParams.get('deckID');
    if (q && /^[A-Za-z0-9_-]+$/.test(q)) return q;
    const mPlayers = u.pathname.match(/\/deck\/([A-Za-z0-9_-]+)/);
    if (mPlayers && mPlayers[1] && mPlayers[1] !== 'confirm.html') return mPlayers[1];
    return null;
  } catch { return null; }
}

function looksLikeImage(url: string): boolean {
  return /\.(png|jpg|jpeg)(\?.*)?$/i.test(url);
}

// HTMLから最初の画像URLを抽出（png/jpgのみ、相対パス対応）。
function pickFirstImageUrl(html: string): string | null {
  const re = /<img[^>]+src=["']([^"']+\.(?:png|jpg|jpeg))["']/i;
  const m = html.match(re);
  if (!m || !m[1]) return null;
  try { return new URL(m[1], ORIGIN).toString(); } catch { return null; }
}

export async function resolveDeckImageUrl(sourceUrl: string): Promise<string | null> { return sourceUrl || null; }
