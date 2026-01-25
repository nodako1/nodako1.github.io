import Foundation

// デッキ分布（週範囲）の結果を一時的に保持するためのキャッシュアクター。
// 目的: 事前取得（先読み）した週単位の分布データを保存し、画面表示時にネットワーク取得を省略または重複呼び出しを避ける。
// 主な利用箇所: DeckDistributionView のロード処理内で `get(...)` が参照され、
//                 日次スナップショットに週分布が含まれない場合のフォールバックとして使用されます。
// アクターを用いることで Swift の並行処理下でもスレッド安全に読み書きできます。
actor DeckDistributionPreloadStore {
    // キャッシュのキー定義。
    // fromYmd/toYmd: 週の始端・終端（"yyyyMMdd" 形式を想定）。
    // category: 表示カテゴリ（例: 「オープン」）。
    struct Key: Hashable, Sendable { let fromYmd: String; let toYmd: String; let category: String }

    // 共有インスタンス（シングルトン）。アプリ内で同一のキャッシュを使い回すために利用します。
    static let shared = DeckDistributionPreloadStore()

    // 実体のキャッシュ。PreloadCacheActor は `put`/`get`/`take` を提供し、
    // 取り出し時に削除したい場合は `take` を使うことで「一度きりの先読み」に適した制御が可能です。
    private static let cache = PreloadCacheActor<Key, [DeckDistributionItem]>()

    // 先読み完了時やネットワーク取得完了時に結果を保存します。
    // 想定例: `ApiClient.shared.fetchDeckDistributionRange(...)` が返った直後に呼び出してキャッシュを更新。
    func put(fromYmd: String, toYmd: String, category: String, items: [DeckDistributionItem]) async {
        let key = Key(fromYmd: fromYmd, toYmd: toYmd, category: category)
        await DeckDistributionPreloadStore.cache.put(key, items)
    }

    // キャッシュから読み出します（この呼び出しではキャッシュ内容は削除されません）。
    // 実際の利用箇所: DeckDistributionView のロード処理で、週分布が未取得のときにフォールバックとして `get(...)` を参照します。
    func get(fromYmd: String, toYmd: String, category: String) async -> [DeckDistributionItem]? {
        let key = Key(fromYmd: fromYmd, toYmd: toYmd, category: category)
        return await DeckDistributionPreloadStore.cache.get(key)
    }

    // 読み出しと同時にキャッシュから削除します（「一度きりの先読み」に向いた API です）。
    func take(fromYmd: String, toYmd: String, category: String) async -> [DeckDistributionItem]? {
        let key = Key(fromYmd: fromYmd, toYmd: toYmd, category: category)
        return await DeckDistributionPreloadStore.cache.take(key)
    }
}
