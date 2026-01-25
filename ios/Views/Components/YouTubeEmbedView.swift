import SwiftUI
import SwiftUI
import WebKit

/// YouTube の動画を SwiftUI から埋め込み表示するための `WKWebView` ラッパー。
/// 利用箇所:
/// - `EnvironmentVideosView`: サーバから取得した最新動画（`ApiClient.fetchYoutubeLatest`）の表示に使用。
/// - モデル: `YoutubeVideoItem` の `videoId` を `YouTubeEmbedView(videoId:)` に渡して描画。
///
/// 方針概要:
/// - WebKit の `WKWebView` を使い、16:9 比率を保つレスポンシブな `iframe` を読み込む。
/// - YouTube の「クッキーを保存しない」ドメイン（youtube-nocookie.com）を使用してプライバシー配慮。
/// - iOS 上でインライン再生（フルスクリーン強制でなくその場再生）を有効化。
struct YouTubeEmbedView: UIViewRepresentable {
    let videoId: String

    func makeUIView(context: Context) -> WKWebView {
        // 動画再生の振る舞いを調整するための WebView 設定。
        // - インライン再生を許可: ページ内でシームレスに再生できる。
        // - iOS では、ユーザー操作無しでも再生できるメディアタイプ制約を解除。
        let conf = WKWebViewConfiguration()
        conf.allowsInlineMediaPlayback = true
        #if os(iOS)
        conf.mediaTypesRequiringUserActionForPlayback = []
        #endif
        // 画面スクロールを無効化し、背景を透過にして他のビューと調和させる。
        let webView = WKWebView(frame: .zero, configuration: conf)
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // 16:9 のレスポンシブレイアウトを CSS で実現するために、
        // `padding-top: 56.25%` を持つラッパー要素内に `iframe` を絶対配置します。
        // 埋め込みプレイヤーは youtube-nocookie.com を使用し、`playsinline=1` でインライン再生を指定。
        // `rel=0` により関連動画の表示を抑え、利用体験をシンプルに保ちます。
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
          <meta name=viewport content="width=device-width, initial-scale=1, maximum-scale=1">
          <style>html,body{margin:0;padding:0;background:transparent;} .wrap{position:relative;padding-top:56.25%;} .wrap iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;border-radius:12px;}</style>
        </head>
        <body>
          <div class="wrap">
            <iframe src="https://www.youtube-nocookie.com/embed/\(videoId)?rel=0&playsinline=1" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
          </div>
        </body>
        </html>
        """
        // `baseURL` に nocookie ドメインを渡すことで、相対参照や CSP を安全側に寄せます。
        uiView.loadHTMLString(html, baseURL: URL(string: "https://www.youtube-nocookie.com"))
    }
}
