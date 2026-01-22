// このファイルを config.js としてコピーし、値をプロジェクトに合わせて設定してください。
// GitHub Pages で公開するため Firebase Web 設定は公開情報です（秘密鍵ではありません）。
// Admin API には Firebase Auth の ID トークンでアクセスします。

window.CONFIG = {
  firebase: {
    apiKey: "<YOUR_API_KEY>",
    authDomain: "<YOUR_AUTH_DOMAIN>", // 例: pokedeck-local.firebaseapp.com
    projectId: "pokedeck-local",
  },
  // Admin API のベースURL（Cloud Run のサービスURL）。例: https://pokedeck-admin-api-xxxx-an.a.run.app
  adminApiBaseUrl: "https://<YOUR_ADMIN_API_HOST>",
  // 任意: 許容するメールドメイン（クライアント側警告用。権限はサーバ側で検証）
  allowedEmailDomain: ""
};
