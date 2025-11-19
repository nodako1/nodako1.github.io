# GitHub User Site seed (nodako1.github.io)

このフォルダは、無料運用で app-ads.txt を「ドメイン直下」に公開するための種（シード）です。

公開先（無料）
- ユーザーサイト（ドメイン直下）: https://nodako1.github.io/
- プロジェクトサイト（Docs）: https://nodako1.github.io/PokeDeck/

含まれるファイル
- app-ads.txt … AdMob 提供の 1 行（広告在庫認証）
- index.html … 簡易トップ。Docs / Privacy / Support へのリンク付き

公開手順（いずれか）

A) 新規で User Site リポジトリを作成する場合
1. GitHub 上で Public リポジトリ nodako1/nodako1.github.io を作成
2. ローカルで clone し、このフォルダの中身（2ファイル）をコピー
3. commit & push すると、数分で https://nodako1.github.io/ が公開されます

B) 既存の User Site リポジトリがある場合
1. 既存のリポジトリを clone
2. app-ads.txt（上書き）と index.html（任意）を配置
3. commit & push

アフターチェック
- https://nodako1.github.io/app-ads.txt が 200 で 1 行を返すこと
- App Store Connect の「デベロッパー Web サイト」を https://nodako1.github.io/ に設定
- AdMob 側で app-ads.txt のドメイン設定→クロール完了を確認

トラブルシューティング
- 反映に数分かかることがあります
- リポジトリ名は必ず "nodako1.github.io"（GitHub ユーザー名と一致）
- Private リポジトリでは公開されません（Public 必須）
