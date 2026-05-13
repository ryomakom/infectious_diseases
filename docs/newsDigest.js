"use strict";

/**
 * @typedef {Object} NewsDigestItem
 * @property {string} [category]
 * @property {string} [pref]
 * @property {number|null} [current_ma4]
 * @property {number|null} [ratio_alert]
 * @property {number|null} [importance_score]
 * @property {number|null} [seasonal_zscore]
 */

/**
 * @typedef {Object} NewsDigest
 * @property {string} [week]
 * @property {{category?:string, reason?:string}|null} [lead]
 * @property {{category?:string,pref?:string,flags?:string[]}|null} [top_news]
 * @property {{headline?:string, summary?:string, bullets?:string[]}|null} [generated_text]
 * @property {NewsDigestItem[]} [top_prefectures]
 * @property {NewsDigestItem[]} [rising]
 * @property {NewsDigestItem[]} [alerts]
 * @property {NewsDigestItem[]} [anomalies]
 * @property {NewsDigestItem[]} [improving]
 * @property {string} [spread_type]
 * @property {string[]} [affected_blocks]
 */

const BLOCK_TO_PREFS = {
  "北海道": ["北海道"],
  "東北": ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"],
  "関東": ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"],
  "中部": ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県"],
  "近畿": ["三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"],
  "中国": ["鳥取県", "島根県", "岡山県", "広島県", "山口県"],
  "四国": ["徳島県", "香川県", "愛媛県", "高知県"],
  "九州": ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"]
};

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function formatSmallNumber(value, suffix = "") {
  return Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : "—";
}

function toDigestItems(value) {
  return asArray(value).map(item => isObject(item) ? item : {}).slice(0, 3);
}

function normalizeNewsDigest(raw) {
  if (!isObject(raw)) return null;
  const generated = isObject(raw.generated_text) ? raw.generated_text : {};
  const lead = isObject(raw.lead) ? raw.lead : {};
  const topNews = isObject(raw.top_news) ? raw.top_news : {};
  return {
    week: asString(raw.week, ""),
    lead: {
      category: asString(lead.category, ""),
      reason: asString(lead.reason, "")
    },
    top_news: {
      category: asString(topNews.category, ""),
      pref: asString(topNews.pref, ""),
      flags: asArray(topNews.flags).filter(v => typeof v === "string")
    },
    generated_text: {
      headline: asString(generated.headline, ""),
      summary: asString(generated.summary, ""),
      bullets: asArray(generated.bullets).filter(v => typeof v === "string")
    },
    top_prefectures: toDigestItems(raw.top_prefectures),
    rising: toDigestItems(raw.rising),
    alerts: toDigestItems(raw.alerts),
    anomalies: toDigestItems(raw.anomalies),
    improving: toDigestItems(raw.improving),
    spread_type: asString(raw.spread_type, ""),
    affected_blocks: asArray(raw.affected_blocks).filter(v => typeof v === "string")
  };
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(v => typeof v === "string" && v)));
}

function getPrefsFromBlocks(blocks) {
  const all = [];
  (blocks || []).forEach(block => {
    const prefs = BLOCK_TO_PREFS[block];
    if (prefs) all.push(...prefs);
  });
  return uniqueStrings(all).filter(pref => state.uniquePrefectures.includes(pref));
}

function applyChartPeriodForCategory(category, prefs, weeks) {
  if (!category || !Number.isFinite(weeks) || weeks <= 0) return;
  const source = state.allData.filter(d => d.category === category && (!prefs.length || prefs.includes(d.pref)));
  const end = d3.max(source, d => d.date) || d3.max(state.allData, d => d.date);
  if (!end) return;
  const start = new Date(end);
  start.setDate(start.getDate() - Math.floor(weeks * 7));
  state.savedBrushExtents[category] = [start, end];
}

