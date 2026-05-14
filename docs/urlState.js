"use strict";

// ── シェアボタンのURLに今週の ISO 週番号を付与（OGPキャッシュ対策） ──────
// 例: https://...?w=2026-W19
// 週ごとに「新しいURL」となるため、Twitter等のOGPキャッシュが切り替わる
(function updateShareButtonUrls() {
  function isoWeek(d) {
    const t = new Date(d);
    t.setHours(0, 0, 0, 0);
    // 週の木曜日で年を判定（ISO 8601）
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
    const week1 = new Date(t.getFullYear(), 0, 4);
    const weekNum =
      1 + Math.round(((t - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return { year: t.getFullYear(), week: weekNum };
  }
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    const { year, week } = isoWeek(new Date());
    const wTag = `${year}-W${String(week).padStart(2, "0")}`;
    const base = "https://ryomakom.github.io/infectious_diseases/";
    const encOld = encodeURIComponent(base);
    const encNew = encodeURIComponent(`${base}?w=${wTag}`);
    document.querySelectorAll(".share-buttons a.share-btn").forEach(a => {
      a.href = a.href.split(encOld).join(encNew);
    });
  });
})();

// ── URL でグラフ状態を共有する ──────────────────────────────────────────────
// クエリパラメータ:
//   pref … 選択中の地域（カンマ区切り）
//   cat  … 感染症（1種類）
//   hi   … ハイライト中の地域（1つ、省略可）
//   t0   … スライダー開始日（YYYY-MM-DD）
//   t1   … スライダー終了日（YYYY-MM-DD）
//
// URLの更新タイミング:
//   - グラフパネルをクリックしたとき
//   - 折れ線ラベルをクリックしてハイライトを変えたとき
// ─────────────────────────────────────────────────────────────────────────────

const _UP = { PREF: "pref", CAT: "cat", HI: "hi", T0: "t0", T1: "t1" };

// ── グラフをクリック or ハイライト変更時にURLを更新 ──────────────────────
function updateUrlForChart(category) {
  const p = new URLSearchParams();

  const prefs = [...(state.selectedChartPrefectures || [])];
  if (prefs.length) p.set(_UP.PREF, prefs.join(","));

  p.set(_UP.CAT, category);

  const hi = (state.highlightedPrefByCategory || {})[category];
  if (hi) p.set(_UP.HI, hi);

  const ext = (state.savedBrushExtents || {})[category];
  if (ext) {
    const [d0, d1] = ext;
    if (d0 instanceof Date && d1 instanceof Date && !isNaN(d0) && !isNaN(d1)) {
      p.set(_UP.T0, d0.toISOString().slice(0, 10));
      p.set(_UP.T1, d1.toISOString().slice(0, 10));
    }
  }

  history.replaceState(null, "", location.pathname + "?" + p.toString());
}

// ── URL → state（initialize() 内で setDefaultDropdownSelection の直後に呼ぶ）
// URL パラメータがあった場合は true を返す
function applyUrlState() {
  const p = new URLSearchParams(location.search);
  let applied = false;

  // 地域
  const prefStr = p.get(_UP.PREF);
  if (prefStr) {
    const prefs = prefStr.split(",").map(s => s.trim()).filter(s =>
      s && state.uniquePrefectures.includes(s)
    );
    if (prefs.length) {
      state.selectedChartPrefectures = new Set(prefs);
      applied = true;
    }
  }

  // 感染症（1種類）
  const catStr = p.get(_UP.CAT);
  if (catStr) {
    const cats = catStr.split(",").map(s => s.trim()).filter(s =>
      s && state.uniqueCategories.includes(s)
    );
    if (cats.length) {
      state.selectedCategories = new Set(cats);
      state.categoryDisplayOrder = cats.slice();
      applied = true;
    }
  }

  // ハイライト地域
  const hiStr = p.get(_UP.HI);
  if (hiStr && catStr) {
    const cat = catStr.split(",")[0].trim();
    if (cat && state.uniqueCategories.includes(cat) &&
        state.uniquePrefectures.includes(hiStr.trim())) {
      state.highlightedPrefByCategory[cat] = hiStr.trim();
      applied = true;
    }
  }

  // スライダー期間
  const t0s = p.get(_UP.T0);
  const t1s = p.get(_UP.T1);
  if (t0s && t1s) {
    const d0 = new Date(t0s);
    const d1 = new Date(t1s);
    if (!isNaN(d0) && !isNaN(d1) && d0 < d1) {
      state.selectedCategories.forEach(cat => {
        state.savedBrushExtents[cat] = [d0, d1];
      });
      applied = true;
    }
  }

  if (!applied) return false;

  // ドロップダウン UI を URL 由来の状態に同期
  if (typeof refreshPrefectureOptions === "function") refreshPrefectureOptions();
  if (typeof renderChartPrefectureTags  === "function") renderChartPrefectureTags();
  if (typeof refreshDiseaseOptions      === "function") refreshDiseaseOptions();
  if (typeof renderChartDiseaseTags     === "function") renderChartDiseaseTags();

  return true;
}
