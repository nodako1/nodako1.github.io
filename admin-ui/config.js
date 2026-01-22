// 管理UIの設定（window.CONFIG 形式）。config.sample.js と同じ構造に揃えます。
window.CONFIG = {
  firebase: {
    apiKey: "AIzaSyCHWQ-bBvPU-zgmChRreZTgIZJOSBW5oZU",
    authDomain: "pokeca-deck-manager-8d241.firebaseapp.com",
    projectId: "pokeca-deck-manager-8d241",
  },
  // Admin API のベースURL（Cloud Run サービスURL）
  adminApiBaseUrl: "https://pokedeck-admin-api-820146621553.asia-northeast1.run.app",
  // 任意: クライアント側の簡易警告用。空で問題なし。
  allowedEmailDomain: ""
};