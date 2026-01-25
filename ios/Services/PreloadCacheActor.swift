import Foundation

// 目的: 画面表示前に取得したデータを一時的に保存し、
//      画面側の初回ロードでネットワーク通信や重複処理を減らすための汎用キャッシュ。
// 特徴: Swift の `actor` により並行処理でも安全に読み書きできます。
// 型: Key は同一データを識別するキー（Hashable & Sendable）、Value は保持する値（Sendable）。
// 主な利用箇所:
// - DayDataPreloader（ios/Services/PreloadStore.swift）: 指定日・カテゴリのスナップショットを先読みして保持。
// - DeckDistributionPreloadStore（ios/Services/DeckDistributionPreloadStore.swift）: 週単位の分布データを保持。
// これらの処理では、画面（例: DaySummaryView や DeckDistributionView）が表示される際に
// まず本キャッシュを参照し、存在すれば API 呼び出しを省略または遅延させます。
actor PreloadCacheActor<Key: Hashable & Sendable, Value: Sendable> {
    // 内部ストア: Key ごとに Value を保持します。
    private var store: [Key: Value] = [:]

    // 値の登録: 先読みや取得完了時に呼び出してキャッシュへ保存します。
    // 例: DayDataPreloader.preload(...) の完了時、DeckDistributionPreloadStore.put(...) の完了時。
    func put(_ key: Key, _ value: Value) {
        store[key] = value
    }

    // 値の参照: 画面ロード時のフォールバックで使用します（内容は保持されたまま）。
    // 例: DayDataPreloader から get(...) を呼び出し、存在すればネットワーク取得をスキップ。
    func get(_ key: Key) -> Value? {
        return store[key]
    }

    // 値の取り出しと同時削除: 「一度きりの先読み」を実現したいケースで使用します。
    // 例: 表示直前に take(...) で受け取り、以降の重複利用を避けたいとき。
    func take(_ key: Key) -> Value? {
        let v = store[key]
        store[key] = nil
        return v
    }
}
