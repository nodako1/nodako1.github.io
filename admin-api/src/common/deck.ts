// デッキURL関連のユーティリティ
// 目的: Players（プレイヤーズ）サイトの複数フォーマットのURLから一貫した `deckId` を取り出し、
//       公式サイトの「正規URL」（後工程で扱いやすい形式）へ揃えるための関数群です。
// このファイルの関数は、ランキング取得の処理で利用されます（どの処理で使うかの例は各関数の説明を参照）。
// 参考: 利用例は [admin-api/src/steps/rankings.ts](admin-api/src/steps/rankings.ts) の `saveRankingsForEventLocal()` など。
export function extractDeckIdFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, 'https://www.pokemon-card.com');
    const mOfficial = u.pathname.match(/\/deck\/(?:confirm|thumbs)\.html\/deckID\/([A-Za-z0-9_-]+)/);
    if (mOfficial && mOfficial[1]) return mOfficial[1];
    const qId = u.searchParams.get('deckID');
    if (qId && /^[A-Za-z0-9_-]+$/.test(qId)) return qId;
    const mPlayers = u.pathname.match(/\/deck\/([A-Za-z0-9_-]+)/);
    if (mPlayers && mPlayers[1] && mPlayers[1] !== 'confirm.html') return mPlayers[1];
    return null;
  } catch { return null; }
}
/**
 * 概要: 任意のデッキURLから `deckId`（デッキ固有ID）だけを取り出します。
 * 対応URL例:
 * - Players: https://players.pokemon-card.com/deck/abcdEFG123
 * - 公式 詳細: https://www.pokemon-card.com/deck/confirm.html/deckID/abcdEFG123
 * - 公式 サムネ: https://www.pokemon-card.com/deck/thumbs.html/deckID/abcdEFG123/
 * 戻り値: `deckId`（文字列）または null（取り出せない場合）
 * 使用箇所: ランキング保存の直前に `deckUrl` から `deckId` を抽出するために使用
 *   - 例: [admin-api/src/steps/rankings.ts](admin-api/src/steps/rankings.ts#L246-L267)
 * ポイント: URLの種類（Players/公式）に関係なく、同じ正規表現やクエリ文字を見て ID を抽出します。
 */
export function canonicalizeDeckUrl(url?: string | null): string | null {
  const deckId = extractDeckIdFromUrl(url || undefined);
  return deckId ? `https://www.pokemon-card.com/deck/confirm.html/deckID/${deckId}` : null;
}
/**
 * 概要: 任意のURLを「公式のデッキ詳細ページ」の正規URLへ揃えます。
 * 変換例:
 * - 入力: https://players.pokemon-card.com/deck/abcdEFG123
 * - 出力: https://www.pokemon-card.com/deck/confirm.html/deckID/abcdEFG123
 * 戻り値: 正規化されたURL文字列、または null（`deckId`が取れない場合）
 * 使用箇所: Firestoreへランキングを保存する際、URLを統一するために使用
 *   - 例: [admin-api/src/steps/rankings.ts](admin-api/src/steps/rankings.ts#L246)
 * ポイント: まず `extractDeckIdFromUrl()` で ID を抜き出してから、公式の確定フォーマットに組み立てます。
 */
export function canonicalizeDeckThumbUrl(url?: string | null): string | null {
  const deckId = extractDeckIdFromUrl(url || undefined);
  return deckId ? `https://www.pokemon-card.com/deck/thumbs.html/deckID/${deckId}/` : null;
}

// 追加: デッキ画像の実URL解決（thumbs/confirm HTMLから最初の画像リンクを抽出）
// 目的: `daily-rankings-snapshots.deckListImageUrl` へ最初から画像（png/jpg）のURLを保存する。
// 入力: Players/公式いずれのURLでも可（deckId を抽出して公式 thumbs にアクセス）。
// 出力: 画像URL（png/jpg）。取得失敗時は null。
// シンプルなインプロセスキャッシュ（null もキャッシュし、再取得を抑制）
const _imageCache = new Map<string, { value: string | null; expiresAt: number }>();
const _TTL_MS = 24 * 60 * 60 * 1000; // 24時間

export async function resolveDeckImageUrl(url?: string | null): Promise<string | null> {
  if (!url) return null;
  const ORIGIN = 'https://www.pokemon-card.com';
  const looksImage = (s: string) => /\.(png|jpg|jpeg)(\?.*)?$/i.test(s);
  if (looksImage(url)) return url;

  const deckId = extractDeckIdFromUrl(url || undefined);
  const key = deckId ? `deck:${deckId}` : `url:${url}`;
  const cached = _imageCache.get(key);
  if (cached && Date.now() <= cached.expiresAt) {
    return cached.value; // null でも再取得しない
  }

  const htmlUrl = deckId ? `${ORIGIN}/deck/thumbs.html/deckID/${deckId}/` : url;
  try {
    const resp = await fetch(htmlUrl, { method: 'GET' });
    if (!resp.ok) { _imageCache.set(key, { value: null, expiresAt: Date.now() + _TTL_MS }); return null; }
    const html = await resp.text();
    const re = /<img[^>]+src=["']([^"']+\.(?:png|jpg|jpeg))["']/i;
    const m = html.match(re);
    let out: string | null = null;
    if (m && m[1]) {
      try { out = new URL(m[1], ORIGIN).toString(); } catch { out = null; }
    }
    _imageCache.set(key, { value: out, expiresAt: Date.now() + _TTL_MS });
    return out;
  } catch {
    _imageCache.set(key, { value: null, expiresAt: Date.now() + _TTL_MS });
    return null;
  }
}
