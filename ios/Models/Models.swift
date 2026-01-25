import Foundation

/*
 このファイルはアプリ全体で共有するモデル定義をまとめています。
 - 主な入出力: ApiClient（サーバーAPIとのJSONのやり取り）
 - 主な利用先: SwiftUIの各View（ContentView, DaySummaryView, DeckDistributionView,
     ReferenceBuildsView/ReferenceBuildsDetailView, EnvironmentVideosView）および各Store/Actor。
*/

// イベント一覧の1件分を表すモデル。
// 主な取得元: ApiClient.fetchEvents()
// 主な利用先: DaySummaryView のイベント表示、ReferenceBuildsView のイベント集計、
//              DailySnapshotResponse.events（統合スナップショット）
struct EventSummary: Identifiable, Codable, Equatable, Hashable, Sendable {
    // APIがidを返さないケースに備えた生ID。
    let rawId: String?
    // 元イベントを識別するID（参考構築などでグルーピングに利用）。
    let originalEventId: String?
    // 表示用タイトル・場所・詳細ページURLなど。
    let title: String?
    let location: String?
    // YYYY-MM-DD または YYYYMMDD 形式の文字列。
    let date: String
    let detailUrl: String?
    let cityLeagueCategory: String?

    // List表示やDiffのための安定した識別子。
    // rawId > detailUrlから抽出した数値ID > 日付+タイトル合成（なければUUID）の優先順で決定します。
    var id: String {
        if let r = rawId, !r.isEmpty { return r }
        if let extracted = extractNumericIdFromDetailUrl(detailUrl) { return extracted }
        return "synthetic-" + date + "-" + (title ?? UUID().uuidString)
    }

    // detailUrl（/event/detail/{数字}）から数値IDを取り出して識別に使います。
    private func extractNumericIdFromDetailUrl(_ url: String?) -> String? {
        guard let url, let range = url.range(of: "/event/detail/") else { return nil }
        let after = url[range.upperBound...]
        let numeric = after.prefix { $0.isNumber }
        return numeric.isEmpty ? nil : String(numeric)
    }

    // サーバーのキー名とプロパティの対応（JSON <-> モデル）
    enum CodingKeys: String, CodingKey {
        case rawId = "id"
        case originalEventId
        case title, location, date, detailUrl, cityLeagueCategory
    }

    // JSONからのデコード（date は必須、それ以外は任意）
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rawId = try? c.decode(String.self, forKey: .rawId)
        originalEventId = try? c.decode(String.self, forKey: .originalEventId)
        title = try? c.decode(String.self, forKey: .title)
        location = try? c.decode(String.self, forKey: .location)
        detailUrl = try? c.decode(String.self, forKey: .detailUrl)
        cityLeagueCategory = try? c.decode(String.self, forKey: .cityLeagueCategory)
        date = try c.decode(String.self, forKey: .date)
    }

    // JSONへのエンコード（画面キャッシュや保存処理で利用可能）
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(rawId, forKey: .rawId)
        try c.encodeIfPresent(originalEventId, forKey: .originalEventId)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(location, forKey: .location)
        try c.encodeIfPresent(detailUrl, forKey: .detailUrl)
        try c.encodeIfPresent(cityLeagueCategory, forKey: .cityLeagueCategory)
        try c.encode(date, forKey: .date)
    }
}

// 日付選択に使うモデル（/api/dates の文字列をそのまま保持）。
// 主な取得元: ApiClient.fetchDates()
// 主な利用先: ContentView の日付リスト/ナビゲーション、DaySummaryView の入力。
struct DateItem: Identifiable, Codable, Equatable, Hashable, Sendable {
    // List・Navigation用の識別子（値そのものがユニーク）
    var id: String { date }
    // YYYYMMDD 形式の文字列（画面でソート・表示に利用）
    let date: String
}

// ランキング1件分の表示用モデル。
// 主な取得元: ApiClient.fetchRankings()（イベント詳細）
// 主な利用先: DaySummaryView のランキング表示、Components/RankingRow（行コンポーネント）。
struct RankingItem: Identifiable, Codable, Equatable, Hashable, Sendable {
    // 行識別用ID（サーバー都合で欠落時はURLなどから合成）
    let id: String
    // 順位・ポイント・プレイヤー名などの表示項目
    let rank: Int?
    let points: Int?
    let player: String?
    // デッキURL・リスト画像URL（サムネイル表示等に利用）
    let deckUrl: String?
    let deckListImageUrl: String?
    // 開催会場・リーグカテゴリ・環境名（フィルタやグループ化に利用）
    let organizer: String?
    let cityLeagueCategory: String?
    let environmentName: String?
    // デッキ名・攻撃タイプ（取得できれば表示や絞り込みに利用）
    let deckName: String?
    let attackType: String?

