// 指定した日付・カテゴリのイベントにおける入賞デッキ一覧を表示する画面。
// ContentView から日付選択後に遷移して利用されます。
// データは ApiClient の「日次スナップショット」または DayDataPreloader の先読み結果を採用します。
// 一覧画像は Nuke を用いて事前にプリフェッチし、表示体感を改善します。
import SwiftUI
import Nuke

// イベント詳細URLから数値のイベントIDを抽出する補助関数。
// 例: "/event/detail/849026" → "849026" を返します。
// 現在この画面内では直接は使用していませんが、周辺処理で流用可能です。
fileprivate func extractNumericId(from detailUrl: String?) -> String? {
    guard let s = detailUrl, !s.isEmpty else { return nil }
    if let r = s.range(of: #"/event/detail/(\d+)"#, options: .regularExpression) {
        let matched = String(s[r])
        if let numRange = matched.range(of: #"(\d+)"#, options: .regularExpression) {
            let digits = String(matched[numRange])
            return digits.isEmpty ? nil : digits
        }
    }
    // フォールバック: URL をパス分解して detail/ の次要素を数値として採用
    if let url = URL(string: s) {
        let comps = url.pathComponents
        if let idx = comps.firstIndex(of: "detail"), idx + 1 < comps.count {
            let candidate = comps[idx + 1]
            if candidate.allSatisfy({ $0.isNumber }) { return candidate }
        }
    }
    return nil
}

// 指定日付・カテゴリのイベントを取得し、会場単位で入賞デッキを一覧表示するメインビュー。
struct DaySummaryView: View {
    // 画面に表示する対象日付（ContentView で選択された値）
    let dateItem: DateItem
    // カテゴリの日本語ラベル（例: オープン / シニア / ジュニア）
    let category: String
    // 取得したイベント一覧（スナップショット採用時に利用）
    @State private var events: [EventSummary] = []
    // 会場名 → ランキング配列。描画前に会場単位で結合して保持します。
    @State private var rankingsByVenue: [String: [RankingItem]] = [:]
    // 上部の順位フィルタタブの選択状態（優勝/TOP8/TOP16 など）
    @State private var selectedRankFilter: RankThreshold? = nil
    // 会場（organizer）単位でソート・整形したランキング（描画の基礎データ）
    private var venueGroups: [(name: String, items: [RankingItem])] {
        let grouped = rankingsByVenue.map { (name, items) in
            (name: name.isEmpty ? "主催者未取得" : name, items: items.sorted { ($0.rank ?? 9999) < ($1.rank ?? 9999) })
        }
        return grouped.sorted { $0.name < $1.name }
    }
    // フィルタ適用後の表示用グループ（カテゴリに応じた既定閾値を含む）
    private var venueGroupsFiltered: [(name: String, items: [RankingItem])] {
        // 選択が TOP16（オープン）または TOP8（シニア/ジュニア）のときは全件表示
        if let sel = selectedRankFilter {
            if category == "オープン", sel == .TOP16 { return venueGroups }
            if category != "オープン", sel == .TOP8 { return venueGroups }
        }
        let cutoff: Int = {
            if let s = selectedRankFilter { return s.maxRank }
            // 未選択時の既定: オープン=TOP16以上、シニア/ジュニア=TOP8以上
            return (category == "オープン") ? 16 : 8
        }()
        let filtered = venueGroups.map { g in
            let items = g.items.filter { ( ($0.rank ?? Int.max) <= cutoff ) }
            return (name: g.name, items: items)
        }.filter { !$0.items.isEmpty }
        return filtered
    }
    // 読み込み失敗時のメッセージ
    @State private var errorText: String?
    // データ取得中のローディング状態
    @State private var loading = false
    // Nuke の画像プリフェッチャ。表示前に一覧画像を先読みします。
    @State private var prefetcher = ImagePrefetcher()
    // 進行中のプリフェッチリクエスト管理（画面離脱時に停止）
    @State private var preheatedRequests: [ImageRequest] = []
    // 「さらに表示」ボタンを設けず、基本的に全件を常時表示します。

