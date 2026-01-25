// EnvironmentVideosView
// 環境考察タブで、指定チャンネルの最新動画を一覧表示する View。
// 表示の流れ: `.task { await load() }` で非同期に動画を取得 → `latestVideos` に保存 → `body` 内の `ForEach` でカード表示。
// 使用している主な処理/部品:
// - `ApiClient.fetchYoutubeLatest`: チャンネルごとの最新動画の取得（`load()` から呼び出し）。
// - `YouTubeEmbedView`: 取得した `videoId` を使って YouTube を埋め込み表示。
// - `Theme.Gradient.appBackground`: 画面の背景グラデーション。
// 呼び出し元の例: ContentView の「環境考察」タブからこの View が表示されます。
import SwiftUI

struct EnvironmentVideosView: View {
    // 対象の YouTube チャンネルのハンドル一覧。
    // `load()` 内でこの一覧を基に、各チャンネルの最新動画を並列で取得します。
    private let handles: [String] = ["@PokecaCH", "@325", "@はるn", "@ch-cx3mx"]

    // 取得した最新動画の配列。
    // `body` の `ForEach(latestVideos)` で表示に使用します。
    @State private var latestVideos: [YoutubeVideoItem] = []

    // 取得時のエラー文言を表示するための状態。
    // `body` 内で `Text(err)` として使用します（現状、`load()` 内では個別取得エラーを握りつぶしているため未設定）。
    @State private var errorText: String?

    // 読み込み中かどうかのフラグ。
    // `body` での `ProgressView` の表示/非表示切替に使用します。`load()` 開始時に true、終了時に false を設定します。
    @State private var isLoading = false

    var body: some View {
        // 一覧レイアウト。縦スクロールで動画カードを順に表示します。
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                // 読み込み中はインジケーターを表示します（`isLoading` を使用）。
                if isLoading { ProgressView().tint(.white) }

                // 取得エラーがあれば文言を表示します（`errorText` を使用）。
                if let err = errorText { Text(err).foregroundColor(.red) }

                // 動画が取得できていればカード表示します（`latestVideos` を使用）。
                if !latestVideos.isEmpty {
                    ForEach(latestVideos) { v in
                        VStack(alignment: .leading, spacing: 8) {
                            // タイトルと動画URLが揃っている場合はリンク表示、タイトルのみの場合はテキスト表示。
                            if let title = v.title, let urlStr = v.url, let url = URL(string: urlStr) {
                                Link(title, destination: url)
                                    .foregroundColor(.white)
                                    .font(.headline)
                                    .underline()
                            } else if let title = v.title {
                                Text(title).foregroundColor(.white).font(.headline)
                            }
                            // 埋め込みプレイヤーの表示。`YouTubeEmbedView` は `videoId` を利用してプレイヤーを描画します。
                            YouTubeEmbedView(videoId: v.videoId)
                                .frame(maxWidth: .infinity, minHeight: 200)
                                .padding(.horizontal, 8)
                        }
                    }
                // 読み込み完了かつ動画が見つからない場合の控えめなメッセージ表示。
                } else if !isLoading {
                    Text("動画が見つかりませんでした")
                        .foregroundColor(.white.opacity(0.8))
                        .frame(maxWidth: .infinity, minHeight: 120)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.08)))
                        .padding(.horizontal, 8)
                }
            }
            .padding(.vertical)
        }
        // 画面背景にグラデーションテーマを適用します。
        .background(Theme.Gradient.appBackground.ignoresSafeArea())
        // View が表示されたタイミングで非同期ロードを開始します。
        .task { await load() }
    }

    @MainActor
    private func load() async {
        // 読み込み開始。`ProgressView` の表示制御に利用します。
        isLoading = true
        // 関数終了時に読み込み状態を解除します（例外時も確実に実行）。
        defer { isLoading = false }

        // チャンネルごとに最新動画を並列取得します。
        // `ApiClient.shared.fetchYoutubeLatest(handle:limit:)` を各ハンドルに対して実行し、最初の1件のみを採用します。
        let videos: [YoutubeVideoItem] = await withTaskGroup(of: YoutubeVideoItem?.self, returning: [YoutubeVideoItem].self) { group in
            for h in handles {
                group.addTask {
                    do {
                        return try await ApiClient.shared.fetchYoutubeLatest(handle: h, limit: 1).first
                    } catch {
                        // 個別取得で失敗した場合は nil を返し、全体の表示は継続します。
                        return nil
                    }
                }
            }

            // 取得できたものだけを配列にまとめます。
            var tmp: [YoutubeVideoItem] = []
            for await v in group {
                if let v { tmp.append(v) }
            }
            return tmp
        }

        // 画面表示用の状態に反映します（`body` が再描画されます）。
        latestVideos = videos
    }
}
