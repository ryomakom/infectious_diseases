"use strict";

// Constants
const CATEGORY_ORDER = [
  "新型コロナウイルス","インフルエンザ","RSウイルス","感染性胃腸炎","手足口病","水痘","突発性発しん",
  "伝染性紅斑","ヘルパンギーナ","流行性耳下腺炎","流行性角結膜炎","急性出血性結膜炎","マイコプラズマ肺炎",
  "クラミジア肺炎","細菌性髄膜炎","無菌性髄膜炎","咽頭結膜熱","A群溶血性レンサ球菌咽頭炎","感染性胃腸炎（ロタウイルス）"
];

const PREF_ORDER = [
  "全国","北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県",
  "和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県",
  "宮崎県","鹿児島県","沖縄県"
];

const RANKING_PAGE_SIZE = 10;
const RANKING_DISEASE_ALL_VALUE = "__all__";

const parseDate = d3.timeParse("%Y-%m-%d");
const color = d3.scaleOrdinal(d3.schemeCategory10);

const state = {
  allData: [],
  rankingData: [],
  precomputedTopHighlights: null,
  newsDigest: null,
  alertThresholdsMap: {},
  uniquePrefectures: [],
  uniqueCategories: [],
  allCategoryOrder: [...CATEGORY_ORDER],
  visibleRows: RANKING_PAGE_SIZE,
  sortKey: "ratio_alert",
  sortDesc: true,
  selectedRankingPrefectures: new Set(["全国"]),
  selectedDiseases: new Set(),
  selectedChartPrefectures: new Set(),
  selectedCategories: new Set(["新型コロナウイルス", "インフルエンザ", "RSウイルス"]),
  activeDigestCategory: null,
  categoryDisplayOrder: ["新型コロナウイルス", "インフルエンザ", "RSウイルス"],
  highlightedPrefByCategory: {},
  savedBrushExtents: {},
  chartRenderCache: {}
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const els = {
  lastUpdated: $("#last-updated"),
  latestData: $("#latest-data"),
  rankingCaption: $("#ranking-caption"),
  rankingBody: $("#ranking-body"),
  rankingMoreWrap: $("#ranking-more-wrap"),
  rankingMoreBtn: $("#ranking-more-btn"),
  rankingPrefTags: $("#ranking-pref-tags"),
  rankingDiseaseTags: $("#ranking-disease-tags"),
  rankingPrefDropdown: $("#ranking-pref-dropdown"),
  rankingPrefDropdownBtn: $("#ranking-pref-dropdown-btn"),
  rankingPrefDropdownContent: $("#ranking-pref-dropdown-content"),
  rankingPrefReset: $("#ranking-pref-reset"),
  rankingDiseaseDropdown: $("#ranking-disease-dropdown"),
  rankingDiseaseDropdownBtn: $("#ranking-disease-dropdown-btn"),
  rankingDiseaseDropdownContent: $("#ranking-disease-dropdown-content"),
  rankingDiseaseReset: $("#ranking-disease-reset"),
  rankingTopHighlights: $("#ranking-top-highlights"),
  newsDigestSection: $("#news-digest-section"),
  rankingSortAnnounce: $("#ranking-sort-announce"),
  prefSelected: $("#pref-selected"),
  diseaseSelected: $("#disease-selected"),
  prefDropdown: $("#pref-dropdown"),
  dropdownBtn: $("#dropdown-btn"),
  dropdownContent: $("#dropdown-content"),
  prefReset: $("#pref-reset"),
  diseaseDropdown: $("#disease-dropdown"),
  diseaseDropdownBtn: $("#disease-dropdown-btn"),
  diseaseDropdownContent: $("#disease-dropdown-content"),
  diseaseReset: $("#disease-reset"),
  chartContainer: $("#chart-container")
};

let tooltip = d3.select("body").select(".tooltip");
if (tooltip.empty()) {
  tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);
} else {
  tooltip.html("").style("opacity", 0);
}

