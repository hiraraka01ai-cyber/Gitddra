/*
 * 公式サイト（GITADORA プレイヤーデータのスキル対象曲ページ）から
 * 曲名・譜面・達成率・スキル値を読み取り、取り込み用の TSV を表示するブックマークレット。
 *
 * ページ構造に依存しないよう「xx.xx%」を手がかりに 1曲分の要素を探す。
 * ブックマーク URL にするとき改行が消えるため、関数内では行コメント（//）を使わないこと。
 */
(function (root) {
  "use strict";

  function dmScrape(opts) {
    var TOOL_URL = (opts && opts.toolUrl) || "";
    var RATE_RE = /(\d{1,3}\.\d{1,2})\s*%/;
    var RATE_RE_G = /\d{1,3}\.\d{1,2}\s*%/g;
    var NUM_RE = /^\d{1,3}\.\d{2}$/;
    var DIFF_RE = /(^|[^a-z])(master|mas|mst|extreme|ext|advanced|adv|basic|bas|bsc)([^a-z]|$)/i;
    var RANK_RE = /^(SS|S|A|B|C|D|E|FC|EXC|EXCELLENT|FULL ?COMBO|CLEAR|FAILED)$/i;
    var LABEL_RE = /^(曲名|楽曲|難易度|レベル|達成率|スキル|スキル値|ランク|HOT|OTHER|No\.?|\d+)$/i;

    function countRates(t) { var m = t.match(RATE_RE_G); return m ? m.length : 0; }
    function txt(el) { return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(); }

    function diffOf(s) {
      var m = String(s).match(DIFF_RE);
      if (!m) return "";
      var d = m[2].toLowerCase();
      if (d.indexOf("mas") === 0 || d === "mst" || d === "master") return "MAS";
      if (d.indexOf("ext") === 0) return "EXT";
      if (d.indexOf("adv") === 0) return "ADV";
      return "BAS";
    }

    function leaves(row) {
      var out = [];
      var walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = walker.nextNode())) {
        var t = n.nodeValue.replace(/\s+/g, " ").trim();
        if (t) out.push({ text: t, el: n.parentElement });
      }
      return out;
    }

    function attrText(row) {
      var parts = [];
      var els = [row].concat([].slice.call(row.querySelectorAll("*")));
      els.forEach(function (e) {
        if (typeof e.className === "string") parts.push(e.className);
        ["alt", "title", "src", "data-diff", "data-difficulty"].forEach(function (a) {
          var v = e.getAttribute && e.getAttribute(a);
          if (v) parts.push(v.split("/").pop());
        });
      });
      return parts.join(" ");
    }

    function catNear(el) {
      var cur = el;
      for (var up = 0; up < 8 && cur && cur !== document.body; up++) {
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

    function findRows() {
      var rows = [];
      var seen = [];
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = walker.nextNode())) {
        if (!RATE_RE.test(n.nodeValue)) continue;
        var el = n.parentElement;
        if (!el || el.closest("#dm-bm-overlay")) continue;
        var row = el;
        while (row.parentElement && row.parentElement !== document.body) {
          var p = row.parentElement;
          if (countRates(txt(p)) > 1) break;
          row = p;
          if (row.tagName === "TR" || row.tagName === "LI") break;
        }
        if (seen.indexOf(row) < 0) { seen.push(row); rows.push(row); }
      }
      return rows;
    }

    function parseRow(row) {
      var ls = leaves(row);
      var all = ls.map(function (l) { return l.text; }).join(" ");
      var rm = all.match(RATE_RE);
      if (!rm) return null;
      var rate = parseFloat(rm[1]);
      var level = "", skill = "";
      ls.forEach(function (l) {
        var t = l.text.replace(/%/g, "").trim();
        if (!NUM_RE.test(t) || l.text.indexOf("%") >= 0) return;
        var v = parseFloat(t);
        if (v > 0 && v < 10 && !level) level = t;
        else if (v >= 10 && v <= 200 && !skill) skill = t;
      });
      var diff = diffOf(all) || diffOf(attrText(row));
      var song = "";
      var links = row.querySelectorAll("a");
      for (var i = 0; i < links.length && !song; i++) {
        var lt = txt(links[i]);
        if (lt && !RATE_RE.test(lt) && !NUM_RE.test(lt) && !diffOf(" " + lt + " ")) song = lt;
      }
      if (!song) {
        ls.forEach(function (l) {
          var t = l.text;
          if (RATE_RE.test(t) || NUM_RE.test(t) || RANK_RE.test(t) || LABEL_RE.test(t)) return;
          if (diffOf(t) && t.length <= 12) return;
          if (/^[\d.\s%:-]+$/.test(t)) return;
          if (t.length > song.length) song = t;
        });
      }
      if (!song) return null;
      return { song: song, diff: diff, level: level, rate: rate, skill: skill, cat: catNear(row) };
    }

    var rows = findRows().map(parseRow).filter(Boolean);
    var uniq = {};
    rows = rows.filter(function (r) {
      var k = r.song + "\u0000" + r.diff;
      if (uniq[k]) return false;
      uniq[k] = 1;
      return true;
    });

    var old = document.getElementById("dm-bm-overlay");
    if (old) old.remove();

    var pageCat = "";

    function tsv(defCat) {
      var lines = ["曲名\t難易度\tレベル\t達成率\tスキル値\t種別"];
      rows.forEach(function (r) {
        lines.push([r.song.replace(/\t/g, " "), r.diff || "EXT", r.level, r.rate.toFixed(2), r.skill, r.cat || defCat].join("\t"));
      });
      return lines.join("\n");
    }

    var box = document.createElement("div");
    box.id = "dm-bm-overlay";
    box.setAttribute("style", "position:fixed;inset:12px;z-index:2147483647;background:#171a23;color:#e8eaf0;border:1px solid #444;border-radius:12px;padding:14px;font:14px/1.5 system-ui,sans-serif;display:flex;flex-direction:column;gap:8px;box-shadow:0 10px 40px rgba(0,0,0,.6);max-width:760px;margin:auto;max-height:90vh");
    var unknown = rows.filter(function (r) { return !r.cat; }).length;
    var hot = rows.filter(function (r) { return r.cat === "HOT"; }).length;
    var other = rows.filter(function (r) { return r.cat === "OTHER"; }).length;
    var noDiff = rows.filter(function (r) { return !r.diff; }).length;
    var noLv = rows.filter(function (r) { return !r.level && !r.skill; }).length;
    box.innerHTML =
      '<b style="font-size:16px">DM Skill Analyzer 取り込み</b>' +
      '<div id="dm-bm-info"></div>' +
      '<div id="dm-bm-cat" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"></div>' +
      '<textarea id="dm-bm-text" readonly style="flex:1;min-height:180px;width:100%;box-sizing:border-box;background:#0e1016;color:#e8eaf0;border:1px solid #333;border-radius:8px;padding:8px;font:12px ui-monospace,monospace"></textarea>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button id="dm-bm-copy" style="background:#ff5a3c;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer">コピー</button>' +
      (TOOL_URL ? '<a href="' + TOOL_URL + '" target="_blank" rel="noopener" style="color:#ffb547">ツールを開く</a>' : "") +
      '<button id="dm-bm-close" style="margin-left:auto;background:#1f2330;color:#e8eaf0;border:1px solid #444;border-radius:8px;padding:8px 14px;cursor:pointer">閉じる</button></div>' +
      '<div style="color:#8b91a5;font-size:12px">コピーしたら、ツールの「データ」タブの入力欄に貼り付けて「取り込む」。HOT と OTHER が別ページなら、それぞれで実行して2回取り込んでください。</div>';
    document.body.appendChild(box);

    var info = box.querySelector("#dm-bm-info");
    if (!rows.length) {
      info.innerHTML = '<span style="color:#ff5d73">曲が見つかりませんでした。スキル対象曲の一覧ページで実行してください。</span>';
    } else {
      info.textContent = rows.length + " 曲を検出（HOT " + hot + " / OTHER " + other + " / 枠不明 " + unknown + "）" +
        (noDiff ? "・譜面不明 " + noDiff + "（EXT として出力）" : "") +
        (noLv ? "・レベル/スキル値なし " + noLv : "");
    }
    var ta = box.querySelector("#dm-bm-text");
    var catBox = box.querySelector("#dm-bm-cat");
    var cur = pageCat || (hot && !other ? "HOT" : "OTHER");
    function draw() {
      ta.value = tsv(cur);
      if (!unknown) { catBox.innerHTML = ""; return; }
      catBox.innerHTML = "<span>枠が分からない曲の扱い:</span>";
      ["HOT", "OTHER"].forEach(function (c) {
        var b = document.createElement("button");
        b.textContent = c;
        b.setAttribute("style", "border-radius:99px;padding:3px 12px;cursor:pointer;border:1px solid " + (c === cur ? "#ff5a3c" : "#444") + ";background:" + (c === cur ? "#ff5a3c" : "transparent") + ";color:#fff");
        b.onclick = function () { cur = c; draw(); };
        catBox.appendChild(b);
      });
    }
    draw();
    box.querySelector("#dm-bm-close").onclick = function () { box.remove(); };
    box.querySelector("#dm-bm-copy").onclick = function () {
      var btn = this;
      function done() { btn.textContent = "コピーしました"; }
      function fallback() { ta.focus(); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { btn.textContent = "選択してコピーしてください"; } }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, fallback);
      else fallback();
    };
    return rows;
  }

  /** ブックマーク URL（javascript:...）を作る */
  function bookmarkletURL(toolUrl) {
    var src = dmScrape.toString().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s*/g, " ");
    var code = "(" + src + ")(" + JSON.stringify({ toolUrl: toolUrl || "" }) + ");void 0";
    return "javascript:" + encodeURIComponent(code);
  }

  var api = { dmScrape: dmScrape, bookmarkletURL: bookmarkletURL };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DMBookmarklet = api;
})(typeof self !== "undefined" ? self : this);