function applyDigestNavigationSelection(options) {
  const category = asString(options?.category);
  const prefs = uniqueStrings(asArray(options?.prefs)).filter(pref => state.uniquePrefectures.includes(pref));
  const periodWeeks = Number(options?.periodWeeks);
  const scrollTarget = asString(options?.scrollTarget, "");
  const updateRankingPrefs = !!options?.updateRankingPrefs;
  const updateChartPrefs = !!options?.updateChartPrefs;

  // Ranking side: keep prefecture selection unless explicitly requested.
  if (updateRankingPrefs && state.selectedRankingPrefectures) {
    state.selectedRankingPrefectures.clear();
    (prefs.length ? prefs : ["全国"]).forEach(pref => state.selectedRankingPrefectures.add(pref));
  }
  if (state.selectedDiseases) {
    state.selectedDiseases.clear();
    if (category) state.selectedDiseases.add(category);
  }
  state.visibleRows = RANKING_PAGE_SIZE;
  if (typeof renderRankingPrefTags === "function") renderRankingPrefTags();
  if (typeof renderDiseaseTags === "function") renderDiseaseTags();
  if (typeof refreshSelectOptions === "function") {
    refreshSelectOptions(els.rankingPrefAdd, state.uniquePrefectures, state.selectedRankingPrefectures);
    refreshSelectOptions(els.rankingDiseaseAdd, state.uniqueCategories, state.selectedDiseases, true);
  }
  if (typeof refreshRankingTable === "function") refreshRankingTable();

  // Chart side: keep prefecture selection unless explicitly requested.
  if (updateChartPrefs && state.selectedChartPrefectures) {
    state.selectedChartPrefectures.clear();
    (prefs.length ? prefs : ["全国"]).forEach(pref => state.selectedChartPrefectures.add(pref));
  }
  if (state.selectedCategories) {
    state.selectedCategories.clear();
    if (category) state.selectedCategories.add(category);
  }
  if (category) {
    state.categoryDisplayOrder = state.categoryDisplayOrder.filter(c => c !== category);
    state.categoryDisplayOrder.unshift(category);
  }
  if (typeof refreshPrefectureOptions === "function") refreshPrefectureOptions();
  if (typeof refreshDiseaseOptions === "function") refreshDiseaseOptions();
  if (typeof renderChartPrefectureTags === "function") renderChartPrefectureTags();
  if (typeof renderChartDiseaseTags === "function") renderChartDiseaseTags();
  applyChartPeriodForCategory(category, prefs, Number.isFinite(periodWeeks) ? periodWeeks : null);
  if (typeof drawAllCharts === "function" && typeof getSelectedDropdownPrefectures === "function") {
    drawAllCharts(getSelectedDropdownPrefectures());
  }

  const target = scrollTarget === "ranking"
    ? document.querySelector(".ranking-section")
    : scrollTarget === "chart"
      ? document.getElementById("chart-container")
      : scrollTarget === "highlights"
        ? document.getElementById("ranking-top-highlights")
        : null;
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function makeSignalChip(item, mode) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "news-signal-chip";
  const cat = asString(item?.category, "—");
  const pref = asString(item?.pref, "—");
  btn.textContent = `${cat}（${pref}）`;
  btn.addEventListener("click", () => {
    const weeks = mode === "rising" ? 26 : 52;
    applyDigestNavigationSelection({
      category: cat,
      prefs: pref ? [pref] : [],
      periodWeeks: weeks,
      updateRankingPrefs: true,
      updateChartPrefs: true,
      scrollTarget: "chart"
    });
    state.activeDigestCategory = cat;
    if (typeof window.renderCategoryHighlights === "function") {
      window.renderCategoryHighlights(cat);
    }
    renderNewsDigestSection(state.newsDigest);
  });
  return btn;
}

function createSignalCard(title, mode, items, noteText) {
  const card = document.createElement("section");
  card.className = "news-signal-card";
  const h = document.createElement("h4");
  h.className = "news-signal-title";
  h.textContent = title;
  card.appendChild(h);
  if (noteText) {
    const note = document.createElement("p");
    note.className = "news-signal-note";
    note.textContent = noteText;
    card.appendChild(note);
  }
  const chips = document.createElement("div");
  chips.className = "news-signal-chips";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "news-signal-empty";
    empty.textContent = "該当データなし";
    card.appendChild(empty);
  } else {
    items.slice(0, 3).forEach(item => chips.appendChild(makeSignalChip(item, mode)));
    card.appendChild(chips);
  }
  return card;
}

