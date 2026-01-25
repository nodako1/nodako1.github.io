import Foundation

/*
 DayDataPreloader
 - 役割: 指定した日付とカテゴリの「日次スナップショット」データを先読みして保持する。
 - 目的: 画面遷移や広告表示中に非同期でデータを準備し、遷移後の初期表示を高速化する。
 - 主な呼び出し元:
     ・先読み開始: [ios/Views/ContentView.swift](ios/Views/ContentView.swift#L238)
         画面で対象日付・カテゴリが見えるタイミングで `preload(date:category:)` を呼び出して先読みします。
     ・先読み済みデータの利用: [ios/Views/DaySummaryView.swift](ios/Views/DaySummaryView.swift#L159)
         遷移後はまず `take(date:category:)` でキャッシュから取得を試み、存在すればネットワークアクセスを省略します。
 - 実装上のポイント:
     ・`actor` として実装し、同時アクセス時のレースコンディションを防ぎます。
     ・日付文字列は API 仕様に合わせて "YYYYMMDD" へ正規化してから取得します（`DateUtil`を利用）。
 */
actor DayDataPreloader {
    // 先読みデータを特定するためのキー（同じ日付×カテゴリで一意）
    struct Key: Hashable, Sendable { let date: String; let category: String }

    // 先読みして保持する 1 日分の表示用データ
    // - `events`: 日次イベント一覧（APIの `DailySnapshot.events` をそのまま利用）
    // - `rankingsByVenue`: 会場（主催者名）ごとのランキング。APIの行データを UI 表示向けの `RankingItem` に変換して保持する。
    struct PreloadedDayData: Sendable {
        let events: [EventSummary]
        let rankingsByVenue: [String: [RankingItem]]
    }

    static let shared = DayDataPreloader()
    private static let cache = PreloadCacheActor<Key, PreloadedDayData>()

    func preload(date: String, category: String) async throws -> PreloadedDayData {
        let key = Key(date: date, category: category)
        if let cached = await DayDataPreloader.cache.get(key) { return cached }

        // 日付文字列を API 仕様の "YYYYMMDD" 形式へ正規化する
        let ymd: String = {
            if date.count == 8, date.allSatisfy({ $0.isNumber }) { return date }
            if let dt = DateUtil.parse(date) { return DateUtil.ymdString(from: dt) }
            return date
        }()
        let snap = try await ApiClient.shared.fetchDailySnapshot(dateYmd: ymd, category: category)
        // ランキング行（APIの `DailySnapshotRankingRow`）を UI で扱う `RankingItem` に変換し、会場別にまとめる
        var mapped: [String: [RankingItem]] = [:]
        for (venue, rows) in snap.rankingsByVenue {
            mapped[venue] = rows.map { r in
                RankingItem(id: UUID().uuidString, rank: r.rank, points: nil, player: r.player, deckUrl: r.deckUrl, deckListImageUrl: r.deckListImageUrl, organizer: venue, cityLeagueCategory: snap.category, environmentName: nil, deckName: r.deckName, attackType: nil)
            }
        }
        let packed = PreloadedDayData(events: snap.events, rankingsByVenue: mapped)
        await DayDataPreloader.cache.put(key, packed)
        return packed
    }

    // 先読み済みデータを「取り出して」返す
    // - 取得に成功した場合、キャッシュからは削除される（同じキーで再利用しない前提）
    // - 利用箇所: [ios/Views/DaySummaryView.swift](ios/Views/DaySummaryView.swift#L159)
    func take(date: String, category: String) async -> PreloadedDayData? {
        let key = Key(date: date, category: category)
        return await DayDataPreloader.cache.take(key)
    }
}
