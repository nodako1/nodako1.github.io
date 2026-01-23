# PokeDeck Admin UI（GitHub Pages 配信）

管理者が「デッキ名」を付与・更新するためのシンプルな SPA です。GitHub Pages から配信し、Google ログイン（Firebase Auth）後にだけ Admin API を操作できます。

---

## クイックスタート
1) 設定ファイルを作成（公開用の Web 設定）

```bash
cp admin-ui/config.sample.js admin-ui/config.js
# その後、エディタで admin-ui/config.js を編集
```

- `firebase`: Firebase コンソール → プロジェクト設定 → 全般 → 「マイアプリ」から Web アプリの設定（apiKey/authDomain/projectId など）をコピー
- `adminApiBaseUrl`: Cloud Run の Admin API の URL（例: `https://pokedeck-admin-api-xxxx-an.a.run.app`）
- 備考: `config.js` は公開情報（秘密鍵ではありません）。権限の検証は必ずサーバ側で行います。

2) Admin API 側の環境変数（CORS/認可）
- `ADMIN_UI_ORIGIN`: GitHub Pages のオリジン（例: `https://<user>.github.io`）
- `ADMIN_EMAILS`: 管理を許可するメールアドレス（カンマ区切り）
- 既存の運用変数: `SCRAPER_ENABLED=true`, `FIREBASE_PROJECT_ID=<your-project>`

3) GitHub Pages に公開
- リポジトリ設定 → Pages → ソースを `main` ブランチの `/admin-ui` に設定
- SPA ルーティング用に `admin-ui/404.html` を設置済み（ハッシュルーティングでも 404 経由でトップに戻れます）

---

## ローカルでの確認（任意）
Admin API を本番/ステージングに向けたまま、手元で UI を確認できます。

```bash
cd admin-ui
python3 -m http.server 8081
# → http://localhost:8081 をブラウザで開く
```

- CORS の許可オリジンに `http://localhost:8081` を一時的に追加する必要があります。
	- 例（Cloud Run）：
		```bash
		REGION=asia-northeast1
		SERVICE=pokedeck-admin-api
		gcloud run services update $SERVICE \
			--region "$REGION" \
			--update-env-vars ADMIN_UI_ORIGIN="http://localhost:8081",ADMIN_EMAILS="admin@example.com"
		```
- Firebase Auth の「承認済みドメイン」に `localhost` を追加してください。

---

## 使い方
- ページを開く → 「ログイン」で Google にサインイン
- 画面の流れ: 「月一覧」→「日一覧」→「デッキ名入力」
- 「デッキ名入力」
	- プルダウンで候補を選び「決定」で保存（何度でも更新可）
	- 必要なら「＋候補追加」から辞書に新しい名前を登録（同名は不可）

---

## よくあるエラーと対処
- 設定が不足しています… と表示される
	- `admin-ui/config.js` が存在しない/値が空。`config.sample.js` をコピーして正しく入力してください。
- 権限がありません（管理者権限が必要）/ 401-403
	- `ADMIN_EMAILS` に自分のメールが含まれていない、またはサーバ側の認可設定不足。
- 接続に失敗しました（CORS設定またはネットワークを確認してください）
	- `ADMIN_UI_ORIGIN` に公開 URL（またはローカルの `http://localhost:xxxx`）が含まれていない、もしくは `adminApiBaseUrl` が誤り。
- 直接 `#/months` などの URL を開くと 404 になる
	- GitHub Pages の仕様です。`admin-ui/404.html` を置いてあるので、トップページに戻ってから遷移してください。
- ログインできない/ポップアップがブロックされる
	- ブラウザのポップアップ許可、Firebase Auth の承認済みドメイン（Pages のドメイン）を確認。

---

## 前提となるバックエンド
- Admin API が稼働していること（Cloud Run）
- CORS/認証が設定済みであること（`ADMIN_UI_ORIGIN`, `ADMIN_EMAILS`）
- スクレイプ後に Firestore へ `daily-rankings-snapshots` などが作成されること

---

## 参考資料
- 管理 UI 仕様: ../docs/admin/admin-ui-spec.md
- サービスアカウント運用: ../docs/setup/service-accounts.md
