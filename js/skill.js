/*
 * DrumMania (GITADORA) スキル計算ロジック
 * ブラウザでは window.Skill、Node では require() で利用できる。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Skill = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 1カテゴリで集計される曲数（HOT / OTHER それぞれ）
  const SLOTS = 25;

  const DIFFS = ["BAS", "ADV", "EXT", "MAS"];

  // 達成率ランク（下限 %）
  const RANKS = [
    { name: "SS", min: 95 },
    { name: "S", min: 80 },
    { name: "A", min: 73 },
    { name: "B", min: 63 },
    { name: "C", min: 0 },
  ];

  // スキル色（下限値）。バージョンによって変わる場合はここを編集する。
  const COLORS = [
    { min: 8500, name: "虹", css: "rainbow" },
    { min: 8000, name: "金", css: "gold" },
    { min: 7500, name: "銀", css: "silver" },
    { min: 7000, name: "銅", css: "bronze" },
    { min: 6500, name: "赤グラ", css: "red grad" },
    { min: 6000, name: "赤", css: "red" },
    { min: 5500, name: "紫グラ", css: "purple grad" },
    { min: 5000, name: "紫", css: "purple" },
    { min: 4500, name: "青グラ", css: "blue grad" },
    { min: 4000, name: "青", css: "blue" },
    { min: 3500, name: "緑グラ", css: "green grad" },
    { min: 3000, name: "緑", css: "green" },
    { min: 2500, name: "黄グラ", css: "yellow grad" },
    { min: 2000, name: "黄", css: "yellow" },
    { min: 1500, name: "橙グラ", css: "orange grad" },
    { min: 1000, name: "橙", css: "orange" },
    { min: 0, name: "白", css: "white" },
  ];

  const floor2 = (v) => Math.floor(v * 100 + 1e-6) / 100;

  /** 1譜面のスキル値 = 難易度 × 達成率(%) × 0.2（小数第2位で切り捨て） */
  function chartSkill(level, rate) {
    const lv = Number(level);
    const r = Number(rate);
    if (!isFinite(lv) || !isFinite(r) || lv <= 0 || r <= 0) return 0;
    return floor2(lv * Math.min(r, 100) * 0.2);
  }

  /** 指定スキル値に届くのに必要な達成率(%)。100%でも届かなければ null */
  function rateFor(level, targetSkill) {
    const lv = Number(level);
    if (!(lv > 0)) return null;
    // 切り捨て誤差を避けるため 0.01% 単位で切り上げ
    let r = Math.ceil((targetSkill / (lv * 0.2)) * 100 - 1e-6) / 100;
    while (r <= 100 && chartSkill(lv, r) < targetSkill) r = Math.round((r + 0.01) * 100) / 100;
    if (r > 100) return null;
    return Math.max(r, 0.01);
  }

  function rankOf(rate) {
    const r = Number(rate) || 0;
    return RANKS.find((k) => r >= k.min).name;
  }

  function colorOf(total) {
    return COLORS.find((c) => total >= c.min);
  }

  function nextColor(total) {
    for (let i = COLORS.length - 1; i >= 0; i--) {
      if (COLORS[i].min > total) return COLORS[i];
    }
    return null;
  }

  function normalizeName(s) {
    return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  /**
   * スコア一覧を集計する。
   * entry: { id, song, diff, level, rate, hot(boolean) }
   * 同じ曲は最もスキル値の高い譜面だけが対象になる。
   */
  function analyze(entries) {
    const charts = entries
      .filter((e) => e && String(e.song || "").trim() !== "")
      .map((e) => ({ ...e, skill: chartSkill(e.level, e.rate), rank: rankOf(e.rate) }));

    // 曲ごとの最高譜面
    const bestBySong = new Map();
    for (const c of charts) {
      const key = normalizeName(c.song);
      const cur = bestBySong.get(key);
      if (!cur || c.skill > cur.skill) bestBySong.set(key, c);
    }
    const songs = [...bestBySong.values()];

    const cat = (hot) => {
      const list = songs.filter((s) => !!s.hot === hot).sort((a, b) => b.skill - a.skill);
      const counted = list.slice(0, SLOTS);
      const total = floor2(counted.reduce((a, s) => a + s.skill, 0));
      // 枠が埋まっていなければボーダー 0
      const border = counted.length < SLOTS ? 0 : counted[counted.length - 1].skill;
      return { list, counted, total, border, filled: counted.length };
    };

    const hot = cat(true);
    const other = cat(false);
    const total = floor2(hot.total + other.total);

    const countedIds = new Set([...hot.counted, ...other.counted].map((s) => s.id));
    for (const c of charts) {
      c.counted = countedIds.has(c.id);
      c.isBest = bestBySong.get(normalizeName(c.song)) === c;
    }

    return { charts, songs, hot, other, total, color: colorOf(total), next: nextColor(total) };
  }

  /**
   * ある譜面の達成率を newRate にしたとき、総スキルがいくつ増えるか。
   */
  function gainIf(entries, id, newRate) {
    const before = analyze(entries).total;
    const after = analyze(entries.map((e) => (e.id === id ? { ...e, rate: Math.max(Number(e.rate) || 0, newRate) } : e))).total;
    return floor2(after - before);
  }

  /**
   * 伸びしろ提案：各譜面について「次のランク到達」「+目標%」した場合の総スキル増分を計算し、
   * 増分の大きい順に返す。
   */
  function suggestions(entries, opts) {
    const step = (opts && opts.step) || 2; // 何%伸ばした想定か
    const base = analyze(entries);
    const out = [];
    for (const c of base.charts) {
      const rate = Number(c.rate) || 0;
      if (rate >= 100) continue;
      const nextRank = [...RANKS].reverse().find((k) => k.min > rate);
      const targets = new Set([Math.min(100, floor2(rate + step))]);
      if (nextRank) targets.add(nextRank.min);
      for (const t of targets) {
        const g = gainIf(entries, c.id, t);
        if (g > 0) {
          out.push({ id: c.id, song: c.song, diff: c.diff, level: c.level, rate, target: t, gain: g, effort: floor2(t - rate) });
        }
      }
    }
    // 1%あたりの効率と増分で並べる
    out.forEach((s) => (s.efficiency = s.effort > 0 ? s.gain / s.effort : 0));
    out.sort((a, b) => b.gain - a.gain || b.efficiency - a.efficiency);
    return out;
  }

  /**
   * 未プレイ曲（新規譜面）を入れるとき、各カテゴリで枠に入るのに必要な達成率。
   */
  function borderTable(border, levels) {
    return levels.map((lv) => ({ level: lv, rate: rateFor(lv, border + 0.01), max: chartSkill(lv, 100) }));
  }

  /** 目標総スキルまでの必要量 */
  function toTarget(entries, target) {
    const a = analyze(entries);
    return { current: a.total, need: Math.max(0, floor2(target - a.total)) };
  }

  /** 難易度帯ごとの分布（0.5刻み） */
  function levelDistribution(songs) {
    const bins = new Map();
    for (const s of songs) {
      const lv = Number(s.level) || 0;
      const b = Math.floor(lv * 2) / 2;
      const k = b.toFixed(1);
      const cur = bins.get(k) || { band: b, count: 0, rateSum: 0 };
      cur.count++;
      cur.rateSum += Number(s.rate) || 0;
      bins.set(k, cur);
    }
    return [...bins.values()]
      .map((b) => ({ band: b.band, count: b.count, avgRate: floor2(b.rateSum / b.count) }))
      .sort((a, b) => a.band - b.band);
  }

  // ---------- CSV ----------
  const CSV_HEADER = ["song", "diff", "level", "rate", "category"];

  function toCSV(entries) {
    const esc = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [CSV_HEADER.join(",")];
    for (const e of entries) lines.push([e.song, e.diff, e.level, e.rate, e.hot ? "HOT" : "OTHER"].map(esc).join(","));
    return lines.join("\n");
  }

  function parseCSVRows(text) {
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') q = false;
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === "," || ch === "\t") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  /**
   * CSV/TSV を読み込む。ヘッダー行（song,diff,level,rate,category）があれば列名で、
   * なければ「曲名,難易度,レベル,達成率,HOT/OTHER」の順と見なす。
   */
  function fromCSV(text) {
    const rows = parseCSVRows(String(text || "").replace(/^﻿/, ""));
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const aliases = {
      song: ["song", "title", "曲名", "曲"],
      diff: ["diff", "difficulty", "難易度", "譜面"],
      level: ["level", "lv", "レベル", "難易度値"],
      rate: ["rate", "achievement", "achieve", "達成率", "%"],
      category: ["category", "cat", "hot", "種別", "カテゴリ"],
      skill: ["skill", "スキル", "スキル値", "sp"],
    };
    let idx = { song: 0, diff: 1, level: 2, rate: 3, category: 4, skill: -1 };
    let start = 0;
    const found = {};
    for (const [k, names] of Object.entries(aliases)) {
      const i = head.findIndex((h) => names.includes(h));
      if (i >= 0) found[k] = i;
    }
    if ("song" in found && ("level" in found || "rate" in found || "skill" in found)) {
      idx = { ...idx, ...found };
      for (const k of Object.keys(idx)) if (!(k in found)) idx[k] = -1;
      start = 1;
    }
    const out = [];
    for (let r = start; r < rows.length; r++) {
      const row = rows[r];
      const get = (k) => (idx[k] >= 0 ? (row[idx[k]] || "").trim() : "");
      const song = get("song");
      if (!song) continue;
      const diffRaw = get("diff").toUpperCase();
      const diff = DIFFS.find((d) => diffRaw.startsWith(d.slice(0, 3))) || (diffRaw.startsWith("MST") ? "MAS" : "EXT");
      const cat = get("category").toUpperCase();
      const rate = parseFloat(get("rate").replace("%", "")) || 0;
      let level = parseFloat(get("level")) || 0;
      // レベルが無くてもスキル値と達成率があれば逆算する
      const sk = parseFloat(get("skill"));
      if (!level && sk > 0 && rate > 0) level = Math.round((sk / (rate * 0.2)) * 100) / 100;
      out.push({
        song,
        diff,
        level,
        rate,
        hot: cat === "HOT" || cat === "H" || cat === "1" || cat === "TRUE" || cat === "新曲",
      });
    }
    return out;
  }

  return {
    SLOTS, DIFFS, RANKS, COLORS,
    chartSkill, rateFor, rankOf, colorOf, nextColor,
    analyze, gainIf, suggestions, borderTable, toTarget, levelDistribution,
    toCSV, fromCSV,
  };
});
