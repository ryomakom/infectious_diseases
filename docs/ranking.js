"use strict";

let metricHelpInitialized = false;

function updateSelectPlaceholderState(selectEl) {
  if (!selectEl) return;
  selectEl.classList.toggle("is-placeholder", !selectEl.value);
}

function refreshSelectOptions(selectEl, options, selectedSet, keepAllOption = false) {
  if (!selectEl) return;
  const current = selectEl.value;
  const optionHtml = [];
  optionHtml.push('<option value="">ここから追加</option>');
  if (keepAllOption) optionHtml.push(`<option value="${RANKING_DISEASE_ALL_VALUE}">すべて</option>`);
  options.forEach(v => {
    if (!selectedSet.has(v)) optionHtml.push(`<option value="${v}">${v}</option>`);
  });
  selectEl.innerHTML = optionHtml.join("");
  if (current && selectEl.querySelector(`option[value="${CSS.escape(current)}"]`)) {
    selectEl.value = current;
  }
  updateSelectPlaceholderState(selectEl);
}

function renderRankingPrefTags() {
  if (!els.rankingPrefTags) return;
  const prefs = Array.from(state.selectedRankingPrefectures);
  const ordered = PREF_ORDER.filter(p => prefs.includes(p)).concat(prefs.filter(p => !PREF_ORDER.includes(p)).sort());
  els.rankingPrefTags.innerHTML = "";
  ordered.forEach(pref => {
    const span = document.createElement("span");
    span.className = "filter-tag ranking-tag";
    span.setAttribute("role", "button");
    span.tabIndex = 0;
    span.textContent = `${pref} ×`;
    const remove = () => {
      state.selectedRankingPrefectures.delete(pref);
      renderRankingPrefTags();
      refreshSelectOptions(els.rankingPrefAdd, state.uniquePrefectures, state.selectedRankingPrefectures);
      state.visibleRows = RANKING_PAGE_SIZE;
      refreshRankingTable();
    };
    span.addEventListener("click", remove);
    span.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        remove();
      }
    });
    els.rankingPrefTags.appendChild(span);
  });
}

function renderDiseaseTags() {
  if (!els.rankingDiseaseTags) return;
  els.rankingDiseaseTags.innerHTML = "";
  if (!state.selectedDiseases.size) {
    const span = document.createElement("span");
    span.className = "filter-tag ranking-tag ranking-tag--all";
    span.textContent = "すべて";
    els.rankingDiseaseTags.appendChild(span);
    return;
  }
  const ordered = CATEGORY_ORDER.filter(c => state.selectedDiseases.has(c)).concat(Array.from(state.selectedDiseases).filter(c => !CATEGORY_ORDER.includes(c)).sort());
  ordered.forEach(cat => {
    const span = document.createElement("span");
    span.className = "filter-tag ranking-tag";
    span.setAttribute("role", "button");
    span.tabIndex = 0;
    span.textContent = `${cat} ×`;
    const remove = () => {
      state.selectedDiseases.delete(cat);
      renderDiseaseTags();
      refreshSelectOptions(els.rankingDiseaseAdd, state.uniqueCategories, state.selectedDiseases, true);
      state.visibleRows = RANKING_PAGE_SIZE;
      refreshRankingTable();
    };
    span.addEventListener("click", remove);
    span.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        remove();
      }
    });
    els.rankingDiseaseTags.appendChild(span);
  });
}

function sortRankingRows(rows) {
  return rows.slice().sort((a, b) => {
    const av = a[state.sortKey];
    const bv = b[state.sortKey];
    const aa = (av == null || !Number.isFinite(av)) ? -Infinity : av;
    const bb = (bv == null || !Number.isFinite(bv)) ? -Infinity : bv;
    if (aa < bb) return state.sortDesc ? 1 : -1;
    if (aa > bb) return state.sortDesc ? -1 : 1;
    const ci = CATEGORY_ORDER.indexOf(a.category);
    const cj = CATEGORY_ORDER.indexOf(b.category);
    if (ci !== cj) return (ci === -1 ? 999 : ci) - (cj === -1 ? 999 : cj);
    const pi = PREF_ORDER.indexOf(a.pref);
    const pj = PREF_ORDER.indexOf(b.pref);
    return (pi === -1 ? 999 : pi) - (pj === -1 ? 999 : pj);
  });
}

function sparklinePath(values, width, height) {
  if (!values.length) return "";
  const x = d3.scaleLinear().domain([0, values.length - 1]).range([0, width]);
  const yMax = d3.max(values) || 0;
  const y = d3.scaleLinear().domain([0, yMax === 0 ? 1 : yMax]).range([height, 0]);
  return d3.line().x((d, i) => x(i)).y(d => y(d))(values);
}

