"use strict";

// Detect coarse-pointer (touch) devices once at startup.
const _isMobile = window.matchMedia("(pointer: coarse)").matches;

function renderChartPrefectureTags() {
  if (!els.prefSelected) return;
  const prefs = getSelectedDropdownPrefectures();
  const ordered = PREF_ORDER.filter(p => prefs.includes(p)).concat(prefs.filter(p => !PREF_ORDER.includes(p)).sort());
  els.prefSelected.innerHTML = "";
  ordered.forEach(pref => {
    const div = document.createElement("div");
    div.className = "filter-tag";
    div.setAttribute("role", "listitem");
    div.textContent = `${pref} ×`;
    div.addEventListener("click", () => {
      state.selectedChartPrefectures.delete(pref);
      if (!state.selectedChartPrefectures.size) state.selectedChartPrefectures.add("全国");
      refreshPrefectureOptions();
      renderChartPrefectureTags();
      drawAllCharts(getSelectedDropdownPrefectures());
    });
    els.prefSelected.appendChild(div);
  });
}

function renderChartDiseaseTags() {
  if (!els.diseaseSelected) return;
  const cats = Array.from(state.selectedCategories);
  const ordered = CATEGORY_ORDER.filter(c => cats.includes(c)).concat(cats.filter(c => !CATEGORY_ORDER.includes(c)).sort());
  els.diseaseSelected.innerHTML = "";
  ordered.forEach(cat => {
    const div = document.createElement("div");
    div.className = "filter-tag";
    div.setAttribute("role", "listitem");
    div.textContent = `${cat} ×`;
    div.addEventListener("click", () => {
      state.selectedCategories.delete(cat);
      state.categoryDisplayOrder = state.categoryDisplayOrder.filter(x => x !== cat);
      if (!state.selectedCategories.size) {
        ["新型コロナウイルス", "インフルエンザ", "RSウイルス"].forEach(c => state.selectedCategories.add(c));
        state.categoryDisplayOrder = ["新型コロナウイルス", "インフルエンザ", "RSウイルス"];
      }
      refreshDiseaseOptions();
      renderChartDiseaseTags();
      drawAllCharts(getSelectedDropdownPrefectures());
    });
    els.diseaseSelected.appendChild(div);
  });
}

function updateDropdownBtn() {
  if (els.dropdownBtn) {
    els.dropdownBtn.textContent = "ここから追加";
    els.dropdownBtn.classList.add("is-placeholder");
  }
  if (els.diseaseDropdownBtn) {
    els.diseaseDropdownBtn.textContent = "ここから追加";
    els.diseaseDropdownBtn.classList.add("is-placeholder");
  }
}

