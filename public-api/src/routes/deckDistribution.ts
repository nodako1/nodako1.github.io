import type { Express, Request, Response } from 'express';
import { db } from '../common/firebase.js';
import { MemoryCache } from '../common/cache.js';

/**
 * ファイル概要: デッキ分布に関する Public API ルート群
 *
 * このファイルは「デッキ分布の集計」と「特定デッキの参考例（サンプル）取得」を提供します。
 * バックエンドの Firestore コレクション `daily-rankings-snapshots` を参照し、
 * ランキング上位（rank <= 3）の結果を集計して返します。結果はメモリキャッシュにより再計算を抑制します（TTL 5 分）。
 *
 * 利用箇所（アプリ側処理）:
 * - iOS クライアントの `ApiClient.fetchDeckDistribution()` および `fetchDeckDistributionRange()` が
 *   `/api/deck-distribution` を呼び出し、`DeckDistributionView` で分布グラフ・一覧表示に使用します。
 * - iOS クライアントの `ApiClient.fetchDeckSamples()` および `fetchDeckSamplesRange()` が
 *   `/api/deck-samples` を呼び出し、`ReferenceBuildsDetailView` でデッキの参考例を表示します。
 *
 * 提供エンドポイントの要点:
 * - GET /api/deck-distribution
 *   入力: `days`（直近日数, 既定 14, 最大 60）、`category`（オープン/シニア/ジュニア）、または `from`/`to`（YYYYMMDD）
 *   出力: 上位 12 件の `{ name, count }` と総数 `total`。rank <= 3 を集計対象とします。
 * - GET /api/deck-samples
 *   入力: `name`（デッキ名必須）、`days` または `from`/`to`、`category`
 *   出力: 指定名かつ rank <= 3 に一致するサンプルの配列（画像URL・リンク・主催者名など含む）。
 */

/**
 * JST（UTC+9）基準の現在日時を返します。
 * Firestore ドキュメントの日付キー（YYYYMMDD）を生成する際の基準時刻に利用します。
 */
function jstNow(): Date { return new Date(Date.now() + 9*60*60*1000); }

/**
 * 指定日時を YYYYMMDD 文字列に変換します。
 * フロントから受け取る `from`/`to`、バックエンド側で生成する日付キーの整形に利用します。
 */
function ymdString(d: Date): string { const y=d.getUTCFullYear(); const m=String(d.getUTCMonth()+1).padStart(2,'0'); const dd=String(d.getUTCDate()).padStart(2,'0'); return `${y}${m}${dd}`; }

/**
 * 直近 N 日ぶんの YYYYMMDD 配列を作成します。
 * `/api/deck-distribution` および `/api/deck-samples` の `days` 指定集計で使用します。
 */
function ymdRangeDays(days: number): string[] { const out: string[] = []; const now=jstNow(); for(let i=0;i<days;i++){ const dt=new Date(now.getTime()-i*24*60*60*1000); out.push(ymdString(dt)); } return out; }

/**
 * 表示用カテゴリ（日本語）を内部キー（open/senior/junior）に変換します。
 * iOS クライアントから渡される `category` の文字列を Firestore ドキュメントIDに対応させるために使用します。
 */
function mapCategoryJaToKey(ja: string): 'open'|'senior'|'junior'|null { if (ja==='オープン') return 'open'; if (ja==='シニア') return 'senior'; if (ja==='ジュニア') return 'junior'; return null; }

/**
 * `daily-rankings-snapshots` ドキュメントからランキング行を抽出・正規化します。
 * ドキュメント直下の `rankings` と、`groups[].rankings` を統合して単一配列に整形します。
 * ルート実装側で rank フィルタやデッキ名一致判定に用います。
 */
