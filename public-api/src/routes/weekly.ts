import type { Express, Request, Response } from 'express';
import { MemoryCache } from '../common/cache.js';
import { countDistinctDeckNamesBySnapshots } from '../services/deckNames.js';
import { countDeckDistributionBySnapshots } from '../services/deckDistribution.js';

/*
  モジュールの役割
  - 公開APIに「週次の集計結果」を提供するルートを登録する。
  - 今週と先週の範囲を計算し、サービス層の集計関数を呼び出して結果を返す。

  利用箇所（どの処理で使われるか）
  - public-api/public-server.ts から `attachWeeklyRoutes(app)` が呼ばれ、Express アプリにルートが組み込まれる。
  - クライアント（Web/iOS等）から `GET /api/weekly/...` へのHTTPリクエストを受け、レスポンスを生成する。

  主要エンドポイント
  - GET /api/weekly/deck-distribution?category=オープン
    上位ランク（1〜3位）のデッキ分布を「今週」と「先週」で返す。
  - GET /api/weekly/distinct-deck-names?category=オープン
    全ランク対象でデッキ名の重複を除いた一覧を「今週」と「先週」で返す。

  実装上の前提
  - 週の切り替えは「月曜日開始」。`mondayStart()` と `rangeThisAndLastWeek()` で範囲を算出する。
  - キャッシュはサービス層（deckDistribution / deckNames）側に集約されており、ここでは再計算の制御を行わない。
    ※ `MemoryCache` のインポートは共通方針に合わせたものだが、本ファイルでは直接使用していない。
*/

// 現在時刻を日本時間換算（UTC+9）で返す。
// 週次の範囲計算を「日本の週感覚」に合わせるために使用。
function jstNow(): Date { return new Date(Date.now() + 9*60*60*1000); }
// 与えられた日付 `d` を含む週の「月曜日00:00(UTC基準)」の時刻を返す。
// UTCの曜日値(0=日〜6=土)から月曜日への差分を計算して補正する。
function mondayStart(d: Date): Date {
  const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const wd = d.getUTCDay(); // 0=Sun..6=Sat
  const deltaToMonday = (wd === 0 ? -6 : 1 - wd);
  return new Date(ms + deltaToMonday*24*60*60*1000);
}

// 「今週」と「先週」の範囲（開始/終了）をまとめて返す。
// - 今週: 月曜0:00 〜 翌週月曜直前まで（ミリ秒単位で前日23:59:59.999相当）
// - 先週: 今週の開始からさらに7日戻した範囲
// ルートハンドラで、サービス層の集計に渡す日付文字列（YYYYMMDD）へ変換して使用する。
function rangeThisAndLastWeek(): { thisFrom: Date; thisTo: Date; lastFrom: Date; lastTo: Date } {
  const now = jstNow();
  const thisMon = mondayStart(now);
  const thisFrom = new Date(thisMon.getTime());
  const thisTo = new Date(thisMon.getTime() + 7*24*60*60*1000 - 1); // inclusive end
  const lastFrom = new Date(thisMon.getTime() - 7*24*60*60*1000);
  const lastTo = new Date(thisMon.getTime() - 1);
  return { thisFrom, thisTo, lastFrom, lastTo };
}

// 週次のルート群を Express アプリに登録するエントリポイント。
// 利用箇所: public-api/public-server.ts で呼び出され、公開APIサーバの起動時に組み込まれる。
export function attachWeeklyRoutes(app: Express) {
  // deck-distribution: 上位ランク(1,2,3)の分布を週次で返す。
  // リクエスト例: /api/weekly/deck-distribution?category=オープン
  app.get('/api/weekly/deck-distribution', async (req: Request, res: Response) => {
    try {
      const category = (req.query.category as string) || '';
      const { thisFrom, thisTo, lastFrom, lastTo } = rangeThisAndLastWeek();
      const fmtYmd = (d: Date) => {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth()+1).padStart(2,'0');
        const da = String(d.getUTCDate()).padStart(2,'0');
        return `${y}${m}${da}`;
      };
      // サービス層でスナップショットを元に分布を集計（キャッシュもサービス側で管理）。
      const thisWeek = await countDeckDistributionBySnapshots({ fromYmd: fmtYmd(thisFrom), toYmd: fmtYmd(thisTo), category, topRanks: [1,2,3] });
      const lastWeek = await countDeckDistributionBySnapshots({ fromYmd: fmtYmd(lastFrom), toYmd: fmtYmd(lastTo), category, topRanks: [1,2,3] });
      const payload = { ok:true, weeklyDeckDistribution: { thisWeek, lastWeek }, category: category||null };
      res.json(payload);
    } catch (e:any) {
      res.status(500).json({ ok:false, error: e.message || String(e) });
    }
  });

  // distinct-deck-names: 全ランク対象で名前の重複を排除した一覧を週次で返す。
  // リクエスト例: /api/weekly/distinct-deck-names?category=オープン
  app.get('/api/weekly/distinct-deck-names', async (req: Request, res: Response) => {
    try {
      const category = (req.query.category as string) || '';
      const { thisFrom, thisTo, lastFrom, lastTo } = rangeThisAndLastWeek();
      const fmtYmd = (d: Date) => {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth()+1).padStart(2,'0');
        const da = String(d.getUTCDate()).padStart(2,'0');
        return `${y}${m}${da}`;
      };
      // サービス層でスナップショットを元に distinct 集計（キャッシュはサービス側で管理）。
      const thisWeek = await countDistinctDeckNamesBySnapshots({ fromYmd: fmtYmd(thisFrom), toYmd: fmtYmd(thisTo), category });
      const lastWeek = await countDistinctDeckNamesBySnapshots({ fromYmd: fmtYmd(lastFrom), toYmd: fmtYmd(lastTo), category });
      const payload = { ok:true, distinctDeckNames: { thisWeek, lastWeek }, category: category||null };
      res.json(payload);
    } catch (e:any) {
      res.status(500).json({ ok:false, error: e.message || String(e) });
    }
  });
}
