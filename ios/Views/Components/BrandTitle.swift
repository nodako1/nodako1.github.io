import SwiftUI

/*
 アプリ共通のタイトル用コンポーネント。
 
 目的:
 - 画面の見出しやナビゲーションバーのタイトルとして、強調された文字スタイルで表示する。
 - ダーク背景上での可読性を保つため、必要に応じて文字色と影を調整する。

 主な使用箇所（実装参照）:
 - 画面ヘッダー: ContentView（アプリトップのヘッダー）
 - ナビゲーションバータイトル: DaySummaryView（勝利デッキの一覧画面）
 - ナビゲーションバータイトル: ReferenceBuildsDetailView（参考構築の詳細画面）

 使い方の例:
   BrandTitle(text: "PokeDeck!", onDark: true, size: 28)
   BrandTitle(text: deckName, onDark: true)
*/
struct BrandTitle: View {
    /// 表示するタイトル文字列
    let text: String
    /// ダーク背景上での表示かどうか（true なら白文字＋薄い影を付与）
    var onDark: Bool = false
    /// タイトルの文字サイズ（ポイント）。既定値は 32。
    var size: CGFloat = 32

    var body: some View {
        // タイトル文字のベース
        Text(text)
            // 強調表示のため太字＋Rounded デザインを採用
            .font(.system(size: size, weight: .heavy, design: .rounded))
            // わずかに文字間隔を広げて視認性を向上
            .kerning(0.5)
            // 背景が暗い場合は白文字、通常はシステムの主テキスト色
            .foregroundStyle(onDark ? Color.white : Color.primary)
            // ダーク背景でのみごく薄いシャドウを付与し読みやすさを補助
            .shadow(color: (onDark ? .black.opacity(0.15) : .clear), radius: 2, x: 0, y: 1)
    }
}
