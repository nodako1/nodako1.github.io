import SwiftUI

/*
 Rank フィルタ用のタブビューとしきい値定義。

 使用箇所:
 - DaySummaryView: ランキング一覧の上部に配置し、会場ごとの行を「rank <= しきい値」で絞り込み。
 - ReferenceBuildsDetailView: サンプル一覧の上部に配置し、表示対象を「rank <= しきい値」で絞り込み。

 役割:
 - 画面側で表示したいしきい値を `available` に渡す。
 - 選択状態は `selection` 経由で親ビューと共有され、各画面のフィルタ処理（rank の比較）に利用される。
 - 同じタブを再タップすると選択解除（未選択状態）に戻る。
*/

// UI の順位しきい値（この値以下を表示対象にする）
enum RankThreshold: Hashable, CaseIterable {
    case 優勝
    case 準優勝
    case TOP4
    case TOP8
    case TOP16

    // タブに表示する見出し文字列（UI 表示用）
    var label: String {
        switch self {
        case .優勝: return "優勝"
        case .準優勝: return "準優勝"
        case .TOP4: return "TOP4"
        case .TOP8: return "TOP8"
        case .TOP16: return "TOP16"
        }
    }

    // しきい値が許容する最大順位（この値以下を「表示可」と判定）
    // DaySummaryView / ReferenceBuildsDetailView のフィルタ処理で
    // 「rank <= maxRank」の比較に使用される。
    var maxRank: Int {
        switch self {
        case .優勝: return 1
        case .準優勝: return 2
        case .TOP4: return 4
        case .TOP8: return 8
        case .TOP16: return 16
        }
    }
}

// 上部タブ（セグメント）で順位フィルタを選択するビュー
struct RankFilterTabs: View {
    // 画面側が表示したいしきい値の候補（カテゴリに応じて制御）
    // 例: オープンでは [.優勝, .準優勝, .TOP4, .TOP8, .TOP16]
    let available: [RankThreshold]
    // 現在選択されているしきい値。親ビューと双方向に同期し、
    // DaySummaryView / ReferenceBuildsDetailView での絞り込みに使われる。
    @Binding var selection: RankThreshold?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                // 受け取ったしきい値をタブとして横並びにする
                ForEach(available, id: \.self) { t in
                    let isSelected = selection == t
                    // タブの選択ロジック:
                    // - 同じタブを再タップ → 選択解除（未選択に戻す）
                    // - 別タブをタップ → そのしきい値を選択
                    Button(action: {
                        if isSelected { selection = nil } else { selection = t }
                    }) {
                        Text(t.label)
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            // 選択中は白文字・黒背景で強調し、未選択はフラット表示
                            .foregroundStyle(isSelected ? Color.white : Color.black)
                            .background(isSelected ? Color.black : Color.clear)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity)
            .background(Color.white)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    // アプリ共通のカード風枠線を適用
                    .strokeBorder(Theme.Gradient.cardStroke, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }
}
