/*
 このファイルはアプリの起動エントリポイントです。
 - `@main` を付与した `PokeDeckSwiftApp` が SwiftUI アプリの開始点になります。
 - 起動直後に Google Mobile Ads SDK を初期化します。これはアプリ内の広告表示処理（バナーやインタースティシャル等）で使用するため、
     各ビューから安全に利用できる状態を事前に用意する目的です。
 - `WindowGroup` で最初に表示する画面を `ContentView` に設定し、`tint` でアプリ全体のアクセントカラーを適用します。
     これにより、ボタンやリンクなどの共通UIコンポーネントにブランドカラーが反映されます。
*/

// UI を構築するためのフレームワーク
import SwiftUI
// 広告表示のために使用する Google Mobile Ads SDK（広告関連のビューで利用）
import GoogleMobileAds


@main
struct PokeDeckSwiftApp: App {
    init() {
        // アプリ起動直後に広告SDKを初期化して、広告を表示する各ビューから利用可能な状態を用意します。
        // 例：バナー表示ビュー、一覧に挿入する広告セル、詳細画面のインタースティシャルなどの処理で使用されます。
        Task { @MainActor in
            // MainActor 上で実行し、UI スレッドと整合性を保ちながら初期化します。
            _ = await GADMobileAds.sharedInstance().start()
        }
    }
    var body: some Scene {
        // アプリのシーン（ウィンドウ）構成を定義します。
        // 起動時のルート画面として `ContentView` を表示し、`tint` によりアプリ全体のアクセントカラーを適用します。
        // この色設定はボタン、リンク、スイッチなどの共通コンポーネントに反映され、画面間で統一感を保ちます。
        WindowGroup {
            ContentView()
                .tint(Theme.Colors.yellow)
        }
    }
}
