import { db } from '../common/firebase.js';
import { MemoryCache } from '../common/cache.js';

/**
 * デッキ名のユニーク登場数を期間で集計するサービスモジュール。
 *
 * このモジュールは次の API ルートから呼び出されています:
 * - public-api/src/routes/weekly.ts: 週次の集計比較で使用
 * - public-api/src/routes/distinctDeckNames.ts: 指定期間のユニークなデッキ名一覧で使用
 *
 * Firestore コレクション "daily-rankings-snapshots" に日次スナップショットが保存されており、
 * ドキュメントIDは "YYYYMMDD-<categoryKey>" 形式です（例: 20250115-open）。
 * このサービスはそのスナップショット群から、期間内に登場したデッキ名のユニーク件数を数えます。
 */

/**
 * カテゴリ表記（日本語）を Firestore ドキュメントIDで使われるキーに変換します。
 * 入力例: "オープン" / "シニア" / "ジュニア"
 * 変換後: "open" / "senior" / "junior"
 */
function mapCategoryJaToKey(ja: string): 'open'|'senior'|'junior'|null {
  if (ja === 'オープン') return 'open';
  if (ja === 'シニア') return 'senior';
  if (ja === 'ジュニア') return 'junior';
  return null;
}

/**
 * 文字列形式の日付（YYYYMMDD）を UTC の Date に変換します。
 * スナップショットは UTC 基準で ID 付与されているため、日付計算のタイムゾーンを合わせます。
 */
function ymdToUTCDate(ymd: string): Date {
  const y = parseInt(ymd.slice(0,4),10);
  const m = parseInt(ymd.slice(4,6),10) - 1;
  const d = parseInt(ymd.slice(6,8),10);
  return new Date(Date.UTC(y, m, d));
}

/**
 * UTC の Date から Firestore ドキュメントIDで使う "YYYYMMDD" 文字列を生成します。
 */
function formatYmdUTC(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth()+1).padStart(2,'0');
  const d = String(dt.getUTCDate()).padStart(2,'0');
  return `${y}${m}${d}`;
}

// メモリキャッシュ（300秒保持）: 同じ条件での繰り返し集計を高速化します。
const cache = new MemoryCache<any>(300);

export async function countDistinctDeckNamesBySnapshots(params: { fromYmd: string; toYmd: string; category?: string | null }): Promise<{ items: Array<{ name: string; count: number }> }> {
  // 入力: fromYmd/toYmd は "YYYYMMDD"。category は日本語表記（空文字や null の場合は全カテゴリ対象）。
  // 出力: items は { name: デッキ名, count: 期間内登場回数 } の配列（count の降順）。
  const { fromYmd, toYmd } = params;
  const category = (params.category || '').trim();
  const cacheKey = `distinct:${category || 'all'}:${fromYmd}-${toYmd}`;
  const hit = cache.get(cacheKey); if (hit) return hit;

  // 対象カテゴリキーを決定。category が未指定の場合は全カテゴリ（open/senior/junior）。
  const keys: Array<'open'|'senior'|'junior'> = (() => {
    if (!category) return ['open','senior','junior'];
    const k = mapCategoryJaToKey(category);
    return k ? [k] : ['open','senior','junior'];
  })();

  // 期間の開始・終了を UTC Date に変換。
  const start = ymdToUTCDate(fromYmd);
  const end = ymdToUTCDate(toYmd);
  // デッキ名の登場回数を数えるためのカウンタ。
  const counter = new Map<string, number>();

  // 期間内の日付を 1 日刻みで走査し、各カテゴリのスナップショットを参照します。
  for (let ts = start.getTime(); ts <= end.getTime(); ts += 24*60*60*1000) {
    const dd = new Date(ts);
    const ymd = formatYmdUTC(dd);
    for (const key of keys) {
      // Firestore の日次スナップショット: コレクション "daily-rankings-snapshots"
      // ドキュメントIDは "YYYYMMDD-<categoryKey>"（例: 20250115-open）。
      const ref = db.collection('daily-rankings-snapshots').doc(`${ymd}-${key}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const data = snap.data() as any;
      // スナップショットの構造: 直接のランキング配列 "rankings" と、グループ内ランキング "groups[].rankings"。
      const rows: Array<any> = Array.isArray(data?.rankings) ? data.rankings : [];
      const groups: Array<any> = Array.isArray(data?.groups) ? data.groups : [];
      // 注意: groups がある場合は groups を優先し、rankings と二重に合算しない（重複計上防止）。
      const merged = (groups.length > 0)
        ? groups.flatMap(g => Array.isArray(g.rankings) ? g.rankings : [])
        : rows;
      for (const r of merged) {
        // ランキング要素からデッキ名を抽出し、空文字でなければカウンタを加算。
        const dn = (typeof r.deckName==='string') ? r.deckName.trim() : '';
        if (!dn) continue;
        counter.set(dn, (counter.get(dn)||0) + 1);
      }
    }
  }

  // Map を配列に変換し、登場回数の降順で整列して返却します。
  const items = Array.from(counter.entries()).map(([name,count])=>({ name, count })).sort((a,b)=> b.count - a.count);
  const payload = { items };
  // 成果をキャッシュして同条件の再計算を短縮。
  cache.set(cacheKey, payload);
  return payload;
}