function collectRowsFromSnapshotDoc(data: any): Array<{ rank:number; deckName:string; deckListImageUrl?:string|null; organizer?:string|null; deckId?:string|null; deckUrl?: string|null }> {
  const rows: Array<any> = Array.isArray(data?.rankings) ? data.rankings : [];
  const groups: Array<any> = Array.isArray(data?.groups) ? data.groups : [];
  // groups が存在する場合は groups のみを使用し、rankings と二重に合算しない（重複防止）
  const merged = (groups.length > 0)
    ? groups.flatMap(g => Array.isArray(g.rankings) ? g.rankings : [])
    : rows;
  return merged.map(r=>({
    rank: (typeof r.rank==='number')? r.rank : parseInt(String(r.rank||''),10),
    deckName: (typeof r.deckName==='string')? r.deckName.trim(): '',
    deckListImageUrl: (typeof r.deckListImageUrl==='string' && r.deckListImageUrl.length>0)? r.deckListImageUrl: null,
    organizer: (typeof r.organizer==='string' && r.organizer.length>0)? r.organizer: null,
    deckId: (typeof r.deckId==='string' && r.deckId.length>0)? r.deckId: (r.deckId==null? null : String(r.deckId)),
    deckUrl: (typeof r.deckUrl==='string' && r.deckUrl.length>0)? r.deckUrl: null,
  }));
}

