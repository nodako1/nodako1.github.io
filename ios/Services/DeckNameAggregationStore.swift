import Foundation

/*
 DeckNameAggregationStore は、期間とカテゴリ別のデッキ分布データ（`DeckDistributionItem`）を
 メモリ内にキャッシュするためのストアです。Swift Concurrency の `actor` を用いて実装しており、
 複数の非同期処理から同時にアクセスされても安全に読み書きできます。

 このストアは次の処理で利用されています：
 - ReferenceBuildsView（参照デッキ一覧画面）における、期間指定（fromYmd/toYmd）とカテゴリ
     （例："オープン"）ごとのデッキ名集計・並び替え結果のキャッシュ。
     画面内で同じ条件のデータを再利用することで、無駄な再計算や取得を避け、表示を高速化します。

 使い方の概要：
 - 集計・並び替え処理が完了したら `put(fromYmd:toYmd:category:items:)` で保存します。
 - 同じ条件で再表示する際は `get(fromYmd:toYmd:category:)` で取り出します（存在すれば再計算不要）。
 */

actor DeckNameAggregationStore {
    static let shared = DeckNameAggregationStore()

    /// 期間（from/to）とカテゴリでキャッシュのキーを表します。
    struct Key: Hashable {
        let fromYmd: String
        let toYmd: String
        let category: String
    }

    /// メモリ上のキャッシュ本体。キーごとに `DeckDistributionItem` の配列を保持します。
    private var store: [Key: [DeckDistributionItem]] = [:]

    /// キャッシュへ保存します。
    /// - Parameters:
    ///   - fromYmd: 期間の開始（YYYYMMDD 形式）
    ///   - toYmd: 期間の終了（YYYYMMDD 形式）
    ///   - category: データのカテゴリ（例："オープン"）
    ///   - items: 保存する分布データ（集計・並び替え後の結果）
    ///
    /// ReferenceBuildsView で期間・カテゴリ別の結果を再利用するために使用します。
    func put(fromYmd: String, toYmd: String, category: String, items: [DeckDistributionItem]) {
        let key = Key(fromYmd: fromYmd, toYmd: toYmd, category: category)
        store[key] = items
    }

    /// キャッシュから取得します。存在しない場合は `nil` を返します。
    /// - Parameters:
    ///   - fromYmd: 期間の開始（YYYYMMDD 形式）
    ///   - toYmd: 期間の終了（YYYYMMDD 形式）
    ///   - category: データのカテゴリ（例："オープン"）
    /// - Returns: 保持されていれば `DeckDistributionItem` 配列、なければ `nil`
    ///
    /// ReferenceBuildsView の表示更新時に、同じ条件の結果がすでにあるかを確認するために使用します。
    func get(fromYmd: String, toYmd: String, category: String) -> [DeckDistributionItem]? {
        let key = Key(fromYmd: fromYmd, toYmd: toYmd, category: category)
        return store[key]
    }
}