function cssSafe(str) {
  return encodeURIComponent(String(str)).replace(/%/g, "_");
}

function isNationwide(pref) {
  return pref === "全国" || pref === "Nationwide";
}

function isTokyo(pref) {
  return pref === "東京都" || pref === "Tokyo";
}

function prefColor(pref) {
  if (isNationwide(pref)) return "blue";
  if (isTokyo(pref)) return "red";
  return color(pref);
}

function categoryToDisplay(cat) {
  if (!cat) return cat;
  const map = {
    "COVID-19": "新型コロナウイルス",
    "ＲＳウイルス感染症": "RSウイルス",
    "Ａ群溶血性レンサ球菌咽頭炎": "A群溶血性レンサ球菌咽頭炎"
  };
  return map[cat] !== undefined ? map[cat] : cat;
}

// ===================================================
// 感染症解説ページ リンクユーティリティ
// ===================================================

const DISEASE_ANCHOR_MAP = {
  "新型コロナウイルス": "covid19",
  "インフルエンザ": "influenza",
  "RSウイルス": "rsv",
  "感染性胃腸炎": "gastroenteritis",
  "手足口病": "hfmd",
  "水痘": "varicella",
  "突発性発しん": "roseola",
  "伝染性紅斑": "erythema",
  "ヘルパンギーナ": "herpangina",
  "流行性耳下腺炎": "mumps",
  "流行性角結膜炎": "ekc",
  "急性出血性結膜炎": "ahc",
  "マイコプラズマ肺炎": "mycoplasma",
  "クラミジア肺炎": "chlamydia",
  "細菌性髄膜炎": "bacterial-meningitis",
  "無菌性髄膜炎": "viral-meningitis",
  "咽頭結膜熱": "pharyngoconjunctival",
  "A群溶血性レンサ球菌咽頭炎": "strep",
  "感染性胃腸炎（ロタウイルス）": "rotavirus",
  "百日咳": "pertussis"
};

function getDiseaseAnchor(category) {
  return DISEASE_ANCHOR_MAP[category] || null;
}

function openDiseaseInfo(category, event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const anchor = getDiseaseAnchor(category);
  if (!anchor) return;
  const url = "disclaimer.html#" + anchor;
  const isMobile = window.matchMedia("(pointer: coarse)").matches;
  if (isMobile) {
    window.open(url, "_blank");
  } else {
    window.open(url, "diseaseInfo", "width=520,height=680,scrollbars=yes,resizable=yes");
  }
}

function makeDiseaseInfoLink(category) {
  const anchor = getDiseaseAnchor(category);
  if (!anchor) return null;
  const a = document.createElement("a");
  a.className = "disease-info-link";
  a.href = "disclaimer.html#" + anchor;
  a.textContent = "↗";
  a.setAttribute("aria-label", category + "の解説");
  a.setAttribute("title", "解説ページを開く");
  a.addEventListener("click", function(e) {
    openDiseaseInfo(category, e);
  });
  return a;
}

function prefToDisplay(pref) {
  if (!pref) return pref;
  if (pref === "Tokyo" || pref === "東京都") return "東京都";
  if (pref === "Nationwide" || pref === "全国") return "全国";
  return pref;
}

function getSelectedDropdownPrefectures() {
  const prefs = Array.from(state.selectedChartPrefectures);
  return prefs.length ? prefs : ["全国"];
}

function computeTickInterval([x0, x1]) {
  const diffMonths = (x1.getFullYear() - x0.getFullYear()) * 12 + (x1.getMonth() - x0.getMonth());
  if (diffMonths < 6) return d3.timeMonth.every(1);
  if (diffMonths < 12) return d3.timeMonth.every(2);
  if (diffMonths < 24) return d3.timeMonth.every(4);
  if (diffMonths < 60) return d3.timeYear.every(1);
  if (diffMonths < 96) return d3.timeYear.every(2);
  return d3.timeYear.every(3);
}

