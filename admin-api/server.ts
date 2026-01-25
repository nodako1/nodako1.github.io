// 管理用 Admin API のエントリポイント
// 目的: 自動収集処理（イベント/ランキング/日次スナップショット）をHTTP経由で起動・監視するためのWebサーバ。
// 呼び出し元の例:
// - Cloud Scheduler → Cloud Run (GET /pokemon-events/auto-run)
// - 手動運用: ターミナルから `curl` で叩いて実行確認
// - ローカル検証: VS Code のタスク「Admin API: Start」から起動
// このファイルが制御する主なルート:
// - `/pokemon-events/auto-run` : 自動処理の開始（非同期）。内部で `src/steps/*` を順に実行します。
// - `/pokemon-events/auto-run/latest` : 直近の実行ログを取得（監視/デバッグ用）。
// 実行状況は Firestore の `auto-run-executions` コレクションに保存され、Slack Webhook が設定されていれば通知します。

import express, { Request, Response, NextFunction } from 'express';
// 設定フラグ: 自動収集（スクレイパー）一式の有効/無効を切り替える環境設定。
// どのルートで使われるか: `requireScraperEnabled` ミドルウェアを通じて各ルートに適用。
import { SCRAPER_ENABLED } from './src/config.js';
// Firebase Admin / Firestore 初期化ユーティリティ。
// この後の全処理（Firestore書き込み/読み取り）で必要になるため、プロセス起動時に一度だけ呼び出します。
import { initFirebase, getDb } from './src/common/firebase.js';
import { formatJstNow, formatDurationHuman, formatJstCompactNow } from './src/common/time.js';
// 管理UI用: Firebase Auth による管理者認証ミドルウェアと簡易CORS設定
import { requireAdminAuth, requireAdminOrScheduler } from './src/common/auth.js';
// Step 1 で使用: 対象日のイベント一覧取得（Players サイトの巡回）
import { runProbe } from './src/steps/probe.js';
// Step 2 で使用: 各イベントのランキング情報取得
import { runRankings } from './src/steps/rankings.js';
// Step 3 で使用: 日次ランキングスナップショット生成
import { runDailyRankingSnapshots } from './src/steps/snapshots.js';
// Slack通知の内容作成に使用: 収集結果の件数集計
import { collectSummaryCounts } from './src/steps/notify.js';

// Firebase を初期化。
// 役割: 認証情報/プロジェクト設定に基づき Admin SDK を準備し、以降の Firestore 操作を可能にします。
initFirebase();
// Firestore（データベース）参照を取得。各ステップやログ保存で利用します。
const db = getDb();

// Express Webサーバを構築します。
const app = express();
// 待受ポート。Cloud Run 環境では `PORT` が渡されます。ローカルは 8080 を既定値にします。
const PORT = process.env.PORT || 8080;
// Cloud Run 等のプロキシ越しで正しいクライアント情報を取得するための設定。
app.set('trust proxy', true);

// ------------------------------------------------------------
// 簡易 CORS 設定: GitHub Pages からのアクセスを許可します。
// 許可オリジンは環境変数 ADMIN_UI_ORIGIN を使用（未設定時は '*' で許可）。
// 認証ヘッダ/プリフライト(OPTIONS) に対応します。
const ADMIN_UI_ORIGIN = process.env.ADMIN_UI_ORIGIN || '*';
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', ADMIN_UI_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ミドルウェア: 自動収集を停止する安全装置。
// 説明: 運用切替や一時停止が必要な場合、`SCRAPER_ENABLED=false` で全ルートを 503 にします。
// 使用箇所: `/pokemon-events/auto-run` と `/pokemon-events/auto-run/latest` の前段で適用。
function requireScraperEnabled(_req: Request, res: Response, next: NextFunction) {
  if (!SCRAPER_ENABLED) {
    return res.status(503).json({ ok: false, error: '設定によりスクレイパーが無効です (SCRAPER_ENABLED=false)' });
  }
  return next();
}

