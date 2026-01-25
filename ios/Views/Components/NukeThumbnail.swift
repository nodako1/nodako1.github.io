import SwiftUI
import NukeUI
import Nuke
#if canImport(UIKit)
import UIKit
#endif

// 画像表示用の共通コンポーネント。
// - `NukeFullWidthImage`: 詳細画面や縦並びレイアウトで横幅いっぱいに画像を表示するビュー。
//   利用箇所: [ios/Views/Components/RankingRow.swift](ios/Views/Components/RankingRow.swift#L73), [ios/Views/ReferenceBuildsDetailView.swift](ios/Views/ReferenceBuildsDetailView.swift#L176)
// Nuke の `LazyImage` を使い、共通の `ImagePipelineConfig.shared` を通して画像取得・処理を行います。
// プレースホルダやエラー時も UI が破綻しないよう、同じ見た目のスピナーを重ねています。

// NukeThumbnail は不要方針のため削除済み。横幅いっぱい表示は `NukeFullWidthImage` を使用します。

// 横幅いっぱいで画像を表示するビュー。アスペクト比を維持しつつ最小高さを確保します。
// 代表的な利用箇所: ランキングのフル幅画像表示や参考構築詳細の画像表示。
struct NukeFullWidthImage: View {
    let url: URL?
    var cornerRadius: CGFloat = 8
    var showSpinner: Bool = true
    var minHeight: CGFloat = 160
    @State private var capturedImage: UIImage?

    var body: some View {
        // 端末の画面幅に合わせた目標サイズを計算し、Nuke のリサイズに活用します。
        let targetWidth = UIScreen.main.bounds.width - 32
        LazyImage(source: url) { state in
            if let container = state.imageContainer {
                #if canImport(UIKit)
                // iOS 環境では `UIImage` を直接用いて高品質にリサイズ・描画します。
                Image(uiImage: container.image)
                    .resizable()
                    .antialiased(true)
                    .scaledToFit()
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: minHeight)
                #else
                if let image = state.image {
                    image
                        .resizable()
                        .antialiased(true)
                        .scaledToFit()
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: minHeight)
                } else { placeholder }
                #endif
            } else if state.error != nil {
                errorPlaceholder
            } else {
                placeholder
            }
        }
        .onSuccess { result in
            #if canImport(UIKit)
            // 画像保存のために `UIImage` を保持します（長押し・コンテキストメニュー対応）。
            capturedImage = result.image
            #endif
        }
        // 2倍密度でのリサイズを指示し、Retina 端末でも粗さが出ないようにします。
        .processors([.resize(size: CGSize(width: targetWidth * 2, height: minHeight * 2))])
        .priority(.high)
        .pipeline(ImagePipelineConfig.shared)
        .id(url)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 4)
        // アプリ共通の画像枠スタイル（角丸など）を適用します。
        .pokemonImageFrame(cornerRadius: cornerRadius)
        .contextMenu { if let img = capturedImage { Button("画像を保存") { ImageSaver.saveToPhotos(img) } } }
        .onLongPressGesture(minimumDuration: 0.6) { if let img = capturedImage { ImageSaver.saveToPhotos(img) } }
    }

    private var placeholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius).fill(Color(.secondarySystemBackground))
            // 読み込み中はサムネイルと同様のスピナー演出で一貫性を持たせます。
            ProgressView().tint(Theme.Colors.yellow)
        }
        .frame(maxWidth: .infinity, minHeight: minHeight)
    }

    private var errorPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius).fill(Color(.secondarySystemBackground))
            // エラー時も同じスピナーを表示し、ユーザーに待機中の印象を与えすぎないよう配慮しています。
            ProgressView().tint(Theme.Colors.yellow)
        }
        .frame(maxWidth: .infinity, minHeight: minHeight)
    }
}

// 備考:
// - 画像保存は `ios/Services/ImageSaver.swift` を利用しています。保存の操作は長押しまたはコンテキストメニューから行えます。
// - 画像取得の設定は `ios/Services/ImagePipelineConfig.swift` の共有パイプラインを使って統一しています。
// - `showSpinner` は呼び出し側の意図整理用のプロパティであり、現状このファイル内での分岐には未使用です。