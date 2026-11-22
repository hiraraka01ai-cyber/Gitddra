(function () {
  "use strict";
  const S = window.Skill;
  const KEY = "dm-skill-analyzer:v1";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f2 = (n) => (Number(n) || 0).toFixed(2);

  // ---------- state ----------
  let entries = load();
  let nextId = entries.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
  let sortKey = "skill", sortAsc = false;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch (_) { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch (_) { /* 保存できない環境 */ }
  }
  function addEntries(list, replace) {
    if (replace) entries = [];
    for (const e of list) {
      // 同じ曲・同じ譜面は上書き（高い方を残す）
      const dup = entries.find((x) => x.song.trim().toLowerCase() === e.song.trim().toLowerCase() && x.diff === e.diff);
      if (dup) {
        dup.level = e.level;
        dup.rate = Math.max(Number(dup.rate) || 0, Number(e.rate) || 0);
        dup.hot = e.hot;
      } else entries.push({ id: nextId++, song: e.song, diff: e.diff, level: Number(e.level), rate: Number(e.rate), hot: !!e.hot });
    }
    save();
    render();
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
    const a = S.analyze(entries);
    renderHeader(a);
    renderOverview(a);
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
    const before = S.analyze(entries).total;
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
  const rowEntry = (el) => entries.find((e) => e.id === Number(el.closest("tr").dataset.id));
  body.addEventListener("click", (ev) => {
    const del = ev.target.closest("[data-del]");
    if (del) {
      const e = rowEntry(del);
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
      entries.forEach((x) => { if (x.song.trim().toLowerCase() === key) x.hot = nv; });
      save(); render();
    }
  });
  body.addEventListener("change", (ev) => {
    if (ev.target.dataset.field === "diff") {
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
    if (replace && entries.length && !confirm(`既存の ${entries.length} 件を置き換えます。よろしいですか？`)) return;
    addEntries(list, replace);
    $("#importText").value = "";
    toast(`${list.length} 件を取り込みました`);
  });
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob(["﻿" + S.toCSV(entries)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dm-skill-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#copyBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(S.toCSV(entries)); toast("コピーしました"); }
    catch (_) { $("#importText").value = S.toCSV(entries); toast("テキスト欄に出力しました"); }
  });
  $("#sampleBtn").addEventListener("click", () => {
    if (entries.length && !confirm("現在のデータにサンプルを追加します。よろしいですか？")) return;
    addEntries(sampleData());
    toast("サンプルを読み込みました");
  });
  $("#clearBtn").addEventListener("click", () => {
    if (!entries.length) return;
    if (!confirm("すべてのスコアを削除します。よろしいですか？")) return;
    entries = []; save(); render(); toast("削除しました");
  });

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

  render();
})();
