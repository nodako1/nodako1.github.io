/**
 * ファイル概要: シティリーグのランキング収集ステップ（Step 2）
 * 使用箇所: admin-api/server.ts の自動実行フロー（pokemon-events/auto-run 等）で呼び出されます。
 *
 * 役割:
 * - Probe（Step 1）で Firestore に保存済みのイベント（pokemon-events）から対象日（YYYYMMDD）を抽出
 * - Players の JSON エンドポイントからランキングを取得（必要に応じてブラウザ/HTML解析へフォールバック）
 * - ランキングを pokemon-event-rankings に保存し、イベントに `rankingsScraped=true` を付与
 *
 * 主な入出力:
 * - 読み込み: pokemon-events（dateYmd, detailUrl, leagueType など）
 * - 書き込み: pokemon-event-rankings（rank, playerInfo, deckUrl, imageStored=false 等）
 * - 更新: pokemon-events（rankingsScraped, rankingsScrapedAt, updatedAt）
 * - 後続利用: images.ts（imageStored=false の行のみ画像保存対象）、public-api/iOS クライアントの表示
 */
import { getDb } from '../common/firebase.js';
import { withFsRetry } from '../common/retry.js';
import { canonicalizeDeckUrl, extractDeckIdFromUrl } from '../common/deck.js';
import { formatJstNow } from '../common/time.js';
/**
 * 指定日のシティリーグイベントに対してランキングを取得して保存するメイン関数。
 * 使用箇所: admin-api/server.ts の自動処理ルートで Step 2 として実行。
 *
 * パラメータ:
 * - dateYmd: Probe が保存した YYYYMMDD（この値で対象イベントを抽出）
 * - logs: 実行ログの蓄積配列（API応答やフォールバック状況、保存件数などを記録）
 * - force: カテゴリ不一致時の救済で他カテゴリも試すモード（任意）
 *
 * 戻り値:
 * - 実行概要（対象日、処理イベント数、保存件数、イベントごとの結果など）
 */
