import SwiftUI
import GoogleMobileAds
import UIKit

/*
 アプリのメイン画面（トップビュー）。
 - タブ切り替え（リーグ/その他）
 - 環境選択 → 日付選択 → 詳細画面への遷移
 - AdMob バナー表示
 - 初期データ読み込み（表示時・タブ切り替え時）
 このファイル内の各要素がどこで使われるかを、宣言付近にコメントでまとめています。
 */

// AdMob の広告ユニットIDを保持。
// 使用箇所: `AdMobBannerView.makeUIView()` で `banner.adUnitID` に設定され、
//            `ContentView` 下部に組み込まれるバナーがこの ID で配信されます。
private enum AdUnitIDs {
#if DEBUG
    static let banner = "ca-app-pub-3940256099942544/2934735716" // テスト用バナーID（Google 公式）
#else
    static let banner = "ca-app-pub-3678233894880325/6639136242" // 本番バナーID（更新）
#endif
}

// SwiftUI から AdMob の `GADBannerView` を表示するためのブリッジ。
// 使用箇所: `ContentView` の最下部で `AdMobBannerView().frame(height: 50)` として表示します。
struct AdMobBannerView: UIViewRepresentable {
    typealias UIViewType = GADBannerView
    final class BannerCoordinator: NSObject, GADBannerViewDelegate {
        func bannerViewDidReceiveAd(_ bannerView: GADBannerView) {
            print("[AdMob] banner loaded: size=\(bannerView.adSize)")
        }
        func bannerView(_ bannerView: GADBannerView, didFailToReceiveAdWithError error: Error) {
            print("[AdMob] banner failed: \(error.localizedDescription)")
        }
    }
    func makeCoordinator() -> BannerCoordinator { BannerCoordinator() }
    @MainActor func makeUIView(context: Context) -> GADBannerView {
        let banner = GADBannerView(adSize: GADAdSizeBanner)
        banner.adUnitID = AdUnitIDs.banner
        banner.delegate = context.coordinator
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let win = scene.windows.first(where: { $0.isKeyWindow }) {
            banner.rootViewController = win.rootViewController
        }
        banner.load(GADRequest())
        return banner
    }
    @MainActor func updateUIView(_ uiView: GADBannerView, context: Context) {}
}

// 画面上部のタブ種別。
// 使用箇所:
// - `ContentView.selectedTab` で現在の表示を制御
// - `initialLoad()` / `loadLeagueDates()` で `apiCategory` を通じて API のカテゴリ指定に利用
// - `tabs` ビュー内のボタン生成に利用
enum AppTab: String, CaseIterable, Identifiable {
    case オープン = "オープン"
    case シニア = "シニア"
    case ジュニア = "ジュニア"
    case デッキ分布 = "デッキ分布"
    case 参考構築 = "参考構築"
    case 環境考察 = "環境考察"
    var id: Self { self }
    var title: String { rawValue }
    var isLeague: Bool { [.オープン,.シニア,.ジュニア].contains(self) }
    var apiCategory: String? { isLeague ? rawValue : nil }
}

struct ContentView: View {
    // リーグタブで表示する日付一覧（APIから取得）。
    // 使用箇所: `leagueOrOtherContent` の日付ボタン生成に利用。
    @State private var dates: [DateItem] = []

    // 現在選択中の日付。遷移とプリロードのトリガーに使います。
    // 使用箇所: 日付ボタンタップで設定し、`navSelection` と併せて詳細画面へ。
    @State private var selectedDate: DateItem?

    // 選択中のタブ。リーグ/その他の切り替えの基準になります。
    // 使用箇所: `tabs` の見た目、`leagueOrOtherContent` の分岐、`initialLoad()` のロジック。
    @State private var selectedTab: AppTab = .オープン

    // ナビゲーション遷移先の選択（iOS17の `navigationDestination(item:)` 用）。
    // 使用箇所: 日付ボタンタップで `navSelection` を設定し、`DaySummaryView` に遷移します。
    @State private var navSelection: DateItem?

    // 画面下部に表示するエラーテキスト。
    // 使用箇所: API 呼び出し失敗時などに表示。
    @State private var errorText: String?