    enum CodingKeys: String, CodingKey {
        case id
        case rank
        case points
        case point
        case playerInfo
        case player
        case deckUrl
        case deckListImageUrl
        case organizer
        case cityLeagueCategory
        case environmentName
        case deckName
        case attackType
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // id は存在しないことがある -> deckId または deckUrl から合成
        let decodedId = (try? c.decode(String.self, forKey: .id))
        let decodedDeckUrl = (try? c.decode(String.self, forKey: .deckUrl))
        if let v = decodedId, !v.isEmpty {
            self.id = v
        } else if let u = decodedDeckUrl, !u.isEmpty {
            self.id = "url-" + u
        } else {
            self.id = UUID().uuidString
        }

        self.rank = try? c.decode(Int.self, forKey: .rank)
        if let p = try? c.decode(Int.self, forKey: .points) {
            self.points = p
        } else if let p1 = try? c.decode(Int.self, forKey: .point) {
            self.points = p1
        } else {
            self.points = nil
        }
        if let pi = try? c.decode(String.self, forKey: .playerInfo) {
            self.player = pi
        } else {
            self.player = try? c.decode(String.self, forKey: .player)
        }
        self.deckUrl = decodedDeckUrl
        self.deckListImageUrl = try? c.decode(String.self, forKey: .deckListImageUrl)
        self.organizer = try? c.decode(String.self, forKey: .organizer)
        self.cityLeagueCategory = try? c.decode(String.self, forKey: .cityLeagueCategory)
        self.environmentName = try? c.decode(String.self, forKey: .environmentName)
        self.deckName = try? c.decode(String.self, forKey: .deckName)
        self.attackType = try? c.decode(String.self, forKey: .attackType)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(rank, forKey: .rank)
        try c.encodeIfPresent(points, forKey: .points)
        try c.encodeIfPresent(player, forKey: .player)
        try c.encodeIfPresent(deckUrl, forKey: .deckUrl)
        try c.encodeIfPresent(deckListImageUrl, forKey: .deckListImageUrl)
        try c.encodeIfPresent(organizer, forKey: .organizer)
        try c.encodeIfPresent(cityLeagueCategory, forKey: .cityLeagueCategory)
        try c.encodeIfPresent(environmentName, forKey: .environmentName)
        try c.encodeIfPresent(deckName, forKey: .deckName)
        try c.encodeIfPresent(attackType, forKey: .attackType)
    }

    // 画面側で合成して使う場面向けの手動イニシャライザ。
    init(id: String = UUID().uuidString,
         rank: Int?,
         points: Int? = nil,
         player: String?,
         deckUrl: String?,
         deckListImageUrl: String?,
         organizer: String?,
         cityLeagueCategory: String?,
         environmentName: String? = nil,
         deckName: String?,
         attackType: String? = nil) {
        self.id = id
        self.rank = rank
        self.points = points
        self.player = player
        self.deckUrl = deckUrl
        self.deckListImageUrl = deckListImageUrl
        self.organizer = organizer
        self.cityLeagueCategory = cityLeagueCategory
        self.environmentName = environmentName
        self.deckName = deckName
        self.attackType = attackType
    }
}

// 対戦環境（フォーマット）の期間情報（/api/environments）。
// 主な取得元: ApiClient.fetchEnvironments()
// 主な利用先: ContentView の環境選択・期間内のリーグ日付取得。
struct EnvironmentItem: Identifiable, Codable, Equatable, Hashable, Sendable {
    // 環境名 + 開始日で識別（同名の環境が複数期間存在する想定）
    var id: String { name + "-" + startYmd }
    let name: String
    // 期間は YYYYMMDD 形式の文字列で管理
    let startYmd: String
    let endYmd: String
    // 指定の日付（YYYYMMDD）が期間に含まれるかの簡易判定
    func contains(dateYmd: String) -> Bool {
        guard dateYmd.count == 8, startYmd.count == 8, endYmd.count == 8 else { return false }
        return dateYmd >= startYmd && dateYmd <= endYmd
    }
}

// デッキ詳細APIの応答全体。
// 主な取得元: ApiClient.fetchDeck(deckId:)
// 主な利用先: デッキ詳細表示（タイトル/作者/カードリスト/画像などの材料）。
struct DeckDetailsResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let deckId: String?
    let deckUrl: String?
    let details: DeckDetails?
    let summary: DeckSummary?
}

// デッキの要約情報（プレイヤー名・順位・代表画像など）。
struct DeckSummary: Codable, Equatable, Sendable {
    let player: String?
    let rank: Int?
    let image: String?
}

