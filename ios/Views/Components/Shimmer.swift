import SwiftUI

// シンプルな Shimmer 効果を提供するコンポーネント
// 役割: ローディングプレースホルダーや画像の読み込み中に、視覚的な動きを与えるための汎用 View
// 使い方例:
//   Rectangle().frame(height: 100).shimmer()
//   Text("Loading...").padding().shimmer(active: true, cornerRadius: 12)
public struct Shimmer: View {
    public var cornerRadius: CGFloat
    public var baseColor: Color
    public var highlightColor: Color
    public var animationDuration: Double

    @State private var isAnimating: Bool = false

    public init(
        cornerRadius: CGFloat = 8,
        baseColor: Color = Color.gray.opacity(0.15),
        highlightColor: Color = Color.white.opacity(0.6),
        animationDuration: Double = 1.4
    ) {
        self.cornerRadius = cornerRadius
        self.baseColor = baseColor
        self.highlightColor = highlightColor
        self.animationDuration = animationDuration
    }

    public var body: some View {
        GeometryReader { geo in
            let size = geo.size
            RoundedRectangle(cornerRadius: cornerRadius)
                .fill(baseColor)
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .fill(
                            LinearGradient(
                                colors: [Color.clear, highlightColor, Color.clear],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .rotationEffect(.degrees(20))
                        .offset(x: isAnimating ? size.width : -size.width)
                        .blendMode(.screen)
                )
                .onAppear {
                    withAnimation(.linear(duration: animationDuration).repeatForever(autoreverses: false)) {
                        isAnimating = true
                    }
                }
        }
    }
}

public struct ShimmerModifier: ViewModifier {
    public var active: Bool
    public var cornerRadius: CGFloat

    public func body(content: Content) -> some View {
        content.overlay(
            Group {
                if active { Shimmer(cornerRadius: cornerRadius) } else { EmptyView() }
            }
        )
    }
}

public extension View {
    /// 任意の View に Shimmer 効果を重ねます。
    /// - Parameters:
    ///   - active: true の場合に shimmer を適用します。
    ///   - cornerRadius: 角丸の半径を指定します。
    /// - Returns: Shimmer オーバーレイ付きの View
    func shimmer(active: Bool = true, cornerRadius: CGFloat = 8) -> some View {
        modifier(ShimmerModifier(active: active, cornerRadius: cornerRadius))
    }
}

#if DEBUG
struct Shimmer_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 16) {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.gray.opacity(0.15))
                .frame(height: 80)
                .overlay(Text("Placeholder").foregroundColor(.gray))
                .shimmer(active: true, cornerRadius: 12)

            HStack(spacing: 12) {
                Circle().fill(Color.gray.opacity(0.15)).frame(width: 44, height: 44).shimmer()
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 6).fill(Color.gray.opacity(0.15)).frame(height: 16).shimmer()
                    RoundedRectangle(cornerRadius: 6).fill(Color.gray.opacity(0.15)).frame(width: 180, height: 16).shimmer()
                }
            }
        }
        .padding()
        .previewLayout(.sizeThatFits)
    }
}
#endif
