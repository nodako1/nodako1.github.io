// メモリキャッシュの小さなユーティリティ。
// 目的: リクエスト間で一定期間データを再利用して、外部 API や DB への問い合わせ回数とレスポンス時間を減らします。
// 仕組み: プロセス内の Map に値と有効期限を保持し、期限を過ぎたエントリは自動的に無効化（取得時に削除）します。
// 注意: 各サーバーインスタンスごとのキャッシュです。Cloud Run などスケールアウト環境ではインスタンス間で共有されず、再起動で中身は消えます。
// 主な利用箇所（public-api のルート層）:
// - routes/dailySnapshot.ts: 日次スナップショットの応答を短時間キャッシュし、再計算を抑止します。
// - routes/weekly.ts: 週次集計の結果をキャッシュして、繰り返しアクセス時の負荷を低減します。
// - routes/deckDistribution.ts: デッキ分布の API 応答をキャッシュします。
// - routes/distinctDeckNames.ts: デッキ名一覧取得をキャッシュします。
// - routes/youtube.ts: 環境動画一覧の外部 API 呼び出し結果をキャッシュします。
// これらのルートでは `import { MemoryCache } from '../common/cache.js'` で読み込み、用途に応じて TTL（有効期限）を秒単位で設定しています。

// 保存する値のラッパー。値と有効期限（UNIX エポックミリ秒）を持ちます。
type CacheValue<T> = { value: T; expiresAt: number };

// 型 T の値をキー文字列で保存/取得する汎用キャッシュ。
// インターフェースは最小限（get/set）。キャッシュミス時の再取得や再計算は呼び出し側で行います。
export class MemoryCache<T> {
  // TTL（有効期限）をミリ秒で保持します。安全策として最低 1 秒に丸めます。
  private ttlMs: number;
  // 実体となるマップ。キーに対して値と期限を保存します。
  private map = new Map<string, CacheValue<T>>();

  // ttlSeconds: 値の有効期限（秒）。0 や負の値でも最低 1 秒になるように丸めます。
  constructor(ttlSeconds: number) {
    this.ttlMs = Math.max(1000, ttlSeconds * 1000);
  }

  // キャッシュから値を取得します。
  // - 未登録の場合は null。
  // - 期限切れの場合はエントリを削除して null。
  // - 有効な場合は保存された値を返します。
  get(key: string): T | null {
    const v = this.map.get(key);
    if (!v) return null;
    if (Date.now() > v.expiresAt) { this.map.delete(key); return null; }
    return v.value;
  }

  // キャッシュへ値を保存します。現在時刻 + TTL を期限として記録します。
  set(key: string, value: T) {
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