// ----------------------------------------------------------------------------
// ルート: `/pokemon-events/auto-run`
// 役割: 自動処理のオーケストレーション開始。
// 応答: 常に HTTP 202（即時）で受理を返し、処理本体は非同期で継続。
// 利用ステップ: `runProbe` → `runRankings` → `runDailyRankingSnapshots` → Slack通知作成 (`collectSummaryCounts`)
// Firestore保存: 実行ログ/状態を `auto-run-executions/{JST-ID}` に記録（開始・完了・失敗）。
// クエリ例: `dateYmd=YYYYMMDD` で対象日を上書き可能。未指定時は JST の前日を採用。
// イベント0件時: 後続ステップをスキップし、Slack通知のみ送信して終了。
// ----------------------------------------------------------------------------
app.get('/pokemon-events/auto-run', requireScraperEnabled, requireAdminOrScheduler, async (req: Request, res: Response) => {
  const fastAck = true; // 非同期モード（202 Acceptedで即時応答）

  // 実処理（オーケストレーション）本体。
  // 説明: ここで対象日を決定し、各ステップを順次実行。進捗と結果を Firestore と Slack に反映します。
  const runFull = async (query: any) => {
    // 実行ID作成: JST 基準のタイムスタンプでドキュメントIDを可読にします。
    const now = new Date();
    const jstMs = now.getTime() + 9*60*60*1000;
    const jst = new Date(jstMs);
    const pad = (n:number, w=2) => String(n).padStart(w,'0');
    const idJst = `${jst.getUTCFullYear()}${pad(jst.getUTCMonth()+1)}${pad(jst.getUTCDate())}-${pad(jst.getUTCHours())}${pad(jst.getUTCMinutes())}${pad(jst.getUTCSeconds())}-${pad(jst.getUTCMilliseconds(),3)}`;

    const startedAtMs = now.getTime(); // 実行時間の測定用
    const logs: string[] = []; // 進捗ログ（Firestore に保存し、監視で参照）
    const webhook = process.env.SLACK_WEBHOOK_URL; // Slack通知用（設定がない場合は送信しない）
    // 実行履歴ドキュメント参照（JSTベースID）
    const execRef = db.collection('auto-run-executions').doc(idJst);
    const writeExec = async (data: any) => {
      try {
        await execRef.set({ ...data, updatedAt: formatJstNow() }, { merge: true });
      } catch {}
    };
    // 実行開始の記録（監視・追跡用）
    await writeExec({ status: 'running', startedAt: formatJstCompactNow(), fastAck });
    try {
      // 対象日決定 (JST)。既定は前日。`?dateYmd=YYYYMMDD` 指定があれば上書きします。
      const jst = (ms = Date.now()) => new Date(ms + 9*60*60*1000);
      const toYmd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
      const toMd = (d: Date) => `${d.getUTCMonth()+1}/${d.getUTCDate()}`;
      const dateOverrideRaw = (req.query.dateYmd as string | undefined) || undefined;
      let dateYmd: string; let dateOnly: string;
      if (dateOverrideRaw && /^\d{8}$/.test(dateOverrideRaw)) {
        // YYYYMMDD を UTC に変換し、M/D 表記を算出（ロギング用）。
        const y = parseInt(dateOverrideRaw.slice(0,4),10);
        const m = parseInt(dateOverrideRaw.slice(4,6),10);
        const d = parseInt(dateOverrideRaw.slice(6,8),10);
        const dt = new Date(Date.UTC(y, m-1, d));
        dateYmd = dateOverrideRaw;
        dateOnly = toMd(dt);
        logs.push(`対象日を決定: override ymd=${dateYmd} md=${dateOnly}`);
      } else {
        const prev = jst(Date.now() - 24*60*60*1000);
        dateYmd = toYmd(prev);
        dateOnly = toMd(prev);
        logs.push(`対象日を決定: ymd=${dateYmd} md=${dateOnly}`);
      }

      // Step 1: イベント一覧収集（runProbe）
      // 使用目的: 対象日に開催されたイベントを Players サイトから巡回取得します。
      logs.push('Step 1: イベント収集 (Probe)');
      const probe = await runProbe({ dateYmd, dateOnly, logs });
      if (!probe.ok) throw new Error('Probe に失敗');
      // イベント0件の扱い: 後続ステップ（Rankings/Snapshots）はスキップし、通知のみ送信。
      if ((probe.totalEvents || 0) === 0) {
        if (webhook) {
          const msg = [
            `🃏 自動実行 完了 (対象イベントなし) (${new Date().toLocaleString('ja-JP',{ timeZone:'Asia/Tokyo'})})`,
            `• 対象日: ${dateOnly}`,
            `• 収集イベント: 0 件`
          ].join('\n');
          try { await fetch(webhook, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: msg }) }); } catch {}
        }
        const dur = Date.now() - startedAtMs;
        await writeExec({ status:'finished', ok:true, logs, durationMs: formatDurationHuman(dur), duration: formatDurationHuman(dur), endedAt: formatJstCompactNow() });
        return;
      }

      // Step 2: ランキング収集（runRankings）
      // 使用目的: 各イベントに紐づく入賞データを取得します。`rankingsForce=true` で再取得を強制可能。
      logs.push('Step 2: ランキング収集');
      const forceRanks = ((query.rankingsForce as string) === 'true');
      const ranks = await runRankings({ dateYmd, logs, force: forceRanks });
      if (!ranks.ok) throw new Error('ランキング収集に失敗');

      // Step 3: 日次スナップショット生成（runDailyRankingSnapshots）
      // 使用目的: その日のランキング一覧をスナップショット化して保存（集計・配信のための静的データ）。
      logs.push('Step 3: 日次スナップショット生成');
      const dailySnap = await runDailyRankingSnapshots({ dateYmd, force: true, logs });

      // Step 4: Slack通知（collectSummaryCounts）
      // 使用目的: 収集/生成件数のサマリを作成し、Slack にテキスト送信します。
      logs.push('Step 4: Slack通知送信');
      const counts = await collectSummaryCounts(dateYmd, logs);
      if (webhook) {
        const ev = counts.eventsByCategory as any; const rk = counts.rankingsByCategory as any;
        const msg = [
          `🃏 自動実行 完了 (${new Date().toLocaleString('ja-JP',{ timeZone:'Asia/Tokyo'})})`,
          `• 対象日: ${dateOnly}`,
          `• イベント内訳: 合計 ${ev.total ?? 0} 件（オープン: ${ev['オープン'] ?? 0} / シニア: ${ev['シニア'] ?? 0} / ジュニア: ${ev['ジュニア'] ?? 0}）`,
          `• ランキング内訳: 合計 ${rk.total ?? 0} 件（オープン: ${rk['オープン'] ?? 0} / シニア: ${rk['シニア'] ?? 0} / ジュニア: ${rk['ジュニア'] ?? 0}）`,
          `• パリティ: deckable ${counts.deckableRankings} / total ${counts.rankingsTotal}`
        ].join('\n');
        try { await fetch(webhook, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: msg }) }); } catch {}
      }
      const dur = Date.now() - startedAtMs;
      // 実行完了の記録（監視用）。
      await writeExec({ status:'finished', ok:true, logs, durationMs: formatDurationHuman(dur), duration: formatDurationHuman(dur), endedAt: formatJstCompactNow() });
    } catch (e: any) {
      // 失敗時の記録: エラー内容と所要時間を Firestore に残し、監視で把握可能にします。
      const dur = Date.now() - startedAtMs;
      await writeExec({ status:'error', ok:false, error: e?.message || String(e), logs, durationMs: formatDurationHuman(dur), duration: formatDurationHuman(dur), endedAt: formatJstCompactNow() });
    }
  };

  // 非同期モード: すぐに 202 を返し、内部で `runFull` を継続実行（タイムアウト回避）。
  runFull(req.query); // fire-and-forget 実行
  return res.status(202).json({ ok:true, accepted:true, mode:'fastAck' });
});

