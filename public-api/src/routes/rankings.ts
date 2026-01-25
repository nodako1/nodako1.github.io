import type { Express, Request, Response } from 'express';
import { db } from '../common/firebase.js';

/*
  概要: ランキングの公開用エンドポイントを Express に紐づけるモジュール。

  このモジュールは public-api/public-server.ts から読み込まれ、
  attachRankingRoutes(app) により /api/rankings GET エンドポイントを提供する。

  入力パラメータ（クエリ）:
  - eventId: イベントID。raw なドキュメントID（例: "event-123"）でも数値のみ（"123"）でも可。
            数値のみが渡された場合は "event-<num>" と相互に解決して検索する。
  - category: 日本語のカテゴリ名（"オープン" / "シニア" / "ジュニア"）。省略時はイベント自体のカテゴリを利用。

  主なデータ参照元:
  - pokemon-events: イベントの基本情報（開催日 dateYmd、カテゴリ cityLeagueCategory）を取得。
  - pokemon-event-rankings: 該当イベントの organizer（主催）を特定するために 1 件参照。
  - daily-rankings-snapshots: 日ごと・カテゴリごとのランキングスナップショットから、
    対象 organizer のランキング配列を取得。

  出力:
  - 公開表示用に整形したランキング配列を返す。deckListImageUrl が存在するものを優先し、
    管理側の rank（1,2,3,5,9）を公開側の rank（1,2,4,8,16）へ変換して返却する。

  どこで使われるか:
  - public-api/public-server.ts で attachRankingRoutes(app) が呼ばれ、
    クライアント（アプリやWeb）が /api/rankings?eventId=...&category=... を叩くことで利用される。
*/
export function attachRankingRoutes(app: Express) {
  // 管理側で保存している rank(1,2,3,5,9) → 公開表示用 rank(1,2,4,8,16) への片方向変換
  const toPublicRank = (adminRank: any): number | null => {
    const r = typeof adminRank === 'number' ? adminRank : parseInt(String(adminRank||''),10);
    if (!Number.isFinite(r)) return null;
    if (r === 1) return 1; if (r === 2) return 2; if (r === 3) return 4; if (r === 5) return 8; if (r === 9) return 16;
    return null;
  };
  // 日本語カテゴリ名 → スナップショットIDで利用する英語キー（open/senior/junior）へ変換
  const toCatKey = (ja: string): 'open'|'senior'|'junior'|null => {
    const s = (ja||'').trim();
    if (s === 'オープン') return 'open'; if (s === 'シニア') return 'senior'; if (s === 'ジュニア') return 'junior';
    return null;
  };
  // ランキング一覧の取得エンドポイント（daily-rankings-snapshots をベースに整形して返却）
  app.get('/api/rankings', async (req: Request, res: Response) => {
    try {
      // 1) 入力の検証と正規化: eventId は必須。"123"/"event-123"/任意のID形式を相互に候補化
      const eventIdRaw = req.query.eventId as string; if (!eventIdRaw) return res.status(400).json({ ok: false, error: 'eventId required' });
      const categoryJaInput = (req.query.category || '').toString().trim();
      const isNumeric = /^\d+$/.test(eventIdRaw);
      const eventIdCandidates: string[] = [eventIdRaw];
      if (isNumeric) eventIdCandidates.push(`event-${eventIdRaw}`);
      else if (eventIdRaw.startsWith('event-')) {
        const num = eventIdRaw.replace(/^event-/, ''); if (/^\d+$/.test(num)) eventIdCandidates.push(num);
      }
      // 2) pokemon-events から開催日(dateYmd)とカテゴリ(cityLeagueCategory)を取得
      let eventDocId: string|null = null; let dateYmd: string|null = null; let categoryJa: string|null = null;
      for (const cid of eventIdCandidates) {
        const ev = await db.collection('pokemon-events').doc(cid).get();
        if (ev.exists) { const data = ev.data() as any; eventDocId = cid; dateYmd = data.dateYmd || null; categoryJa = data.cityLeagueCategory || null; break; }
      }
      if (!eventDocId || !dateYmd) return res.status(404).json({ ok: false, error: 'event not found' });
      // 3) カテゴリの決定: クエリ優先。未指定ならイベントのカテゴリを利用
      const catJa = categoryJaInput || categoryJa || '';
      const catKey = toCatKey(catJa);
      if (!catKey) return res.status(400).json({ ok: false, error: 'invalid category' });
      // 4) 主催者(organizer)の特定: pokemon-event-rankings を 1 件だけ参照して抽出
      let organizer: string|null = null;
      const rSnap = await db.collection('pokemon-event-rankings').where('originalEventId','==', eventDocId).limit(1).get();
      if (!rSnap.empty) { organizer = (rSnap.docs[0].data() as any).organizer || null; }
      if (!organizer) return res.status(404).json({ ok: false, error: 'organizer not found' });
      // 5) 日別スナップショットを取得し、該当 organizer のランキング配列を抽出
      const docId = `${dateYmd}-${catKey}`;
      const snap = await db.collection('daily-rankings-snapshots').doc(docId).get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: 'snapshot not found' });
      const data: any = snap.data();
      const groups: Array<{ organizer: string; rankings: any[] }> = Array.isArray(data.groups) ? data.groups : [];
      const group = groups.find(g => (g.organizer||'').trim() === (organizer||'').trim());
      const sourceRows: any[] = group ? group.rankings : [];
      // 6) 画像URL(deckListImageUrl)が存在するエントリのみを公開対象にする
      const usable = sourceRows.filter(r => {
        const u = r.deckListImageUrl; return !!(u && typeof u === 'string' && u.length > 0);
      });
      // 7) 管理側 rank ごとに必要件数を優先取得し、公開用配列を構成
      const byAdminRank = (val: number) => usable.filter(r => (typeof r.rank === 'number' ? r.rank : parseInt(String(r.rank||''),10)) === val);
      const out: any[] = [];
      out.push(...byAdminRank(1).slice(0, 1));
      out.push(...byAdminRank(2).slice(0, 1));
      out.push(...byAdminRank(3).slice(0, 2));
      out.push(...byAdminRank(5).slice(0, 4));
      if (catJa === 'オープン') out.push(...byAdminRank(9).slice(0, 8));
      // 8) 公開レスポンスの形へ最終整形（rank 変換・簡易ID・必要フィールドのみ）
      const rankings = out.map((r:any) => ({
        // スナップショットに固有IDが無いため、dateYmd/catKey/rank/deckId/playerInfo から簡易IDを組み立て
        id: `snap-${dateYmd}-${catKey}-${r.rank}-${r.deckId || 'noid'}-${(r.playerInfo||'').slice(0,10)}`,
        rank: toPublicRank(r.rank),
        points: r.points ?? null,
        player: r.playerInfo || null,
        deckUrl: r.deckUrl || null,
        deckListImageUrl: (typeof r.deckListImageUrl === 'string' && r.deckListImageUrl.length > 0) ? r.deckListImageUrl : null,
        organizer: r.organizer || organizer,
        cityLeagueCategory: catJa,
        environmentName: null,
        // デッキ名はスナップショットの値をそのまま利用（未設定時は空文字）
        deckName: (typeof r.deckName === 'string') ? r.deckName : '',
      }));
      res.json({ ok: true, rankings });
    } catch (e: any) { res.status(500).json({ ok: false, error: e.message || String(e) }); }
  });
}
