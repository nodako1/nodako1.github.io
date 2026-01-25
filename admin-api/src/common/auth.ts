import { Request, Response, NextFunction } from 'express';
import { getAuth } from 'firebase-admin/auth';

/**
 * このファイルの役割（共通認証・認可ヘルパー）
 * --------------------------------------------------
 * Express 用のミドルウェア/関数で、Firebase の ID トークンを検証し、
 * 「管理者」であることを判定してルートへのアクセスを制御します。
 *
 * できること:
 * - Authorization ヘッダの ID トークン（`Bearer <ID_TOKEN>`）を検証
 * - 管理者判定: Firebase カスタムクレーム `isAdmin=true` か、
 *   環境変数 `ADMIN_EMAILS`（カンマ区切り allowlist）にメールアドレスが含まれていれば OK
 * - Cloud Scheduler からの実行を許可するモード（`requireAdminOrScheduler`）も提供
 *
 * 主な利用箇所（どの処理で使われるか）:
 * - サーバの管理UI向けルート（例: `/admin/months`, `/admin/days`, `/admin/deck-names`）
 *   → `requireAdminAuth` を使用（管理者のみアクセス可）
 * - 自動実行系ルート（例: `/pokemon-events/auto-run`, `/pokemon-events/auto-run/latest`）
 *   → `requireAdminOrScheduler` を使用（管理者または Cloud Scheduler からの呼び出しを許可）
 *   これらは [admin-api/server.ts] 内のルート定義で参照されています。
 *
 * 参考: Authorization ヘッダ例
 *   Authorization: Bearer <Firebase ID Token>
 */
export async function verifyAdminToken(token: string): Promise<{ ok: boolean; email?: string; decoded?: any }> {
  const auth = getAuth();
  const decoded = await auth.verifyIdToken(token);
  const email = (decoded.email || '').toLowerCase();
  const claims = (decoded as any);
  const allowlist = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const ok = !!(claims.isAdmin) || (!!email && allowlist.includes(email));
  return { ok, email, decoded };
}

/**
 * requireAdminAuth
 * --------------------------------------------------
 * 管理者だけにルートを開放する Express ミドルウェア。
 * - ヘッダ `Authorization: Bearer <ID_TOKEN>` を取り出し、`verifyAdminToken` で検証します。
 * - 管理者ではない場合は 403、トークン不備/検証失敗は 401 を返します。
 * - 成功時は `req.adminUser` に `{ ok, email, decoded }` を格納して次の処理へ進みます。
 *
 * 使用される主なルート（[admin-api/server.ts] 参照）:
 * - `/admin/months` 月一覧取得
 * - `/admin/days` 日一覧取得
 * - `/admin/days/:id/decks` 対象日の上位デッキ取得
 * - `/admin/days/:id/decks/:groupId` デッキ名更新
 * - `/admin/deck-names` デッキ名辞書の取得/追加/更新
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const hdr = String(req.headers.authorization || '');
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ ok:false, error:'missing-authorization' });
  const token = m[1];
  verifyAdminToken(token).then(r => {
    if (!r.ok) return res.status(403).json({ ok:false, error:'forbidden' });
    (req as any).adminUser = r;
    next();
  }).catch(e => {
    return res.status(401).json({ ok:false, error: e?.message || String(e) });
  });
}

/**
 * requireAdminOrScheduler
 * --------------------------------------------------
 * 管理者（ID トークン）または Cloud Scheduler からの呼び出しを許可するミドルウェア。
 * - まず Authorization ヘッダの Bearer トークンがあれば `verifyAdminToken` で検証し、
 *   管理者であれば通します。
 * - それ以外でも、`User-Agent` に "Google-Cloud-Scheduler" を含む場合は通します。
 *   （Cloud Run の `run.invoker` 設定で Cloud Scheduler のみ呼び出せるよう運用する想定）
 * - どちらにも該当しなければ 401 を返します。
 *
 * 使用される主なルート（[admin-api/server.ts] 参照）:
 * - `/pokemon-events/auto-run` 自動処理の開始（スケジューラ or 管理者）
 * - `/pokemon-events/auto-run/latest` 直近実行ログの取得
 * - `/admin/recompute-summaries` 日次/月次サマリ再計算のトリガー
 */
export function requireAdminOrScheduler(req: Request, res: Response, next: NextFunction) {
  const hdr = String(req.headers.authorization || '');
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const token = m[1];
    verifyAdminToken(token).then(r => {
      if (!r.ok) return res.status(403).json({ ok:false, error:'forbidden' });
      (req as any).adminUser = r;
      next();
    }).catch(() => {
      // Firebase トークンでない場合でも、Cloud Scheduler なら許可
      const ua = String(req.headers['user-agent'] || '');
      if (ua.includes('Google-Cloud-Scheduler')) return next();
      return res.status(401).json({ ok:false, error:'unauthorized' });
    });
  } else {
    const ua = String(req.headers['user-agent'] || '');
    if (ua.includes('Google-Cloud-Scheduler')) return next();
    return res.status(401).json({ ok:false, error:'missing-authorization' });
  }
}
