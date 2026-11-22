/*
 * 公式サイト（e-AMUSEMENT GITADORA プレーデータ）から DM のスコアを集めて、
 * DM Skill Analyzer 取り込み用の TSV を表示するブックマークレット。
 *
 * 2つのモード:
 *  - 全曲取得: 「曲別成績」ページで実行。曲名カテゴリの全ページを順に読み込み、
 *    プレー済みの曲は詳細ページからレベルと達成率を取得。スキル対象曲ページから HOT 曲を判定。
 *  - このページだけ: 「スキル対象曲」などで、表示中の曲を読み取る。
 *
 * ページ構造に依存しすぎないよう「xx.xx%」「BASIC/ADVANCED/EXTREME/MASTER」「x.xx」を手がかりに読む。
 * ブックマーク URL にすると改行が消えるので、関数内では行コメント（//）を使わないこと。
 */
(function (root) {
  "use strict";

  function dmMain(opts) {
    opts = opts || {};
    var TOOL_URL = opts.toolUrl || "";
    var DELAY = opts.delay == null ? 400 : opts.delay;
    var RATE_RE = /(\d{1,3}\.\d{1,2})\s*%/;
    var RATE_RE_G = /\d{1,3}\.\d{1,2}\s*%/g;
    var NUM_RE = /^\d{1,3}\.\d{2}$/;
    var DIFF_RE = /(^|[^a-z])(master|mas|mst|extreme|ext|advanced|advance|adv|basic|bas|bsc)([^a-z]|$)/i;
    var RANK_RE = /^(SS|S|A|B|C|D|E|FC|EXC|EXCELLENT|FULL ?COMBO|CLEAR|FAILED)$/i;
    var LABEL_RE = /^(曲名|楽曲|難易度|レベル|達成率|スキル|スキル値|ランク|HOT|OTHER|No\.?|\d+)$/i;
    var DIFFS = ["BAS", "ADV", "EXT", "MAS"];

    function countRates(t) { var m = String(t).match(RATE_RE_G); return m ? m.length : 0; }
    function txt(el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function diffOf(s) {
      var m = String(s).match(DIFF_RE);
      if (!m) return "";
      var d = m[2].toLowerCase();
      if (d.indexOf("mas") === 0 || d === "mst") return "MAS";
      if (d.indexOf("ext") === 0) return "EXT";
      if (d.indexOf("adv") === 0) return "ADV";
      return "BAS";
    }

    function leaves(rootEl, withImg) {
      var doc = rootEl.ownerDocument || rootEl;
      var out = [];
      var walker = doc.createTreeWalker(rootEl, withImg ? 5 : 4, null);
      var n;
      while ((n = walker.nextNode())) {
        if (n.nodeType === 1) {
          if (n.tagName === "IMG") {
            var it = (n.getAttribute("alt") || "") + " " + (n.getAttribute("src") || "").split("/").pop();
            if (it.trim()) out.push({ text: it.trim(), el: n, img: true });
          }
          continue;
        }
        var p = n.parentElement;
        if (p && /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(p.tagName)) continue;
        var t = n.nodeValue.replace(/\s+/g, " ").trim();
        if (t) out.push({ text: t, el: p });
      }
      return out;
    }

    function attrText(el) {
      var parts = [];
      var els = [el].concat([].slice.call(el.querySelectorAll("*")));
      els.forEach(function (e) {
        if (typeof e.className === "string") parts.push(e.className);
        ["alt", "title", "src", "data-diff", "data-difficulty"].forEach(function (a) {
          var v = e.getAttribute && e.getAttribute(a);
          if (v) parts.push(v.split("/").pop());
        });
      });
      return parts.join(" ");
    }

    /* ---------- このページだけ（スキル対象曲など） ---------- */
    function catNear(el) {
      var cur = el;
      for (var up = 0; up < 8 && cur && cur.tagName !== "BODY"; up++) {
        var sib = cur.previousElementSibling;
        for (var k = 0; k < 4 && sib; k++) {
          var head = txt(sib).slice(0, 60).toUpperCase();
          if (countRates(head) === 0) {
            if (/\bHOT\b/.test(head)) return "HOT";
            if (/\bOTHER\b/.test(head)) return "OTHER";
          }
          sib = sib.previousElementSibling;
        }
        var own = typeof cur.className === "string" ? cur.className.toUpperCase() : "";
        if (/\bHOT\b|_HOT|HOT_/.test(own)) return "HOT";
        if (/OTHER/.test(own)) return "OTHER";
        cur = cur.parentElement;
      }
      return "";
    }

    function rateRows(doc) {
      var rows = [];
      var walker = doc.createTreeWalker(doc.body, 4, null);
      var n;
      while ((n = walker.nextNode())) {
        if (!RATE_RE.test(n.nodeValue)) continue;
        var el = n.parentElement;
        if (!el || (el.closest && el.closest("#dm-bm-overlay"))) continue;
        var row = el;
        while (row.parentElement && row.parentElement.tagName !== "BODY") {
          var p = row.parentElement;
          if (countRates(txt(p)) > 1) break;
          row = p;
          if (row.tagName === "TR" || row.tagName === "LI") break;
        }
        if (rows.indexOf(row) < 0) rows.push(row);
      }
      return rows;
    }

    function songName(row) {
      var links = row.querySelectorAll("a");
      for (var i = 0; i < links.length; i++) {
        var lt = txt(links[i]);
        if (lt && !RATE_RE.test(lt) && !NUM_RE.test(lt) && !(diffOf(" " + lt + " ") && lt.length <= 12)) return lt;
      }
      var song = "";
      leaves(row).forEach(function (l) {
        var t = l.text;
        if (RATE_RE.test(t) || NUM_RE.test(t) || RANK_RE.test(t) || LABEL_RE.test(t)) return;
        if (diffOf(t) && t.length <= 12) return;
        if (/^[\d.\s%:\-−–]+$/.test(t)) return;
        if (t.length > song.length) song = t;
      });
      return song;
    }

    function parseRateRow(row) {
      var ls = leaves(row);
      var all = ls.map(function (l) { return l.text; }).join(" ");
      var rm = all.match(RATE_RE);
      if (!rm) return null;
      var level = "", skill = "";
      ls.forEach(function (l) {
        if (l.text.indexOf("%") >= 0) return;
        var t = l.text.trim();
        if (!NUM_RE.test(t)) return;
        var v = parseFloat(t);
        if (v > 0 && v < 10 && !level) level = t;
        else if (v >= 10 && v <= 200 && !skill) skill = t;
      });
      var song = songName(row);
      if (!song) return null;
      return { song: song, diff: diffOf(all) || diffOf(attrText(row)), level: level, rate: parseFloat(rm[1]), skill: skill, cat: catNear(row) };
    }

    function scrapeRateRows(doc) {
      return rateRows(doc).map(parseRateRow).filter(Boolean);
    }

    /* ---------- 通信 ---------- */
    var stopped = false;
    var dbg = { cats: [], catSample: "", detail: "", detailParsed: "" };
    function slim(el, max) {
      var c = el.cloneNode(true);
      [].slice.call(c.querySelectorAll("script,style,svg,noscript,iframe,link,meta")).forEach(function (x) { x.remove(); });
      [].slice.call(c.querySelectorAll("*")).forEach(function (x) {
        [].slice.call(x.attributes).forEach(function (a) {
          if (!/^(class|id|href|src|alt|title|name|value|onchange|onclick|colspan)$/i.test(a.name)) x.removeAttribute(a.name);
          else if (/^(href|src)$/i.test(a.name)) x.setAttribute(a.name, a.value.replace(/^https?:\/\/[^\/]+/, ""));
        });
      });
      return c.innerHTML.replace(/\s+/g, " ").slice(0, max);
    }
    var GTYPE = (function () {
      var as = document.querySelectorAll("a[href*='gtype=']");
      for (var i = 0; i < as.length; i++) {
        var m = as[i].getAttribute("href").match(/[?&]gtype=([a-z]+)/i);
        if (m && /^dm$/i.test(m[1])) return m[1];
      }
      return "dm";
    })();
    function withG(url) {
      try {
        var u = new URL(url, location.href);
        if (u.origin === location.origin && !u.searchParams.get("gtype")) u.searchParams.set("gtype", GTYPE);
        return u.href;
      } catch (e) { return url; }
    }
    function fetchDoc(url) {
      url = withG(url);
      return fetch(url, { credentials: "same-origin" }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
        var ct = res.headers.get("content-type") || "";
        var m = ct.match(/charset=([\w-]+)/i);
        var cs = m ? m[1] : document.characterSet || "utf-8";
        return res.arrayBuffer().then(function (buf) {
          var html;
          try { html = new TextDecoder(cs).decode(buf); } catch (e) { html = new TextDecoder("utf-8").decode(buf); }
          var d = new DOMParser().parseFromString(html, "text/html");
          var base = d.createElement("base");
          base.href = url;
          d.head.appendChild(base);
          return d;
        });
      });
    }

    /* ---------- 全曲取得 ---------- */
    function findCategorySelect(doc) {
      var sels = [].slice.call(doc.querySelectorAll("select"));
      var best = null;
      sels.forEach(function (s) { if (s.options.length >= 3 && (!best || s.options.length > best.options.length)) best = s; });
      return best;
    }

    function categoryUrls(sel) {
      var here = new URL(location.href);
      var cur = sel.value;
      var opts2 = [].slice.call(sel.options).filter(function (o) { return !o.disabled && o.hasAttribute("value"); }).map(function (o) { return { value: o.value, label: txt(o) }; });
      var form = sel.form;
      if (form && sel.name) {
        return opts2.map(function (o) {
          var u = new URL(form.getAttribute("action") || location.href, location.href);
          [].slice.call(form.elements).forEach(function (e) { if (e.name && e !== sel && e.type !== "submit") u.searchParams.set(e.name, e.value); });
          u.searchParams.set(sel.name, o.value);
          return { url: u.href, label: o.label };
        });
      }
      if (/^(https?:|\/|\.)/.test(cur) || /\.html?/.test(cur)) {
        return opts2.map(function (o) { return { url: new URL(o.value, location.href).href, label: o.label }; });
      }
      var key = null;
      here.searchParams.forEach(function (v, k) { if (v === cur && !key) key = k; });
      var onch = sel.getAttribute("onchange") || "";
      if (!key) {
        var km = onch.match(/[?&]([\w]+)=['"]?\s*\+/);
        if (km) key = km[1];
      }
      if (!key && sel.name) key = sel.name;
      if (!key) return null;
      return opts2.map(function (o) {
        var u = new URL(location.href);
        u.searchParams.set(key, o.value);
        return { url: u.href, label: o.label };
      });
    }

    function headerDiffs(table) {
      var map = {};
      var rows = table.querySelectorAll("tr");
      for (var r = 0; r < rows.length && r < 3; r++) {
        var cells = rows[r].children;
        var found = 0;
        for (var c = 0; c < cells.length; c++) {
          var d = diffOf(" " + txt(cells[c]) + " ") || diffOf(attrText(cells[c]));
          if (d) { map[c] = d; found++; }
        }
        if (found >= 2) return map;
        map = {};
      }
      return null;
    }

    function listSongs(doc) {
      var out = [];
      [].slice.call(doc.querySelectorAll("table")).forEach(function (table) {
        var hd = headerDiffs(table);
        if (!hd) return;
        [].slice.call(table.querySelectorAll("tr")).forEach(function (tr) {
          var a = tr.querySelector("a[href]");
          if (!a) return;
          var name = txt(a) || songName(tr);
          if (!name) return;
          var played = [];
          var rates = {};
          var cells = tr.children;
          for (var c = 0; c < cells.length; c++) {
            if (!hd[c]) continue;
            var t = txt(cells[c]);
            var hasImg = cells[c].querySelector("img");
            var iconCls = /(^|\s)icon-[a-z0-9]/i.test(cells[c].className || "");
            var empty = !t.replace(/[\s\-−–―ー_＿]/g, "") && !hasImg && !iconCls;
            if (!empty) played.push(hd[c]);
            var rm = t.match(RATE_RE);
            if (rm) rates[hd[c]] = parseFloat(rm[1]);
          }
          out.push({ song: name, href: a.href, played: played, rates: rates });
        });
      });
      return out;
    }

    function parseDetail(doc) {
      var res = {};
      var ls = leaves(doc.body, true);
      var cur = "";
      for (var i = 0; i < ls.length; i++) {
        var t = ls[i].text;
        var d = ((ls[i].img || t.length <= 16) && diffOf(" " + t + " ")) || "";
        if (d) { cur = d; res[cur] = res[cur] || {}; continue; }
        if (!cur || ls[i].img) continue;
        var rm = t.match(RATE_RE);
        if (rm && res[cur].rate == null) { res[cur].rate = parseFloat(rm[1]); continue; }
        var nm = t.replace(/^Lv\.?\s*/i, "").trim();
        if (NUM_RE.test(nm)) {
          var v = parseFloat(nm);
          if (v > 0 && v < 10 && res[cur].level == null) res[cur].level = v;
          else if (v >= 10 && v <= 200 && res[cur].skill == null) res[cur].skill = v;
        }
      }
      return res;
    }

    function findLink(doc, re) {
      var as = [].slice.call(doc.querySelectorAll("a[href]"));
      for (var i = 0; i < as.length; i++) if (re.test(txt(as[i]) + " " + attrText(as[i]))) return as[i].href;
      return null;
    }

    function skillTargets(log) {
      var url = findLink(document, /スキル対象/);
      if (!url && /\/skill\.html/.test(location.pathname)) url = location.href;
      if (!url && /\/p\/playdata\//.test(location.pathname)) url = new URL("skill.html?gtype=" + GTYPE + "&stype=", location.href).href;
      if (!url) {
        var here = scrapeRateRows(document);
        if (!here.length) { log("スキル対象曲ページが分かりません。GITADORA のプレーデータのページで実行してください"); return Promise.resolve(null); }
        url = location.href;
      }
      return fetchDoc(url).then(function (d) {
        var hotUrl = null, otherUrl = null;
        [].slice.call(d.querySelectorAll("a[href]")).forEach(function (a) {
          var s = (txt(a) + " " + attrText(a)).toUpperCase();
          if (/\bHOT\b|_HOT|HOT_|HOT\./.test(s) && !hotUrl) hotUrl = a.href;
          if (/\bOTHER\b|_OTHER|OTHER_|OTHER\./.test(s) && !otherUrl) otherUrl = a.href;
        });
        var tabbed = hotUrl && otherUrl && hotUrl !== otherUrl;
        if (!tabbed) return scrapeRateRows(d);
        function tab(u, cat) {
          var p = withG(u) === withG(url) ? Promise.resolve(d) : sleep(DELAY).then(function () { return fetchDoc(u); });
          return p.then(function (doc) {
            var rs = scrapeRateRows(doc);
            rs.forEach(function (r) { r.cat = cat; });
            return rs;
          });
        }
        return tab(hotUrl, "HOT").then(function (h) {
          return tab(otherUrl, "OTHER").then(function (o) { return h.concat(o); });
        });
      }).then(function (rows) {
        if (rows) log("スキル対象曲 " + rows.length + " 曲（HOT " + rows.filter(function (r) { return r.cat === "HOT"; }).length + " / OTHER " + rows.filter(function (r) { return r.cat === "OTHER"; }).length + "）");
        return rows;
      }).catch(function (e) { log("スキル対象曲を読めませんでした: " + e.message); return null; });
    }

    function hotSongs(log) {
      return skillTargets(log).then(function (rows) {
        var hot = {};
        (rows || []).forEach(function (r) { if (r.cat === "HOT") hot[r.song] = 1; });
        return hot;
      });
    }

    var frame = null;
    var frameOk = true;
    function frameDoc(url) {
      url = withG(url);
      if (!frameOk) return fetchDoc(url);
      return new Promise(function (resolve, reject) {
        if (!frame) {
          frame = document.createElement("iframe");
          frame.setAttribute("style", "position:fixed;left:-9999px;top:0;width:1024px;height:768px;opacity:0;pointer-events:none");
          frame.setAttribute("aria-hidden", "true");
          document.body.appendChild(frame);
        }
        var done = false;
        var timer = setTimeout(function () { finish(); }, 15000);
        function finish() {
          if (done) return;
          done = true;
          clearTimeout(timer);
          frame.onload = null;
          var d = null;
          try { d = frame.contentDocument; } catch (e) { d = null; }
          if (!d || !d.body || d.location.href === "about:blank") { frameOk = false; dbg.frame = "iframe 不可、fetch に切り替え"; resolve(fetchDoc(url)); return; }
          resolve(d);
        }
        frame.onload = function () {
          try { if (frame.contentWindow.location.href === "about:blank") return; } catch (e) {}
          setTimeout(finish, 900);
        };
        frame.src = url;
      });
    }

    function crawl(ui) {
      var sel = findCategorySelect(document);
      var cats = sel && categoryUrls(sel);
      if (!cats || !cats.length) { ui.log("曲名カテゴリの切り替え方法が分かりませんでした。「診断情報」を送ってください。"); return Promise.resolve([]); }
      var songs = [];
      var seen = {};
      var out = [];
      var i = 0;
      ui.log(cats.length + " カテゴリを読み込みます");
      function nextCat() {
        if (stopped) return Promise.resolve();
        if (i >= cats.length) return Promise.resolve();
        var c = cats[i++];
        ui.progress("カテゴリ " + i + "/" + cats.length + "（" + c.label + "）");
        return frameDoc(c.url).then(function (d) {
          var got = listSongs(d);
          dbg.cats.push(c.label + ": " + got.length + "曲 / プレー済み " + got.filter(function (x) { return x.played.length; }).length);
          if (!dbg.catSample && (got.length || i === 1)) {
            var tb = [].slice.call(d.querySelectorAll("table")).filter(function (x) { return headerDiffs(x); })[0];
            dbg.catSample = "url: " + c.url.replace(/^https?:\/\/[^\/]+/, "") + "\n" + (tb ? [].slice.call(tb.querySelectorAll("tr")).slice(0, 5).map(function (r) { return slim(r, 1500); }).join("\n") : "(DM の難易度見出しの表なし) " + slim(d.body, 4000));
          }
          got.forEach(function (s) {
            var k = s.song + "\u0000" + s.href;
            if (!seen[k]) { seen[k] = 1; songs.push(s); }
          });
        }).catch(function (e) { ui.log("読み込み失敗: " + c.label + " (" + e.message + ")"); })
          .then(function () { return sleep(DELAY); }).then(nextCat);
      }
      var played;
      var j = 0;
      function nextSong() {
        if (stopped || j >= played.length) return Promise.resolve();
        var s = played[j++];
        ui.progress("曲の詳細 " + j + "/" + played.length + "：" + s.song);
        return frameDoc(s.href).then(function (d) {
          var det = parseDetail(d);
          if (!dbg.detail) {
            dbg.detail = "url: " + s.href.replace(/^https?:\/\/[^\/]+/, "") + "\nplayed: " + s.played.join(",") + " rates: " + JSON.stringify(s.rates) + "\n" + slim(d.body, 9000);
            dbg.detailParsed = JSON.stringify(det);
          }
          s.played.forEach(function (df) {
            var x = det[df] || {};
            var rate = x.rate != null ? x.rate : s.rates[df];
            if (rate == null || !(rate > 0)) return;
            out.push({ song: s.song, diff: df, level: x.level != null ? x.level.toFixed(2) : "", rate: rate, skill: x.skill != null ? x.skill.toFixed(2) : "", cat: "" });
          });
          ui.count(out.length);
        }).catch(function (e) { ui.log("詳細の読み込み失敗: " + s.song + " (" + e.message + ")"); })
          .then(function () { return sleep(DELAY); }).then(nextSong);
      }
      return nextCat().then(function () {
        played = songs.filter(function (s) { return s.played.length; });
        ui.log("全 " + songs.length + " 曲中、プレー済み " + played.length + " 曲");
        return nextSong();
      }).then(function () {
        if (frame) { frame.remove(); frame = null; }
        if (stopped) ui.log("中断しました（ここまでの分を出力）");
        return hotSongs(ui.log);
      }).then(function (hot) {
        out.forEach(function (r) { r.cat = hot[r.song] ? "HOT" : "OTHER"; });
        return out;
      });
    }

    /* ---------- 画面 ---------- */
    var old = document.getElementById("dm-bm-overlay");
    if (old) old.remove();
    var box = document.createElement("div");
    box.id = "dm-bm-overlay";
    box.setAttribute("style", "position:fixed;inset:12px;z-index:2147483647;background:#171a23;color:#e8eaf0;border:1px solid #444;border-radius:12px;padding:14px;font:14px/1.5 system-ui,sans-serif;display:flex;flex-direction:column;gap:8px;box-shadow:0 10px 40px rgba(0,0,0,.6);max-width:760px;margin:auto;max-height:90vh;text-align:left");
    var btn = "border-radius:8px;padding:8px 14px;cursor:pointer;font:inherit;";
    box.innerHTML =
      '<b style="font-size:16px">DM Skill Analyzer 取り込み</b>' +
      '<div id="dm-bm-mode" style="display:flex;gap:8px;flex-wrap:wrap"></div>' +
      '<div id="dm-bm-status" style="color:#ffb547"></div>' +
      '<div id="dm-bm-log" style="color:#8b91a5;font-size:12px;max-height:90px;overflow:auto"></div>' +
      '<div id="dm-bm-cat" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"></div>' +
      '<textarea id="dm-bm-text" readonly style="flex:1;min-height:160px;width:100%;box-sizing:border-box;background:#0e1016;color:#e8eaf0;border:1px solid #333;border-radius:8px;padding:8px;font:12px ui-monospace,monospace"></textarea>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<button id="dm-bm-copy" style="' + btn + 'background:#ff5a3c;color:#fff;border:0;font-weight:700">コピー</button>' +
      (TOOL_URL ? '<a href="' + TOOL_URL + '" target="_blank" rel="noopener" style="color:#ffb547">ツールを開く</a>' : "") +
      '<button id="dm-bm-diag" style="' + btn + 'background:transparent;color:#8b91a5;border:1px solid #444">診断情報</button>' +
      '<button id="dm-bm-close" style="' + btn + 'margin-left:auto;background:#1f2330;color:#e8eaf0;border:1px solid #444">閉じる</button></div>' +
      '<div style="color:#8b91a5;font-size:12px">コピーしたら、ツールの「データ」タブの入力欄に貼り付けて「取り込む」。</div>';
    document.body.appendChild(box);

    var $ = function (id) { return box.querySelector("#" + id); };
    var ta = $("dm-bm-text");
    var rows = [];
    var cur = "OTHER";
    var ui = {
      log: function (m) { var p = document.createElement("div"); p.textContent = m; $("dm-bm-log").appendChild(p); $("dm-bm-log").scrollTop = 1e9; },
      progress: function (m) { $("dm-bm-status").textContent = m; },
      count: function (n) { ta.value = n + " 譜面を取得済み…"; }
    };

    function tsv() {
      var lines = ["曲名\t難易度\tレベル\t達成率\tスキル値\t種別"];
      var uniq = {};
      rows.forEach(function (r) {
        var k = r.song + "\u0000" + r.diff;
        if (uniq[k]) return;
        uniq[k] = 1;
        lines.push([r.song.replace(/\t/g, " "), r.diff || "EXT", r.level, Number(r.rate).toFixed(2), r.skill, r.cat || cur].join("\t"));
      });
      return lines.join("\n");
    }
    function show() {
      ta.value = tsv();
      var unknown = rows.filter(function (r) { return !r.cat; }).length;
      var cb = $("dm-bm-cat");
      cb.innerHTML = "";
      if (!unknown) return;
      var s = document.createElement("span");
      s.textContent = "枠が分からない " + unknown + " 曲の扱い:";
      cb.appendChild(s);
      ["HOT", "OTHER"].forEach(function (c) {
        var b = document.createElement("button");
        b.textContent = c;
        b.setAttribute("style", "border-radius:99px;padding:3px 12px;cursor:pointer;border:1px solid " + (c === cur ? "#ff5a3c" : "#444") + ";background:" + (c === cur ? "#ff5a3c" : "transparent") + ";color:#fff");
        b.onclick = function () { cur = c; show(); };
        cb.appendChild(b);
      });
    }
    function summary() {
      var noLv = rows.filter(function (r) { return !r.level && !r.skill; }).length;
      var hot = rows.filter(function (r) { return r.cat === "HOT"; }).length;
      return rows.length + " 譜面（HOT " + hot + " / OTHER " + rows.filter(function (r) { return r.cat === "OTHER"; }).length + "）" + (noLv ? "・レベル不明 " + noLv + "（取り込み時に除外されます）" : "");
    }

    function runPage() {
      rows = scrapeRateRows(document);
      ui.progress(rows.length ? summary() : "このページでは曲が見つかりませんでした");
      show();
    }
    function runAll() {
      stopped = false;
      $("dm-bm-mode").innerHTML = "";
      var stop = document.createElement("button");
      stop.textContent = "中断";
      stop.setAttribute("style", btn + "background:transparent;color:#ff5d73;border:1px solid #ff5d73");
      stop.onclick = function () { stopped = true; stop.disabled = true; };
      $("dm-bm-mode").appendChild(stop);
      crawl(ui).then(function (r) {
        rows = r;
        stop.remove();
        ui.progress("完了：" + summary());
        show();
      }).catch(function (e) { ui.progress("エラー: " + e.message); });
    }

    function runSkill() {
      ui.progress("スキル対象曲（HOT / OTHER）を読み込み中…");
      skillTargets(ui.log).then(function (r) {
        if (!r) { ui.progress("スキル対象曲を取得できませんでした"); return; }
        rows = r;
        ui.progress("完了：" + summary());
        show();
      });
    }

    var sel = findCategorySelect(document);
    var canCrawl = !!(sel && [].slice.call(document.querySelectorAll("table")).some(function (t) { return headerDiffs(t); }));
    var bS = document.createElement("button");
    bS.textContent = "スキル対象曲を取得";
    bS.setAttribute("style", btn + "background:#3ccf8e;color:#111;border:0;font-weight:700");
    bS.onclick = runSkill;
    $("dm-bm-mode").appendChild(bS);
    if (canCrawl && opts.full) {
      var b1 = document.createElement("button");
      b1.textContent = "全曲を取得（初回用・十数分）";
      b1.setAttribute("style", btn + "background:transparent;color:#e8eaf0;border:1px solid #444");
      b1.onclick = runAll;
      $("dm-bm-mode").appendChild(b1);
    }
    runSkill();

    $("dm-bm-close").onclick = function () { stopped = true; box.remove(); };
    function copyText(text, b) {
      function done() { b.textContent = "コピーしました"; }
      function fallback() { ta.value = text; ta.focus(); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { b.textContent = "選択してコピーしてください"; } }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    }
    $("dm-bm-copy").onclick = function () { copyText(tsv(), this); };
    $("dm-bm-diag").onclick = function () {
      var s = findCategorySelect(document);
      var t = [].slice.call(document.querySelectorAll("table")).filter(function (x) { return headerDiffs(x); })[0];
      var trs = t ? [].slice.call(t.querySelectorAll("tr")).slice(0, 4).map(function (r) { return r.outerHTML; }).join("\n") : "(表なし)";
      var liveRow = "";
      [].slice.call(document.querySelectorAll("tr")).some(function (r) {
        var hit = [].slice.call(r.children).some(function (c) { return /(^|\s)icon-[a-z0-9]/i.test(c.className || "") || (c.className && /rank/.test(c.className) && (c.querySelector("img,span,div") || txt(c))); });
        if (hit) liveRow = slim(r, 2000);
        return hit;
      });
      var scripts = [].slice.call(document.querySelectorAll("script")).map(function (x) {
        var src = x.getAttribute("src");
        if (src) return "src=" + src.replace(/^https?:\/\/[^\/]+/, "");
        var t = x.textContent;
        return /rank|icon|score/i.test(t) ? "inline: " + t.replace(/\s+/g, " ").slice(0, 1500) : "";
      }).filter(Boolean).join("\n");
      var info = [
        "frame: " + (dbg.frame || (frameOk ? "iframe" : "fetch")),
        "liveRow: " + (liveRow || "(ランク付きの行が画面に無い)"),
        "scripts:\n" + scripts.slice(0, 5000),
        "log: " + $("dm-bm-status").textContent + " / " + [].slice.call($("dm-bm-log").children).map(function (x) { return x.textContent; }).join(" / "),
        "categories: " + dbg.cats.slice(0, 40).join(" | "),
        "path: " + location.pathname + location.search.replace(/([?&](?:id|rival|uid|code)[^=]*=)[^&]*/gi, "$1***"),
        "charset: " + document.characterSet,
        "select: " + (s ? s.outerHTML.slice(0, 600) : "(なし)"),
        "form: " + (s && s.form ? s.form.outerHTML.slice(0, 300) : "(なし)"),
        "rows:\n" + trs.slice(0, 3000),
        "catSample:\n" + dbg.catSample,
        "detailParsed: " + dbg.detailParsed,
        "detail:\n" + dbg.detail
      ].join("\n");
      copyText(info, this);
    };
    return { rows: function () { return rows; }, runAll: runAll, runPage: runPage };
  }

  /** ブックマーク URL（javascript:...）を作る */
  function bookmarkletURL(toolUrl) {
    var src = dmMain.toString().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s*/g, " ");
    var code = "(" + src + ")(" + JSON.stringify({ toolUrl: toolUrl || "" }) + ");void 0";
    return "javascript:" + encodeURIComponent(code);
  }

  var api = { dmMain: dmMain, dmScrape: dmMain, bookmarkletURL: bookmarkletURL };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DMBookmarklet = api;
})(typeof self !== "undefined" ? self : this);
