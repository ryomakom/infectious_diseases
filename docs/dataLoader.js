"use strict";

function loadData(fileName) {
  return loadCsvFlexible(fileName, d => {
    const dateStr = d.date != null ? d.date : d["\ufeffdate"];
    return {
      date: parseDate(dateStr),
      value: +d.value,
      pref: prefToDisplay(d.pref),
      category: categoryToDisplay(d.category),
      weekLabel: d["week_label_clean"] || ""
    };
  }).then(data => data.filter(d => d.date && !Number.isNaN(d.value)))
    .catch(err => {
      console.warn(`Failed to load ${fileName}`, err);
      return [];
    });
}

function loadAlertThresholds() {
  return loadCsvFlexible("data/alert_thresholds.csv")
    .then(rows => {
      const map = {};
      rows.forEach(d => {
        const cat = categoryToDisplay(d.category);
        const v = parseFloat(d.alert_start);
        if (!Number.isNaN(v) && v > 0) map[cat] = v;
      });
      state.alertThresholdsMap = map;
      return map;
    })
    .catch(() => ({}));
}

function loadLastFetchDate() {
  return loadTextFlexible("results/last_fetch.txt")
    .then(t => t.trim())
    .catch(() => "");
}

function loadRankingCsv() {
  return loadCsvFlexible("results/ranking.csv")
    .then(rows => rows.map(d => ({
      category: categoryToDisplay(d.category),
      pref: prefToDisplay(d.pref),
      ratio_yoy: Number.isFinite(+d.ratio_yoy) ? +d.ratio_yoy : null,
      ratio_alert: d.ratio_alert === "" || Number.isNaN(+d.ratio_alert) ? null : +d.ratio_alert,
      current_ma4: +d.current_ma4,
      alert_start: (d.alert_start === "" || d.alert_start === "NA" || d.alert_start == null || Number.isNaN(+d.alert_start)) ? null : +d.alert_start
    })))
    .catch(() => []);
}

function loadTopHighlightsJson() {
  return loadTextFlexible("results/top_highlights.json")
    .then(text => {
      try {
        const json = JSON.parse(text);
        return json && typeof json === "object" ? json : null;
      } catch (e) {
        console.warn("Failed to parse top_highlights.json", e);
        return null;
      }
    })
    .catch(() => null);
}

function loadNewsDigestJson() {
  return loadTextFlexible("results/news_digest.json")
    .then(text => {
      try {
        const json = JSON.parse(text);
        return json && typeof json === "object" ? json : null;
      } catch (e) {
        console.warn("Failed to parse news_digest.json", e);
        return null;
      }
    })
    .catch(() => null);
}

function computeRankingFromAllData() {
  const grouped = d3.groups(state.allData, d => `${d.category}__${d.pref}`);
  const rows = [];
  grouped.forEach(([key, arr]) => {
    arr.sort((a, b) => a.date - b.date);
    if (!arr.length) return;
    const latest = arr[arr.length - 1];
    const prev = arr.slice(-5, -1);
    const baseline = prev.length ? d3.mean(prev, d => d.value) : latest.value;
    const ratioYoy = baseline && baseline > 0 ? latest.value / baseline : 1;
    const threshold = state.alertThresholdsMap[latest.category];
    const ratioAlert = threshold && threshold > 0 ? latest.value / threshold : null;
    rows.push({
      category: latest.category,
      pref: latest.pref,
      ratio_yoy: ratioYoy,
      ratio_alert: ratioAlert,
      current_ma4: latest.value
    });
  });
  return rows;
}

function mergeRankingRows(csvRows, computedRows) {
  const byKey = new Map();
  (computedRows || []).forEach(row => {
    byKey.set(`${row.category}__${row.pref}`, row);
  });
  (csvRows || []).forEach(row => {
    // CSV の算出値を優先しつつ、欠損組み合わせは computed 側で補完する
    byKey.set(`${row.category}__${row.pref}`, row);
  });
  return Array.from(byKey.values());
}


function cleanBakedDom() {
  if (els.rankingBody) els.rankingBody.innerHTML = "";
  if (els.chartContainer) els.chartContainer.innerHTML = "";
  state.chartRenderCache = {};
  if (els.rankingPrefTags) els.rankingPrefTags.innerHTML = "";
  if (els.rankingDiseaseTags) els.rankingDiseaseTags.innerHTML = "";
  if (els.prefSelected) els.prefSelected.innerHTML = "";
  if (els.diseaseSelected) els.diseaseSelected.innerHTML = "";
  if (els.rankingMoreWrap) els.rankingMoreWrap.style.display = "none";
  if (els.rankingMoreBtn) els.rankingMoreBtn.textContent = "";
  $$("#dropdown-content .option.selected, #disease-dropdown-content .option.selected").forEach(node => node.classList.remove("selected"));
  $$('#dropdown-content .option[aria-selected="true"], #disease-dropdown-content .option[aria-selected="true"]').forEach(node => node.setAttribute("aria-selected", "false"));
}

function initializeUniqueLists() {
  const prefSet = new Set(state.allData.map(d => d.pref));
  state.uniquePrefectures = PREF_ORDER.filter(p => prefSet.has(p)).concat(Array.from(prefSet).filter(p => !PREF_ORDER.includes(p)).sort());
  const catSet = new Set(state.allData.map(d => d.category));
  state.uniqueCategories = CATEGORY_ORDER.filter(c => catSet.has(c)).concat(Array.from(catSet).filter(c => !CATEGORY_ORDER.includes(c)).sort());
  state.allCategoryOrder = state.uniqueCategories.slice();
}

