import Foundation

// 役割:
// - 週範囲（土〜金の「金曜締め」）の境界日を計算し、今週/先週の from/to をまとめて取得します。
// - 表示や API リクエストで使う日付文字列（yyyyMMdd と yyyy/MM/dd）を生成します。
//
// 主な使用箇所（どの処理で使われるか）:
// - Views/DeckDistributionView.swift: デッキ分布の今週/先週レンジを計算し、
//   API へ渡す fromYmd/toYmd と、画面の範囲ラベル表示に利用します。
// - Views/ReferenceBuildsView.swift: 参照ビルドの期間抽出に使い、
//   from/to を yyyyMMdd で組み立てて API に渡したり、今日の日付文字列の生成に使います。
//
// ポイント:
// - 「金曜締め」: 週終端を金曜日とし、その6日前の土曜日を週始とする設計です。
// - 端末のタイムゾーン（Calendar.timeZone = .current）で計算・整形します。
// - 返す Date は時刻成分を保持したままですが、日付単位で扱う前提のロジックです。

enum WeekRangeUtil {
    /// 週範囲（今週/先週）の境界日を返します。
    /// - 設計: 「金曜締め」。基準日から見て次に来る金曜日を `thisTo`、その6日前（土曜）を `thisFrom`。
    ///         先週は `thisTo` の7日前を `lastTo`、その6日前を `lastFrom` として計算します。
    /// - タイムゾーン: 端末の現在タイムゾーンで計算します（JST 等に合わせて日付切替が行われます）。
    /// - 使用箇所: DeckDistributionView で API パラメータ（fromYmd/toYmd）と範囲ラベルの生成、
    ///             ReferenceBuildsView で抽出期間の決定に利用されています。
    static func weekBoundaries(for date: Date = Date()) -> (thisFrom: Date, thisTo: Date, lastFrom: Date, lastTo: Date) {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        let weekday = cal.component(.weekday, from: date) // Calendar: Sun=1 ... Sat=7（Fri=6）
        let friday = 6
        let deltaToNextFriday = (friday - weekday + 7) % 7
        let thisTo = cal.date(byAdding: .day, value: deltaToNextFriday, to: date) ?? date
        let thisFrom = cal.date(byAdding: .day, value: -6, to: thisTo) ?? thisTo
        let lastTo = cal.date(byAdding: .day, value: -7, to: thisTo) ?? thisTo
        let lastFrom = cal.date(byAdding: .day, value: -6, to: lastTo) ?? lastTo
        return (thisFrom, thisTo, lastFrom, lastTo)
    }

    /// 今週（土〜金）のみの境界日を返します。
    /// - 使用箇所想定: 画面やロジックで「今週」のみが必要なケース向け。
    static func currentWeekOnly(for date: Date = Date()) -> (thisFrom: Date, thisTo: Date) {
        let (f,t,_,_) = weekBoundaries(for: date)
        return (f,t)
    }

    /// yyyyMMdd（例: 20260120）を出力するためのフォーマッタ。
    /// - 使用箇所: API の fromYmd/toYmd、キャッシュキー、今日の日付文字列の生成など。
    private static let ymdFormatter: DateFormatter = {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.dateFormat = "yyyyMMdd"; return f
    }()
    /// yyyy/MM/dd（例: 2026/01/20）を出力するためのフォーマッタ。
    /// - 使用箇所: 画面上の週範囲ラベル（例: (2026/01/14〜2026/01/20)）の表示に利用。
    private static let labelFormatter: DateFormatter = {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.dateFormat = "yyyy/MM/dd"; return f
    }()

    /// Date を yyyyMMdd 文字列へ変換します。
    static func ymdString(_ d: Date) -> String { ymdFormatter.string(from: d) }
    /// Date を yyyy/MM/dd 文字列へ変換します。
    static func labelString(_ d: Date) -> String { labelFormatter.string(from: d) }
}
