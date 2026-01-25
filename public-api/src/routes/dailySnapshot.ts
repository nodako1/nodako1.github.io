import type { Express, Request, Response } from 'express';
import { db } from '../common/firebase.js';
import { MemoryCache } from '../common/cache.js';
/*
  日次スナップショットの公開APIルート。

  このエンドポイントはクライアントアプリから利用されています。
  - 参照: [ios/Services/ApiClient.swift](ios/Services/ApiClient.swift#L263) の `GET "/api/daily-snapshot"`

  目的:
  - 指定した日付 (`YYYYMMDD`) とカテゴリ（オープン/シニア/ジュニア）の
    「イベント一覧」と「ランキング」をまとめて返します。
  - Firestore に管理側で事前生成されたスナップショットを読み、公開用の形へ整形します。

  入力:
  - `query.date`: 8桁日付 `YYYYMMDD`（必須）
  - `query.category`: 'オープン' | 'シニア' | 'ジュニア'（必須）

  出力の主なフィールド:
  - `events`: その日のカテゴリ全体を表す擬似イベント（UI表示用）
  - `rankingsByVenue`: 会場（organizer）単位のランキング配列
  - 将来拡張フィールド（`deckDistribution14d` など）は現時点では `null` を返します。

  データソース:
  - Firestore コレクション `daily-rankings-snapshots` のドキュメント `{YYYYMMDD}-{open|senior|junior}`

  キャッシュ:
  - メモリキャッシュで同一キーのレスポンスを一定時間再利用します。
  - TTL は環境変数 `DAILY_SNAPSHOT_TTL_SEC`（既定 300 秒）で変更可能。
*/
/**
 * Express アプリに日次スナップショットのルートを登録します。
 * アプリ起動時に呼び出され、`GET /api/daily-snapshot` が有効になります。
 */
