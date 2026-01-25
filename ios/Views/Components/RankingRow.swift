// ランキング1件分（順位ラベル + デッキ画像）を表示する行コンポーネント。
// 主な利用箇所: DaySummaryView のランキング一覧（会場ごとの入賞デッキ表示）で、
// `RankingRow(r:)` を `ForEach` 内から呼び出して使用します。
// 表示仕様:
// - ラベルは `rankLabel(for:)` により順位を人が読める文言に変換（例: 1→優勝、2→準優勝、3〜4→TOP4 など）。
// - ラベルは `deckUrl` があれば外部ページへのリンク、なければ通常テキスト。
// - 画像は `RankingFullImage` を使い、`deckListImageUrl`（http/https のみ）から取得して表示。
// アクセシビリティ仕様:
// - ラベルと画像それぞれに、順位とプレイヤー名で構成したアクセシビリティラベルを設定。
import SwiftUI

struct RankingRow: View {
    let r: RankingItem
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // deckUrl が設定されている場合は、順位ラベルをリンクとして表示。
            // DaySummaryView の一覧からタップすると、主催者ページやデッキ詳細へ遷移できる設計です。
            if let urlStr = r.deckUrl, let url = URL(string: urlStr) {
                Link(rankLabel(for: r.rank), destination: url)
                    .monospaced()
                    .font(.headline)
                    .foregroundStyle(Theme.Colors.blue)
                    .accessibilityLabel(Text(accessibilityRankLabel(for: r)))
            } else {
                // deckUrl が無い場合は通常テキストとして表示。
                Text(rankLabel(for: r.rank))
                    .monospaced()
                    .font(.headline)
                    .foregroundStyle(Color.primary)
                    .accessibilityLabel(Text(accessibilityRankLabel(for: r)))
            }
            // デッキ画像（フル幅）を表示。`deckListImageUrl` のみを使用します。
            RankingFullImage(r: r)
                .frame(minHeight: 120)
                .accessibilityLabel(Text(accessibilityImageLabel(for: r)))
        }
        .padding(.vertical, 6)
    }
}

// ラベル文言の生成（どの順位範囲をどう表記するか）。
// 利用箇所: 本ファイル内のラベル表示およびアクセシビリティラベル生成で共通使用。
// 例: rank=nil → "入賞"、1→"優勝"、2→"準優勝"、3〜4→"TOP4"、5〜8→"TOP8"、9〜16→"TOP16"、以降→ "#<rank>"。

private func rankLabel(for rank: Int?) -> String {
    guard let rank = rank else { return "入賞" }
    if rank == 1 { return "優勝" }
    if rank == 2 { return "準優勝" }
    if rank <= 4 { return "TOP4" }
    if rank <= 8 { return "TOP8" }
    if rank <= 16 { return "TOP16" }
    return "#\(rank)"
}

// ラベルのアクセシビリティ用テキスト。順位に加えてプレイヤー名があれば付加します。
// 利用箇所: ラベル表示（Link/Text）の `.accessibilityLabel`。
private func accessibilityRankLabel(for r: RankingItem) -> String {
    let base = rankLabel(for: r.rank)
    if let player = r.player, !player.isEmpty { return base + "：" + player }
    return base
}

// 画像のアクセシビリティ用テキスト。視覚的に表示される順位+プレイヤー名の情報を音声読み上げ向けにまとめます。
// 利用箇所: `RankingFullImage` の `.accessibilityLabel`。
private func accessibilityImageLabel(for r: RankingItem) -> String {
    var parts: [String] = [rankLabel(for: r.rank)]
    if let player = r.player, !player.isEmpty { parts.append(player) }
    return parts.joined(separator: "：")
}

// フル幅画像表示用のサブビュー。
// 主な役割: `RankingRow` から渡された `RankingItem` から `deckListImageUrl` を取り出し、
// http/https のときのみ画像ダウンロードを行って表示します（プレースホルダは NukeFullWidthImage 側）。
// 利用箇所: `RankingRow` の本文で常に使用。
struct RankingFullImage: View {
    let r: RankingItem
    @State private var url: URL?
    @State private var expiresAt: Date?
    @State private var triedFetch = false

    var body: some View {
        // `url` が設定されるまではプレースホルダ／スピナーを表示。
        NukeFullWidthImage(url: url, showSpinner: !triedFetch || url != nil)
            .task { await ensureURL() }
    }

    private func ensureURL() async {
        if triedFetch { return }
        await MainActor.run { triedFetch = true }
        // 画像URLの決定ロジック:
        // - `deckListImageUrl` のみ使用（http/https）。
        // - 有効なURLが得られた場合のみ `url` を更新し、画像読込を開始します。
        if let p = r.deckListImageUrl?.trimmingCharacters(in: .whitespacesAndNewlines), !p.isEmpty, let u = URL(string: p), ["http","https"].contains(u.scheme?.lowercased() ?? "") {
            await MainActor.run {
                self.url = u
                self.expiresAt = nil
            }
            return
        }
        // URLが不正または存在しない場合は、画像は表示されずプレースホルダのままになります。
    }
}
