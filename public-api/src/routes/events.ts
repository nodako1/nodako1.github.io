import type { Express, Request, Response } from 'express';
import { db } from '../common/firebase.js';

/*
  概要: イベント一覧の公開APIルートを Express アプリに登録します。

  どこで使われるか:
  - public-api/public-server.ts から `attachEventRoutes(app)` が呼ばれ、
    公開APIサービスのエンドポイント `/api/events` が有効化されます。
  - iOS クライアント（ios/Services/ApiClient.swift）が `GET /api/events?dateYmd=YYYYMMDD` を呼び出し、
    指定日のイベント概要を取得します。

  データの流れ:
  - Firestore コレクション `pokemon-events` を参照します。
  - このコレクションは管理API（admin-api）の自動実行 `/pokemon-events/auto-run` によって日次で更新され、
    Players サイトなどから収集されたイベントが保存されています。

  入力（クエリ）:
  - dateYmd: 必須（例: 20260120）。この日付のイベントを検索します。
  - category: 任意（例: シティリーグ等のカテゴリ名）。一致したイベントのみに絞り込みます。

  出力（JSON）:
  - events: 最小限のイベント情報（id, originalEventId, title, location, date, detailUrl, cityLeagueCategory）。
    originalEventId は detailUrl から数値IDを推定できる場合に `event-<num>` 形式を補完し、
    欠落データへの耐性を高めています。
*/
export function attachEventRoutes(app: Express) {
  /*
    役割: イベント一覧を返す GET エンドポイントを登録します。
    - パス: /api/events
    - 使用箇所: iOS クライアントや外部の公開クライアントから参照されます。
  */
  app.get('/api/events', async (req: Request, res: Response) => {
    try {
      /*
        1) クエリ取得とバリデーション
        - dateYmd は必須かつ "YYYYMMDD" の 8 桁である必要があります。
        - category は任意で、指定された場合は後続のフィルタに使用します。
      */
      const rawYmd = (req.query.dateYmd || '').toString().trim();
      if (!/^\d{8}$/.test(rawYmd)) return res.status(400).json({ ok: false, error: 'dateYmd (YYYYMMDD) required' });
      const category = (req.query.category || '').toString().trim();

      /*
        2) データ取得
        - Firestore の `pokemon-events` から対象日(dateYmd)のドキュメントを取得します。
        - このコレクションは admin-api の自動実行フロー（/pokemon-events/auto-run）によって更新されています。
      */
      const snapshot = await db.collection('pokemon-events').where('dateYmd', '==', rawYmd).get();
      let events = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

      /*
        3) 任意のカテゴリで絞り込み
        - 前後空白を除いた文字列で比較し、完全一致したイベントのみ残します。
      */
      const norm = (s: any) => (typeof s === 'string' ? s.trim() : s);
      if (category) events = events.filter(e => norm(e.cityLeagueCategory) === norm(category));

      /*
        4) originalEventId の補完ロジック
        - detailUrl に `/event/detail/<数字>` が含まれる場合、その数字を抽出して `event-<数字>` を生成します。
        - これにより、データ取得元で ID が欠落していても、クライアントで一意参照しやすくなります。
      */
      const extractNumeric = (url?: string) => {
        if (!url) return null;
        const m = url.match(/\/event\/detail\/(\d+)/);
        return m && m[1] ? m[1] : null;
      };

      /*
        5) レスポンス整形
        - クライアントに不要な内部フィールドを除き、必要最小限の構造に統一します。
        - date は取得できない場合でも呼び出し元の rawYmd を返すため、画面側の表示が安定します。
      */
      const shaped = events.map(e => ({
        id: e.id,
        originalEventId: e.originalEventId || (extractNumeric(e.detailUrl) ? `event-${extractNumeric(e.detailUrl)}` : e.id),
        title: e.title || null,
        location: e.location || null,
        date: e.dateYmd || rawYmd,
        detailUrl: e.detailUrl || null,
        cityLeagueCategory: e.cityLeagueCategory || null,
      }));
      res.json({ ok: true, events: shaped });
    } catch (e: any) {
      /*
        6) エラーハンドリング
        - 予期せぬ例外は 500 として返却します。
        - フロント側では `ok`/`error` を見れば原因の大枠を把握できます。
      */
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });
}