function createSpreadCard(digest) {
  const card = document.createElement("section");
  card.className = "news-signal-card";
  card.innerHTML = `<h4 class="news-signal-title">広域化</h4>`;
  const note = document.createElement("p");
  note.className = "news-signal-note";
  const blocks = digest.affected_blocks.length ? digest.affected_blocks.join("・") : "該当なし";
  note.textContent = `${digest.spread_type || "未判定"} / 影響ブロック: ${blocks}`;
  card.appendChild(note);

  const blockButtons = document.createElement("div");
  blockButtons.className = "news-signal-chips";
  const topCategory = digest.top_news.category || digest.lead.category || "";
  if (digest.affected_blocks.length) {
    digest.affected_blocks.forEach(block => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "news-signal-chip news-signal-chip--block";
      b.textContent = block;
      b.addEventListener("click", () => {
        const prefs = getPrefsFromBlocks([block]);
        applyDigestNavigationSelection({
          category: topCategory,
          prefs,
          periodWeeks: 52,
          updateRankingPrefs: true,
          updateChartPrefs: true,
          scrollTarget: "ranking"
        });
        state.activeDigestCategory = topCategory || null;
        if (topCategory && typeof window.renderCategoryHighlights === "function") {
          window.renderCategoryHighlights(topCategory);
        }
        renderNewsDigestSection(state.newsDigest);
      });
      blockButtons.appendChild(b);
    });
  } else {
    const empty = document.createElement("p");
    empty.className = "news-signal-empty";
    empty.textContent = "ブロック情報なし";
    card.appendChild(empty);
  }
  card.appendChild(blockButtons);
  return card;
}

function pickAlertLeadCategoryFromNationwide() {
  if (!Array.isArray(state.rankingData) || !state.rankingData.length) return "";
  const rows = state.rankingData
    .filter(d => (d.pref === "全国" || d.pref === "全国平均") && Number.isFinite(d.ratio_alert))
    .slice()
    .sort((a, b) => b.ratio_alert - a.ratio_alert);
  return rows[0]?.category || "";
}

function pickRisingLeadCategory(digest) {
  return asString(digest?.rising?.[0]?.category, "");
}

function pickAnomalyLeadCategory(digest) {
  return asString(digest?.anomalies?.[0]?.category, "");
}

function buildIntroSignals(digest) {
  return [
    {
      key: "alert",
      label: "最も警戒が必要",
      category: pickAlertLeadCategoryFromNationwide() || asString(digest?.lead?.category, ""),
      description: "（全国平均の警報基準比が最も高い）",
      noDataMessage: "今週は警戒が必要な感染症はありません",
      definition: "定点あたり患者数を、警報を出すときの基準となる人数で割った値（警報基準比）が最も高い感染症。1.0倍を超えると警報水準を突破している状態"
    },
    {
      key: "rising",
      label: "最も増加が激しい",
      category: pickRisingLeadCategory(digest),
      description: "（前週比増加率が最も高い）",
      noDataMessage: "今週は急増中の感染症はありません",
      definition: "前週と比べた定点あたり患者数の増加率が最も高い感染症。前週0.05人以上、今週0.1人以上の感染症から抽出",
      wowRatio: (() => {
        const r = digest?.rising?.[0];
        if (!r) return null;
        if (Number.isFinite(r.current_value) && Number.isFinite(r.previous_value) && r.previous_value > 0) {
          return r.current_value / r.previous_value;
        }
        if (Number.isFinite(r.growth1Rate)) return 1 + r.growth1Rate;
        return null;
      })()
    },
    {
      key: "anomaly",
      label: "最も季節外れの多さ",
      category: pickAnomalyLeadCategory(digest),
      description: "（平年パターンからの乖離）",
      noDataMessage: "今週は季節外れの増加はありません",
      definition: "過去の同時期と比べ、定点あたり患者数の乖離（Zスコア）が最も大きい感染症。「今の水準がどれだけ異常か」を示す"
    }
  ];
}

function pickCardMetricRow(category) {
  if (!category || !Array.isArray(state.rankingData)) return null;
  const rows = state.rankingData.filter(d => d.category === category);
  if (!rows.length) return null;
  const nationwide = rows.find(d => d.pref === "全国" || d.pref === "全国平均");
  if (nationwide) return nationwide;
  return rows
    .slice()
    .sort((a, b) => {
      const av = Number.isFinite(a.current_ma4) ? a.current_ma4 : -Infinity;
      const bv = Number.isFinite(b.current_ma4) ? b.current_ma4 : -Infinity;
      return bv - av;
    })[0] || null;
}