export async function runRankings(params: { dateYmd: string; logs: string[]; force?: boolean }) {
  const db = getDb(); const { logs, dateYmd, force } = params; const evRef = db.collection('pokemon-events');
  // 対象日（YYYYMMDD）でイベント群を抽出。Probe（Step 1）が付与した `dateYmd` を使用。
  const qSnap = await withFsRetry(() => evRef.where('dateYmd','==', dateYmd).get(), logs, 'ランキング: 対象日(dateYmd)で検索');
  const baseDocs = qSnap ? (qSnap as any).docs : [];
  let targets = (baseDocs as any[])
    .map((d: any) => ({ id: d.id, data: d.data() as any }))
    .filter((x: any) => !!x.data.detailUrl)
    .filter((x: any) => (x.data.leagueType === 'シティ' || x.data.leagueType === 'city'))
    .filter((x: any) => (force ? true : (x.data.rankingsScraped !== true)));
  /**
   * Players の JSON エンドポイント（event_result_detail_search）からランキングを取得。
   * 使用箇所: `saveRankingsForEventLocal()` の最初の取得経路。
   * 仕様: per_page=8, offset=0/8（オープンのみ 2 ページ目）。rank は 1, 2, 3, 5, 9 のみ採用。
   * 返却: 店舗名（organizer）と正規化済み結果配列。
   */
  async function fetchEventRankingsViaApi(detailUrl: string, categoryJa: 'オープン'|'シニア'|'ジュニア', perPage = 8, maxPages = 2, logs?: string[]) {
    const m = detailUrl.match(/\/event\/detail\/(\d+)/); if (!m) throw new Error(`cannot extract event_holding_id from ${detailUrl}`);
    const eventHoldingId = m[1];
    const code = categoryJa === 'シニア' ? 'senior' : categoryJa === 'ジュニア' ? 'junior' : 'open';
    // 正式エンドポイント（per_page=8 でページング、2ページ目は offset=8）
    const base = new URL('https://players.pokemon-card.com/event_result_detail_search');
    base.searchParams.set('event_holding_id', eventHoldingId);
    base.searchParams.set('event_result_category', code);
    base.searchParams.set('per_page', String(perPage));
    base.searchParams.set('offset', '0');
    const headers = {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 PokeRank/1.0',
      'Referer': detailUrl,
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8'
    } as Record<string,string>;
    const resp = await fetch(base.toString(), { headers });
    if (!resp.ok) {
      const body = await resp.text().catch(()=> '');
      logs && logs.push(`rankings: api non-OK status=${resp.status} url=${base.toString()} sample=${body.slice(0,120)}`);
      return { organizer: null, results: [] } as any;
    }
    const ct = resp.headers.get('content-type')||'';
    if (!ct.includes('application/json')) {
      const body = await resp.text().catch(()=> '');
      logs && logs.push(`rankings: api non-JSON ct=${ct} url=${base.toString()} sample=${body.slice(0,120)}`);
      return { organizer: null, results: [] } as any;
    }
    const first = await resp.json();
    const organizer = first.event?.shopName || null;
    const allowed = new Set([1,2,3,5,9]);
    const all: any[] = [];
    // Page 1（offset=0）で許可ランクの先頭8件を採用
    const page0 = (first.results || []).filter((r: any) => allowed.has(Number(r.rank))).slice(0, 8);
    all.push(...page0);
    // Page 2（オープンのみ offset=8）で許可ランクの先頭8件を採用
    if (categoryJa === 'オープン') {
      const url = new URL(base.toString()); url.searchParams.set('offset', String(perPage));
      const r2 = await fetch(url.toString(), { headers });
      if (r2.ok) {
        const j2 = await r2.json().catch(()=>null);
        if (j2 && Array.isArray(j2.results)) {
          const page1 = j2.results.filter((r: any) => allowed.has(Number(r.rank))).slice(0, 8);
          all.push(...page1);
        }
      }
    }
    let normalized = all.map((r: any) => ({
      rank: r.rank, name: r.name, point: r.point, player_id: r.player_id, area: r.area,
      deck_id: r.deck_id || null, deckViewUrl: r.deck_id ? `https://players.pokemon-card.com/deck/${r.deck_id}` : null
    }));
    // API経路では rank は元データをそのまま使用（1,2,3,5,9 のみ）
    if (!normalized || normalized.length === 0) {
      logs && logs.push(`rankings: api empty eventHoldingId=${eventHoldingId} category=${code}`);
    }
    return { organizer, results: normalized };
  }
  /**
   * ブラウザ経由のフォールバック。イベント詳細ページを開いて同ドメインから JSON を取得。
   * 使用箇所: API経路が空の場合のフォールバックとして `saveRankingsForEventLocal()` で使用。
   * 返却: organizer と正規化済み結果配列。
   */
  async function fetchEventRankingsViaBrowser(detailUrl: string, categoryJa: 'オープン'|'シニア'|'ジュニア', perPage = 8, maxPages = 2, logs?: string[]) {
    const m = detailUrl.match(/\/event\/detail\/(\d+)/); if (!m) throw new Error(`cannot extract event_holding_id from ${detailUrl}`);
    const eventHoldingId = m[1]; const code = categoryJa === 'シニア' ? 'senior' : categoryJa === 'ジュニア' ? 'junior' : 'open';
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 PokeRank/1.0' });
    const page = await ctx.newPage(); await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const base = new URL('https://players.pokemon-card.com/event_result_detail_search');
    base.searchParams.set('event_holding_id', eventHoldingId);
    base.searchParams.set('event_result_category', code);
    base.searchParams.set('per_page', String(perPage));
    base.searchParams.set('offset', '0');
    const first: any = await page.evaluate(async (u) => {
      const r = await fetch(u.toString(), {
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        }
      });
      if (!r.ok) return null; const ct = r.headers.get('content-type')||''; if (!ct.includes('application/json')) return null; return await r.json();
    }, base);
    if (!first) {
      // 非JSONのサンプルを取得してログに一部残す
      const txt: any = await page.evaluate(async (u) => { try { const r = await fetch(u.toString()); const t = await r.text(); return t.slice(0,200); } catch(e){ return String(e).slice(0,120); } }, base);
      logs && logs.push(`rankings: browser first null url=${base.toString()} sample=${String(txt)}`);
    }
    let organizer = first?.event?.shopName || null;
    const allowed = new Set([1,2,3,5,9]);
    const all: any[] = [];
    // Page 1
    const p0 = (first?.results || []).filter((r: any) => allowed.has(Number(r.rank))).slice(0, 8);
    all.push(...p0);
    // Page 2（オープンのみ offset=8）
    if (categoryJa === 'オープン') {
      const url = new URL(base.toString()); url.searchParams.set('offset', String(perPage));
      const j2: any = await page.evaluate(async (u) => { const r = await fetch(u.toString(), { headers: { 'Accept':'application/json','X-Requested-With':'XMLHttpRequest' } }); if (!r.ok) return null; const ct = r.headers.get('content-type')||''; if (!ct.includes('application/json')) return null; return await r.json(); }, url);
      if (j2 && Array.isArray(j2.results)) {
        const p1 = j2.results.filter((r: any) => allowed.has(Number(r.rank))).slice(0, 8);
        all.push(...p1);
      }
    }
    await browser.close();
    let normalized = all.map((r: any) => ({
      rank: r.rank, name: r.name, point: r.point, player_id: r.player_id, area: r.area,
      deck_id: r.deck_id || null, deckViewUrl: r.deck_id ? `https://players.pokemon-card.com/deck/${r.deck_id}` : null
    }));
    return { organizer, results: normalized };
  }
  /**
   * HTML解析フォールバック。ランキング相当のデッキリンクを抽出し最小限の情報を構成。
   * 使用箇所: API/ブラウザが両方とも空の場合の最終フォールバック。
   * 制限: 各ページ最大 8 件、オープンは 2 ページ分、rank はページごとに固定割り当て。
   */
  async function fetchEventRankingsViaHtml(detailUrl: string, categoryJa: 'オープン'|'シニア'|'ジュニア', maxLinks = 16, logs?: string[]) {
    const m = detailUrl.match(/\/event\/detail\/(\d+)/); if (!m) throw new Error(`cannot extract event_holding_id from ${detailUrl}`);
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 PokeRank/1.0' });
    const page = await ctx.newPage();
    const baseResult = detailUrl.includes('/result') ? detailUrl : (detailUrl.replace(/\/$/, '') + '/result');
    const perPage = 8;
    const totalPages = (categoryJa === 'オープン') ? 2 : 1;

    const uniq: Record<string, boolean> = {}; const collected: any[] = [];
    const allowedRanks = new Set([1,2,3,5,9]);
    for (let p = 0; p < totalPages; p++) {
      const url = new URL(baseResult);
      if (p > 0) url.searchParams.set('offset', String(p * perPage));
      await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 60000 });
      const pageItems: Array<{ href: string; rank: number|null }> = await page.evaluate(() => {
        const as = Array.from(document.querySelectorAll('a[href*="/deck/"]')) as HTMLAnchorElement[];
        return as.map(a => ({ href: a.href, rank: null }));
      });
      logs && logs.push(`rankings: html deck links found=${pageItems.length} url=${url.toString()}`);
      const thisPage: any[] = [];
      const assignRanksPage0 = [1,2,3,3,5,5,5,5];
      const assignRanksPage1 = [9,9,9,9,9,9,9,9];
      const rankPlan = (p === 0) ? assignRanksPage0 : assignRanksPage1;
      for (const it of pageItems) {
        const href = it.href; const deck_id = extractDeckIdFromUrl(href);
        if (!deck_id) continue; if (uniq[href]) continue; // 同一リンクの重複のみ排除
        uniq[href] = true;
        const rk = rankPlan[thisPage.length] || null;
        if (rk == null) break; // 8件に到達したら打ち切り
        thisPage.push({ rank: rk, name: null, point: null, player_id: `${deck_id}`, area: null, deck_id, deckViewUrl: href });
        if (thisPage.length >= 8) break; // 各ページ8件
      }
      collected.push(...thisPage);
      if (categoryJa !== 'オープン') break; // ジュニア/シニアは1ページのみ
    }
    await browser.close();
    return { organizer: null, results: collected };
  }
  /**
   * 単一イベントのランキングを取得して Firestore に保存し、イベント側のフラグを更新。
   * 使用箇所: `runRankings()` の各イベント処理ループ内。
   * - 取得順序: API → ブラウザ → HTML のフォールバック。
   * - 保存先: pokemon-event-rankings（rank ごとに seq を採番）、imageStored=false を初期化。
   * - イベント更新: `rankingsScraped=true` と更新時刻を記録。
   * 戻り値: 保存件数・organizer・総取得件数の概要。
   */
  async function saveRankingsForEventLocal(eventDocId: string, eventTitle: string, leagueCategoryJa: 'オープン'|'シニア'|'ジュニア', detailUrl: string, eventDateOnly: string|null, logs?: string[], force?: boolean) {
    const updatedAt = formatJstNow();
    // まずは JSON API で取得を試み、0件の場合はブラウザ → HTML の順でフォールバック
    let { organizer, results } = await fetchEventRankingsViaApi(detailUrl, leagueCategoryJa, 8, 2, logs);
    if (!results || results.length === 0) {
      logs && logs.push(`rankings: api empty → fallback via browser event=${eventDocId}`);
      const fb = await fetchEventRankingsViaBrowser(detailUrl, leagueCategoryJa, 8, 2, logs);
      organizer = fb.organizer; results = fb.results;
    }
    // JSON系が空のままなら、HTML解析フォールバック（デッキリンクのみで最小限）
    if (!results || results.length === 0) {
      logs && logs.push(`rankings: browser empty → html parse fallback event=${eventDocId}`);
      const fh = await fetchEventRankingsViaHtml(detailUrl, leagueCategoryJa, 16, logs);
      organizer = fh.organizer || organizer; results = fh.results || results;
    }
    logs && logs.push(`rankings: will save count=${(results||[]).length} event=${eventDocId}`);
    // force モード時、初回カテゴリでゼロなら他カテゴリも試行（店舗側の表記揺れ等の救済）
    if (force && (!results || results.length === 0)) {
      const altCats: Array<'オープン'|'シニア'|'ジュニア'> = ['オープン','シニア','ジュニア'].filter(c => c !== leagueCategoryJa) as any;
      logs && logs.push(`rankings: try alt categories event=${eventDocId} alt=${altCats.join(',')}`);
      let merged: any[] = [];
      for (const alt of altCats) {
        const viaApi = await fetchEventRankingsViaApi(detailUrl, alt, 8, 2, logs);
        let arr = viaApi.results || [];
        if (!arr || arr.length === 0) {
          const viaBr = await fetchEventRankingsViaBrowser(detailUrl, alt, 8, 2, logs);
          arr = viaBr.results || [];
        }
        if (arr.length > 0) merged = merged.concat(arr);
      }
      // player_id で重複排除（同一プレイヤーの重複結果を避ける）
      const seen = new Set<string>();
      results = merged.filter((r: any) => { if (!r?.player_id) return false; const k = String(r.player_id); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    const col = db.collection('pokemon-event-rankings');
    let saved = 0; const batch = db.batch();
    // ランク別の連番（seq）を管理。各ランクごとに 00,01,... と採番。
    const rankSeq: Record<number, number> = {};
    for (let i=0;i<results.length;i++) {
      // ランキングドキュメントIDを rank-<eventKey>-<rank>-<seq> で生成（後続の画像処理・配信で参照）
      const r = results[i];
      const deckUrl = r.deckViewUrl ? canonicalizeDeckUrl(r.deckViewUrl) : null;
      const playerKey = r.player_id; // 重複排除や補助情報に利用（ID生成には使わない）
      if (!playerKey) { logs && logs.push(`rankings: skip no player_id idx=${i}`); continue; }
      const eventKey = String(eventDocId).replace(/^event-/, '');
      const rankNum = Number(r.rank ?? -1);
      if (!Number.isFinite(rankNum) || rankNum < 0) { logs && logs.push(`rankings: skip invalid rank idx=${i} rank=${r.rank}`); continue; }
      const seq = rankSeq[rankNum] ?? 0; rankSeq[rankNum] = seq + 1;
      const seqStr = String(seq).padStart(2, '0');
      const rid = `rank-${eventKey}-${rankNum}-${seqStr}`;
      const ref = col.doc(rid);
      // 最小限のフィールドのみ保存（public-api や iOS クライアントで利用する範囲）
      const deckId = deckUrl ? extractDeckIdFromUrl(deckUrl) : null;
      batch.set(ref, {
        originalEventId: eventDocId,
        organizer: organizer || null,
        cityLeagueCategory: leagueCategoryJa,
        rank: (r.rank ?? -1),
        positionIndex: seq,
        playerInfo: (r.name ?? ''),
        points: (r.point ?? 0),
        deckUrl,
        deckId,
        // 画像処理の対象判定に必要なフラグ（images.ts が imageStored==false の行のみ処理）
        imageStored: false,
        updatedAt,
      }, { merge: true });
      saved++;
    }
  // バッチコミット（まとめて保存し、後続のイベント更新へ）
  if (saved > 0) await withFsRetry(() => batch.commit(), logs || [], `ランキング: コミット ${eventDocId}`);
    await withFsRetry(() => db.collection('pokemon-events').doc(eventDocId).set({ rankingsScraped: true, rankingsScrapedAt: new Date().toISOString(), updatedAt }, { merge: true }), logs || [], `イベント更新: rankingsScraped ${eventDocId}`);
    return { saved, organizer, total: results.length };
  }

  let totalRankings = 0; const processedEvents: any[] = [];
  for (const t of targets) {
    // Probe（Step 1）で確定した `cityLeagueCategory` をそのまま利用
    const catJa = (t.data.cityLeagueCategory as ('オープン'|'シニア'|'ジュニア'));
    if (!catJa) { continue; } // カテゴリ不明はスキップ
    // M/D 形式に正規化された日付（例: 1/20）を補助情報として利用
    const dateMD = (t.data.dateOnly || '').trim();
    const md = dateMD.includes('/') ? dateMD.split('/').slice(-2).join('/') : dateMD; // M/Dのみ想定
    const { saved, organizer } = await saveRankingsForEventLocal(t.id, t.data.title, catJa, t.data.detailUrl, md, logs, !!force);
    if (saved === 0) {
      logs.push(`rankings: 0 saved event=${t.id} url=${t.data.detailUrl} category=${catJa}`);
    } else {
      logs.push(`rankings: saved ${saved} event=${t.id} category=${catJa}`);
    }
    totalRankings += saved; processedEvents.push({ id: t.id, title: t.data.title, organizer, rankingCount: saved });
  }
  return { ok: true, targetDate: dateYmd, totalEvents: processedEvents.length, totalRankings, processedEvents };
}
