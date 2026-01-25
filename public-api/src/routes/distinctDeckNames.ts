import type { Express, Request, Response } from 'express';
import { db } from '../common/firebase.js';
import { MemoryCache } from '../common/cache.js';
import { countDistinctDeckNamesBySnapshots } from '../services/deckNames.js';

/*
  このファイルは Express アプリに「デッキ名の頻出度を集計する」HTTP ルートを追加します。

  どの処理で利用されるか（役割のつながり）
  - public-api の起動時に、[public-api/public-server.ts](public-api/public-server.ts#L27) から `attachDistinctDeckNamesRoutes(app)` が呼ばれ、
    クライアントから `GET /api/distinct-deck-names` を受け付けられるようになります。
  - このエンドポイントは、期間（from/to）とカテゴリ（例: オープン）を指定して、
    Firestore の `pokemon-event-rankings` コレクションから `deckName` の出現回数を数え、
    名前ごとの件数一覧を返します。順位によるフィルタは行わず「全ランク対象」の単純頻度です。
  - iOS クライアントでは週次集計のエンドポイント（/api/weekly/distinct-deck-names）を主に利用しますが、
    本ルートは日付範囲を自由に指定して分析・確認したい場合に使われます。

  エンドポイント仕様（リクエスト・レスポンスの形）
  - GET /api/distinct-deck-names?from=YYYYMMDD&to=YYYYMMDD&category=オープン
  - 返却例: { ok: true, items: [{ name, count }], range: { from, to }, category }

  実装上のポイント（このファイル内の処理の見取り図）
  - 同じ期間＋カテゴリの再計算を避けるためにメモリキャッシュ（TTL 5 分）を使います。
  - `from/to` は文字列（YYYYMMDD）として受け取り、JST の暦日を基準に各日の日次スナップショット（`daily-rankings-snapshots`）を参照して集計します。
  - スナップショットには `rankings` と `groups[].rankings` があり、両方を合算して `deckName` の出現回数を数えます（順位制限なし）。
  - `category` が指定されていれば `cityLeagueCategory` でフィルタします。
*/
export function attachDistinctDeckNamesRoutes(app: Express) {
  // ルート層のキャッシュはサービス層に集約済み。
  app.get('/api/distinct-deck-names', async (req: Request, res: Response) => {
    try {
      // クエリ文字列から期間とカテゴリを受け取ります（from/to は YYYYMMDD 形式）。
      const fromYmd = (req.query.from as string) || '';
      const toYmd = (req.query.to as string) || '';
      const category = (req.query.category as string) || '';
      if (!fromYmd || !toYmd) return res.status(400).json({ ok:false, error:'from & to required'});

      // 集計のキャッシュはサービス側で管理します。

      // 日次スナップショット（daily-rankings-snapshots）を対象に、範囲内の日付を走査して distinct 集計します。
      const { items } = await countDistinctDeckNamesBySnapshots({ fromYmd, toYmd, category });
      const payload = { ok:true, items, range:{ from: fromYmd, to: toYmd }, category: category || null };
      res.json(payload);
    } catch (e:any) {
      // 予期しないエラーは 500 としてメッセージを返します。
      res.status(500).json({ ok:false, error: e.message || String(e) });
    }
  });
}
