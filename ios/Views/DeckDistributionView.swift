/*
  画面の役割:
  - 「デッキ分布」タブで表示される週次の上位デッキ出現分布（今週/先週）を、棒グラフで見やすく提示します。

  使用する処理（どこで何を使っているか）:
  - 週範囲の算出とラベル生成: `WeekRangeUtil.weekBoundaries(for:)` / `WeekRangeUtil.labelString(_:)`
  - データのキャッシュ参照: `DeckDistributionPreloadStore.shared.get(fromYmd:toYmd:category:)`
  - データのネットワーク取得: `ApiClient.shared.fetchDeckDistributionRange(fromYmd:toYmd:category:)`
  - 棒グラフの行表示: このファイル内の `DeckBarRow` を利用

  画面からの使用箇所:
  - `ContentView` のその他タブ切り替えで「デッキ分布」を選択した際に、このビューを表示します。

  データ仕様の補足:
  - シティリーグの TOP4 以上入賞デッキのみを集計しており、カテゴリは「オープン」に固定しています。
*/
import SwiftUI
import Charts

struct DeckDistributionView: View {
    // 表示対象カテゴリ（API/キャッシュの category 引数に使用）。この画面では「オープン」に固定します。
    private let fixedCategory: String = "オープン"
    
    // 今週/先週の分布データ。`load()` のキャッシュ参照と API 取得で更新され、リストと棒グラフに反映されます。
    @State private var thisWeek: [DeckDistributionItem] = []
    @State private var lastWeek: [DeckDistributionItem] = []
    
    // 取得失敗時のメッセージ表示用。API/キャッシュアクセスの例外内容を反映します。
    @State private var errorText: String?
    // 読み込み中インジケータの表示制御。`load()` 実行中に true になります。
    @State private var isLoading = false

    // 画面見出しに表示する週範囲のラベル文字列（例: "(1/1〜1/7)"）。`load()` 内で計算します。
    @State private var thisWeekRangeLabel: String = ""
    @State private var lastWeekRangeLabel: String = ""

    // 週の開始/終了日と前週の開始/終了日をまとめて取得します。`load()` で利用。
    private func weekBoundaries(for date: Date = Date()) -> (thisFrom: Date, thisTo: Date, lastFrom: Date, lastTo: Date) { WeekRangeUtil.weekBoundaries(for: date) }
    // `Date` を API/キャッシュ指定に使う YYYYMMDD 形式の文字列に変換。`load()` で利用。
    private func ymdString(_ d: Date) -> String { WeekRangeUtil.ymdString(d) }
    // 週表示用の短いラベル（例: "1/1"）を生成。見出しテキストに使用します。
    private func labelString(_ d: Date) -> String { WeekRangeUtil.labelString(d) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // 画面タイトル。上位デッキの週次シェア率を表示することを示します。
            Text("上位デッキのシェア率")
                .font(.title3.weight(.heavy))
                .foregroundColor(.white)
                .padding(.bottom, 4)
            if isLoading { ProgressView().tint(.white) }
            if let err = errorText { Text(err).foregroundColor(.red) }

            // 今週セクション（週範囲ラベル → 棒グラフ一覧）。
            // データが空の場合はプレースホルダを表示します。
            Group {
                Text("今週 \(thisWeekRangeLabel)")
                    .font(.headline)
                    .foregroundColor(.white.opacity(0.9))
                if thisWeek.isEmpty {
                    Text("データがありません")
                        .foregroundColor(.white.opacity(0.7))
                        .frame(maxWidth: .infinity, minHeight: 60)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.08)))
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        // 棒グラフのスケール計算。最大値で正規化し、各行の進捗幅に反映します。
                        let maxCount = Swift.max(thisWeek.map { $0.count }.max() ?? 1, 1)
                        // 全体の出現数合計。各デッキのシェア率（％）を計算するために使用します。
                        let totalCount = thisWeek.reduce(0) { $0 + $1.count }
                        ForEach(thisWeek, id: \.name) { item in
                            // シェア率（％）の算出。見出しに「デッキ名（xx.x%）」の形式で表示します。
                            let share = totalCount > 0 ? (Double(item.count) / Double(totalCount) * 100.0) : 0
                            Text("\(item.name)（\(formatShare(share))%）")
                                .foregroundColor(.white)
                                .font(.callout.weight(.semibold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                            // 1 行分の棒グラフ。`maxValue` で正規化し、色は今週用に青系を使用します。
                            DeckBarRow(name: item.name, count: item.count, maxValue: maxCount, color: Theme.Colors.blueLight)
                        }
                    }
                    // データの集計方針に関する注記。
                    Text("※シティリーグTOP4入り以上のデッキのみを集計しています")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                }
            }

            Divider().background(Color.white.opacity(0.2))

            // 先週セクション（今週と同様の構成）。棒グラフは視認性のため黄系を使用します。
            Group {
                Text("先週 \(lastWeekRangeLabel)")
                    .font(.headline)
                    .foregroundColor(.white.opacity(0.9))
                if lastWeek.isEmpty {
                    Text("データがありません")
                        .foregroundColor(.white.opacity(0.7))
                        .frame(maxWidth: .infinity, minHeight: 60)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.08)))
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        let maxCount = Swift.max(lastWeek.map { $0.count }.max() ?? 1, 1)
                        let totalCount = lastWeek.reduce(0) { $0 + $1.count }
                        ForEach(lastWeek, id: \.name) { item in
                            let share = totalCount > 0 ? (Double(item.count) / Double(totalCount) * 100.0) : 0
                            Text("\(item.name)（\(formatShare(share))%）")
                                .foregroundColor(.white)
                                .font(.callout.weight(.semibold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                            DeckBarRow(name: item.name, count: item.count, maxValue: maxCount, color: Theme.Colors.yellow)
                        }
                    }
                    Text("※シティリーグTOP4入り以上のデッキのみを集計しています")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                }
            }

            Spacer(minLength: 0)
        }
        .padding()
        .background(Theme.Gradient.appBackground.ignoresSafeArea())
        // 画面表示時に非同期で `load()` を実行し、データとラベルを準備します。
        .task { await load() }
    }

    @MainActor
    private func load() async {
        // 読み込み開始/終了のフラグ管理。
        isLoading = true
        defer { isLoading = false }
        // 今週と先週の週範囲（開始/終了）を計算し、見出しラベルを生成します。
        let (tf, tt, lf, lt) = weekBoundaries()
        thisWeekRangeLabel = "(\(labelString(tf))〜\(labelString(tt)))"
        lastWeekRangeLabel = "(\(labelString(lf))〜\(labelString(lt)))"
        do {
            // 1) 可能ならキャッシュを先に使用（表示を早めるため）。
            // 2) キャッシュが無い週は API から非同期で取得。
            //    async-let を用いて今週/先週を並列で待ち合わせし、体感速度を向上させます。
            if let cachedA = await DeckDistributionPreloadStore.shared.get(fromYmd: ymdString(tf), toYmd: ymdString(tt), category: fixedCategory) {
                thisWeek = cachedA
            }
            if let cachedB = await DeckDistributionPreloadStore.shared.get(fromYmd: ymdString(lf), toYmd: ymdString(lt), category: fixedCategory) {
                lastWeek = cachedB
            }
            async let a: [DeckDistributionItem] = thisWeek.isEmpty ? ApiClient.shared.fetchDeckDistributionRange(fromYmd: ymdString(tf), toYmd: ymdString(tt), category: fixedCategory) : .init(thisWeek)
            async let b: [DeckDistributionItem] = lastWeek.isEmpty ? ApiClient.shared.fetchDeckDistributionRange(fromYmd: ymdString(lf), toYmd: ymdString(lt), category: fixedCategory) : .init(lastWeek)
            let (aw, bw) = try await (a, b)
            thisWeek = aw
            lastWeek = bw
        } catch {
            // 例外時はメッセージを画面に表示します。
            errorText = error.localizedDescription
        }
    }
}