async function initialize() {
  cleanBakedDom();
  // 「その他」CSV（数十MB）は初期表示の帯域を奪うので、初期描画が終わってから遅延ロードする。
  // まずは東京・大阪・全国の小さなCSVだけを並列で取得し、画面を最速で描画する。
  const [tokyo, osaka, nationwide, thresholds, lastFetch, rankingCsv, topHighlightsJson, newsDigestJson] = await Promise.all([
    loadData("results/data-東京都.csv"),
    loadData("results/data-大阪府.csv"),
    loadData("results/data-全国.csv"),
    loadAlertThresholds(),
    loadLastFetchDate(),
    loadRankingCsv(),
    loadTopHighlightsJson(),
    loadNewsDigestJson()
  ]);
  state.allData = [...tokyo, ...osaka, ...nationwide];
  state.precomputedTopHighlights = topHighlightsJson;
  state.newsDigest = newsDigestJson;

  // newsDigest の top_prefectures に登場する都道府県のデータを、
  // 描画前にロードする。これでスパークラインが確実にデータを持てる。
  // 対象はせいぜい3〜5県（数MB）なので初期表示の遅延は最小限に抑えられる。
  const alwaysLoaded = new Set(["全国", "東京都", "大阪府"]);
  const prominentPrefs = new Set();
  if (newsDigestJson && Array.isArray(newsDigestJson.top_prefectures)) {
    newsDigestJson.top_prefectures.forEach(r => {
      if (r && r.pref && !alwaysLoaded.has(r.pref)) prominentPrefs.add(r.pref);
    });
  }
  if (prominentPrefs.size > 0) {
    await Promise.all([...prominentPrefs].map(p => ensurePrefLoaded(p)));
  }

  initializeUniqueLists();
  buildChartDropdownOptions();
  initializeDropdownToggles();
  if (typeof lastFetch === "string" && lastFetch) {
    const fd = new Date(`${lastFetch}T12:00:00`);
    if (!Number.isNaN(fd.getTime()) && els.lastUpdated) {
      els.lastUpdated.textContent = `最終更新：${fd.getFullYear()}年${fd.getMonth() + 1}月${fd.getDate()}日`;
    }
  }
  const latestDate = d3.max(state.allData, d => d.date);
  if (latestDate && els.latestData) {
    els.latestData.textContent = `最新データ：${latestDate.getFullYear()}年${latestDate.getMonth() + 1}月${latestDate.getDate()}日`;
  }
  state.rankingData = mergeRankingRows(rankingCsv, computeRankingFromAllData());

  // ニュースダイジェストの3シグナルカード（警戒・増加・季節外れ）に表示される
  // 上位3県のスパークライン用データを renderNewsDigestSection の前にプリロードする。
  // buildTopPrefsSection が state.rankingData から動的に選ぶ県であり、
  // top_prefectures とは異なる場合があるため個別に処理する。
  const digestSignalCategories = new Set();
  {
    // alert: ratio_alert が最大の全国行
    const alertRow = (state.rankingData || [])
      .filter(d => (d.pref === "全国" || d.pref === "全国平均") && Number.isFinite(d.ratio_alert))
      .sort((a, b) => b.ratio_alert - a.ratio_alert)[0];
    if (alertRow) digestSignalCategories.add(alertRow.category);
    // rising / anomaly: newsDigest から
    const rising = newsDigestJson && Array.isArray(newsDigestJson.rising) ? newsDigestJson.rising[0] : null;
    if (rising && rising.category) digestSignalCategories.add(rising.category);
    const anomaly = newsDigestJson && Array.isArray(newsDigestJson.anomalies) ? newsDigestJson.anomalies[0] : null;
    if (anomaly && anomaly.category) digestSignalCategories.add(anomaly.category);
  }
  const digestTopPrefsToLoad = new Set();
  digestSignalCategories.forEach(cat => {
    (state.rankingData || [])
      .filter(d => d.category === cat && d.pref !== "全国" && d.pref !== "全国平均" && Number.isFinite(d.current_ma4))
      .sort((a, b) => (b.current_ma4 ?? -Infinity) - (a.current_ma4 ?? -Infinity))
      .slice(0, 3)
      .forEach(d => { if (!alwaysLoaded.has(d.pref)) digestTopPrefsToLoad.add(d.pref); });
  });
  if (digestTopPrefsToLoad.size > 0) {
    await Promise.all([...digestTopPrefsToLoad].map(p => ensurePrefLoaded(p)));
  }

  renderNewsDigestSection(state.newsDigest);
  initializeDropdown();
  initializeCategoryControls();
  initializePrefControls();
  setDefaultDropdownSelection();
  refreshRankingTable();
  drawAllCharts(getSelectedDropdownPrefectures());
  setupResizeRedraw();
}

// 都道府県ごとのCSVをオンデマンドで読み込む。
// 全国・東京都・大阪府は初期ロード済み。それ以外はユーザーが選んだときだけ取得する。
// _prefLoadCache に Promise をキャッシュし、同じ県の二重ロードを防ぐ。
const _prefLoadCache = {};
async function ensurePrefLoaded(prefName) {
  const alwaysLoaded = ["全国", "東京都", "大阪府"];
  if (alwaysLoaded.includes(prefName)) return;
  if (state.allData.some(d => d.pref === prefName)) return; // 既にデータあり
  if (_prefLoadCache[prefName]) return _prefLoadCache[prefName]; // ロード中

  _prefLoadCache[prefName] = loadData(`results/pref/data-${prefName}.csv`)
    .then(rows => {
      if (!rows.length) return;
      state.allData = state.allData.concat(rows);
      initializeUniqueLists();
    })
    .catch(err => console.warn(`Failed to load pref data: ${prefName}`, err));

  return _prefLoadCache[prefName];
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
