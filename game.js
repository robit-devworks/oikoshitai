// オイコシタイ！ の描画・操作・音
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = OK.C;
  const cv = $('cv'), ctx = cv.getContext('2d');
  let g = OK.newGame(1), playing = false, last = 0, W = 0, H = 0, dpr = 1;
  let myPhase = 0, herPhase = 0, copPhase = 0, dogPhase = 0, pops = [], seenEv = 0, shown = false;
  let myStepIdx = 0, herStepIdx = 0; const steps = { me: 0, her: 0 }; // 足音を鳴らした回数（テスト用）

  // ---- 音 ----
  // 音量（一時停止メニューで変える。この端末に覚える）：bgm・se は 0〜1
  const VOL_KEY = 'oikoshi-vol';
  let vol = { bgm: 1, se: 1 };
  try { vol = Object.assign(vol, JSON.parse(localStorage.getItem(VOL_KEY) || '{}')); } catch (e) {}
  let ac = null, seGain = null;
  function audio() {
    try {
      if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); seGain = ac.createGain(); seGain.gain.value = vol.se; seGain.connect(ac.destination); }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) {}
    return ac;
  }
  function tone(f, d, type, vol, slide) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), v = a.createGain(), t = a.currentTime;
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    v.gain.setValueAtTime(vol || 0.05, t); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(v).connect(seGain || a.destination); o.start(t); o.stop(t + d);
  }
  function noise(d, vol, hp) {
    const a = audio(); if (!a) return;
    const b = a.createBuffer(1, Math.floor(a.sampleRate * d), a.sampleRate), ch = b.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), v = a.createGain();
    f.type = 'bandpass'; f.frequency.value = hp || 900; v.gain.value = vol || 0.2;
    s.buffer = b; s.connect(f).connect(v).connect(seGain || a.destination); s.start();
  }
  // 足音の大きさ（止まる・ゆっくり・ふつう・早歩き・走る）。速いほど 2 倍ずつ大きく、走るで前の版の「ふつう」くらい
  const STEP_VOL = [0, 0.02, 0.04, 0.08, 0.15];
  const SE = {
    // 自分の足音：ザッ（アスファルト）＋コツッ（かかと）。速いほど大きい
    myStep: (gear) => {
      const vol = STEP_VOL[gear]; if (!vol) return;
      noise(gear === 4 ? 0.1 : 0.07, vol, gear === 4 ? 1200 : 1600);
      tone(gear === 4 ? 700 : 1000, 0.03, 'triangle', vol * 0.25);
    },
    herStep: () => tone(2200, 0.03, 'triangle', 0.012), // 相手のヒール（小さめ）
    bad: () => tone(520, 0.25, 'square', 0.04, 260),
    good: () => { tone(660, 0.1, 'triangle', 0.06); setTimeout(() => tone(990, 0.15, 'triangle', 0.06), 90); },
    flee: () => tone(900, 0.5, 'sawtooth', 0.04, 200),
    pass: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.07), i * 100)),
    same: () => [392, 370, 349, 330].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'sine', 0.06), i * 260)),
    rare: () => [784, 988, 1175, 1568, 1175, 1568].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'square', 0.04), i * 90)),
    bump: () => noise(0.25, 0.6, 200),
    bark: () => { tone(560, 0.07, 'square', 0.07, 380); setTimeout(() => tone(600, 0.08, 'square', 0.07, 400), 120); },
    bell: () => { tone(2600, 0.12, 'sine', 0.06); setTimeout(() => tone(2600, 0.15, 'sine', 0.06), 160); },
    wag: () => [880, 1100, 1320].forEach((f, i) => setTimeout(() => tone(f, 0.08, 'triangle', 0.05), i * 70)),
  };

  // BGM：夜の虫の声（くりかえし）。ボタンを押したときに鳴らしはじめる
  const bgm = new Audio(window.OIKOSHI_BGM || 'sounds/cricket.mp3');
  bgm.loop = true; bgm.volume = 0.5 * vol.bgm;
  function playBgm() { try { const p = bgm.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }

  // 見つけたエンディング（この端末だけ）
  const KEY = 'oikoshi-ends';
  let found = new Set();
  try { found = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) {}
  function saveFound() { try { localStorage.setItem(KEY, JSON.stringify([...found])); } catch (e) {} }
  // 見つけた隠し要素（うわさを出さないため。この端末だけ）
  const UKEY = 'oikoshi-secrets';
  let secrets = [];
  try { secrets = JSON.parse(localStorage.getItem(UKEY) || '[]'); } catch (e) {}
  const foundSecret = (id) => { if (secrets.includes(id)) return; secrets.push(id); try { localStorage.setItem(UKEY, JSON.stringify(secrets)); } catch (e) {} };
  // 見つけたストーリーの結末（この端末だけ）
  const SKEY = 'oikoshi-story-ends';
  let sFound = new Set();
  try { sFound = new Set(JSON.parse(localStorage.getItem(SKEY) || '[]')); } catch (e) {}

  // 警戒度ランキング（この端末だけ）：クリアしたときの最大警戒度が低い順に 5 つ
  // ランキングの表：「ふつう」と「？？？」（むずかしい）を切りかえ。むずかしいモードを見つけるまでは名前を出さない
  // みんなのランキング：claude.ai の中では Artifact の保存場所（db。1 人 1 件の自己ベストを全員分読む）、
  // 公開サイト（robit-devworks.github.io）では Firebase（デストロイ碁と同じプロジェクトの oikoshi の下。全員分は読まない：
  // 上位 100 人・自分のまわり・警戒度ごとの人数 hist で順位を出す）。それ以外（手元で開いたとき）は、この端末の記録 5 つ
  // モードは 'normal'（ふつう）・'hard'（むずかしい）・'dog'（犬の散歩・隠し）。ランキングはモードごと
  let lastPlace = { mode: 'normal', now: 0 }, rankSeq = 0, rankMode = 'normal';
  const loadRank = (mode) => { try { return JSON.parse(localStorage.getItem(rkey(mode)) || '[]'); } catch (e) { return []; } };
  const RK = { normal: 'n', hard: 'h', dog: 'd' };
  const modeKnown = (mode) => mode === 'normal' || (mode === 'hard' ? hardMode || loadRank('hard').length > 0 || hardCleared() : dogMode || loadRank('dog').length > 0);
  const TOP_N = 100, NEAR_N = 3; // 結果画面に出すので、まわりは上下 3 人ずつ
  let DB = null, myId = null;
  const FB_CONFIG = {
    apiKey: 'AIzaSyDFyXeLsfvOTFrJhPFBFuSbk5_GcDffR9k',
    authDomain: 'destroy-go.firebaseapp.com',
    databaseURL: 'https://destroy-go-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'destroy-go',
  };
  const FB_VER = '10.12.2';
  // 手元のテストで本番に書かないように、公開サイトだけ（?rank=fb で手元からも試せる）
  const fbAllowed = !(window.claude && window.claude.use) && (location.hostname === 'robit-devworks.github.io' || /[?&]rank=fb\b/.test(location.search)) && !/[?&]rank=off/.test(location.search);
  let fbWait = null, fbIdleT = 0, fbOff = false;
  function loadScript(src) { return new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(el); }); }
  function fbTouch(F) { // 使い終わって 30 秒たったら切る（同時接続の無料枠を使い切らないように）
    if (!F) return F;
    if (fbOff) { try { F.db.goOnline(); } catch (e) {} fbOff = false; }
    clearTimeout(fbIdleT); fbIdleT = setTimeout(() => { try { F.db.goOffline(); fbOff = true; } catch (e) {} }, 30000);
    return F;
  }
  function firebaseReady() { // ランキングを見る・記録するときに初めて読みこむ（匿名ログイン）
    if (!fbAllowed) return Promise.resolve(null);
    if (!fbWait) fbWait = withTimeout((async () => {
      if (!window.firebase) for (const m of ['app', 'auth', 'database']) await loadScript(`https://cdn.jsdelivr.net/npm/firebase@${FB_VER}/firebase-${m}-compat.js`);
      const fb = window.firebase, app = fb.apps.length ? fb.app() : fb.initializeApp(FB_CONFIG), auth = app.auth();
      const prev = await new Promise((res) => { const off = auth.onAuthStateChanged((u) => { off(); res(u); }); });
      const user = prev || (await auth.signInAnonymously()).user;
      myId = user.uid;
      return { db: app.database(), uid: user.uid, TS: fb.database.ServerValue.TIMESTAMP };
    })(), 12000).catch((e) => { fbWait = null; throw e; });
    return fbWait.then(fbTouch);
  }
  const shared = () => !!DB || fbAllowed;
  const fbKey = (max, t) => max * 1000 + Math.max(0, Math.min(999, t)); // 並べる順：警戒度が低いほど・同じなら速いほど上
  async function fbSubmit(r, mode) {
    const F = await firebaseReady(); if (!F) throw new Error('no firebase');
    const ref = F.db.ref(`oikoshi/best/${mode}/${F.uid}`);
    const old = (await withTimeout(ref.get(), 8000)).val();
    const t = Math.max(0, Math.min(999, r.t)), k = fbKey(r.max, t), better = !old || k < old.k, name = getName() || NONAME;
    if (!better && old.n === name) return;
    const d = new Date();
    await withTimeout(ref.set(better ? { n: name, m: r.max, s: t, k, e: String(r.id).slice(0, 16), d: (d.getMonth() + 1) + '/' + d.getDate(), t: F.TS } : Object.assign({}, old, { n: name, t: F.TS })), 8000);
    if (better && (!old || old.m !== r.max)) { // 警戒度ごとの人数（順位を出すのに使う）
      const hist = (b, dd) => withTimeout(F.db.ref(`oikoshi/hist/${mode}/b${b}`).transaction((v) => Math.max(0, (v || 0) + dd)), 8000).catch(() => {});
      await hist(r.max, 1); if (old) await hist(old.m, -1);
    }
  }
  async function fbPushName() {
    const F = await firebaseReady(); if (!F) return;
    for (const mode of ['normal', 'hard', 'dog']) {
      const ref = F.db.ref(`oikoshi/best/${mode}/${F.uid}`), old = (await withTimeout(ref.get(), 8000)).val();
      if (old && old.n !== (getName() || NONAME)) await withTimeout(ref.set(Object.assign({}, old, { n: getName() || NONAME, t: F.TS })), 8000);
    }
  }
  const fbRow = (id, v) => ({ id, max: Math.max(0, Math.min(100, Math.round(+v.m || 0))), t: Math.max(0, Math.round(+v.s || 0)), k: +v.k || 0, name: okName(v.n) });
  async function fbFetch(mode) {
    const F = await firebaseReady(); if (!F) throw new Error('no firebase');
    const base = F.db.ref(`oikoshi/best/${mode}`), list = (snap) => { const a = []; snap.forEach((c) => { a.push(fbRow(c.key, c.val() || {})); }); return a; };
    const [topS, histS, meS] = await Promise.all([base.orderByChild('k').limitToFirst(TOP_N).get(), F.db.ref(`oikoshi/hist/${mode}`).get(), base.child(F.uid).get()].map((p) => withTimeout(p, 8000)));
    const top = list(topS).map((x, i) => Object.assign(x, { rank: i + 1 })), hist = histS.val() || {}, me = meS.val();
    let total = Object.values(hist).reduce((a, v) => a + (+v || 0), 0), mine = 0, near = [];
    if (me) {
      const j = top.findIndex((x) => x.id === F.uid);
      if (j >= 0) mine = j + 1;
      else { // 自分より警戒度が低い人の数 + 1（同じ警戒度の中の順番は、まわりの人から数える）
        const [a, b] = await Promise.all([base.orderByChild('k').endAt(me.k).limitToLast(NEAR_N + 1).get(), base.orderByChild('k').startAt(me.k).limitToFirst(NEAR_N + 1).get()].map((p) => withTimeout(p, 8000)));
        const seen = new Set(); near = list(a).concat(list(b)).filter((x) => !seen.has(x.id) && seen.add(x.id)).sort((x, y) => x.k - y.k);
        const below = Object.entries(hist).reduce((s2, [b2, v]) => s2 + (+b2.slice(1) < me.m ? +v || 0 : 0), 0);
        const mi = near.findIndex((x) => x.id === F.uid), sameBefore = near.slice(0, mi).filter((x) => x.max === me.m).length;
        mine = Math.max(TOP_N + 1, below + sameBefore + 1);
        near = near.map((x, i) => Object.assign(x, { rank: Math.max(1, mine + i - mi) }));
      }
    }
    return { top, total: Math.max(total, top.length, mine), mine, near };
  }
  (async function initShared() {
    try {
      if (!(window.claude && window.claude.use)) return;
      const [db, u] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !u) return;
      const id = await u.id(); if (!id) return;
      DB = db; myId = id;
    } catch (e) { DB = null; }
  })();
  // プレイヤー名：自分で入れた名前だけをランキングに出す（claude.ai のアカウント名は使わない）。この端末に覚える
  const NAME_KEY = 'oikoshi-name', NONAME = '名無しの通行人';
  const cleanName = (t) => String(t || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 10);
  const okName = (t) => { const n = cleanName(t); return OK.nameOK(n) ? n : ''; }; // 使えない言葉が入っていたら名無し
  const getName = () => { try { return okName(localStorage.getItem(NAME_KEY)); } catch (e) { return ''; } };
  function saveName(t) { // 使えない言葉なら保存しない（false）
    const n = cleanName(t); if (!OK.nameOK(n)) return false;
    try { localStorage.setItem(NAME_KEY, n); } catch (e) {}
    return true;
  }
  function nameErr(on) { $('name-err').hidden = !on; if (on) { $('pname').focus(); } }
  async function pushName() { // 名前を変えたら、みんなのランキングの自分の記録の名前も変える
    if (fbAllowed) { fbPushName().catch(() => {}); return; }
    if (!DB) return;
    try { const ref = DB.doc('scores/' + myId), snap = await withTimeout(ref.get(), 10000); const cur = snap.exists && snap.data(); if (cur && (cur.name || '') !== getName()) await withTimeout(ref.set(Object.assign({}, cur, { name: getName() })), 10000); } catch (e) {}
  }
  function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  async function submitShared(r, mode) { // 自己ベストなら書く（警戒度が低いほど・同じなら速いほど良い）
    if (!DB) return fbSubmit(r, mode);
    const ref = DB.doc('scores/' + myId);
    const snap = await withTimeout(ref.get(), 10000);
    const cur = (snap.exists && snap.data()) || {};
    const k = RK[mode], old = cur[k];
    const better = !old || r.max < old.max || (r.max === old.max && r.t < old.t);
    if (better || (cur.name || '') !== getName()) {
      const d = new Date();
      await withTimeout(ref.set(Object.assign({}, cur, { name: getName() }, better ? { [k]: { max: r.max, t: r.t, end: r.id, day: (d.getMonth() + 1) + '/' + d.getDate(), at: Date.now() } } : {})), 10000);
    }
  }
  async function fetchShared(mode) { // { top: 上位 100（rank 付き）, total: 人数, mine: 自分の順位（0＝記録なし）, near: 自分のまわり }
    if (!DB) return fbFetch(mode);
    const snap = await withTimeout(DB.collection('scores').limit(1000).get(), 10000);
    const k = RK[mode];
    const names = {};
    const arr = snap.docs.map((d) => { const v = d.data() || {}, x = v[k]; names[d.id] = okName(v.name); return x && typeof x.max === 'number' ? { id: d.id, max: Math.max(0, Math.min(100, Math.round(x.max))), t: Math.max(0, Math.round(+x.t || 0)), day: String(x.day || '').slice(0, 5) } : null; })
      .filter(Boolean).sort((a, b) => a.max - b.max || a.t - b.t);
    const i = arr.findIndex((x) => x.id === myId);
    arr.forEach((x, k) => { x.rank = k + 1; x.name = names[x.id]; });
    return { top: arr.slice(0, TOP_N), total: arr.length, mine: i + 1, near: i >= TOP_N ? arr.slice(i - NEAR_N, i + NEAR_N + 1) : [] };
  }
  const row = (x) => `<li class="${x.id === myId ? 'me' : ''}"><span>${x.rank}位</span><span class="nm">${esc(x.name || NONAME)}${x.id === myId ? '（あなた）' : ''}</span><b>${x.max}%</b><span>${x.t}秒</span></li>`;
  async function showRank(mode) {
    const seq = ++rankSeq; rankMode = mode;
    for (const m of ['normal', 'hard', 'dog']) $('t-' + m).classList.toggle('on', m === mode);
    $('t-hard').textContent = modeKnown('hard') ? 'むずかしい' : '？？？';
    $('t-dog').textContent = modeKnown('dog') ? '犬の散歩' : '？？？';
    const empty = `<li class="empty">${mode !== 'normal' && !modeKnown(mode) ? 'まだ記録がない…。どこかに入口があるらしい' : 'まだ記録がない'}</li>`;
    if (shared()) {
      $('r-rank-note').textContent = '警戒度が低いほど上（みんなの記録・上位 100 位まで）';
      $('r-rank-list').innerHTML = '<li class="empty">読みこんでいます…</li>'; $('r-rank-sum').textContent = ''; $('r-near').innerHTML = '';
      try {
        const { top, total, mine, near } = await fetchShared(mode);
        if (seq !== rankSeq) return;
        $('r-rank-sum').innerHTML = mine > 0 ? `あなた <b>${mine}位</b> / ${total.toLocaleString()}人（上位 <b>${Math.max(1, Math.ceil(mine / total * 100))}%</b>）` : (total ? `${total.toLocaleString()}人が記録` : '');
        $('r-rank-list').innerHTML = top.length ? top.map(row).join('') : empty;
        $('r-near').innerHTML = near.length ? '<div class="near-head">⋮ あなたのまわり ⋮</div><ol>' + near.map(row).join('') + '</ol>' : '';
        const me = $('r-rank-list').querySelector('.me'); if (me) $('r-rank-list').scrollTop = me.offsetTop - $('r-rank-list').clientHeight / 2;
        return;
      } catch (e) { if (seq !== rankSeq) return; $('r-rank-note').textContent = 'みんなの記録が読めなかったので、この端末の記録を出しています'; }
    } else $('r-rank-note').textContent = '警戒度が低いほど上（この端末の記録）';
    $('r-rank-sum').textContent = ''; $('r-near').innerHTML = '';
    const list = loadRank(mode);
    $('r-rank-list').innerHTML = list.length
      ? list.map((x, i) => `<li class="${x.now === lastPlace.now && mode === lastPlace.mode ? 'me' : ''}"><span>${i + 1}位</span><span class="nm">${x.day}</span><b>${x.max}%</b><span>${x.t}秒</span></li>`).join('')
      : empty;
  }

  // むずかしいモードは別のランキング
  const rkey = (mode) => 'oikoshi-rank' + (mode === 'hard' ? '-hard' : mode === 'dog' ? '-dog' : '');
  let rank = [];
  function addRank(r, mode) { // 入った順位（1〜5）を返す。入らなければ 0
    try { rank = JSON.parse(localStorage.getItem(rkey(mode)) || '[]'); } catch (e) { rank = []; }
    const d = new Date(), rec = { max: r.max, t: r.t, id: r.id, day: (d.getMonth() + 1) + '/' + d.getDate(), now: Date.now() };
    rank.push(rec); rank.sort((a, b) => a.max - b.max || a.t - b.t); rank = rank.slice(0, 5);
    try { localStorage.setItem(rkey(mode), JSON.stringify(rank)); } catch (e) {}
    return rank.indexOf(rec) + 1;
  }

  // ---- 隠し要素：クリアしたあとはタイトルがそわそわして「そわそわしている…？」と手がかりが出る。
  //      5 回つつくと右へ逃げて、むずかしいモードになる（クリア前は何も起きない） ----
  const SHOW_HINT = false; // 「タイトルがそわそわしている…？」の手がかり。いまは出さない（2026-11-19・本人：気づかれないようなら後で true に）
  let hardMode = false, taps = 0, tapT = 0;
  const logo = document.querySelector('.logo .main'), logoSub = document.querySelector('.logo .sub');
  const unlocked = () => [...found].some(id => OK.PASS_ENDS.includes(id));
  // 犬の散歩モード（隠し・はじめから使える）：タイトルの月をつつくたびに三日月が満ちていき、満月で犬の散歩モード（4 秒あくと欠けにもどる）。
  // ヒント：むずかしいモードを一度クリアすると、ふだんの月が一段階満ちた形になる（そこから 4 回で満月）
  const MOON_TAPS = 5;
  let dogMode = false, moonTaps = 0, moonT = 0, moonFill = 0;
  const moonBase = () => (hardCleared() ? 1 : 0); // ヒントで一段階満ちている
  const hardCleared = () => { try { return localStorage.getItem('oikoshi-hardclear') === '1'; } catch (e) { return false; } };
  $('b-moon').addEventListener('pointerdown', (e) => {
    if (hardMode) return;
    e.preventDefault(); audio();
    if (dogMode) { // 満月をもう一度つつくと三日月にもどって、ふつうにもどる
      dogMode = false; moonTaps = 0; track('dog-off');
      tone(900, 0.3, 'sine', 0.05, 400);
      logoSub.textContent = '夜道の気まずさゲーム'; logoSub.classList.remove('hard');
      $('b-start').textContent = '家に帰る';
      return;
    }
    const now = performance.now(); if (now - moonT > 4000) moonTaps = 0; moonT = now; moonTaps++;
    tone(600 + (moonBase() + moonTaps) * 120, 0.12, 'sine', 0.05);
    if (moonBase() + moonTaps >= MOON_TAPS) {
      dogMode = true; track('dog-unlock'); SE.bark(); foundSecret('dog');
      logoSub.textContent = '……ワン。犬の散歩モード'; logoSub.classList.add('hard');
      $('b-start').textContent = '家に帰る（犬の散歩）';
    }
  });
  function resetLogo() {
    hardMode = false; dogMode = false; taps = 0; moonTaps = 0;
    logo.classList.remove('flee'); logo.style.transform = '';
    logo.classList.toggle('fidget', unlocked());
    $('b-story').hidden = !unlocked(); // ストーリーは一度クリアすると出てくる
    $('hint').hidden = !(SHOW_HINT && unlocked());
    logoSub.textContent = '夜道の気まずさゲーム'; logoSub.classList.remove('hard');
    $('b-start').textContent = '家に帰る';
  }
  // 逃げたあとは、タイトルのあった場所をつつくと、左からもどってきて、ふつうにもどる
  document.querySelector('.logo').addEventListener('pointerdown', (e) => {
    if (!hardMode) return;
    e.preventDefault(); audio();
    hardMode = false; taps = 0; track('hard-off');
    // 右へ逃げたので、ぐるっと回って左からもどってくる：いったん左の画面外へ（動きなし）→ 左から元の位置へ
    logo.classList.add('from-left'); logo.classList.remove('flee'); void logo.offsetWidth;
    logo.classList.remove('from-left'); logo.classList.add('back');
    setTimeout(() => { logo.classList.remove('back'); logo.classList.toggle('fidget', unlocked()); }, 700);
    tone(300, 0.4, 'sawtooth', 0.04, 900);
    logoSub.textContent = '夜道の気まずさゲーム'; logoSub.classList.remove('hard');
    $('b-start').textContent = '家に帰る';
  });
  logo.addEventListener('pointerdown', (e) => {
    if (hardMode || dogMode) return; // はじめから使える（クリアしたあとはロゴがそわそわしてヒント）
    e.preventDefault(); e.stopPropagation(); audio();
    const now = performance.now();
    if (now - tapT > 2500) taps = 0;
    tapT = now; taps++;
    logo.classList.remove('fidget');
    logo.style.transform = `translateX(${taps * 9}px) skewX(${-9 - taps * 2}deg)`;
    tone(500 + taps * 120, 0.08, 'triangle', 0.05);
    if (taps >= 5) {
      hardMode = true; dogMode = false; track('hard-unlock'); foundSecret('hard');
      logo.style.transform = ''; logo.classList.add('flee');
      tone(1200, 0.5, 'sawtooth', 0.04, 300);
      setTimeout(() => { logoSub.textContent = '……タイトルが逃げた。むずかしいモード'; logoSub.classList.add('hard'); }, 450);
      $('hint').hidden = true;
      $('b-start').textContent = '家に帰る（むずかしい）';
    }
  });

  function track(name) { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: name, title: name, event: true }); } catch (e) {} }
  // 作者の X・YouTube・実況（どの画面で押したかも数える）
  // 実況の動画ができたら JIKKYO_URL を動画の URL にする（いまは作者の YouTube の動画一覧）
  const JIKKYO_URL = 'https://www.youtube.com/@futarigurashi_games/videos';
  document.querySelectorAll('.author').forEach((p) => p.querySelectorAll('a').forEach((a) => {
    if (a.classList.contains('jikkyo')) a.href = JIKKYO_URL;
    a.addEventListener('click', () => track(a.dataset.t + '-' + p.dataset.where));
  }));

  // ---- 大きさ ----
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(cv); // ボタンを出し入れして画面の高さが変わったときも

  // ---- 絵 ----
  const hash = (n) => { n = (n * 374761393) ^ 0x5bd1e995; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const LAMP_GAP = 30, VEND_AT = 45, VEND_GAP = 90;

  function lightAt(x) { // 街灯の明るさ 0〜1
    const k = Math.round(x / LAMP_GAP) * LAMP_GAP;
    return Math.max(0, 1 - Math.abs(x - k) / 9);
  }

  function draw(dt) {
    const ppm = W / 46;                     // 1m あたりの画面の点
    const gy = H * 0.62;                    // 塀の下（道の奥のはし）
    const ph = Math.min(H * 0.27, 130);     // 人の高さ（見やすく大きめ）
    const laneY = (z) => gy + H * (0.07 + z * 0.1);   // 列ごとの足もとの高さ
    const sc = (z) => 0.9 + z * 0.07;                 // 手前ほど大きく
    const d = g.her.x - g.me.x;
    // カメラ：自分を左寄りに。相手が近いときは 2 人が入るように
    let camX = g.me.x - 14;
    if (d > 0 && d < 30) camX = g.me.x - 14 + Math.max(0, d - 26);
    if (d < 0) camX = g.her.x - 14;
    const sx = (x) => (x - camX) * ppm;

    // 空
    const sky = ctx.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, '#060818'); sky.addColorStop(1, '#1b2147');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(255,255,255,${0.3 + hash(i + 99) * 0.5})`; ctx.fillRect((((hash(i) * W * 1.5 - camX * 0.3) % W) + W) % W, hash(i + 7) * gy * 0.45, 1.5, 1.5); }
    { // 月：つつくと満ちていく（moonFill 0＝三日月 → 1＝満月）
      if (moonTaps && performance.now() - moonT > 4000 && !dogMode) moonTaps = 0;
      const target = dogMode ? 1 : Math.min(1, (moonBase() + moonTaps) / MOON_TAPS);
      moonFill += (target - moonFill) * Math.min(1, (dt || 0.016) * 6);
      const mx = W * 0.82, my = H * 0.12, R = Math.min(W, H) * 0.05;
      if (moonFill > 0.3) { const gl = ctx.createRadialGradient(mx, my, R, mx, my, R * 3); gl.addColorStop(0, `rgba(255,246,214,${(moonFill - 0.3) * 0.35})`); gl.addColorStop(1, 'rgba(255,246,214,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(mx, my, R * 3, 0, 7); ctx.fill(); } // 満ちてくると光る
      ctx.fillStyle = '#fff6d6'; ctx.beginPath(); ctx.arc(mx, my, R, 0, 7); ctx.fill();
      if (moonFill < 0.98) { // 欠けている所（月の形で切りぬく）
        ctx.save(); ctx.beginPath(); ctx.arc(mx, my, R + 0.5, 0, 7); ctx.clip();
        ctx.fillStyle = '#0f1430'; ctx.beginPath(); ctx.arc(mx + R * 0.44 + moonFill * R * 1.6, my - R * 0.2, R * 0.9, 0, 7); ctx.fill();
        ctx.restore();
      }
    }

    // 遠くの家（ゆっくり動く）
    const par = 0.35, bw = 9;
    const k0 = Math.floor((camX * par) / bw) - 1, k1 = k0 + Math.ceil(W / (bw * ppm)) + 3;
    for (let k = k0; k <= k1; k++) {
      const x = (k * bw - camX * par) * ppm, w = (bw - 1 - hash(k) * 2) * ppm, h = (0.18 + hash(k + 3) * 0.22) * H;
      ctx.fillStyle = '#111634'; ctx.fillRect(x, gy - H * 0.1 - h, w, h);
      if (hash(k + 5) > 0.3) { // 屋根
        ctx.beginPath(); ctx.moveTo(x - 3, gy - H * 0.1 - h); ctx.lineTo(x + w / 2, gy - H * 0.1 - h - h * 0.25); ctx.lineTo(x + w + 3, gy - H * 0.1 - h); ctx.fill();
      }
      for (let wi = 0; wi < 4; wi++) if (hash(k * 7 + wi) > 0.55) {
        ctx.fillStyle = hash(k * 3 + wi) > 0.5 ? 'rgba(255,214,120,.75)' : 'rgba(160,190,255,.5)';
        ctx.fillRect(x + w * (0.15 + (wi % 2) * 0.45), gy - H * 0.1 - h + h * (0.2 + Math.floor(wi / 2) * 0.35), w * 0.25, h * 0.15);
      }
    }

    // ブロック塀
    ctx.fillStyle = '#262c4d'; ctx.fillRect(0, gy - H * 0.1, W, H * 0.1);
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
    for (let x = Math.floor(camX / 1.2) * 1.2; x < camX + W / ppm + 2; x += 1.2) { ctx.beginPath(); ctx.moveTo(sx(x), gy - H * 0.1); ctx.lineTo(sx(x), gy); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, gy - H * 0.05); ctx.lineTo(W, gy - H * 0.05); ctx.stroke();

    // 道
    ctx.fillStyle = '#2b3050'; ctx.fillRect(0, gy, W, H - gy);
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(0, gy + 2, W, 2);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    for (const z of [0.5, 1.5]) for (let x = Math.floor(camX / 6) * 6; x < camX + W / ppm + 6; x += 6) ctx.fillRect(sx(x), laneY(z) - 1, 2.5 * ppm, 2);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(0, laneY(2) + H * 0.035, W, 3);

    // コンビニ（塀がわ）
    { const kx = sx(C.KONBINI_X - 5), kw = 35 * ppm, kh = H * 0.34;
      if (kx < W && kx + kw > 0) {
        ctx.fillStyle = 'rgba(230,245,255,.18)'; ctx.fillRect(kx - 10, gy, kw + 20, H * 0.12);
        ctx.fillStyle = '#e4ebf2'; ctx.fillRect(kx, gy - kh, kw, kh);
        ctx.fillStyle = '#1e8f5a'; ctx.fillRect(kx, gy - kh, kw, kh * 0.18);
        ctx.fillStyle = '#ffffff'; ctx.font = `800 ${kh * 0.12}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('よみちマート 24h', kx + kw / 2, gy - kh + kh * 0.13);
        ctx.fillStyle = '#f6fbff'; ctx.fillRect(kx + kw * 0.06, gy - kh * 0.72, kw * 0.88, kh * 0.72);
        ctx.fillStyle = 'rgba(120,160,200,.35)'; for (let i = 1; i < 4; i++) ctx.fillRect(kx + kw * 0.06 + kw * 0.22 * i, gy - kh * 0.72, 2, kh * 0.72);
      } }

    // 自動販売機
    for (let x = Math.floor((camX - VEND_AT) / VEND_GAP) * VEND_GAP + VEND_AT; x < camX + W / ppm + 5; x += VEND_GAP) {
      if (x > C.HOME - 10 || Math.abs(x - C.KONBINI_X - 12) < 30) continue;
      const vx = sx(x), vh = ph * 0.95, vw = ph * 0.45;
      ctx.fillStyle = 'rgba(190,230,255,.12)'; ctx.beginPath(); ctx.ellipse(vx + vw / 2, gy, vw * 1.8, 10, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#d7e9ff'; ctx.fillRect(vx, gy - vh, vw, vh);
      ctx.fillStyle = '#3b6fd8'; ctx.fillRect(vx + 3, gy - vh + 3, vw - 6, vh * 0.42);
      for (let i = 0; i < 6; i++) { ctx.fillStyle = ['#ff6b6b', '#ffd166', '#06d6a0', '#ffffff', '#ff9f1c', '#9b5de5'][i]; ctx.fillRect(vx + 6 + (i % 3) * (vw - 12) / 3, gy - vh + 8 + Math.floor(i / 3) * vh * 0.18, (vw - 12) / 3 - 3, vh * 0.12); }
      ctx.fillStyle = '#222'; ctx.fillRect(vx + vw * 0.2, gy - vh * 0.22, vw * 0.6, vh * 0.1);
    }

    // マンション（家）
    { const hx = sx(C.HOME), bw2 = ph * 2.2, bh = H * 0.62;
      ctx.fillStyle = '#2b2f4f'; ctx.fillRect(hx - bw2 * 0.2, gy - bh, bw2, bh);
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) { ctx.fillStyle = hash(r * 5 + c) > 0.4 ? 'rgba(255,214,120,.8)' : '#1a1d33'; ctx.fillRect(hx - bw2 * 0.2 + 10 + c * (bw2 - 20) / 3, gy - bh + 14 + r * bh * 0.15, (bw2 - 20) / 3 - 10, bh * 0.08); }
      ctx.fillStyle = 'rgba(255,240,200,.9)'; ctx.fillRect(hx - bw2 * 0.05, gy - ph * 0.8, ph * 0.5, ph * 0.8);
      ctx.fillStyle = '#ffd76a'; ctx.font = `700 ${Math.max(11, ph * 0.11)}px sans-serif`; ctx.textAlign = 'left';
      ctx.fillText('メゾン夜道', hx - bw2 * 0.05, gy - ph * 0.88);
    }

    // 街灯（光）
    for (let x = Math.floor(camX / LAMP_GAP) * LAMP_GAP; x < camX + W / ppm + LAMP_GAP; x += LAMP_GAP) {
      const lx = sx(x), top = gy - ph * 1.7;
      const grd = ctx.createRadialGradient(lx, gy, 4, lx, gy, 9 * ppm);
      grd.addColorStop(0, 'rgba(255,215,106,.32)'); grd.addColorStop(1, 'rgba(255,215,106,0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(lx - 4, top + 6); ctx.lineTo(lx + 9 * ppm, laneY(2)); ctx.lineTo(lx - 9 * ppm, laneY(2)); ctx.fill();
      ctx.fillStyle = '#50597f'; ctx.fillRect(lx - 2, top, 4, gy - top);
      ctx.fillRect(lx - 2, top, 16, 4);
      ctx.fillStyle = '#fff1b8'; ctx.beginPath(); ctx.arc(lx + 14, top + 6, 5, 0, 7); ctx.fill();
    }

    // 人
    const her = g.her, me = g.me;
    herPhase += her.v * dt * 1.6; myPhase += OK.mySpeed(g) * dt * 1.6;
    const look = her.lookT > 0 || ((g.end === 'flee' || g.end === 'konbini') && g.endT < 0.4) || ['coworker', 'pole', 'same', 'bump'].includes(g.end);
    const items = [
      { z: her.z, f: () => drawWoman(sx(her.x), laneY(her.z), ph * sc(her.z), herPhase, her.v, lightAt(her.x), look) },
      { z: me.z + 0.01, f: () => drawMan(sx(me.x), laneY(me.z), ph * sc(me.z), myPhase, OK.mySpeed(g), lightAt(me.x)) },
    ];
    for (const o of OK.OBST) {
      if (sx(o.x1) < -50 || sx(o.x0) > W + 50) continue;
      if (o.kind === 'pole') items.push({ z: 2.2, f: () => drawPole(sx((o.x0 + o.x1) / 2), laneY(2) + H * 0.02, ph) });
      else items.push({ z: 1.6, f: () => drawCar(sx(o.x0), sx(o.x1), laneY(2) + H * 0.02, ph) });
    }
    if (g.police && g.police.on && sx(g.police.x) > -80 && sx(g.police.x) < W + 80) {
      const P = g.police; copPhase += dt * 8;
      items.push({ z: P.z, f: () => drawCop(sx(P.x), laneY(P.z), ph * sc(P.z), copPhase, lightAt(P.x)) });
    }
    if (g.dog) {
      const D = g.dog; dogPhase += her.v * dt * 3;
      const hx = sx(her.x) + ph * sc(her.z) * 0.12, hy = laneY(her.z) - ph * sc(her.z) * 0.55;
      items.push({ z: D.z + 0.005, f: () => drawDog(sx(D.x), laneY(D.z), ph * sc(D.z), dogPhase, her.v, lightAt(D.x), D.friend, hx, hy, D.barkT > 0 ? 'ワン！' : '') });
    }
    items.sort((a, b) => a.z - b.z).forEach(it => it.f());

    // 吹き出し
    ctx.textAlign = 'center';
    const thought = OK.herThought(g);
    if (thought) bubble(sx(her.x), laneY(her.z) - ph * sc(her.z) * 1.15, thought, g.sus > 55 ? '#ffd0d0' : '#ffffff', true);
    if (playing && !g.end && sx(her.x) > W - 10) { // 相手が画面の外（遊んでいるときだけ）
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `700 ${Math.max(12, H * 0.035)}px sans-serif`; ctx.textAlign = 'right';
      ctx.fillText(`前の人まで ${Math.round(her.x - me.x)}m ▶`, W - 10, gy - H * 0.04);
    }
    if (g.dog && !g.dog.friend && g.dog.friendT > 0 && g.dog.barkT <= 0 && !g.end) { // 犬が気になっている：くんくん＋♡ のゲージ
      const D = g.dog, k = Math.min(1, D.friendT / OK.C.DOG_FRIEND_T), dx = sx(D.x), dy = laneY(D.z) - ph * sc(D.z) * 0.45;
      bubble(dx, dy - 14, '（くんくん…）', '#ffe8c9', true);
      ctx.font = `700 ${Math.max(12, H * 0.03)}px sans-serif`; ctx.textAlign = 'center';
      const n = 3, full = Math.round(k * n); ctx.fillStyle = '#ff7a9a'; ctx.fillText('♥'.repeat(full) + '♡'.repeat(n - full), dx, dy + 4);
    }
    if (g.police && g.police.on && g.police.watching && !g.end) { // おまわりさんが見ている
      const P = g.police;
      bubble(sx(P.x), laneY(P.z) - ph * sc(P.z) * 1.25, g.cop >= 50 ? '（あの人、あやしいな…）' : '（じーっ）', '#cfe4ff', true);
    }
    // 出来事の文字（ゴホン など）
    pops = pops.filter(p => (p.t -= dt) > 0);
    for (const p of pops) {
      ctx.globalAlpha = Math.min(1, p.t * 2); ctx.fillStyle = p.c; ctx.font = `800 ${Math.max(16, H * 0.05)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(p.s, sx(p.x), laneY(her.z) - ph * (1.45 + (1.2 - p.t) * 0.2)); ctx.globalAlpha = 1;
    }
    // 追いこせたら CLEAR!
    if (g.end && OK.PASS_ENDS.includes(g.end) && !g.demo && $('o-story').hidden) { // デモ（タイトルの後ろ）では出さない
      const k = Math.min(1, g.endT * 4), fs = Math.min(W * 0.2, H * 0.18) * (0.6 + 0.4 * k);
      ctx.save(); ctx.globalAlpha = k; ctx.textAlign = 'center'; ctx.font = `900 ${fs}px sans-serif`;
      ctx.shadowColor = 'rgba(255,215,106,.9)'; ctx.shadowBlur = 24;
      ctx.lineWidth = fs * 0.08; ctx.strokeStyle = '#2a1f00'; ctx.strokeText('CLEAR!', W / 2, H * 0.36);
      ctx.fillStyle = '#ffd76a'; ctx.fillText('CLEAR!', W / 2, H * 0.36); ctx.restore();
    }
    if (g.rain) { // 雨（ストーリーのなかよしルートの金曜）
      ctx.strokeStyle = 'rgba(170,190,255,.35)'; ctx.lineWidth = 1;
      const tt = performance.now() / 1000;
      for (let i = 0; i < 70; i++) {
        const rx = ((hash(i) * W + tt * 60 * (0.6 + hash(i + 3))) % (W + 40)) - 20, ry = ((hash(i + 9) * H + tt * 520 * (0.8 + hash(i + 5) * 0.4)) % H);
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 3, ry + 12); ctx.stroke();
      }
    }
    // 警戒が高いと画面のふちが赤く
    if (g.sus > 50) {
      const a = (g.sus - 50) / 50 * 0.45;
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(255,40,40,0)'); v.addColorStop(1, `rgba(255,40,40,${a})`);
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }
  }

  function bubble(x, y, text, bg, think) {
    const fs = Math.max(12, Math.min(16, H * 0.042));
    ctx.font = `700 ${fs}px sans-serif`;
    const w = ctx.measureText(text).width + 18, h = fs + 14;
    const bx = Math.max(4, Math.min(W - w - 4, x - w / 2));
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, y - h, w, h, 10) : ctx.rect(bx, y - h, w, h); ctx.fill();
    if (think) { ctx.beginPath(); ctx.arc(x, y + 5, 4, 0, 7); ctx.arc(x - 4, y + 12, 2.5, 0, 7); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(x - 6, y - 1); ctx.lineTo(x + 6, y - 1); ctx.lineTo(x, y + 8); ctx.fill(); }
    ctx.fillStyle = '#1b1b2e'; ctx.textAlign = 'center'; ctx.fillText(text, bx + w / 2, y - h / 2 + fs * 0.36);
  }

  function shade(base, l) { // 街灯の下で明るく
    const k = 0.35 + 0.65 * l;
    return `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
  }

  function legs(x, gy, ph, phase, v, col, w) {
    const sw = v > 0.1 ? Math.sin(phase) * (v > 10 ? 0.5 : 0.3) : 0;
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
    const hip = gy - ph * 0.46, L = ph * 0.46;
    for (const s of [1, -1]) { ctx.beginPath(); ctx.moveTo(x, hip); ctx.lineTo(x + Math.sin(sw * s) * L, hip + Math.cos(sw * s) * L); ctx.stroke(); }
  }

  // 自転車のおまわりさん（向こうから来るので左向き）
  function drawCop(x, y, ph, phase, l) {
    const r = ph * 0.17;
    ctx.save();
    const beam = ctx.createLinearGradient(x - ph * 0.3, 0, x - ph * 1.6, 0); beam.addColorStop(0, 'rgba(255,245,200,.35)'); beam.addColorStop(1, 'rgba(255,245,200,0)');
    ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(x - ph * 0.32, y - ph * 0.42); ctx.lineTo(x - ph * 1.6, y - ph * 0.15); ctx.lineTo(x - ph * 1.6, y); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = ph * 0.03;
    for (const wx of [x - ph * 0.28, x + ph * 0.28]) { ctx.beginPath(); ctx.arc(wx, y - r, r, 0, 7); ctx.stroke(); }
    ctx.strokeStyle = shade([150, 155, 170], l); ctx.lineWidth = ph * 0.035;
    ctx.beginPath(); ctx.moveTo(x - ph * 0.28, y - r); ctx.lineTo(x - ph * 0.05, y - ph * 0.42); ctx.lineTo(x + ph * 0.12, y - ph * 0.42); ctx.lineTo(x + ph * 0.28, y - r); ctx.moveTo(x - ph * 0.05, y - ph * 0.42); ctx.lineTo(x, y - r); ctx.lineTo(x + ph * 0.28, y - r); ctx.stroke();
    ctx.fillStyle = '#fff6c4'; ctx.fillRect(x - ph * 0.34, y - ph * 0.46, ph * 0.06, ph * 0.05); // ライト
    const leg = Math.sin(phase) * ph * 0.06;
    ctx.strokeStyle = shade([40, 50, 90], l); ctx.lineWidth = ph * 0.06; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + ph * 0.06, y - ph * 0.62); ctx.lineTo(x + leg, y - r - ph * 0.02); ctx.stroke();
    ctx.fillStyle = shade([45, 60, 120], l); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - ph * 0.02, y - ph * 0.95, ph * 0.2, ph * 0.36, ph * 0.04) : ctx.rect(x - ph * 0.02, y - ph * 0.95, ph * 0.2, ph * 0.36); ctx.fill();
    ctx.strokeStyle = shade([45, 60, 120], l); ctx.lineWidth = ph * 0.05; ctx.beginPath(); ctx.moveTo(x + ph * 0.02, y - ph * 0.85); ctx.lineTo(x - ph * 0.1, y - ph * 0.5); ctx.stroke();
    ctx.fillStyle = shade([236, 200, 170], l); ctx.beginPath(); ctx.arc(x + ph * 0.06, y - ph * 1.04, ph * 0.08, 0, 7); ctx.fill();
    ctx.fillStyle = shade([30, 40, 90], l); ctx.fillRect(x - ph * 0.04, y - ph * 1.14, ph * 0.2, ph * 0.06); ctx.fillRect(x - ph * 0.08, y - ph * 1.09, ph * 0.1, ph * 0.025); // 帽子とつば
    ctx.fillStyle = '#ffd76a'; ctx.fillRect(x + ph * 0.04, y - ph * 1.12, ph * 0.03, ph * 0.03);
    ctx.restore();
  }
  // 犬（しば犬ふう）とリード
  function drawDog(x, y, ph, phase, v, l, friend, hx, hy, barking) {
    const s = ph * 0.32;
    ctx.strokeStyle = 'rgba(220,60,80,.85)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo((hx + x) / 2, Math.max(hy, y - s * 0.6) + s * 0.4, x + s * 0.45, y - s * 0.62); ctx.stroke();
    const sw = v > 0.1 ? Math.sin(phase) * s * 0.12 : 0;
    ctx.strokeStyle = shade([150, 90, 40], l); ctx.lineWidth = s * 0.1; ctx.lineCap = 'round';
    for (const [lx, k] of [[-0.3, 1], [-0.15, -1], [0.25, -1], [0.38, 1]]) { ctx.beginPath(); ctx.moveTo(x + s * lx, y - s * 0.35); ctx.lineTo(x + s * lx + sw * k, y); ctx.stroke(); }
    ctx.fillStyle = shade([205, 130, 60], l); ctx.beginPath(); ctx.ellipse(x, y - s * 0.45, s * 0.45, s * 0.2, 0, 0, 7); ctx.fill();
    const wag = friend ? Math.sin(performance.now() / 60) * 0.6 : 0; // なつくとしっぽフリフリ
    ctx.save(); ctx.translate(x - s * 0.42, y - s * 0.55); ctx.rotate(-0.8 + wag); ctx.beginPath(); ctx.arc(0, -s * 0.12, s * 0.12, Math.PI * 0.5, Math.PI * 2.2); ctx.lineWidth = s * 0.09; ctx.strokeStyle = shade([215, 140, 70], l); ctx.stroke(); ctx.restore();
    ctx.fillStyle = shade([205, 130, 60], l); ctx.beginPath(); ctx.arc(x + s * 0.48, y - s * 0.7, s * 0.2, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + s * 0.36, y - s * 0.82); ctx.lineTo(x + s * 0.4, y - s * 1.0); ctx.lineTo(x + s * 0.48, y - s * 0.86); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + s * 0.5, y - s * 0.86); ctx.lineTo(x + s * 0.58, y - s * 1.0); ctx.lineTo(x + s * 0.62, y - s * 0.8); ctx.fill();
    ctx.fillStyle = shade([245, 235, 220], l); ctx.beginPath(); ctx.ellipse(x + s * 0.6, y - s * 0.64, s * 0.1, s * 0.07, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillRect(x + s * 0.5, y - s * 0.76, s * 0.04, s * 0.04); ctx.beginPath(); ctx.arc(x + s * 0.69, y - s * 0.66, s * 0.03, 0, 7); ctx.fill();
    if (barking) { // 画面からはみ出すときは犬の左に出す（ふちどりで読みやすく）
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3; ctx.font = `800 ${Math.max(12, s * 0.4)}px sans-serif`;
      const tw = ctx.measureText(barking).width, right = x + s * 0.8 + tw < W - 6;
      ctx.textAlign = right ? 'left' : 'right'; const bx = right ? x + s * 0.8 : Math.min(W - 6, x + s * 0.2); ctx.strokeText(barking, bx, y - s * 1.05); ctx.fillText(barking, bx, y - s * 1.05);
    }
  }

  function drawPole(x, y, ph) {
    ctx.fillStyle = '#6d7390'; ctx.fillRect(x - ph * 0.06, y - ph * 2.2, ph * 0.12, ph * 2.2);
    ctx.fillStyle = '#ffcf3a'; ctx.fillRect(x - ph * 0.065, y - ph * 0.45, ph * 0.13, ph * 0.2); // 黄色い巻きもの
    ctx.fillStyle = '#2b2b2b'; for (let i = 0; i < 3; i++) ctx.fillRect(x - ph * 0.065, y - ph * 0.43 + i * ph * 0.06, ph * 0.13, ph * 0.025);
  }
  function drawCar(x0, x1, y, ph) {
    const w = x1 - x0, h = ph * 0.5;
    ctx.fillStyle = '#9aa0b4'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, y - h, w, h * 0.62, 8) : ctx.rect(x0, y - h, w, h * 0.62); ctx.fill();
    ctx.fillStyle = '#7d8398'; ctx.beginPath(); ctx.moveTo(x0 + w * 0.22, y - h); ctx.lineTo(x0 + w * 0.32, y - h * 1.5); ctx.lineTo(x0 + w * 0.72, y - h * 1.5); ctx.lineTo(x0 + w * 0.82, y - h); ctx.fill();
    ctx.fillStyle = '#26304d'; ctx.fillRect(x0 + w * 0.34, y - h * 1.42, w * 0.17, h * 0.38); ctx.fillRect(x0 + w * 0.54, y - h * 1.42, w * 0.16, h * 0.38);
    ctx.fillStyle = '#ff4d4d'; ctx.fillRect(x0 + 2, y - h * 0.85, 6, h * 0.15);
    ctx.fillStyle = '#111'; for (const fx of [0.2, 0.8]) { ctx.beginPath(); ctx.arc(x0 + w * fx, y - h * 0.38, h * 0.3, 0, 7); ctx.fill(); }
  }

  function drawMan(x, gy, ph, phase, v, l) {
    const bob = v > 0.1 ? Math.abs(Math.sin(phase)) * ph * 0.02 : 0;
    const y = gy - bob;
    legs(x, y, ph, phase, v, shade([40, 44, 70], l), ph * 0.07);
    // 体（スーツ）
    ctx.fillStyle = shade([58, 64, 102], l);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - ph * 0.11, y - ph * 0.82, ph * 0.22, ph * 0.4, ph * 0.05) : ctx.rect(x - ph * 0.11, y - ph * 0.82, ph * 0.22, ph * 0.4); ctx.fill();
    // かばん
    ctx.fillStyle = shade([90, 60, 40], l); ctx.fillRect(x - ph * 0.2 + Math.sin(phase) * ph * 0.03, y - ph * 0.5, ph * 0.14, ph * 0.11);
    // 頭
    ctx.fillStyle = shade([236, 200, 170], l); ctx.beginPath(); ctx.arc(x, y - ph * 0.9, ph * 0.09, 0, 7); ctx.fill();
    ctx.fillStyle = shade([30, 30, 40], l); ctx.beginPath(); ctx.arc(x, y - ph * 0.93, ph * 0.09, Math.PI, 0); ctx.fill();
  }

  function drawWoman(x, gy, ph, phase, v, l, lookBack) {
    const y = gy - (v > 0.1 ? Math.abs(Math.sin(phase)) * ph * 0.02 : 0);
    legs(x, y, ph * 0.95, phase, v, shade([230, 200, 180], l), ph * 0.05);
    // コート
    ctx.fillStyle = shade([150, 110, 90], l);
    ctx.beginPath(); ctx.moveTo(x - ph * 0.09, y - ph * 0.8); ctx.lineTo(x + ph * 0.09, y - ph * 0.8); ctx.lineTo(x + ph * 0.14, y - ph * 0.4); ctx.lineTo(x - ph * 0.14, y - ph * 0.4); ctx.fill();
    // バッグ
    ctx.fillStyle = shade([200, 60, 80], l); ctx.fillRect(x + ph * 0.07, y - ph * 0.6, ph * 0.1, ph * 0.1);
    // 髪と顔
    const f = lookBack ? -1 : 1;
    ctx.fillStyle = shade([40, 26, 20], l); ctx.beginPath(); ctx.ellipse(x - f * ph * 0.02, y - ph * 0.82, ph * 0.1, ph * 0.16, 0, 0, 7); ctx.fill();
    ctx.fillStyle = shade([240, 210, 185], l); ctx.beginPath(); ctx.arc(x + f * ph * 0.015, y - ph * 0.88, ph * 0.075, 0, 7); ctx.fill();
    if (lookBack) { ctx.fillStyle = '#222'; ctx.fillRect(x - ph * 0.04, y - ph * 0.9, ph * 0.02, ph * 0.02); }
    if (v === 0 && !lookBack) { // 立ち止まってスマホを見ている（画面が光る）
      ctx.fillStyle = 'rgba(160,220,255,.35)'; ctx.beginPath(); ctx.arc(x + ph * 0.12, y - ph * 0.72, ph * 0.12, 0, 7); ctx.fill();
      ctx.fillStyle = '#9fe0ff'; ctx.fillRect(x + ph * 0.09, y - ph * 0.76, ph * 0.05, ph * 0.08);
    }
  }

  // ---- 進める ----
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
    if (playing && !paused) {
      OK.step(g, dt);
      for (; seenEv < g.events.length; seenEv++) {
        const e = g.events[seenEv];
        if (e.kind === 'look') { SE.bad(); pops.push({ s: 'ちらっ', x: g.her.x, t: 1.2, c: '#ffd0d0' }); }
        if (e.kind === 'eye') { SE.bad(); pops.push({ s: '目が合った', x: g.her.x, t: 1.2, c: '#ff8a96' }); }
        if (e.kind === 'bark') SE.bark();
        if (e.kind === 'bell') { SE.bell(); pops.push({ s: 'チリンチリン！', x: g.me.x, t: 1.2, c: '#9fd0ff' }); }
        if (e.kind === 'cop') pops.push({ s: '自転車のおまわりさんが来た', x: g.me.x + 10, t: 1.6, c: '#9fd0ff' });
        if (e.kind === 'wag') { SE.wag(); pops.push({ s: 'しっぽフリフリ', x: g.dog.x, t: 1.4, c: '#ffd76a' }); }
        if (e.kind === 'end' && (e.id === 'flee' || e.id === 'konbini')) SE.flee();
        if (e.kind === 'end' && (e.id === 'pole' || e.id === 'bump')) SE.bump();
      }
      hud();
      if (g.end && !shown) {
        shown = true;
        const e = OK.END_BY[g.end];
        if (e.stars >= 3) SE.rare(); else if (OK.PASS_ENDS.includes(g.end)) SE.pass(); else if (g.end === 'same') SE.same();
        setTimeout(finish, 1600);
      }
    }
    // タイトル画面の後ろ：自動で歩くデモ（上手な遊び方で回りこんで追いこす。終わったらくりかえす）
    let ddt = playing && !paused ? dt : 0;
    if (!playing && !$('o-title').hidden) {
      if (!g.demo) newDemo();
      if (g.together) { OK.step(g, dt); demoTogether(g); } else { demoBot(g); OK.step(g, dt); } ddt = dt;
      if (g.end && g.endT > 2.5) newDemo();
    }
    draw(ddt);
    // 足音：足を 1 歩出すたびに鳴らす（歩くリズムは draw の中で進むので、そのあとで調べる）
    const mi = Math.floor(myPhase / Math.PI), hi = Math.floor(herPhase / Math.PI);
    if (playing && !g.end) {
      if (mi !== myStepIdx && OK.mySpeed(g) > 0) { SE.myStep(g.me.gear); steps.me++; }
      if (hi !== herStepIdx && g.her.v > 0) { SE.herStep(); steps.her++; }
    }
    myStepIdx = mi; herStepIdx = hi;
    requestAnimationFrame(frame);
  }

  function hud() {
    const s = Math.round(g.sus);
    $('h-sus').textContent = s + '%';
    $('h-mood').textContent = OK.mood(g.sus);
    { const d = Math.round(g.her.x - g.me.x); $('h-home-l').textContent = d >= 0 ? '前の人まで' : '前の人より'; $('h-home').textContent = d >= 0 ? d + 'm' : -d + 'm 前'; }
    const cop = !!g.police;
    $('h-coplab').hidden = $('h-copbar').hidden = !cop;
    if (cop) {
      const c = Math.round(g.cop || 0);
      $('h-cop').textContent = c + '%'; $('h-cbar').style.width = c + '%';
      $('h-cbar').style.background = c < 50 ? '#5aa9ff' : c < 80 ? 'var(--warn)' : 'var(--danger)';
    }
    $('l-name').textContent = OK.LANE_NAMES[g.me.lane];
    [...$('l-dots').children].forEach((el, i) => { el.className = i === g.me.lane ? 'on' : ''; }); // 上から 奥・まん中・手前
    const bar = $('h-bar'); bar.style.width = s + '%';
    bar.style.background = s < 40 ? 'var(--safe)' : s < 70 ? 'var(--warn)' : 'var(--danger)';
    $('g-name').textContent = OK.C.GEAR_NAMES[g.me.gear];
    [...$('g-dots').children].forEach((el, i) => { el.className = (i <= g.me.gear ? 'on' : '') + (g.me.gear === 4 ? ' run' : ''); });
  }

  function start() {
    pushName();
    document.body.classList.remove('menu'); paused = false; $('o-pause').hidden = true; $('o-rank').hidden = true;
    audio(); playBgm();
    const sc = story && OK.storyChapter(story.ch, story.route); // ストーリー中は、その話のモード
    g = sc ? OK.newGame(null, Object.assign({ mode: sc.mode }, sc.opts)) : OK.newGame(null, { mode: dogMode ? 'dog' : hardMode ? 'hard' : 'normal' }); seenEv = 0;
    $('o-story').hidden = true; pops = []; shown = false; myPhase = herPhase = 0;
    $('o-title').hidden = true; $('o-result').hidden = true;
    playing = true; track('start'); hud();
  }

  let lastText = '';
  function finish() {
    const r = OK.result(g);
    const isNew = !found.has(r.id); found.add(r.id); saveFound();
    if (story) { storyNight(r); return; } // ストーリー中は、その夜のふり返りへ（ランキングには入れない）
    track('end-' + r.id);
    $('r-stars').textContent = (g.mode !== 'normal' ? OK.MODES[g.mode] + '　' : '') + (OK.PASS_ENDS.includes(r.id) ? 'CLEAR!　' : '') + '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
    $('r-new').hidden = !isNew;
    $('r-head').textContent = r.head;
    $('r-sub').textContent = r.sub;
    $('r-max').textContent = r.max + '%';
    $('r-title').textContent = '称号：' + r.title;
    { const u = $('r-hint').hidden = !(g.mode === 'dog' && g.dog && !g.dog.friend); const t = u ? OK.uwasa(secrets, Math.random()) : ''; $('r-uwasa').textContent = t; $('r-uwasa').hidden = !t; } // 犬のヒントがないときは、うわさ
    $('r-hint').hidden = !(g.mode === 'dog' && g.dog && !g.dog.friend); // 犬の散歩でなつかずに終わったら、なつかせ方のヒント
    { const clr = OK.PASS_ENDS.includes(r.id), sk = OK.skill(g.mode, r.max, r.friend); // 腕前ランク（クリアしたときだけ）
      $('r-skill').hidden = !clr; $('r-skill').className = 'skill r-' + sk.rank;
      $('r-sk-rank').textContent = sk.rank; $('r-sk-name').textContent = sk.name; }
    const clear = OK.PASS_ENDS.includes(r.id);
    const place = clear ? addRank(r, g.mode) : 0;
    if (clear && g.mode === 'hard') { try { localStorage.setItem('oikoshi-hardclear', '1'); } catch (e) {} } // 犬の散歩モードの入口が開く
    $('r-rank').hidden = !clear;
    if (clear) {
      $('r-rank-head').textContent = place === 1 ? '自己ベスト更新！' : place ? `ランキング ${place} 位に入った！` : 'ランキング（この端末）';
      lastPlace = { mode: g.mode, now: place ? rank[place - 1].now : 0 };
      const mode = g.mode;
      if (shared()) submitShared(r, mode).catch(() => {}).then(() => showRank(mode)); // みんなのランキングに記録してから並べる
      else showRank(mode);
    }
    lastText = OK.shareText(r, found.size, location.origin + location.pathname + '?ref=share', g.trace, place, g.mode);
    $('b-share').href = 'https://x.com/intent/post?text=' + encodeURIComponent(lastText);
    $('o-result').hidden = false;
    document.body.classList.add('menu');
    playing = false;
  }

  // ---- デモ（タイトルの後ろ）----
  function newDemo() { g = OK.newGame(Math.floor(Math.random() * 1e9)); g.demo = true; g.coworker = false; g.together = sFound.has('loop'); myPhase = herPhase = 0; pops = []; }
  // 10 個目の結末まで見つけた人は、タイトルの後ろで女性と並んで帰る（もう追いこさない）
  function demoTogether(g) {
    if (g.end) return;
    g.sus = 0; g.maxSus = 0;
    g.me.lane = 0; g.me.z = 0.6; g.me.x = g.her.x - 4; // 列を少しずらす（0.5 より近いと、ぶつかった扱い）
    OK.setGear(g, g.her.v > 0 ? 2 : 0);
  }
  function demoBot(g) {
    if (g.end) return;
    const d = g.her.x - g.me.x;
    const free = (l) => !OK.blockAt(g.me.x + 8, l, 2) && !OK.blockAt(g.me.x, l, 1);
    const want = d < -12 ? 1 : 2; let lane = [want, 1, 0].find(free); if (lane == null) lane = 0;
    if (lane !== g.me.lane) OK.setLane(g, lane);
    const car = OK.OBST.some((o) => o.kind === 'car' && g.her.x > o.x0 - 30 && g.her.x < o.x1 + 5 && g.me.x < o.x1);
    OK.setGear(g, d > 0 && car ? (d > 33 ? 2 : 1) : 3);
  }

  // ---- ストーリー「月曜から金曜の帰り道」（ほっこり）----
  let story = null; // { ch: 何話目（0〜4）, results: [{ id, max, friend }], phase }
  function storyShow(day, lines, nextLabel) {
    for (const id of ['o-title', 'o-result', 'o-pause', 'o-rank']) $(id).hidden = true;
    document.body.classList.add('menu'); playing = false;
    $('st-day').textContent = day;
    // 「（月）…」で始まる行はメモ（感動の結末）：小さい字で 1 枚の紙にまとめる
    let html = '', memo = '';
    lines.forEach((t, i) => {
      const p = `<p style="animation-delay:${i * 0.7}s">${esc(t)}</p>`;
      if (t.startsWith('（')) { memo += p; return; }
      if (memo) { html += `<div class="memo">${memo}</div>`; memo = ''; }
      html += p;
    });
    $('st-text').innerHTML = html + (memo ? `<div class="memo">${memo}</div>` : '');
    $('st-next').textContent = nextLabel;
    $('st-res').hidden = true; $('st-share').hidden = true; $('st-quit').hidden = false;
    $('o-story').hidden = false;
  }
  function storyIntro() {
    if (story.ch === 3 && !story.route) story.route = OK.storyRoute(story.results); // 水曜までの平均警戒度で、木・金のルートが決まる
    const c = OK.storyChapter(story.ch, story.route), prev = story.results[story.ch - 1];
    const before = !prev ? [] : [OK.PASS_ENDS.includes(prev.id) ? '昨日は、なんとか気まずくなく帰れた。' : prev.id === 'same' ? '昨日は、結局エレベーターまでいっしょだった……。' : prev.id === 'flee' || prev.id === 'konbini' ? '昨日は、逃げられてしまった……。' : '昨日は、いろいろあった……。'];
    story.phase = 'intro';
    storyShow(`第${story.ch + 1}話　${c.day}${story.route ? '　' + OK.ROUTES[story.route].name : ''}`, before.concat(c.intro), '歩きだす');
  }
  function storyNight(r) {
    story.results.push({ id: r.id, max: r.max, friend: r.friend, passDz: r.passDz, cop: r.cop });
    story.phase = 'night';
    const last = story.ch >= OK.STORY_LEN - 1;
    storyShow(`${OK.storyChapter(story.ch, story.route).day}の帰り道`, [r.head, r.sub, `最大警戒度 ${r.max}%`], last ? 'マンションに着いた' : '次の日へ');
  }
  function storyEnd() {
    const end = OK.storyEnding(story.results, story.route, OK.STORY_ORDER.every((k) => sFound.has(k)));
    story.phase = 'end'; track('story-' + end.id);
    storyShow('金曜日の夜', end.lines, 'タイトルへ');
    const days = ['月', '火', '水', '木', '金'];
    const isNew = !sFound.has(end.id); sFound.add(end.id);
    try { localStorage.setItem(SKEY, JSON.stringify([...sFound])); } catch (e) {}
    const nn = (n) => String(n).padStart(2, '0'), total = OK.STORY_ORDER.length;
    const done = sFound.has('loop'); // 10 個目まで見つけた
    const list = OK.STORY_ORDER.concat(done ? ['loop'] : []).map((k) => { const e = OK.STORY_ENDS[k], got = sFound.has(k);
      return `<li class="${k === end.id ? 'now' : ''}${got ? '' : ' no'}"><b>${nn(e.no)}</b>${got ? esc(e.head) : `？？？<small>${esc(e.hint)}</small>`}</li>`; }).join('');
    $('st-res').innerHTML = `<div class="st-no">ENDING ${nn(end.no)}<span>／${total}</span>${isNew ? '<i>NEW</i>' : ''}</div>${end.extra ? '<div class="st-extra">EXTRA</div>' : `<div class="st-route">${esc(end.routeName)}</div>`}<div class="stars">${'★'.repeat(end.stars)}${'☆'.repeat(3 - end.stars)}</div><div class="head">${esc(end.head)}</div><div class="st-days">${story.results.map((x, i) => `<span>${days[i]}<i class="c${x.max < 15 ? 0 : x.max < 40 ? 1 : x.max < 70 ? 2 : 3}"></i><em>${x.max}%</em></span>`).join('')}</div><div class="st-legend">その夜の最大警戒度（<b class="g">緑</b>は平気 → <b class="r">赤</b>はヤバい）</div>${end.title ? `<div class="st-title">称号：${esc(end.title)}</div>` : ''}<details class="st-list${done ? ' gold' : ''}"><summary>結末の一覧　${sFound.size}／${total}</summary><ol>${list}</ol></details>`;
    $('st-res').hidden = false;
    $('st-share').href = 'https://x.com/intent/post?text=' + encodeURIComponent(OK.storyShare(end, story.results, location.origin + location.pathname + '?ref=share'));
    $('st-share').hidden = false; $('st-quit').hidden = true;
  }
  $('b-story').onclick = () => { if (!saveName($('pname').value)) { nameErr(true); return; } nameErr(false); audio(); playBgm(); track('story-start'); story = { ch: 0, results: [] }; storyIntro(); };
  $('st-next').onclick = () => {
    if (!story) return;
    if (story.phase === 'intro') start();
    else if (story.phase === 'night') { if (story.ch >= OK.STORY_LEN - 1) storyEnd(); else { story.ch++; storyIntro(); } }
    else toTitle();
  };
  $('st-quit').onclick = toTitle;
  $('st-share').onclick = () => track('story-share');

  // ---- 一時停止（右上の ☰）----
  let paused = false;
  function pause() { if (!playing || g.end || paused) return; paused = true; $('o-pause').hidden = false; try { bgm.pause(); } catch (e) {} track('pause'); }
  function resume() { if (!paused) return; paused = false; $('o-pause').hidden = true; last = performance.now(); playBgm(); }
  function toTitle() { // タイトルへ（むずかしいモードはここで元にもどる）
    playing = false; paused = false;
    story = null;
    for (const id of ['o-result', 'o-pause', 'o-rank', 'o-story']) $(id).hidden = true;
    $('o-title').hidden = false; document.body.classList.add('menu');
    newDemo(); hud(); resetLogo(); $('pname').value = getName();
  }
  $('b-menu').addEventListener('click', pause);
  $('b-resume').onclick = resume;
  $('b-restart').onclick = () => { track('restart'); start(); };
  $('b-ptitle').onclick = toTitle;
  // 音量のつまみ（BGM・効果音）
  function showVol() {
    for (const k of ['bgm', 'se']) { $('v-' + k).value = Math.round(vol[k] * 100); $('v-' + k + '-n').textContent = vol[k] > 0 ? Math.round(vol[k] * 100) : '消音'; }
  }
  function saveVol() { try { localStorage.setItem(VOL_KEY, JSON.stringify(vol)); } catch (e) {} }
  $('v-bgm').addEventListener('input', () => { vol.bgm = +$('v-bgm').value / 100; bgm.volume = 0.5 * vol.bgm; showVol(); saveVol(); });
  $('v-se').addEventListener('input', () => { vol.se = +$('v-se').value / 100; if (seGain) seGain.gain.value = vol.se; showVol(); saveVol(); });
  $('v-se').addEventListener('change', () => { audio(); SE.good(); }); // 手をはなしたら、ためしに鳴らす
  showVol();
  // 十字キーの右手用・左手用（この端末に覚える）
  const HAND_KEY = 'oikoshi-hand';
  function setHand(left) {
    document.body.classList.toggle('lefty', left);
    document.querySelectorAll('.hand-btn').forEach((b) => { b.textContent = '十字キー：' + (left ? '左手' : '右手') + '（押すと切りかえ）'; });
    try { localStorage.setItem(HAND_KEY, left ? 'left' : 'right'); } catch (e) {}
  }
  let lefty = false; try { lefty = localStorage.getItem(HAND_KEY) === 'left'; } catch (e) {}
  setHand(lefty);
  document.querySelectorAll('.hand-btn').forEach((b) => b.addEventListener('click', () => { lefty = !lefty; setHand(lefty); track(lefty ? 'hand-left' : 'hand-right'); }));

  // ---- タイトルからランキング：結果画面のランキングの箱を、ランキングの画面へ移して使う ----
  const rankBox = $('r-rank'), rankHome = rankBox.parentNode, rankNext = rankBox.nextSibling;
  $('b-rank').onclick = () => {
    $('o-rank-body').appendChild(rankBox); rankBox.hidden = false;
    $('r-rank-head').textContent = 'ランキング';
    $('o-title').hidden = true; $('o-rank').hidden = false;
    lastPlace = { mode: 'normal', now: 0 }; showRank('normal'); track('rank-from-title');
  };
  $('b-rankback').onclick = () => { rankHome.insertBefore(rankBox, rankNext); $('o-rank').hidden = true; $('o-title').hidden = false; };

  // ---- 操作 ----
  const tap = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); if (playing && !g.end && !paused) { fn(); hud(); } });
  tap('b-slow', () => OK.setGear(g, g.me.gear - 1));
  tap('b-fast', () => OK.setGear(g, g.me.gear + 1));
  tap('b-up', () => OK.setLane(g, g.me.lane - 1));
  tap('b-down', () => OK.setLane(g, g.me.lane + 1));
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') { if (e.key === 'Enter') { e.target.blur(); } return; } // 名前を打っているとき
    if (e.key === 'Escape' && playing && !g.end) { paused ? resume() : pause(); return; }
    if (!playing || g.end) { if ((e.key === 'Enter' || e.key === ' ') && !playing && !$('o-title').hidden) startFromTitle(); return; }
    if (paused) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft') OK.setGear(g, g.me.gear - 1);
    else if (k === 'arrowright') OK.setGear(g, g.me.gear + 1);
    else if (k === 'arrowup') OK.setLane(g, g.me.lane - 1);
    else if (k === 'arrowdown') OK.setLane(g, g.me.lane + 1);
    else return;
    e.preventDefault(); hud();
  });
  function startFromTitle() { // タイトルから：名前を確かめてから始める
    if (!saveName($('pname').value)) { nameErr(true); return; }
    nameErr(false); start();
  }
  $('b-start').onclick = startFromTitle;
  $('t-normal').onclick = () => showRank('normal');
  $('t-hard').onclick = () => showRank('hard');
  $('t-dog').onclick = () => showRank('dog');
  $('b-title').onclick = toTitle;
  $('pname').value = getName();
  $('pname').addEventListener('change', () => { if (!saveName($('pname').value)) { nameErr(true); return; } nameErr(false); $('pname').value = getName(); pushName(); });
  $('b-again').onclick = () => { track('again'); start(); };
  $('b-share').onclick = () => track('share');

  document.body.classList.add('menu'); // はじめの画面では操作ボタンを出さない
  resetLogo();
  resize(); hud();
  requestAnimationFrame((t) => { last = t; frame(t); });
  window.__OK = { get g() { return g; }, start, steps }; // テスト用
})();
