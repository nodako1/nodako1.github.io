import admin from 'firebase-admin';

/*
	このモジュールは「Public API サーバー」で Firestore にアクセスするための
	Firebase Admin SDK の初期化と、よく使うインスタンスのエクスポートをまとめています。

	どの処理で使われているか（主な利用箇所）
	- ルート層（public-api/src/routes/*）での Firestore 読み書き。
		例: events.ts, snapshots.ts, rankings.ts, weekly.ts, decks.ts,
				environments.ts, deckDistribution.ts, dailySnapshot.ts など。
		これらのファイルでは `import { db } from '../common/firebase.js'` の形で
		このモジュールから `db`（Firestore）を受け取り、クエリやドキュメント操作を行います。
	- 一部のルート（例: dates.ts, distinctDeckNames.ts）では `admin` も併用し、
		`admin.firestore.FieldValue` や `admin.firestore.Timestamp` などの型／ユーティリティを使用します。

	ポイント
	- サーバー側（Node.js）から安全に Firestore にアクセスするため、クライアント SDK ではなく
		Firebase Admin SDK を使います。
	- 同一プロセス内で複数回初期化しないように、すでに初期化済みかを確認してから初期化します。
*/

// すでに Admin SDK が初期化済みか確認し、未初期化なら初期化します。
// Cloud Run やローカル開発でコードが複数箇所から読み込まれても安全に動作させるためのパターンです。
try {
	admin.app();
} catch {
	admin.initializeApp();
}

// Firestore（Admin SDK 経由）への参照をエクスポートします。
// ルートハンドラから「コレクション／ドキュメントの読み書き」に利用されます。
export const db = admin.firestore();

// Admin SDK 本体もエクスポートします。
// FieldValue, Timestamp などのユーティリティや追加機能が必要な処理で使用されます。
export { admin };
