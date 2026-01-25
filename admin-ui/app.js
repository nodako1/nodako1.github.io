(function(){
  /*
   * 管理画面のメインスクリプト。
   * - 役割: 認証、ハッシュベースのルーティング、画面（「月一覧」「日一覧」「デッキ名入力」）の描画、Admin API との通信。
   * - 利用箇所: admin-ui の単一ページで読み込まれ、画面全体の振る舞いを制御します。
   */

  // 短いセレクタ関数。画面各所で要素取得に使用するヘルパー。
  const el = (sel) => document.querySelector(sel);

  // メイン描画領域。全ての画面（months/days/edit）で内容を差し替えます。
  const view = el('#view');

  // アプリ全体の共有状態。認証情報や直近取得データを保持し、各画面で参照します。
  const state = {
    user: null,
    idToken: null,
    months: [],
    days: [],
    decks: [],
    deckNames: []
  };

  // 外部設定（Firebase 設定と Admin API のベース URL）。index.html から注入されます。
  const cfg = window.CONFIG || {};
  if (!cfg.firebase || !cfg.adminApiBaseUrl) {
    // 設定不足時は以降の処理が行えないため、ユーザーに案内を表示します。
    renderError('設定が不足しています。admin-ui/config.sample.js を参考に config.js を作成してください。');
    return;
  }

  // Firebase 認証の初期化。以降の認証（ログイン/ログアウトとトークン取得）で利用します。
  firebase.initializeApp(cfg.firebase);
  const auth = firebase.auth();

  // サインイン/サインアウト関連の UI 要素。クリックイベントは下記で定義します。
  const $btnSignin = el('#btn-signin');
  const $btnSignout = el('#btn-signout');
  const $userInfo = el('#user-info');
  const $userEmail = el('#user-email');

  // 「ログイン」ボタン: Google アカウントで認証 → トークン更新 → 初期画面（months）へ遷移。
  $btnSignin.addEventListener('click', async () => {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const cred = await auth.signInWithPopup(provider);
      await refreshToken();
      navigateTo('#/months');
    } catch(e){ alert('ログインに失敗しました: '+ (e?.message||e)); }
  });

  // 「ログアウト」ボタン: 認証状態をクリアし、未ログイン画面の表示へ。
  $btnSignout.addEventListener('click', async () => {
    await auth.signOut();
  });

  // 認証状態の変化ハンドラ。アプリ起動時/ログイン/ログアウト時に呼ばれ、UI 切り替えと初期ルート処理を担当します。
  auth.onAuthStateChanged(async (user) => {
    state.user = user;
    if (user) {
      $btnSignin.classList.add('hidden');
      $userInfo.classList.remove('hidden');
      $userEmail.textContent = user.email || '';
      await refreshToken();
      // 初回は「月一覧」に誘導。ハッシュが指定済みならルーティングを実行。
      if (location.hash === '' || location.hash === '#/' ) navigateTo('#/months');
      else route();
    } else {
      state.idToken = null;
      $userInfo.classList.add('hidden');
      $btnSignin.classList.remove('hidden');
      renderSignedOut();
    }
  });

  // ID トークンを取得/更新する関数。API 呼び出しの直前や認証直後に使用します。
  async function refreshToken(){
    if (!state.user) return;
    state.idToken = await state.user.getIdToken(true);
  }

  // API 通信で利用する共通ヘッダを生成。ログイン済みなら Bearer トークンを付与します。
  function apiHeaders(){
    const h = { 'Content-Type':'application/json' };
    if (state.idToken) h['Authorization'] = 'Bearer '+state.idToken;
    return h;
  }

  // GET リクエストのヘルパー。画面データの取得（months/days/decks/names）で使用します。
  async function apiGet(path){
    try {
      const r = await fetch(cfg.adminApiBaseUrl + path, { headers: apiHeaders() });
      if (r.status === 401 || r.status === 403) throw new Error('権限がありません（管理者権限が必要）');
      if (!r.ok) throw new Error(`APIエラー: ${r.status}`);
      return await r.json();
    } catch (e){
      const msg = String(e?.message || e || '');
      if (/Failed to fetch/i.test(msg)) {
        throw new Error('接続に失敗しました（CORS設定またはネットワークを確認してください）');
      }
      if (msg) throw new Error(msg);
      throw new Error('ネットワークエラー（接続またはCORS設定を確認してください）');
    }
  }

  // PATCH リクエストのヘルパー。デッキ名の確定（更新）で使用します。
  async function apiPatch(path, body){
    try {
      const r = await fetch(cfg.adminApiBaseUrl + path, { method:'PATCH', headers: apiHeaders(), body: JSON.stringify(body) });
      if (r.status === 401 || r.status === 403) throw new Error('権限がありません（管理者権限が必要）');
      if (!r.ok) throw new Error(`APIエラー: ${r.status}`);
      return await r.json();
    } catch (e){
      const msg = String(e?.message || e || '');
      if (/Failed to fetch/i.test(msg)) {
        throw new Error('接続に失敗しました（CORS設定またはネットワークを確認してください）');
      }
      if (msg) throw new Error(msg);
      throw new Error('ネットワークエラー（接続またはCORS設定を確認してください）');
    }
  }

  // POST リクエストのヘルパー。デッキ名候補の追加で使用します。
  async function apiPost(path, body){
    try {
      const r = await fetch(cfg.adminApiBaseUrl + path, { method:'POST', headers: apiHeaders(), body: JSON.stringify(body) });
      if (r.status === 401 || r.status === 403) throw new Error('権限がありません（管理者権限が必要）');
      if (!r.ok) throw new Error(`APIエラー: ${r.status}`);
      return await r.json();
    } catch (e){
      const msg = String(e?.message || e || '');
      if (/Failed to fetch/i.test(msg)) {
        throw new Error('接続に失敗しました（CORS設定またはネットワークを確認してください）');
      }
      if (msg) throw new Error(msg);
      throw new Error('ネットワークエラー（接続またはCORS設定を確認してください）');
    }
  }

  // ハッシュを更新して擬似遷移を行うヘルパー。各ボタンのクリックで使用します。
  function navigateTo(hash){ location.hash = hash; }

  // ハッシュが変化したら現在の画面を再描画します。
  window.addEventListener('hashchange', route);

  // シンプルなルーター。現在のハッシュに応じて該当画面関数を呼び出します。
  async function route(){
    if (!state.user) { renderSignedOut(); return; }
    const [_, path, query] = location.hash.match(/^#\/(\w+)?\??(.*)$/) || [];
    try {
      switch(path){
        case 'months': await showMonths(); break;
        case 'days': await showDays(new URLSearchParams(query)); break;
        case 'edit': await showEdit(new URLSearchParams(query)); break;
        default: navigateTo('#/months');
      }
    } catch(e){ renderError(e?.message||String(e)); }
  }

  // 未ログイン時の案内を表示するだけの描画関数。認証前のデフォルト画面で使用します。
  function renderSignedOut(){
    view.innerHTML = '<div class="notice">管理者は「ログイン」ボタンからサインインしてください。</div>';
  }

  // エラーメッセージを画面上部に表示。API 失敗や入力不備の表示で使用します。
  function renderError(msg){ view.innerHTML = `<div class="error">${msg}</div>`; }

  // 画面: 月一覧。API から月データを取得し、月カードを並べます。カードから「日一覧」へ遷移します。
  async function showMonths(){
    view.innerHTML = '<h2>月を選択</h2><div id="months" class="grid months"></div>';
    const mount = el('#months');
    const months = await apiGet('/admin/months');
    state.months = months;
    months.forEach(m => {
      const card = document.createElement('div');
      card.className = 'card' + (m.allComplete ? ' complete' : '');
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = m.id.replace('-', '年') + '月';
      // カードのボタン: 該当月の「日一覧」へ。
      btn.addEventListener('click', () => navigateTo(`#/days?month=${encodeURIComponent(m.id)}`));
      const h3 = document.createElement('h3');
      h3.textContent = `${m.id} / 完了 ${m.completedDays ?? 0} / ${m.totalDays ?? 0}`;
      card.appendChild(h3);
      card.appendChild(btn);
      mount.appendChild(card);
    });
  }

  // 画面: 日一覧（リーグ: open 固定）。選択した月の各日を表示し、各日から「デッキ名入力」へ遷移します。
  async function showDays(params){
    const month = params.get('month');
    if (!month) { navigateTo('#/months'); return; }
    view.innerHTML = `<div class="toolbar"><button class=\"btn\" id=\"back\">← 戻る</button><h2>${month} の日付</h2></div><div id=\"days\" class=\"grid days\"></div>`;
    // 戻る: 月一覧へ戻ります。
    el('#back').addEventListener('click', () => navigateTo('#/months'));
    const mount = el('#days');
    const days = await apiGet(`/admin/days?month=${encodeURIComponent(month)}&league=open`);
    state.days = days;
    days.forEach(d => {
      const card = document.createElement('div');
      card.className = 'card' + (d.allComplete ? ' complete' : '');
      const label = (d.date || '').replace(/-/g,'/');
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = label;
      // カードのボタン: 対象日の「デッキ名入力」画面へ。
      btn.addEventListener('click', () => navigateTo(`#/edit?id=${encodeURIComponent(d.id)}`));
      const h3 = document.createElement('h3');
      h3.textContent = `${d.id} / 完了 ${d.completedTargets ?? 0} / ${d.totalTargets ?? 0}`;
      card.appendChild(h3);
      card.appendChild(btn);
      mount.appendChild(card);
    });
  }

  // 画面: デッキ名入力。対象日のデッキ画像一覧と、デッキ名候補のプルダウンを表示します。
  // - 決定ボタン: 選択したデッキ名で対象デッキを PATCH 更新。
  // - ＋候補追加: 新しい候補名を POST で登録し、画面を再読み込み。
  async function showEdit(params){
    const id = params.get('id');
    if (!id) { navigateTo('#/months'); return; }
    // ツールバーはスマホで2段構成（1行目: 戻る + 見出し、2行目: 決定 + ＋候補追加）。PCでは横並び表示。
    view.innerHTML = `
      <div class=\"toolbar two-rows\">
        <div class=\"row-1\">
          <button class=\"btn\" id=\"back\">← 戻る</button>
          <h2 style=\"margin:0\">${id} の入力</h2>
          <span class=\"grow\"></span>
        </div>
        <div class=\"row-2\">
          <button class=\"btn btn-primary\" id=\"apply-all\">決定</button>
          <button class=\"btn\" id=\"add-name\">＋候補追加</button>
        </div>
      </div>
      <div id=\"decks\" class=\"deck-grid\"></div>`;
    // 戻る: 対象日から元の月を推測し、日一覧へ戻ります。
    el('#back').addEventListener('click', () => {
      const month = `${id.slice(0,4)}-${id.slice(4,6)}`;
      navigateTo(`#/days?month=${month}`);
    });
    // 候補追加: 新しいデッキ名を登録するダイアログを開きます。
    el('#add-name').addEventListener('click', onAddDeckName);

    // 初期データ: 対象日のデッキ一覧と、デッキ名候補一覧を同時取得します。
    const [decks, names] = await Promise.all([
      apiGet(`/admin/days/${encodeURIComponent(id)}/decks`),
      apiGet('/admin/deck-names')
    ]);
    state.decks = decks;
    state.deckNames = names;

    // 選択状態（groupId -> deckName）を保持するマップ。未選択はキーなし。
    const selection = new Map();

    // 各デッキごとにカードを生成。画像 + 候補プルダウン + 決定ボタンで構成します。
    const mount = el('#decks');
    decks.forEach(d => {
      const card = document.createElement('div');
      const isComplete = !!(d.deckName && String(d.deckName).trim());
      card.className = 'deck-card' + (isComplete ? ' complete' : '');

      const img = document.createElement('img');
      img.src = d.deckListImageUrl || '';
      img.alt = `rank ${d.rank}`;

      const body = document.createElement('div');
      body.className = 'body';
      const row = document.createElement('div');
      row.className = 'row';

      // 候補プルダウンの生成。先頭に「未選択」を置き、続けて API 取得した候補を並べます。
      const sel = document.createElement('select');
      sel.className = 'select select-large grow';
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = '(未選択)';
      sel.appendChild(opt0);
      names.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n.name;
        opt.textContent = n.name;
        if (d.deckName && n.name === d.deckName) opt.selected = true;
        sel.appendChild(opt);
      });

      // 初期選択を状態に反映
      if (d.deckName && String(d.deckName).trim()) selection.set(String(d.groupId), String(d.deckName));
      sel.addEventListener('change', () => {
        const val = String(sel.value || '').trim();
        const key = String(d.groupId);
        if (val) selection.set(key, val); else selection.delete(key);
      });

      row.appendChild(sel);
      body.appendChild(row);
      card.appendChild(img);
      card.appendChild(body);
      mount.appendChild(card);
    });

    // 画面唯一の「決定」ボタン: 選択済みの項目をまとめてバッチ更新。
    const $applyAll = el('#apply-all');
    $applyAll.addEventListener('click', async () => {
      const items = Array.from(selection.entries()).map(([groupId, deckName]) => ({ groupId, deckName }));
      if (items.length === 0) { alert('デッキ名の選択がありません'); return; }
      try {
        $applyAll.disabled = true;
        $applyAll.textContent = '送信中…';
        const res = await apiPost(`/admin/days/${encodeURIComponent(id)}/decks:batchUpdate`, { items });
        const updated = Number(res?.updatedCount || 0);
        const errors = Array.isArray(res?.errors) ? res.errors : [];
        // 反映済みカードを完了表示に
        if (Array.isArray(res?.updatedIds)) {
          const set = new Set(res.updatedIds.map(String));
          // state.decks は groupId を持つ
          document.querySelectorAll('.deck-card').forEach((cardEl, idx) => {
            const deck = state.decks[idx];
            if (deck && set.has(String(deck.groupId))) cardEl.classList.add('complete');
          });
        } else {
          // updatedIds がない場合は選択項目すべてを完了扱い
          const set = new Set(items.map(i => String(i.groupId)));
          document.querySelectorAll('.deck-card').forEach((cardEl, idx) => {
            const deck = state.decks[idx];
            if (deck && set.has(String(deck.groupId))) cardEl.classList.add('complete');
          });
        }
        const msg = [`更新: ${updated} 件`, errors.length ? `失敗: ${errors.length} 件` : ''];
        alert(msg.filter(Boolean).join('\n'));
      } catch (e){
        alert('一括更新に失敗: ' + (e?.message || e));
      } finally {
        $applyAll.disabled = false;
        $applyAll.textContent = '決定';
      }
    });
  }

  // デッキ名候補を新規追加する処理。ダイアログ入力 → API へ POST → 画面を再描画します。
  async function onAddDeckName(){
    const name = (prompt('追加するデッキ名（カタカナ）を入力してください（例: リザードンエックス）')||'').trim();
    if (!name) return;
    try {
      await apiPost('/admin/deck-names', { name });
      alert('追加しました。プルダウンを再読み込みします。');
      route();
    } catch(e){ alert('追加に失敗: '+(e?.message||e)); }
  }

  // 初期表示の分岐。既にログイン済みならルーティングを開始、未ログインなら案内を表示します。
  if (auth.currentUser) { refreshToken().then(route); } else { renderSignedOut(); }
})();
