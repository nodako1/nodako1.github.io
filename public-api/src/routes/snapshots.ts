import type { Express, Request, Response } from 'express';
import { db } from '../common/firebase.js';
import crypto from 'crypto';

// このモジュールの役割
// - 事前計算して Firestore に保存された「日次/週次/比較」のスナップショットを配信します。
// - 配信用に ETag を付け、クライアントが `If-None-Match` を送った場合は 304 (Not Modified) を返して再ダウンロードを避けます。
// データの作られ方（参照元）
// - 日次スナップショットは 管理APIの自動処理（/pokemon-events/auto-run）で生成され、
//   Firestore コレクション `daily-rankings-snapshots` に保存されます。
// - 週次分布・週次比較は将来的なスナップショット保管先（`weekly-deck-distribution`, `weekly-comparisons`）を想定しています。
// 利用される処理（どこから読まれるか）
// - アプリや外部クライアントが「軽量な既成データ」を素早く取得したいときに本エンドポイントを直接叩きます。
// - なお iOS アプリの主要画面は `/api/〜` 系の整形済みAPIを主として利用しますが、
//   本ルートはキャッシュ性（ETagや長めの Cache-Control）を重視した「生スナップショット」取得用の入り口です。
export function attachSnapshotRoutes(app: Express) {
  // 日次ランキングのスナップショットを返す
  // - エンドポイント: GET /v1/snapshots/daily-rankings?ymd=YYYYMMDD&category=open|senior|junior
  // - 使用箇所の例: 日次のランキング要約をそのまま配信したいバッチ/クライアント
  // - 参照コレクション: Firestore `daily-rankings-snapshots`
  // - ETag: 返却JSONを SHA-256 でハッシュし、同一内容なら 304 を返す
  app.get('/v1/snapshots/daily-rankings', async (req: Request, res: Response) => {
    try {
      // パラメータ取り出しと妥当性確認（YYYYMMDD, カテゴリ指定）
      const ymd = String(req.query.ymd || '').trim();
      const category = String(req.query.category || '').trim(); // open|senior|junior
      if (!ymd || !/^[0-9]{8}$/.test(ymd)) return res.status(400).json({ ok:false, error:'ymd invalid' });
      if (!['open','senior','junior'].includes(category)) return res.status(400).json({ ok:false, error:'category invalid' });
      // Firestore から該当ドキュメントを取得（ID: YYYYMMDD-category）
      const docId = `${ymd}-${category}`;
      const ref = db.collection('daily-rankings-snapshots').doc(docId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ ok:false, error:'snapshot not found' });
      // ETag 計算と 304 応答（内容が同一なら転送を省略）
      const data = snap.data();
      const json = JSON.stringify(data);
      const etag = 'W/"'+crypto.createHash('sha256').update(json).digest('hex').slice(0,32)+'"';
      const inm = req.headers['if-none-match'];
      if (inm && inm === etag) { res.status(304).end(); return; }
      // キャッシュ方針: 1日キャッシュ（日次スナップショットは日単位で更新）
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      // 将来 App Check の有無で応答が分岐する可能性を考慮し Vary を付与
      res.setHeader('Vary', 'X-Firebase-AppCheck');
      return res.json({ ok:true, snapshot:data });
    } catch (e:any) {
      const status = e.statusCode || 500;
      return res.status(status).json({ ok:false, error:e.message || String(e) });
    }
  });

  // 週次のデッキ分布スナップショットを返す
  // - エンドポイント: GET /v1/snapshots/weekly-distribution?week=YYYY-Wn
  //   例: 2026-W3 （ISO週形式に準拠したラベル）
  // - 使用箇所の例: 週単位の分布状況を事前集計済みデータとしてそのまま配信
  // - 参照コレクション: Firestore `weekly-deck-distribution`
  // - ETag/Cache: 1週間のキャッシュを許可
  app.get('/v1/snapshots/weekly-distribution', async (req: Request, res: Response) => {
    try {
      // 週ラベルの妥当性確認（YYYY-Wn）
      const week = String(req.query.week || '').trim(); // YYYY-Wxx
      if (!week || !/^\d{4}-W\d{1,2}$/.test(week)) return res.status(400).json({ ok:false, error:'week invalid' });
      // Firestore から週次ドキュメントを取得
      const ref = db.collection('weekly-deck-distribution').doc(week);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ ok:false, error:'snapshot not found' });
      const data = snap.data();
      const json = JSON.stringify(data);
      const etag = 'W/"'+crypto.createHash('sha256').update(json).digest('hex').slice(0,32)+'"';
      const inm = req.headers['if-none-match'];
      if (inm && inm === etag) { res.status(304).end(); return; }
      // 週次データのため 1週間のキャッシュを許可
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // 1週間
      res.setHeader('Vary', 'X-Firebase-AppCheck');
      return res.json({ ok:true, snapshot:data });
    } catch (e:any) {
      const status = e.statusCode || 500;
      return res.status(status).json({ ok:false, error:e.message || String(e) });
    }
  });

  // 週次比較（今週 vs 先週など）のスナップショットを返す
  // - エンドポイント: GET /v1/snapshots/weekly-comparison?base=YYYY-Wn&prev=YYYY-Wn
  // - 使用箇所の例: 2週の差分やトレンドを一度に配信
  // - 参照コレクション: Firestore `weekly-comparisons`（ID: base-vs-prev）
  app.get('/v1/snapshots/weekly-comparison', async (req: Request, res: Response) => {
    try {
      // 2つの週ラベルを検証
      const base = String(req.query.base || '').trim();
      const prev = String(req.query.prev || '').trim();
      if (!/^\d{4}-W\d{1,2}$/.test(base) || !/^\d{4}-W\d{1,2}$/.test(prev)) return res.status(400).json({ ok:false, error:'week labels invalid' });
      // Firestore から比較用ドキュメントを取得（ID: base-vs-prev）
      const docId = `${base}-vs-${prev}`;
      const ref = db.collection('weekly-comparisons').doc(docId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ ok:false, error:'comparison not found' });
      const data = snap.data();
      const json = JSON.stringify(data);
      const etag = 'W/"'+crypto.createHash('sha256').update(json).digest('hex').slice(0,32)+'"';
      const inm = req.headers['if-none-match'];
      if (inm && inm === etag) { res.status(304).end(); return; }
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.setHeader('Vary', 'X-Firebase-AppCheck');
      return res.json({ ok:true, snapshot:data });
    } catch (e:any) {
      const status = e.statusCode || 500;
      return res.status(status).json({ ok:false, error:e.message || String(e) });
    }
  });
}