function computeTickFormat([x0, x1]) {
  const diffMonths = (x1.getFullYear() - x0.getFullYear()) * 12 + (x1.getMonth() - x0.getMonth());
  if (diffMonths < 12) return d3.timeFormat("%-m月");
  if (diffMonths < 24) return d3.timeFormat("%Y年%-m月");
  return d3.timeFormat("%Y年");
}

function computeCustomYAxisTicks(maxValue) {
  if (!isFinite(maxValue) || maxValue <= 0) return [0];
  const rough = maxValue / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const stepCandidates = [1, 2, 5, 10].map(d => d * pow);
  let step = stepCandidates.find(s => rough <= s) || stepCandidates[stepCandidates.length - 1];
  const top = Math.ceil(maxValue / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return ticks;
}

function removeOverlappingTicksX(axisSelection) {
  const ticks = axisSelection.selectAll(".tick text").nodes();
  let prevRight = -Infinity;
  ticks.forEach(node => {
    node.style.display = "";
    const box = node.getBBox();
    const x = node.parentNode.transform.baseVal.consolidate()?.matrix.e || 0;
    const left = x + box.x;
    const right = left + box.width;
    if (left < prevRight + 4) {
      node.style.display = "none";
    } else {
      prevRight = right;
    }
  });
}

function hideYAxisTicksOverlappingUnit(svgSelection) {
  const unitNode = svgSelection.select(".y-axis-unit").node();
  if (!unitNode) return;
  const ub = unitNode.getBoundingClientRect();
  const padY = 2;
  const unitTop = ub.top - padY;
  const unitBottom = ub.bottom + padY;
  svgSelection.selectAll(".y-axis .tick text").each(function () {
    this.style.display = "";
    const b = this.getBoundingClientRect();
    const verticalOverlap = !(b.bottom <= unitTop || b.top >= unitBottom);
    if (verticalOverlap) this.style.display = "none";
  });
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sanitizeCsvFilename(name) {
  const base = String(name ?? "chart")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "chart") + ".csv";
}

function downloadCsv(filename, rows) {
  const csvText = rows.map(row => row.map(csvEscape).join(",")).join("\r\n");
  // Excel で文字化けしないよう UTF-8 BOM を付与
  const blob = new Blob(["\uFEFF", csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitizeCsvFilename(String(filename || "chart").replace(/\.csv$/i, ""));
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadSingleChartCsv(category, data) {
  const rows = [
    ["date", "pref", "category", "value", "week_label_clean"],
    ...data.slice().sort((a, b) => a.date - b.date).map(d => [
      d3.timeFormat("%Y-%m-%d")(d.date),
      d.pref,
      d.category,
      d.value,
      d.weekLabel || ""
    ])
  ];
  downloadCsv(category, rows);
}

// Daily cache-buster: forces browsers to revalidate CSVs once per day
const _cacheBuster = (() => {
  const d = new Date();
  return `?v=${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
})();

function buildPathCandidates(relativePath) {
  const p = String(relativePath || "").replace(/^\.\//, "");
  const candidates = [
    p,
    "./" + p,
    "docs/" + p,
    "./docs/" + p,
    "infectious_diseases_trends-main/docs/" + p
  ];
  return Array.from(new Set(candidates));
}

async function loadCsvFlexible(relativePath, rowParser) {
  const candidates = buildPathCandidates(relativePath);
  let lastError = null;
  for (const path of candidates) {
    try {
      const data = await d3.csv(path + _cacheBuster, rowParser);
      console.log("Loaded CSV:", path, "(" + data.length + ")");
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("CSV load failed: " + relativePath);
}

async function loadTextFlexible(relativePath) {
  const candidates = buildPathCandidates(relativePath);
  let lastError = null;
  for (const path of candidates) {
    try {
      const response = await fetch(path + _cacheBuster);
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      console.log("Loaded text:", path);
      return await response.text();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Text load failed: " + relativePath);
}
