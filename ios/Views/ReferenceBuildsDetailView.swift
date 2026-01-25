import SwiftUI

// この画面の目的
// - 「参考構築一覧（ReferenceBuildsView）」から遷移して、選択したデッキ名の入賞構築を最新順で一覧表示します。
// - 画面上部の順位フィルタ（優勝/準優勝/TOP4/TOP8/TOP16）で絞り込みができます。
// - データは`ApiClient`を通じて取得し、画像表示はランキング画面と同じ挙動（Nukeを利用したフル幅表示）を踏襲します。
// - 表示時（.task）に非同期でロードし、欠落した順位はイベントのランキング情報から補完します（enrichRanksIfNeeded）。

struct ReferenceBuildsDetailView: View {
    let deckName: String
    // 週範囲絞り込みの指定。
    // - `ReferenceBuildsView`から渡される期間がある場合、その週に限定してサンプルを取得します。
    // - 指定がない場合（nilのとき）、直近90日分から取得します。
    var fromYmd: String? = nil
    var toYmd: String? = nil
    @State private var items: [DeckSampleItem] = []
    @State private var errorText: String?
    @State private var isLoading = false
    // ランキング補完の重複実行を防ぐためのフラグ。
    @State private var didEnrichRanks = false
    @State private var selectedRankFilter: RankThreshold? = nil

    // フィルタ適用後に画面へ表示するサンプル（取得順＝最新順をそのまま使用）。
    private var filteredItems: [DeckSampleItem] {
        // TOP16選択時は全件表示。それ以外は選択した順位の上限（maxRank）で絞り込みます。
        if selectedRankFilter == .TOP16 { return items }
        let cutoff = selectedRankFilter?.maxRank ?? 16
        return items.filter { (($0.rank ?? Int.max) <= cutoff) }
    }
    private var visibleItems: [DeckSampleItem] { filteredItems }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                // 画面上部の順位フィルタタブ。
                // - この詳細画面では「優勝/準優勝/TOP4/TOP8/TOP16」を選択可能です。
                RankFilterTabs(available: [.優勝, .準優勝, .TOP4, .TOP8, .TOP16], selection: $selectedRankFilter)
                if isLoading && items.isEmpty {
                    // データがまだ無く、ロード中のときはスピナーのみ表示します。
                    ProgressView().tint(.white)
                        .frame(maxWidth: .infinity, minHeight: 100)
                }
                ForEach(visibleItems) { it in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            let displayTitle = sampleTitle(it)
                            if let link = it.deckUrl, let u = URL(string: link) {
                                // デッキのURLが取得できている場合は、押下で外部リンクを開きます。
                                Button(action: { UIApplication.shared.open(u) }) {
                                    Text(displayTitle)
                                        .monospaced()
                                        .font(.headline)
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(Theme.Colors.blue)
                            } else {
                                // URLが無い場合はテキストのみ（色は通常の本文色）。
                                Text(displayTitle)
                                    .monospaced()
                                    .font(.headline)
                                    .foregroundStyle(Color.primary)
                            }
                            Spacer()
                        }
                        // 会場（organizer）と開催日（月日：dateMD）を補助情報として表示します。
                        if let org = it.organizer, !org.isEmpty {
                            Text(org)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.black) // ダークモードでも常に黒
                        }
                        if let dm = it.dateMD, !dm.isEmpty {
                            Text(dm)
                                .font(.caption)
                                .foregroundStyle(Color.black) // ダークモードでも常に黒
                        }
                        // デッキリスト画像のフル幅表示。ランキング画面と同じ演出（角丸8、スピナー連動）。
                        SampleFullImage(item: it)
                            .frame(minHeight: 120)
                    }
                    .pokemonCardContainer(cornerRadius: 12)
                }
                // 現在は「全件表示」方針のため、ロードモアは設置していません。
            }
            .padding()
            if let err = errorText { Text(err).foregroundColor(.red).padding() }
        }
        .background(Theme.Gradient.appBackground.ignoresSafeArea())
        .toolbar {
            ToolbarItem(placement: .principal) {
                // ナビゲーションバー中央にデッキ名をブランドスタイルで表示します。
                BrandTitle(text: deckName, onDark: true, size: 28)
            }
        }
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarBackground(Theme.Gradient.appBackground, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        // 画面表示時に非同期ロードを開始します。
        .task { await load() }
    }

    @MainActor
    private func load() async {
        // 画面データの取得処理。
        // - 期間指定があれば週範囲でサンプルを取得。
        // - 指定がなければ直近90日分を取得。
        // - 取得後、順位が欠落しているサンプルはランキング情報から補完します。
        isLoading = true
        defer { isLoading = false }
        do {
            if let f = fromYmd, let t = toYmd {
                // 週範囲が指定されている場合、その期間に該当する同名デッキのサンプルを取得します。
                items = try await ApiClient.shared.fetchDeckSamplesRange(name: deckName, fromYmd: f, toYmd: t, category: "オープン")
            } else {
                // 期間指定がない場合のデフォルト：直近約3ヶ月（90日）から取得します。
                items = try await ApiClient.shared.fetchDeckSamples(name: deckName, days: 90, category: "オープン")
            }
            // 取得したサンプルのうち、順位が欠落しているものはランキングAPIから補完します。
            await enrichRanksIfNeeded()
            // 現在は可視件数の制御は行わず、全件表示します。
        } catch {
            errorText = error.localizedDescription
        }
    }
}

