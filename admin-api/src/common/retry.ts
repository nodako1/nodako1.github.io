/*
説明: リトライ処理（再試行）をまとめた共通ヘルパーです。

概要:
- ネットワークや Firestore の「一時的な失敗（通信切断・タイムアウトなど）」に対して、一定回数まで自動で再試行します。
- 待機時間は失敗のたびに伸びる「指数バックオフ」を採用しています（1秒 → 2秒 → 4秒 → 8秒 → 最大16秒）。

どの処理で使われているか（主な呼び出し元）:
- Step1 「probe.ts」: Firestore 検索やバッチ書き込みで `withFsRetry` を使用し、保存処理を安定化。
- Step2 「rankings.ts」: 取得したランキングのバッチ保存/イベント更新で `withFsRetry` を使用。
- 「notify.ts」: 対象日のイベント/ランキング件数を集計するクエリで `withFsRetry` を使用。

使い分け:
- `withRetry`: 一般用途のリトライ。外部API呼び出しやネットワーク処理などに幅広く使えます。
- `withFsRetry`: Firestore 専用のリトライ。再試行すべき一時エラーだけを判定しつつリトライします。
- `isRetryableFirestoreError`: Firestore のエラーが「再試行すべき一時的なもの」かどうかを判定します。
*/

/**
 * 何をする: 任意の非同期関数 `fn` を最大 `maxRetry` 回まで再試行します（一般用途）。
 * 主な利用例: Playwright 経由のネットワークアクセスや、外部API呼び出しなどの一時的失敗に対処。
 * 引数の意味:
 * - fn: 実行したい非同期処理（Promise を返す関数）
 * - maxRetry: 再試行の最大回数（0なら一度のみ、1なら最大2回など）
 * - logs: 実行ログを書き込む文字列配列（呼び出し元で収集・表示に使用）
 * - label: ログ出力時の識別ラベル（どの処理か分かるように）
 * 動作の流れ:
 * - 失敗するたびに待機時間を指数的に増やしてから再試行します（最大16秒）。
 * - 全て失敗した場合は最後に受け取ったエラーをそのまま投げます。
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetry: number, logs: string[], label: string): Promise<T> {
  let lastErr: any = null;
  for (let i = 0; i <= maxRetry; i++) {
    try {
      // 成功したら即返却
      return await fn();
    } catch (e: any) {
      // 失敗時: 待機時間を指数バックオフで計算（最大 16,000ms）
      lastErr = e;
      const wait = Math.min(16000, 1000 * Math.pow(2, i));
      // どの試行で失敗したか・次の試行までの待機時間をログへ
      logs.push(`${label}: retry ${i+1}/${maxRetry+1} after ${wait}ms: ${e.message || e}`);
      // 指定時間だけ待ってから次の試行へ
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr || new Error(label);
}

/**
 * 何をする: Firestore のエラーが「再試行すべき一時的なもの」かどうかを判定します。
 * 判定基準の例:
 * - 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'ETIMEDOUT' といったキーワード
 * - HTTP ステータス 503/504 相当
 * どこで使うか: `withFsRetry` の中から呼ばれ、リトライ可否の判断に使用されます。
 */
export function isRetryableFirestoreError(e: any): boolean {
  const code = (e && (e.code || e.status || e.statusCode)) as any;
  const msg = (e && (e.message || String(e))) as string;
  const codeStr = typeof code === 'string' ? code.toLowerCase() : String(code || '').toLowerCase();
  if (codeStr.includes('unavailable') || codeStr.includes('deadline') || codeStr === '503' || codeStr === '504' || codeStr.includes('etimedout')) return true;
  if (!codeStr && msg) {
    const m = msg.toUpperCase();
    if (m.includes('UNAVAILABLE') || m.includes('DEADLINE_EXCEEDED') || m.includes('ETIMEDOUT')) return true;
  }
  return false;
}

/**
 * Firestore 専用のリトライヘルパー。
 * ポイント:
 * - `isRetryableFirestoreError(e)` が true の場合のみ再試行します（非リトライ系のエラーはすぐに投げます）。
 * - 待機は指数バックオフ（最大 16 秒）。
 * どこで使われているか:
 * - Step1: `src/steps/probe.ts` のクエリ/バッチコミット
 * - Step2: `src/steps/rankings.ts` のランキング保存/イベント更新
 * - 集計: `src/steps/notify.ts` の件数集計クエリ
 * 引数の意味:
 * - fn: 実行したい Firestore 操作（Promise を返す関数）
 * - logs: ログ配列（進捗や失敗理由の記録に使用）
 * - label: ログ識別ラベル（処理内容が分かるように）
 * - maxRetry: 最大再試行回数（デフォルト 4 → 最大 5 回試行）
 */
export async function withFsRetry<T>(fn: () => Promise<T>, logs: string[] = [], label: string, maxRetry = 4): Promise<T> {
  let lastErr: any = null;
  for (let i = 0; i <= maxRetry; i++) {
    try {
      // 成功したら即返却
      return await fn();
    } catch (e: any) {
      // 失敗時: リトライ可能な Firestore エラーかを判定
      lastErr = e;
      if (!isRetryableFirestoreError(e) || i === maxRetry) {
        // 非リトライ系、または最後の試行なら即座にエラーを投げる
        logs.push(`${label}: no-retry (${i}/${maxRetry}) -> ${e.message || e}`);
        throw e;
      }
      // リトライ可能: 待機時間を指数バックオフで計算して次の試行へ
      const wait = Math.min(16000, 1000 * Math.pow(2, i));
      logs.push(`${label}: fs-retry ${i+1}/${maxRetry+1} after ${wait}ms: ${e.message || e}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr || new Error(label);
}
