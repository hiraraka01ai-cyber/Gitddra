(function () {
  "use strict";
  const S = window.Skill;
  const KEY = "dm-skill-analyzer:v1";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f2 = (n) => (Number(n) || 0).toFixed(2);

  // ---------- state ----------
  let entries = load();
  // データが空のときはサンプルを表示（保存はしない）
  let isSample = false;
  let nextId = 1;
  const resetIds = () => { nextId = entries.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1; };
  resetIds();
  let sortKey = "skill", sortAsc = false;

  // 目標タブの設定（目標達成率・分類の候補・表示方法）
  const DEFAULT_TAGS = ["フルコン狙い", "外したい", "完了", "許す", "挑戦曲"];
  let settings = loadSettings();
  function loadSettings() {
    const d = { target: 97, tags: DEFAULT_TAGS.slice(), goalCat: "both", goalSort: "tag", goalAll: false };
    try {
      const v = JSON.parse(localStorage.getItem(KEY + ":settings") || "null");
      return v && typeof v === "object" ? { ...d, ...v } : d;
    } catch (_) { return d; }
  }
  function saveSettings() {
    try { localStorage.setItem(KEY + ":settings", JSON.stringify(settings)); } catch (_) {}
    if (!isSample) save(true);
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch (_) { return []; }
  }

  // ---------- クラウド保存（claude.ai 上で開いたときだけ有効） ----------
  // 保存先 data/users/<id>/scores は本人しか読み書きできない。
  const cloud = { doc: null, writing: false, dirty: false, lastJSON: null };
  async function cloudWrite() {
    if (!cloud.doc) return;
    if (cloud.writing) { cloud.dirty = true; return; }
    cloud.writing = true;
    try {
      do {
        cloud.dirty = false;
        const json = JSON.stringify({ entries, settings });
        if (json === cloud.lastJSON) break;
        await cloud.doc.set({ ...JSON.parse(json), updatedAt: Date.now() });
        cloud.lastJSON = json;
      } while (cloud.dirty);
      setSync("ok");
    } catch (e) {
      setSync("err", e && e.code === "quota_exceeded" ? "保存容量の上限に達しました" : "クラウドに保存できませんでした");
    } finally { cloud.writing = false; }
  }
  let saveTimer = null;
  function save(settingsOnly) {
    if (isSample && !settingsOnly) return;
    if (!isSample) { try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch (_) { /* 保存できない環境 */ } }
    if (cloud.doc) { setSync("saving"); clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; cloudWrite(); }, 600); }
  }
  function setSync(state, msg) {
    const el = $("#syncState");
    if (!el) return;
    const map = { local: "このブラウザに保存", saving: "保存中…", ok: "クラウドに保存済み", wait: "クラウドに接続中…", err: msg || "保存エラー" };
    el.textContent = map[state] || "";
    el.dataset.state = state;
  }
  async function initCloud() {
    setSync("local");
    if (!window.claude || typeof window.claude.use !== "function") return;
    try {
      const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
      const uid = user && (await user.id());
      if (!db || !uid) return;
      cloud.doc = db.doc("data/users/" + uid + "/scores");
      setSync("wait");
      let first = true;
      const timer = setTimeout(() => setSync("err", "クラウドに接続できません（このブラウザには保存されます）"), 10000);
      cloud.doc.onSnapshot((snap) => {
        if (snap.fromCache) return;
        clearTimeout(timer);
        const data = snap.exists ? snap.data() : null;
        const remote = data && Array.isArray(data.entries) ? data.entries : null;
        if (first) {
          first = false;
          if (remote && remote.length) applyRemote(remote, data.settings);
          else if (!isSample && entries.length) cloudWrite(); // 既存のブラウザ保存分をクラウドへ
          setSync("ok");
          return;
        }
        if (remote && !cloud.writing && !saveTimer && JSON.stringify({ entries: remote, settings: data.settings || settings }) !== JSON.stringify({ entries, settings })) applyRemote(remote, data.settings);
      }, () => { clearTimeout(timer); setSync("err", "クラウドに接続できません（このブラウザには保存されます）"); });
    } catch (_) { /* クラウド無しで動作 */ }
  }
  function applyRemote(list, remoteSettings) {
    entries = list;
    if (remoteSettings && typeof remoteSettings === "object") settings = { ...settings, ...remoteSettings };
    cloud.lastJSON = JSON.stringify({ entries, settings });
    isSample = false;
    resetIds();
    try { localStorage.setItem(KEY, JSON.stringify(entries)); localStorage.setItem(KEY + ":settings", JSON.stringify(settings)); } catch (_) {}
    render();
  }

  // ボタンを2回押して確定（ページ内で確認する）
  function confirmTap(btn, label, fn) {
    if (btn.dataset.armed) {
      clearTimeout(btn._t);
      btn.textContent = btn.dataset.orig;
      delete btn.dataset.armed;
      fn();
      return;
    }
    btn.dataset.orig = btn.textContent;
    btn.dataset.armed = "1";
    btn.textContent = label;
    btn._t = setTimeout(() => { btn.textContent = btn.dataset.orig; delete btn.dataset.armed; }, 4000);
  }

  function leaveSample() {
    if (!isSample) return;
    isSample = false;
    entries = [];
  }

  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  // 曲名（途中で切れた名前も可）から既存の譜面を探す。複数あればスキルが一番高い譜面
  function findSong(name) {
    const n = norm(name).replace(/[…．.]+$/, "");
    let hits = entries.filter((x) => norm(x.song) === n);
    if (!hits.length && n.length >= 3) {
      const pre = entries.filter((x) => norm(x.song).startsWith(n));
      if (new Set(pre.map((x) => norm(x.song))).size === 1) hits = pre;
    }
    if (!hits.length) return null;
    return hits.reduce((b, x) => (S.chartSkill(x.level, x.rate) > S.chartSkill(b.level, b.rate) ? x : b));
  }

  function addEntries(list, replace) {
    leaveSample();
    if (replace) entries = [];
    const result = { added: 0, updated: 0, missed: [] };
    for (const e of list) {
      if (e.meta) {
        const hit = findSong(e.song);
        if (!hit) { result.missed.push(e.song); continue; }
        if (e.diff) hit.diff = e.diff;
        if (e.tag) hit.tag = e.tag;
        if (e.hot != null) hit.hot = e.hot;
        result.updated++;
        continue;
      }
      // 同じ曲・同じ譜面は上書き（高い方を残す）
      const dup = entries.find((x) => x.song.trim().toLowerCase() === e.song.trim().toLowerCase() && x.diff === e.diff);
      if (dup) {
        dup.level = e.level;
        dup.rate = Math.max(Number(dup.rate) || 0, Number(e.rate) || 0);
        dup.hot = e.hot;
        if (e.tag) dup.tag = e.tag;
        result.updated++;
      } else {
        entries.push({ id: nextId++, song: e.song, diff: e.diff, level: Number(e.level), rate: Number(e.rate), hot: !!e.hot, ...(e.tag ? { tag: e.tag } : {}) });
        result.added++;
      }
    }
    save();
    render();
    return result;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  const colorClass = (c) => c.css.split(" ").map((x, i) => (i === 0 ? "c-" + x : x)).join(" ");
  const diffTag = (d) => `<span class="diff d-${esc(d)}">${esc(d)}</span>`;
  const rankTag = (r) => `<span class="rank r-${r}">${r}</span>`;

  // ---------- render ----------
  function render() {
    $("#sampleBanner").hidden = !isSample;
    const a = S.analyze(entries);
    renderHeader(a);
    renderOverview(a);
    renderGoal(a);
    renderScores(a);
    renderSuggest(a);
    renderCalc(a);
    $("#songList").innerHTML = [...new Set(entries.map((e) => e.song))].map((s) => `<option value="${esc(s)}">`).join("");
  }

  function renderHeader(a) {
    $("#totalValue").textContent = f2(a.total);
    $("#totalValue").className = "total-value " + colorClass(a.color);
    const chip = $("#colorChip");
    chip.textContent = a.color.name;
    chip.className = "chip " + colorClass(a.color);
    if (a.next) {
      const need = a.next.min - a.total;
      $("#nextInfo").textContent = `次の「${a.next.name}」まで あと ${f2(need)}`;
      const span = a.next.min - a.color.min;
      $("#nextBar").style.width = Math.max(0, Math.min(100, ((a.total - a.color.min) / span) * 100)) + "%";
    } else {
      $("#nextInfo").textContent = "最高ランク到達";
      $("#nextBar").style.width = "100%";
    }
  }

  function catPanel(prefix, c) {
    $(`#${prefix}Filled`).textContent = `${c.filled}/${S.SLOTS} 曲`;
    $(`#${prefix}Total`).textContent = f2(c.total);
    $(`#${prefix}Border`).textContent = c.filled < S.SLOTS ? "空きあり" : f2(c.border);
    $(`#${prefix}Avg`).textContent = c.filled ? f2(c.total / c.filled) : "-";
    $(`#${prefix}List`).innerHTML = c.counted.length
      ? c.counted.map((s) => `<li><span class="name" title="${esc(s.song)}">${esc(s.song)}</span><span class="meta">${diffTag(s.diff)} ${f2(s.level)} / ${f2(s.rate)}% ${rankTag(s.rank)}</span><span class="sk">${f2(s.skill)}</span></li>`).join("")
      : `<li class="empty">まだ登録がありません。「スコア」タブから追加してください。</li>`;
  }

  function hbars(el, rows) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    el.innerHTML = rows.length
      ? rows.map((r) => `<div class="hbar"><span class="lab">${esc(r.label)}</span><span class="track"><span class="fill" style="width:${(r.value / max) * 100}%;${r.color ? "background:" + r.color : ""}"></span></span><span class="val">${esc(r.text)}</span></div>`).join("")
      : `<p class="hint">データなし</p>`;
  }

  function renderOverview(a) {
    catPanel("hot", a.hot);
    catPanel("other", a.other);

    const dist = S.levelDistribution(a.songs);
    hbars($("#levelChart"), dist.map((d) => ({ label: d.band.toFixed(1) + "〜", value: d.count, text: `${d.count}曲 / 平均${d.avgRate.toFixed(1)}%` })));

    const rankColors = { SS: "#ffcf3c", S: "#ff8f3c", A: "#3ccf8e", B: "#4aa3ff", C: "#8b91a5" };
    const rc = { SS: 0, S: 0, A: 0, B: 0, C: 0 };
    a.songs.forEach((s) => rc[s.rank]++);
    hbars($("#rankChart"), Object.keys(rc).map((k) => ({ label: k, value: rc[k], text: `${rc[k]}曲`, color: rankColors[k] })));

    $("#insights").innerHTML = insights(a).map((t) => `<li>${t}</li>`).join("") || "<li>データを追加すると傾向を表示します。</li>";
  }

  function insights(a) {
    const out = [];
    if (!a.songs.length) return out;
    for (const [name, c] of [["HOT", a.hot], ["OTHER", a.other]]) {
      if (c.filled < S.SLOTS) {
        out.push(`${name} 枠が <b>${S.SLOTS - c.filled}</b> 曲分空いています。どんな曲でも登録するだけでスキルが伸びます。`);
      }
    }
    const counted = [...a.hot.counted, ...a.other.counted];
    if (counted.length) {
      const avgLv = counted.reduce((s, c) => s + Number(c.level), 0) / counted.length;
      const avgRate = counted.reduce((s, c) => s + Number(c.rate), 0) / counted.length;
      out.push(`対象曲の平均は レベル <b>${avgLv.toFixed(2)}</b> / 達成率 <b>${avgRate.toFixed(2)}%</b>。`);
      if (avgRate >= 90) out.push("達成率は十分高いので、より高いレベルの譜面に挑戦するのが効率的です。");
      else if (avgRate < 80) out.push("達成率が伸びやすい位置です。今の譜面を詰めると効率よくスキルが上がります。");
      const hotShare = a.total ? (a.hot.total / a.total) * 100 : 0;
      out.push(`総スキルのうち HOT が <b>${hotShare.toFixed(1)}%</b>、OTHER が <b>${(100 - hotShare).toFixed(1)}%</b>。`);
      if (a.hot.filled === S.SLOTS && a.other.filled === S.SLOTS) {
        const weaker = a.hot.border < a.other.border ? "HOT" : "OTHER";
        out.push(`ボーダーが低いのは <b>${weaker}</b> 側（${f2(Math.min(a.hot.border, a.other.border))}）。こちらの方が新しい曲で入れ替えやすいです。`);
      }
    }
    const ceiling = a.charts.filter((c) => c.counted && Number(c.rate) < 100).reduce((s, c) => s + (S.chartSkill(c.level, 100) - c.skill), 0);
    if (ceiling > 0) out.push(`今の対象曲をすべて100%にした場合の伸びしろ: <b>+${f2(ceiling)}</b>`);
    return out;
  }

  function renderScores(a) {
    const q = $("#filter").value.trim().toLowerCase();
    const cf = $("#catFilter").value;
    let rows = a.charts.filter((c) => {
      if (q && !c.song.toLowerCase().includes(q)) return false;
      if (cf === "HOT" && !c.hot) return false;
      if (cf === "OTHER" && c.hot) return false;
      if (cf === "counted" && !c.counted) return false;
      if (cf === "uncounted" && c.counted) return false;
      return true;
    });
    const rankOrder = { SS: 5, S: 4, A: 3, B: 2, C: 1 };
    const diffOrder = { BAS: 1, ADV: 2, EXT: 3, MAS: 4 };
    rows.sort((x, y) => {
      let vx = x[sortKey], vy = y[sortKey];
      if (sortKey === "rank") { vx = rankOrder[vx]; vy = rankOrder[vy]; }
      if (sortKey === "diff") { vx = diffOrder[vx]; vy = diffOrder[vy]; }
      if (sortKey === "hot") { vx = +!!vx; vy = +!!vy; }
      let r = typeof vx === "string" ? vx.localeCompare(vy, "ja") : (Number(vx) || 0) - (Number(vy) || 0);
      if (!r) r = y.skill - x.skill;
      return sortAsc ? r : -r;
    });
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.sort === sortKey);
      th.classList.toggle("asc", th.dataset.sort === sortKey && sortAsc);
    });
    $("#countInfo").textContent = `${rows.length} / ${a.charts.length} 譜面`;
    $("#scoreBody").innerHTML = rows.map((c) => `
      <tr data-id="${c.id}" class="${c.counted ? "" : "dim"}">
        <td class="song" title="${esc(c.song)}"><span contenteditable="plaintext-only" data-field="song">${esc(c.song)}</span></td>
        <td><select data-field="diff" class="inline">${S.DIFFS.map((d) => `<option${d === c.diff ? " selected" : ""}>${d}</option>`).join("")}</select></td>
        <td class="num"><span contenteditable="plaintext-only" data-field="level" inputmode="decimal">${f2(c.level)}</span></td>
        <td class="num"><span contenteditable="plaintext-only" data-field="rate" inputmode="decimal">${f2(c.rate)}</span></td>
        <td>${rankTag(c.rank)}</td>
        <td class="num"><b>${f2(c.skill)}</b></td>
        <td><span class="tag ${c.hot ? "hot" : "other"}" data-toggle="hot" title="クリックで切替">${c.hot ? "HOT" : "OTHER"}</span>${c.counted ? ' <span class="tag on">対象</span>' : ""}</td>
        <td><button class="del" data-del="${c.id}" title="削除">✕</button></td>
      </tr>`).join("") || `<tr><td colspan="8" class="hint">該当なし</td></tr>`;
    document.querySelectorAll("#scoreBody select.inline").forEach((s) => (s.style.width = "auto"));
  }

  // ---------- 目標タブ ----------
  const potClass = (p) => (p >= 20 ? "pot-hi" : p >= 10 ? "pot-mid" : "pot-lo");
  function tagClass(tag) {
    const i = settings.tags.indexOf(tag);
    return tag ? "tg tg-" + (i < 0 ? "x" : i % 6) : "tg tg-none";
  }
  function renderGoal(a) {
    const target = Math.min(100, Math.max(0, Number(settings.target) || 97));
    $("#goalTarget").value = target;
    $("#goalCat").value = settings.goalCat;
    $("#goalSort").value = settings.goalSort;
    $("#goalAll").checked = !!settings.goalAll;
    $("#goalTags").value = settings.tags.join("、");
    $("#goalTargetHead").textContent = target + "%のスキル";

    const pick = (cat, hot) => (settings.goalAll ? cat.list : cat.counted).map((s, i) => ({ ...s, no: i + 1, catName: hot ? "HOT" : "OTHER" }));
    let rows = [];
    if (settings.goalCat !== "OTHER") rows = rows.concat(pick(a.hot, true));
    if (settings.goalCat !== "HOT") rows = rows.concat(pick(a.other, false));
    rows.forEach((r) => {
      r.goalSkill = S.chartSkill(r.level, target);
      r.pot = Math.round((r.goalSkill - r.skill) * 100) / 100;
    });
    const tagOrder = (t) => { const i = settings.tags.indexOf(t); return t ? (i < 0 ? 98 : i) : 99; };
    if (settings.goalSort === "tag") rows.sort((x, y) => tagOrder(x.tag) - tagOrder(y.tag) || x.pot - y.pot);
    else if (settings.goalSort === "pot") rows.sort((x, y) => y.pot - x.pot);
    else rows.sort((x, y) => y.skill - x.skill);

    const both = settings.goalCat === "both";
    const tagOptions = (cur) => `<option value="">未分類</option>` + [...new Set(settings.tags.concat(cur && !settings.tags.includes(cur) ? [cur] : []))]
      .map((t) => `<option value="${esc(t)}"${t === cur ? " selected" : ""}>${esc(t)}</option>`).join("");
    $("#goalBody").innerHTML = rows.map((r) => `
      <tr data-id="${r.id}" class="${r.counted ? "" : "dim"}">
        <td class="num muted g-no">${r.no}</td>
        <td class="song g-song dc-${esc(r.diff)}" title="${esc(r.song)}（${esc(r.diff)}）">${esc(r.song)}${both ? ` <span class="tag ${r.hot ? "hot" : ""}">${r.catName}</span>` : ""}</td>
        <td class="num g-lv" data-l="Lv">${f2(r.level)}</td>
        <td class="num g-rate" data-l="達成率">${f2(r.rate)}% ${rankTag(r.rank)}</td>
        <td class="num g-skill" data-l="スキル"><b>${f2(r.skill)}</b></td>
        <td class="num g-goal" data-l="${target}%">${f2(r.goalSkill)}</td>
        <td class="g-tag"><select class="${tagClass(r.tag)}" data-tag-for="${r.id}" aria-label="分類">${tagOptions(r.tag || "")}</select></td>
        <td class="num g-pot"><span class="pot ${potClass(r.pot)}">${r.pot > 0 ? "+" : ""}${f2(r.pot)}</span></td>
      </tr>`).join("") || `<tr><td colspan="8" class="hint">スキル対象曲がありません。「データ」タブから取り込んでください。</td></tr>`;

    // 分類ごとの集計（伸びしろはプラスの分だけ合計）
    const groups = new Map();
    for (const r of rows) {
      const k = r.tag || "";
      const g = groups.get(k) || { n: 0, pot: 0 };
      g.n++; g.pot += Math.max(0, r.pot);
      groups.set(k, g);
    }
    const total = rows.reduce((s, r) => s + Math.max(0, r.pot), 0);
    const keys = [...groups.keys()].sort((x, y) => tagOrder(x) - tagOrder(y));
    $("#goalSummary").innerHTML =
      `<div class="gsum-total"><span class="k">全曲を${target}%にしたときの伸びしろ</span><span class="v">+${f2(total)}</span></div>` +
      keys.map((k) => `<div class="gsum"><span class="${tagClass(k)} chip-tag">${esc(k || "未分類")}</span><span>${groups.get(k).n}曲</span><span class="gain">+${f2(groups.get(k).pot)}</span></div>`).join("");
  }

  function renderSuggest(a) {
    const step = Number($("#stepInput").value) || 2;
    const list = S.suggestions(entries, { step }).slice(0, 40);
    $("#suggestBody").innerHTML = list.map((s) => `
      <tr><td class="song" title="${esc(s.song)}">${esc(s.song)}</td><td>${diffTag(s.diff)}</td><td class="num">${f2(s.level)}</td>
      <td class="num">${f2(s.rate)}%</td><td class="num">${f2(s.target)}% ${rankTag(S.rankOf(s.target))}</td><td class="num">+${f2(s.effort)}%</td>
      <td class="num gain">+${f2(s.gain)}</td><td class="num">${f2(s.efficiency)}</td></tr>`).join("")
      || `<tr><td colspan="8" class="hint">提案できる譜面がありません。スコアを登録してください。</td></tr>`;

    const levels = [];
    for (let lv = 9.9; lv >= 5.0; lv = Math.round((lv - 0.3) * 100) / 100) levels.push(Math.round(lv * 100) / 100);
    const rateFor = (border, lv) => {
      const r = S.rateFor(lv, border + 0.01);
      return r == null ? "—" : f2(r) + "%";
    };
    $("#borderBody").innerHTML = levels.map((lv) => `
      <tr><td class="num">${f2(lv)}</td>
      <td class="num">${a.hot.filled < S.SLOTS ? "空きあり" : rateFor(a.hot.border, lv)}</td>
      <td class="num">${a.other.filled < S.SLOTS ? "空きあり" : rateFor(a.other.border, lv)}</td>
      <td class="num">${f2(S.chartSkill(lv, 100))}</td></tr>`).join("");
  }

  function renderCalc(a) {
    const cl = Number($("#cLevel").value), cr = Number($("#cRate").value);
    $("#cResult").innerHTML = `${f2(S.chartSkill(cl, cr))} <small>${rankTag(S.rankOf(cr))}</small>`;
    const rl = Number($("#rLevel").value), rs = Number($("#rSkill").value);
    const need = S.rateFor(rl, rs);
    $("#rResult").innerHTML = need == null ? `届きません <small>(最大 ${f2(S.chartSkill(rl, 100))})</small>` : `${f2(need)}% <small>${rankTag(S.rankOf(need))}</small>`;

    const tInput = $("#tTarget");
    if (!tInput.value && a.next) tInput.placeholder = String(a.next.min);
    const target = Number(tInput.value || tInput.placeholder) || 0;
    const t = S.toTarget(entries, target);
    if (!target) $("#tResult").innerHTML = "";
    else if (!t.need) $("#tResult").innerHTML = `<b>達成済み</b>（現在 ${f2(t.current)}）`;
    else {
      const slots = S.SLOTS * 2;
      const perSong = t.need / slots;
      const top = S.suggestions(entries, { step: 2 });
      let acc = 0; const picks = []; const used = new Set();
      for (const s of top) {
        if (used.has(s.id)) continue;
        used.add(s.id); picks.push(s); acc += s.gain;
        if (acc >= t.need || picks.length >= 8) break;
      }
      $("#tResult").innerHTML = `
        あと <b>${f2(t.need)}</b>（現在 ${f2(t.current)}）。全${slots}枠で均等に伸ばすなら 1曲あたり <b>+${f2(perSong)}</b>。
        ${picks.length ? `<div class="hint">増分の大きい順に取り組んだ場合（目安、合計 +${f2(acc)}）:</div><ul>${picks.map((p) => `<li>${esc(p.song)} ${diffTag(p.diff)} ${f2(p.rate)}% → ${f2(p.target)}% で <span class="gain">+${f2(p.gain)}</span></li>`).join("")}</ul>` : ""}`;
    }

    $("#colorTable").innerHTML = [...S.COLORS].reverse().map((c) =>
      `<div class="${c === a.color ? "cur" : ""}"><span class="chip ${colorClass(c)}">${c.name}</span><span>${c.min}〜</span></div>`).join("");
  }

  // ---------- events ----------
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
    try { localStorage.setItem(KEY + ":tab", b.dataset.tab); } catch (_) {}
  }));
  try {
    const t = localStorage.getItem(KEY + ":tab");
    const btn = t && document.querySelector(`.tabs button[data-tab="${t}"]`);
    if (btn) btn.click();
  } catch (_) {}

  const form = $("#addForm");
  const updatePreview = () => {
    const lv = form.level.value, r = form.rate.value;
    $("#addPreview").innerHTML = lv && r ? `スキル <b>${f2(S.chartSkill(lv, r))}</b> ${rankTag(S.rankOf(r))}` : "スキル -";
  };
  form.addEventListener("input", updatePreview);
  form.song.addEventListener("change", () => {
    const hit = entries.find((e) => e.song === form.song.value);
    if (hit) form.cat.value = hit.hot ? "HOT" : "OTHER";
  });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const e = { song: form.song.value.trim(), diff: form.diff.value, level: parseFloat(form.level.value), rate: parseFloat(form.rate.value), hot: form.cat.value === "HOT" };
    if (!e.song || !(e.level > 0) || !(e.rate >= 0) || e.rate > 100) return toast("入力内容を確認してください");
    const before = isSample ? 0 : S.analyze(entries).total;
    addEntries([e]);
    const diff = S.analyze(entries).total - before;
    toast(diff > 0 ? `追加しました（総スキル +${f2(diff)}）` : "追加しました");
    form.song.value = ""; form.rate.value = "";
    updatePreview();
    form.song.focus();
  });

  $("#filter").addEventListener("input", () => renderScores(S.analyze(entries)));
  $("#catFilter").addEventListener("change", () => renderScores(S.analyze(entries)));
  document.querySelectorAll("th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    if (sortKey === th.dataset.sort) sortAsc = !sortAsc;
    else { sortKey = th.dataset.sort; sortAsc = th.dataset.sort === "song"; }
    renderScores(S.analyze(entries));
  }));

  const body = $("#scoreBody");
  // サンプルを直接編集した場合は、そのまま自分のデータとして扱う
  const adopt = () => { if (isSample) { isSample = false; } };
  const rowEntry = (el) => entries.find((e) => e.id === Number(el.closest("tr").dataset.id));
  body.addEventListener("click", (ev) => {
    const del = ev.target.closest("[data-del]");
    if (del) {
      const e = rowEntry(del);
      adopt();
      entries = entries.filter((x) => x !== e);
      save(); render(); toast(`「${e.song}」を削除しました`);
      return;
    }
    const tg = ev.target.closest("[data-toggle]");
    if (tg) {
      const e = rowEntry(tg);
      // 同じ曲の全譜面をまとめて切り替える
      const key = e.song.trim().toLowerCase();
      const nv = !e.hot;
      adopt();
      entries.forEach((x) => { if (x.song.trim().toLowerCase() === key) x.hot = nv; });
      save(); render();
    }
  });
  body.addEventListener("change", (ev) => {
    if (ev.target.dataset.field === "diff") {
      adopt();
      rowEntry(ev.target).diff = ev.target.value;
      save(); render();
    }
  });
  body.addEventListener("keydown", (ev) => {
    if (ev.target.isContentEditable && ev.key === "Enter") { ev.preventDefault(); ev.target.blur(); }
  });
  body.addEventListener("focusout", (ev) => {
    const el = ev.target;
    if (!el.isContentEditable) return;
    const e = rowEntry(el);
    if (!e) return;
    adopt();
    const f = el.dataset.field;
    const txt = el.textContent.trim();
    if (f === "song") { if (txt) e.song = txt; }
    else {
      const v = parseFloat(txt.replace("%", ""));
      if (isFinite(v) && v >= 0 && (f !== "rate" || v <= 100) && (f !== "level" || v <= 10)) e[f] = v;
      else toast("数値が正しくありません");
    }
    save(); render();
  });

  $("#stepInput").addEventListener("input", () => renderSuggest(S.analyze(entries)));

  // 目標タブ
  const goalSet = (k, v) => { settings[k] = v; saveSettings(); renderGoal(S.analyze(entries)); };
  $("#goalTarget").addEventListener("change", (ev) => {
    const v = parseFloat(ev.target.value);
    if (v > 0 && v <= 100) goalSet("target", Math.round(v * 100) / 100); else { toast("目標達成率は 0〜100 で入力してください"); renderGoal(S.analyze(entries)); }
  });
  $("#goalCat").addEventListener("change", (ev) => goalSet("goalCat", ev.target.value));
  $("#goalSort").addEventListener("change", (ev) => goalSet("goalSort", ev.target.value));
  $("#goalAll").addEventListener("change", (ev) => goalSet("goalAll", ev.target.checked));
  $("#goalTags").addEventListener("change", (ev) => {
    const tags = ev.target.value.split(/[、,，\n]/).map((t) => t.trim()).filter(Boolean);
    if (!tags.length) return toast("分類を1つ以上入力してください");
    goalSet("tags", [...new Set(tags)]);
    toast("分類の候補を更新しました");
  });
  $("#goalBody").addEventListener("change", (ev) => {
    const id = ev.target.dataset.tagFor;
    if (!id) return;
    const e = entries.find((x) => x.id === Number(id));
    if (!e) return;
    if (isSample) isSample = false;
    if (ev.target.value) e.tag = ev.target.value; else delete e.tag;
    save();
    render();
  });
  ["#cLevel", "#cRate", "#rLevel", "#rSkill", "#tTarget"].forEach((s) => $(s).addEventListener("input", () => renderCalc(S.analyze(entries))));

  // データ
  $("#importFile").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (file) $("#importText").value = await file.text();
  });
  $("#importBtn").addEventListener("click", () => {
    const list = S.fromCSV($("#importText").value);
    if (!list.length) return toast("読み込めるデータがありません");
    const replace = $("#importReplace").checked;
    const go = () => {
      const r = addEntries(list, replace);
      $("#importText").value = "";
      const parts = [];
      if (r.added) parts.push(`${r.added} 件追加`);
      if (r.updated) parts.push(`${r.updated} 件更新`);
      toast((parts.join("・") || "変更なし") + (r.missed.length ? `（見つからない曲 ${r.missed.length} 件）` : ""));
      $("#importMissed").hidden = !r.missed.length;
      $("#importMissed").textContent = r.missed.length ? "見つからなかった曲: " + r.missed.join(" / ") : "";
    };
    if (replace && entries.length && !isSample) confirmTap($("#importBtn"), `${entries.length}件を置き換え？もう一度押す`, go);
    else go();
  });
  // claude.ai 上では downloads 機能、それ以外では通常のダウンロード
  const embedded = (() => { try { return window.self !== window.top; } catch (_) { return true; } })();
  let downloads = null;
  if (embedded) $("#exportBtn").hidden = true;
  if (window.claude && typeof window.claude.use === "function") {
    window.claude.use("downloads").then((d) => { downloads = d; if (d) $("#exportBtn").hidden = false; }).catch(() => {});
  }
  $("#exportBtn").addEventListener("click", async () => {
    const filename = `dm-skill-${new Date().toISOString().slice(0, 10)}.csv`;
    const text = "\uFEFF" + S.toCSV(entries);
    if (downloads) {
      try { await downloads.save({ filename, data: text }); }
      catch (e) { if (e && e.code !== "declined") toast("ダウンロードできませんでした。「CSV をコピー」を使ってください"); }
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#copyBtn").addEventListener("click", () => {
    const csv = S.toCSV(entries);
    const fallback = () => { const t = $("#importText"); t.value = csv; t.focus(); t.select(); toast("テキスト欄に出力しました。選択してコピーしてください"); };
    try { navigator.clipboard.writeText(csv).then(() => toast("コピーしました"), fallback); }
    catch (_) { fallback(); }
  });
  $("#sampleBtn").addEventListener("click", () => {
    if (isSample) return toast("すでにサンプルを表示中です");
    const go = () => { showSample(); toast("サンプルを表示しています（保存はされません）"); };
    if (entries.length) confirmTap($("#sampleBtn"), "サンプルを表示？もう一度押す", go);
    else go();
  });
  $("#sampleExit").addEventListener("click", () => {
    isSample = false;
    entries = cloud.lastJSON ? JSON.parse(cloud.lastJSON) : load();
    resetIds();
    render();
    document.querySelector('.tabs button[data-tab="data"]').click();
  });
  $("#clearBtn").addEventListener("click", () => {
    if (!entries.length) return;
    confirmTap($("#clearBtn"), "本当に全部削除？もう一度押す", () => {
      leaveSample(); entries = []; save(); render(); toast("削除しました");
    });
  });

  function showSample() {
    entries = sampleData().map((e, i) => ({ id: i + 1, ...e }));
    isSample = true;
    resetIds();
    render();
  }

  // 架空の曲名で作るサンプル（乱数は固定シード）
  function sampleData() {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const words = ["Crimson", "Thunder", "Blue", "Night", "Rhythm", "Pulse", "Storm", "Neon", "Echo", "Drive", "Phantom", "Velocity", "Shine", "Burst", "Gravity", "Orbit"];
    const out = [];
    for (let i = 0; i < 70; i++) {
      const name = `${words[Math.floor(rnd() * words.length)]} ${words[Math.floor(rnd() * words.length)]} ${i + 1}`;
      const level = Math.round((5.5 + rnd() * 3.8) * 100) / 100;
      const rate = Math.round(Math.min(99.5, Math.max(55, 96 - (level - 5.5) * 6 + (rnd() - 0.5) * 18)) * 100) / 100;
      const diff = level > 8.6 ? "MAS" : level > 6.5 ? "EXT" : "ADV";
      out.push({ song: name, diff, level, rate, hot: i < 32 });
    }
    return out;
  }

  // ブックマークレット
  const TOOL_URL = embedded ? "https://claude.ai/artifact/QzcKjqqxgD5ZNfkTp2MVnn" : location.href.split("#")[0];
  const bmURL = window.DMBookmarklet ? window.DMBookmarklet.bookmarkletURL(TOOL_URL) : "";
  if (bmURL) {
    const link = $("#bmLink");
    link.setAttribute("href", bmURL);
    link.addEventListener("click", (ev) => { ev.preventDefault(); toast("ブックマークバーにドラッグして登録してください"); });
    $("#bmCopy").addEventListener("click", () => {
      const t = $("#bmCode");
      t.value = bmURL;
      t.hidden = false;
      const fallback = () => { t.focus(); t.select(); toast("表示されたコードを選択してコピーしてください"); };
      try { navigator.clipboard.writeText(bmURL).then(() => toast("コードをコピーしました"), fallback); }
      catch (_) { fallback(); }
    });
  } else $("#bmPanel").hidden = true;

  if (!entries.length) showSample();
  else render();
  initCloud();
})();
