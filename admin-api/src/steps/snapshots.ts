/*
ファイル概要
— 目的: 指定日付のランキングをカテゴリ別（日次）に集約し、Firestore の daily-rankings-snapshots に保存する。
— 参照元: pokemon-events（対象日のイベント一覧）、pokemon-event-rankings（各イベントのランキング）
— 保存先: daily-rankings-snapshots（ドキュメントID: YYYYMMDD-category）

どの処理で使われるか
— 管理APIの自動実行フローから呼び出される（admin-api/server.ts の /pokemon-events/auto-run, /pokemon-events/auto-run/latest）。
— 生成したスナップショットは公開API側が読み取り、Web/iOS クライアントへ配信する（weekly/deck-distribution など）。

効果
— 公開APIが軽量スキーマを直接返せるため、応答が安定して高速になる。

出力仕様（要点）
— ドキュメントID: YYYYMMDD-open|senior|junior
— rankings: 表示に必要な最小フィールドのみ
— groups: organizer 単位での一覧（UI のグループ表示に利用）
— version: スキーマ互換性のための番号（公開APIと同期）
*/

import { getDb } from '../common/firebase.js';
import { formatJstNow } from '../common/time.js';
import { canonicalizeDeckThumbUrl, resolveDeckImageUrl } from '../common/deck.js';

type DailySnapshotDoc = {
  /** 対象日（M/D 形式）。例: "1/20"。クライアント表示用。 */
  date: string;
  /** 年月日（YYYYMMDD）。ドキュメントIDや検索のキー。 */
  ymd: string;
  category: 'open' | 'senior' | 'junior';
  /** 生成日時（ISO）。再生成や監査の指標。 */
  generatedAt: string;
  /** 表示に必要な最小フィールドのみを保持したランキング配列。 */
  rankings: Array<{ rank: number; deckId: string|null; deckUrl: string|null; deckName?: string|null; deckListImageUrl?: string|null; playerInfo?: string|null; points?: number|null; organizer?: string|null; originalEventId?: string|null; groupId?: string|null }>;
  /** organizer 単位のまとまり。UI でのグループ表示に利用。 */
  groups?: Array<{ organizer: string; rankings: Array<{ rank: number; deckId: string|null; deckUrl: string|null; deckName?: string|null; deckListImageUrl?: string|null; playerInfo?: string|null; points?: number|null; organizer?: string|null }> }>;
  /** スキーマ互換性管理用。公開APIと揃える。 */
  version: number;
};

