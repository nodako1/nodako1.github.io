/*
目的:
- 公開APIサービスのエントリポイント。Express を初期化し、各ルートモジュールを登録してサーバーを起動する。

利用される場面:
- iOS クライアント（アプリ）やユーザー向けサイトから、集計済みデータを取得するための HTTP API として利用される。
- 管理側のスクレイプや集計処理（別プロセス）が作成したデータを外部に配信する役割を担う。

設計上のポイント:
- このファイルは「起動とルート登録」に専念し、ビジネスロジックは各 `attach*Routes` モジュールに分離されている。
*/
import express from 'express';
import { attachDateRoutes } from './src/routes/dates.js';
import { attachEventRoutes } from './src/routes/events.js';
import { attachRankingRoutes } from './src/routes/rankings.js';
import { attachDeckRoutes } from './src/routes/decks.js';
import { attachDeckDistributionRoutes } from './src/routes/deckDistribution.js';
import { attachDistinctDeckNamesRoutes } from './src/routes/distinctDeckNames.js';
import { attachYouTubeRoutes } from './src/routes/youtube.js';
import { attachDailySnapshotRoutes } from './src/routes/dailySnapshot.js';
import { attachSnapshotRoutes } from './src/routes/snapshots.js';
import { attachWeeklyRoutes } from './src/routes/weekly.js';
import { attachEnvironmentRoutes } from './src/routes/environments.js';

const app = express();
/*
プロキシ設定:
- `trust proxy` を有効化。リバースプロキシ（Cloud Run／ロードバランサ等）越しの接続で、クライアント IP やプロトコルの推定を適切に行うため。
*/
app.set('trust proxy', true);
const PORT = process.env.PORT || 8080;

/*
ルート登録:
- それぞれの `attach*Routes(app)` が、特定の機能領域のエンドポイント群を Express に追加する。
- どの画面／処理から利用されるかの目安を各行に記載。
*/
// 日付関連のユーティリティ。週範囲計算や期間選択 UI から利用されることが多い。
attachDateRoutes(app);
// イベント（大会等）情報。イベント一覧やイベント別統計の画面から参照される。
attachEventRoutes(app);
// ランキング（デッキやカード傾向の順位）。リファレンスビルド表示やランキング画面で利用される。
attachRankingRoutes(app);
// デッキ詳細・検索。デッキ参照画面や詳細モーダルなどで使用される。
attachDeckRoutes(app);
// デッキ分布（環境のメタ分布）。分布可視化画面（例: デッキ分布ビュー）で使用される。
attachDeckDistributionRoutes(app);
// 重複排除済みのデッキ名一覧。オートコンプリートや検索補助機能で利用される。
attachDistinctDeckNamesRoutes(app);
// YouTube 連携（環境動画など）。環境動画ビューや外部参考リンク表示で使用される。
attachYouTubeRoutes(app);
// 日次スナップショット（その日のまとめ）。日別サマリー画面やトップのダッシュボードで参照される。
attachDailySnapshotRoutes(app);
// スナップショット（期間・週次等のまとまり）。履歴や週次まとめ（Weekly）関連の画面から利用される。
attachEnvironmentRoutes(app);
attachSnapshotRoutes(app);
attachWeeklyRoutes(app);

/*
ヘルスチェック:
- ルート `/` にアクセスすると、稼働中メッセージを返す簡易ヘルスエンドポイント。
- モニタリングや外形監視、起動確認で使用される。
*/
app.get('/', (_req, res) => res.send('PokeDeck 公開APIサービス running'));

app.listen(PORT, () => console.log(`Public API server listening on port ${PORT}`));
export default app;
