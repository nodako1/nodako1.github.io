/*
  モジュール概要:
  - 公開APIに YouTube 関連のルートを登録するモジュール。
  - [public-api/public-server.ts] で `attachYouTubeRoutes(app)` が呼ばれることで、
    クライアント（iOSアプリやWeb）から最新動画を取得するためのエンドポイント
    `/api/youtube/latest` が有効化される。
  - 取得方法は2種類:
    1) ハンドルページ（例: /@PokecaCH/videos）を直接取得して最初の動画を抽出（高速）。
    2) RSSフィード（/feeds/videos.xml?channel_id=...）から複数件の最新動画を取得（フォールバック兼複数件取得）。
  - メモリキャッシュを用いて同一クエリの再計算を抑制し、API応答の安定性と性能を確保する。
*/
import type { Express, Request, Response } from 'express';
import { MemoryCache } from '../common/cache.js';

/*
  関数: fetchFirstVideoFromHandleVideos(handle)
  役割:
  - 指定されたチャンネルハンドルの「動画」ページ（/@handle/videos）を取得し、
    最初に見つかった動画IDを抽出して返す。
  この関数が使われる処理:
  - ルート `/api/youtube/latest` において、`limit=1` の要求時に呼び出される。
    ページ構造に依存するため失敗する可能性があり、その場合は RSS にフォールバックする。
  返却値:
  - 見つかった場合は `{ videoId, title?, thumbnail?, url }`、見つからなければ `null`。
*/
async function fetchFirstVideoFromHandleVideos(handle: string): Promise<{ videoId: string; title?: string; thumbnail?: string; url: string } | null> {
  const url = `https://www.youtube.com/${handle.replace(/^@/, '@')}/videos`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (PokeDeck)' } as any });
  if (!resp.ok) return null;
  const html = await resp.text();
  // ページから最初にマッチした `/watch?v=...` を採用（ライブ・ショートを含む可能性あり）
  const m = html.match(/\/watch\?v=([0-9A-Za-z_-]{11})/);
  if (!m) return null;
  const videoId = m[1];
  // タイトルは安定性の観点で <meta name="title"> を優先、無ければ <title> から取得
  let title: string | undefined;
  const tm = html.match(/<meta name="title" content="([^"]+)"/);
  if (tm) title = tm[1]; else {
    const pt = html.match(/<title>([^<]+)<\/title>/);
    if (pt) title = pt[1].replace(/ - YouTube$/, '');
  }
  return { videoId, title, url: `https://www.youtube.com/watch?v=${videoId}` };
}

/*
  関数: fetchLatestViaRss(handle, limit)
  役割:
  - チャンネルページから `channelId` を抽出し、その RSS フィードを取得して
    最新動画情報（最大 `limit` 件、上限20件）を配列で返す。
  この関数が使われる処理:
  - ルート `/api/youtube/latest` において、`limit>1` の要求時のメイン経路。
  - また `limit=1` の際、ページ抽出が失敗したときのフォールバックとしても利用。
  返却値:
  - `[{ videoId, title, thumbnail, url, published }, ...]` の配列。取得に失敗した場合は空配列。
*/
async function fetchLatestViaRss(handle: string, limit: number): Promise<any[]> {
  const baseUrl = `https://www.youtube.com/${handle.replace(/^@/, '@')}`;
  const baseResp = await fetch(baseUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (PokeDeck)' } as any });
  if (!baseResp.ok) return [];
  const html = await baseResp.text();
  const m = html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/);
  const channelId = m ? m[1] : null;
  if (!channelId) return [];
  const rss = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const resp = await fetch(rss, { headers: { 'User-Agent': 'Mozilla/5.0 (PokeDeck)' } as any });
  if (!resp.ok) return [];
  const xml = await resp.text();
  const entries: string[] = xml.split('<entry>').slice(1).map((x: string) => '<entry>' + x);
  const pick = (s: string, re: RegExp) => { const m = s.match(re); return m ? m[1] : null; };
  const items = entries.map((e: string) => {
    const videoId = pick(e, /<yt:videoId>([^<]+)<\/yt:videoId>/);
    const title = pick(e, /<title>([^<]+)<\/title>/);
    const published = pick(e, /<published>([^<]+)<\/published>/);
    const thumb = pick(e, /<media:thumbnail[^>]*url="([^"]+)"/);
    return videoId ? ({
      videoId,
      title,
      thumbnail: thumb,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      published
    }) : null;
  }).filter(Boolean) as any[];
  return items.slice(0, Math.max(1, Math.min(limit, 20)));
}

/*
  ルート登録: attachYouTubeRoutes(app)
  役割:
  - Express アプリに `/api/youtube/latest` を登録する。
  - [public-api/public-server.ts] から呼び出され、このモジュールの提供する機能が有効化される。
  エンドポイント仕様:
  - `GET /api/youtube/latest?handle=@PokecaCH&limit=1` など。
    - `handle`: 取得対象のチャンネルハンドル（先頭に @ を付けても付けなくても可）。
    - `limit`: 取得件数。1 の場合はページ抽出、2以上はRSS取得。
  実行フロー:
  1) クエリを読み取り、キャッシュキー（handle:limit）を作成。
  2) キャッシュ命中なら即返却。
  3) `limit===1` ならページ抽出 → 失敗時は RSS にフォールバック。
  4) `limit>1` なら RSS を利用。
  5) 必要に応じて結果をキャッシュし、JSONで応答。
  障害時の挙動:
  - 例外や取得失敗時は 500 を返し、`{ ok:false, error }` を通知する。
*/
export function attachYouTubeRoutes(app: Express) {
  const cache = new MemoryCache<any[]>(600); // TTL 600秒（10分）で同一クエリをキャッシュ
  app.get('/api/youtube/latest', async (req: Request, res: Response) => {
    try {
      const handle = (req.query.handle as string) || '@PokecaCH';
      const limit = parseInt(String(req.query.limit||'8'), 10) || 8;
      const key = `${handle}:${limit}`;

      const cached = cache.get(key);
      if (cached) {
        return res.json({ ok:true, videos: cached });
      }

      if (limit === 1) {
        const first = await fetchFirstVideoFromHandleVideos(handle);
        if (first) {
          return res.json({ ok:true, videos:[first] });
        }
        const rssVideos = await fetchLatestViaRss(handle, 1);
        return res.json({ ok:true, videos: rssVideos });
      }

      const videos = await fetchLatestViaRss(handle, limit);
      cache.set(key, videos);
      res.json({ ok:true, videos });
    } catch (e:any) {
      res.status(500).json({ ok:false, error: e.message || String(e) });
    }
  });
}
