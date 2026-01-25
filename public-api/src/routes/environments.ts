import type { Express, Request, Response } from 'express';
import { db } from '../common/firebase.js';

/*
  このファイルの役割
  - 公開APIに「対戦環境（フォーマット）一覧」を提供するエンドポイント GET /api/environments を追加します。
  - データソースは Firestore コレクション `pokemon-environments`（各環境の名称・期間）。
  - 利用箇所の例:
    - iOS クライアント: ios/Services/ApiClient.swift の `fetchEnvironments()` から呼び出し。
    - 画面側: ios/Views/ContentView.swift で環境選択の初期表示に利用。
  - ルート登録: public-api/public-server.ts で `attachEnvironmentRoutes` が呼ばれてサーバに組み込まれます。
*/

/*
  ユーティリティ: 任意の日付表現を YYYYMMDD 文字列へ正規化します。
  - 受け付ける型:
    - Firestore Timestamp（`toDate()` を持つオブジェクト）
    - JS Date
    - 文字列（YYYY/MM/DD, YYYY-MM-DD, YYYYMMDD）
  - 変換できない場合は undefined を返します。
  - 目的:
    - Firestore 側のデータが文字列以外で保存されているケース（旧フィールドや Timestamp）でも、
      API の出力を一貫して YYYYMMDD に揃えるため。この関数は本ファイル内の一覧生成処理でのみ使用します。
    - 日付のローカルタイム差によるズレを避けるため、JST(+09:00)に補正した上で日付文字列を作成します。
*/
function toYmdString(v: any): string | undefined {
  if (!v) return undefined;
  const normalizeDate = (d: Date) => {
    const jst = new Date(d.getTime() + 9*60*60*1000);
    const y = jst.getUTCFullYear();
    const m = (jst.getUTCMonth()+1).toString().padStart(2,'0');
    const day = jst.getUTCDate().toString().padStart(2,'0');
    return `${y}${m}${day}`;
  };
  if (typeof v === 'string') {
    // 文字列表現（区切りあり/なし）を受け取り、YYYYMMDD の8桁に揃えてから Date を作成
    const cleaned = v.replace(/[-/]/g,'');
    if (/^\d{8}$/.test(cleaned)) {
      const y = parseInt(cleaned.substring(0,4),10);
      const m = parseInt(cleaned.substring(4,6),10);
      const d = parseInt(cleaned.substring(6,8),10);
      const date = new Date(Date.UTC(y, m-1, d));
      return normalizeDate(date);
    }
    return undefined;
  }
  if (typeof v.toDate === 'function') {
    return normalizeDate(v.toDate());
  }
  if (v instanceof Date) {
    return normalizeDate(v);
  }
  return undefined;
}

/*
  ルート: 環境一覧 API（GET /api/environments）
  - 役割:
    - 対戦環境（名称と期間）の配列を返します。
    - 本日（JST）時点で開始済みの環境のみを対象にし、開始日の新しい順でソートします。
  - 入力:
    - クエリは不要。
  - 出力:
    - 200 OK: `{ ok: true, environments: [{ name, startYmd, endYmd }] }`
    - 500 エラー: `{ ok: false, error }`
  - データソースと互換:
    - `pokemon-environments` コレクションから取得。ドキュメントの例:
      `{ name: string, startDate: string(YYYYMMDD)|Date|Timestamp|旧 startMD, endDate: string|Date|Timestamp|旧 endMD }`
    - 旧フィールドや文字列以外の型が混在していても `toYmdString()` で YYYYMMDD に揃えます。
  - 利用箇所:
    - iOS: `ApiClient.fetchEnvironments()` → `ContentView` の環境選択リストの取得に使用。
    - サーバ起動時の登録: `public-api/public-server.ts` から本ルート関数が呼ばれます。
*/
export function attachEnvironmentRoutes(app: Express) {
  app.get('/api/environments', async (_req: Request, res: Response) => {
    try {
      // 1) Firestore から環境ドキュメントを全件取得
      const snap = await db.collection('pokemon-environments').get();
      // 2) 取得したドキュメントをアプリ出力形式 { name, startYmd, endYmd } に整形
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
        .map(r => {
          const name = typeof r.name === 'string' ? r.name : (typeof r.environmentName === 'string' ? r.environmentName : undefined);
          // start/end は文字列(YYYYMMDD)を優先し、無い/型が違う場合は旧フィールドや日付型を正規化
          const startYmd = typeof r.startDate === 'string' ? r.startDate : toYmdString(r.startDate ?? r.startMD);
          const endYmd = typeof r.endDate === 'string' ? r.endDate : toYmdString(r.endDate ?? r.endMD);
          return { name, startYmd, endYmd } as { name?: string; startYmd?: string; endYmd?: string };
        })
        // 3) name・期間が欠けているものは除外
        .filter(r => !!r.name && !!r.startYmd && !!r.endYmd)
        .map(r => ({ name: r.name!, startYmd: r.startYmd!, endYmd: r.endYmd! }));
      // 4) 本日(JST)までに開始している環境のみを対象にする（未来の環境は除外）
      const todayYmd = toYmdString(new Date());
      const filtered = todayYmd
        ? rows.filter(r => parseInt(r.startYmd, 10) <= parseInt(todayYmd, 10))
        : rows;
      // 5) 開始日の新しい順に並べ替え（YYYYMMDD を数値化して比較）
      const toVal = (x: string) => parseInt(x,10);
      filtered.sort((a,b) => toVal(b.startYmd) - toVal(a.startYmd));
      // 6) レスポンス返却
      res.json({ ok: true, environments: filtered });
    } catch (e: any) {
      // 失敗時は 500 とエラーメッセージを返します
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });
}