function refreshPrefectureOptions() {
  if (!els.dropdownContent) return;
  const selected = getSelectedDropdownPrefectures();
  $$("#dropdown-content .option").forEach(opt => {
    const pref = opt.getAttribute("data-pref");
    const on = selected.includes(pref);
    opt.classList.toggle("selected", on);
    opt.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function refreshDiseaseOptions() {
  if (!els.diseaseDropdownContent) return;
  $$("#disease-dropdown-content .option").forEach(opt => {
    const cat = opt.getAttribute("data-disease");
    const on = state.selectedCategories.has(cat);
    opt.classList.toggle("selected", on);
    opt.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function buildChartDropdownOptions() {
  if (els.dropdownContent) {
    // Use PREF_ORDER so all 47 prefs + 全国 are listed immediately;
    // per-pref CSVs are lazy-loaded when a pref is first selected.
    els.dropdownContent.innerHTML = PREF_ORDER.map(pref =>
      `<div class="option" role="option" data-pref="${pref}" aria-selected="false">${pref}</div>`
    ).join("");
  }
  if (els.diseaseDropdownContent) {
    els.diseaseDropdownContent.innerHTML = state.uniqueCategories.map(cat =>
      `<div class="option" role="option" data-disease="${cat}" aria-selected="false">${cat}</div>`
    ).join("");
  }
}

let chartDropdownTogglesBound = false;
function initializeDropdownToggles() {
  if (chartDropdownTogglesBound) return;
  chartDropdownTogglesBound = true;

  if (els.dropdownBtn) {
    els.dropdownBtn.onclick = (event) => {
      event.stopPropagation();
      const isOpen = !!(els.prefDropdown && els.prefDropdown.classList.contains("open"));
      if (els.prefDropdown) els.prefDropdown.classList.toggle("open", !isOpen);
      if (els.dropdownBtn) els.dropdownBtn.setAttribute("aria-expanded", String(!isOpen));
      if (els.diseaseDropdown) els.diseaseDropdown.classList.remove("open");
      if (els.diseaseDropdownBtn) els.diseaseDropdownBtn.setAttribute("aria-expanded", "false");
    };
  }

  if (els.diseaseDropdownBtn) {
    els.diseaseDropdownBtn.onclick = (event) => {
      event.stopPropagation();
      const isOpen = !!(els.diseaseDropdown && els.diseaseDropdown.classList.contains("open"));
      if (els.diseaseDropdown) els.diseaseDropdown.classList.toggle("open", !isOpen);
      if (els.diseaseDropdownBtn) els.diseaseDropdownBtn.setAttribute("aria-expanded", String(!isOpen));
      if (els.prefDropdown) els.prefDropdown.classList.remove("open");
      if (els.dropdownBtn) els.dropdownBtn.setAttribute("aria-expanded", "false");
    };
  }

  if (els.prefDropdown) {
    els.prefDropdown.onclick = (event) => event.stopPropagation();
  }
  if (els.diseaseDropdown) {
    els.diseaseDropdown.onclick = (event) => event.stopPropagation();
  }

  document.body.addEventListener("click", () => {
    if (els.prefDropdown) els.prefDropdown.classList.remove("open");
    if (els.diseaseDropdown) els.diseaseDropdown.classList.remove("open");
    if (els.dropdownBtn) els.dropdownBtn.setAttribute("aria-expanded", "false");
    if (els.diseaseDropdownBtn) els.diseaseDropdownBtn.setAttribute("aria-expanded", "false");
  });
}

function initializeDropdown() {
  if (!els.dropdownContent) return;
  $$("#dropdown-content .option").forEach(opt => {
    opt.onclick = () => {
      const pref = opt.getAttribute("data-pref");
      if (!pref) return;
      state.selectedChartPrefectures.add(pref);
      refreshPrefectureOptions();
      renderChartPrefectureTags();
      drawAllCharts(getSelectedDropdownPrefectures());
    };
  });
  if (els.prefReset) {
    els.prefReset.onclick = () => {
      state.selectedChartPrefectures.clear();
      ["全国", "東京都", "大阪府"].forEach(pref => {
        if (state.uniquePrefectures.includes(pref)) state.selectedChartPrefectures.add(pref);
      });
      if (!state.selectedChartPrefectures.size) state.selectedChartPrefectures.add("全国");
      refreshPrefectureOptions();
      renderChartPrefectureTags();
      drawAllCharts(getSelectedDropdownPrefectures());
    };
  }
}

function initializeCategoryControls() {
  if (!els.diseaseDropdownContent) return;
  $$("#disease-dropdown-content .option").forEach(opt => {
    opt.onclick = () => {
      const cat = opt.getAttribute("data-disease");
      if (!cat) return;
      state.selectedCategories.add(cat);
      state.categoryDisplayOrder = state.categoryDisplayOrder.filter(x => x !== cat);
      state.categoryDisplayOrder.unshift(cat);
      refreshDiseaseOptions();
      renderChartDiseaseTags();
      drawAllCharts(getSelectedDropdownPrefectures());
    };
  });
  if (els.diseaseReset) {
    els.diseaseReset.onclick = () => {
      state.selectedCategories.clear();
      ["新型コロナウイルス", "インフルエンザ", "RSウイルス"].forEach(cat => state.selectedCategories.add(cat));
      state.categoryDisplayOrder = ["新型コロナウイルス", "インフルエンザ", "RSウイルス"];
      refreshDiseaseOptions();
      renderChartDiseaseTags();
      drawAllCharts(getSelectedDropdownPrefectures());
    };
  }
}

function setDefaultDropdownSelection() {
  state.selectedChartPrefectures.clear();
  ["全国", "東京都", "大阪府"].forEach(pref => {
    if (state.uniquePrefectures.includes(pref)) state.selectedChartPrefectures.add(pref);
  });
  if (!state.selectedChartPrefectures.size) state.selectedChartPrefectures.add("全国");
  refreshPrefectureOptions();
  refreshDiseaseOptions();
  renderChartPrefectureTags();
  renderChartDiseaseTags();
  updateDropdownBtn();
}

function togglePrefHighlightForCategory(category, pref) {
  if (state.highlightedPrefByCategory[category] === pref) {
    delete state.highlightedPrefByCategory[category];
  } else {
    state.highlightedPrefByCategory[category] = pref;
  }
}

// Build a lightweight signature to decide whether each chart needs redraw.
function buildChartRenderSignature(category, catData, selectedPrefs) {
  const brush = state.savedBrushExtents[category];
  const brushKey = brush ? `${brush[0]?.getTime?.() || 0}-${brush[1]?.getTime?.() || 0}` : "";
  const highlight = state.highlightedPrefByCategory[category] || "";
  const dateMin = d3.min(catData, d => d?.date?.getTime?.() || 0) || 0;
  const dateMax = d3.max(catData, d => d?.date?.getTime?.() || 0) || 0;
  const sumValue = d3.sum(catData, d => Number.isFinite(d.value) ? d.value : 0) || 0;
  return [
    selectedPrefs.join("|"),
    brushKey,
    highlight,
    catData.length,
    dateMin,
    dateMax,
    sumValue.toFixed(6)
  ].join("::");
}

// --- Lazy chart rendering via IntersectionObserver ----------------------------
// chart-placeholder div のデータを保持する WeakMap
const _pendingChartData = new WeakMap();
let _lazyObserver = null;

function getOrCreateLazyObserver() {
  if (_lazyObserver) return _lazyObserver;
  _lazyObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      _renderPlaceholder(entry.target);
    });
  }, { rootMargin: "300px" });
  return _lazyObserver;
}

// placeholder を実チャートに置き換える（元の位置を保ったまま）
async function _renderPlaceholder(placeholder) {
  const pending = _pendingChartData.get(placeholder);
  if (!pending) return;
  if (!placeholder.isConnected) return; // DOMから切り離されていたら何もしない
  if (_lazyObserver) _lazyObserver.unobserve(placeholder);

  // 非 always-loaded の都道府県は、この疾患分だけ今ロードする
  if (typeof ensurePrefCatLoaded === "function" && pending.selectedPrefs) {
    const alwaysLoaded = new Set(["全国", "東京都", "大阪府"]);
    const toLoad = pending.selectedPrefs.filter(p => !alwaysLoaded.has(p));
    if (toLoad.length) {
      await Promise.all(toLoad.map(p => ensurePrefCatLoaded(p, pending.cat)));
    }
  }

  // ロード後に state.allData から catData を再構築
  const catData = pending.selectedPrefs
    ? state.allData.filter(d => pending.selectedPrefs.includes(d.pref) && d.category === pending.cat)
    : pending.catData;

  if (!placeholder.isConnected) return; // ロード中に別操作で切り離された場合
  const nextSibling = placeholder.nextSibling;
  const parent = placeholder.parentNode;
  placeholder.remove();
  drawFocusContextChart(pending.cat, catData);
  const key = cssSafe(pending.cat);
  // データロード後の実データでシグネチャを再計算して保存。
  // pending.signature はロード前（データ0件）のシグネチャの可能性があるため、
  // 古いシグネチャを保存すると次の _drawAllChartsSync で不要な再描画が起きる。
  const renderedSignature = buildChartRenderSignature(pending.cat, catData, pending.selectedPrefs || []);
  state.chartRenderCache[key] = renderedSignature;
  // drawFocusContextChart はコンテナ末尾に追記するので元の位置へ戻す
  const newNode = document.querySelector(`#chart-container .chart[data-category-key="${key}"]`);
  if (newNode && parent && nextSibling) {
    parent.insertBefore(newNode, nextSibling);
  }
}

// goToChart など「即座に描画が必要」な場合に呼ぶ。Promise を返すので await 可能。
function ensureCategoryChartDrawn(category) {
  const key = cssSafe(category);
  const placeholder = document.querySelector(`#chart-container .chart-placeholder[data-category-key="${key}"]`);
  if (placeholder) return _renderPlaceholder(placeholder);
  return Promise.resolve();
}
// ---------------------------------------------------------------------------

// Diff-update charts by category key instead of clearing all DOM nodes.
// 選択中の都道府県のデータがまだ読み込まれていない場合は先にロードしてから描画する。
async function drawAllCharts(selectedPrefs) {
  _drawAllChartsSync(selectedPrefs);
}
function _drawAllChartsSync(selectedPrefs) {
  if (!els.chartContainer) return;
  const container = d3.select("#chart-container");
  // state.selectedCategories に含まれる全カテゴリを描画対象とする。
  // 非 always-loaded 県のデータは _renderPlaceholder がオンデマンドでロードする。
  const filtered = state.allData.filter(d => selectedPrefs.includes(d.pref));
  let catGroups = [...state.selectedCategories].map(cat => {
    const catData = filtered.filter(d => d.category === cat);
    return [cat, catData];
  });
  catGroups.sort((a, b) => {
    const ia = state.categoryDisplayOrder.indexOf(a[0]);
    const ib = state.categoryDisplayOrder.indexOf(b[0]);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return state.allCategoryOrder.indexOf(a[0]) - state.allCategoryOrder.indexOf(b[0]);
  });

  const desiredKeys = catGroups.map(([cat]) => cssSafe(cat));
  const desiredSet = new Set(desiredKeys);

  // .chart と .chart-placeholder の両方を既存ノードとして収集する
  const existingByKey = new Map();
  container.selectAll(".chart,.chart-placeholder").each(function () {
    const key = this.getAttribute("data-category-key");
    if (key) existingByKey.set(key, this);
  });

  // 不要になったカテゴリはDOMとキャッシュから削除
  existingByKey.forEach((node, key) => {
    if (!desiredSet.has(key)) {
      if (node.classList.contains("chart-placeholder") && _lazyObserver) {
        _lazyObserver.unobserve(node);
      }
      node.remove();
      delete state.chartRenderCache[key];
    }
  });

  const orderedNodes = [];
  const newPlaceholders = [];

  catGroups.forEach(([cat, catData]) => {
    const key = cssSafe(cat);
    const signature = buildChartRenderSignature(cat, catData, selectedPrefs);
    const prevNode = existingByKey.get(key);
    const prevSignature = state.chartRenderCache[key];

    if (!prevNode || prevSignature !== signature) {
      if (prevNode) {
        if (prevNode.classList.contains("chart-placeholder") && _lazyObserver) {
          _lazyObserver.unobserve(prevNode);
        }
        prevNode.remove();
      }
      // placeholder を置いて IntersectionObserver に任せる
      // シグネチャはここで記録する。未描画中に再度 _drawAllChartsSync が呼ばれても
      // シグネチャが一致していれば placeholder を作り直さないようにするため。
      const placeholder = document.createElement("div");
      placeholder.className = "chart-placeholder";
      placeholder.setAttribute("data-category-key", key);
      placeholder.setAttribute("data-category", cat);
      _pendingChartData.set(placeholder, { cat, selectedPrefs, signature });
      state.chartRenderCache[key] = signature; // placeholder 中もシグネチャを保持
      orderedNodes.push(placeholder);
      newPlaceholders.push(placeholder);
    } else {
      orderedNodes.push(prevNode);
    }
  });

  // 並び順だけ更新（未変更ノードは再利用）
  orderedNodes.forEach(node => {
    if (node) els.chartContainer.appendChild(node);
  });

  // 新しい placeholder だけ IntersectionObserver に登録する
  // （DOM に挿入後でないと位置情報が取れない）
  if (newPlaceholders.length > 0) {
    const observer = getOrCreateLazyObserver();
    newPlaceholders.forEach(ph => observer.observe(ph));
  }
}

// Create card, header, SVG root, and clipped focus plotting area.
function createChartContainer(category, data, focusMargin, focusHeight, FOCUS_OUTER_H) {
  const chartHeadingId = "chart-heading-" + cssSafe(category);
  const container = d3.select("#chart-container")
    .append("div")
    .attr("class", "chart")
    .attr("data-category-key", cssSafe(category))
    .attr("data-category", category)
    .attr("tabindex", "0")
    .attr("role", "region")
    .attr("aria-labelledby", chartHeadingId);

  // グラフパネルをクリックするとそのグラフのURLに自動更新
  container.on("click", function(event) {
    // ダウンロードボタン上のクリックは無視
    if (event.target.closest(".chart-download-btn")) return;
    if (typeof updateUrlForChart === "function") updateUrlForChart(category);
  });

  const headerRow = container.append("div").attr("class", "chart-header");
  const h2Node = headerRow.append("h2").attr("id", chartHeadingId).text(category).node();
  const diseaseInfoLink = makeDiseaseInfoLink(category);
  if (diseaseInfoLink) h2Node.appendChild(diseaseInfoLink);
  const downloadBtn = headerRow.append("button")
    .attr("type", "button")
    .attr("class", "chart-download-btn")
    .attr("aria-label", `${category}のデータをCSVでダウンロード`)
    .on("click", () => downloadSingleChartCsv(category, data));
  const iconSvg = downloadBtn.append("svg")
    .attr("width", 12)
    .attr("height", 12)
    .attr("viewBox", "0 0 24 24")
    .attr("fill", "none")
    .attr("stroke", "currentColor")
    .attr("stroke-width", "2")
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("aria-hidden", "true");
  iconSvg.append("path").attr("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
  iconSvg.append("polyline").attr("points", "7 10 12 15 17 10");
  iconSvg.append("line").attr("x1", "12").attr("y1", "15").attr("x2", "12").attr("y2", "3");
  downloadBtn.append("span").attr("class", "chart-download-btn-text").text("CSV");

  const wrapper = container.append("div").attr("class", "chart-wrapper");
  const leftCharts = wrapper.append("div").attr("class", "left-charts");

  const GAP = 4;
  const paddingLR = 20;
  const cardInnerW = container.node().clientWidth - paddingLR;
  const leftW = Math.max(160, Math.floor(cardInnerW - GAP));
  leftCharts.style("width", `${leftW}px`);
  const leftChartsW = leftCharts.node().clientWidth;
  const totalFocusW = leftChartsW;
  const focusWidth = Math.max(1, totalFocusW - focusMargin.left - focusMargin.right);

  const svgFocusRoot = leftCharts.append("svg")
    .attr("class", "svg-content chart-svg")
    .attr("width", totalFocusW)
    .attr("height", FOCUS_OUTER_H);

  const clipId = "clip-" + cssSafe(category);
  svgFocusRoot.append("defs")
    .append("clipPath")
    .attr("id", clipId)
    .append("rect")
    .attr("x", -40)
    .attr("y", -20)
    .attr("width", focusWidth + focusMargin.right + 40)
    .attr("height", focusHeight + 44);

  const focusTransform = `translate(${focusMargin.left},${focusMargin.top})`;
  const svgFocus = svgFocusRoot.append("g")
    .attr("transform", focusTransform)
    .attr("clip-path", `url(#${clipId})`);

  return { container, leftCharts, leftChartsW, focusWidth, svgFocusRoot, svgFocus, focusTransform };
}

// Draw x/y axes, y-axis unit text, and alert threshold band.
function drawAxes(svgFocus, xFocus, yFocus, focusHeight, focusWidth, category, yMaxAll) {
  const tickInterval = computeTickInterval(xFocus.domain());
  const tickFormat = computeTickFormat(xFocus.domain());
  const xAxisFocus = d3.axisBottom(xFocus).ticks(tickInterval).tickFormat(tickFormat);
  const yTicks = computeCustomYAxisTicks(yFocus.domain()[1]);
  const yAxisFocus = d3.axisLeft(yFocus).tickValues(yTicks);

  const xAxisG = svgFocus.append("g")
    .attr("class", "axis x-axis")
    .attr("transform", `translate(0,${focusHeight})`)
    .call(xAxisFocus);
  removeOverlappingTicksX(xAxisG);

  svgFocus.append("g")
    .attr("class", "axis y-axis")
    .call(yAxisFocus);

  svgFocus.append("text")
    .attr("class", "y-axis-unit")
    .attr("x", -28)
    .attr("y", -2)
    .attr("text-anchor", "start")
    .text("人/定点");
  hideYAxisTicksOverlappingUnit(svgFocus);

  const alertStart  = state.alertThresholdsMap[category];
  const attentionTh = state.attentionMap ? state.attentionMap[category] : null;

  if (alertStart != null && alertStart > 0 && alertStart < yMaxAll) {
    const bandTop = yFocus(alertStart);
    svgFocus.insert("rect", ":first-child")
      .attr("class", "alert-band")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", focusWidth)
      .attr("height", bandTop);
  }

  if (attentionTh != null && attentionTh > 0 && attentionTh < yMaxAll) {
    const attTop    = yFocus(attentionTh);
    const alertLine = (alertStart != null && alertStart > attentionTh) ? yFocus(alertStart) : attTop;
    svgFocus.insert("rect", ":first-child")
      .attr("class", "attention-band")
      .attr("x", 0)
      .attr("y", alertLine)
      .attr("width", focusWidth)
      .attr("height", Math.max(0, attTop - alertLine));
  }
}

// Draw one line per prefecture and wire tooltip hover behavior.
function drawLines(svgFocus, data, lineFocus) {
  const prefGroups = d3.groups(data, d => d.pref);
  prefGroups.forEach(([pref, arr]) => {
    arr.sort((a, b) => a.date - b.date);
    const lineColor = prefColor(pref);
    const safe = cssSafe(pref);

    svgFocus.append("path")
      .datum(arr)
      .attr("class", `line focus-line line-${safe}`)
      .attr("fill", "none")
      .attr("stroke", lineColor)
      .attr("stroke-width", 2)
      .attr("d", lineFocus)
      .on("mouseover", (event) => {
        d3.select(event.currentTarget).classed("highlight-line", true);
        tooltip.transition().duration(200).style("opacity", 0.9);
        tooltip.html(`<strong>${pref}</strong>`)
          .style("left", `${event.pageX + 10}px`)
          .style("top", `${event.pageY - 28}px`);
      })
      .on("mouseout", (event) => {
        d3.select(event.currentTarget).classed("highlight-line", false);
        tooltip.transition().duration(500).style("opacity", 0);
      });
  });
  return prefGroups;
}

// Draw data points (small markers + larger hit area) for interactions.
// On mobile: only the last point (endpoint dot) per prefecture is rendered —
// no hover hit areas, no intermediate markers.  This removes per-frame
// DOM churn while preserving the visual endpoint indicator.
function drawPoints(svgFocus, prefGroups, xFocus, yFocus) {
  prefGroups.forEach(([pref, arr]) => {
    const safe = cssSafe(pref);
    const pointColor = prefColor(pref);

    // On mobile render only the endpoint; on desktop render all points.
    const renderArr = _isMobile
      ? (arr.length ? [arr[arr.length - 1]] : [])
      : arr;

    const pointG = svgFocus.selectAll(`g.point-wrap-${safe}`)
      .data(renderArr)
      .enter()
      .append("g")
      .attr("class", `point-wrap-${safe}`)
      .attr("transform", d => `translate(${xFocus(d.date)},${yFocus(d.value)})`);

    pointG.each(function (d, i) {
      // On mobile every rendered point is the endpoint; on desktop check index.
      const isEnd = _isMobile || (i === arr.length - 1);
      const rVisible = isEnd ? 4.5 : 1.5;
      const rHit = isEnd ? 9 : 6;
      const g = d3.select(this);
      // Hover hit area only for desktop (touch devices don't have hover).
      if (!_isMobile) {
        g.append("circle")
          .attr("class", "point-hit")
          .attr("r", rHit)
          .attr("fill", "transparent")
          .style("pointer-events", "auto")
          .style("cursor", "pointer")
          .on("mouseover", function (event) {
            g.select("circle.point-visible").classed("highlight-circle", true);
            tooltip.transition().duration(200).style("opacity", 0.9);
            tooltip.html(`<strong>${pref}</strong><br>定点あたり患者数: ${d.value}人<br>${d.weekLabel || ""}`)
              .style("left", `${event.pageX + 10}px`)
              .style("top", `${event.pageY - 28}px`);
          })
          .on("mouseout", function () {
            g.select("circle.point-visible").classed("highlight-circle", false);
            tooltip.transition().duration(500).style("opacity", 0);
          });
      }
      g.append("circle")
        .attr("class", `point-${safe} point-visible`)
        .attr("r", rVisible)
        .attr("fill", pointColor)
        .style("pointer-events", "none");
    });
  });
}

// Place end labels with overlap-avoidance and clickable hit rectangles.
function drawEndLabels(svg, groups, xScale, yScale, extent, w, h, category) {
  svg.selectAll(".line-end-label-wrap").remove();
  const labelGap = 0;
  const labelPadding = 2;
  const endLabels = [];
  function handleLabelClick(pref, event) {
    event.stopPropagation();
    togglePrefHighlightForCategory(category, pref);
    drawAllCharts(getSelectedDropdownPrefectures());
    if (typeof updateUrlForChart === "function") updateUrlForChart(category);
  }
  groups.forEach(([pref, arr]) => {
    const visible = arr.filter(d => d.date >= extent[0] && d.date <= extent[1] && !Number.isNaN(d.value));
    const last = visible[visible.length - 1];
    if (!last) return;
    const endX = xScale(last.date);
    const endY = yScale(last.value);
    if (endX < -20 || endX > w + 20 || endY < -10 || endY > h + 10) return;
    const lineColor = prefColor(pref);
    const labelOffset = 8;
    const g = svg.append("g").attr("class", "line-end-label-wrap");
    const textEl = g.append("text")
      .attr("class", "line-end-label")
      .attr("data-pref", pref)
      .attr("x", endX + labelOffset)
      .attr("y", endY)
      .attr("dy", "0.35em")
      .attr("text-anchor", "start")
      .style("fill", lineColor)
      .style("font-weight", "600")
      .style("pointer-events", "none")
      .attr("role", "button")
      .attr("title", `${pref}の折れ線を強調表示（再度クリックで解除）`)
      .text(pref)
      .on("click", (event) => handleLabelClick(pref, event));
    endLabels.push({ groupNode: g.node(), node: textEl.node(), endY, endX, labelOffset, pref });
  });
  endLabels.sort((a, b) => a.endY - b.endY);
  let prevBottom = -1e9;
  endLabels.forEach((item) => {
    const el = item.node;
    const bbox = el.getBBox();
    const top = bbox.y;
    const bottom = bbox.y + bbox.height;
    if (top < prevBottom + labelGap) {
      const shift = prevBottom + labelGap - top;
      const newY = parseFloat(el.getAttribute("y")) + shift;
      el.setAttribute("y", newY);
      prevBottom = bottom + shift;
    } else {
      prevBottom = bottom;
    }
  });
  endLabels.forEach((item) => {
    const el = item.node;
    const bbox = el.getBBox();
    const minX = item.endX + item.labelOffset;
    const maxRight = w - labelPadding;
    if (bbox.x + bbox.width > maxRight) {
      el.setAttribute("x", Math.max(minX, maxRight - bbox.width));
    }
  });
  let blockTop = 1e9, blockBottom = -1e9;
  endLabels.forEach((item) => {
    const el = item.node;
    const bbox = el.getBBox();
    blockTop = Math.min(blockTop, bbox.y);
    blockBottom = Math.max(blockBottom, bbox.y + bbox.height);
  });
  let shiftY = 0;
  if (blockBottom > h) shiftY = -(blockBottom - h);
  if (blockTop + shiftY < 0) shiftY = -blockTop;
  if (shiftY !== 0) {
    endLabels.forEach((item) => {
      const el = item.node;
      const y = parseFloat(el.getAttribute("y"));
      el.setAttribute("y", y + shiftY);
    });
  }
  const hitPadding = 4;
  endLabels.forEach((item) => {
    const bbox = item.node.getBBox();
    d3.select(item.groupNode).insert("rect", ":first-child")
      .attr("class", "line-end-label-hit")
      .attr("x", bbox.x - hitPadding)
      .attr("y", bbox.y - 2)
      .attr("width", bbox.width + hitPadding * 2)
      .attr("height", bbox.height + 4)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .style("pointer-events", "auto")
      .on("click", (event) => handleLabelClick(item.pref, event));
  });
}

// Apply per-chart highlight state without redrawing the whole dashboard.
function updateChartVisibility(svg, prefs, category) {
  const highlightedPref = state.highlightedPrefByCategory[category] || null;
  if (!highlightedPref) {
    prefs.forEach(p => {
      const safe = cssSafe(p);
      svg.selectAll(`.line-${safe}`).classed("inactive-line", false);
      svg.selectAll(`circle.point-${safe}`).classed("inactive-circle", false);
    });
  } else {
    prefs.forEach(p => {
      const safe = cssSafe(p);
      const fade = p !== highlightedPref;
      svg.selectAll(`.line-${safe}`).classed("inactive-line", fade);
      svg.selectAll(`circle.point-${safe}`).classed("inactive-circle", fade);
    });
  }
}

// Compose one full chart: container, axes, lines, points, labels, brush.
function drawFocusContextChart(category, data) {
  const focusMargin = { top: 20, right: 58, bottom: 26, left: 44 };
  const FOCUS_OUTER_H = 220;
  const focusHeight = FOCUS_OUTER_H - focusMargin.top - focusMargin.bottom;

  const contextMargin = { top: 4, right: 34, bottom: 24, left: 44 };
  const contextHeight = 20;
  const CONTEXT_OUTER_H = contextHeight + contextMargin.top + contextMargin.bottom;

  data.sort((a, b) => a.date - b.date);
  const dataExtent = d3.extent(data, d => d.date);
  const yMaxAll = d3.max(data, d => d.value) || 0;

  const endDate = dataExtent[1] || new Date();
  const defaultStart = new Date(endDate.getFullYear() - 1, endDate.getMonth(), endDate.getDate());
  const initialExtent = state.savedBrushExtents[category] || [defaultStart, endDate];
  const selectedPrefs = getSelectedDropdownPrefectures();
  const { leftCharts, leftChartsW, focusWidth, svgFocusRoot, svgFocus, focusTransform } =
    createChartContainer(category, data, focusMargin, focusHeight, FOCUS_OUTER_H);

  const xFocus = d3.scaleTime()
    .domain(initialExtent)
    .range([0, focusWidth]);

  const yFocus = d3.scaleLinear()
    .domain([0, yMaxAll])
    .range([focusHeight, 0]);

  drawAxes(svgFocus, xFocus, yFocus, focusHeight, focusWidth, category, yMaxAll);

  const lineFocus = d3.line()
    .defined(d => !Number.isNaN(d.value))
    .x(d => xFocus(d.date))
    .y(d => yFocus(d.value));

  const prefGroups = drawLines(svgFocus, data, lineFocus);

  // 初期描画のドット・ラベルは表示窓内のデータだけに限定する。
  // 全データ（最大700点超）でサークルを生成すると DOM ノード数が爆増して重くなるため。
  // ブラッシュ移動時は brushed() でフィルタ済みデータから再生成されるので一貫性がある。
  const initialVisible = data.filter(d => d.date >= initialExtent[0] && d.date <= initialExtent[1]);
  const prefGroupsVisible = d3.groups(initialVisible, d => d.pref);
  drawPoints(svgFocus, prefGroupsVisible, xFocus, yFocus);

  const svgFocusLabels = svgFocusRoot.append("g")
    .attr("class", "focus-end-labels")
    .attr("transform", focusTransform);
  drawEndLabels(svgFocusLabels, prefGroupsVisible, xFocus, yFocus, initialExtent, focusWidth + focusMargin.right - 8, focusHeight, category);

  // Mobile: transparent overlay + bisect-based tooltip (1 rect, 0 per-point listeners).
  // The per-circle approach costs O(n) DOM nodes redrawn on every brush frame;
  // this is O(1) regardless of data size.
  if (_isMobile) {
    const bisectDate = d3.bisector(d => d.date).left;

    // Pre-sort per-pref arrays once so bisect is O(log n) on touchmove.
    const sortedByPref = new Map();
    d3.groups(data, d => d.pref).forEach(([pref, arr]) => {
      sortedByPref.set(pref, arr.slice().sort((a, b) => a.date - b.date));
    });

    // One dot per pref, hidden until finger touches the chart.
    const hoverDots = new Map();
    sortedByPref.forEach((_, pref) => {
      hoverDots.set(pref, svgFocus.append("circle")
        .attr("class", "hover-dot")
        .attr("r", 5)
        .attr("fill", prefColor(pref))
        .attr("display", "none")
        .style("pointer-events", "none"));
    });

    // One transparent rect covers the whole focus area and catches all touches.
    svgFocus.append("rect")
      .attr("class", "hover-area")
      .attr("width", focusWidth)
      .attr("height", focusHeight)
      .attr("fill", "transparent")
      .style("pointer-events", "all")
      .on("touchmove", function(event) {
        event.preventDefault();
        const touch = event.touches[0] || event.changedTouches[0];
        if (!touch) return;
        const [mx] = d3.pointer(touch, this);
        const x0 = xFocus.invert(mx);
        const [domStart, domEnd] = xFocus.domain();

        // For each pref find the nearest point by x (date), then pick the
        // single pref whose y value is closest to the finger's y position.
        const [, my] = d3.pointer(touch, this);
        const y0 = yFocus.invert(my);
        let best = null;
        sortedByPref.forEach((arr, pref) => {
          const visible = arr.filter(d => d.date >= domStart && d.date <= domEnd);
          if (!visible.length) return;
          const i = bisectDate(visible, x0, 1);
          const d0 = visible[i - 1];
          const d1 = visible[i];
          const d = !d0 ? d1 : !d1 ? d0 :
            (x0 - d0.date > d1.date - x0 ? d1 : d0);
          if (!d) return;
          const dist = Math.abs(d.value - y0);
          if (!best || dist < best.dist) best = { pref, d, dist };
        });
        if (!best) return;

        // Show only the closest pref's dot; hide all others.
        hoverDots.forEach((dot, pref) => {
          if (pref === best.pref) {
            dot.attr("display", null)
               .attr("cx", xFocus(best.d.date))
               .attr("cy", yFocus(best.d.value));
          } else {
            dot.attr("display", "none");
          }
        });

        tooltip
          .style("opacity", 0.9)
          .html(`<strong>${best.pref}</strong><br>定点あたり患者数: ${best.d.value}人<br>${best.d.weekLabel || ""}`)
          .style("left", `${touch.pageX + 10}px`)
          .style("top", `${touch.pageY - 28}px`);
      })
      .on("touchend touchcancel", function() {
        hoverDots.forEach(dot => dot.attr("display", "none"));
        tooltip.style("opacity", 0);
      });
  }

  drawBrush({
    category,
    data,
    selectedPrefs,
    leftCharts,
    leftChartsW,
    contextMargin,
    contextHeight,
    CONTEXT_OUTER_H,
    dataExtent,
    initialExtent,
    focusMargin,
    focusWidth,
    focusHeight,
    svgFocus,
    svgFocusLabels,
    xFocus,
    yFocus,
    lineFocus
  });
}

// Draw/handle range brush for focus area and incremental updates.
function drawBrush(ctx) {
  const {
    category, data, selectedPrefs, leftCharts, leftChartsW,
    contextMargin, contextHeight, CONTEXT_OUTER_H, dataExtent, initialExtent,
    focusMargin, focusWidth, focusHeight, svgFocus, svgFocusLabels, xFocus, yFocus, lineFocus
  } = ctx;

  const sliderWrapper = leftCharts.append("div").attr("class", "slider-wrapper");
  sliderWrapper.append("div").attr("class", "slider-header");

  const totalCtxW = leftChartsW;
  const totalCtxH = CONTEXT_OUTER_H;
  const contextWidth = Math.max(1, totalCtxW - contextMargin.left - contextMargin.right);
  const xContext = d3.scaleTime().domain(dataExtent).range([0, contextWidth]);
  const xAxisContext = d3.axisBottom(xContext).ticks(d3.timeYear.every(3)).tickFormat(d => `${d.getFullYear()}年`);
  const svgContext = sliderWrapper.append("svg")
    .attr("class", "svg-content")
    .attr("viewBox", `0 0 ${totalCtxW} ${totalCtxH}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .append("g")
    .attr("transform", `translate(${contextMargin.left},${contextMargin.top})`);

  svgContext.append("rect").attr("class", "slider-track-bg").attr("x", 0).attr("y", 0).attr("width", contextWidth).attr("height", contextHeight);
  const dimLeft = svgContext.append("rect").attr("class", "context-dim").attr("x", 0).attr("y", 0).attr("height", contextHeight).attr("width", 0);
  const dimRight = svgContext.append("rect").attr("class", "context-dim").attr("x", contextWidth).attr("y", 0).attr("height", contextHeight).attr("width", 0);
  const ctxAxisG = svgContext.append("g").attr("class", "axis x-axis").attr("transform", `translate(0,${contextHeight})`).call(xAxisContext);
  removeOverlappingTicksX(ctxAxisG);

  // On mobile: only update dim/grips during drag ("brush"); run the full
  // brushed logic only on release ("end") to avoid per-pixel DOM churn.
  // On desktop: run the full handler on every "brush" event as before.
  const brush = d3.brushX()
    .extent([[0, 0], [contextWidth, contextHeight]])
    .on("brush end", brushed);
  const brushG = svgContext.append("g").attr("class", "brush").call(brush);

  const handleVisibleWidth = 28;
  const handleHitWidth = handleVisibleWidth;
  brushG.selectAll(".handle").attr("height", contextHeight).attr("y", 0).attr("class", "handle handle-hit");

  function updateHandleHitAreas(sx0, sx1) {
    const selectionW = Math.max(0, sx1 - sx0);
    const minCenterGap = 12;
    const maxPerHandle = Math.max(3, (selectionW - minCenterGap) / 2);
    const w = Math.max(3, Math.min(handleHitWidth, maxPerHandle));
    brushG.selectAll(".handle").attr("width", w).attr("x", (d, i) => (i === 0 ? sx0 - w / 2 : sx1 - w / 2));
  }

  const gripLeft = brushG.append("g").attr("class", "brush-handle-grip").attr("aria-label", "左のつまみをドラッグで期間の開始を変更");
  gripLeft.append("line"); gripLeft.append("line"); gripLeft.append("line");
  const gripRight = brushG.append("g").attr("class", "brush-handle-grip").attr("aria-label", "右のつまみをドラッグで期間の終了を変更");
  gripRight.append("line"); gripRight.append("line"); gripRight.append("line");
  function updateGrip(group, x) {
    group.attr("transform", `translate(${x},0)`);
    const lines = group.selectAll("line").nodes();
    const ys = [6, contextHeight - 6];
    d3.select(lines[0]).attr("x1", -4).attr("x2", -4).attr("y1", ys[0]).attr("y2", ys[1]);
    d3.select(lines[1]).attr("x1", 0).attr("x2", 0).attr("y1", ys[0]).attr("y2", ys[1]);
    d3.select(lines[2]).attr("x1", 4).attr("x2", 4).attr("y1", ys[0]).attr("y2", ys[1]);
  }

  const initialSel = state.savedBrushExtents[category]
    ? [xContext(state.savedBrushExtents[category][0]), xContext(state.savedBrushExtents[category][1])]
    : [xContext(initialExtent[0]), xContext(initialExtent[1])];
  brushG.call(brush.move, initialSel);
  updateHandleHitAreas(initialSel[0], initialSel[1]);
  dimLeft.attr("x", 0).attr("width", initialSel[0]);
  dimRight.attr("x", initialSel[1]).attr("width", Math.max(0, contextWidth - initialSel[1]));
  updateGrip(gripLeft, initialSel[0]);
  updateGrip(gripRight, initialSel[1]);
  updateChartVisibility(svgFocus, selectedPrefs, category);

  function brushed(event) {
    const sel = event.selection;
    if (!sel) return;
    const [sx0, sx1] = sel;
    const [x0, x1] = sel.map(xContext.invert);
    state.savedBrushExtents[category] = [x0, x1];

    dimLeft.attr("x", 0).attr("width", sx0);
    dimRight.attr("x", sx1).attr("width", Math.max(0, contextWidth - sx1));
    updateHandleHitAreas(sx0, sx1);
    updateGrip(gripLeft, sx0);
    updateGrip(gripRight, sx1);

    xFocus.domain([x0, x1]);
    const newTickInterval = computeTickInterval(xFocus.domain());
    const newTickFormat = computeTickFormat(xFocus.domain());
    svgFocus.select(".x-axis").call(d3.axisBottom(xFocus).ticks(newTickInterval).tickFormat(newTickFormat));
    removeOverlappingTicksX(svgFocus.select(".x-axis"));

    // Recompute only data currently inside the selected time range.
    const visibleData = data.filter(d => d.date >= x0 && d.date <= x1);
    const newYMax = d3.max(visibleData, d => d.value) || 0;
    yFocus.domain([0, newYMax]);
    const newYTicks = computeCustomYAxisTicks(yFocus.domain()[1]);
    svgFocus.select(".y-axis").call(d3.axisLeft(yFocus).tickValues(newYTicks));
    hideYAxisTicksOverlappingUnit(svgFocus);

    const zoomAlertStart  = state.alertThresholdsMap[category];
    const zoomAttentionTh = state.attentionMap ? state.attentionMap[category] : null;
    if (zoomAlertStart != null && zoomAlertStart > 0) {
      svgFocus.selectAll(".alert-band").attr("y", 0).attr("height", Math.max(0, yFocus(zoomAlertStart)));
    }
    if (zoomAttentionTh != null && zoomAttentionTh > 0) {
      const attTop    = yFocus(zoomAttentionTh);
      const alertLine = (zoomAlertStart != null && zoomAlertStart > zoomAttentionTh) ? yFocus(zoomAlertStart) : attTop;
      svgFocus.selectAll(".attention-band")
        .attr("y", alertLine)
        .attr("height", Math.max(0, attTop - alertLine));
    }

    // Update line paths first, then rebuild points/labels for correctness.
    const prefGroupsLocal = d3.groups(visibleData, d => d.pref);
    prefGroupsLocal.forEach(([pref, arr]) => {
      arr.sort((a, b) => a.date - b.date);
      const safe = cssSafe(pref);
      svgFocus.selectAll(`.line-${safe}`).datum(arr).attr("d", lineFocus);
    });

    svgFocus.selectAll('g[class^="point-wrap-"]').remove();
    drawPoints(svgFocus, prefGroupsLocal, xFocus, yFocus);
    // Keep hover-area on top so touch events always reach it.
    svgFocus.select(".hover-area").raise();
    drawEndLabels(svgFocusLabels, prefGroupsLocal, xFocus, yFocus, [x0, x1], focusWidth + focusMargin.right - 8, focusHeight, category);
    updateChartVisibility(svgFocus, getSelectedDropdownPrefectures(), category);
  }
}

let chartTargetTimeout = null;
async function goToChart(pref, category) {
  state.selectedChartPrefectures.add(pref);
  state.selectedCategories.add(category);
  state.categoryDisplayOrder = state.categoryDisplayOrder.filter(x => x !== category);
  state.categoryDisplayOrder.unshift(category);
  refreshPrefectureOptions();
  refreshDiseaseOptions();
  renderChartPrefectureTags();
  renderChartDiseaseTags();
  state.highlightedPrefByCategory[category] = pref;
  await drawAllCharts(getSelectedDropdownPrefectures());
  await ensureCategoryChartDrawn(category); // placeholder なら描画完了まで待つ
  const charts = document.querySelectorAll(".chart");
  const chartContainer = document.getElementById("chart-container");
  if (chartContainer) chartContainer.querySelectorAll(".chart-target").forEach(el => el.classList.remove("chart-target"));
  if (chartTargetTimeout != null) clearTimeout(chartTargetTimeout);
  for (const chartEl of charts) {
    const h2 = chartEl.querySelector("h2");
    if (h2 && h2.textContent.trim() === category) {
      chartEl.classList.remove("chart-target");
      void chartEl.offsetWidth; // reflow to restart animation
      chartEl.classList.add("chart-target");
      setTimeout(() => {
        const top = chartEl.getBoundingClientRect().top + window.scrollY - 16;
        const start = window.scrollY;
        const dist = top - start;
        const duration = 900;
        const startTime = performance.now();
        const easeInOut = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        function step(now) {
          const elapsed = Math.min((now - startTime) / duration, 1);
          window.scrollTo(0, start + dist * easeInOut(elapsed));
          if (elapsed < 1) requestAnimationFrame(step);
          else chartEl.focus();
        }
        requestAnimationFrame(step);
      }, 400);
      if (chartTargetTimeout != null) clearTimeout(chartTargetTimeout);
      chartTargetTimeout = setTimeout(() => {
        chartTargetTimeout = null;
        chartEl.classList.remove("chart-target");
      }, 10000);
      break;
    }
  }
}
window.goToChart = goToChart;

let drawAllChartsRafId = null;
function scheduleDrawAllCharts() {
  if (drawAllChartsRafId != null) cancelAnimationFrame(drawAllChartsRafId);
  drawAllChartsRafId = requestAnimationFrame(() => {
    drawAllChartsRafId = null;
    drawAllCharts(getSelectedDropdownPrefectures());
  });
}

function setupResizeRedraw() {
  let t = null;
  let lastW = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  window.addEventListener("resize", () => {
    const w = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    if (Math.abs(w - lastW) < 2) return;
    lastW = w;
    clearTimeout(t);
    t = setTimeout(() => scheduleDrawAllCharts(), 180);
  });
  window.addEventListener("orientationchange", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      lastW = window.visualViewport ? window.visualViewport.width : window.innerWidth;
      scheduleDrawAllCharts();
    }, 250);
  });
}