private extension ReferenceBuildsDetailView {
    func rankLabel(for rank: Int?) -> String {
        guard let rank = rank else { return "入賞" }
        switch rank {
        case 1: return "優勝"
        case 2: return "準優勝"
        case 3: return "TOP4"
        default: return "入賞"
        }
    }
    func sampleTitle(_ item: DeckSampleItem) -> String {
        // サンプルのタイトル文字列。ここでは順位ラベルのみを表示します。
        return rankLabel(for: item.rank)
    }

    @MainActor
    func enrichRanksIfNeeded() async {
        // 欠落している順位（rank）をランキング情報から補完します。
        // 使用箇所：`load()`でサンプル取得後に一度だけ実行。
        // 処理概要：
        // 1. rankがnilで、イベントID（originalEventId）があるサンプルを対象にします。
        // 2. 対象イベントIDごとにランキング（deckUrl / deckListImageUrl -> rank）を並列取得します（過剰呼び出し防止で最大50件）。
        // 3. URL一致または画像URL一致でrankを補完し、`items`を差し替えます。
        guard !didEnrichRanks else { return }
        let targets = items.filter { $0.rank == nil && $0.originalEventId != nil }
        guard !targets.isEmpty else { didEnrichRanks = true; return }
        let eventIds = Set(targets.prefix(50).compactMap { $0.originalEventId })
        // `maps`は eventId ごとの「デッキキー（URL/画像URL）→順位」の辞書です。
        var maps: [String: [String: Int]] = [:]
        await withTaskGroup(of: (String, [String: Int]).self) { group in
            for eid in eventIds {
                group.addTask {
                    do {
                        let rankings = try await ApiClient.shared.fetchRankings(eventId: eid, category: "オープン")
                        var map: [String: Int] = [:]
                        for r in rankings {
                            if let rank = r.rank {
                                if let url = r.deckUrl { map[url] = rank }
                                if let img = r.deckListImageUrl { map[img] = rank }
                            }
                        }
                        return (eid, map)
                    } catch {
                        return (eid, [:])
                    }
                }
            }
            for await (eid, map) in group { maps[eid] = map }
        }
        var newItems: [DeckSampleItem] = []
        newItems.reserveCapacity(items.count)
        for it in items {
            if it.rank == nil, let eid = it.originalEventId {
                let map = maps[eid] ?? [:]
                var resolvedRank: Int? = nil
                if let url = it.deckUrl, let r = map[url] { resolvedRank = r }
                else if let img = it.deckListImageUrl, let r = map[img] { resolvedRank = r }
                if let r = resolvedRank {
                    let enriched = DeckSampleItem(deckName: it.deckName, rank: r, originalEventId: it.originalEventId, player: it.player, deckUrl: it.deckUrl, deckListImageUrl: it.deckListImageUrl, dateMD: it.dateMD, organizer: it.organizer)
                    newItems.append(enriched)
                    continue
                }
            }
            newItems.append(it)
        }
        items = newItems
        didEnrichRanks = true
    }
}

// 画像表示用のサブビュー。
// - この詳細画面の各サンプルで使用します（`SampleFullImage(item:)`）。
// - ランキング画面と同じ「フル幅・角丸8・スピナー連動」の表示仕様に合わせています。
private struct SampleFullImage: View {
    let item: DeckSampleItem
    @State private var url: URL?
    @State private var triedFetch = false
    var body: some View {
        NukeFullWidthImage(url: url, cornerRadius: 8, showSpinner: !triedFetch || url != nil)
            .task { await ensureURL() }
    }
    private func ensureURL() async {
        if triedFetch { return }
        await MainActor.run { triedFetch = true }
        if let p = item.deckListImageUrl?.trimmingCharacters(in: .whitespacesAndNewlines), !p.isEmpty, let u = URL(string: p), ["http","https"].contains(u.scheme?.lowercased() ?? "") {
            await MainActor.run { url = u }
        }
    }
}
