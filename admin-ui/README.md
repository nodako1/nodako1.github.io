# PokeDeck Admin UI (GitHub Pages)

このフォルダは管理者用のシンプルなSPAです。GitHub Pages から配信し、Firebase Auth でログインした管理者のみが Admin API を操作できます。

## セットアップ
1) Firebase Web 設定を用意し、`config.sample.js` をコピーして `config.js` を作成:

```bash
cp admin-ui/config.sample.js admin-ui/config.js
# エディタで admin-ui/config.js を編集（apiKey/authDomain/projectId/adminApiBaseUrl）
```

- `adminApiBaseUrl`: Cloud Run で動作する Admin API のURL（例: `https://pokedeck-admin-api-xxxx-an.a.run.app`）

2) Admin API 側の環境変数/CORS
- `ADMIN_UI_ORIGIN`: GitHub Pages のオリジン（例: `https://<user>.github.io`）
- `ADMIN_EMAILS`: 管理者メールアドレスのカンマ区切り（claims代替）

3) GitHub Pages への公開
- リポジトリの Pages 設定で `main` の `/admin-ui` もしくは `/`（ルート）を公開対象に設定
- 404 を SPA として扱う場合は Pages 側の SPA オプション（もしくは 404.html リダイレクト）を設定

## 使い方
- ブラウザで Pages の URL を開く → Google でサインイン → 月→日→入力の順に操作
- プルダウンでデッキ名を選択し「決定」で保存（何度でも更新可）
- その場で `＋候補追加` から辞書へ登録可能（重複名は不可）

## 動作要件
- Admin API が稼働中であること
- Admin API に CORS/認証設定が済んでいること
- Firestore に `daily-rankings-snapshots` がスクレイプ後に作成されること

## 参考資料
- 管理UI仕様: ../docs/admin/admin-ui-spec.md
- サービスアカウント運用: ../docs/setup/service-accounts.md
