// このファイルの役割
// ------------------------------------------------------------
// Firestore の特定コレクションを「安全にバッチ削除」するコマンド用ユーティリティです。
// 運用上の環境初期化・データリセット時に使用します。日次の自動処理や公開APIの通常動作には不要です。
//
// 実際に削除対象としているコレクション（2026-01-20 現在）:
// - daily-rankings-snapshots: 公開APIが参照する日次スナップショット
// - auto-run-executions      : 管理APIの自動実行（/pokemon-events/auto-run）の履歴/サマリ
// - pokemon-event-rankings   : ランキング収集ステップの保存先
// - pokemon-events           : イベント収集（Probe）ステップの保存先
//
// 実行方法（例）:
// - npm run purge:data
//   （admin-api/package.json の "purge:data" スクリプト経由で dist/src/purgeData.js を実行）
//
// 動作モード:
// - DRY_RUN=true を付けると削除せず、存在確認のためのサンプル件数のみをログ出力します。
//   例: DRY_RUN=true node dist/src/purgeData.js
//
// 前提となる初期化:
// - initFirebase() と getDb()（./common/firebase.js）を使い、Firebase/Firestore に接続します。
//   接続先プロジェクトは環境変数や設定ファイルに依存します。誤環境での実行に注意してください。
// ------------------------------------------------------------
import { initFirebase, getDb } from './common/firebase.js';
import { withFsRetry } from './common/retry.js';

// バッチ削除の共通処理
// ------------------------------------------------------------
// 目的: 指定コレクションの全ドキュメントを小さなバッチに分割して削除します。
// 使われ方: このファイル内の main() から、各コレクションに対して呼び出されます（CLIユーティリティ専用）。
// ポイント:
// - バッチサイズを絞って（既定 400件）削除し、負荷を分散します。
// - 各バッチ終了ごとに進捗を logs に追記します。
// - 全件がなくなるまで繰り返します。
async function deleteCollectionBatch(db: FirebaseFirestore.Firestore, collection: string, logs: string[], batchSize = 400) {
  const ref = db.collection(collection);
  let total = 0;
  while (true) {
    const snap = await ref.limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) { batch.delete(doc.ref); total++; }
    await batch.commit();
    logs.push(`${collection}: deleted batch (${snap.size}) cumulative=${total}`);
    // コミット間で短い待機を入れて、連続削除のスパイクを緩和します。
    await new Promise(r=>setTimeout(r,50));
  }
  return total;
}

// エントリポイント（CLI 実行用）
// ------------------------------------------------------------
// 目的: Firestore 接続の初期化、DRY_RUN モードの分岐、各コレクションの削除/確認をまとめて制御します。
// 使われ方: npm スクリプト "purge:data" から呼び出されます。定常運用フロー（/pokemon-events/auto-run）では使用しません。
// 出力: 進捗ログと削除件数を JSON で標準出力に返します（ログ採取やジョブ記録に利用できます）。
async function main() {
  const logs: string[] = [];
  const dryRun = process.env.DRY_RUN === 'true';
  initFirebase();
  const db = getDb();
  const collections = [
    'daily-rankings-snapshots',
    'auto-run-executions',
    'pokemon-event-rankings',
    'pokemon-events',
  ];
  if (dryRun) {
    // 削除は行わず、各コレクションの存在サンプルを取得してログ出力します。
    for (const c of collections) {
      const snap = await db.collection(c).limit(1).get();
      const countEstimate = snap.size === 0 ? 0 : '>=1';
      logs.push(`[DRY_RUN] ${c}: sample size=${countEstimate}`);
    }
    console.log(JSON.stringify({ ok:true, dryRun:true, logs }, null, 2));
    return;
  }
  const deleted: Record<string, number> = {};
  for (const c of collections) {
    // 実削除。バッチで繰り返し削除し、総削除件数を記録します。
    deleted[c] = await deleteCollectionBatch(db, c, logs);
  }
  console.log(JSON.stringify({ ok:true, deleted, logs }, null, 2));
}

// エラー時は非ゼロでプロセスを終了し、外部ジョブ管理から検知できるようにします。
main().catch(e => { console.error(e); process.exit(1); });
