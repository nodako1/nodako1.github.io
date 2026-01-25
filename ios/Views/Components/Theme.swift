import SwiftUI

// このファイルはアプリ全体の見た目（色／グラデーション／カード枠／ボタンスタイル）を一か所にまとめています。
// 主な利用箇所:
// - 背景グラデーション: ContentView, ReferenceBuildsView, DaySummaryView, EnvironmentVideosView の画面背景やツールバー
// - カード枠: DaySummaryView, ReferenceBuildsDetailView, ContentView のカード風コンテナ
// - ボタンスタイル: ContentView, ReferenceBuildsView の主要ボタンに適用
// - 色: PokeDeckSwiftApp の `tint` や DeckDistributionView のグラフなどで使用
// このファイルを更新すると、上記のUIの統一感を保ちながら一括でデザインを調整できます。
enum Theme {
    // ブランドに近い配色を集約。`Theme.Colors.◯◯` で参照します。
    // 利用例: PokeDeckSwiftApp での `tint(Theme.Colors.yellow)`、DeckDistributionView の行グラフ色など。
    enum Colors {
        static let blueDeep   = Color(hex: 0x1F2E7A)
        static let blue       = Color(hex: 0x2D4BA8)
        static let blueLight  = Color(hex: 0x4D6FE8)
        static let yellow     = Color(hex: 0xFFD23C)
        static let red        = Color(hex: 0xE35A5A)
        static let purple     = Color(hex: 0xA25BD6)
        static let green      = Color(hex: 0x4FBF6A)
        static let whiteSoft  = Color(hex: 0xF2F4F7)
    }

    // 画面背景や枠線のグラデーションを集約。
    // 利用例: ContentView / ReferenceBuildsView / DaySummaryView / EnvironmentVideosView の `.background(...)` や `.toolbarBackground(...)`。
    enum Gradient {
        static let appBackground = LinearGradient(
            colors: [Colors.blueDeep, Colors.blue, Colors.blueLight],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )

        static let cardStroke = LinearGradient(
            colors: [Colors.yellow.opacity(0.95), Colors.blue.opacity(0.9)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    // データカードやサマリーの囲いに使う軽量コンテナ。
    // 利用例: DaySummaryView / ReferenceBuildsDetailView / ContentView のセクションをカード風に表示。
    struct CardContainer: ViewModifier {
        var cornerRadius: CGFloat = 12
        func body(content: Content) -> some View {
            content
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .fill(Theme.Colors.whiteSoft.opacity(0.98))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .strokeBorder(Gradient.cardStroke, lineWidth: 1)
                )
                .shadow(color: Colors.blue.opacity(0.10), radius: 6, x: 0, y: 2)
        }
    }

    // 画像に薄い縁取りを付ける修飾。必要なビューで視認性を高めたい時に使用。
    // 利用例: スクリーンショットやサムネイル表示で適用（対象ビュー側で `pokemonImageFrame()` を呼び出し）。
    struct ImageFrame: ViewModifier {
        var cornerRadius: CGFloat = 10
        func body(content: Content) -> some View {
            content
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .strokeBorder(Gradient.cardStroke.opacity(0.85), lineWidth: 1)
                )
        }
    }
}

// View拡張: 修飾を簡潔に適用するためのショートカット。
// 例: `SomeView().pokemonCardContainer(cornerRadius: 12)` のように書けます。
extension View {
    func pokemonCardContainer(cornerRadius: CGFloat = 12) -> some View {
        self.modifier(Theme.CardContainer(cornerRadius: cornerRadius))
    }
    func pokemonImageFrame(cornerRadius: CGFloat = 10) -> some View {
        self.modifier(Theme.ImageFrame(cornerRadius: cornerRadius))
    }
}

// ユーティリティ: 16進カラー値から Color を生成。
// `Theme.Colors` の定義で使用しており、デザイン値をコードで管理しやすくします。
extension Color {
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex & 0xFF0000) >> 16) / 255.0
        let g = Double((hex & 0x00FF00) >> 8) / 255.0
        let b = Double(hex & 0x0000FF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}

// 共通ボタンスタイル: ガラス風の見た目を提供します。
// 利用例: ContentView のメイン操作ボタン、ReferenceBuildsView の遷移ボタンで `buttonStyle(ModernGlassButtonStyle(height: ...))` を適用。
// 背景が暗くてもラベルが視認しやすい配色で、押下時に軽い光のエフェクトと縮小アニメーションが入ります。
struct ModernGlassButtonStyle: ButtonStyle {
    let height: CGFloat
    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        configuration.label
            .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
            .padding(.horizontal, 4)
            .background(
                ZStack {
                    LinearGradient(
                        colors: [
                            Color(red: 0.30, green: 0.55, blue: 0.95),
                            Color(red: 0.62, green: 0.40, blue: 0.95)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .opacity(0.85)
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(.ultraThinMaterial)
                        .blendMode(.plusLighter)
                        .opacity(0.30)
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(
                            LinearGradient(colors: [
                                Color.white.opacity(0.65),
                                Color.white.opacity(0.15)
                            ], startPoint: .topLeading, endPoint: .bottomTrailing),
                            lineWidth: 1.2
                        )
                    if pressed {
                        RadialGradient(
                            colors: [
                                Color.white.opacity(0.35),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 4,
                            endRadius: 120
                        )
                        .blur(radius: 6)
                        .opacity(0.8)
                        .transition(.opacity)
                    }
                }
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(color: Color.blue.opacity(0.35), radius: 10, x: 0, y: 6)
            .scaleEffect(pressed ? 0.97 : 1.0)
            .animation(.spring(response: 0.35, dampingFraction: 0.75, blendDuration: 0.15), value: pressed)
    }
}