export function attachDeckDistributionRoutes(app: Express) {
  /**
   * メモリキャッシュの初期化。
   * 同一クエリでの集計結果を 5 分間保持し、バックエンド負荷を下げます。
   */
  const cache = new MemoryCache<any>(300);

  /**
   * GET /api/deck-distribution
   * 分布表示用の集計結果を返します。iOS の `DeckDistributionView` から呼び出されます。
   * - days 指定時: 直近 N 日（最大 60）。
   * - from/to 指定時: YYYYMMDD 範囲で 1 日刻みのスナップショットを走査。
   * - category 指定時: オープン/シニア/ジュニアをフィルタ（未指定は全カテゴリ集計）。
   * いずれも rank <= 3 の出現回数をカウントし、件数上位 12 件を返します。
   */
  app.get('/api/deck-distribution', async (req: Request, res: Response) => {
    try {
      const days = Math.max(1, Math.min(parseInt(String(req.query.days||'14'),10) || 14, 60));
      const category = (req.query.category as string) || '';
      const fromYmd = (req.query.from as string) || null;
      const toYmdParam = (req.query.to as string) || null;
      const useRange = !!(fromYmd || toYmdParam);
      const cacheKey = `dist:${category}:${useRange? (fromYmd||'')+'-'+(toYmdParam||'') : 'days:'+days}:top3:snapshots`;
      const cached = cache.get(cacheKey);
      if (cached) return res.json(cached);
      const counter = new Map<string, number>();
      const catKey = category ? mapCategoryJaToKey(category) : null;
      const ymds: string[] = useRange && fromYmd && toYmdParam
        ? (() => { const out: string[]=[]; const y1=parseInt(fromYmd.slice(0,4),10); const m1=parseInt(fromYmd.slice(4,6),10)-1; const d1=parseInt(fromYmd.slice(6,8),10); const y2=parseInt(toYmdParam.slice(0,4),10); const m2=parseInt(toYmdParam.slice(4,6),10)-1; const d2=parseInt(toYmdParam.slice(6,8),10); const start=new Date(Date.UTC(y1,m1,d1)); const end=new Date(Date.UTC(y2,m2,d2)); for(let ts=start.getTime(); ts<=end.getTime(); ts+=24*60*60*1000){ const dd=new Date(ts); out.push(ymdString(dd)); } return out; })()
        : ymdRangeDays(days);
      for (const ymd of ymds) {
        const keys: Array<'open'|'senior'|'junior'> = catKey ? [catKey] : ['open','senior','junior'];
        for (const key of keys) {
          const ref = db.collection('daily-rankings-snapshots').doc(`${ymd}-${key}`);
          const snap = await ref.get();
          if (!snap.exists) continue;
          const rows = collectRowsFromSnapshotDoc(snap.data());
          for (const r of rows) {
            if (!r.rank || r.rank>3) continue;
            const name = r.deckName || '';
            if (!name) continue;
            counter.set(name, (counter.get(name)||0) + 1);
          }
        }
      }
      const sorted = Array.from(counter.entries()).map(([name,count])=>({ name, count })).sort((a,b)=> b.count - a.count);
      const total = sorted.reduce((a,b)=>a+b.count,0);
      // 上位 12 件のみに制限して返却します（UI の表示に合わせた件数）。
      const items = sorted.slice(0, 12);
      const payload = { ok:true, total, items, range: useRange ? { from: fromYmd, to: toYmdParam } : undefined };
      cache.set(cacheKey, payload);
      res.json(payload);
    } catch (e:any) {
      res.status(500).json({ ok:false, error: e.message || String(e) });
    }
  });

  /**
   * GET /api/deck-samples
   * 指定したデッキ名に一致するサンプル（rank <= 3）を返します。iOS の `ReferenceBuildsDetailView` で使用されます。
   * - name: 取得対象のデッキ名（必須）
   * - days 指定時: 直近 N 日の範囲。
   * - from/to 指定時: YYYYMMDD 範囲で 1 日刻みのスナップショットを走査。
   * - category 指定時: オープン/シニア/ジュニアをフィルタ。未指定なら全カテゴリを対象。
   * 返却項目には、画像 URL・リンク・主催者名など UI 表示に必要なフィールドを含みます。
   */
  app.get('/api/deck-samples', async (req: Request, res: Response) => {
    try {
      const name = ((req.query.name as string)||'').trim();
      if (!name) return res.status(400).json({ ok:false, error:'name required'});
      const days = Math.max(1, Math.min(parseInt(String(req.query.days||'14'),10) || 14, 60));
      const category = (req.query.category as string) || '';
      const fromYmd = (req.query.from as string) || null;
      const toYmdParam = (req.query.to as string) || null;
      const catKey = category ? mapCategoryJaToKey(category) : null;
      const ymds: string[] = (fromYmd && toYmdParam)
        ? (() => { const out: string[]=[]; const y1=parseInt(fromYmd.slice(0,4),10); const m1=parseInt(fromYmd.slice(4,6),10)-1; const d1=parseInt(fromYmd.slice(6,8),10); const y2=parseInt(toYmdParam.slice(0,4),10); const m2=parseInt(toYmdParam.slice(4,6),10)-1; const d2=parseInt(toYmdParam.slice(6,8),10); const start=new Date(Date.UTC(y1,m1,d1)); const end=new Date(Date.UTC(y2,m2,d2)); for(let ts=start.getTime(); ts<=end.getTime(); ts+=24*60*60*1000){ const dd=new Date(ts); out.push(ymdString(dd)); } return out; })()
        : ymdRangeDays(days);
      const out: any[] = [];
      for (const ymd of ymds) {
        const keys: Array<'open'|'senior'|'junior'> = catKey ? [catKey] : ['open','senior','junior'];
        for (const key of keys) {
          const ref = db.collection('daily-rankings-snapshots').doc(`${ymd}-${key}`);
          const snap = await ref.get();
          if (!snap.exists) continue;
          const doc = snap.data() as any;
          const dateMD = (typeof doc?.date==='string') ? doc.date : null;
          const rows = collectRowsFromSnapshotDoc(doc);
          for (const r of rows) {
            if (!r.rank || r.rank>3) continue;
            const dn = r.deckName || '';
            if (!dn || dn !== name) continue;
            out.push({
              deckName: dn,
              rank: r.rank || null,
              player: null,
              deckUrl: r.deckUrl || null,
              deckListImageUrl: r.deckListImageUrl || null,
              originalEventId: null,
              dateMD,
              organizer: r.organizer || null,
            });
          }
        }
      }
      return res.json({ ok:true, items: out });
    } catch (e:any) {
      res.status(500).json({ ok:false, error: e.message || String(e) });
    }
  });
}
