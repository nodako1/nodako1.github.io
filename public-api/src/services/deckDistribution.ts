/*
  モジュールの役割
  - Firestore の日次スナップショット（daily-rankings-snapshots）を集計し、
    指定期間・カテゴリにおける上位ランク（例: 1〜3位）のデッキ分布を算出します。

  利用箇所（どの処理で使われるか）
  - [public-api/src/routes/weekly.ts](public-api/src/routes/weekly.ts) の `/api/weekly/deck-distribution` ルートから呼び出され、
    「今週」「先週」の分布結果をレスポンスとして返すために使用されます。

  データソース
  - Firestore コレクション: daily-rankings-snapshots
    ドキュメントIDは `YYYYMMDD-<category>`（category は open/senior/junior）形式。
    ドキュメント内の `rankings` と `groups[*].rankings` を突き合わせて上位ランクをカウントします。

  キャッシュ
  - プロセス内メモリキャッシュ（TTL 300秒）で同一条件の再計算を抑止します。
    Cloud Run 等のスケールアウト環境ではインスタンス間共有はありません（一般的な注意点）。
*/
import { db } from '../common/firebase.js';
import { MemoryCache } from '../common/cache.js';

// 日本語カテゴリ名を内部キー（open/senior/junior）へ変換します。
// 週次ルートのクエリ `?category=オープン|シニア|ジュニア` から渡される値を正規化するために使用。
function mapCategoryJaToKey(ja: string): 'open'|'senior'|'junior'|null {
  if (ja === 'オープン') return 'open';
  if (ja === 'シニア') return 'senior';
  if (ja === 'ジュニア') return 'junior';
  return null;
}

// 文字列 YYYYMMDD を UTC 基準の Date に変換します。
// Firestore のドキュメントID（YYYYMMDD-...）を日付範囲で横断するために使用。
function ymdToUTCDate(ymd: string): Date {
  const y = parseInt(ymd.slice(0,4),10);
  const m = parseInt(ymd.slice(4,6),10) - 1;
  const d = parseInt(ymd.slice(6,8),10);
  return new Date(Date.UTC(y, m, d));
}

// Date を YYYYMMDD（UTC）形式へ整形します。
// 期間ループの中でドキュメントIDを組み立てるために使用。
function formatYmdUTC(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth()+1).padStart(2,'0');
  const d = String(dt.getUTCDate()).padStart(2,'0');
  return `${y}${m}${d}`;
}

// 同一条件の再計算を抑止するための簡易メモリキャッシュ（TTL=300秒）。
const cache = new MemoryCache<any>(300);

// 指定期間（fromYmd〜toYmd）・カテゴリ・対象ランクに基づき、
// デッキ名ごとの出現回数を集計して返します。
// 利用箇所: [public-api/src/routes/weekly.ts](public-api/src/routes/weekly.ts) の
// `/api/weekly/deck-distribution` ハンドラから直接呼び出されます。
export async function countDeckDistributionBySnapshots(params: { fromYmd: string; toYmd: string; category?: string | null; topRanks?: number[] }): Promise<{ items: Array<{ name: string; count: number }>; total: number }>{
  const { fromYmd, toYmd } = params;
  const category = (params.category || '').trim();
  const topRanks = (params.topRanks && params.topRanks.length>0) ? params.topRanks : [1,2,3];
  const rankSet = new Set(topRanks);
  // キャッシュキーを（カテゴリ・期間・対象ランク）で構築。
  const cacheKey = `weekly-dist:${category || 'all'}:${fromYmd}-${toYmd}:top=${[...rankSet].join(',')}`;
  const hit = cache.get(cacheKey); if (hit) return hit;
  // カテゴリ未指定なら open/senior/junior の全てを対象。
  const keys: Array<'open'|'senior'|'junior'> = (() => {
    if (!category) return ['open','senior','junior'];
    const k = mapCategoryJaToKey(category);
    return k ? [k] : ['open','senior','junior'];
  })();

  // 期間（両端を含む）を 1 日刻みでループしてスナップショットを取得。
  const start = ymdToUTCDate(fromYmd);
  const end = ymdToUTCDate(toYmd);
  const counter = new Map<string, number>();

  for (let ts = start.getTime(); ts <= end.getTime(); ts += 24*60*60*1000) {
    const dd = new Date(ts);
    const ymd = formatYmdUTC(dd);
    for (const key of keys) {
      // ドキュメントID: YYYYMMDD-<category>
      const ref = db.collection('daily-rankings-snapshots').doc(`${ymd}-${key}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const data = snap.data() as any;
      // groups が存在する場合は groups を優先し、rankings と二重に合算しない（重複防止）。
      const rows: Array<any> = Array.isArray(data?.rankings) ? data.rankings : [];
      const groups: Array<any> = Array.isArray(data?.groups) ? data.groups : [];
      const merged = (groups.length > 0)
        ? groups.flatMap(g => Array.isArray(g.rankings)? g.rankings: [])
        : rows;
      for (const r of merged) {
        // ランクが対象（rankSet）かつデッキ名が有効ならカウントを加算。
        const rank = (typeof r.rank==='number') ? r.rank : parseInt(String(r.rank||''),10);
        const dn = (typeof r.deckName==='string') ? r.deckName.trim() : '';
        if (!dn || !Number.isFinite(rank) || !rankSet.has(rank)) continue;
        counter.set(dn, (counter.get(dn)||0) + 1);
      }
    }
  }

  // 出現回数の降順で並べ替え、合計も算出して返却。
  const items = Array.from(counter.entries()).map(([name,count])=>({ name, count })).sort((a,b)=> b.count - a.count);
  const total = items.reduce((a,b)=> a + b.count, 0);
  const payload = { items, total };
  cache.set(cacheKey, payload);
  return payload;
}
