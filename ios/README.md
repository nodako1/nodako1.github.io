# PokeDeck iOS（SwiftUI）

Cloud Run 上の公開 API と連携して、ポケカのイベント・ランキング、デッキ分布、参考構築、関連動画などを閲覧できる iOS アプリです。SwiftUI を用い、URLSession の async/await で通信します。

- UI: SwiftUI
- 対応OS: iOS 16 以降
- 開発環境: Xcode（15 以降を想定）

このリポジトリには Xcode プロジェクトが同梱されています（ios/PokeDeckSwift.xcodeproj）。

---

## セットアップ

1) Xcode でプロジェクトを開く
- ios/PokeDeckSwift.xcodeproj を開きます。

2) 依存パッケージの解決（必要に応じて）
- 画像読み込み: Nuke / NukeUI（パッケージ追加先の例）
  - Nuke: https://github.com/kean/Nuke
  - NukeUI: https://github.com/kean/NukeUI
- 広告（AdMob）: Google Mobile Ads SDK（必要に応じて追加）
  - 例: https://github.com/googleads/swift-package-manager-google-mobile-ads

プロジェクトを開いた際に依存関係が未解決の場合は、Xcode の「Package Dependencies」から上記を追加してください。

3) API 接続先の確認
- 接続先は ios/Services/AppConfig.swift で管理しています。
  - DEBUG ビルド: http://127.0.0.1:8080（ローカル動作を最優先）→ 公開 API の順に自動切替
  - RELEASE ビルド: 公開 API のみを使用
- ローカルで API を試す場合は、ポート 8080 で公開 API を起動してください。

4) 署名やバンドルIDなど
- 実機デプロイ時は Xcode の Signing & Capabilities でチームとバンドルIDを設定してください。

---

## 実行方法

1. Xcode で ios/PokeDeckSwift.xcodeproj を開きます。
2. ターゲットを選択して、Simulator または接続したデバイスを選びます。
3. 実行ボタン（Run）でビルド・起動します。

初回起動時に最新の環境一覧を取得してから、タブや日付の選択画面が表示されます。通信エラーが発生した場合は自動でベースURL候補を切り替えます（ios/Services/ApiClient.swift）。

---

## 主な画面と機能

- トップ（ios/Views/ContentView.swift）
  - タブ切替: 「オープン/シニア/ジュニア/デッキ分布/参考構築/環境考察」
  - 環境選択 → 日付選択 → 詳細表示
  - 画面下部に AdMob バナー
- 日次まとめ（DaySummary）
  - 指定日のイベント・ランキングを取得して表示
- デッキ分布（DeckDistribution）
  - 直近または期間指定でのデッキ名分布を表示
- 参考構築（ReferenceBuilds）
  - 今週/先週の頻出デッキ名や、デッキ名別の参考リスト
- 環境考察（EnvironmentVideos）
  - 指定チャンネルの最新動画一覧

---

## API エンドポイント（例）

アプリは公開 API（public-api）に対して GET リクエストを行います。主に以下を使用します。

- GET /api/dates（必要に応じて `category`, `from`, `to`）
- GET /api/events?dateYmd=YYYYMMDD[&category=...]
- GET /api/rankings?eventId=... [&category=...]
- GET /api/decks/:deckId
- GET /api/deck-distribution?days=14[&category=...]
- GET /api/deck-distribution?from=YYYYMMDD&to=YYYYMMDD[&category=...]
- GET /api/deck-samples?name=... [&days=30][&category=...]
- GET /api/deck-samples?name=...&from=YYYYMMDD&to=YYYYMMDD[&category=...]
- GET /api/weekly/distinct-deck-names[?category=...]
- GET /api/daily-snapshot?date=YYYYMMDD[&category=...]
- GET /api/environments
- GET /api/youtube/latest?handle=@PokecaCH&limit=8

Cloud Run を認証付き（--no-allow-unauthenticated）で運用している場合は、ID トークン（Bearer）の付与が必要です。アプリ側では `ApiClient.authHeaderProvider` でトークンを取得・付与できます。

接続確認の一例（ターミナル）:

```bash
curl -sS 'https://pokedeck-public-api-820146621553.asia-northeast1.run.app/api/weekly/deck-distribution?category=オープン' | head -c 400
```

---

## 画像読み込みとキャッシュ

- Nuke/NukeUI を利用しています。共有パイプラインは ios/Services/ImagePipelineConfig.swift で設定しています。
- メモリ/ディスクキャッシュ、段階的デコード、重複ダウンロードの抑制、レート制御などを有効化し、一覧や詳細の表示を安定させています。
- 画面側では `ImagePipelineConfig.shared` を参照して画像を読み込みます。

---

## 広告（AdMob）

- アプリ起動時に Google Mobile Ads SDK を初期化します（ios/PokeDeckSwiftApp.swift）。
- バナー表示はトップ画面の下部に組み込んでいます（ios/Views/ContentView.swift）。
- 広告ユニットIDはビルド構成に応じて切り替えています（テスト/本番）。
  - テスト: `ca-app-pub-3940256099942544/2934735716`
  - 本番: コード内の定義を参照してください。

---

## 設定・カスタマイズのポイント

- ベースURLの候補: ios/Services/AppConfig.swift の `baseURLCandidates`
  - 通信エラーや 401/403/404 などの際は候補を順に切り替えて再試行します。
- 認証ヘッダ付与: ios/Services/ApiClient.swift の `authHeaderProvider`
  - 必要に応じて ID トークンを取得して `Authorization: Bearer ...` を付与できます。
- タブとカテゴリ: トップ画面のタブと API の `category` は対応しています（オープン/シニア/ジュニア）。

---

## よくあるトラブルと対処

- ビルド時に Nuke/NukeUI が解決できない
  - Xcode の「Package Dependencies」から Nuke/NukeUI を追加してください。
- 画像が表示されない/遅い
  - ネットワーク状況を確認しつつ、ImagePipeline の設定（ios/Services/ImagePipelineConfig.swift）をご確認ください。
- 403/401 が返る
  - 公開 API が認証必須になっている可能性があります。`authHeaderProvider` でトークンを付与するか、開発中は一時的に公開設定で確認してください。
- 404 が返る
  - エンドポイントのパスやクエリ、デプロイ状況をご確認ください。

---

## 補足

- 端末や Simulator でのテスト中に API のベースURLが切り替わった場合、`UserDefaults` に保存された URL が次回起動でも使われます。接続先をリセットしたい場合はアプリを再インストールしてください。
- iOS 16/17 を前提に、ナビゲーションや非同期処理の互換に配慮しています。