    // 表示可能な環境一覧（APIから取得）。
    // 使用箇所: 環境選択ボタン生成に利用し、選択後に `loadLeagueDates` を実行します。
    @State private var environments: [EnvironmentItem] = []

    // 現在選択中の環境。未選択時は環境一覧、選択後は日付一覧を表示します。
    // 使用箇所: `leagueOrOtherContent` の分岐、`initialLoad()` / `loadLeagueDates()` でロジックに影響。
    @State private var selectedEnvironment: EnvironmentItem?

    // タブボタンの固定幅。画面幅から計算して過度な縮小を防ぎます。
    // 使用箇所: `tabButtonLabel(for:)` のレイアウトに使用。
    private var tabButtonWidth: CGFloat { max(110, (UIScreen.main.bounds.width - 32 - 12*2) / 3) }

    // 画面構成:
    // - 背景グラデーション + NavigationStack
    // - タイトル → タブ群 → コンテンツ（リーグ/その他） → エラーテキスト → 広告バナー
    // - 初期表示時に `initialLoad()` を実行し、iOS 16/17 互換の遷移設定を適用します。
    var body: some View {
        ZStack {
            Theme.Gradient.appBackground.ignoresSafeArea()
            NavigationStack {
                VStack(spacing: 0) {
                    BrandTitle(text: "PokeDeck!", onDark: true, size: 28)
                    Spacer().frame(height: 24)
                    tabs
                    Divider().background(Color.white.opacity(0.2))
                    ScrollView {
                        VStack(spacing: 12) {
                            leagueOrOtherContent
                        }
                        .padding(.horizontal)
                        .padding(.top, 12)
                        .padding(.bottom, 20)
                        .animation(.easeInOut(duration: 0.25), value: selectedTab)
                        // 表示後に選択済み環境のデータが未取得なら読み込み。
                        .onAppear {
                            if selectedTab.isLeague, let env = selectedEnvironment, dates.isEmpty {
                                Task { await loadLeagueDates(environment: env) }
                            }
                        }
                        if let err = errorText {
                            Text(err).foregroundStyle(.red).padding(.horizontal)
                        }
                    }
                    AdMobBannerView().frame(height: 50)
                }
                .background(Theme.Gradient.appBackground.ignoresSafeArea())
                // iOS 17 での `navigationDestination(item:)` を安全に適用するための互換モディファイア。
                .modifier(NavigationDestinationCompat(navSelection: $navSelection, category: selectedTab.apiCategory ?? ""))
                // 初期表示時のデータ読み込み（タブ状態に応じて環境や日付を取得）。
                .task { await initialLoad() }
                .navigationBarTitleDisplayMode(.inline)
            }
        }
    }

