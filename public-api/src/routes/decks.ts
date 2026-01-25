import type { Express, Request, Response } from 'express';
import { db } from '../common/firebase.js';

/*
  このモジュールの役割
  - 公開 API に「デッキ情報」を提供するルートを登録します。
  - サーバ起動時に [public-api/public-server.ts](public-api/public-server.ts) から `attachDeckRoutes(app)` が呼ばれ、
    クライアント（iOS アプリやウェブサイト）が `/api/decks/:deckId` にアクセスしたときにこの処理が動きます。

  どのデータを使うか（処理の出どころ）
  - Firestore の `pokemon-event-rankings` コレクションを参照し、`deckId` に一致するランキング記録を取得します。
  - これらの記録は管理側のスクレイパー（管理 API の収集処理）によって保存されており、ここでは「最新の記録」を選んで要約を返します。

  レスポンス仕様（簡易まとめ）
  - 成功時は `{ ok: true, deckId, deckUrl, summary, details }` を返します（`details` は現状 `null`）。
  - 該当記録が無くても `ok: true` を維持し、公式サイトのデッキ確認ページ URL を返してクライアント側の画面遷移を可能にします。
*/

export function attachDeckRoutes(app: Express) {
  /*
    ルート: GET /api/decks/:deckId
    - 指定された `deckId` の最新情報を Firestore から探し、プレイヤー名・順位・画像 URL などの要約を返します。
    - このルートは公開 API の一部として [public-api/public-server.ts](public-api/public-server.ts) で登録され、
      クライアントの「デッキ詳細表示」や「参照ビルド」関連の画面で利用されます。
  */
  app.get('/api/decks/:deckId', async (req: Request, res: Response) => {
    try {
      // 入力の取り出し: パスパラメータから deckId を取得。未指定なら 400 を返します。
      const deckId = req.params.deckId; if (!deckId) return res.status(400).json({ ok: false, error: 'deckId required' });

      // データ取得: Firestore のランキング記録から、該当 deckId のものを最大 50 件取得します。
      // これらの記録は管理 API のスクレイピング処理で作成され、ここでは要約表示の材料として使用します。
      const snap = await db.collection('pokemon-event-rankings').where('deckId', '==', deckId).limit(50).get();
      if (snap.empty) {
        // 記録が見つからない場合でも、公式サイトのデッキ確認ページ URL を返してクライアントの導線を維持します。
        const deckUrl = `https://www.pokemon-card.com/deck/confirm.html/deckID/${deckId}`;
        return res.json({ ok: true, deckId, deckUrl, details: null, summary: null });
      }
      // 取得できた複数記録から、`scrapedAt`（収集時刻）が最も新しいものを採用します。
      let latest: any = null; let latestTs = 0;
      for (const d of snap.docs) {
        const data = d.data();
        const ts = (data.scrapedAt && (data.scrapedAt as any).toMillis) ? (data.scrapedAt as any).toMillis() : 0;
        if (!latest || ts >= latestTs) { latest = { id: d.id, ...data }; latestTs = ts; }
      }
      // 表示用 URL・画像の決定。記録側に URL があればそれを使い、無ければ公式サイトの URL を組み立てます。
      const deckUrl = latest.deckUrl || `https://www.pokemon-card.com/deck/confirm.html/deckID/${deckId}`;
      const image = latest.imagePublicUrl || latest.deckListImageUrl || null;
      // クライアントが画面に出すための簡易サマリ。プレイヤー名・順位・画像へのリンクを含みます。
      const summary = { player: latest.playerInfo || latest.player || null, rank: latest.rank || null, image };
      return res.json({ ok: true, deckId, deckUrl, details: null, summary });
    } catch (e: any) {
      // 想定外エラー時は 500 を返し、メッセージを含めてクライアントに通知します。
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });
}
