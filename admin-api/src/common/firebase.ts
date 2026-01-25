import admin from 'firebase-admin';
import { Firestore as NativeFirestore } from '@google-cloud/firestore';

let initialized = false;
let db: FirebaseFirestore.Firestore;

/**
 * このファイルの役割
 * ------------------------------------------------------------
 * - 管理系の API（Admin API）で Firebase Admin SDK と Firestore を「1回だけ」初期化し、
 *   どの処理からでも同じ接続を使えるようにするための共通ユーティリティです。
 * - ここで作った Firestore の参照は、イベント取得・ランキング取得・日次スナップショット生成・
 *   Slack通知など、ほぼすべての処理で使われます。
 *
 * どの処理で使われている？（主な使用ファイル）
 * - サーバ起動時の初期化: admin-api/server.ts → `initFirebase()` を呼び、続けて `getDb()` を使います。
 * - データ削除ユーティリティ: admin-api/src/purgeData.ts → `initFirebase()` と `getDb()` を使います。
 * - 実行ステップ群:
 *   - admin-api/src/steps/probe.ts（イベント収集）→ `getDb()`
 *   - admin-api/src/steps/rankings.ts（ランキング収集）→ `getDb()`
 *   - admin-api/src/steps/snapshots.ts（日次スナップショット生成）→ `getDb()`
 *   - admin-api/src/steps/notify.ts（Slack通知要約）→ `getDb()`
 *
 * 使う環境変数（設定の置き場所）
 * - FIREBASE_SERVICE_ACCOUNT: サービスアカウントJSON（文字列）。あれば優先して認証に使用します。
 * - FIREBASE_STORAGE_BUCKET: Firestore と同じプロジェクトの Storage バケット名（任意）。
 * - FIREBASE_PROJECT_ID / GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT: プロジェクトID（いずれかがあれば使用）。
 * - FIRESTORE_EMULATOR_HOST: ローカルで Firestore エミュレータに接続するためのホスト（例: "127.0.0.1:8088"）。
 * - FIRESTORE_FORCE_REST: 'true' の場合、@google-cloud/firestore の REST 経由を優先（ネットワーク条件次第で安定することがあります）。
 * - K_SERVICE: Cloud Run 実行時に自動で入る環境変数。これがあると本番環境判定をします。
 */

export function initFirebase() {
  if (initialized) return;
  try {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    const bucket = process.env.FIREBASE_STORAGE_BUCKET;
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || undefined;
    if (sa && sa.trim().length > 0) {
      const parsed = JSON.parse(sa);
      const cred = admin.credential.cert(parsed);
      admin.initializeApp({ credential: cred, ...(bucket ? { storageBucket: bucket } : {}), ...(projectId ? { projectId } : {}) });
    } else {
      admin.initializeApp({ ...(bucket ? { storageBucket: bucket } : {}), ...(projectId ? { projectId } : {}) });
    }
  } catch {
    admin.initializeApp();
  }
  db = admin.firestore();
  try {
    const useEmulator = !process.env.K_SERVICE && !!process.env.FIRESTORE_EMULATOR_HOST;
    const settings: any = { ignoreUndefinedProperties: true };
    if (useEmulator) {
      settings.host = process.env.FIRESTORE_EMULATOR_HOST;
      settings.ssl = false;
    }
    db.settings(settings as any);
    if (process.env.FIRESTORE_FORCE_REST === 'true') {
      const projectId = admin.app().options.projectId as string | undefined;
      if (projectId) {
        const native = new NativeFirestore({ projectId, preferRest: true });
        (db as any) = native;
      }
    }
  } catch (e) {
    console.warn('Firestore init warning:', (e as any).message);
  }
  if (process.env.K_SERVICE && process.env.FIRESTORE_EMULATOR_HOST) {
    // Cloud Run 上ではエミュレータ環境変数を無効化（誤って混入しても本番接続を担保）
    delete process.env.FIRESTORE_EMULATOR_HOST;
  }
  initialized = true;
}

/**
 * Firebase Admin SDK への生アクセスを返します。
 * どこで使う？
 * - 認証・低レベルAPIが必要になった場合に利用します（現状、本リポジトリでは主用途は Firestore のため使用頻度は低いです）。
 * 返り値:
 * - `firebase-admin` の `admin` オブジェクトそのもの。
 */
export function getAdmin() { return admin; }
/**
 * Firestore（データベース）への参照を返します。
 * どこで使う？
 * - サーバ本体: admin-api/server.ts（HTTPハンドラで Firestore にログや結果を保存）
 * - ステップ処理: admin-api/src/steps/probe.ts / rankings.ts / snapshots.ts / notify.ts（各処理の読み書きで使用）
 * - ユーティリティ: admin-api/src/purgeData.ts（データ削除の実行対象を取得）
 * 振る舞い:
 * - まだ初期化されていない場合は内部で `initFirebase()` を呼び、1回だけ初期化してから返します。
 */
export function getDb() { if (!initialized) initFirebase(); return db; }