function buildSignalSparkCard(item) {
  const wrap = document.createElement("div");
  wrap.className = "news-digest-spark-card-wrap";
  if (item.key) wrap.dataset.signalKey = item.key;

  const card = document.createElement("button");
  card.type = "button";
  card.className = "news-digest-spark-card";
  const hasCategory = !!item.category;
  if (hasCategory && item.category === state.activeDigestCategory) {
    card.classList.add("is-active");
  }
  if (!hasCategory) {
    card.classList.add("is-disabled");
  }
  const metricRow = hasCategory ? pickCardMetricRow(item.category) : null;
  const prefForSpark = asString(metricRow?.pref, "全国");
  const currentMa4 = Number(metricRow?.current_ma4);
  const alertThreshold = (metricRow?.alert_start != null && Number.isFinite(metricRow.alert_start))
    ? metricRow.alert_start
    : null;
  const ratioAlert = (metricRow?.ratio_alert != null && Number.isFinite(metricRow.ratio_alert))
    ? metricRow.ratio_alert
    : null;
  const spark = (typeof window.buildMiniSparkline === "function")
    ? window.buildMiniSparkline(item.category, prefForSpark, 100, 52)
    : { normalPath: "", alertPath: "", values: [], yMax: 1, threshold: null };
  const noDataMessage = asString(item.noDataMessage, "今週は該当する感染症はありません");
  let alertThresholdHtml = "";
  if (item.key === "rising") {
    const wow = Number.isFinite(item.wowRatio) ? item.wowRatio : null;
    alertThresholdHtml = wow !== null
      ? `<p class="news-digest-spark-alert-threshold news-digest-spark-alert-threshold--split">
          <span class="ratio-prefix ratio-prefix-main">前の週と</span><span class="ratio-prefix ratio-prefix-detail">比べて</span><span class="news-digest-spark-ratio ${wow >= 2 ? "is-over" : ""}"><span class="ratio-num">${Math.round((wow - 1) * 100)}</span><span class="ratio-unit">%増</span></span>
         </p>`
      : "";
  } else if (item.key === "anomaly") {
    const ryoy = (metricRow?.ratio_yoy != null && Number.isFinite(metricRow.ratio_yoy)) ? metricRow.ratio_yoy : null;
    if (ryoy !== null) {
      const pct = Math.round((ryoy - 1) * 100);
      alertThresholdHtml = `<p class="news-digest-spark-alert-threshold news-digest-spark-alert-threshold--split">
          <span class="ratio-prefix ratio-prefix-main">平年同時期</span><span class="ratio-prefix ratio-prefix-detail">より</span><span class="news-digest-spark-ratio ${ryoy >= 2 ? "is-over" : ""}"><span class="ratio-num">${pct}</span><span class="ratio-unit">%多い</span></span>
         </p>`;
    }
  } else if (alertThreshold !== null) {
    alertThresholdHtml = `<p class="news-digest-spark-alert-threshold news-digest-spark-alert-threshold--split">
        <span class="ratio-prefix ratio-prefix-main">警報基準値</span><span class="ratio-prefix ratio-prefix-detail">（${Math.round(alertThreshold)}人）の</span>${ratioAlert !== null ? `<span class="news-digest-spark-ratio ${ratioAlert >= 1 ? "is-over" : ""}"><span class="ratio-num">${ratioAlert.toFixed(2)}</span><span class="ratio-unit">倍</span></span>` : ""}
       </p>`;
  }
  const definition = asString(item.definition, "");
  const infoHtml = definition
    ? `<span class="signal-info-wrap"><span class="signal-info-btn" aria-label="定義" role="note">?</span><span class="signal-definition" role="tooltip">${definition}</span></span>`
    : "";
  card.innerHTML = hasCategory ? `
    <p class="news-digest-spark-kicker">${item.label}${infoHtml}</p>
    <p class="news-digest-spark-category">${item.category}</p>
    <div class="news-digest-spark-body">
      <div class="news-digest-spark-metric-col">
        <p class="news-digest-spark-metric-value"><span class="news-digest-spark-metric-label metric-lbl-top">定点あたり</span><span class="metric-lbl-row2"><span class="news-digest-spark-metric-label">患者数</span><span class="news-digest-spark-metric-number">${formatSmallNumber(currentMa4)}<span class="news-digest-spark-unit">人</span></span></span></p>
        ${alertThresholdHtml}
      </div>
      <div class="news-digest-spark-chart-col">
        <svg class="top-metric-sparkline" aria-hidden="true" width="100" height="52" viewBox="0 0 100 52" data-values="${spark.values.join("|")}" data-y-max="${spark.yMax}" data-threshold="${Number.isFinite(spark.threshold) ? spark.threshold : ""}" data-pad-x="${spark.padX || 0}" data-pad-y="${spark.padY || 0}">
          <path class="top-metric-sparkline-path" d="${spark.normalPath}"></path>
          <path class="top-metric-sparkline-path top-metric-sparkline-path-alert" d="${spark.alertPath}"></path>
          <circle class="top-metric-spark-dot" cx="0" cy="0" r="3"></circle>
        </svg>
      </div>
    </div>
  ` : `
    <p class="news-digest-spark-kicker">${item.label}${infoHtml}</p>
    <p class="news-digest-spark-no-data">${noDataMessage}</p>
  `;
  // 「?」ボタンにホバー/タップ挙動を付与（ranking.js の共通ユーティリティを使用）
  const infoBtn = card.querySelector(".signal-info-btn");
  const infoDef = card.querySelector(".signal-definition");
  if (infoBtn && infoDef && typeof initHelpTrigger === "function") {
    initHelpTrigger(infoBtn, infoDef);
  }

  card.addEventListener("click", () => {
    if (item.category) {
      handleIntroSignalClick(item.category, item.key, wrap);
    } else {
      handleNoDataSignalClick(item.key, wrap);
    }
  });
  wrap.appendChild(card);

  return wrap;
}

