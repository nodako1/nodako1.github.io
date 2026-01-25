import Foundation

// アプリ内で扱う日付文字列を、安全に `Date` や表示用文字列へ変換するための共通ユーティリティ。
// 目的:
// - スクレイプやAPIから取得した日付は「yyyy-MM-dd」「M/d」「M月d日」など表記ゆれがあるため、ここで一元的にパース/整形します。
// - 年が含まれない形式（例: "M/d"）は現在年を補完して比較できる `Date` を作ります。
// 主な使用箇所:
// - Views/ContentView.swift: 環境一覧のフィルタ（本日以前の環境のみ表示）、日付ボタンの生成、日付並び替え時のパースに使用。
// - Services/PreloadStore.swift（DayDataPreloader）: API呼び出し前に日付を "YYYYMMDD" へ正規化する際に使用。
// - Views/ReferenceBuildsView.swift: 期間内に含まれる日付の判定に使用。
// 備考: 必要最小限の関数のみを残しています。
enum DateUtil {
    // 受け入れる入力フォーマット候補（厳密→緩めの順）。順番にトライし、最初に成功したものを採用します。
    private static let inputFormats: [String] = [
        "yyyy-MM-dd", "yyyy/MM/dd", "yyyy.M.d", "yyyyMMdd", "M/d", "M月d日"
    ]

    // 文字列を `Date` に変換します。年が無い形式は現在年で補完します。
    // 使用箇所例:
    // - Views/ContentView.swift の `loadLeagueDates`/ソート処理: APIから受け取った日付を比較可能な `Date` にします。
    // - Services/PreloadStore.swift の `preload`: 可変形式の日付を正規化してAPIへ渡します。
    // - Views/ReferenceBuildsView.swift: from/to の範囲に含まれるかを判定します。
    static func parse(_ raw: String) -> Date? {
        let cleaned = raw.replacingOccurrences(of: "（昨日）", with: "")
        let df = DateFormatter(); df.locale = Locale(identifier: "ja_JP")
        for f in inputFormats {
            df.dateFormat = f
            if let dt = df.date(from: cleaned) {
                // 年が含まれない場合は現在年を補完
                if !f.contains("yyyy") {
                    let cal = Calendar(identifier: .gregorian)
                    let comps = cal.dateComponents([.month, .day], from: dt)
                    if let m = comps.month, let d = comps.day {
                        var new = DateComponents(); new.year = cal.component(.year, from: Date()); new.month = m; new.day = d
                        if let fixed = cal.date(from: new) { return fixed }
                    }
                }
                return dt
            }
        }
        return nil
    }

    

    // `Date` から "YYYYMMDD" 文字列（JST）を生成します。APIパラメータの正規化に利用します。
    // 使用箇所例:
    // - Views/ContentView.swift: 本日JSTの判定（環境の表示可否）に使用。
    // - Services/PreloadStore.swift: API呼び出し前に日付を正規化（"YYYYMMDD"）して渡します。
    static func ymdString(from date: Date) -> String {
        let jst = Date(timeIntervalSince1970: date.timeIntervalSince1970 + 9*60*60)
        let cal = Calendar(identifier: .gregorian)
        let y = cal.component(.year, from: jst)
        let m = cal.component(.month, from: jst)
        let d = cal.component(.day, from: jst)
        return String(format: "%04d%02d%02d", y, m, d)
    }
}
