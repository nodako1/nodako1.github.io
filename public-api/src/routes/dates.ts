import type { Express, Request, Response } from 'express';
import { db, admin } from '../common/firebase.js';

// このファイルの役割と主な利用箇所
// - 役割: 公開APIの「日付一覧」エンドポイント（GET /api/dates）を Express に取り付けます。
//         応答は YYYYMMDD の文字列配列（最大30件）で、画面の対象日選択などに使われます。
// - 利用箇所:
//   - iOS クライアント: ios/Services/ApiClient.swift の fetchDates() から呼び出し（一覧や過去データ探索の起点）。
//   - デプロイスクリプト: scripts/deploy-public-api.sh で疎通確認に利用。
//   - README/ドキュメント: README.md で API 仕様として掲載。
// - 備考: Firestore の pokemon-events コレクションを参照します。`admin` は拡張用途でインポートされています。
export function attachDateRoutes(app: Express) {
  // ルート: GET /api/dates
  // - 戻り値: ["YYYYMMDD", ...]
  // - クエリ:
  //   - category: リーグカテゴリ（例: オープン/シニア/ジュニア）。一致するイベントのみ集計。
  //   - from, to: どちらも 8桁の YYYYMMDD を指定したとき、取得日(scrapedAt)レンジで抽出。
  app.get('/api/dates', async (req: Request, res: Response) => {
    try {
      // クエリの取り出しと共通正規化関数
      const category = (req.query.category || '').toString().trim();
      const fromYmd = (req.query.from || '').toString().trim();
      const toYmd = (req.query.to || '').toString().trim();
      const norm = (s: any) => (typeof s === 'string' ? s.trim() : s);

      // 分岐①: 期間指定モード（from/to がどちらも YYYYMMDD）
      // - Firestore: pokemon-events（rankingsScraped==true のみ）
      // - 絞り込み: scrapedAt（ISO文字列）を UTC で比較 → JST に直して開催日に変換
      const isYmd = (v: string) => /^\d{8}$/.test(v);
      if (isYmd(fromYmd) && isYmd(toYmd)) {
        // 期間の両端を UTC の 00:00:00 と 23:59:59 に設定
        const y1 = parseInt(fromYmd.slice(0,4),10), m1 = parseInt(fromYmd.slice(4,6),10)-1, d1 = parseInt(fromYmd.slice(6,8),10);
        const y2 = parseInt(toYmd.slice(0,4),10), m2 = parseInt(toYmd.slice(4,6),10)-1, d2 = parseInt(toYmd.slice(6,8),10);
        const fromStartUtc = new Date(Date.UTC(y1,m1,d1));
        const toEndUtc = new Date(Date.UTC(y2,m2,d2,23,59,59));

        // 取得対象イベントの読み込み（十分大きな上限を設定）。ランキング取得済みのみ対象。
        const evSnap = await db.collection('pokemon-events').where('rankingsScraped','==', true).limit(5000).get();
        const set = new Set<string>();
        for (const doc of evSnap.docs) {
          const ev = doc.data() as any; if (!ev) continue;
          if (category && norm(ev.cityLeagueCategory) !== norm(category)) continue;

          // scrapedAt: ISO文字列として保存。UTC で範囲判定 → JST に補正して開催日を導出。
          const scrapedAtRaw = ev.scrapedAt; if (!scrapedAtRaw || typeof scrapedAtRaw !== 'string') continue;
          const scrapedMs = Date.parse(scrapedAtRaw); if (isNaN(scrapedMs)) continue;
          const scrapedDateUtc = new Date(scrapedMs);
          if (scrapedDateUtc < fromStartUtc || scrapedDateUtc > toEndUtc) continue;

          // JST へ 9時間加算（UTC→JST）。年跨ぎは後段で補正。
          const jst = new Date(scrapedMs + 9*60*60*1000);

          // 開催日決定ロジック:
          // 1) イベントの dateOnly(M/D) があれば YYYYMMDD に正規化（JSTの年を基準、1月スクレイプ×12月開催は前年に補正）
          // 2) なければ scrapedAt の前日を開催日とみなす（前日ロジック）
          let ymd: string | null = null;
          const mdRaw: string | null = ev.dateOnly || ev.date || null;
          if (mdRaw && /\d{1,2}\/\d{1,2}/.test(mdRaw)) {
            const parts = mdRaw.split('/');
            const mNum = parseInt(parts[0],10); const dNum = parseInt(parts[1],10);
            if (!isNaN(mNum) && !isNaN(dNum)) {
              let year = jst.getUTCFullYear();
              // スクレイプが 1 月でイベント月が 12 月のケースは前年に振替
              if ((jst.getUTCMonth()+1) === 1 && mNum === 12) year = year - 1;
              const mStr = String(mNum).padStart(2,'0'); const dStr = String(dNum).padStart(2,'0');
              ymd = `${year}${mStr}${dStr}`;
            }
          }
          if (!ymd) {
            // 2) 前日ロジック
            const prev = new Date(jst.getTime() - 24*60*60*1000);
            const y = prev.getUTCFullYear(); const m2 = String(prev.getUTCMonth()+1).padStart(2,'0'); const d2 = String(prev.getUTCDate()).padStart(2,'0');
            ymd = `${y}${m2}${d2}`;
          }
          if (ymd) set.add(ymd);
        }
        // 降順で最大30件に抑えて返却
        const dates = Array.from(set.values()).sort((a,b)=> b.localeCompare(a, 'ja')).slice(0,30);
        return res.json(dates);
      }

      // フォールバック: 期間指定なしは scrapedAt 降順で開催日（YYYYMMDD）を返却
      // - limit: 既定30, 1〜100 の範囲で調整可能
      const limitRaw = (req.query.limit || '').toString().trim();
      const limitNum = parseInt(limitRaw, 10);
      const LIMIT = (!isNaN(limitNum) && limitNum >= 1 && limitNum <= 100) ? limitNum : 30;

      // データ取得（十分な上限）。rankingsScraped はメモリでフィルタし、scrapedAt で降順に整列。
      const snap = await db.collection('pokemon-events').limit(5000).get();
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const withRankings = rows.filter(r => r.rankingsScraped === true);
      const filtered = category ? withRankings.filter(r => norm(r.cityLeagueCategory) === norm(category)) : withRankings;
      const byScrapedDesc = filtered.sort((a: any, b: any) => {
        const ams = Date.parse(a.scrapedAt || '');
        const bms = Date.parse(b.scrapedAt || '');
        if (isNaN(ams) && isNaN(bms)) return 0;
        if (isNaN(ams)) return 1;
        if (isNaN(bms)) return -1;
        return bms - ams;
      });

      // scrapedAt 基準で走査し、開催日を YYYYMMDD へ正規化してユニーク化。上限に達したら打ち切り。
      const set = new Set<string>();
      for (const r of byScrapedDesc) {
        // JSTへ補正（UTC→JST）
        const scrapedMs = Date.parse(r.scrapedAt || '');
        const jst = isNaN(scrapedMs) ? null : new Date(scrapedMs + 9*60*60*1000);

        // 1) dateOnly (M/D) が有効なら YYYYMMDD に変換（JSTの年を基準、年跨ぎ補正あり）
        let ymd: string | null = null;
        const mdRaw: string | null = r.dateOnly || r.date || null;
        if (mdRaw && /\d{1,2}\/\d{1,2}/.test(mdRaw)) {
          const parts = mdRaw.split('/');
          const mNum = parseInt(parts[0],10); const dNum = parseInt(parts[1],10);
          if (!isNaN(mNum) && !isNaN(dNum)) {
            let year = jst ? jst.getUTCFullYear() : new Date().getUTCFullYear();
            if (jst && (jst.getUTCMonth()+1) === 1 && mNum === 12) year = year - 1;
            const mStr = String(mNum).padStart(2,'0'); const dStr = String(dNum).padStart(2,'0');
            ymd = `${year}${mStr}${dStr}`;
          }
        }
        // 2) 代替: dateOnly が無効なら scrapedAt の前日を開催日とみなす
        if (!ymd && jst) {
          const prev = new Date(jst.getTime() - 24*60*60*1000);
          const y = prev.getUTCFullYear(); const m2 = String(prev.getUTCMonth()+1).padStart(2,'0'); const d2 = String(prev.getUTCDate()).padStart(2,'0');
          ymd = `${y}${m2}${d2}`;
        }

        if (ymd) {
          set.add(ymd);
          if (set.size >= LIMIT) break;
        }
      }
      const dates = Array.from(set.values()).sort((a,b)=> b.localeCompare(a, 'ja'));
      res.json(dates);
    } catch (e: any) {
      // エラーハンドリング: 例外内容をそのままメッセージとして返却
      res.status(500).json({ error: e.message || String(e) });
    }
  });
}