const SIGNAL_PREF_CONFIG = {
  alert:   { title: "定点あたり患者数の多い都道府県", description: "最も警戒が必要",       sort: (a, b) => (b.current_ma4 ?? -Infinity) - (a.current_ma4 ?? -Infinity) },
  rising:  { title: "定点あたり患者数の多い都道府県", description: "最も増加が激しい",     sort: (a, b) => (b.current_ma4 ?? -Infinity) - (a.current_ma4 ?? -Infinity) },
  anomaly: { title: "定点あたり患者数の多い都道府県", description: "最も季節外れの多さ",   sort: (a, b) => (b.current_ma4 ?? -Infinity) - (a.current_ma4 ?? -Infinity) },
};

const SIGNAL_NO_DATA_MESSAGES = {
  alert:   "今週は警戒が必要な感染症はありません",
  rising:  "今週は急増中の感染症はありません",
  anomaly: "今週は季節外れの増加はありません",
};

function buildTopPrefsSection(category, signalKey) {
  const config = SIGNAL_PREF_CONFIG[signalKey] || SIGNAL_PREF_CONFIG.alert;
  const section = document.createElement("section");
  section.className = "signal-top-prefs";
  section.setAttribute("aria-label", config.title);

  if (!category) {
    const msg = SIGNAL_NO_DATA_MESSAGES[signalKey] || "今週は該当する感染症はありません";
    const p = document.createElement("p");
    p.className = "signal-top-prefs-no-data";
    p.textContent = msg;
    section.appendChild(p);
    return section;
  }
  if (!Array.isArray(state.rankingData)) return section;

  const rows = state.rankingData
    .filter(d => d.category === category && d.pref !== "全国" && d.pref !== "全国平均")
    .filter(d => Number.isFinite(d.current_ma4))
    .sort(config.sort)
    .slice(0, 3);

  if (!rows.length) return section;


  const prefTitle = document.createElement("p");
  prefTitle.className = "signal-top-prefs-title";
  prefTitle.textContent = "患者がとくに多い都道府県は";
  section.appendChild(prefTitle);

  const grid = document.createElement("div");
  grid.className = "signal-top-prefs-grid";

  rows.forEach((row, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "news-digest-spark-card-wrap";

    const card = document.createElement("button");
    card.type = "button";
    card.className = "news-digest-spark-card";

    const spark = (typeof window.buildMiniSparkline === "function")
      ? window.buildMiniSparkline(row.category, row.pref, 100, 52)
      : { normalPath: "", alertPath: "", values: [], yMax: 1, threshold: null, padX: 0, padY: 0 };

    const alertThreshold = (row.alert_start != null && Number.isFinite(row.alert_start)) ? row.alert_start : null;
    const ratioAlert = (row.ratio_alert != null && Number.isFinite(row.ratio_alert)) ? row.ratio_alert : null;
    // アラートカードと同じ split 構造: 「警報基準値」1行目、「（N人）の 0.40倍」2行目
    const alertThresholdHtml = alertThreshold !== null
      ? `<p class="news-digest-spark-alert-threshold news-digest-spark-alert-threshold--split">
          <span class="ratio-prefix ratio-prefix-main">警報基準値</span><span class="ratio-prefix ratio-prefix-detail">（${Math.round(alertThreshold)}人）の</span>${ratioAlert !== null ? `<span class="news-digest-spark-ratio ${ratioAlert >= 1 ? "is-over" : ""}"><span class="ratio-num">${ratioAlert.toFixed(2)}</span><span class="ratio-unit">倍</span></span>` : ""}
         </p>`
      : "";

    card.innerHTML = `
      <p class="news-digest-spark-category">${row.pref}</p>
      <div class="news-digest-spark-body">
        <div class="news-digest-spark-metric-col">
          <p class="news-digest-spark-metric-value"><span class="news-digest-spark-metric-label metric-lbl-top">定点あたり</span><span class="metric-lbl-row2"><span class="news-digest-spark-metric-label">患者数</span><span class="news-digest-spark-metric-number">${Number.isFinite(row.current_ma4) ? row.current_ma4.toFixed(2) : "—"}<span class="news-digest-spark-unit">人</span></span></span></p>
          ${alertThresholdHtml}
        </div>
        <div class="news-digest-spark-chart-col">
          <svg class="top-metric-sparkline" aria-hidden="true" width="100" height="52" viewBox="0 0 100 52"
            data-values="${spark.values.join("|")}" data-y-max="${spark.yMax}"
            data-threshold="${Number.isFinite(spark.threshold) ? spark.threshold : ""}"
            data-pad-x="${spark.padX || 0}" data-pad-y="${spark.padY || 0}">
            <path class="top-metric-sparkline-path" d="${spark.normalPath}"></path>
            <path class="top-metric-sparkline-path top-metric-sparkline-path-alert" d="${spark.alertPath}"></path>
            <circle class="top-metric-spark-dot" cx="0" cy="0" r="3"></circle>
          </svg>
        </div>
      </div>
    `;

    card.addEventListener("click", () => {
      if (typeof goToChart === "function") goToChart(row.pref, row.category);
    });

    wrap.appendChild(card);
    grid.appendChild(wrap);
  });

  section.appendChild(grid);
  return section;
}

