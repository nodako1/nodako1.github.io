import Foundation

// AppConfig は API 接続先（ベースURL）の構成値をまとめたものです。
// 主な役割:
// - Cloud Run の公開API/ローカルAPIの候補URLを保持し、通信失敗時に候補を順に切り替えます。
// - 成功した候補を UserDefaults に保存し、次回起動時はそのURLから接続を開始します。
// 使用箇所:
// - ApiClient 全体（fetchDates / fetchEvents / fetchRankings / fetchDeckDistribution などの通信処理）で参照されます。
// - これらの通信は ContentView, DaySummaryView, DeckDistributionView, ReferenceBuildsView/DetailView,
//   EnvironmentVideosView などの画面から呼び出されます。
// 注意点:
// - DEBUG ビルドではローカルの http://127.0.0.1:8080 を最優先にして開発・検証を行います。
// - RELEASE ビルドでは本番の公開APIのみを候補にし、安定した接続を前提にします。
enum AppConfig {
    // ベースURLの候補一覧（上から優先的に使用）。
    // 利用箇所: ApiClient.init()（初期化時の既定値）、performGET()（エラー時の候補切替）、
    //           fallbackBaseURL()（次の候補へ進めて保存）。
    #if DEBUG
    static let baseURLCandidates: [String] = [
        "http://127.0.0.1:8080",
        "https://pokedeck-public-api-820146621553.asia-northeast1.run.app"
    ]
    #else
    static let baseURLCandidates: [String] = [
        "https://pokedeck-public-api-820146621553.asia-northeast1.run.app"
    ]
    #endif

    // 既定の起点URL（候補の先頭）。
    // 利用箇所: ApiClient.init() で初期値として採用。候補外のURLが baseURL に入っていた場合のリセットにも使用。
    static var defaultBaseURLString: String { baseURLCandidates.first! }

    // 永続化された選択URL。
    // 利用箇所: ApiClient.init()（前回成功したURLを復元）、fallbackBaseURL()（候補切替後に保存）。
    // 保存キー: "api.baseURL"（UserDefaults）。
    static var persistedBaseURLString: String? {
        get { UserDefaults.standard.string(forKey: "api.baseURL") }
        set { UserDefaults.standard.set(newValue, forKey: "api.baseURL") }
    }
}