export function attachDailySnapshotRoutes(app: Express) {
  /*
    管理用の順位値を公開表示用へ変換します。
    - 管理APIの rank: 1,2,3,5,9
    - 公開表示の rank: 1,2,4,8,16
    公開画面の見せ方に合わせるための変換です。
  */
  const toPublicRank = (adminRank: any): number | null => {
    const r = typeof adminRank === 'number' ? adminRank : parseInt(String(adminRank||''),10);
    if (!Number.isFinite(r)) return null;
    if (r === 1) return 1; if (r === 2) return 2; if (r === 3) return 4; if (r === 5) return 8; if (r === 9) return 16;
    return null;
  };
  /*
    メモリキャッシュの設定。
    - 同じ日付・カテゴリのリクエストが短時間に繰り返される場合、
      Firestore への読み取りを減らして応答を高速化します。
    - TTL は環境変数で可変（既定 300 秒）。
  */
  const ttl = parseInt(process.env.DAILY_SNAPSHOT_TTL_SEC || '300', 10) || 300;
  const cache = new MemoryCache<any>(ttl);
  /*
    指定された日付・カテゴリのスナップショットを構築して返します。
    - まずメモリキャッシュを確認し、命中すれば Firestore を読まずに返します。
    - 未命中の場合のみ Firestore を参照し、公開用の形へ整形します。
    この処理は `GET /api/daily-snapshot` ルートから利用されます。
  */
  async function buildSnapshot(dateYmd: string, categoryJa: string): Promise<any> {
    const cacheKey = `daily:${categoryJa}:${dateYmd}`;
    const hit = cache.get(cacheKey);
    if (hit) return hit;

    // 日本語カテゴリを Firestore ドキュメントIDに用いる英語キーへ変換
    const mapJaToKey = (ja: string): 'open'|'senior'|'junior'|null => {
      if (ja === 'オープン') return 'open'; if (ja === 'シニア') return 'senior'; if (ja === 'ジュニア') return 'junior'; return null;
    };
    const key = mapJaToKey(categoryJa);
    if (!key) throw new Error('unsupported category');

    const docId = `${dateYmd}-${key}`;
    const ref = db.collection('daily-rankings-snapshots').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('snapshot not found');
    const data = snap.data() as any;
    /*
      公開側 UI に合わせて「1日のカテゴリ全体」を1件の擬似イベントとして返します。
      - タイトルや詳細URLが無い場合でも、日付とカテゴリで一覧表示できるようにするため。
    */
    const md = `${parseInt(dateYmd.slice(4,6),10)}/${parseInt(dateYmd.slice(6,8),10)}`;
    const eventId = `snapshot-${dateYmd}-${key}`;
    const events = [
      { id: eventId, originalEventId: eventId, title: null, location: null, date: data?.date || md, detailUrl: null, cityLeagueCategory: categoryJa }
    ];
    /*
      会場（organizer）単位のランキング配列を構築します。
      - `groups` が存在する場合はそれを優先して使用します。
      - 無い場合は平坦な `rankings` を organizer でグルーピングして会場別に整形します。
      - 各行では公開用 rank と各種URL/文字列の有無を整えます。
    */
    const buildRow = async (r: any) => {
      const deckUrl = (typeof r.deckUrl === 'string' && r.deckUrl.length > 0) ? r.deckUrl : null;
      return {
        rank: toPublicRank(r.rank),
        player: r.playerInfo || null,
        deckUrl,
        deckListImageUrl: (typeof r.deckListImageUrl === 'string' && r.deckListImageUrl.length > 0) ? r.deckListImageUrl : null,
        organizer: (typeof r.organizer === 'string' && r.organizer.length > 0) ? r.organizer : null,
        deckName: (typeof r.deckName === 'string') ? r.deckName : '',
      };
    };
    let rankingsByVenue: Record<string, any[]> = {};
    if (Array.isArray(data?.groups) && data.groups.length > 0) {
      for (const g of data.groups) {
        const name = (g.organizer || 'unknown');
        const rows = Array.isArray(g.rankings) ? g.rankings : [];
        const shaped = await Promise.all(rows.map(buildRow));
        rankingsByVenue[name] = shaped;
      }
    } else {
      const rowsRaw: Array<any> = Array.isArray(data?.rankings) ? data.rankings : [];
      const byOrg: Record<string, any[]> = {};
      for (const r of rowsRaw) {
        const name = ((r?.organizer || '').trim() || 'unknown');
        (byOrg[name] = byOrg[name] || []).push(r);
      }
      for (const [name, arr] of Object.entries(byOrg)) {
        rankingsByVenue[name] = await Promise.all(arr.sort((a:any,b:any)=>a.rank-b.rank).map(buildRow));
      }
    }

    const payload = {
      ok: true,
      date: dateYmd,
      category: categoryJa,
      generatedAt: data?.generatedAt || new Date().toISOString(),
      events,
      rankingsByVenue,
      deckDistribution14d: null,
      distinctDeckNamesWeek: null,
      weeklyDeckDistribution: null,
    };
    cache.set(cacheKey, payload);
    return payload;
  }
  /*
    ルート定義: GET /api/daily-snapshot
    - バリデーション: `date` は 8桁 (YYYYMMDD)。カテゴリは 'オープン' | 'シニア' | 'ジュニア'。
    - 正常系: `buildSnapshot` の結果を返却します。
    - 異常系: スナップショット未生成/カテゴリ不正は 404、その他は 500。
    - 利用箇所: iOS クライアントの API 呼び出し（上記 ApiClient を参照）。
  */
  app.get('/api/daily-snapshot', async (req: Request, res: Response) => {
    try {
      const dateYmd = (req.query.date as string) || '';
      const category = (req.query.category as string) || '';
      if (!dateYmd || dateYmd.length !== 8) {
        return res.status(400).json({ ok:false, error:'date (YYYYMMDD) required' });
      }
      const payload = await buildSnapshot(dateYmd, category);
      res.json(payload);
    } catch(e:any) {
      const msg = e?.message || String(e);
      if (msg.includes('snapshot not found') || msg.includes('unsupported category')) {
        return res.status(404).json({ ok:false, error: msg });
      }
      res.status(500).json({ ok:false, error: msg });
    }
  });

  
}