// ルート: `/pokemon-events/auto-run/latest`
// 役割: 直近の実行ログ（状態・時刻・メッセージ）を 1 件返却。
// 使用場面: 運用監視/疎通確認/スケジューラからの実行確認に活用します。
app.get('/pokemon-events/auto-run/latest', requireScraperEnabled, requireAdminOrScheduler, async (_req: Request, res: Response) => {
  try {
    const snap = await db.collection('auto-run-executions').orderBy('updatedAt','desc').limit(1).get();
    if (snap.empty) return res.status(404).json({ ok:false, error:'no-executions' });
    const doc = snap.docs[0];
    const data = doc.data();
    return res.json({ ok:true, id: doc.id, data });
  } catch (e: any) {
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

// ============================================================================
// 管理UI用 API ルート群（認証必須）
// 目的: 月/日一覧、対象デッキ取得、デッキ名更新、辞書CRUD、サマリ再計算。
// セキュリティ: 全ルートで Firebase ID トークン検証 + 管理者判定（claims or allowlist）。
// ============================================================================

// 月一覧: admin-work-months から直近の月を取得
app.get('/admin/months', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const snap = await db.collection('admin-work-months').orderBy('updatedAt', 'desc').limit(18).get();
    const months = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json(months);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// 日付一覧: 指定月/league の admin-work-days を取得
app.get('/admin/days', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const month = String(req.query.month || '').trim();
    const league = String(req.query.league || 'open').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ ok:false, error:'invalid-month' });
    const lower = `${month}-01`;
    const upper = `${month}-31`;
    // Firestore の複合インデックス不要な形にリライト: date 範囲のみで取得し、メモリで league を絞り込み
    const snap = await db.collection('admin-work-days')
      .where('date','>=', lower)
      .where('date','<=', upper)
      .orderBy('date','desc')
      .get();
    const days = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
    const filtered = days.filter(v => String(v.league || '') === league);
    return res.json(filtered);
  } catch (e: any) {
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

// 対象日のデッキ群取得（rank 1,2,3 のみ）
app.get('/admin/days/:id/decks', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const doc = await db.collection('daily-rankings-snapshots').doc(id).get();
    if (!doc.exists) return res.status(404).json({ ok:false, error:'not-found' });
    const data = doc.data() || {} as any;
    const rankings = (data.rankings || []) as any[];
    // rank 1,2,3 のみ抽出し、groupId はスナップショット内の値を使用
    const targets = rankings.filter(r => [1,2,3].includes(Number(r.rank))).map(r => ({
      groupId: r.groupId,
      rank: r.rank,
      deckListImageUrl: r.deckListImageUrl,
      deckName: (r.deckName ?? null),
    })).filter(r => !!r.groupId);
    return res.json(targets);
  } catch (e: any) {
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

// バッチ更新（部分成功可）: 指定日の複数 groupId の deckName をまとめて更新
app.post('/admin/days/:id/decks:batchUpdate', requireAdminAuth, express.json(), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const itemsRaw = Array.isArray(req.body?.items) ? req.body.items : [];
    // 入力検証と正規化（最後優先）
    const map = new Map<string, string>();
    const seen = new Set<string>();
    const errors: Array<{ groupId: string; code: string; message: string }> = [];
    for (const it of itemsRaw) {
      const groupId = String(it?.groupId || '').trim();
      const deckName = String(it?.deckName || '').trim();
      if (!groupId) { errors.push({ groupId: '', code: 'invalid-groupId', message: 'groupIdが空です' }); continue; }
      if (seen.has(groupId)) { errors.push({ groupId, code: 'duplicate-groupId', message: '同一バッチに重複するgroupIdが含まれています' }); continue; }
      seen.add(groupId);
      if (!deckName) { errors.push({ groupId, code: 'invalid-deckName', message: 'deckNameが空です' }); continue; }
      if (deckName.length > 64) { errors.push({ groupId, code: 'too-long', message: 'deckNameの長さが許容超過' }); continue; }
      // 許容文字種の簡易チェック（日本語・英数・記号を許容。厳密化は必要に応じて）
      // if (!/^[\p{L}\p{N}\s\-!?:。、・（）()]+$/u.test(deckName)) { ... }
      map.set(groupId, deckName); // 最後優先
    }

    const ref = db.collection('daily-rankings-snapshots').doc(id);
    let updatedCount = 0;
    const updatedIds: string[] = [];
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('not-found');
      const data = snap.data() || {} as any;
      let rankingsChanged = false;
      let groupsChanged = false;
      // rankings 側の更新
      if (Array.isArray(data.rankings)) {
        const rankings = [...data.rankings];
        for (let i=0;i<rankings.length;i++) {
          const gid = String(rankings[i]?.groupId || '');
          if (!gid) continue;
          if (map.has(gid)) {
            rankings[i] = { ...rankings[i], deckName: map.get(gid) };
            rankingsChanged = true;
            updatedCount++;
            updatedIds.push(gid);
          }
        }
        if (rankingsChanged) tx.update(ref, { rankings });
      }
      // groups 側の更新
      if (Array.isArray(data.groups)) {
        const groups = [...data.groups];
        for (let gi=0; gi<groups.length; gi++) {
          const g = groups[gi];
          if (Array.isArray(g?.rankings)) {
            const rs = [...g.rankings];
            for (let ri=0; ri<rs.length; ri++) {
              const gid = String(rs[ri]?.groupId || '');
              if (!gid) continue;
              if (map.has(gid)) {
                rs[ri] = { ...rs[ri], deckName: map.get(gid) };
                groupsChanged = true;
              }
            }
            groups[gi] = { ...g, rankings: rs };
          }
        }
        if (groupsChanged) tx.update(ref, { groups });
      }

      // groupId が存在しないものはエラーとして追記
      for (const [gid] of map.entries()) {
        const existsInRankings = Array.isArray(data.rankings) && data.rankings.some((r: any) => String(r?.groupId||'') === gid);
        const existsInGroups = Array.isArray(data.groups) && data.groups.some((g: any) => Array.isArray(g?.rankings) && g.rankings.some((r: any) => String(r?.groupId||'') === gid));
        if (!existsInRankings && !existsInGroups) {
          errors.push({ groupId: gid, code: 'group-not-found', message: '対象groupIdが存在しません' });
        }
      }
    });

    // 更新があればサマリ再計算
    if (updatedCount > 0) {
      const dateStr = id.slice(0,8); // YYYYMMDD
      const monthStr = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}`;
      const dayStr = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
      await recomputeDailySummary(id, dayStr, 'open');
      await recomputeMonthlySummary(monthStr, 'open');
    }
    return res.json({ ok:true, updatedCount, errors, updatedIds });
  } catch (e: any) {
    if (String(e?.message) === 'not-found') return res.status(404).json({ ok:false, error:'not-found' });
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

// 旧: 個別デッキ名更新エンドポイント（UI統合により廃止）

// デッキ名辞書: 取得
app.get('/admin/deck-names', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const all = String(req.query.all || 'false') === 'true';
    // yomi を廃止し、入力値（name, カタカナ）で昇順並び替え。複合インデックス不要のため isActive はメモリで絞り込み
    const snap = await db.collection('deck-names').orderBy('name', 'asc').get();
    let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!all) items = items.filter((v: any) => !!v.isActive);
    return res.json(items);
  } catch (e: any) {
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

// デッキ名辞書: 追加
app.post('/admin/deck-names', requireAdminAuth, express.json(), async (req: Request, res: Response) => {
  try {
    const name = (req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ ok:false, error:'invalid-name' });
    const ref = db.collection('deck-names').doc(name);
    const snap = await ref.get();
    if (snap.exists) return res.status(409).json({ ok:false, error:'duplicate-name' });
    await ref.set({ name, isActive: true, createdAt: formatJstNow(), updatedAt: formatJstNow() });
    return res.status(201).json({ ok:true });
  } catch (e: any) {
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

// デッキ名辞書: 更新（無効化/読み仮名修正）
app.patch('/admin/deck-names/:name', requireAdminAuth, express.json(), async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name);
    const ref = db.collection('deck-names').doc(name);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok:false, error:'not-found' });
    const patch: any = { updatedAt: formatJstNow() };
    if (typeof req.body?.isActive === 'boolean') patch.isActive = !!req.body.isActive;
    await ref.update(patch);
    return res.json({ ok:true });
  } catch (e: any) {
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

// サマリ再計算（毎日/毎月）
app.post('/admin/recompute-summaries', requireAdminOrScheduler, async (req: Request, res: Response) => {
  try {
    const scope = String(req.query.scope || '').trim();
    let date = String(req.query.date || '').trim();
    const jstDate = (ms = Date.now()) => new Date(ms + 9*60*60*1000);
    const fmtYmd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    const fmtYm = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
    if (scope === 'daily') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        // auto: 前日(JST)を対象にする
        const prev = jstDate(Date.now() - 24*60*60*1000);
        date = fmtYmd(prev);
      }
      const ymd = date.replace(/-/g,'');
      const id = `${ymd}-open`;
      await recomputeDailySummary(id, date, 'open');
      return res.json({ ok:true });
    } else if (scope === 'monthly') {
      if (!/^\d{4}-\d{2}$/.test(date)) {
        // auto: 当日(JST)の年月
        const now = jstDate();
        date = fmtYm(now);
      }
      await recomputeMonthlySummary(date, 'open');
      return res.json({ ok:true });
    }
    return res.status(400).json({ ok:false, error:'invalid-scope' });
  } catch (e: any) {
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

// --------------------
// サマリ計算ヘルパー
async function recomputeDailySummary(id: string, date: string, league: string) {
  const ref = db.collection('daily-rankings-snapshots').doc(id);
  const dayRef = db.collection('admin-work-days').doc(id);
  const snap = await ref.get();
  const data = snap.data() || {} as any;
  const rankings = (data?.rankings || []) as any[];
  const targets = rankings.filter((r: any) => [1,2,3].includes(Number(r.rank)));
  const totalTargets = targets.length;
  const completedTargets = targets.filter((r: any) => !!(r.deckName && String(r.deckName).trim())).length;
  const allComplete = totalTargets > 0 && completedTargets === totalTargets;
  await dayRef.set({ date, league, totalTargets, completedTargets, allComplete, updatedAt: formatJstNow() }, { merge: true });
}

async function recomputeMonthlySummary(month: string, league: string) {
  const lower = `${month}-01`;
  const upper = `${month}-31`;
  let daysSnap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
  try {
    // まずは複合インデックスがなくても通るクエリ（date 範囲のみ）で取得し、メモリで league を絞る
    daysSnap = await db.collection('admin-work-days')
      .where('date','>=', lower)
      .where('date','<=', upper)
      .get();
  } catch (e) {
    // フォールバック（念のため）
    daysSnap = await db.collection('admin-work-days')
      .where('date','>=', lower)
      .where('date','<=', upper)
      .get();
  }
  const docs = daysSnap.docs.filter(d => (d.data() as any)?.league === league);
  const totalDays = docs.length;
  let completedDays = 0;
  docs.forEach(d => { const v:any = d.data(); if (v?.allComplete) completedDays++; });
  const allComplete = totalDays > 0 && completedDays === totalDays;
  const monthRef = db.collection('admin-work-months').doc(month);
  await monthRef.set({ totalDays, completedDays, allComplete, updatedAt: formatJstNow() }, { merge: true });
}

// 注記: 管理用途の個別HTTPルート（purge/seed）は廃止。
// データ削除や後片付けが必要な場合は [admin-api/src/purgeData.ts](admin-api/src/purgeData.ts) を使用してください。

// サーバ起動: 指定ポートで待受開始。
// 使用場面: Cloud Run デプロイ時/ローカルの `npm start` 実行時にこの `listen` が呼ばれます。
app.listen(PORT, () => {
  console.log(`Admin API モジュールサーバ起動: port=${PORT}`);
});
