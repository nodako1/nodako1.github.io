import Foundation
@preconcurrency import Nuke

enum ImagePipelineConfig {
    // 役割: Nuke の画像読み込み用パイプラインをアプリ全体で共有する設定。
    // 使用箇所: NukeUI の画像ビュー（例: LazyImage）から `.pipeline(ImagePipelineConfig.shared)` として参照。
    // 代表例: リスト/詳細などの画像表示ビューで利用（NukeFullWidthImage）。
    // ねらい: メモリとネットワークのバランス調整、HTTP/ディスクキャッシュの最適化、同一URLの重複ダウンロード抑制。
    // 注意: ここで構築した共有パイプラインは不変。UI から読み取り専用で安全に使えるよう MainActor 上で初期化する。
    @MainActor static let shared: ImagePipeline = {
        // 永続化用のディスクキャッシュ（生の画像データ）。
        // 目的: 同じ URL の画像を再度読み込む際の再ダウンロードを避け、通信量と待ち時間を削減する。
        // 利用場面: 一覧スクロール、詳細への遷移、画面再表示などで同じ画像を何度も参照するケース。
        let dataCache = try? DataCache(name: "pokedeck-images")
        dataCache?.sizeLimit = 256 * 1024 * 1024 // ディスク容量の上限（約 256MB）

        let pipeline = ImagePipeline {
            // 表示用のメモリキャッシュ（復元が速い）。
            // 目的: 直近で表示した画像を素早く再表示する（例: リストでの再利用、戻る操作）。
            // 調整: 端末のメモリ圧迫（Jetsam）を避けるため、容量と登録数に上限を設ける。
            let memCache = ImageCache()
            memCache.costLimit = 64 * 1024 * 1024 // メモリ容量の上限（約 64MB）
            memCache.countLimit = 200
            $0.imageCache = memCache

            // ネットワークから取得した画像データをディスクに保存し、同じ URL を再読込する際の再ダウンロードを避ける。
            $0.dataCache = dataCache
            
            // 受信途中の画像でも段階的に描画し、体感速度を向上させる（主に JPEG に有効）。
            $0.isProgressiveDecodingEnabled = true

            // 複数のビューが同じ URL を要求した場合、1 つのネットワーク要求にまとめて重複ダウンロードを防ぐ。
            // 利用場面: 一覧と詳細で同じ画像を同時に読み込む、セルの再利用で同一 URL が重なる、など。
            $0.isTaskCoalescingEnabled = true

            // 短時間に大量の画像要求が走る場面（グリッド/リスト）での過負荷を抑え、安定した取得を狙う。
            $0.isRateLimiterEnabled = true

            // 途中まで取得したデータの再利用を許可し、通信が途切れてもダウンロードを再開しやすくする。
            $0.isResumableDataEnabled = true

            // ネットワーク層（URLSession）の上限や HTTP キャッシュを調整する。
            $0.dataLoader = DataLoader(configuration: {
                let conf = URLSessionConfiguration.default
                
                // 同一ホストへの同時接続数。大きすぎると帯域競合やタイムアウトの原因になるため、適度な上限にする。
                conf.httpMaximumConnectionsPerHost = 4

                // HTTP キャッシュがあればその内容を返し、なければネットワークに出る。
                // 目的: 戻る操作や画面再表示での待ち時間短縮、通信量削減。
                conf.requestCachePolicy = .returnCacheDataElseLoad

                // HTTP レスポンスのキャッシュ（URLCache）。
                // メモリ 32MB、ディスク 256MB を確保し、画像の再表示やページ内移動を滑らかにする。
                conf.urlCache = URLCache(
                    memoryCapacity: 32 * 1024 * 1024,
                    diskCapacity: 256 * 1024 * 1024,
                    diskPath: "pokedeck-urlcache"
                )
                return conf
            }())
        }
        // ここで構築したパイプラインは不変。UI 側では `ImagePipelineConfig.shared` を直接参照するだけで、
        // 設定やキャッシュ方針の差を画面ごとに意識せずに済む（設計の一貫性を担保）。
        return pipeline
    }()
}
