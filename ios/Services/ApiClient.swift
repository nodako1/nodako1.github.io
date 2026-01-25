import Foundation

// このファイルの役割と利用箇所
// - 役割: アプリ内の公開API/管理APIに対して HTTP GET を実行し、JSON を構造体へデコードするためのクライアントをまとめています。
// - 主な利用箇所（画面・処理）：
//   - ContentView: 環境一覧取得（fetchEnvironments）、日付一覧取得（fetchDates）
//   - DaySummaryView: 日次スナップショット取得（fetchDailySnapshot）、イベント一覧（fetchEvents）、ランキング取得（fetchRankings）
//   - DeckDistributionView: デッキ分布（fetchDeckDistributionRange / fetchDeckDistribution）と日次スナップショット（fetchDailySnapshot）
//   - ReferenceBuildsView: 週次の distinct デッキ名（fetchWeeklyDistinctDeckNames）、過去日付のイベント/ランキング（fetchDates, fetchEvents, fetchRankings）
//   - ReferenceBuildsDetailView: 指定デッキ名のサンプル一覧（fetchDeckSamples / fetchDeckSamplesRange）、ランキング（fetchRankings）
//   - EnvironmentVideosView: YouTube の最新動画（fetchYoutubeLatest）
// - ベースURLの自動切替: 通信エラーや 401/403/404 が発生した場合、`AppConfig.baseURLCandidates` の候補を順に切り替えて再試行します。
// - 認証ヘッダ: 必要に応じて `authHeaderProvider` から Bearer トークンを取得して付与できます。

enum ApiError: LocalizedError, Sendable {
    // HTTP ステータスが 200 以外だった場合に返すエラー（本文の先頭スニペットを含める場合あり）
    case http(status: Int, body: String?)

    var errorDescription: String? {
        switch self {
        case let .http(status, body):
            if let body, !body.isEmpty {
                return "HTTP \(status): \(body)"
            } else {
                return "HTTP \(status)"
            }
        }
    }
}

