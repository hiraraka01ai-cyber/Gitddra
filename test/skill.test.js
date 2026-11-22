const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/skill.js");

test("chartSkill: 難易度 × 達成率 × 0.2 を切り捨て", () => {
  assert.equal(S.chartSkill(9.0, 100), 180);
  assert.equal(S.chartSkill(8.5, 95), 161.5);
  assert.equal(S.chartSkill(7.33, 87.12), 127.71); // 127.717... -> 127.71
  assert.equal(S.chartSkill(9.99, 100), 199.8);
  assert.equal(S.chartSkill(5, 0), 0);
  assert.equal(S.chartSkill(5, 120), 100); // 100% で頭打ち
});

test("rateFor: 必要達成率", () => {
  const r = S.rateFor(8.5, 161.5);
  assert.equal(r, 95);
  assert.ok(S.chartSkill(8.5, r) >= 161.5);
  assert.equal(S.rateFor(5, 150), null);
  const r2 = S.rateFor(7.33, 127.71);
  assert.ok(S.chartSkill(7.33, r2) >= 127.71);
  assert.ok(S.chartSkill(7.33, r2 - 0.01) < 127.71);
});

test("rankOf", () => {
  assert.equal(S.rankOf(95), "SS");
  assert.equal(S.rankOf(94.99), "S");
  assert.equal(S.rankOf(80), "S");
  assert.equal(S.rankOf(73), "A");
  assert.equal(S.rankOf(63), "B");
  assert.equal(S.rankOf(10), "C");
});

test("colorOf / nextColor", () => {
  assert.equal(S.colorOf(0).name, "白");
  assert.equal(S.colorOf(4123).name, "青");
  assert.equal(S.colorOf(9000).name, "虹");
  assert.equal(S.nextColor(4123).min, 4500);
  assert.equal(S.nextColor(9000), null);
});

test("analyze: 同じ曲は最高譜面のみ、各カテゴリ上位25曲", () => {
  const entries = [];
  let id = 0;
  for (let i = 0; i < 30; i++) entries.push({ id: ++id, song: "Hot" + i, diff: "EXT", level: 8, rate: 70 + i, hot: true });
  for (let i = 0; i < 10; i++) entries.push({ id: ++id, song: "Old" + i, diff: "EXT", level: 6, rate: 90, hot: false });
  // 同じ曲の別譜面（低い方は無視される）
  entries.push({ id: ++id, song: "old0", diff: "ADV", level: 4, rate: 99, hot: false });

  const a = S.analyze(entries);
  assert.equal(a.hot.filled, 25);
  assert.equal(a.other.filled, 10);
  assert.equal(a.other.border, 0); // 枠が埋まっていない
  // HOT 上位25 = rate 75..99
  let expect = 0;
  for (let r = 75; r <= 99; r++) expect += S.chartSkill(8, r);
  assert.equal(a.hot.total, Math.floor(expect * 100 + 1e-6) / 100);
  assert.equal(a.hot.border, S.chartSkill(8, 75));
  assert.equal(a.other.total, 108 * 10);
  const dup = a.charts.find((c) => c.diff === "ADV");
  assert.equal(dup.counted, false);
  assert.equal(dup.isBest, false);
});

test("gainIf / suggestions", () => {
  const entries = [
    { id: 1, song: "A", diff: "EXT", level: 9, rate: 90, hot: true },
    { id: 2, song: "B", diff: "EXT", level: 5, rate: 90, hot: true },
  ];
  assert.equal(S.gainIf(entries, 1, 95), 9);
  const sg = S.suggestions(entries);
  assert.equal(sg[0].id, 1);
  assert.ok(sg.every((s) => s.gain > 0));
});

test("CSV 往復と日本語ヘッダー", () => {
  const entries = [
    { song: 'Say "Hello", World', diff: "MAS", level: 9.1, rate: 88.5, hot: true },
    { song: "foo", diff: "ADV", level: 5.2, rate: 70, hot: false },
  ];
  const back = S.fromCSV(S.toCSV(entries));
  assert.deepEqual(back, entries);

  const jp = "曲名,難易度,レベル,達成率,種別\nテスト曲,EXTREME,8.20,91.3%,HOT\n";
  assert.deepEqual(S.fromCSV(jp), [{ song: "テスト曲", diff: "EXT", level: 8.2, rate: 91.3, hot: true }]);

  const noHeader = "x\tMAS\t9.5\t80\tOTHER";
  assert.deepEqual(S.fromCSV(noHeader), [{ song: "x", diff: "MAS", level: 9.5, rate: 80, hot: false }]);
});

test("CSV: レベル無しならスキル値から逆算", () => {
  const t = "曲名,達成率,スキル値,種別\nX,90.00%,153.00,HOT\n";
  assert.deepEqual(S.fromCSV(t), [{ song: "X", diff: "EXT", level: 8.5, rate: 90, hot: true }]);
});

test("TSV: 曲名のカンマで分割しない", () => {
  const t = "曲名\t難易度\tレベル\t達成率\tスキル値\t種別\nSong, One\tMAS\t\t91.30\t167.07\tHOT\n";
  const [e] = S.fromCSV(t);
  assert.equal(e.song, "Song, One");
  assert.equal(e.diff, "MAS");
  assert.equal(e.level, 9.15);
  assert.equal(S.chartSkill(e.level, e.rate), 167.07);
});

test("bookmarklet URL が作れる", () => {
  const B = require("../js/bookmarklet.js");
  const u = B.bookmarkletURL("https://example.test/");
  assert.ok(u.startsWith("javascript:"));
  assert.doesNotThrow(() => new Function(decodeURIComponent(u.slice(11))));
});