// デッキ詳細（タイトル/作者/公開日/コード/画像/カード群/カテゴリ別集計）。
struct DeckDetails: Codable, Equatable, Sendable {
    let ok: Bool?
    let title: String?
    let author: String?
    let publishedAt: String?
    let deckCode: String?
    let images: [DeckImage]?
    let cards: [DeckCard]?
    let byCategory: [String: DeckCategory]?
}

// デッキ関連画像（サムネイル等）。
struct DeckImage: Codable, Equatable, Sendable {
    let alt: String?
    let src: String?
}

// カード行（名称・枚数・カテゴリ）。
struct DeckCard: Codable, Equatable, Identifiable, Sendable {
    // 名称+枚数の合成で簡易識別（同名カード重複の簡便対応）
    var id: String { (name ?? "?") + String(count ?? 0) }
    let name: String?
    let count: Int?
    let category: String?
    let raw: String?
}

// カテゴリごとのカード集計。
struct DeckCategory: Codable, Equatable, Sendable {
    let total: Int?
    let cards: [DeckCard]?
}

// デッキ分布（デッキ名と件数）。
// 主な取得元: ApiClient.fetchDeckDistributionRange()/fetchDeckDistribution()
// 主な利用先: DeckDistributionView（週次比較）、ReferenceBuildsView（上位分布一覧）、各Storeによるプリロード。
struct DeckDistributionItem: Identifiable, Codable, Equatable, Hashable, Sendable {
    // デッキ名で識別（同名は統計的に1件とみなす）
    var id: String { name }
    let name: String
    let count: Int
}

// 統合スナップショットの応答（1日分のイベント・ランキング・分布をまとめて取得）。
// 主な取得元: ApiClient.fetchDailySnapshot(dateYmd:)
// 主な利用先: DaySummaryView（ランキング統合表示）, DeckDistributionView（キャッシュ参照）, DailySnapshotStore（保存）。
struct DailySnapshotResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let date: String
    let category: String?
    let generatedAt: String?
    let events: [EventSummary]
    let rankingsByVenue: [String: [DailySnapshotRankingRow]]
    let deckDistribution14d: DailySnapshotDistribution?
    let distinctDeckNamesWeek: DailySnapshotDistinctWeek?
}

// 統合スナップショット内のランキング行（後段でRankingItemへ写像）。
// 主な利用先: DaySummaryView/PreloadStore で RankingItem に変換して表示。
struct DailySnapshotRankingRow: Codable, Equatable, Hashable, Sendable, Identifiable {
    // デッキURLや画像URL+順位の合成ID（欠落時にUUIDを補う）
    var id: String { (deckUrl ?? deckListImageUrl ?? UUID().uuidString) + String(rank ?? -1) }
    let rank: Int?
    let player: String?
    let deckUrl: String?
    let deckListImageUrl: String?
    let organizer: String?
    let deckName: String?
}

// 直近の分布情報（件数と合計）。
struct DailySnapshotDistribution: Codable, Equatable, Sendable {
    let items: [DeckDistributionItem]
    let total: Int?
}

// 1週間のユニークなデッキ名の分布。
struct DailySnapshotDistinctWeek: Codable, Equatable, Sendable {
    let from: String
    let to: String
    let items: [DeckDistributionItem]
}

// 週次分布（今週/先週）は日次スナップショットからは提供しない方針のため、
// モデルから該当フィールドを削除しています（従来は `weeklyDeckDistribution` 参照）。

// 参考構築のサンプル（デッキ名に紐づく代表例）。
// 主な取得元: ApiClient.fetchDeckSamples()/fetchDeckSamplesRange()
// 主な利用先: ReferenceBuildsDetailView（一覧・絞り込み・表示）。
struct DeckSampleItem: Identifiable, Codable, Equatable, Hashable, Sendable {
    // デッキURL+プレイヤー名の合成で簡易識別
    var id: String { (deckUrl ?? UUID().uuidString) + (player ?? "") }
    let deckName: String
    let rank: Int?
    let originalEventId: String?
    let player: String?
    let deckUrl: String?
    let deckListImageUrl: String?
    let dateMD: String?
    let organizer: String?
}

// YouTube動画のメタ情報。
// 主な取得元: ApiClient.fetchYoutubeLatest()
// 主な利用先: EnvironmentVideosView（環境別の最新動画表示）。
struct YoutubeVideoItem: Identifiable, Codable, Equatable, Hashable, Sendable {
    var id: String { videoId }
    let videoId: String
    let title: String?
    let thumbnail: String?
    let url: String?
    let published: String?
}
