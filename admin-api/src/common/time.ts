/**
 * JST（日本時間）で日時を分かりやすい文字列に変換します。
 * 形式: YYYY-MM-DD HH:mm:ss.SSS JST
 *
 * ポイント:
 * - PCのタイムゾーンに左右されないよう、UTCの値を使って「+9時間」だけ進めた日時から文字列を作っています。
 * - `getUTCFullYear()` などの「UTC版のゲッター」を使うことで、ズレを防ぎます。
 *
 * 主な使用箇所（この関数を直接 or 間接的に利用）:
 * - `formatJstNow()` を通じて、管理APIの実行履歴ドキュメントの `updatedAt` に使用
 *   - admin-api/server.ts の `writeExec()`（実行履歴の更新）
 *   - admin-api/src/steps/probe.ts の更新時刻
 *   - admin-api/src/steps/rankings.ts の更新時刻
 *   - admin-api/src/steps/snapshots.ts の更新時刻
 *
 * @param date 変換したい日時（Date）
 * @returns フォーマット済み文字列（例: "2025-12-31 23:59:59.123 JST"）
 */
export function formatJst(date: Date): string {
  const jstMs = date.getTime() + 9 * 60 * 60 * 1000; // JST = UTC+9（UTCから9時間進める）
  const jst = new Date(jstMs);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}.${pad(jst.getUTCMilliseconds(), 3)} JST`;
}

/**
 * 現在時刻を JST 文字列（YYYY-MM-DD HH:mm:ss.SSS JST）で返します。
 *
 * ポイント:
 * - 今の時刻（`new Date()`）を `formatJst()` に渡して、可読な日本時間の表記にしています。
 *
 * 主な使用箇所:
 * - 実行履歴の更新時刻（`updatedAt`）
 *   - admin-api/server.ts の `writeExec()`
 *   - admin-api/src/steps/probe.ts / rankings.ts / snapshots.ts で Firestore に保存する更新時刻
 */
export function formatJstNow(): string {
  return formatJst(new Date());
}

/**
 * JST（日本時間）で「IDや短いタイムスタンプ向け」のコンパクト文字列を作ります。
 * 形式: YYYYMMDD-HHmmss-SSS
 *
 * ポイント:
 * - 可読かつソートしやすい形式（年→月→日→時→分→秒→ミリ秒）で、ログやドキュメントIDに使いやすいです。
 *
 * 主な使用箇所:
 * - 実行履歴の開始/終了時刻（`startedAt` / `endedAt`）
 *   - admin-api/server.ts の `writeExec()` 内で記録
 * - 可読なIDを作りたいときの基礎関数（`formatJstCompactNow()` が即時生成）
 *
 * @param date 変換したい日時（Date）
 * @returns フォーマット済み文字列（例: "20251231-235959-123"）
 */
export function formatJstCompact(date: Date): string {
  const jstMs = date.getTime() + 9 * 60 * 60 * 1000; // JST = UTC+9（UTCから9時間進める）
  const jst = new Date(jstMs);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${jst.getUTCFullYear()}${pad(jst.getUTCMonth() + 1)}${pad(jst.getUTCDate())}-${pad(jst.getUTCHours())}${pad(jst.getUTCMinutes())}${pad(jst.getUTCSeconds())}-${pad(jst.getUTCMilliseconds(), 3)}`;
}

/**
 * 現在時刻を JST コンパクト文字列（YYYYMMDD-HHmmss-SSS）で返します。
 *
 * 主な使用箇所:
 * - 実行履歴の開始/終了時刻（`startedAt` / `endedAt`）
 *   - admin-api/server.ts の `writeExec()`
 */
export function formatJstCompactNow(): string {
  return formatJstCompact(new Date());
}

/**
 * 実行時間（ミリ秒）を日本語の読みやすい表記に整形します。
 * 例: "12秒" / "1分 23.954秒" / "2時間 03分 05.120秒"
 *
 * 初心者向けポイント:
 * - 大きな単位から順に分解（時間→分→秒→ミリ秒）して、見やすい文字列を作っています。
 * - マイナス値や数値でない場合は "0秒" を返して安全に扱います。
 *
 * 主な使用箇所:
 * - 管理APIの自動実行（/pokemon-events/auto-run）の実行履歴で処理時間を記録
 *   - admin-api/server.ts の `writeExec()`（`durationMs` / `duration` に同じ可読文字列を保存）
 *
 * @param ms ミリ秒（経過時間）
 * @returns 日本語の人間向け表記（例: "1分 02.500秒"）
 */
export function formatDurationHuman(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '0秒';
  const totalMs = Math.floor(ms);
  const totalSec = Math.floor(totalMs / 1000);
  const msRem = totalMs % 1000;
  const totalMin = Math.floor(totalSec / 60);
  const totalHour = Math.floor(totalMin / 60);
  const sec = totalSec % 60;
  const min = totalMin % 60;
  const msStr = String(msRem).padStart(3, '0');
  if (totalHour > 0) return `${totalHour}時間 ${String(min).padStart(2,'0')}分 ${String(sec).padStart(2,'0')}.${msStr}秒`;
  if (totalMin > 0) return `${totalMin}分 ${String(sec).padStart(2,'0')}.${msStr}秒`;
  return `${sec}.${msStr}秒`;
}