function buildMiniSparkline(category, pref, width, height, seriesValuesOverride) {
  const hasOverride = Array.isArray(seriesValuesOverride) && seriesValuesOverride.length > 0;
  const values = hasOverride
    ? seriesValuesOverride.map(Number).filter(v => Number.isFinite(v)).slice(-52)
    : getSeriesFor(category, pref).filter(d => Number.isFinite(d.value)).slice(-52).map(d => d.value);
  if (!values.length) {
    return { allPath: "", alertPath: "", values: [], yMax: 1, threshold: null };
  }
  const padX = 4;
  const padY = 4;
  const x = d3.scaleLinear().domain([0, values.length - 1]).range([padX, width - padX]);
  const yMax = d3.max(values) || 0;
  const y = d3.scaleLinear().domain([0, yMax === 0 ? 1 : yMax]).range([height - padY, padY]);
  const threshold = state.alertThresholdsMap[category];

  const paths = { normal: "", alert: "" };
  for (let i = 0; i < values.length - 1; i += 1) {
    const v0 = values[i];
    const v1 = values[i + 1];
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) continue;
    const x0 = x(i);
    const y0 = y(v0);
    const x1 = x(i + 1);
    const y1 = y(v1);

    if (!Number.isFinite(threshold)) {
      paths.normal += `M${x0},${y0}L${x1},${y1}`;
      continue;
    }

    const above0 = v0 > threshold;
    const above1 = v1 > threshold;
    if (above0 === above1) {
      const key = above0 ? "alert" : "normal";
      paths[key] += `M${x0},${y0}L${x1},${y1}`;
      continue;
    }

    // Segment crosses threshold: split at the exact crossing point.
    const dv = v1 - v0;
    if (!Number.isFinite(dv) || dv === 0) {
      paths.normal += `M${x0},${y0}L${x1},${y1}`;
      continue;
    }
    const tRaw = (threshold - v0) / dv;
    const t = Math.max(0, Math.min(1, tRaw));
    const xCross = x0 + (x1 - x0) * t;
    const yCross = y(threshold);

    if (above0 && !above1) {
      paths.alert += `M${x0},${y0}L${xCross},${yCross}`;
      paths.normal += `M${xCross},${yCross}L${x1},${y1}`;
    } else {
      paths.normal += `M${x0},${y0}L${xCross},${yCross}`;
      paths.alert += `M${xCross},${yCross}L${x1},${y1}`;
    }
  }

  return {
    normalPath: paths.normal,
    alertPath: paths.alert,
    values,
    yMax: (yMax === 0 ? 1 : yMax),
    threshold: Number.isFinite(threshold) ? threshold : null,
    padX,
    padY
  };
}

function getSeriesFor(category, pref) {
  return state.allData.filter(d => d.category === category && d.pref === pref).sort((a, b) => a.date - b.date);
}

function formatRatioAlert(v) {
  if (v == null || !isFinite(v)) return "—";
  return `${v.toFixed(2)}倍`;
}

