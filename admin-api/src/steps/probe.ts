/*
概要: Step1「Probe」— 対象日のイベント一覧を収集して保存する。
どこで使われるか: admin-api/server.ts の `/pokemon-events/auto-run` で最初に実行されるステップ（Step1）。
役割: Players サイトから対象日のイベントを抽出し、シティリーグ（オープン/シニア/ジュニア）のみを Firestore に新規保存する。
後続処理との関係: ここで保存したイベントが Step2（ランキング収集）やスナップショット作成で参照される。
*/
import { getDb } from '../common/firebase.js';
import { formatJstNow } from '../common/time.js';
import { withFsRetry } from '../common/retry.js';

/*
イベント1件分の構造。
使われ方: `scrapeEvents()` がページから抽出し、`saveCityLeagueEvents()` がこの形を前提に Firestore へ保存する。
*/
export type Event = {
  dateYmd: string;         // 例: "20250307"（YYYYMMDD）。保存や集計で使用。
  dateOnly: string;        // 例: "3/7"（M/D）。スクレイピング時の比較に使用。
  location: string;        // 開催場所（サイト本文から抽出）。
  title: string;           // イベントタイトル（カテゴリ判定に利用）。
  detailUrl: string;       // 詳細ページのURL（ランキング収集で必要）。
  leagueType?: string;     // リーグ種別（保存時に 'シティ' を付与）。
  cityLeagueCategory?: 'オープン' | 'シニア' | 'ジュニア'; // シティリーグのカテゴリ。
};

/*
タイトルからシティリーグ判定とカテゴリ抽出を行う。
使われ方: `runProbe()` 内で抽出済みイベントに対してカテゴリ付与を行う際に呼ばれる。
戻り値: 該当可否とカテゴリ（不明は 'unknown'）。
*/
function analyzeCityLeague(title: string): { isCityLeague: boolean; category: 'オープン'|'シニア'|'ジュニア'|'unknown' } {
  if (!title) return { isCityLeague: false, category: 'unknown' };
  const isCity = /シティリーグ/i.test(title);
  if (!isCity) return { isCityLeague: false, category: 'unknown' };
  if (/オープン/i.test(title)) return { isCityLeague: true, category: 'オープン' };
  if (/シニア/i.test(title)) return { isCityLeague: true, category: 'シニア' };
  if (/ジュニア/i.test(title)) return { isCityLeague: true, category: 'ジュニア' };
  // カテゴリ表記がない場合は 'unknown' で返す（保存時には除外される）。
  return { isCityLeague: true, category: 'unknown' };
}

/*
Players サイトのイベント一覧を巡回し、対象日付(M/D)のイベントを抽出する。
使われ方: `runProbe()` の最初のステップとして、対象ページから必要なフィールドを集める。
ポイント: `offset` パラメータでページ送り（20件単位）。Playwright を使用して DOM を評価。
引数: targetUrl（一覧URL）, targetDateOnly（M/D）, dateYmd（YYYYMMDD固定）, logs（ログ出力）, maxPages（巡回上限）。
戻り値: 対象日に一致したイベント配列と処理したページ数。
*/
async function scrapeEvents(targetUrl: string, targetDateOnly: string, dateYmd: string, logs: string[], maxPages = 3): Promise<{ allMatchingEvents: Event[]; pagesProcessed: number }> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 PokeProbe/1.0' });
  const page = await ctx.newPage();
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
  const allMatchingEvents: Event[] = []; let currentPage = 1; let pagesProcessed = 0;
  while (currentPage <= Math.max(1, maxPages)) { // ページ単位で巡回（20件刻み）
    const offsetStr = await page.evaluate(() => new URL(window.location.href).searchParams.get('offset') || '0');
    logs.push(`probe: ページ ${currentPage} offset=${offsetStr}`);
    // ページ本文から日付・場所・タイトル・詳細リンクのセットを抽出
    const pageEvents = await page.evaluate((p: { targetDateOnly: string }) => {
      const norm = (md: string) => { const [m,d] = md.split('/'); const mi=parseInt(m,10),di=parseInt(d,10); return isNaN(mi)||isNaN(di)?md:`${mi}/${di}`; };
      const lines = document.body.innerText.split('\n').map(l=>l.trim()).filter(Boolean);
      const anchors = Array.from(document.querySelectorAll('a')).filter(a => a.href.includes('/event/detail/')) as HTMLAnchorElement[];
      const events: any[] = []; let linkIndex = 0;
      for (let i=0;i<lines.length-3;i++) {
        const m = lines[i].match(/(\d{1,2}\/\d{1,2})（.）/); if (!m) continue;
        const dateOnly = m[1];
        const ev = { dateOnly, location: lines[i+2]||'', title: lines[i+3]||'', detailUrl: linkIndex<anchors.length? anchors[linkIndex].href : null };
        if (norm(ev.dateOnly) === norm(p.targetDateOnly)) events.push(ev); linkIndex++;
      }
      return events;
    }, { targetDateOnly });
    // 抽出したイベントに対し、呼び出し側で確定している YYYYMMDD を付与
    const withDate = (pageEvents as any[]).map(e => ({ ...e, dateYmd } as Event));
    allMatchingEvents.push(...withDate);
    // 次ページ（offset +20）の URL を生成して遷移
    const nextHref = await page.evaluate((cur: string) => {
      const curI = parseInt(cur,10)||0; const u=new URL(window.location.href); u.searchParams.set('offset', String(curI+20)); return u.toString();
    }, offsetStr);
    await page.goto(nextHref, { waitUntil: 'networkidle', timeout: 60000 });
    pagesProcessed++; currentPage++;
  }
  await browser.close();
  return { allMatchingEvents, pagesProcessed };
}