function handleIntroSignalClick(category, signalKey, clickedWrap) {
  if (!category) return;
  const oldRect = clickedWrap ? clickedWrap.getBoundingClientRect() : null;
  if (state.selectedRankingPrefectures) state.selectedRankingPrefectures.clear();
  applyDigestNavigationSelection({ category, periodWeeks: 52 });
  state.activeDigestCategory = category;
  state.activeSignalKey = signalKey || "alert";
  renderNewsDigestSection(state.newsDigest);
  requestAnimationFrame(() => {
    const section = els.newsDigestSection;
    if (!section) return;
    const panel = section.querySelector(".signal-tab-panel");
    if (panel) {
      panel.classList.add("is-animating-in");
      panel.addEventListener("animationend", () => panel.classList.remove("is-animating-in"), { once: true });
    }
    const activeWrap = section.querySelector('.news-digest-spark-card-wrap[data-active-tab="1"]');
    if (!activeWrap) return;
    if (oldRect) {
      const newRect = activeWrap.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top  - newRect.top;
      const scaleX = Math.min(1, oldRect.width  / (newRect.width  || 1));
      const scaleY = Math.min(1, oldRect.height / (newRect.height || 1));
      const hasMotion = Math.abs(dx) > 4 || Math.abs(dy) > 4 || scaleX < 0.95;
      if (hasMotion) {
        activeWrap.style.transformOrigin = "top left";
        activeWrap.style.transition = "none";
        activeWrap.style.transform = `translate(${dx}px,${dy}px) scale(${scaleX},${scaleY})`;
        activeWrap.style.zIndex = "10";
        activeWrap.offsetHeight; // force reflow
        activeWrap.style.transition = "transform 0.72s cubic-bezier(0.34,1.4,0.64,1)";
        activeWrap.style.transform = "";
        activeWrap.addEventListener("transitionend", () => {
          activeWrap.style.cssText = "";
        }, { once: true });
        return;
      }
    }
    activeWrap.classList.add("is-animating-in");
    activeWrap.addEventListener("animationend", () => activeWrap.classList.remove("is-animating-in"), { once: true });
  });
}