function formatRatioYoy(v) {
  if (v == null || !isFinite(v)) return "—";
  const pct = Math.round((v - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function getWowRatio(category, pref) {
  if (!Array.isArray(state.allData)) return null;
  const series = state.allData
    .filter(d => d.category === category && d.pref === pref)
    .sort((a, b) => a.date - b.date);
  if (series.length < 2) return null;
  const prev = series[series.length - 2].value;
  if (!prev || prev <= 0) return null;
  return series[series.length - 1].value / prev;
}

function formatWow(v) {
  if (v == null || !isFinite(v)) return "—";
  const pct = Math.round((v - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function wowClass(v) {
  if (!isFinite(v)) return "";
  if (v >= 1.5) return "ratio-yoy--high";
  if (v <= 0.67) return "ratio-wow--low";
  return "";
}

function alertSeverityClass(v) {
  if (!Number.isFinite(v)) return "alert-sev-normal";
  if (v > 1) return "alert-sev-danger";
  if (v > 0.3) return "alert-sev-caution";
  return "alert-sev-normal";
}

function alertClass(v) {
  if (v == null || !isFinite(v)) return "ratio-alert--normal";
  if (v > 1) return "ratio-alert--danger";
  if (v > 0.3) return "ratio-alert--caution";
  return "ratio-alert--normal";
}

function yoyClass(v) {
  if (!isFinite(v)) return "ratio-yoy--normal";
  if (v > 5) return "ratio-yoy--very-high";
  if (v > 2) return "ratio-yoy--high";
  return "ratio-yoy--normal";
}

function updateSortHeaders() {
  $$(".ranking-table .sortable").forEach(th => {
    const key = th.getAttribute("data-sort");
    const active = key === state.sortKey;
    th.classList.toggle("sort-active", active);
    th.classList.toggle("sort-desc", active && state.sortDesc);
    th.classList.toggle("sort-asc", active && !state.sortDesc);
    th.setAttribute("aria-sort", active ? (state.sortDesc ? "descending" : "ascending") : "none");
  });
}

function normalizeFactory(values) {
  const valid = values.filter(v => Number.isFinite(v));
  if (!valid.length) return () => null;
  const min = d3.min(valid);
  const max = d3.max(valid);
  if (min === max) return (v) => Number.isFinite(v) ? 1 : null;
  const span = max - min;
  return (v) => Number.isFinite(v) ? (v - min) / span : null;
}

function buildHighlightReason(item) {
  const reasons = [];
  if (Number.isFinite(item.ratio_alert) && item.ratio_alert > 1) {
    reasons.push(`警報基準比 ${item.ratio_alert.toFixed(2)}倍`);
  }
  if (Number.isFinite(item.ratio_yoy) && item.ratio_yoy >= 2) {
    reasons.push(`平年比 +${Math.round((item.ratio_yoy - 1) * 100)}%`);
  }
  if (Number.isFinite(item.growth4Rate) && item.growth4Rate >= 0.2) {
    reasons.push(`4週で +${(item.growth4Rate * 100).toFixed(0)}%`);
  }
  if (Number.isFinite(item.persistenceRate) && item.persistenceRate >= 0.5 && item.persistenceWindow > 0) {
    reasons.push(`直近${item.persistenceWindow}週中 ${item.persistenceWeeks}週で警報超え`);
  }
  if (!reasons.length && Number.isFinite(item.current_ma4)) {
    reasons.push(`定点あたり患者数 ${item.current_ma4.toFixed(2)}`);
  }
  return reasons.slice(0, 2).join(" / ");
}

function computeTopHighlightsFromPrecomputed(filteredRows) {
  const p = state.precomputedTopHighlights;
  if (!p || !p.targetCategory) return null;
  if (state.selectedDiseases.size && !state.selectedDiseases.has(p.targetCategory)) return null;

  const rowsForCategory = (filteredRows || []).filter(d => d.category === p.targetCategory);
  if (!rowsForCategory.length) return null;

  const toEntry = (rowLike, fallbackRank) => {
    if (!rowLike || !rowLike.pref) return null;
    const live = rowsForCategory.find(r => r.pref === rowLike.pref);
    const base = live || rowLike;
    return {
      category: p.targetCategory,
      pref: rowLike.pref,
      rankLabel: rowLike.rankLabel || fallbackRank || "",
      current_ma4: Number.isFinite(+base.current_ma4) ? +base.current_ma4 : null,
      ratio_alert: Number.isFinite(+base.ratio_alert) ? +base.ratio_alert : null,
      sparkValues: Array.isArray(rowLike.series52) ? rowLike.series52 : null
    };
  };

  const nationwideRow = toEntry(p.nationwideRow, "全国");
  const topPrefRows = (Array.isArray(p.topPrefRows) ? p.topPrefRows : [])
    .map((row, idx) => toEntry(row, `${idx + 1}.`))
    .filter(Boolean)
    .slice(0, 3);

  if (!nationwideRow && !topPrefRows.length) return null;
  return {
    targetCategory: p.targetCategory,
    nationwideRow,
    topPrefRows
  };
}

function computeTopHighlights(filteredRows) {
  if (!Array.isArray(filteredRows) || !filteredRows.length) return null;

  const precomputed = computeTopHighlightsFromPrecomputed(filteredRows);
  if (precomputed) return precomputed;

  const compareByAlertRatio = (a, b) => {
    const av = Number.isFinite(a.ratio_alert) ? a.ratio_alert : -Infinity;
    const bv = Number.isFinite(b.ratio_alert) ? b.ratio_alert : -Infinity;
    if (bv !== av) return bv - av;
    const ay = Number.isFinite(a.ratio_yoy) ? a.ratio_yoy : -Infinity;
    const by = Number.isFinite(b.ratio_yoy) ? b.ratio_yoy : -Infinity;
    if (by !== ay) return by - ay;
    const ac = Number.isFinite(a.current_ma4) ? a.current_ma4 : -Infinity;
    const bc = Number.isFinite(b.current_ma4) ? b.current_ma4 : -Infinity;
    return bc - ac;
  };

  const candidates = filteredRows.filter(d => Number.isFinite(d.ratio_alert));
  if (!candidates.length) return null;

  // Step 1: pick the disease whose nationwide row has the highest alert ratio.
  const nationwideRows = candidates.filter(d => isNationwide(d.pref));
  const diseaseAnchor = (nationwideRows.length ? nationwideRows : candidates).slice().sort(compareByAlertRatio)[0];
  if (!diseaseAnchor) return null;
  const targetCategory = diseaseAnchor.category;

  // Step 2: for that disease, collect nationwide and top 3 prefectures.
  const sameDiseaseAll = filteredRows.filter(d => d.category === targetCategory);
  if (!sameDiseaseAll.length) return null;

  const enrichRow = (row, rankLabel) => {
    return {
      ...row,
      rankLabel,
      sparkValues: null
    };
  };

  const nationwideRow = sameDiseaseAll.find(d => isNationwide(d.pref))
    || sameDiseaseAll.slice().sort(compareByAlertRatio)[0];
  const topPrefRows = sameDiseaseAll
    .filter(d => !isNationwide(d.pref))
    .slice()
    .sort(compareByAlertRatio)
    .slice(0, 3)
    .map((d, idx) => enrichRow(d, `${idx + 1}.`));

  return {
    targetCategory,
    nationwideRow: nationwideRow ? enrichRow(nationwideRow, "全国") : null,
    topPrefRows
  };
}

function buildCategoryHighlightsPayload(category) {
  if (!category || !Array.isArray(state.rankingData) || !state.rankingData.length) return null;
  const rows = state.rankingData.filter(d => d.category === category);
  if (!rows.length) return null;

  const nationwide = rows.find(d => isNationwide(d.pref)) || null;
  const topPrefRows = rows
    .filter(d => !isNationwide(d.pref))
    .slice()
    .sort((a, b) => {
      const av = Number.isFinite(a.current_ma4) ? a.current_ma4 : -Infinity;
      const bv = Number.isFinite(b.current_ma4) ? b.current_ma4 : -Infinity;
      return bv - av;
    })
    .slice(0, 3)
    .map((d, idx) => ({ ...d, rankLabel: `${idx + 1}.` }));

  if (!nationwide && !topPrefRows.length) return null;
  return {
    targetCategory: category,
    nationwideRow: nationwide ? { ...nationwide, rankLabel: "全国" } : null,
    topPrefRows,
    topLabel: "定点あたり患者数が高い3都道府県"
  };
}

function renderCategoryHighlights(category, options = {}) {
  const payload = buildCategoryHighlightsPayload(category);
  state.activeDigestCategory = category || null;
  renderTopHighlights(payload, options.signalKey);
  if (options.scroll) {
    const el = els.rankingTopHighlights;
    if (el) {
      const rect = el.getBoundingClientRect();
      const outside = rect.bottom < 0 || rect.top > window.innerHeight;
      if (outside) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}
window.renderCategoryHighlights = renderCategoryHighlights;
window.buildMiniSparkline = buildMiniSparkline;
window.startMiniSparklineDotAnimations = startMiniSparklineDotAnimations;

function renderTopMetricCard(entry) {
  if (!entry) return null;
  const card = document.createElement("button");
  card.type = "button";
  card.className = "ranking-top-metric-card";
  card.setAttribute("aria-label", `${entry.category}、${entry.pref}のグラフへ移動`);
  card.title = "クリックでグラフへ移動";
  const mini = buildMiniSparkline(entry.category, entry.pref, 116, 30, entry.sparkValues);
  card.innerHTML = `
    <div class="ranking-top-card-grid">
      <div class="ranking-top-metric-head">
        <span class="ranking-top-metric-rank">${entry.rankLabel || ""}</span>
        <span class="ranking-top-metric-pref">${entry.pref}</span>
        <span class="ranking-top-metric-alert-inline ${alertSeverityClass(entry.ratio_alert)}">${formatRatioAlert(entry.ratio_alert)}</span>
      </div>
      <div class="ranking-top-card-current">
        <span class="metric-label">定点あたり患者数</span>
        <span class="metric-value metric-value-current">${Number.isFinite(entry.current_ma4) ? entry.current_ma4.toFixed(2) : "—"}</span>
      </div>
      <div class="ranking-top-card-spark">
        <span class="metric-value spark-wrap">
          <svg class="top-metric-sparkline" aria-hidden="true" width="116" height="30" viewBox="0 0 116 30" data-values="${mini.values.join("|")}" data-y-max="${mini.yMax}" data-threshold="${Number.isFinite(mini.threshold) ? mini.threshold : ""}" data-pad-x="${mini.padX || 0}" data-pad-y="${mini.padY || 0}">
              <path class="top-metric-sparkline-path" d="${mini.normalPath}"></path>
            <path class="top-metric-sparkline-path top-metric-sparkline-path-alert" d="${mini.alertPath}"></path>
            <circle class="top-metric-spark-dot" cx="0" cy="0" r="2.8"></circle>
          </svg>
        </span>
      </div>
    </div>
  `;
  card.addEventListener("click", () => goToChart(entry.pref, entry.category));
  return card;
}

function startMiniSparklineDotAnimations(rootEl) {
  if (!rootEl) return;
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const svgs = rootEl.querySelectorAll(".top-metric-sparkline");
  svgs.forEach(svg => {
    const dot = svg.querySelector(".top-metric-spark-dot");
    if (!dot) return;
    const values = String(svg.getAttribute("data-values") || "")
      .split("|")
      .map(Number)
      .filter(v => Number.isFinite(v));
    if (!values.length) {
      dot.style.display = "none";
      return;
    }
    const vb = String(svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    const width = Number.isFinite(vb[2]) ? vb[2] : 116;
    const height = Number.isFinite(vb[3]) ? vb[3] : 30;
    const padX = Number(svg.getAttribute("data-pad-x") || 0);
    const padY = Number(svg.getAttribute("data-pad-y") || 0);
    const yMax = Number(svg.getAttribute("data-y-max"));
    const denom = Number.isFinite(yMax) && yMax > 0 ? yMax : 1;
    const thresholdVal = Number(svg.getAttribute("data-threshold"));
    const hasThreshold = Number.isFinite(thresholdVal);
    const lastIdx = values.length - 1;

    const easeInOutCubic = t => (t < 0.5)
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const setAtProgress = p => {
      const pos = lastIdx <= 0 ? 0 : lastIdx * p;
      const i0 = Math.floor(pos);
      const i1 = Math.min(lastIdx, i0 + 1);
      const frac = pos - i0;
      const v = values[i0] * (1 - frac) + values[i1] * frac;
      const x = lastIdx <= 0 ? padX : (padX + (width - 2 * padX) * pos / lastIdx);
      const y = (height - padY) - (v / denom) * (height - 2 * padY);
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      // Use inline style so threshold color wins over CSS default.
      dot.style.fill = (hasThreshold && v > thresholdVal) ? "#dc2626" : "#0369a1";
    };

    if (reduceMotion || values.length < 2) {
      setAtProgress(1);
      dot.style.opacity = "1";
      return;
    }
    if (svg.getAttribute("data-dot-animating") === "1") {
      return;
    }
    if (svg.getAttribute("data-dot-animated") === "1") {
      setAtProgress(1);
      dot.style.opacity = "1";
      return;
    }

    // Half speed: double the travel duration.
    const durationMs = Math.min(4800, Math.max(2400, values.length * 60));
    let startedAt = null;
    svg.setAttribute("data-dot-animating", "1");
    // Ensure first visible frame is exactly on the sparkline start.
    setAtProgress(0);
    dot.style.opacity = "1";
    const step = now => {
      if (startedAt == null) startedAt = now;
      const progress = Math.min(1, (now - startedAt) / durationMs);
      setAtProgress(easeInOutCubic(progress));
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        svg.removeAttribute("data-dot-animating");
        svg.setAttribute("data-dot-animated", "1");
      }
    };
    requestAnimationFrame(step);
  });
}

const SIGNAL_LABELS = {
  alert:   { main: "警報基準比が直近で最も高い感染症", prefs: "警報基準比が高い3都道府県",   help: "患者数が警報基準の何倍かを示す指標",         helpAriaLabel: "警報基準比の説明を表示",         helpText: "警報基準比" },
  rising:  { main: "前週比増加率が最も高い感染症",     prefs: "増加率が高い3都道府県",         help: "今週の患者数が先週から何割増えたかを示す指標", helpAriaLabel: "前週比増加率の説明を表示",        helpText: "前週比増加率" },
  anomaly: { main: "季節外れの増加が最も大きい感染症", prefs: "季節外れの増加が目立つ3都道府県", help: "同時期の例年平均と比べた乖離の大きさを示す指標", helpAriaLabel: "季節性Zスコアの説明を表示",      helpText: "季節性Zスコア" },
};

function renderTopHighlights(payload, signalKey) {
  if (!els.rankingTopHighlights) return;
  els.rankingTopHighlights.innerHTML = "";
  if (!payload || !payload.targetCategory) {
    els.rankingTopHighlights.style.display = "none";
    return;
  }
  if (state.newsDigest) { els.rankingTopHighlights.style.display = "none"; return; }
  els.rankingTopHighlights.style.display = "block";

  const labels = SIGNAL_LABELS[signalKey] || SIGNAL_LABELS.alert;
  const { targetCategory, nationwideRow, topPrefRows } = payload;
  const wrapper = document.createElement("div");
  wrapper.className = "ranking-top-layout";

  const left = document.createElement("div");
  left.className = "ranking-top-main ranking-top-main-unified";
  left.innerHTML = `
    <p class="ranking-top-main-label">
      <span class="ranking-top-main-label-wrap">
        ${labels.main}
        <button type="button" class="top-help-trigger" aria-label="${labels.helpAriaLabel}" aria-expanded="false">?</button>
        <span class="top-help-popover" role="tooltip">${labels.help}</span>
      </span>
    </p>
    <p class="ranking-top-main-disease">${targetCategory || "—"}</p>
  `;
  if (nationwideRow) {
    const nationwideMini = buildMiniSparkline(nationwideRow.category, nationwideRow.pref, 116, 52, nationwideRow.sparkValues);
    left.innerHTML += `
      <div class="ranking-top-main-unified-grid">
        <p class="ranking-top-main-unified-pref-row">
          <span class="ranking-top-main-unified-pref">全国平均</span>
          <span class="ranking-top-main-unified-alert-inline ${alertSeverityClass(nationwideRow.ratio_alert)}">${formatRatioAlert(nationwideRow.ratio_alert)}</span>
        </p>
        <div class="ranking-top-main-unified-current">
          <span class="label">定点あたり患者数</span>
          <span class="value">${Number.isFinite(nationwideRow.current_ma4) ? nationwideRow.current_ma4.toFixed(2) : "—"}</span>
        </div>
        <div class="ranking-top-main-unified-spark">
          <span class="value spark-wrap">
            <svg class="top-metric-sparkline top-metric-sparkline--nationwide" aria-hidden="true" width="116" height="52" viewBox="0 0 116 52" data-values="${nationwideMini.values.join("|")}" data-y-max="${nationwideMini.yMax}" data-threshold="${Number.isFinite(nationwideMini.threshold) ? nationwideMini.threshold : ""}" data-pad-x="${nationwideMini.padX || 0}" data-pad-y="${nationwideMini.padY || 0}">
              <path class="top-metric-sparkline-path" d="${nationwideMini.normalPath}"></path>
              <path class="top-metric-sparkline-path top-metric-sparkline-path-alert" d="${nationwideMini.alertPath}"></path>
              <circle class="top-metric-spark-dot" cx="0" cy="0" r="2.8"></circle>
            </svg>
          </span>
        </div>
      </div>
    `;
    left.setAttribute("role", "button");
    left.tabIndex = 0;
    left.title = "クリックでグラフへ移動";
    left.style.cursor = "pointer";
    const topHelpTrigger = left.querySelector(".top-help-trigger");
    const topHelpPopover = left.querySelector(".top-help-popover");
    if (topHelpTrigger && topHelpPopover) {
      topHelpTrigger.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = topHelpTrigger.getAttribute("aria-expanded") !== "true";
        topHelpTrigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
        topHelpPopover.classList.toggle("is-open", willOpen);
      });
      topHelpPopover.addEventListener("click", e => e.stopPropagation());
    }
    left.addEventListener("click", () => goToChart(nationwideRow.pref, nationwideRow.category));
    left.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        goToChart(nationwideRow.pref, nationwideRow.category);
      }
    });
  }
  wrapper.appendChild(left);

  const right = document.createElement("div");
  right.className = "ranking-top-prefs";
  const rightTitle = document.createElement("p");
  rightTitle.className = "ranking-top-prefs-label";
  rightTitle.textContent = payload.topLabel || labels.prefs;
  right.appendChild(rightTitle);

  const list = document.createElement("ol");
  list.className = "ranking-top-prefs-list";
  topPrefRows.forEach((item) => {
    const li = document.createElement("li");
    li.className = "ranking-top-prefs-item";
    const card = renderTopMetricCard(item);
    if (card) li.appendChild(card);
    list.appendChild(li);
  });
  right.appendChild(list);
  wrapper.appendChild(right);

  els.rankingTopHighlights.appendChild(wrapper);
  const sparkNote = document.createElement("p");
  sparkNote.className = "ranking-top-spark-note";
  sparkNote.textContent = "※折れ線は過去1年の推移（右端が最新）";
  els.rankingTopHighlights.appendChild(sparkNote);
  requestAnimationFrame(() => startMiniSparklineDotAnimations(els.rankingTopHighlights));
}

function computeRanking() {
  let highlightSource = state.rankingData.slice();
  if (state.selectedDiseases.size) {
    highlightSource = highlightSource.filter(d => state.selectedDiseases.has(d.category));
  }

  let filtered = highlightSource.slice();
  if (state.selectedRankingPrefectures.size) filtered = filtered.filter(d => state.selectedRankingPrefectures.has(d.pref));
  filtered.forEach(row => { if (row._wow === undefined) row._wow = getWowRatio(row.category, row.pref); });
  if (state.sortKey === "ratio_wow") {
    filtered = filtered.slice().sort((a, b) => {
      const av = Number.isFinite(a._wow) ? a._wow : -Infinity;
      const bv = Number.isFinite(b._wow) ? b._wow : -Infinity;
      return state.sortDesc ? bv - av : av - bv;
    });
  } else {
    filtered = sortRankingRows(filtered);
  }

  const captionParts = [];
  captionParts.push(state.selectedRankingPrefectures.size ? `都道府県: ${Array.from(state.selectedRankingPrefectures).join("、")}` : "都道府県: すべて");
  captionParts.push(state.selectedDiseases.size ? `感染症: ${Array.from(state.selectedDiseases).join("、")}` : "感染症: すべて");
  const rows = filtered.slice(0, state.visibleRows);

  return {
    filtered,
    rows,
    captionText: filtered.length ? `${captionParts.join(" / ")} / ${filtered.length}件` : "該当データがありません。",
    highlights: computeTopHighlights(highlightSource)
  };
}

function renderRanking(result) {
  if (!els.rankingBody) return;
  const { filtered, rows, captionText, highlights } = result;

  if (els.rankingCaption) els.rankingCaption.textContent = captionText;
  renderTopHighlights(highlights);
  els.rankingBody.innerHTML = "";
  rows.forEach(row => {
    const series = getSeriesFor(row.category, row.pref);
    const values = series.slice(-52).map(d => d.value);
    const sparkD = sparklinePath(values, 52, 22);
    const tr = document.createElement("tr");
    tr.className = "go-to-chart";
    tr.setAttribute("role", "button");
    tr.tabIndex = 0;
    tr.title = "クリックでグラフへ移動";
    tr.setAttribute("aria-label", `${row.category}、${row.pref}のグラフを表示`);
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>${row.category}</td>
      <td>${row.pref}</td>
      <td class="num ranking-cell-value">
        <span class="ranking-value-num">${isFinite(row.current_ma4) ? row.current_ma4.toFixed(2) + "人" : "—"}</span>
        <svg class="ranking-sparkline" aria-hidden="true" width="52" height="22" viewBox="0 0 52 22">
          <path class="ranking-sparkline-path" fill="none" stroke="currentColor" stroke-width="1.2" d="${sparkD || ""}"></path>
        </svg>
      </td>
      <td class="num ${alertClass(row.ratio_alert)}">${formatRatioAlert(row.ratio_alert)}</td>
      <td class="num ${wowClass(row._wow)}">${formatWow(row._wow)}</td>
      <td class="num ${yoyClass(row.ratio_yoy)}">${formatRatioYoy(row.ratio_yoy)}</td>
    `;
    const click = () => {
      tr.classList.remove("ranking-row-flash");
      void tr.offsetWidth; // reflow to restart animation
      tr.classList.add("ranking-row-flash");
      goToChart(row.pref, row.category);
    };
    tr.addEventListener("click", click);
    tr.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        click();
      }
    });
    els.rankingBody.appendChild(tr);
  });
  if (els.rankingMoreWrap && els.rankingMoreBtn) {
    if (filtered.length > state.visibleRows) {
      els.rankingMoreWrap.style.display = "block";
      els.rankingMoreBtn.textContent = `もっと見る（残り${filtered.length - state.visibleRows}件）`;
    } else {
      els.rankingMoreWrap.style.display = "none";
      els.rankingMoreBtn.textContent = "";
    }
  }
}

function refreshRankingTable() {
  const result = computeRanking();
  renderRanking(result);

  // ランキングテーブルの可視行に必要な都道府県×疾患データが未ロードなら
  // バックグラウンドで取得してスパークラインを再描画する
  if (typeof ensurePrefCatLoaded !== "function") return;
  const alwaysLoaded = new Set(["全国", "東京都", "大阪府"]);
  const pairs = result.rows
    .filter(r => !alwaysLoaded.has(r.pref))
    .filter(r => !state.allData.some(d => d.pref === r.pref && d.category === r.category))
    .map(r => ({ pref: r.pref, category: r.category }));
  if (!pairs.length) return;
  Promise.all(pairs.map(({ pref, category }) => ensurePrefCatLoaded(pref, category))).then(() => {
    renderRanking(computeRanking());
  });
}

function initializeMetricHelpTriggers() {
  if (metricHelpInitialized) return;
  metricHelpInitialized = true;

  const triggers = $$(".metric-help-trigger");
  if (!triggers.length) return;

  const closeAll = () => {
    $$(".metric-help-trigger").forEach(btn => btn.setAttribute("aria-expanded", "false"));
    $$(".metric-help-popover.is-open").forEach(pop => pop.classList.remove("is-open"));
  };

  triggers.forEach(btn => {
    const parentSortableTh = btn.closest("th.sortable");
    const hideSortHintTitle = () => {
      if (!parentSortableTh) return;
      const currentTitle = parentSortableTh.getAttribute("title");
      if (currentTitle != null) {
        parentSortableTh.dataset.sortHintTitle = currentTitle;
        parentSortableTh.removeAttribute("title");
      }
    };
    const showSortHintTitle = () => {
      if (!parentSortableTh) return;
      if (parentSortableTh.hasAttribute("title")) return;
      parentSortableTh.setAttribute("title", parentSortableTh.dataset.sortHintTitle || "クリックで並べ替え");
    };

    btn.addEventListener("mouseenter", hideSortHintTitle);
    btn.addEventListener("focus", hideSortHintTitle);
    btn.addEventListener("mouseleave", showSortHintTitle);
    btn.addEventListener("blur", showSortHintTitle);

    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      const targetId = btn.getAttribute("data-help-target");
      const popover = targetId ? document.getElementById(targetId) : null;
      if (!popover) return;
      const willOpen = btn.getAttribute("aria-expanded") !== "true";
      closeAll();
      if (willOpen) {
        btn.setAttribute("aria-expanded", "true");
        popover.classList.add("is-open");
      }
    });
  });

  document.addEventListener("click", e => {
    if (!e.target.closest(".th-with-help")) closeAll();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeAll();
  });
}

function initializePrefControls() {
  renderRankingPrefTags();
  renderDiseaseTags();
  refreshSelectOptions(els.rankingPrefAdd, state.uniquePrefectures, state.selectedRankingPrefectures);
  refreshSelectOptions(els.rankingDiseaseAdd, state.uniqueCategories, state.selectedDiseases, true);
  if (els.rankingMoreBtn) {
    els.rankingMoreBtn.addEventListener("click", () => {
      state.visibleRows += RANKING_PAGE_SIZE;
      refreshRankingTable();
    });
  }
  if (els.rankingDiseaseAdd) {
    els.rankingDiseaseAdd.addEventListener("change", function () {
      const v = this.value;
      if (!v) return;
      if (v === RANKING_DISEASE_ALL_VALUE) state.selectedDiseases.clear();
      else state.selectedDiseases.add(v);
      this.value = "";
      state.visibleRows = RANKING_PAGE_SIZE;
      renderDiseaseTags();
      refreshSelectOptions(els.rankingDiseaseAdd, state.uniqueCategories, state.selectedDiseases, true);
      refreshRankingTable();
    });
  }
  if (els.rankingDiseaseReset) {
    els.rankingDiseaseReset.addEventListener("click", () => {
      state.selectedDiseases.clear();
      state.visibleRows = RANKING_PAGE_SIZE;
      renderDiseaseTags();
      refreshSelectOptions(els.rankingDiseaseAdd, state.uniqueCategories, state.selectedDiseases, true);
      refreshRankingTable();
    });
  }
  if (els.rankingPrefAdd) {
    els.rankingPrefAdd.addEventListener("change", function () {
      const v = this.value;
      if (!v) return;
      state.selectedRankingPrefectures.add(v);
      this.value = "";
      state.visibleRows = RANKING_PAGE_SIZE;
      renderRankingPrefTags();
      refreshSelectOptions(els.rankingPrefAdd, state.uniquePrefectures, state.selectedRankingPrefectures);
      refreshRankingTable();
    });
  }
  if (els.rankingPrefReset) {
    els.rankingPrefReset.addEventListener("click", () => {
      state.selectedRankingPrefectures.clear();
      state.selectedRankingPrefectures.add("全国");
      state.visibleRows = RANKING_PAGE_SIZE;
      renderRankingPrefTags();
      refreshSelectOptions(els.rankingPrefAdd, state.uniquePrefectures, state.selectedRankingPrefectures);
      refreshRankingTable();
    });
  }
  $$(".ranking-table .sortable").forEach(th => {
    th.addEventListener("click", function () {
      const key = this.getAttribute("data-sort");
      if (!key || !state.rankingData.length) return;
      if (state.sortKey === key) state.sortDesc = !state.sortDesc;
      else {
        state.sortKey = key;
        state.sortDesc = true;
      }
      updateSortHeaders();
      if (els.rankingSortAnnounce) {
        const label = state.sortKey === "ratio_alert" ? "警報基準比"
          : state.sortKey === "ratio_wow" ? "前週比"
          : state.sortKey === "ratio_yoy" ? "平年比"
          : "定点あたり患者数";
        els.rankingSortAnnounce.textContent = `${label}の${state.sortDesc ? "降順" : "昇順"}でソートしました。`;
      }
      refreshRankingTable();
    });
  });
  updateSortHeaders();
  initializeMetricHelpTriggers();
}