    // 上部タブの表示。横スクロール可能で、選択時にアニメーションで中央へ寄せます。
    // 使用箇所: 画面のメイン切り替え UI として、`selectedTab` を更新 → `initialLoad()` を再実行。
    private var tabs: some View {
        VStack(spacing: 8) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(AppTab.allCases) { tab in
                            Button {
                                guard selectedTab != tab else { return }
                                withAnimation(.easeInOut(duration: 0.28)) { selectedTab = tab }
                                withAnimation(.easeInOut(duration: 0.30)) { proxy.scrollTo(tab.id, anchor: .center) }
                                Task { await initialLoad() }
                            } label: { tabButtonLabel(for: tab) }
                            .id(tab.id)
                        }
                    }.padding(.horizontal)
                }
                .onAppear { proxy.scrollTo(selectedTab.id, anchor: .center) }
                .onChange(of: selectedTab) { newVal in
                    // リーグタブ間の切替時は、選択中環境や日付をクリアして一覧に戻します。
                    if newVal.isLeague && selectedEnvironment != nil {
                        selectedEnvironment = nil
                        dates = []
                        selectedDate = nil
                    }
                    withAnimation(.easeInOut(duration: 0.30)) { proxy.scrollTo(newVal.id, anchor: .center) }
                }
            }.padding(.bottom, 8)
        }.padding([.horizontal, .bottom])
    }

    // 初期ロード処理。
    // 実行タイミング: 画面表示時（`.task`）とタブ切り替え時のボタンハンドラ。
    // 役割:
    // - リーグタブなら環境一覧を取得し、開始日が今日（JST）以前のもののみ表示。
    // - 環境選択済みかつ日付未取得なら `loadLeagueDates` を実行。
    // - その他タブなら環境/選択状態をクリア。
    @MainActor
    func initialLoad() async {
        errorText = nil
        if selectedEnvironment == nil { dates = [] }
        if selectedTab.isLeague {
            do {
                var fetched = try await ApiClient.shared.fetchEnvironments()
                // 開始日が本日（JST）以前の環境のみフィルタして表示対象にします。
                let today = DateUtil.ymdString(from: Date())
                fetched = fetched.filter { $0.startYmd <= today }
                environments = fetched
                if let env = selectedEnvironment, dates.isEmpty { await loadLeagueDates(environment: env) }
            } catch { errorText = error.localizedDescription }
        } else {
            environments = []
            selectedEnvironment = nil
        }
    }

    // 選択した環境に対して、リーグの日付一覧を取得して並べ替えます。
    // 使用箇所: 環境ボタン選択後、または表示時（`onAppear`）に呼び出されます。
    // 補足: シニア/ジュニアで日付APIが空の場合は旧APIの形式から日付を生成して補完します。
    @MainActor
    private func loadLeagueDates(environment: EnvironmentItem) async {
        guard selectedTab.isLeague, let cat = selectedTab.apiCategory else { return }
        do {
            var all = try await ApiClient.shared.fetchDates(category: cat, fromYmd: environment.startYmd, toYmd: environment.endYmd)
            if all.isEmpty && (selectedTab == .シニア || selectedTab == .ジュニア) {
                let legacy = try await ApiClient.shared.fetchDates(category: cat)
                let converted: [DateItem] = legacy.compactMap { item in
                    if let dt = DateUtil.parse(item.date) { return DateItem(date: DateUtil.ymdString(from: dt)) }
                    return nil
                }
                all = converted.filter { environment.contains(dateYmd: $0.date) }
            }
            dates = sortDatesDescending(all)
        } catch { errorText = error.localizedDescription }
    }

    // コンテンツ領域。リーグタブでは「環境一覧 → 日付一覧 → 詳細」への動線、
    // その他タブでは個別ビュー（デッキ分布/参考構築/環境考察）や告知テキストを表示します。
    private var leagueOrOtherContent: some View {
        Group {
            if selectedTab.isLeague {
                if selectedEnvironment == nil {
                    if environments.isEmpty {
                        ProgressView().tint(.white)
                            .frame(maxWidth: .infinity, minHeight: 96)
                    } else {
                        ForEach(environments) { env in
                            Button(env.name + " 環境") {
                                withAnimation { selectedEnvironment = env }
                                Task { await loadLeagueDates(environment: env) }
                            }
                            .buttonStyle(ModernGlassButtonStyle(height: 84))
                            .font(.title2.weight(.heavy))
                        }
                    }
                } else if let env = selectedEnvironment {
                    ForEach(dates) { d in
                        Button(buttonTitle(for: d)) {
                            selectedDate = d
                            navSelection = d
                            Task { await preloadDayDataIfNeeded(for: d) }
                        }
                        .buttonStyle(ModernGlassButtonStyle(height: 84))
                        .font(.title2.weight(.semibold))
                        .contentShape(Rectangle())
                    }
                    .onAppear { if dates.isEmpty { Task { await loadLeagueDates(environment: env) } } }
                    Button("環境一覧に戻る") {
                        withAnimation { selectedEnvironment = nil; dates = [] }
                    }
                    .buttonStyle(ModernGlassButtonStyle(height: 84))
                    .font(.title2.weight(.semibold))
                }
            } else {
                if selectedTab == .デッキ分布 { DeckDistributionView().frame(maxWidth: .infinity) }
                else if selectedTab == .参考構築 { ReferenceBuildsView().frame(maxWidth: .infinity) }
                else if selectedTab == .環境考察 { EnvironmentVideosView().frame(maxWidth: .infinity) }
                else {
                    Text(selectedTab.title + " コンテンツは近日追加予定")
                        .frame(maxWidth: .infinity, minHeight: 140)
                        .pokemonCardContainer(cornerRadius: 16)
                }
            }
        }
    }

    // 日付ボタンに表示するタイトル文字列を生成。
    // 使用箇所: `leagueOrOtherContent` の日付一覧ボタン。
    private func buttonTitle(for d: DateItem) -> String {
        let raw = d.date
        if let dt = DateUtil.parse(raw) {
            let f = DateFormatter(); f.locale = Locale(identifier: "ja_JP"); f.dateFormat = "M月d日"
            return f.string(from: dt) + "シティリーグ入賞デッキ"
        }
        if raw.count == 8, Int(raw) != nil {
            let mStr = raw.dropFirst(4).prefix(2)
            let dStr = raw.suffix(2)
            if let m = Int(mStr), let d = Int(dStr) { return "\(m)月\(d)日シティリーグ入賞デッキ" }
        }
        return raw + "シティリーグ入賞デッキ"
    }

    private func parsedDate(from raw: String) -> Date? { DateUtil.parse(raw) }
    // 日付配列を新しい順（降順）に並べ替え。
    // 使用箇所: `loadLeagueDates()` の取得結果整形。
    // 補足: パース不能な要素は元の並び順を保ちつつ後方に寄せます（安定ソート相当）。
    private func sortDatesDescending(_ items: [DateItem]) -> [DateItem] {
        items.enumerated().sorted { lhs, rhs in
            let lDate = parsedDate(from: lhs.element.date)
            let rDate = parsedDate(from: rhs.element.date)
            switch (lDate, rDate) {
            case let (l?, r?): return l > r
            case (nil, nil): return lhs.offset < rhs.offset
            case (nil, _?): return false
            case (_?, nil): return true
            }
        }.map { $0.element }
    }

    // 日付詳細画面へ遷移する前に対象日のデータを先読みして体感速度を向上。
    // 使用箇所: 日付ボタンタップ時に呼び出し、`DaySummaryView` の表示をスムーズにします。
    @MainActor
    private func preloadDayDataIfNeeded(for date: DateItem) async {
        guard let cat = selectedTab.apiCategory else { return }
        _ = try? await DayDataPreloader.shared.preload(date: date.date, category: cat)
    }
}

