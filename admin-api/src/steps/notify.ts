/*
概要:
このモジュールは、指定日の「シティリーグ」イベントとそのランキングを集計し、Slack通知用のサマリを作るための数値を返します。

使用箇所:
- 管理APIの自動実行フロー Step 4（Slack通知）で使用されます。
  実装は admin-api/server.ts の `/pokemon-events/auto-run` ハンドラ内で `collectSummaryCounts()` を呼び出しています。

主な集計内容:
- 対象日のイベント件数（合計とカテゴリ別: オープン/シニア/ジュニア）
- ランキング件数（合計とカテゴリ別）
- デッキURLやデッキIDがあるランキング件数（画像化対象）
- 上記のうち画像保存済みのランキング件数

入出力:
- 入力: `dateYmd` は `YYYYMMDD` 形式の文字列（例: "20250101"）。`logs` は再試行や処理の進捗を残すための文字列配列。
- 出力: `SummaryCounts` 型で各種集計結果を返却。Slack本文の作成にそのまま利用できます。

データソース:
- Firestore の `pokemon-events`（イベント） と `pokemon-event-rankings`（ランキング）を参照します。
- イベントは `dateYmd` で対象日を絞り込み、`leagueType` が "シティ"/"city" のみを対象にします。

注意点:
- Firestore クエリの `in` 句制限回避のため、イベントIDは 10 件ずつのチャンクに分けてランキングを取得します。
- Firestore の一時的な失敗に備えて `withFsRetry` を使って再試行します（ログに実行内容を追記します）。
*/
import { getDb } from '../common/firebase.js';
import { withFsRetry } from '../common/retry.js';

export type SummaryCounts = {
  eventsTotal: number;
  eventsByCategory: Record<string, number> & { total: number };
  rankingsTotal: number;
  rankingsByCategory: Record<string, number> & { total: number };
  deckableRankings: number;
  imageStored: number;
};

// Slack 通知本文生成の前段で呼び出し、対象日の集計を返します。
// server.ts の自動実行フロー（Step 4: Slack通知）から直接利用されます。
export async function collectSummaryCounts(dateYmd: string, logs: string[] = []): Promise<SummaryCounts> {
  const db = getDb();
  const evRef = db.collection('pokemon-events');
  const rRef = db.collection('pokemon-event-rankings');

  // 1) 対象日のイベントを取得（dateYmd で絞り込み）
  //    「シティリーグ」のみ対象。これは Slack の日次サマリに合わせた範囲です。
  const evSnap = await withFsRetry(() => evRef.where('dateYmd','==', dateYmd).get(), logs, '通知集計: 対象日イベント取得');
  const events = evSnap.docs
    .map(d => ({ id: d.id, data: d.data() as any }))
    .filter(x => (x.data.leagueType === 'シティ' || x.data.leagueType === 'city'));

  // 2) イベントカテゴリ内訳を集計
  //    `cityLeagueCategory` は収集（Probe）時に付与されたカテゴリで、Slack本文にそのまま反映されます。
  const eventsByCategory: Record<string, number> = { 'オープン':0,'シニア':0,'ジュニア':0,'unknown':0 };
  for (const e of events) {
    const cat = (e.data.cityLeagueCategory as string) || 'unknown';
    eventsByCategory[cat] = (eventsByCategory[cat] || 0) + 1;
  }
  const eventsTotal = Object.values(eventsByCategory).reduce((a,b)=>a+b,0);

  // 3) ランキング集計のため、イベントID一覧を作成
  const ids = events.map(e => e.id);
  const chunks = <T,>(arr: T[], size: number) => { const out: T[][] = []; for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; };

  // 4) ランキングのカテゴリ別件数、および画像関連の件数を集計
  //    `deckUrl`/`deckId` が存在するランキングを「画像化対象」とみなし、さらに `imageStored=true` の件数を数えます。
  const rankingsByCategory: Record<string, number> = { 'オープン':0,'シニア':0,'ジュニア':0,'unknown':0 };
  let deckableRankings = 0, imageStored = 0, rankingsTotal = 0;
  for (const group of chunks(ids, 10)) {
    if (group.length === 0) continue;
    const snap = await withFsRetry(() => rRef.where('originalEventId','in', group).get(), logs, '通知集計: ランキング取得チャンク');
    for (const d of snap.docs) {
      const data = d.data() as any;
      rankingsTotal++;
      const cat = (data.cityLeagueCategory as string) || 'unknown';
      rankingsByCategory[cat] = (rankingsByCategory[cat] || 0) + 1;
      const deckable = !!data.deckUrl || !!data.deckId;
      if (deckable) deckableRankings++;
      if (deckable && data.imageStored === true) imageStored++;
    }
  }

  // 5) まとめを返す（Slack本文生成でそのまま使用可能な形）
  return {
    eventsTotal,
    eventsByCategory: { ...eventsByCategory, total: eventsTotal },
    rankingsTotal,
    rankingsByCategory: { ...rankingsByCategory, total: rankingsTotal },
    deckableRankings,
    imageStored,
  };
}
