import SwiftUI

/*
 ReferenceBuildsView: 最近の入賞デッキ（参考構築）を一覧表示し、
 各デッキの詳細画面へ遷移するためのビュー。
 主にこの画面から `ReferenceBuildsDetailView` を開く導線として使用される。
 データ取得は `load()` で行い、`ApiClient` と各種 `Store` を通じて
 スナップショット／集計／キャッシュを切り替えながら利用する。
*/

/*
 DeckNav: NavigationStack の遷移値。
 一覧から詳細へ遷移する際に、対象のデッキ（`item`）と表示期間（`from`, `to`）
 を渡すために利用される。`NavigationLink(value:)` と
 `.navigationDestination(for:)` の組み合わせで使用する。
*/
struct DeckNav: Hashable, Identifiable {
    var id: String { item.id + "-" + from + "-" + to }
    let item: DeckDistributionItem
    let from: String
    let to: String
}

struct ReferenceBuildsView: View {
        /*
         画面状態:
         - `allDecks`: 週期間の入賞ランキングから集計したデッキ一覧（件数降順）
             → `load()` が API/キャッシュから取得して更新する。
         - `errorText`: 取得失敗時にユーザーへ表示するメッセージ。
         - `isLoading`: データ取得中にインジケータを表示するためのフラグ。
         - `searchText`: デッキ名の部分一致検索で使用。`TextField` と双方向バインド。
         - `showCount`: ページングのために一覧表示件数を段階的に増やすカウンタ。
        */
        @State private var allDecks: [DeckDistributionItem] = []
        @State private var errorText: String?
        @State private var isLoading = false
        @State private var searchText: String = ""
        @State private var showCount: Int = 10

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                // 画面タイトル。以降に検索 UI と一覧を配置する。
                Text("最新の構築をチェック！")
                    .font(.title3.weight(.heavy))
                    .foregroundColor(.white.opacity(0.95))
                // 検索欄とリセットボタン。`searchText` の変更が一覧のフィルタに反映される。
                HStack(spacing: 8) {
                    TextField("デッキ名で検索", text: $searchText)
                        .textInputAutocapitalization(.never)
                        .disableAutocorrection(true)
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.12)))
                        .foregroundColor(.white)
                    if !searchText.isEmpty {
                        Button("リセット") { withAnimation { searchText = "" } }
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(Color.white.opacity(0.16)))
                            .foregroundColor(.white)
                    }
                }
                // 読込中インジケータとエラー表示（取得中や失敗時のユーザー向けフィードバック）。
                if isLoading { ProgressView().tint(.white) }
                if let err = errorText { Text(err).foregroundColor(.red) }
                // データがある場合の一覧レンダリング。フィルタ → ページング → 行タップで詳細へ遷移。
                if !allDecks.isEmpty {
                    Text("入賞デッキ一覧")
                        .font(.title3.weight(.heavy))
                        .foregroundStyle(.white)
                        .padding(.top, 4)
                    let filtered = filterDecks(allDecks)
                    let showing = Array(filtered.prefix(showCount))
                    ForEach(showing) { item in
                        // 詳細画面への遷移値として `DeckNav` を渡す。
                        NavigationLink(value: DeckNav(item: item, from: "", to: "")) {
                            HStack {
                                Text(item.name)
                                    .font(.title3.weight(.semibold))
                                    .foregroundColor(.white)
                                Spacer()
                                Text("\(item.count)")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundColor(.white.opacity(0.8))
                            }
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .padding(.horizontal)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.08)))
                        }
                    }
                    if filtered.count > showCount {
                        // 残り件数がある場合、10件ずつ追加表示する。
                        Button("さらに表示（残り\(filtered.count - showCount)件）") { withAnimation { showCount = min(showCount + 10, filtered.count) } }
                            .buttonStyle(ModernGlassButtonStyle(height: 44))
                            .font(.subheadline.weight(.bold))
                    }
                }
                Spacer(minLength: 0)
            }
            .padding()
            .background(Theme.Gradient.appBackground.ignoresSafeArea())
            .navigationDestination(for: DeckNav.self) { nav in
                /*
                 一覧からの遷移先となる詳細画面。
                 `DeckNav` に含まれる期間（`fromYmd`, `toYmd`）を渡して詳細データを取得する。
                 一覧側では空文字で渡しているため、詳細側は最新期間を自動利用する。
                */
                ReferenceBuildsDetailView(deckName: nav.item.name, fromYmd: nav.from, toYmd: nav.to)
            }
            // 画面表示時に初回データ取得を実行。
            .task { await load() }
            // 検索語が変わったら表示件数をリセット（先頭から再表示）。
            .onChange(of: searchText) { _ in showCount = 10 }
        }
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            /*
             データ取得の全体フロー:
             1) 本日の日次スナップショット（distinctDeckNamesWeek）を優先利用
             2) 期間キャッシュ（`DeckNameAggregationStore`）があれば採用
             3) API の週次 distinct を取得
             4) それでも不可なら、期間内のイベント一覧 → ランキングを並列取得して集計
             取得後は `DeckNameAggregationStore` にキャッシュして次回以降に再利用する。
            */

            // 期間計算（先週開始〜今週終了）と表示用 ymd 文字列を生成。
            let wb = WeekRangeUtil.weekBoundaries()
            let fromDate = wb.lastFrom
            let toDate = wb.thisTo
            let fromYmd = WeekRangeUtil.ymdString(fromDate)
            let toYmd = WeekRangeUtil.ymdString(toDate)

            /*
             本日の日次スナップショット（distinctDeckNamesWeek）の取得とキャッシュ。
             成功した場合、distinct の結果を件数降順に並べて一覧に反映し、期間キャッシュにも保存する。
            */
            let todayYmd = WeekRangeUtil.ymdString(Date())
            // await の競合を避けるため段階的に取得。
            var snap: DailySnapshotResponse?
            if let existing = await DailySnapshotStore.shared.get(dateYmd: todayYmd, category: "オープン") {
                snap = existing
            } else if let fetched = try? await ApiClient.shared.fetchDailySnapshot(dateYmd: todayYmd, category: "オープン") {
                snap = fetched
            }
            if let cachedSnap = snap {
                await DailySnapshotStore.shared.put(dateYmd: todayYmd, category: "オープン", snapshot: cachedSnap)
                if let distinct = cachedSnap.distinctDeckNamesWeek?.items, !distinct.isEmpty {
                    let sorted = distinct.filter { !$0.name.isEmpty }.sorted { $0.count > $1.count }
                    allDecks = sorted
                    await DeckNameAggregationStore.shared.put(fromYmd: fromYmd, toYmd: toYmd, category: "オープン", items: sorted)
                    return
                }
            }

            // 期間キャッシュ（from/to, category）がある場合はそのまま一覧へ反映。
            if let cached = await DeckNameAggregationStore.shared.get(fromYmd: fromYmd, toYmd: toYmd, category: "オープン") {
                allDecks = cached
                return
            }

            // 週次 distinct を取得できた場合は件数降順に並べ替え、期間キャッシュへ保存。
            if let weeklyItems = try? await ApiClient.shared.fetchWeeklyDistinctDeckNames(category: "オープン") {
                let sorted = weeklyItems.filter { !$0.name.isEmpty }.sorted { $0.count > $1.count }
                allDecks = sorted
                await DeckNameAggregationStore.shared.put(fromYmd: fromYmd, toYmd: toYmd, category: "オープン", items: sorted)
                return
            }

            /*
             期間内の日付一覧を取得し、週境界（先週開始〜今週終了）でフィルタ。
             以降のイベント・ランキング集計の対象日を確定する。
            */
            let allDates = try await ApiClient.shared.fetchDates(category: "オープン")
            let targetDateStrings: [String] = allDates.compactMap { di in
                guard let d = DateUtil.parse(di.date) else { return nil }
                return (d >= fromDate && d <= toDate) ? DateUtil.ymdString(from: d) : nil
            }

            /*
             対象日ごとのイベント一覧を並列取得。
             取得結果はまとめて配列へ統合し、次のランキング取得で使用する。
            */
            let allEvents: [EventSummary] = try await withThrowingTaskGroup(of: [EventSummary].self) { group in
                for ds in targetDateStrings {
                    group.addTask {
                        let evs = try await ApiClient.shared.fetchEvents(date: ds, category: "オープン")
                        return evs
                    }
                }
                var merged: [EventSummary] = []
                for try await evs in group { merged.append(contentsOf: evs) }
                return merged
            }

            /*
             各イベントのランキングを並列取得し、ローカル辞書でデッキ名ごとの件数をカウント。
             最後に全タスク結果をマージして総件数を得る。
            */
            let deckCount: [String: Int] = try await withThrowingTaskGroup(of: [String: Int].self) { group in
                for ev in allEvents {
                    group.addTask {
                        var local: [String: Int] = [:]
                        let ranks = try await ApiClient.shared.fetchRankings(eventId: ev.id, category: "オープン")
                        for r in ranks {
                            if let name = r.deckName, !name.isEmpty {
                                local[name, default: 0] += 1
                            }
                        }
                        return local
                    }
                }
                var merged: [String: Int] = [:]
                for try await partial in group {
                    for (k,v) in partial { merged[k, default: 0] += v }
                }
                return merged
            }

            // 集計結果を `DeckDistributionItem` へ変換し、件数降順で並べ替えて画面状態へ反映。
            let items: [DeckDistributionItem] = deckCount.map { DeckDistributionItem(name: $0.key, count: $0.value) }
                .sorted { $0.count > $1.count }
            allDecks = items
            await DeckNameAggregationStore.shared.put(fromYmd: fromYmd, toYmd: toYmd, category: "オープン", items: items)
        } catch {
            // 取得フローのどこかで失敗した場合にエラーメッセージを設定。
            errorText = error.localizedDescription
        }
    }
}

private extension ReferenceBuildsView {
    func filterDecks(_ items: [DeckDistributionItem]) -> [DeckDistributionItem] {
        /*
         一覧のフィルタリング処理。
         - 検索語が空の場合は元データをそのまま返す。
         - 部分一致（大文字・小文字を区別しない）でデッキ名を絞り込む。
        */
        var base = items
        if !searchText.isEmpty {
            base = base.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
        }
        return base
    }
}
