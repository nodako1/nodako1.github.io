import Foundation

// この Actor は「日次スナップショット（DailySnapshotResponse）」をアプリ起動中のみメモリに保持します。
// 主な目的は、同じ日付・同じカテゴリのスナップショットを短時間に何度も再取得しないことです。
// 利用箇所（例）:
// - DeckDistributionView の load()：今日のスナップショットから週分布を優先的に表示する際の再取得抑制
// - ReferenceBuildsView の load()：distinct なデッキ名一覧をスナップショットから得る際の再取得抑制
// 保持期間は TTL（有効時間）内のみで、永続化は行いません（アプリを終了すると消えます）。
actor DailySnapshotStore {
    static let shared = DailySnapshotStore()

    struct Key: Hashable {
        let dateYmd: String
        let category: String
    }

    // 実体のメモリキャッシュ。キーは (dateYmd, category) の組み合わせです。
    private var store: [Key: DailySnapshotResponse] = [:]
    // 各キーの最終アクセス（または保存）時刻。TTL を過ぎたらキャッシュを無効化します。
    private var lastAccess: [Key: Date] = [:]
    // TTL（秒）: この時間を過ぎるとキャッシュを破棄します。
    // サーバ側のキャッシュは数時間単位ですが、クライアント側では短め（例: 12分）にして最新へ自然移行。
    private let ttlSeconds: TimeInterval = 720

    func get(dateYmd: String, category: String) -> DailySnapshotResponse? {
        let key = Key(dateYmd: dateYmd, category: category)
        guard let snap = store[key] else { return nil }
        if let ts = lastAccess[key], Date().timeIntervalSince(ts) > ttlSeconds {
            // TTL 超過: キャッシュを破棄して再取得を促します（次回呼び出し側で API へフォールバック）。
            store[key] = nil
            lastAccess[key] = nil
            return nil
        }
        return snap
    }

    func put(dateYmd: String, category: String, snapshot: DailySnapshotResponse) {
        let key = Key(dateYmd: dateYmd, category: category)
        store[key] = snapshot
        // 取得直後のデータを保存し、以降 TTL 内は同じ値を使い回せるようにします。
        // 例: DeckDistributionView / ReferenceBuildsView からの API 結果を共有。
        lastAccess[key] = Date()
    }

    // すべてのキャッシュを破棄します。手動リセットが必要な場面（設定変更など）で呼び出します。
    func purge() { store.removeAll(); lastAccess.removeAll() }
}