/**
runDailyRankingSnapshots: 指定日付のカテゴリ別スナップショットを生成・保存する。

どの処理で使われるか
— 管理APIの自動実行ステップ（サーバー内の定期/手動実行）から呼び出される。
— 生成結果は公開APIが読み出し、Web/iOS へ提供される。

前提
— 指定日の pokemon-events が存在し、そのイベントに対する pokemon-event-rankings の作成が完了している。

引数
— dateYmd: 対象日（YYYYMMDD）
— force: 既存ドキュメントがあっても上書きする場合に true
— logs: 呼び出し元へ返す実行ログ配列

戻り値
— ok, targetDate（M/D）, ymd, results（カテゴリごとの件数/スキップ情報）, logs
*/
export async function runDailyRankingSnapshots(params: { dateYmd: string; force?: boolean; logs?: string[] }) {
  const { dateYmd, force, logs = [] } = params;
  const db = getDb();
  const ymd = dateYmd;
  // ステップ1: 表示用 M/D の組み立て（UI 表示向け）
  const targetMD = `${parseInt(ymd.slice(4,6),10)}/${parseInt(ymd.slice(6,8),10)}`;
  // ステップ2: カテゴリ定義（保存は英語キー、ランキング参照は日本語ラベル）
  const categories: Array<{ key: 'open'|'senior'|'junior'; ja: 'オープン'|'シニア'|'ジュニア' }> = [
    { key:'open', ja:'オープン' }, { key:'senior', ja:'シニア' }, { key:'junior', ja:'ジュニア' }
  ];
  // ステップ3: 対象日のイベントID一覧を取得 → ランキング抽出に使用
  const evCol = db.collection('pokemon-events');
  const evSnap = await evCol.where('dateYmd','==', ymd).get();
  const eventIds = evSnap.docs.map(d=>d.id);
  logs.push(`日次スナップショット: イベント数=${eventIds.length} 対象=${targetMD}`);
  const results: any[] = [];
  for (const cat of categories) {
    const docId = `${ymd}-${cat.key}`;
    const dailyRef = db.collection('daily-rankings-snapshots').doc(docId);
    const existing = await dailyRef.get();
    if (existing.exists && !force) {
      // 既存があり force=false の場合は再生成をスキップ（不要な書き換えを避ける）。
      logs.push(`日次スナップショット: 既存スキップ ${docId}`);
      results.push({ category: cat.key, skipped: true });
      continue;
    }
    const rankings: DailySnapshotDoc['rankings'] = [];
    // Firestore の `in` は最大10件: イベントIDを 10 件チャンクに分割してクエリ
    const chunkSize = 10; const chunks: string[][] = [];
    for (let i=0;i<eventIds.length;i+=chunkSize) chunks.push(eventIds.slice(i,i+chunkSize));
    for (const chunk of chunks) {
      if (chunk.length === 0) continue;
      const rSnap = await db.collection('pokemon-event-rankings')
        .where('originalEventId','in', chunk)
        .where('cityLeagueCategory','==', cat.ja)
        .get();
      for (const doc of rSnap.docs) {
        const d = doc.data() as any;
        const deckId: string | null = d.deckId || null;
        const deckUrl: string | null = deckId ? `https://www.pokemon-card.com/deck/confirm.html/deckID/${deckId}` : null;
        // 画像URLの正規生成: deckId → deckUrl → null の優先で算出
        const sourceUrl = deckUrl || (typeof d.deckUrl === 'string' ? d.deckUrl : null);
        const deckListImageUrl: string | null = sourceUrl ? (await resolveDeckImageUrl(sourceUrl)) : null;
        rankings.push({
          rank: d.rank,
          deckId,
          deckUrl,
          // `deckName` は空文字で保持（UI での扱いやすさを優先）
          deckName: (d.deckName ?? ''),
          deckListImageUrl,
          playerInfo: d.playerInfo || null,
          points: d.points || null,
          organizer: (d.organizer || null),
          originalEventId: (d.originalEventId || null)
        });
      }
    }
    // ランク昇順で整列（UI 表示/統計の前提）
    rankings.sort((a,b)=>a.rank-b.rank);
    // organizer ごとにグルーピング（公開APIのグループ表示で使用）
    const byOrg: Record<string, DailySnapshotDoc['rankings']> = {};
    for (const r of rankings) {
      const key = (r.organizer || '').trim();
      const org = key.length > 0 ? key : 'unknown';
      (byOrg[org] = byOrg[org] || []).push(r);
    }
    const groups = Object.entries(byOrg).map(([organizer, rows]) => ({ organizer, rankings: rows.sort((a,b)=>a.rank-b.rank) }));

    // groupId の生成: ymd + originalEventId + rank + 連番(00,01...)
    // 連番は (originalEventId, rank) 単位でインクリメント
    const counters = new Map<string, number>();
    for (const r of rankings) {
      const ev = (r.originalEventId || '').toString();
      const rk = Number(r.rank);
      const key = `${ev}#${rk}`;
      const n = (counters.get(key) || 0);
      counters.set(key, n + 1);
      const ord = String(n).padStart(2,'0');
      if (ev && (rk === 1 || rk === 2 || rk === 3)) {
        r.groupId = `${ymd}_${ev}_${rk}_${ord}`;
      } else {
        r.groupId = null;
      }
    }
    // groups 側にも groupId を反映（同一参照が多いが保険として）
    for (const g of groups) {
      for (const r of g.rankings) {
        if (!r.groupId) {
          const ev = (r.originalEventId || '').toString();
          const rk = Number(r.rank);
          if (ev && (rk === 1 || rk === 2 || rk === 3) && !r.groupId) {
            // 予備措置: 最小連番 00 を付与
            r.groupId = `${ymd}_${ev}_${rk}_00`;
          }
        }
      }
    }
    // ランキングが 0 件なら保存をスキップ（存在するカテゴリのみ作成）
    if (rankings.length === 0) {
      logs.push(`日次スナップショット: スキップ ${docId} rankings=0`);
      results.push({ category: cat.key, count: 0, skipped: true });
      continue;
    }
    const snapshot: DailySnapshotDoc = {
      date: targetMD,
      ymd,
      category: cat.key,
      generatedAt: new Date().toISOString(),
      rankings,
      groups,
      // スキーマバージョン（公開API実装と同期）
      version: 4
    };
    await dailyRef.set({ ...snapshot, updatedAt: formatJstNow() }, { merge: true });
    logs.push(`日次スナップショット: 保存 ${docId} rankings=${rankings.length}`);
    results.push({ category: cat.key, count: rankings.length });
  }
  return { ok: true, targetDate: targetMD, ymd, results, logs };
}
