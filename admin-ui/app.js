(function(){
  const el = (sel) => document.querySelector(sel);
  const view = el('#view');
  const state = {
    user: null,
    idToken: null,
    months: [],
    days: [],
    decks: [],
    deckNames: []
  };
  const cfg = window.CONFIG || {};
  if (!cfg.firebase || !cfg.adminApiBaseUrl) {
    renderError('設定が不足しています。admin-ui/config.sample.js を参考に config.js を作成してください。');
    return;
  }

  // Firebase 初期化
  firebase.initializeApp(cfg.firebase);
  const auth = firebase.auth();

  // UI: サインイン/アウト
  const $btnSignin = el('#btn-signin');
  const $btnSignout = el('#btn-signout');
  const $userInfo = el('#user-info');
  const $userEmail = el('#user-email');

  $btnSignin.addEventListener('click', async () => {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const cred = await auth.signInWithPopup(provider);
      // トークン更新と遷移
      await refreshToken();
      navigateTo('#/months');
    } catch(e){ alert('ログインに失敗しました: '+ (e?.message||e)); }
  });
  $btnSignout.addEventListener('click', async () => {
    await auth.signOut();
  });

  auth.onAuthStateChanged(async (user) => {
    state.user = user;
    if (user) {
      $btnSignin.classList.add('hidden');
      $userInfo.classList.remove('hidden');
      $userEmail.textContent = user.email || '';
      await refreshToken();
      // 最初の画面へ
      if (location.hash === '' || location.hash === '#/' ) navigateTo('#/months');
      else route();
    } else {
      state.idToken = null;
      $userInfo.classList.add('hidden');
      $btnSignin.classList.remove('hidden');
      renderSignedOut();
    }
  });

  async function refreshToken(){
    if (!state.user) return;
    state.idToken = await state.user.getIdToken(/* forceRefresh */ true);
  }

  function apiHeaders(){
    const h = { 'Content-Type':'application/json' };
    if (state.idToken) h['Authorization'] = 'Bearer '+state.idToken;
    return h;
  }
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

  function navigateTo(hash){ location.hash = hash; }
  window.addEventListener('hashchange', route);

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

  function renderSignedOut(){
    view.innerHTML = '<div class="notice">管理者は「ログイン」ボタンからサインインしてください。</div>';
  }
  function renderError(msg){ view.innerHTML = `<div class="error">${msg}</div>`; }

  // 画面: 月一覧
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
      btn.addEventListener('click', () => navigateTo(`#/days?month=${encodeURIComponent(m.id)}`));
      const h3 = document.createElement('h3');
      h3.textContent = `${m.id} / 完了 ${m.completedDays ?? 0} / ${m.totalDays ?? 0}`;
      card.appendChild(h3);
      card.appendChild(btn);
      mount.appendChild(card);
    });
  }

  // 画面: 日一覧（open）
  async function showDays(params){
    const month = params.get('month');
    if (!month) { navigateTo('#/months'); return; }
    view.innerHTML = `<div class="toolbar"><button class="btn" id="back">← 戻る</button><h2>${month} の日付</h2></div><div id="days" class="grid days"></div>`;
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
      btn.addEventListener('click', () => navigateTo(`#/edit?id=${encodeURIComponent(d.id)}`));
      const h3 = document.createElement('h3');
      h3.textContent = `${d.id} / 完了 ${d.completedTargets ?? 0} / ${d.totalTargets ?? 0}`;
      card.appendChild(h3);
      card.appendChild(btn);
      mount.appendChild(card);
    });
  }

  // 画面: デッキ名入力
  async function showEdit(params){
    const id = params.get('id');
    if (!id) { navigateTo('#/months'); return; }
    view.innerHTML = `<div class="toolbar"><button class="btn" id="back">← 戻る</button><h2>${id} の入力</h2><button class="btn" id="reload">再読込</button><span class="grow"></span><button class="btn" id="add-name">＋候補追加</button></div><div id="decks" class="deck-grid"></div>`;
    el('#back').addEventListener('click', () => {
      const month = `${id.slice(0,4)}-${id.slice(4,6)}`;
      navigateTo(`#/days?month=${month}`);
    });
    el('#reload').addEventListener('click', () => showEdit(new URLSearchParams(`id=${encodeURIComponent(id)}`)));
    el('#add-name').addEventListener('click', onAddDeckName);

    const [decks, names] = await Promise.all([
      apiGet(`/admin/days/${encodeURIComponent(id)}/decks`),
      apiGet('/admin/deck-names')
    ]);
    state.decks = decks;
    state.deckNames = names;

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
      const sel = document.createElement('select');
      sel.className = 'select grow';
      // 空行
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = '(未選択)';
      sel.appendChild(opt0);
      // 候補
      names.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n.name;
        opt.textContent = n.name;
        if (d.deckName && n.name === d.deckName) opt.selected = true;
        sel.appendChild(opt);
      });
      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn';
      applyBtn.textContent = '決定';
      applyBtn.addEventListener('click', async () => {
        const deckName = sel.value.trim();
        if (!deckName) { alert('デッキ名を選択してください'); return; }
        try {
          await apiPatch(`/admin/days/${encodeURIComponent(id)}/decks/${encodeURIComponent(d.groupId)}`, { deckName });
          card.classList.add('complete');
        } catch(e){ alert('更新に失敗: '+(e?.message||e)); }
      });
      row.appendChild(sel);
      row.appendChild(applyBtn);
      body.appendChild(row);
      card.appendChild(img);
      card.appendChild(body);
      mount.appendChild(card);
    });
  }

  async function onAddDeckName(){
    const name = (prompt('追加するデッキ名を入力してください（例: リザードンex）')||'').trim();
    if (!name) return;
    const yomi = (prompt('読み仮名（カタカナ）を入力してください（例: リザードンエックス）')||'').trim();
    if (!yomi) return;
    try {
      await apiPost('/admin/deck-names', { name, yomi });
      alert('追加しました。プルダウンを再読み込みします。');
      route();
    } catch(e){ alert('追加に失敗: '+(e?.message||e)); }
  }

  // 初期表示
  if (auth.currentUser) { refreshToken().then(route); } else { renderSignedOut(); }
})();