function handleNoDataSignalClick(signalKey, clickedWrap) {
  const oldRect = clickedWrap ? clickedWrap.getBoundingClientRect() : null;
  state.activeSignalKey = signalKey;
  state.activeDigestCategory = null;
  renderNewsDigestSection(state.newsDigest);
  requestAnimationFrame(() => {
    const section = els.newsDigestSection;
    if (!section) return;
    const panel = section.querySelector(".signal-tab-panel");
    if (panel) {
      panel.classList.add("is-animating-in");
      panel.addEventListener("animationend", () => panel.classList.remove("is-animating-in"), { once: true });
    }
    const activeWrap = section.querySelector('.news-digest-spark-card-wrap[data-active-tab="1"]');
    if (!activeWrap) return;
    if (oldRect) {
      const newRect = activeWrap.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top  - newRect.top;
      const scaleX = Math.min(1, oldRect.width  / (newRect.width  || 1));
      const scaleY = Math.min(1, oldRect.height / (newRect.height || 1));
      const hasMotion = Math.abs(dx) > 4 || Math.abs(dy) > 4 || scaleX < 0.95;
      if (hasMotion) {
        activeWrap.style.transformOrigin = "top left";
        activeWrap.style.transition = "none";
        activeWrap.style.transform = `translate(${dx}px,${dy}px) scale(${scaleX},${scaleY})`;
        activeWrap.style.zIndex = "10";
        activeWrap.offsetHeight;
        activeWrap.style.transition = "transform 0.72s cubic-bezier(0.34,1.4,0.64,1)";
        activeWrap.style.transform = "";
        activeWrap.addEventListener("transitionend", () => {
          activeWrap.style.cssText = "";
        }, { once: true });
        return;
      }
    }
    activeWrap.classList.add("is-animating-in");
    activeWrap.addEventListener("animationend", () => activeWrap.classList.remove("is-animating-in"), { once: true });
  });
}

function renderNewsDigestSection(rawDigest) {
  if (!els.newsDigestSection) return;
  const root = els.newsDigestSection;
  root.innerHTML = "";

  const digest = normalizeNewsDigest(rawDigest);
  if (!digest) {
    root.innerHTML = `
      <div class="news-digest-card news-digest-card--placeholder">
        <h2>今週の注目</h2>
        <p class="news-digest-placeholder">ニュース要約データを読み込めませんでした。</p>
      </div>
    `;
    return;
  }

  const introSignals = buildIntroSignals(digest);
  const firstSelectable = introSignals.find(item => !!item.category);
  let shouldInitHighlights = false;
  if (!state.activeDigestCategory && !state.activeSignalKey && firstSelectable) {
    state.activeDigestCategory = firstSelectable.category;
    state.activeSignalKey = firstSelectable.key || "alert";
    shouldInitHighlights = true;
  }

  const card = document.createElement("article");
  card.className = "news-digest-card";

  const tabsContainer = document.createElement("div");
  tabsContainer.className = "signal-tabs news-digest-subsection";

  const tabsHeader = document.createElement("div");
  tabsHeader.className = "signal-tabs-header";
  const cardsTitle = document.createElement("h4");
  cardsTitle.className = "news-digest-subtitle";
  cardsTitle.textContent = "3つの切り口で見ると";
  tabsHeader.appendChild(cardsTitle);

  const cardsWrap = document.createElement("div");
  cardsWrap.className = "news-digest-spark-grid signal-tab-triggers";
  if (!introSignals.length) {
    const empty = document.createElement("p");
    empty.className = "news-digest-intro-empty";
    empty.textContent = "注目シグナルを生成できませんでした。";
    cardsWrap.appendChild(empty);
  } else {
    introSignals.forEach(item => {
      const wrap = buildSignalSparkCard(item);
      if (item.key === (state.activeSignalKey || "alert")) {
        wrap.setAttribute("data-active-tab", "1");
      }
      cardsWrap.appendChild(wrap);
    });
  }
  tabsHeader.appendChild(cardsWrap);
  tabsContainer.appendChild(tabsHeader);

  if (typeof window.startMiniSparklineDotAnimations === "function") {
    window.startMiniSparklineDotAnimations(cardsWrap);
  }

  const topPrefs = buildTopPrefsSection(state.activeDigestCategory, state.activeSignalKey || "alert");
  const tabPanel = document.createElement("div");
  tabPanel.className = "signal-tab-panel";
  tabPanel.dataset.signalKey = state.activeSignalKey || "alert";
  tabPanel.appendChild(topPrefs);
  cardsWrap.appendChild(tabPanel); // グリッド内に入れて CSS order でパネル位置を行単位に制御する

  if (typeof window.startMiniSparklineDotAnimations === "function") {
    window.startMiniSparklineDotAnimations(tabPanel);
  }

  // generated_text セクション（headerの直後・最も目立つ位置）
  const gt = digest.generated_text;
  if (gt && gt.bullets && gt.bullets.length) {
    const gtSection = document.createElement("section");
    gtSection.className = "news-digest-generated";
    const label = document.createElement("p");
    label.className = "news-digest-generated-label";
    label.textContent = "いま気をつけたほうがいい感染症";
    gtSection.appendChild(label);
    const ul = document.createElement("ul");
    ul.className = "news-digest-generated-bullets";
    gt.bullets.forEach(b => {
      const li = document.createElement("li");
      const colonIdx = b.indexOf("：");
      if (colonIdx !== -1) {
        const strong = document.createElement("strong");
        strong.textContent = b.slice(0, colonIdx);
        li.appendChild(strong);
        li.appendChild(document.createTextNode("：" + b.slice(colonIdx + 1)));
      } else {
        li.textContent = b;
      }
      ul.appendChild(li);
    });
    gtSection.appendChild(ul);
    card.appendChild(gtSection);
  }

  card.appendChild(tabsContainer);

  // 既存の全国平均カードエリアを非表示
  const oldHighlights = document.getElementById("ranking-top-highlights");
  if (oldHighlights) oldHighlights.style.display = "none";

  root.appendChild(card);
}