// Xcode のプレビュー用。UIの即時確認に使用されます。
#Preview { ContentView() }

// iOS 17 以上での `navigationDestination(item:)` を使うための互換モディファイア。
// 使用箇所: `ContentView.body` に `.modifier(...)` として適用。
private struct NavigationDestinationCompat: ViewModifier {
    @Binding var navSelection: DateItem?
    var category: String
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.navigationDestination(item: $navSelection) { d in
                DaySummaryView(dateItem: d, category: category)
            }
        } else { content }
    }
}

// タブボタンの見た目を定義（選択状態で背景・枠線の強調）。
// 使用箇所: `tabs` の `Button` ラベルとして使用。
private extension ContentView {
    @ViewBuilder func tabButtonLabel(for tab: AppTab) -> some View {
        let isSel = (selectedTab == tab)
        let useAccent = false
        let bg: Color = {
            if isSel { return useAccent ? leagueAccentColor.opacity(0.38) : Color.white.opacity(0.18) }
            return Color.white.opacity(0.08)
        }()
        let stroke: Color = {
            if isSel { return useAccent ? leagueAccentColor.opacity(0.95) : Color.white.opacity(0.9) }
            return Color.white.opacity(0.4)
        }()
        Text(tab.title)
            .font(.system(size: 17, weight: .heavy, design: .rounded))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .foregroundStyle(.white)
            .frame(width: tabButtonWidth, height: 44)
            .background(RoundedRectangle(cornerRadius: 12).fill(bg))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(stroke, lineWidth: isSel ? 2 : 1))
    }
    // リーグタブ別のアクセントカラー。必要に応じて `useAccent` を切り替えて使用。
    var leagueAccentColor: Color {
        switch selectedTab {
        case .オープン: return .blue
        case .シニア: return .green
        case .ジュニア: return .pink
        default: return .white
        }
    }
}
