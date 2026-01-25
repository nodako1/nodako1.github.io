/**
 * 設定値をまとめるモジュール。
 *
 * このファイルは Admin API の起動時と各 API ハンドラ内部で参照され、
 * スクレイパー機能の有効・無効を一箇所で制御します。
 *
 * 主な利用箇所:
 * - server.ts: 受信したリクエストがスクレイパー機能を使う場合に、
 *   このフラグを見て 503 を返すか処理続行するかを判断します。
 *   例: 自動収集エンドポイントや手動実行用エンドポイントのガード。
 *
 * 値の設定方法:
 * - 環境変数 `SCRAPER_ENABLED` に文字列 'true' または 'false' を設定します。
 *   未設定の場合は既定で true (有効) になります。
 * - ローカル起動例: タスクや npm start の前に `SCRAPER_ENABLED=true` を付与。
 *   例: Admin API の起動タスクは `SCRAPER_ENABLED=true` を付けて起動します。
 * - 本番/Cloud Run でも同様に環境変数で制御できます。
 */
export const SCRAPER_ENABLED: boolean = process.env.SCRAPER_ENABLED
	? (process.env.SCRAPER_ENABLED === 'true')
	: true;