    var body: some View {
        // ランキング一覧と固定バナーのレイアウト
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    // 順位フィルタのタブUI。選択状況は selectedRankFilter に反映されます。
                    RankFilterTabs(
                        available: (category == "オープン") ? [.優勝, .準優勝, .TOP4, .TOP8, .TOP16] : [.優勝, .準優勝, .TOP4, .TOP8],
                        selection: $selectedRankFilter
                    )
                    if loading {
                        // 取得中インジケータ（スピナー）
                        ProgressView().tint(.white)
                            .frame(maxWidth: .infinity, minHeight: 100)
                    }
                    if let err = errorText { Text(err).foregroundStyle(.red) }
                    ForEach(venueGroupsFiltered, id: \.name) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            Text("会場：\(group.name)")
                                .font(.headline.weight(.semibold))
                                .foregroundStyle(Color.black)
                            LazyVStack(alignment: .leading, spacing: 8) {
                                ForEach(group.items) { r in
                                    // 会場ごとの入賞デッキ一覧。各行は RankingRow コンポーネント。
                                    RankingRow(r: r)
                                }
                            }
                        }
                        .pokemonCardContainer(cornerRadius: 12)
                    }
                }
                .padding()
                // 下部バナーとの距離を少し確保
                .padding(.bottom, 8)
            }
            // 画面下部のバナー広告。スクロールに追従しません。
            AdMobBannerView()
                .frame(height: 50)
                .background(Color.black.opacity(0.1))
                .overlay(Divider().background(Color.white.opacity(0.15)), alignment: .top)
        }
        .background(Theme.Gradient.appBackground.ignoresSafeArea())
        .toolbar {
            ToolbarItem(placement: .principal) {
                BrandTitle(text: "Winning Deck", onDark: true, size: 28)
            }
        }
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarBackground(Theme.Gradient.appBackground, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        // 画面表示開始時に、日次スナップショットまたは先読みデータを反映します。
        .task { await loadOrAdoptPreloaded() }
        // 画面離脱時に画像プリフェッチを停止します。
        .onDisappear { stopPreheating() }
    }

    // イベントとランキングを統合し、会場単位で結合して表示します。
    // 可能であれば「日次スナップショット」を優先採用し、画像は事前にプリフェッチします。
    private func loadOrAdoptPreloaded() async {
        loading = true
        defer { loading = false }
        // 前回のプリフェッチを停止
        stopPreheating()
        do {
            // 1) 日付文字列を YYYYMMDD に整形できる場合、日次スナップショット取得を試行
            if let ymd = convertToYmd(dateItem.date) {
                if let cat = category.isEmpty ? nil : category {
                    if let snap = try? await ApiClient.shared.fetchDailySnapshot(dateYmd: ymd, category: cat) {
                        // スナップショットが空でない場合は即反映（空白画面を避ける）
                        if !snap.events.isEmpty {
                            // events / rankingsByVenue を構築して即反映
                            self.events = snap.events
                            var temp: [String: [RankingItem]] = [:]
                            for (venue, rows) in snap.rankingsByVenue {
                                let mapped: [RankingItem] = rows.map { r in
                                    RankingItem(id: UUID().uuidString, rank: r.rank, points: nil, player: r.player, deckUrl: r.deckUrl, deckListImageUrl: r.deckListImageUrl, organizer: venue, cityLeagueCategory: cat, environmentName: nil, deckName: r.deckName, attackType: nil)
                                }
                                temp[venue] = mapped
                            }
                            self.rankingsByVenue = temp
                            // 画像プリフェッチ（http/https のみ対象）
                            let urls: [URL] = self.venueGroupsFiltered.flatMap { $0.items }.compactMap { r in
                                    guard let s = r.deckListImageUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
                                          !s.isEmpty,
                                          let u = URL(string: s),
                                          let scheme = u.scheme?.lowercased(),
                                          scheme == "http" || scheme == "https" else { return nil }
                                    return u
                            }
                            startPreheating(urls: urls)
                            // スナップショット採用時は後続のフォールバック処理を省略して return
                            return
                        }
                    }
                }
            }
            if let preloaded = await DayDataPreloader.shared.take(date: dateItem.date, category: category) {
                // 広告表示中に取得済みの先読みスナップショットがあれば即反映
                self.events = preloaded.events
                self.rankingsByVenue = preloaded.rankingsByVenue
                // 画像プリフェッチ（http/https のみ対象）
                let urls: [URL] = self.venueGroupsFiltered.flatMap { $0.items }.compactMap { r in
                        guard let s = r.deckListImageUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
                              !s.isEmpty,
                              let u = URL(string: s),
                              let scheme = u.scheme?.lowercased(),
                              scheme == "http" || scheme == "https" else { return nil }
                        return u
                }
                startPreheating(urls: urls)
                return
            }
            // スナップショットが見つからない場合のメッセージ（ライブ集計のフォールバックは行いません）
            self.errorText = "指定日のスナップショットが見つかりませんでした"
        } catch {
            self.errorText = error.localizedDescription
        }
    }
}

// 画像プリフェッチと日付文字列整形のユーティリティ群
private extension DaySummaryView {
    // ランキング一覧の画像URL（deckListImageUrl）のみを対象に、Nuke で先読みします。
    func startPreheating(urls: [URL]) {
        let requests = urls.map { ImageRequest(url: $0) }
        prefetcher.startPrefetching(with: requests)
        preheatedRequests.append(contentsOf: requests)
    }

    // 進行中の先読みを停止し、管理配列をクリアします。
    func stopPreheating() {
        guard !preheatedRequests.isEmpty else { return }
        prefetcher.stopPrefetching(with: preheatedRequests)
        preheatedRequests.removeAll()
    }

    // 入力が M/D / YYYY/M/D / YYYYMMDD のいずれかを受け取り、YYYYMMDD を返します。
    func convertToYmd(_ raw: String) -> String? {
        // 既に YYYYMMDD 形式であればそのまま返します。
        if raw.count == 8, raw.allSatisfy({ $0.isNumber }) { return raw }
        let parts = raw.split(separator: "/")
        guard parts.count >= 2 else { return nil }
        let month = Int(parts[parts.count-2])
        let day = Int(parts.last!)
        if month == nil || day == nil { return nil }
        let year: Int
        if parts.count == 3, let y = Int(parts[0]), y > 2000 {
            year = y
        } else {
            year = Calendar.current.component(.year, from: Date())
        }
        return String(format: "%04d%02d%02d", year, month!, day!)
    }

    // YYYYMMDD を M/D に変換します（旧イベントAPI形式との互換用）。
    func toMD(_ raw: String) -> String {
        if raw.count == 8, raw.allSatisfy({ $0.isNumber }) {
            let m = Int(raw.dropFirst(4).prefix(2)) ?? 0
            let d = Int(raw.suffix(2)) ?? 0
            return "\(m)/\(d)"
        }
        return raw
    }
}