// シェア率（％）表示用の丸め処理。小数第 1 位で丸め、"xx.x" の形式に整えます。
private func formatShare(_ value: Double) -> String {
    let rounded = (value * 10).rounded() / 10
    return String(format: "%.1f", rounded)
}

// Xcode プレビュー。開発中に UI の見た目を確認するために使用します。
#Preview {
    ZStack { Color.black.ignoresSafeArea(); DeckDistributionView().padding() }
}

// 棒グラフ 1 行を描画するための補助ビュー。
// 役割:
// - バーの進捗幅を `count / maxValue` で正規化して計算
// - アニメーションで値に追従 (`onAppear` / `onChange`)
// - 右端に合計値ラベルを表示（バーの内外で見やすく配置を調整）
private struct DeckBarRow: View {
    let name: String
    let count: Int
    let maxValue: Int
    let color: Color

    @State private var progress: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            // 正規化されたターゲット幅（0.0〜1.0）。最大値が 0 にならないよう保護します。
            let total = Swift.max(CGFloat(maxValue), 1)
            let target = max(min(CGFloat(count) / total, 1), 0)
            let w = geo.size.width * progress
            let showInside = w > 52

            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Theme.Gradient.cardStroke.opacity(0.35), lineWidth: 1)
                    )
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        LinearGradient(colors: [
                            color.opacity(0.95),
                            color.opacity(0.75)
                        ], startPoint: .leading, endPoint: .trailing)
                    )
                    .frame(width: w)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(LinearGradient(colors: [Color.white.opacity(0.25), .clear], startPoint: .top, endPoint: .bottom))
                            .frame(width: w)
                            .blendMode(.screen)
                    )
                    .shadow(color: color.opacity(0.25), radius: 6, x: 0, y: 2)

                HStack {
                    Spacer()
                    Text("\(count)")
                        .font(.caption.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule().fill(Color.white.opacity(showInside ? 0.18 : 0.14))
                        )
                        .overlay(
                            Capsule().stroke(Color.white.opacity(0.35), lineWidth: 1)
                        )
                        .foregroundColor(.white)
                        .padding(.trailing, showInside ? 6 : -6)
                }
                .frame(width: w)
            }
            // 初回表示時のアニメーション。目標幅へ緩やかに遷移します。
            .onAppear {
                progress = 0
                withAnimation(.easeOut(duration: 0.7)) { progress = target }
            }
            // 最大値・カウントが変わった場合もアニメーションで更新します。
            .onChange(of: maxValue) { _ in
                withAnimation(.easeOut(duration: 0.5)) { progress = target }
            }
            .onChange(of: count) { _ in
                withAnimation(.easeOut(duration: 0.5)) { progress = target }
            }
        }
        .frame(height: 28)
    }
}
