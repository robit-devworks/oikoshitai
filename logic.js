// オイコシタイ！ の決まり（描画なし・Node でテストできる）
// 夜道で前を歩く女性を、怖がらせずに追いこしたい。
// 道は「奥（塀ぎわ）・まん中・手前」の 3 列。相手は奥を歩く。列をはなれて回りこむほど警戒されにくい。
// 手前の列には止まっている車と電柱があって、そこでは相手に近い列を通るしかない。
// 近づきすぎる・走る・同じ速さでついて歩く → 警戒度が上がる。100% で逃げられる。
// モード：ふつう／むずかしい（おまわりさんの巡回）／犬の散歩（隠し・おまわりさんも出る）。エンディングは 19 種類。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OK = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    HOME: 360,          // 相手の家（＝自分の家）までの距離（m）
    START_GAP: 70,      // はじめの間かく
    HER_V: 6,           // 相手のふつうの速さ
    GEARS: [0, 4, 6.5, 9, 15],
    GEAR_NAMES: ['止まる', 'ゆっくり', 'ふつう', '早歩き', '走る'],
    NEAR: 30,           // これより近いと気配を感じられる
    LANE_W: 9,         // 列が 1 つちがうと、これだけ離れているのと同じ
    LANE_V: 2.5,        // 列を変える速さ（1 秒に何列）
    PASS_DONE: 35,      // これだけ前に出たら「抜けた」
    DISTRACT: 0.6,
    // スマホを見て立ち止まる：何秒ごとに（gap）・何秒（len）。むずかしいはたまに・短く（null なら見ない）
    PHONE: { normal: { gap: [9, 16], len: [2, 3.5] }, hard: { gap: [16, 24], len: [1.2, 2] }, dog: { gap: [9, 16], len: [2, 3.5] } },      // 相手がスマホを見ているあいだは、警戒の上がり方がこれだけになる
    KONBINI_X: 200,     // 塀がわのコンビニ
    POLICE_LANES: 20,   // 列を変えた回数がこれをこえると職務質問
    COWORKER_RATE: 0.08,
    // むずかしいモード：自転車のおまわりさん（まん中の列を向こうから来る）。ぶつかると捕まる
    COP_V: 6, COP_SLOW: 1.5, COP_LANE: 1, COP_SEE: 40, COP_FIRST: 6, COP_GAP: [3, 6], COP_DECAY: 4,
    // おまわりさんはゆっくり巡回し、女性の近く（COP_NEAR_HER 以内）では自転車を押して歩く（COP_SLOW）
    // 犬の散歩モード（隠し）
    DOG_NEAR: 14,       // これより近いと吠える（横の列は LANE_W 倍に数える）
    DOG_BARK: 18, DOG_CD: 3.5, DOG_FRIEND_T: 1.5,
  };
  const LANE_NAMES = ['奥', 'まん中', '手前'];

  // じゃまもの（毎回同じ並び。覚えると上手くなる）。lanes：ふさいでいる列
  const OBST = [];
  for (const x of [45, 165, 285]) OBST.push({ kind: 'pole', x0: x - 1.5, x1: x + 1.5, lanes: [2] });
  for (const x of [105, 240]) OBST.push({ kind: 'car', x0: x, x1: x + 18, lanes: [1, 2] });

  const ENDINGS = [
    { id: 'ghost', stars: 3, head: '透明人間', sub: '一度も気づかれずに追いこした', title: '夜道の忍び', quip: '相手は最後まで、後ろに人がいたことを知らない' },
    { id: 'gentle', stars: 2, head: 'スマートに追いこした', sub: 'ほとんど警戒されなかった', title: '夜道の紳士', quip: '紳士すぎて、たぶん記憶にも残っていない' },
    { id: 'pass', stars: 1, head: '追いこした', sub: 'ちょっと警戒されたけど、セーフ', title: '空気の読める人', quip: 'ちょっと怪しまれたけど、今日もなんとか一般人' },
    { id: 'close', stars: 1, head: 'ギリギリ追いこした', sub: 'かなり怪しまれていた', title: 'ほぼ不審者（ほぼ濡れ衣）', quip: 'ほぼ不審者として、無事に帰宅' },
    { id: 'dash', stars: 2, head: '走って抜き去った', sub: 'すぐ横を全力で走り抜けた。夜の短距離走', title: '夜の短距離走者', quip: '「夜道を全力で走る人」として、ご近所で噂に' },
    { id: 'flee', stars: 1, head: '全力で逃げられた', sub: 'ただ家に帰りたかっただけなのに', title: '夜道の不審者（濡れ衣）', quip: '相手のほうが足が速かった' },
    { id: 'konbini', stars: 2, head: 'コンビニに避難された', sub: '店員さんにまで見られている', title: 'コンビニ前の不審者', quip: '店員さんと目が合った。完全に見られていた' },
    { id: 'same', stars: 1, head: '同じマンションだった', sub: 'エレベーターも一緒だった', title: '気まずさの化身', quip: 'エレベーターで 8 階まで無言' },
    { id: 'yuzuri', stars: 3, head: 'ゆずり合って夜が明けた', sub: 'お互い「お先にどうぞ」と立ち止まり続けた', title: 'ゆずり合いの達人', quip: '気づいたら朝。お互い一歩も動かなかった' },
    { id: 'coworker', stars: 3, head: '会社の同僚だった', sub: '「あれ、おつかれさまです…」明日も気まずい', title: '世間はせまい', quip: '明日の朝礼が気まずい' },
    { id: 'police', stars: 3, head: 'おまわりさんに声をかけられた', sub: '回りこみすぎて、うろうろしている人になった', title: '職務質問マスター', quip: '「このへんで何してるの？」「家に帰ってます」' },
    { id: 'pole', stars: 2, head: '電柱にぶつかった', sub: '「だ、大丈夫ですか…？」逆に心配された', title: '電柱の友', quip: '電柱に「すみません」と言った。電柱は何も言わなかった' },
    { id: 'shokushitsu', stars: 2, mode: 'hard', head: '自転車のおまわりさんに止められた', sub: '「ちょっといいですか」家に帰りたいだけなのに', title: '夜道の要注意人物', quip: '身分証を出しているあいだに、前の人は帰っていった' },
    { id: 'soudan', stars: 2, mode: 'hard', head: '女性がおまわりさんに相談しはじめた', sub: 'こちらを見ながら、何か話している', title: '相談されし者', quip: '「あの人です」の指が、まっすぐこっちを向いていた' },
    { id: 'copbump', stars: 2, mode: 'hard', head: 'おまわりさんにぶつかった', sub: '「ちょっと署まで来てもらえる？」家はすぐそこなのに', title: '夜道の現行犯', quip: '自転車の前に飛び出したのは、こっちだった' },
    { id: 'bark', stars: 1, mode: 'dog', head: '犬に吠えられまくった', sub: '近所じゅうの犬も吠えはじめた', title: '犬の敵', quip: '犬は全部わかっていた' },
    { id: 'natsuki', stars: 2, mode: 'dog', head: '犬にだけなつかれた', sub: '飼い主さんとは、最後まで目が合わなかった', title: 'もふもふの味方', quip: '犬とは仲良くなれた。人間とはまだ' },
    { id: 'dogfollow', stars: 3, mode: 'dog', head: '犬が家までついてきた', sub: '飼い主さんが、すごい顔で追いかけてきた', title: '犬の親友', quip: 'リードの先に、知らない飼い主がついてきた' },
    { id: 'bump', stars: 2, head: 'ぶつかってしまった', sub: '近づきすぎた。悲鳴が夜道にひびいた', title: '距離感ゼロ', quip: '「すみません！」が夜道にこだました' },
  ];
  const END_BY = Object.fromEntries(ENDINGS.map(e => [e.id, e]));
  const PASS_ENDS = ['ghost', 'gentle', 'pass', 'close', 'dash', 'dogfollow'];
  const MODES = { normal: 'ふつう', hard: 'むずかしい', dog: '犬の散歩' };

  // 相手の様子（ゲージの段階）
  const MOODS = [[15, '平常'], [35, '気づいた'], [55, 'あやしい…'], [75, '警戒中'], [101, '限界']];
  function mood(sus) { return MOODS.find(([v]) => sus < v)[1]; }

  // 相手の心の声
  function herThought(g) {
    const sus = typeof g === 'number' ? g : g.sus;
    if (typeof g === 'object') {
      if (g.end === 'flee' || g.end === 'konbini') return '（ダッシュ）';
      if (g.end === 'same') return '（え、同じマンション…？）';
      if (g.end === 'coworker') return '「あれ、おつかれさまです…」';
      if (g.end === 'pole') return '「だ、大丈夫ですか…？」';
      if (g.end === 'bump') return '「きゃっ！」';
      if (g.end === 'soudan') return '「あの人です…」';
      if (g.end === 'shokushitsu') return '（…なにかあったのかな）';
      if (g.end === 'copbump') return '（…え、捕まった？）';
      if (g.end === 'bark') return '（ダッシュ）';
      if (g.end === 'dogfollow' || g.end === 'natsuki') return '「ちょっと、どこ行くの！」';
      if (g.dog && g.dog.barkT > 0) return '（え、なに？）';
      if (g.her.yield) return '（お先にどうぞ…）';
      if (sus < 15 && g.her.stopT > 0) return '（スマホ見よ）';
    }
    if (sus < 15) return '';
    if (sus < 35) return '…';
    if (sus < 55) return '（足音、近い…？）';
    if (sus < 75) return '（え、ついてきてる？）';
    return '（早く帰りたい…！）';
  }

  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  function newGame(seed, opts) {
    let o;
    const rand = rng(seed == null ? Date.now() : seed);
    const g0 = {
      rand, t: 0, sus: 0, maxSus: 0, end: null, endT: 0,
      mode: (opts && (opts.mode || (opts.hard && 'hard'))) || 'normal',
      me: { x: 0, gear: 2, z: 0, lane: 0 },
      her: { x: C.START_GAP, z: 0, v: C.HER_V, stopT: 0, nextStop: 6 + rand() * 6, lookT: 0, looks: 0, yield: false },
      followT: 0, standT: 0, laneMoves: 0, passedRunning: false, wasBehind: true, trace: [],
      coworker: rand() < C.COWORKER_RATE,
      events: [],   // 画面に出す出来事 { t, kind }
    };
    const g = Object.assign(g0, { hard: g0.mode === 'hard' });
    o = opts || {};
    g.herMul = o.herMul || 1;                      // ストーリー：女性の歩く速さの倍率
    if (o.startSus) g.sus = g.maxSus = o.startSus; // ストーリー：はじめから少し警戒している
    g.riseMul = o.riseMul || 1;                    // ストーリー：警戒度の上がり方の倍率（なかよしルートはゆるい）
    if (o.phone) g.phoneCfg = o.phone;             // ストーリー：スマホを見る回数・長さ
    if (o.copGap) g.copGap = o.copGap;             // ストーリー：おまわりさんの来る間かく（気まずいルートは多い）
    g.rain = !!o.rain;                             // ストーリー：雨（見た目だけ）
    if ((g.hard || g.mode === 'dog') && !o.noCop) { g.cop = 0; g.police = { x: 0, z: C.COP_LANE, on: false, next: o.copFirst != null ? o.copFirst : C.COP_FIRST + (g.mode === 'dog' ? 4 : 0), bellT: 0, watching: false }; }
    if (g.mode === 'dog') g.dog = { x: g.her.x - 4, z: 0.6, tz: 0.6, next: 2, barkT: 0, cd: 0, friendT: 0, friend: false, lastBark: -99 };
    return g;
  }

  function mySpeed(g) { return C.GEARS[g.me.gear]; }

  function setGear(g, gear) {
    if (g.end) return;
    g.me.gear = Math.max(0, Math.min(4, gear));
  }

  // その場所・その列をふさいでいるもの
  function blockAt(x, lane, pad) {
    pad = pad || 0;
    return OBST.find(o => o.lanes.includes(lane) && x > o.x0 - pad && x < o.x1 + pad);
  }

  function setLane(g, lane) {
    if (g.end) return false;
    lane = Math.max(0, Math.min(2, lane));
    if (lane === g.me.lane) return false;
    if (blockAt(g.me.x, lane, 1)) return false; // 車や電柱があって入れない
    g.me.lane = lane; g.laneMoves++;
    return true;
  }

  function finish(g, id) { if (!g.end) { g.end = id; g.events.push({ t: g.t, kind: 'end', id }); } }

  function step(g, dt) {
    const me = g.me, her = g.her;
    if (g.end) {
      g.endT += dt;
      if (g.end === 'flee' || g.end === 'konbini' || g.end === 'bump') her.x += 22 * dt;
      return;
    }
    g.t += dt;

    // ---- 自分 ----
    const dzl = me.lane - me.z;
    me.z += Math.sign(dzl) * Math.min(Math.abs(dzl), C.LANE_V * dt);
    const mv = mySpeed(g);
    const nx = me.x + mv * dt;
    const lane = Math.round(me.z);
    const ob = blockAt(nx + 2, lane);
    if (ob && !blockAt(me.x + 2, lane)) {           // 前にじゃまもの
      if (ob.kind === 'pole' && me.gear === 4) { me.x = ob.x0 - 2; finish(g, 'pole'); return; }
      me.x = ob.x0 - 2.01;                          // ぶつかって止まる
    } else me.x = nx;
    if (g.dog) { // 犬はふめない（同じ列で前にいたら止まる）
      const dd = g.dog.x - me.x;
      if (Math.abs(g.dog.z - me.z) < 0.5 && dd > 0 && dd < 2.5) me.x = g.dog.x - 2.5;
    }

    // ---- 相手 ----
    let d = her.x - me.x;
    let hv = C.HER_V * (g.herMul || 1);
    const behind = d > 0;
    if (behind) { if (g.sus > 70) hv *= 1.6; else if (g.sus > 40) hv *= 1.25; } // 早歩きで離れようとする
    else if (g.sus > 40) hv *= 0.6;                                            // 前に行ってほしいので、ゆっくりになる
    // 後ろで止まると、相手も止まって先に行かせようとする
    her.yield = behind && d < 25 && mv === 0 && g.sus > 20 && g.sus < 85;
    if (her.yield) { hv = 0; g.standT += dt; if (g.standT > 6) { finish(g, 'yuzuri'); return; } }
    else g.standT = 0;
    if (her.stopT > 0) { her.stopT -= dt; hv = 0; if (g.sus > 40) her.stopT = 0; }
    else if (g.t >= her.nextStop) { // ときどき立ち止まってスマホを見る（モードで回数と長さがちがう）
      const P = g.phoneCfg || (g.mode in C.PHONE ? C.PHONE[g.mode] : C.PHONE.normal);
      const r1 = g.rand(), r2 = g.rand(); // 乱数はいつも 2 つ使う（遊び方で後の展開がずれないように）
      if (P && g.sus < 40) { her.stopT = P.len[0] + r1 * (P.len[1] - P.len[0]); g.events.push({ t: g.t, kind: 'stop' }); }
      her.nextStop = g.t + (P ? P.gap[0] + r2 * (P.gap[1] - P.gap[0]) : 999);
    }
    her.v = hv;
    her.x += hv * dt;
    if (her.lookT > 0) her.lookT -= dt;

    // ---- 警戒度 ----
    d = her.x - me.x;
    const ad = Math.abs(d), dz = Math.abs(me.z - her.z);
    const eff = Math.hypot(d, dz * C.LANE_W);
    let rise = 0;
    if (eff < C.NEAR) {
      const near = 1 - eff / C.NEAR;
      rise += d > 0 ? near * near * 30 : near * near * 12;   // 後ろからがいちばん怖い
      if (ad < 4 && dz < 1.2) rise += 10;                    // すぐ横にならぶ
      if (d > 0 && me.gear === 4) rise += 40 * near;         // 走って近づく
      if (d > 0 && dz < 0.6 && Math.abs(mv - hv) < 1.5 && mv > 0) { g.followT += dt; if (g.followT > 2) rise += 12 * near; } // 同じ列でついてくる
      else g.followT = 0;
      if (d < 0 && mv < hv - 0.5) rise += 15 * near;         // 抜いたのに前でもたもた
      if (Math.abs(me.lane - me.z) > 0.05 && eff < 12) rise += 8; // 近くで急に列を変える
    } else g.followT = 0;
    if (me.gear === 4 && d > 0 && ad < 60) rise += 6;        // 走る足音
    if (her.stopT > 0) rise *= C.DISTRACT;                   // スマホに夢中で少し気づきにくい
    rise *= g.riseMul || 1;
    if (g.police && g.police.on && Math.abs(g.police.x - her.x) < 20) rise *= 0.5; // おまわりさんが近くにいると、相手は少し安心
    if (rise > 0) g.sus += rise * dt; else g.sus -= 6 * dt;
    g.sus = Math.max(0, Math.min(100, g.sus));
    g.maxSus = Math.max(g.maxSus, g.sus);
    const ti = Math.floor(g.t); g.trace[ti] = Math.max(g.trace[ti] || 0, g.sus); // 1 秒ごとの警戒度（シェアのグラフ用）

    // ふりかえる（40% と 70% をこえたとき）。近くで目が合うとさらに上がる
    if ((g.sus >= 40 && her.looks === 0) || (g.sus >= 70 && her.looks === 1)) {
      her.looks++; her.lookT = 1.2;
      const eye = eff < 15;
      if (eye) g.sus = Math.min(100, g.sus + 15);
      g.events.push({ t: g.t, kind: eye ? 'eye' : 'look' });
    }

    // ---- おまわりさん（むずかしい・犬の散歩）：「おまわりさんの目」ゲージ ----
    if (g.police) {
      const P = g.police;
      if (!P.on && g.t >= P.next && me.x + 90 < C.HOME + 20) { P.on = true; g.copMet = true; P.x = me.x + 90; P.z = C.COP_LANE; g.events.push({ t: g.t, kind: 'cop' }); }
      let crise = 0;
      if (P.on) {
        const nearHer = Math.abs(P.x - her.x) < 25;
        // 目の前（同じ列の 8 以内）に人がいたら、ベルを鳴らして止まる。それでもぶつかってきたら捕まえる
        const ahead = P.x - me.x, inLane = Math.abs(P.z - me.z) < 0.6;
        const blocked = inLane && ahead > 0 && ahead < 8;
        if (blocked && P.bellT <= 0) { P.bellT = 2; g.events.push({ t: g.t, kind: 'bell' }); }
        if (!blocked) P.x -= (nearHer ? C.COP_SLOW : C.COP_V) * dt; // 女性の近くでは自転車を押してゆっくり見回る
        if (P.bellT > 0) P.bellT -= dt;
        const cd = Math.abs(P.x - me.x);
        if (cd < C.COP_SEE) {
          if (me.gear === 4) crise += 35;                                   // 走っている
          if (mv === 0) crise += 10;                                        // 立ち止まっている
          if (Math.abs(me.lane - me.z) > 0.05) crise += 15;                 // 列をうろうろ
          const withDog = g.dog && Math.hypot(g.dog.x - me.x, (g.dog.z - me.z) * C.LANE_W) < 10; // 犬のそばにいる人は「犬をかわいがっている人」に見える
          if (!withDog && d > 0 && d < 15 && dz < 1.2) crise += 20;         // 女性のすぐ後ろ
          if (!withDog && eff < 15) crise += 30;                            // 女性に近づく男をじっと見る
        }
        if (cd < 2.5 && Math.abs(P.z - me.z) < 0.6) { finish(g, 'copbump'); return; } // ぶつかったら捕まる
        if (g.sus >= 75 && Math.abs(P.x - her.x) < 12) { finish(g, 'soudan'); return; }
        if (P.x < me.x - 40) { P.on = false; const GAP = g.copGap || C.COP_GAP; P.next = g.t + GAP[0] + g.rand() * (GAP[1] - GAP[0]); }
      }
      P.watching = crise > 0;
      g.cop = Math.max(0, Math.min(100, g.cop + (crise > 0 ? crise : -C.COP_DECAY) * dt));
      if (g.cop >= 100) { finish(g, 'shokushitsu'); return; }
    }

    // ---- 犬の散歩：犬はリードの範囲でふらふら列を変える。近づくと吠える。そばでじっとするとなつく ----
    if (g.dog) {
      const D = g.dog;
      if (g.t >= D.next) { D.tz = Math.max(0, Math.min(2, her.z + g.rand() * 1.8)); D.next = g.t + 1.5 + g.rand() * 2.5; }
      D.z += Math.sign(D.tz - D.z) * Math.min(Math.abs(D.tz - D.z), 1.2 * dt);
      D.x = her.x - 4 + Math.sin(g.t * 1.7) * 1.2; // 飼い主の少し後ろ
      if (D.cd > 0) D.cd -= dt;
      if (D.barkT > 0) D.barkT -= dt;
      const de = Math.hypot(D.x - me.x, (D.z - me.z) * C.LANE_W);
      const loud = me.gear === 4 && de < 25;
      if (!D.friend && D.cd <= 0 && (loud || (de < C.DOG_NEAR && Math.abs(D.z - me.z) < 0.6 && mv > her.v + 0.5))) { // 走る人・真後ろから近づいてくる人に吠える
        g.sus = Math.min(100, g.sus + C.DOG_BARK); D.cd = C.DOG_CD; D.barkT = 1; D.lastBark = g.t; D.barkWhy = loud ? 'run' : 'behind';
        g.maxSus = Math.max(g.maxSus, g.sus);
        g.events.push({ t: g.t, kind: 'bark' });
      }
      // 横の列からゆっくり近づいて、犬のそばにいるとなつく（合計の時間）
      if (!D.friend && me.gear <= 3 && de < 10 && g.sus < 70) { D.friendT += dt; if (D.friendT > C.DOG_FRIEND_T) { D.friend = true; g.events.push({ t: g.t, kind: 'wag' }); } }
    }

    // ---- 結末 ----
    if (ad < 2 && dz < 0.5) { finish(g, 'bump'); return; }
    if (g.coworker && ad < 4 && dz < 1.2 && g.sus < 35) { finish(g, 'coworker'); return; }
    if (g.laneMoves > C.POLICE_LANES) { finish(g, 'police'); return; }
    if (g.wasBehind && d <= 0) { g.passedRunning = me.gear === 4 && eff < 12; g.passDz = dz; } // passDz：追いこしたときの列のはなれ（ストーリーのメモ用）
    g.wasBehind = d > 0;
    if (g.sus >= 100) { finish(g, g.dog && g.t - g.dog.lastBark < 2 ? 'bark' : her.x > C.KONBINI_X - 25 && her.x < C.KONBINI_X + 40 ? 'konbini' : 'flee'); return; }
    if (-d >= C.PASS_DONE) {
      finish(g, g.dog && g.dog.friend ? 'dogfollow' : g.passedRunning ? 'dash' : g.maxSus < 8 ? 'ghost' : g.maxSus < 20 ? 'gentle' : g.maxSus < 50 ? 'pass' : 'close');
      return;
    }
    if (her.x >= C.HOME) finish(g, g.dog && g.dog.friend ? 'natsuki' : 'same');
  }

  // ---- プレイヤー名の決まり：使えない言葉 ----
  // そろえ方：全角→半角（NFKC）・小文字・カタカナ→ひらがな・すき間や記号をとる（「し ね」「シ・ネ」「ｼﾈ」も同じに見る）
  function normName(t) {
    return String(t || '').normalize('NFKC').toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s　・･\-_.,、。!！?？~〜ー―'"`*+=/\\|()（）「」【】\[\]{}<>＜＞♪☆★♡♥]/g, '');
  }
  // 一覧は「そろえたあと」の形（ひらがな・小文字）で書く
  const NG_WORDS = [
    // 悪口・おどし
    'しね', '死ね', 'ころす', '殺す', '殺してやる', 'きえろ', '消えろ', 'うざい', 'きもい', 'ぶす', 'ごみくず', 'かす',
    // 性的なこと
    'ちんこ', 'ちんぽ', 'まんこ', 'おまんこ', 'ぺにす', 'せっくす', 'えっち', 'えろ', 'おっぱい', 'ちくび', 'ふぇら', 'おなに', 'やりまん', 'やりちん',
    'sex', 'porn', 'fuck', 'dick', 'pussy', 'boobs',
    // このゲームの題材で出てきそうな犯罪の言葉
    'ちかん', '痴漢', 'へんたい', '変態', 'すとーかー', 'つきまと', 'れいぷ', '強姦', '盗撮', 'とうさつ', 'のぞき', '誘拐', 'ゆうかい', '露出狂',
    // 差別の言葉
    'がいじ', 'きちがい', '気違い', 'かたわ', 'めくら', 'つんぼ', 'しな人', '支那', 'ちょんこ', 'にがー', 'nigger', 'nigga', 'じっぷ', '部落', 'えた', 'ひにん',
    'shit', 'bitch', 'asshole', 'retard', 'kill',
    // なりすまし（作者・運営に見える名前）
    'robit', '運営', 'うんえい', '公式', 'こうしき', '開発', 'かいはつ', '管理人', 'かんりにん', 'admin', 'official', 'gm',
  ].map(normName);
  // そろえると短すぎてほかの言葉にまぎれるものは、名前ぜんたいが同じときだけ
  const NG_EXACT = ['えた', 'かす', 'gm', 'えろ', 'ぶす', 'kill'].map(normName);
  function nameOK(t) {
    const n = normName(t);
    if (!n) return true; // 空は「名無しの通行人」
    if (/https?|www|\.(com|net|jp|io)|@|#/.test(String(t).normalize('NFKC').toLowerCase())) return false; // URL・連絡先・ハッシュタグ
    if (/\d{5,}/.test(n)) return false;                                                                   // 電話番号など長い数字
    for (const w of NG_EXACT) if (n === w) return false;
    for (const w of NG_WORDS) if (!NG_EXACT.includes(w) && n.includes(w)) return false;
    return true;
  }

  function result(g) {
    const e = END_BY[g.end];
    return Object.assign({}, e, { t: Math.round(g.t), max: Math.round(g.maxSus), no: ENDINGS.indexOf(e) + 1, friend: !!(g.dog && g.dog.friend), passDz: g.passDz || 0, cop: !!g.copMet });
  }

  // ---- ストーリー「月曜から金曜の帰り道」（ほっこり）----
  // 月・火・水は同じ。水曜までの 3 晩の平均警戒度で、木・金が 2 つのルートに分かれる
  const STORY = [
    { day: '月曜日', mode: 'normal', intro: ['引っ越して 1 日目の帰り道。', '前に、女性がひとり歩いている。', '……同じ方向だ。'] },
    { day: '火曜日', mode: 'dog', opts: { noCop: true }, intro: ['今日もあの人が前にいる。', '今日は、しば犬を連れている。', '犬は、こっちをちらちら見ている。'] },
    { day: '水曜日', mode: 'hard', intro: ['このへん、最近は見回りが増えたらしい。', '自転車のおまわりさんとすれちがう。', '……べつに、悪いことはしていない。'] },
  ];
  const ROUTES = {
    nakayoshi: { name: '🌸 なかよしルート', chapters: [
      { day: '木曜日', mode: 'normal', opts: { riseMul: 0.8, phone: { gap: [6, 10], len: [2.5, 4] } }, intro: ['今日、あの人がこっちを見て、', '小さく会釈した気がする。', '……気のせいかな。今日もそっと帰ろう。'] },
      { day: '金曜日', mode: 'dog', opts: { rain: true }, intro: ['金曜日。雨が降ってきた。', 'あの人、傘を持っていないみたいだ。', '犬も、おまわりさんもいる。いつもの帰り道。'] },
    ] },
    kimazui: { name: '🌙 気まずいルート', chapters: [
      { day: '木曜日', mode: 'normal', opts: { startSus: 30, herMul: 1.15 }, intro: ['今日は、あの人の足がいつもより速い。', '……もしかして、警戒されている？', '気をつかって、気をつかって。'] },
      { day: '金曜日', mode: 'dog', opts: { copGap: [1.5, 3], copFirst: 3 }, intro: ['マンションの前に、おまわりさんが立っている。', '今日は見回りがやけに多い。', 'ここで誤解をとかないと、来週がつらい。'] },
    ] },
  };
  function storyRoute(results) {
    const first = results.slice(0, 3);
    const avg = first.reduce((a, r) => a + r.max, 0) / Math.max(1, first.length);
    return avg < 40 ? 'nakayoshi' : 'kimazui';
  }
  function storyChapter(i, route) { return i < 3 ? STORY[i] : ROUTES[route].chapters[i - 3]; }
  const STORY_LEN = 5;
  const HELLO = '「いつも、気をつかってくれてありがとうございます。同じマンションの 8 階の者です」';
  const STORY_ENDS = {
    dogwalk: { extra: true, stars: 3, head: '週末、犬の散歩をたのまれた', lines: ['マンションの前で、女性がふり返った。', HELLO, '「この子、あなたのことが好きみたいで……」', '土曜日。リードを持って、明るい道をゆっくり歩いた。'], quip: '「この子、あなたのことが好きみたいで」' },
    kasa: { stars: 3, head: '傘を貸したら、お礼にクッキーをもらった', lines: ['マンションの前で、女性がふり返った。雨はまだやまない。', HELLO, '思わず、自分の傘を差し出した。', '日曜日、ドアノブに手作りのクッキーがかかっていた。'], quip: '傘を貸したら、手作りクッキーになって返ってきた' },
    aisatsu: { stars: 2, head: '同じマンションの人とあいさつできるようになった', lines: ['マンションの前で、女性がふり返った。', HELLO, 'エレベーターで、はじめて「おやすみなさい」と言えた。', '来週からは、帰り道がちょっとだけ楽しみだ。'], quip: '「いつも、気をつかってくれてありがとうございます」' },
    gokai: { stars: 2, head: '誤解がとけた', lines: ['マンションの前で、女性がおまわりさんと話している。', 'こっちを見て、ハッとした顔をした。', '「あの……いつも後ろにいたの、同じマンションの方だったんですね」', '「ずっとこわがってて、ごめんなさい」　おまわりさんも笑っていた。'], quip: '「ずっとこわがってて、ごめんなさい」' },
    // 隠し（EXTRA）：笑える話（職質されすぎて顔なじみ）・感動する話。気まずいルートの切ない話
    warai: { extra: true, stars: 2, head: 'おまわりさんに住所を覚えられた', lines: ['マンションの前で、自転車のおまわりさんが待っていた。', '「また君か。……もう名前も住所も覚えちゃったよ」', '「5 階の人でしょ。今日は何も聞かないから、早く帰りな」', '前を歩いていた女性が、ふり返って小さく笑った。', '……職質されない日が、いちばんうれしい。'], quip: '「もう名前も住所も覚えちゃったよ」' }, // 前は「おまわりさんの奥さん」（つじつまが合わないので・2026-11-19・本人）
    imouto: { extra: true, stars: 3, head: '生き別れの妹だった', lines: ['マンションの前で、女性がふり返った。', '「あの……変なこと聞いてもいいですか。その左手のほくろ」', '「小さいころ別れたお兄ちゃんにも、同じところにあったんです」', '足もとで、しば犬がしっぽをちぎれそうなほどふっている。', '「この子、においで分かってたのかな。……おかえり、お兄ちゃん」', '同じマンションの 8 階と 5 階。こんなに近くに、いたなんて。', '月曜から、帰り道は並んで歩いている。もう、追いこさなくていい。'], quip: '「……おかえり、お兄ちゃん」' },
    kandou: { extra: true, stars: 3, head: 'あの人も、毎晩こっちを気にしていた', lines: [], quip: '「（金）今日こそ、ちゃんとお礼を言う。」' },
    // 10 個目（9 つぜんぶ見つけたあとのストーリーで出る）。番号は 10／9
    loop: { extra: true, stars: 3, head: 'この 1 週間、10 回目', title: '帰り道の 10 周目', lines: ['月曜日。引っ越して 1 日目の帰り道。', '前に、女性がひとり歩いている。', '……この帰り道、なんだか 10 回目な気がする。', '傘も、メモも、おまわりさんも、しっぽも、ぜんぶ覚えている。', '女性がふり返った。', '「……あなたも、覚えてるんですか？」'], quip: '「……あなたも、覚えてるんですか？」' },
    setsunai: { stars: 1, head: '8 階の窓に、カーテンがなかった', lines: ['マンションの前で、女性は一度も、ふり返らなかった。', '次の週から、あの人を見かけなくなった。', '掲示板に「8 階　退去のお知らせ」。', '8 階の窓に、もうカーテンはなかった。', '……帰り道が、ちょっとだけ広くなった。'], quip: '帰り道が、ちょっとだけ広くなった' },
    harigami: { stars: 1, head: '掲示板に貼り紙が出た', lines: ['マンションの前で、女性がふり返った。', '「あ……いつも後ろにいる方ですよね。……おやすみなさい」', '次の日、掲示板に「夜道は明るい道を通りましょう」の貼り紙が出た。', '……たぶん、自分のことだ。来週はもっと気をつかおう。'], quip: '掲示板の貼り紙は、たぶん自分のことだ' },
  };
  // 結末：犬になついてもらえた夜があって 3 晩以上うまく帰れたら犬の散歩（どちらのルートでも）。
  // なかよしルートは金曜にうまく帰れたら傘とクッキー、だめならあいさつ。気まずいルートは金曜にうまく帰れたら誤解がとける、だめなら貼り紙
  // 結末の番号の順（ふつう → EXTRA）と、見つけていないときに出す、ぼかしたヒント
  const STORY_ORDER = ['kasa', 'aisatsu', 'gokai', 'harigami', 'setsunai', 'dogwalk', 'warai', 'imouto', 'kandou'];
  const STORY_HINTS = {
    kasa: '雨の金曜日。やさしい道の、その先に',
    aisatsu: 'やさしい道で、金曜につまずいても',
    gokai: '気まずい道でも、金曜をうまく帰れたら',
    harigami: '気まずい道で、金曜につまずくと……',
    setsunai: '気まずい道で、最後の 2 晩とも……',
    dogwalk: 'しっぽをふってもらえたら',
    warai: '自転車のあの人と、何度も会うと',
    imouto: 'あの子は、2 度とも覚えていた',
    kandou: '5 晩とも、ずっとやさしい距離で',
  };
  STORY_ORDER.forEach((k, i) => { STORY_ENDS[k].no = i + 1; STORY_ENDS[k].hint = STORY_HINTS[k]; });
  STORY_ENDS.loop.no = STORY_ORDER.length + 1;
  // うわさ：ふつうの結果画面の下に、まだ見つけていない隠し要素のヒントを 1 つ（found：見つけた隠し要素の id）
  const UWASA = [
    { id: 'hard', text: 'うわさ：見回りが強化される夜は、タイトルも落ち着かないらしい……？' },
    { id: 'dog', text: 'うわさ：満月の夜は、犬の散歩をする人が増えるらしい……？' }, // 前の文は直接すぎた（2026-11-19・本人）
  ];
  function uwasa(found, r) { const left = UWASA.filter((u) => !found.includes(u.id)); return left.length ? left[Math.floor((r || 0) * left.length)].text : ''; }
  // 感動の結末のメモ：月〜木の夜に、その人がしたことを女性の目で書く（先に当てはまるものから。同じ書き方は 2 回使わない）
  const MEMO_DAY = ['（月）うしろに知らない人。', '（火）今日もいる。', '（水）また、あの人。', '（木）今日も。'];
  const MEMO = [
    ['friend', (r) => r.friend, 'この子が、しっぽをふっていた。犬は、うそをつかない。'],
    ['ghost', (r) => r.id === 'ghost', '気づいたら前にいた。足音が、ほとんどしなかった。'],
    ['wide', (r) => r.passDz >= 1, 'わざわざ道のはしを回って、追いこしていった。'],
    ['cop', (r) => r.cop, 'おまわりさんとすれちがっても、堂々としていた。たぶん、いい人。'],
    ['dash', (r) => r.id === 'dash', 'いきなり走って追いこしていった。……急いでたのかな。'],
    ['far', (r) => r.max < 15, 'ずっと遠くを歩いてくれていた。'],
    ['soft', () => true, 'ちょっとドキッとしたけど、そっと追いこしていった。'],
    ['kyori', () => true, 'ちょうどいい距離だった。わざと、だと思う。'],
  ];
  function storyMemo(results) {
    const used = new Set();
    return results.slice(0, 4).map((r, i) => {
      const hit = MEMO.filter(([, f]) => f(r)), m = hit.find(([k]) => !used.has(k)) || hit[hit.length - 1];
      used.add(m[0]); return MEMO_DAY[i] + m[2];
    });
  }
  function storyEnding(results, route, allFound) { // allFound：9 つぜんぶ見つけている → 10 個目
    route = route || storyRoute(results);
    const passes = results.filter((r) => PASS_ENDS.includes(r.id)).length;
    const fri = results[4], friOk = !!fri && PASS_ENDS.includes(fri.id);
    const thuOk = !!results[3] && PASS_ENDS.includes(results[3].id);
    const avg = results.reduce((a, r) => a + r.max, 0) / (results.length || 1);
    const caught = results.filter((r) => ['copbump', 'shokushitsu', 'soudan'].includes(r.id)).length;
    // 感動（5 晩とも・平均 30% 未満。水曜や犬の夜は上手でも 40〜50% になるので。ボットで上手 1.5%・うまい人 4.5%）→ 笑える → 妹 → 犬の散歩 → ルートごとの結末
    // 犬は上手に歩くと勝手になつくことがあるので、「なついて、そのまま追いこした夜」で数える（ボットで調べた・2026-11-19）
    const dogPass = results.filter((r) => r.friend && PASS_ENDS.includes(r.id)).length;
    const id = allFound ? 'loop' : passes >= 5 && avg < 30 ? 'kandou' : caught >= 2 ? 'warai' : dogPass >= 2 ? 'imouto' : dogPass >= 1 && passes >= 3 ? 'dogwalk'
      : route === 'nakayoshi' ? (friOk ? 'kasa' : 'aisatsu') : (friOk ? 'gokai' : !thuOk ? 'setsunai' : 'harigami');
    const end = Object.assign({ id, route, routeName: ROUTES[route].name, passes }, STORY_ENDS[id]);
    if (id === 'kandou') end.lines = ['マンションの前で、女性がふり返った。', '少し迷ってから、小さなメモを差し出した。'].concat(storyMemo(results), ['（金）今日こそ、ちゃんとお礼を言う。', '「……やっぱり恥ずかしいので、返してください」']);
    return end;
  }
  const dayColor = (m) => (m < 15 ? '🟩' : m < 40 ? '🟨' : m < 70 ? '🟧' : '🟥');
  function storyShare(end, results, url) {
    const days = ['月', '火', '水', '木', '金'];
    return `【オイコシタイ！ストーリー】月曜から金曜の帰り道\n` + (end.title ? `称号：${end.title}\n` : '') +
      `${end.extra ? '🌈EXTRA' : end.routeName}　結末${end.no ? ' ' + String(end.no).padStart(2, '0') + '／' + STORY_ORDER.length : ''}「${end.head}」${'★'.repeat(end.stars)}${'☆'.repeat(3 - end.stars)}\n` +
      `警戒度 ` + results.map((r, i) => days[i] + dayColor(r.max)).join(' ') + `\n` +
      `${end.quip}\n\n` +
      `▶ 気まずさを体験する\n${url}\n\n#オイコシタイ #バカゲー #個人開発`;
  }

  // 腕前ランク（クリアしたときだけ）：最大警戒度で S〜C。上手なボットで上位 1 割くらいが S（2026-11-19 にはかった）
  const SKILL = [[15, 'S'], [25, 'A'], [45, 'B'], [101, 'C']];
  // 犬の散歩で、犬になついてもらってクリアしたとき（なつかせるのは女性に近づくのでむずかしい）は、ゆるめの基準
  const SKILL_FRIEND = [[35, 'S'], [50, 'A'], [70, 'B'], [101, 'C']];
  const SKILL_NAMES = {
    normal: { S: '夜道の神', A: '気配りの達人', B: '一般通行人', C: '要注意人物' },
    hard: { S: 'おまわりさん公認', A: '職質されない人', B: '夜道の通行人', C: 'ほぼ現行犯' },
    dog: { S: '犬にも気づかれない人', A: '犬にも人にも優しい', B: '散歩コースの常連', C: '犬に顔を覚えられた' },
    dogfriend: { S: '犬語マスター', A: '犬の友だち', B: 'もふもふ好き', C: '犬にだけ好かれる人' },
  };
  function skill(mode, max, friend) {
    const key = mode === 'dog' && friend ? 'dogfriend' : mode;
    const rank = (key === 'dogfriend' ? SKILL_FRIEND : SKILL).find(([v]) => max <= v)[1];
    return { rank, name: (SKILL_NAMES[key] || SKILL_NAMES.normal)[rank] };
  }
  // 腕前ランクの基準（結果画面に出す）：[[15,'S'],[25,'A'],[45,'B']] と、次のランクまであと何 %
  function skillTable(mode, friend) { return (mode === 'dog' && friend ? SKILL_FRIEND : SKILL).filter(([, r]) => r !== 'C'); }
  function skillNext(mode, max, friend) {
    const t = skillTable(mode, friend), up = t.slice().reverse().find(([v]) => max > v);
    return up ? { rank: up[1], need: max - up[0] } : null; // null：もう S
  }

  // 警戒度の移り変わりを 8 マスの色で（🟩 平気 → 🟨 → 🟧 → 🟥 ヤバい）
  function susBar(trace) {
    const n = 8, t = (trace || []).map(v => v || 0);
    if (!t.length) return '🟩'.repeat(n);
    let out = '';
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * t.length / n), b = Math.max(a + 1, Math.floor((i + 1) * t.length / n));
      const v = Math.max(...t.slice(a, b));
      out += v < 15 ? '🟩' : v < 40 ? '🟨' : v < 70 ? '🟧' : '🟥';
    }
    return out;
  }

  // シェアする文。best：クリアのときの自己ベスト順位（1 なら「自己ベスト」）
  function shareText(r, found, url, trace, best, mode) {
    if (mode === true) mode = 'hard';
    const clear = PASS_ENDS.includes(r.id);
    return `【オイコシタイ！${mode && mode !== 'normal' ? '（' + MODES[mode] + 'モード）' : ''}】夜道で前を歩く人を追いこしたい\n` +
      (clear ? `CLEAR! ` : '') + `結末「${r.head}」${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}\n` +
      `${r.quip}\n` +
      `警戒度 ${susBar(trace)} 最大${r.max}%${clear && best === 1 ? '（自己ベスト）' : ''}\n` +
      (clear ? `腕前ランク ${skill(mode || 'normal', r.max, r.friend).rank}「${skill(mode || 'normal', r.max, r.friend).name}」\n` : '') +
      `称号：${r.title}（ED ${found}/${ENDINGS.length}）\n\n` +
      `▶ 気まずさを体験する\n${url}\n\n#オイコシタイ #バカゲー #個人開発`;
  }

  return { C, LANE_NAMES, OBST, ENDINGS, END_BY, PASS_ENDS, MODES, STORY, ROUTES, STORY_LEN, STORY_ENDS, STORY_ORDER, UWASA, uwasa, storyRoute, storyChapter, storyEnding, storyShare, MOODS, mood, herThought, rng, newGame, mySpeed, setGear, setLane, blockAt, step, result, skill, skillTable, skillNext, susBar, shareText, normName, nameOK };
});