function chooseDiverseSignals(digest) {
  const used = new Set();
  const uniqueByKey = (item) => {
    if (!item) return false;
    const k = `${item.category || ""}::${item.pref || ""}`;
    if (used.has(k)) return false;
    used.add(k);
    return true;
  };

  const spreadItem = digest.top_news.category ? {
    category: digest.top_news.category,
    pref: digest.top_news.pref,
    kind: "spread",
    title: "全国的な広がりを示すもの",
    note: `${digest.spread_type || "未判定"} / ${digest.affected_blocks.join("・") || "ブロック情報なし"}`
  } : null;
  if (spreadItem) uniqueByKey(spreadItem);

  const regionalSource = digest.alerts[0] || digest.rising[0] || digest.top_prefectures[0] || null;
  const regionalItem = regionalSource ? {
    category: regionalSource.category,
    pref: regionalSource.pref,
    kind: "regional",
    title: "地域的な突出を示すもの",
    note: "局所の動向を直接確認"
  } : null;
  if (regionalItem && !uniqueByKey(regionalItem)) {
    const alt = (digest.rising.concat(digest.alerts, digest.top_prefectures)).find(it => uniqueByKey(it));
    if (alt) {
      regionalItem.category = alt.category;
      regionalItem.pref = alt.pref;
    }
  }

  const anomalySource = digest.anomalies[0] || null;
  const anomalyItem = anomalySource ? {
    category: anomalySource.category,
    pref: anomalySource.pref,
    kind: "anomaly",
    title: "季節性から外れた異常を示すもの",
    note: `seasonal_zscore ${formatSmallNumber(anomalySource.seasonal_zscore)}`
  } : null;
  if (anomalyItem && !uniqueByKey(anomalyItem)) {
    const altAnom = digest.anomalies.find(it => uniqueByKey(it));
    if (altAnom) {
      anomalyItem.category = altAnom.category;
      anomalyItem.pref = altAnom.pref;
      anomalyItem.note = `seasonal_zscore ${formatSmallNumber(altAnom.seasonal_zscore)}`;
    }
  }

  return [spreadItem, regionalItem, anomalyItem].filter(Boolean);
}

function renderRankingSignalsFromDigest(rawDigest) {
  if (!els.rankingTopHighlights) return false;
  const digest = normalizeNewsDigest(rawDigest);
  if (!digest) return false;

  els.rankingTopHighlights.style.display = "block";
  els.rankingTopHighlights.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "digest-highlights-grid";
  const signals = chooseDiverseSignals(digest);
  if (!signals.length) {
    els.rankingTopHighlights.innerHTML = `<p class="news-digest-placeholder">注目シグナルを生成できませんでした。</p>`;
    return true;
  }

  signals.forEach(sig => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "digest-highlight-card";
    card.innerHTML = `
      <p class="digest-highlight-title">${sig.title}</p>
      <p class="digest-highlight-main">${sig.category || "—"}（${sig.pref || "—"}）</p>
      <p class="digest-highlight-note">${sig.note || ""}</p>
    `;
    card.addEventListener("click", () => {
      const weeks = sig.kind === "rising" ? 26 : (sig.kind === "anomaly" ? 52 : 52);
      const prefs = sig.kind === "spread" && digest.affected_blocks.length
        ? getPrefsFromBlocks(digest.affected_blocks)
        : (sig.pref ? [sig.pref] : []);
      applyDigestNavigationSelection({
        category: sig.category,
        prefs,
        periodWeeks: weeks,
        scrollTarget: "chart"
      });
    });
    wrap.appendChild(card);
  });

  els.rankingTopHighlights.appendChild(wrap);
  return true;
}

window.renderNewsDigestSection = renderNewsDigestSection;
window.renderRankingSignalsFromDigest = renderRankingSignalsFromDigest;