/*
シティリーグに該当するイベントだけを Firestore に新規保存する（既存はスキップ）。
使われ方: `runProbe()` の保存フェーズで呼ばれる。後続のランキング収集はここで保存されたドキュメントを起点に進む。
仕様: `detailUrl` が同一のものは重複とみなし保存しない。カテゴリ別に連番を採番して一意なドキュメントIDを作成。
戻り値: 保存の有無と保存件数。
*/
async function saveCityLeagueEvents(events: Event[], startedAt: number, targetDateOnly: string, logs: string[]) {
  const db = getDb(); if (events.length === 0) return { saved: false, documents: 0 };
  const batch = db.batch(); const col = db.collection('pokemon-events');
  let savedCount = 0;
  const updatedAt = formatJstNow();

  // カテゴリを英語コードへ変換（ドキュメントID用）
  const toCatCode = (ja: any) => ja === 'シニア' ? 'senior' : ja === 'ジュニア' ? 'junior' : 'open';

  // 同一日付でカテゴリ別の既存件数を集計し、採番の起点にする
  const dateYmdFixed = events[0]?.dateYmd || '';
  const categories: Array<'オープン'|'シニア'|'ジュニア'> = ['オープン','シニア','ジュニア'];
  const existingCounts: Record<string, number> = {};
  for (const cat of categories) {
    const snap = await withFsRetry(() => col.where('dateYmd','==', dateYmdFixed).where('cityLeagueCategory','==', cat).get(), logs, `probe: 既存件数 ${dateYmdFixed} ${cat}`);
    existingCounts[toCatCode(cat)] = (snap?.size || 0);
  }
  const nextSeqByCat: Record<string, number> = { open: existingCounts['open'] || 0, senior: existingCounts['senior'] || 0, junior: existingCounts['junior'] || 0 };

  for (const ev of events) { // 重複チェックと必須フィールド整形
    if (!ev.detailUrl) continue;
    // detailUrl が既存ならスキップ（重複保存を避ける）
    const dup = await withFsRetry(() => col.where('detailUrl','==', ev.detailUrl).limit(1).get(), logs, `probe: URL重複確認`);
    if (dup && !dup.empty) continue;

    const dateOnlyNorm = String(ev.dateOnly).trim();
    const dateYmd = ev.dateYmd; // すでに server 側で確定済み（YYYYMMDD）
    const catJa = ev.cityLeagueCategory as ('オープン'|'シニア'|'ジュニア');
    const catCode = toCatCode(catJa);
    // 連番（2桁）を採番: 既存数 + ローカル増分
    nextSeqByCat[catCode] = (nextSeqByCat[catCode] || 0) + 1;
    const seq2 = String(nextSeqByCat[catCode]).padStart(2,'0');
    const docId = `event-${dateYmd}-${catCode}-${seq2}`;
    const ref = col.doc(docId);

    // 最小限のフィールドで新規作成（rankingsScraped は後続処理で更新）
    batch.set(ref, {
      title: ev.title,
      dateYmd,
      dateOnly: dateOnlyNorm,
      detailUrl: ev.detailUrl,
      cityLeagueCategory: ev.cityLeagueCategory,
      leagueType: 'シティ',
      scrapedAt: new Date(startedAt).toISOString(),
      rankingsScraped: false,
      updatedAt
    });
    logs.push(`probe: 登録 ${docId} title=${ev.title}`);
    savedCount++;
  }
  if (savedCount > 0) await withFsRetry(() => batch.commit(), logs, 'probe: イベント保存コミット');
  return { saved: true, documents: savedCount };
}

/*
Probe のメイン関数。
使われ方: admin-api/server.ts の `/pokemon-events/auto-run` で呼ばれ、処理結果が実行ログと次ステップに渡される。
処理内容: スクレイピング → カテゴリ判定 → Firestore 保存。返り値は実行概要（件数・ページ数・保存結果・イベント抜粋）。
引数: `dateYmd`（YYYYMMDD）, `dateOnly`（M/D）, `logs`（進捗記録）。
*/
export async function runProbe(params: { dateYmd: string; dateOnly: string; logs: string[] }) {
  const { dateYmd, dateOnly, logs } = params;
  const TARGET = 'https://players.pokemon-card.com/event/result/list';
  const startedAt = Date.now();
  // ページ巡回上限（サイト改修時の余裕を見て固定値）
  const pageLimit = 5;
  const { allMatchingEvents, pagesProcessed } = await scrapeEvents(TARGET, dateOnly, dateYmd, logs, pageLimit);
  // シティリーグに該当しカテゴリが明確なものだけを通す
  const classified = allMatchingEvents.flatMap(e => {
    const a = analyzeCityLeague(e.title);
    return (a.isCityLeague && (a.category === 'オープン' || a.category === 'シニア' || a.category === 'ジュニア'))
      ? [{ ...e, cityLeagueCategory: a.category }]
      : [];
  });
  const firestoreResult = await saveCityLeagueEvents(classified, startedAt, dateOnly, logs);
  // 実行概要を返却（オーケストレーターがログや次ステップに利用）
  return {
    ok: true,
    targetDate: dateOnly,
    totalEvents: allMatchingEvents.length,
    pagesProcessed,
    firestore: firestoreResult,
    events: allMatchingEvents.map(({ dateYmd, dateOnly, title, detailUrl }) => ({ dateYmd, dateOnly, title, detailUrl }))
  };
}