// アプリ全体で使う HTTP GET 専用クライアント。
// - 併用する構成値は `AppConfig` に定義（ベースURL候補や既定値）。
// - 通信失敗時や 401/403/404 のときはベースURL候補へ切り替えて自動リトライします。
actor ApiClient {
    static let shared = ApiClient()

    // 現在使用中のベースURL（候補の中から選択）。フォールバックで切り替えられます。
    var baseURL: URL

    // 認証が必要なAPI向けに、非同期でトークンを取得して Authorization ヘッダに付与するためのフック。
    var authHeaderProvider: (() async -> String?)? = nil

    init() {
        #if DEBUG
        // Debug 実行時: 既定のベースURL（通常はローカルや検証環境）を強制採用して永続化します。
        let start = URL(string: AppConfig.defaultBaseURLString)!
        self.baseURL = start
        AppConfig.persistedBaseURLString = start.absoluteString
        #else
        // Release 実行時: 以前に選択・永続化されたベースURLがあればそれを使い、なければ既定値を使います。
        self.baseURL = URL(string: AppConfig.persistedBaseURLString ?? AppConfig.defaultBaseURLString)!
        #endif
    }

    // パスとクエリを受け取り、現在の `baseURL` を土台に実際のアクセス先 URL を組み立てます。
    private func buildURL(path: String, query: [URLQueryItem] = []) -> URL {
        let url: URL = path.hasPrefix("/") ? URL(string: path, relativeTo: baseURL)!.absoluteURL : baseURL.appendingPathComponent(path)
        var comp = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comp.queryItems = query }
        return comp.url!
    }

    // GET リクエスト用の `URLRequest` を生成します。必要に応じて Bearer トークンを付与します。
    private func makeRequest(url: URL) async -> URLRequest {
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        if let token = await authHeaderProvider?() { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return req
    }

    // 実際に GET を行い、必要に応じてベースURLを切り替えながら再試行します。
    // - 401/403/404 の場合は候補へフォールバックして再試行します（403時は公開API側へ切替）。
    private func performGET(path: String, query: [URLQueryItem] = []) async throws -> (Data, HTTPURLResponse) {
        let candidates = AppConfig.baseURLCandidates
        // 現在の baseURL が候補外なら既定値へ戻します。
        if !candidates.contains(baseURL.absoluteString), let def = URL(string: AppConfig.defaultBaseURLString) { baseURL = def }
        var lastError: Error?
        for _ in 0..<candidates.count {
            let url = buildURL(path: path, query: query)
            let req = await makeRequest(url: url)
            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                guard let http = resp as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                if http.statusCode == 200 { return (data, http) }
                if [401,403,404].contains(http.statusCode) {
                    if http.statusCode == 403, let publicURL = URL(string: AppConfig.defaultBaseURLString) {
                        baseURL = publicURL
                        AppConfig.persistedBaseURLString = publicURL.absoluteString
                    } else {
                        try await fallbackBaseURL()
                    }
                    lastError = ApiError.http(status: http.statusCode, body: String(data: data, encoding: .utf8))
                    continue
                }
                let snippet = String(data: data, encoding: .utf8)?.prefix(300)
                throw ApiError.http(status: http.statusCode, body: snippet.map(String.init))
            } catch {
                lastError = error
                try await fallbackBaseURL()
                continue
            }
        }
        throw lastError ?? URLError(.cannotFindHost)
    }

    /// 日付一覧を取得します。
    /// - 利用箇所: ContentView（初期表示で対象日付を選ぶため）や ReferenceBuildsView（過去データ探索）
    /// - パラメータ: `category` はリーグカテゴリ、`fromYmd`/`toYmd` を両方指定すると環境に合わせた日付レンジの取得に切り替わります。
    func fetchDates(category: String? = nil, fromYmd: String? = nil, toYmd: String? = nil) async throws -> [DateItem] {
        var query: [URLQueryItem] = []
        if let category, !category.isEmpty { query.append(URLQueryItem(name: "category", value: category)) }
        if let fromYmd, let toYmd, fromYmd.count == 8, toYmd.count == 8 {
            query.append(URLQueryItem(name: "from", value: fromYmd))
            query.append(URLQueryItem(name: "to", value: toYmd))
        }
        let (data, _) = try await performGET(path: "/api/dates", query: query)
        // まずは現行仕様（文字列配列）としてデコードを試みます。
        let dec = JSONDecoder()
        if let list = try? dec.decode([String].self, from: data) {
            return list.map { DateItem(date: $0) }
        }
        // 後方互換: { dates: ["..."] } または { dates: [{date|dateOnly: "..."}] } にも対応します。
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let datesVal = obj["dates"] {
            if let arr = datesVal as? [String] {
                return arr.map { DateItem(date: $0) }
            } else if let arr = datesVal as? [[String: Any]] {
                let mapped: [String] = arr.compactMap { dict in
                    if let d = dict["date"] as? String { return d }
                    return nil
                }
                if !mapped.isEmpty { return mapped.map { DateItem(date: $0) } }
            }
        }
        // 解析に失敗した場合は、本文の先頭スニペット付きでエラー化します。
        let snippet = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
        throw NSError(domain: "ApiClient", code: -1, userInfo: [NSLocalizedDescriptionKey: "日付一覧の解析に失敗しました\n\(snippet)"])
    }

    /// 指定日付のイベント一覧を取得します。
    /// - 利用箇所: DaySummaryView, ReferenceBuildsView（イベント列挙）
    func fetchEvents(date: String, category: String? = nil) async throws -> [EventSummary] {
        var q = [URLQueryItem(name: "dateYmd", value: date)]
        if let category, !category.isEmpty { q.append(URLQueryItem(name: "category", value: category)) }
        let (data, _) = try await performGET(path: "/api/events", query: q)
        struct Response: Decodable { let ok: Bool; let events: [EventSummary] }
        do {
            let out = try JSONDecoder().decode(Response.self, from: data)
            return out.events
        } catch let DecodingError.keyNotFound(key, ctx) {
            let snippet = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
            throw NSError(domain: "ApiClient", code: -1, userInfo: [NSLocalizedDescriptionKey: "イベントJSONのキー不足: \(key.stringValue) @ \(ctx.codingPath.map{ $0.stringValue }.joined(separator: "."))\n\(snippet)"])
        } catch let DecodingError.valueNotFound(type, ctx) {
            let snippet = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
            throw NSError(domain: "ApiClient", code: -1, userInfo: [NSLocalizedDescriptionKey: "イベントJSONの値不足: \(type) @ \(ctx.codingPath.map{ $0.stringValue }.joined(separator: "."))\n\(snippet)"])
        } catch {
            let snippet = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
            throw NSError(domain: "ApiClient", code: -1, userInfo: [NSLocalizedDescriptionKey: "イベントJSONの解析に失敗しました\n\(snippet)\n\(error.localizedDescription)"])
        }
    }

    /// 指定イベントのランキング一覧を取得します。
    /// - 利用箇所: DaySummaryView（イベント詳細でランキング表示）、ReferenceBuildsView/DetailView
    func fetchRankings(eventId: String, category: String? = nil) async throws -> [RankingItem] {
        var q = [URLQueryItem(name: "eventId", value: eventId)]
        if let category, !category.isEmpty { q.append(URLQueryItem(name: "category", value: category)) }
        let (data, _) = try await performGET(path: "/api/rankings", query: q)
        struct Response: Decodable { let ok: Bool; let rankings: [RankingItem] }
        do {
            let out = try JSONDecoder().decode(Response.self, from: data)
            return out.rankings
        } catch let DecodingError.keyNotFound(key, ctx) {
            let snippet = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
            throw NSError(domain: "ApiClient", code: -1, userInfo: [NSLocalizedDescriptionKey: "ランキングJSONのキー不足: \(key.stringValue) @ \(ctx.codingPath.map{ $0.stringValue }.joined(separator: "."))\n\(snippet)"])
        } catch let DecodingError.valueNotFound(type, ctx) {
            let snippet = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
            throw NSError(domain: "ApiClient", code: -1, userInfo: [NSLocalizedDescriptionKey: "ランキングJSONの値不足: \(type) @ \(ctx.codingPath.map{ $0.stringValue }.joined(separator: "."))\n\(snippet)"])
        } catch {
            let snippet = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
            throw NSError(domain: "ApiClient", code: -1, userInfo: [NSLocalizedDescriptionKey: "ランキングJSONの解析に失敗しました\n\(snippet)\n\(error.localizedDescription)"])
        }
    }

    /// 指定デッキIDの詳細を取得します（デッキレシピや画像リンクなど）。
    /// - 利用箇所: 参照デッキ詳細など（今後の拡張で利用）
    func fetchDeck(deckId: String) async throws -> DeckDetailsResponse {
        let (data, _) = try await performGET(path: "/api/decks/\(deckId)")
        // Swift 6 では Decodable が @MainActor に属するケースがあり、競合を避けるため専用関数でデコードします。
        return try await decodeDeckDetailsResponseOnMain(data)
    }

    /// 指定期間（既定は直近 `days` 日）のデッキ分布を取得します（デッキ名ベース）。
    /// - 利用箇所: DeckDistributionView（分布表示）
    func fetchDeckDistribution(days: Int = 14, category: String? = nil) async throws -> [DeckDistributionItem] {
        var q: [URLQueryItem] = [URLQueryItem(name: "days", value: String(days))]
        if let category, !category.isEmpty { q.append(URLQueryItem(name: "category", value: category)) }
        let (data, _) = try await performGET(path: "/api/deck-distribution", query: q)
        struct Response: Decodable { let ok: Bool; let total: Int?; let items: [DeckDistributionItem] }
        let out = try JSONDecoder().decode(Response.self, from: data)
        return out.items
    }

    /// 期間指定（YYYYMMDD〜YYYYMMDD）のデッキ分布を取得します（上位とその他を含む）。
    /// - 利用箇所: DeckDistributionView（週次などレンジ指定の分布表示）
    func fetchDeckDistributionRange(fromYmd: String, toYmd: String, category: String? = nil) async throws -> [DeckDistributionItem] {
        var q: [URLQueryItem] = [URLQueryItem(name: "from", value: fromYmd), URLQueryItem(name: "to", value: toYmd)]
        if let category, !category.isEmpty { q.append(URLQueryItem(name: "category", value: category)) }
        let (data, _) = try await performGET(path: "/api/deck-distribution", query: q)
        struct Response: Decodable { let ok: Bool; let total: Int?; let items: [DeckDistributionItem] }
        let out = try JSONDecoder().decode(Response.self, from: data)
        return out.items
    }

    /// 指定デッキ名のサンプルを取得します（画像・リンク・プレイヤー名など）。
    /// - 利用箇所: ReferenceBuildsDetailView（デッキの参考例表示）
    func fetchDeckSamples(name: String, days: Int = 30, category: String? = nil) async throws -> [DeckSampleItem] {
        var q: [URLQueryItem] = [URLQueryItem(name: "name", value: name), URLQueryItem(name: "days", value: String(days))]
        if let category, !category.isEmpty { q.append(URLQueryItem(name: "category", value: category)) }
        let (data, _) = try await performGET(path: "/api/deck-samples", query: q)
        struct Response: Decodable { let ok: Bool; let items: [DeckSampleItem] }
        let out = try JSONDecoder().decode(Response.self, from: data)
        return out.items
    }

    /// 指定デッキ名のサンプルを期間指定で取得します（YYYYMMDD〜YYYYMMDD）。
    /// - 利用箇所: ReferenceBuildsDetailView（期間絞り込み表示）
    func fetchDeckSamplesRange(name: String, fromYmd: String, toYmd: String, category: String? = nil) async throws -> [DeckSampleItem] {
        var q: [URLQueryItem] = [
            URLQueryItem(name: "name", value: name),
            URLQueryItem(name: "from", value: fromYmd),
            URLQueryItem(name: "to", value: toYmd)
        ]
        if let category, !category.isEmpty { q.append(URLQueryItem(name: "category", value: category)) }
        let (data, _) = try await performGET(path: "/api/deck-samples", query: q)
        struct Response: Decodable { let ok: Bool; let items: [DeckSampleItem] }
        let out = try JSONDecoder().decode(Response.self, from: data)
        return out.items
    }

    /// 週次（今週/先週）の distinct deckName を高速取得します（全ランク集計）。
    /// - 利用箇所: ReferenceBuildsView（今週＋先週の頻出デッキ名を一覧表示）
    /// - 補足: public-api の `/api/weekly/distinct-deck-names` を利用して今週＋先週を統合します。
    func fetchWeeklyDistinctDeckNames(category: String? = nil) async throws -> [DeckDistributionItem] {
        var q: [URLQueryItem] = []
        if let category, !category.isEmpty { q.append(URLQueryItem(name: "category", value: category)) }
        let (data, _) = try await performGET(path: "/api/weekly/distinct-deck-names", query: q)
        struct WeekItems: Decodable { let items: [DeckDistributionItem] }
        struct Weeks: Decodable { let thisWeek: WeekItems; let lastWeek: WeekItems }
        struct Response: Decodable { let ok: Bool; let distinctDeckNames: Weeks }
        let out = try JSONDecoder().decode(Response.self, from: data)
        // 今週・先週の件数を合算して降順で返します。
        var counter: [String: Int] = [:]
        for it in out.distinctDeckNames.thisWeek.items { counter[it.name, default: 0] += it.count }
        for it in out.distinctDeckNames.lastWeek.items { counter[it.name, default: 0] += it.count }
        let merged = counter.map { DeckDistributionItem(name: $0.key, count: $0.value) }.sorted { $0.count > $1.count }
        return merged
    }

    /// 指定日付の統合スナップショットを取得します（イベント・ランキングなどの要約）。
    /// - 利用箇所: DaySummaryView, DeckDistributionView（当日の状況表示）
    func fetchDailySnapshot(dateYmd: String, category: String? = nil) async throws -> DailySnapshotResponse {
        var q: [URLQueryItem] = [URLQueryItem(name: "date", value: dateYmd)]
        if let category, !category.isEmpty { q.append(URLQueryItem(name: "category", value: category)) }
        let (data, _) = try await performGET(path: "/api/daily-snapshot", query: q)
        let out = try JSONDecoder().decode(DailySnapshotResponse.self, from: data)
        return out
    }

    /// 取得可能な環境（リーグカテゴリや期間など）の一覧を取得します。
    /// - 利用箇所: ContentView（初期の環境選択）
    func fetchEnvironments() async throws -> [EnvironmentItem] {
        let (data, _) = try await performGET(path: "/api/environments")
        struct Response: Decodable { let ok: Bool; let environments: [EnvironmentItem] }
        let out = try JSONDecoder().decode(Response.self, from: data)
        return out.environments
    }

    /// 環境考察向けの最新 YouTube 動画一覧を取得します（チャンネルハンドル指定）。
    /// - 利用箇所: EnvironmentVideosView（最新動画の表示）
    func fetchYoutubeLatest(handle: String = "@PokecaCH", limit: Int = 8) async throws -> [YoutubeVideoItem] {
        let (data, _) = try await performGET(path: "/api/youtube/latest", query: [URLQueryItem(name: "handle", value: handle), URLQueryItem(name: "limit", value: String(limit))])
        struct Response: Decodable { let ok: Bool; let videos: [YoutubeVideoItem] }
        let out = try JSONDecoder().decode(Response.self, from: data)
        return out.videos
    }

    // 補助: 非200 の場合はステータス + 本文の先頭スニペット付きでエラー化します。
    private func dataFor(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, resp) = try await URLSession.shared.data(for: request)
        guard let http = resp as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard http.statusCode == 200 else {
            let snippet = String(data: data, encoding: .utf8)?.prefix(300)
            throw ApiError.http(status: http.statusCode, body: snippet.map(String.init))
        }
        return (data, http)
    }

    // ベースURLを候補の中から次へ切り替え、成功したら永続化します（次回起動以降も同じ候補を使用）。
    private func fallbackBaseURL() async throws {
        let current = baseURL.absoluteString
        let candidates = AppConfig.baseURLCandidates
        guard let idx = candidates.firstIndex(of: current) else { return }
        let nextIdx = (idx + 1) % candidates.count
        let next = candidates[nextIdx]
        guard let u = URL(string: next), u != baseURL else { return }
        baseURL = u
        AppConfig.persistedBaseURLString = next
    }
}

// メインアクター専用のデコードヘルパ。
// - Swift 6 以降では Decodable と並行性の制約が発生するケースがあり、ここで @MainActor を明示して安全にデコードします。
private extension ApiClient {
    @MainActor
    func decodeDeckDetailsResponseOnMain(_ data: Data, using decoder: JSONDecoder = JSONDecoder()) throws -> DeckDetailsResponse {
        try decoder.decode(DeckDetailsResponse.self, from: data)
    }
}
