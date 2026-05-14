# =============================================================================
# generate_ogp.R
#  サイトの「3つの切り口」カード（最も警戒が必要 / 最も増加が激しい /
#  最も季節外れの多さ）を再現した OGP 画像（1200×630）を生成する。
#  毎日の daily_task.Rmd の最後で source() されることを想定。
# =============================================================================

suppressPackageStartupMessages({
  library(ggplot2)
  library(jsonlite)
  library(readr)
  library(dplyr)
})

# ---- 日本語フォント設定（showtext があれば使用） ----------------------------
.use_showtext <- requireNamespace("showtext", quietly = TRUE) &&
                  requireNamespace("sysfonts", quietly = TRUE)
if (.use_showtext) {
  ok <- tryCatch({
    sysfonts::font_add_google("Noto Sans JP", "noto")
    showtext::showtext_auto()
    showtext::showtext_opts(dpi = 100)
    TRUE
  }, error = function(e) {
    message("showtext: フォント取得に失敗 -> 既定フォントを使用 (", e$message, ")")
    FALSE
  })
  if (!ok) .use_showtext <- FALSE
}
ff <- if (.use_showtext) "noto" else ""

# ---- データ読み込み --------------------------------------------------------
res_dir <- "docs/results"
news_digest <- jsonlite::read_json(
  file.path(res_dir, "news_digest.json"), simplifyVector = TRUE
)
ranking <- readr::read_csv(
  file.path(res_dir, "ranking.csv"),
  show_col_types = FALSE, locale = locale(encoding = "UTF-8")
)
ts_path <- file.path(res_dir, "data-全国.csv")
ts_data <- if (file.exists(ts_path)) {
  readr::read_csv(ts_path, show_col_types = FALSE,
                  locale = locale(encoding = "UTF-8"))
} else NULL
last_fetch <- tryCatch(
  readLines(file.path(res_dir, "last_fetch.txt"), warn = FALSE)[1],
  error = function(e) format(Sys.Date(), "%Y-%m-%d")
)
latest_data_date <- if (!is.null(ts_data) && "date" %in% names(ts_data)) {
  suppressWarnings(max(as.Date(ts_data$date), na.rm = TRUE))
} else NA

# 警報基準値マップ
alert_th_path <- "docs/data/alert_thresholds.csv"
alert_thresholds <- if (file.exists(alert_th_path)) {
  th <- readr::read_csv(alert_th_path, show_col_types = FALSE,
                        locale = locale(encoding = "UTF-8"))
  setNames(suppressWarnings(as.numeric(th$alert_start)), th$category)
} else stats::setNames(numeric(0), character(0))

# ---- 補助関数 -------------------------------------------------------------
nat_prefs <- c("全国", "全国平均")

first_field <- function(x, field) {
  if (is.null(x)) return(NA)
  if (is.data.frame(x)) {
    if (nrow(x) == 0 || !field %in% names(x)) return(NA)
    return(x[[field]][[1]])
  }
  if (is.list(x) && length(x) > 0 && is.list(x[[1]])) {
    v <- x[[1]][[field]]
    return(if (is.null(v)) NA else v)
  }
  NA
}

fmt_date <- function(s) {
  d <- suppressWarnings(as.Date(s))
  if (is.na(d)) return(s)
  sprintf("%d年%d月%d日",
          as.integer(format(d, "%Y")),
          as.integer(format(d, "%m")),
          as.integer(format(d, "%d")))
}

fmt_signed_pct <- function(rate) {
  if (is.na(rate) || !is.finite(rate)) return("—")
  pct <- round(rate * 100)
  sprintf("%s%d", ifelse(pct >= 0, "+", ""), pct)
}

fmt_signed_pct_from_ratio <- function(r) {
  if (is.na(r) || !is.finite(r)) return("—")
  pct <- round((r - 1) * 100)
  sprintf("%s%d", ifelse(pct >= 0, "+", ""), pct)
}

# 既知の感染症名に対する自然な改行位置（語の切れ目で区切る）
disease_wrap_map <- list(
  "A群溶血性レンサ球菌咽頭炎"     = "A群溶血性レンサ\n球菌咽頭炎",
  "感染性胃腸炎（ロタウイルス）"  = "感染性胃腸炎\n（ロタウイルス）"
)

wrap_jp <- function(s, max_per_line = 7) {
  if (is.na(s) || s == "—") return(s)
  # 改行が必要な特定の感染症のみテーブル参照、それ以外はそのまま1行
  if (!is.null(disease_wrap_map[[s]])) return(disease_wrap_map[[s]])
  s
}

get_spark_values <- function(category, n_weeks = 26) {
  if (is.null(ts_data) || is.na(category)) return(numeric(0))
  d <- ts_data %>%
    dplyr::filter(category == !!category) %>%
    dplyr::arrange(date) %>%
    dplyr::slice_tail(n = n_weeks)
  if (nrow(d) < 2) return(numeric(0))
  as.numeric(d$value)
}

get_ratio_alert <- function(category) {
  if (is.na(category) || category == "—") return(NA)
  r <- ranking %>% dplyr::filter(pref %in% nat_prefs, category == !!category)
  if (nrow(r) > 0) r$ratio_alert[[1]] else NA
}

is_in_alert <- function(category) {
  ra <- get_ratio_alert(category)
  isTRUE(is.finite(ra) && ra > 1)
}

# 値の系列を閾値で分割し、超過/非超過のラン（連続区間）に分ける
split_runs_at_threshold <- function(values, threshold) {
  n <- length(values)
  if (n < 2) return(list())
  has_th <- !is.na(threshold) && is.finite(threshold) && threshold > 0
  pi <- numeric(0); pv <- numeric(0); pa <- logical(0)
  pi <- c(pi, 1); pv <- c(pv, values[1])
  pa <- c(pa, if (has_th) values[1] > threshold else FALSE)
  for (i in seq_len(n - 1)) {
    v1 <- values[i]; v2 <- values[i + 1]
    a1 <- if (has_th) v1 > threshold else FALSE
    a2 <- if (has_th) v2 > threshold else FALSE
    if (has_th && a1 != a2 && v2 != v1) {
      t <- (threshold - v1) / (v2 - v1)
      cross <- i + t
      pi <- c(pi, cross, cross)
      pv <- c(pv, threshold, threshold)
      pa <- c(pa, a1, a2)
    }
    pi <- c(pi, i + 1); pv <- c(pv, v2); pa <- c(pa, a2)
  }
  runs <- list()
  cur <- list(idx = pi[1], val = pv[1], alert = pa[1])
  for (k in 2:length(pi)) {
    if (pa[k] == cur$alert) {
      cur$idx <- c(cur$idx, pi[k]); cur$val <- c(cur$val, pv[k])
    } else {
      runs[[length(runs) + 1]] <- cur
      cur <- list(idx = pi[k], val = pv[k], alert = pa[k])
    }
  }
  runs[[length(runs) + 1]] <- cur
  runs
}

approx_text_width <- function(s, size) {
  if (is.null(s) || is.na(s) || nchar(s) == 0) return(0)
  chars <- strsplit(s, "")[[1]]
  total <- 0
  for (ch in chars) {
    code <- utf8ToInt(ch)
    if (code > 127) {
      total <- total + size * 0.040
    } else if (ch %in% c(".", " ")) {
      total <- total + size * 0.013
    } else if (ch %in% c("+", "-", "%")) {
      total <- total + size * 0.020
    } else {
      total <- total + size * 0.022
    }
  }
  total
}

# ---- 3つの切り口のリード感染症と数値 ---------------------------------------
alert <- ranking %>%
  dplyr::filter(pref %in% nat_prefs, is.finite(ratio_alert)) %>%
  dplyr::arrange(dplyr::desc(ratio_alert)) %>%
  dplyr::slice(1)

rising_cat  <- first_field(news_digest$rising, "category")
rising_rate <- first_field(news_digest$rising, "growth1Rate")

anomaly_cat <- first_field(news_digest$anomalies, "category")
anomaly_ryoy <- if (!is.na(anomaly_cat)) {
  r <- ranking %>% dplyr::filter(pref %in% nat_prefs, category == anomaly_cat)
  if (nrow(r) > 0) r$ratio_yoy[[1]] else NA
} else NA

cards <- list(
  list(
    label = "最も警戒が必要",
    color = "#dc2626",
    category = if (nrow(alert) > 0) alert$category[[1]] else "—",
    prefix = "警報基準値の",
    number = if (nrow(alert) > 0 && is.finite(alert$ratio_alert[[1]]))
               sprintf("%.2f", alert$ratio_alert[[1]]) else "—",
    suffix = "倍"
  ),
  list(
    label = "最も増加が激しい",
    color = "#ea580c",
    category = if (!is.na(rising_cat)) rising_cat else "—",
    prefix = "前週比",
    number = fmt_signed_pct(rising_rate),
    suffix = "%"
  ),
  list(
    label = "最も季節外れの多さ",
    color = "#7c3aed",
    category = if (!is.na(anomaly_cat)) anomaly_cat else "—",
    prefix = "平年比",
    number = fmt_signed_pct_from_ratio(anomaly_ryoy),
    suffix = "%"
  )
)

# ---- レイアウト構築（座標系 0-12 × 0-6.3） -----------------------------
W <- 12; H <- 6.3

SZ_TITLE   <- 12
SZ_SUBTTL  <- 6
SZ_LABEL   <- 6.5
SZ_DISEASE <- 10
SZ_METRIC  <- 6.5
SZ_NUMBER  <- 10
SZ_FOOTER  <- 5.5

METRIC_GRAY <- "#6b7280"
METRIC_RED  <- "#dc2626"
SPARK_GRAY  <- "#9ca3af"
SPARK_RED   <- "#b91c1c"

p <- ggplot() +
  annotate("rect", xmin = 0, xmax = W, ymin = 0, ymax = H,
           fill = "#f9fafb", color = NA) +
  annotate("rect", xmin = 0, xmax = W, ymin = H - 0.08, ymax = H,
           fill = "#0369a1", color = NA) +
  # タイトル
  annotate("text", x = 0.5, y = H - 0.55,
           label = "都道府県別にみた主な感染症の流行状況",
           hjust = 0, vjust = 0.5,
           family = ff, fontface = "bold", size = SZ_TITLE, color = "#0c0c0c") +
  # 最新データ ＋ 最終更新（同じ行）
  annotate("text", x = 0.5, y = H - 1.2,
           label = sprintf(
             "最新データ：%s    最終更新：%s",
             if (inherits(latest_data_date, "Date") && !is.na(latest_data_date))
               fmt_date(latest_data_date) else "—",
             fmt_date(last_fetch)
           ),
           hjust = 0, vjust = 0.5,
           family = ff, size = SZ_SUBTTL, color = "#666666") +
  coord_cartesian(xlim = c(0, W), ylim = c(0, H), expand = FALSE) +
  theme_void() +
  theme(plot.margin = margin(0, 0, 0, 0))

# 3カード配置
cw <- 3.7; ch <- 3.6; gap <- 0.2
total_w <- 3 * cw + 2 * gap
x0_base <- (W - total_w) / 2
cy_top <- H - 1.7
cy_bot <- cy_top - ch

for (i in seq_along(cards)) {
  c <- cards[[i]]
  x0 <- x0_base + (i - 1) * (cw + gap)
  x1 <- x0 + cw
  cx <- (x0 + x1) / 2

  in_alert <- is_in_alert(c$category)
  metric_color <- if (in_alert) METRIC_RED else METRIC_GRAY

  # カード本体
  p <- p +
    annotate("rect", xmin = x0, xmax = x1, ymin = cy_bot, ymax = cy_top,
             fill = "#ffffff", color = "#e5e7eb", linewidth = 0.4) +
    annotate("rect", xmin = x0, xmax = x1, ymin = cy_top - 0.08, ymax = cy_top,
             fill = c$color, color = NA) +
    # シグナルラベル（カード上部）
    annotate("text", x = cx, y = cy_top - 0.45, label = c$label,
             family = ff, size = SZ_LABEL, color = "#555555")

  # 上段：感染症名（カード横幅フル使用、中央寄せ）
  disease_y <- cy_top - 1.5
  p <- p +
    annotate("text", x = cx, y = disease_y,
             hjust = 0.5, vjust = 0.5,
             label = wrap_jp(c$category, 7),
             family = ff, fontface = "bold",
             size = SZ_DISEASE, color = "#0c0c0c", lineheight = 0.95)

  # 下段：左にメトリック、右にスパークライン
  left_cx <- x0 + cw * 0.27
  spark_x0 <- x0 + cw * 0.52
  spark_x1 <- x1 - 0.20

  body_y_top <- cy_top - 2.45
  body_y_bot <- cy_bot + 0.30
  # メトリック：上に prefix、下に number + suffix（行間は半分に詰める）
  prefix_y <- cy_top - 2.70
  number_y <- cy_top - 3.05

  p <- p +
    annotate("text", x = left_cx, y = prefix_y,
             hjust = 0.5, vjust = 0.5,
             label = c$prefix,
             family = ff, size = SZ_METRIC, color = metric_color)

  # 「●●倍」「●●%」を組合せて1行で描画（数字のみ大きい）
  nw <- approx_text_width(c$number, SZ_NUMBER)
  sw <- approx_text_width(c$suffix, SZ_METRIC)
  total_lw <- nw + sw
  num_start <- left_cx - total_lw / 2
  if (nchar(c$number) > 0) {
    p <- p + annotate("text", x = num_start, y = number_y, label = c$number,
                      hjust = 0, vjust = 0.5,
                      family = ff, fontface = "bold",
                      size = SZ_NUMBER, color = metric_color)
  }
  if (nchar(c$suffix) > 0) {
    p <- p + annotate("text", x = num_start + nw + 0.08, y = number_y, label = c$suffix,
                      hjust = 0, vjust = 0.5,
                      family = ff, size = SZ_METRIC, color = metric_color)
  }

  # 右カラム：スパークライン
  values <- get_spark_values(c$category, n_weeks = 52)
  if (length(values) >= 2) {
    spark_y0 <- body_y_bot + 0.15
    spark_y1 <- body_y_top - 0.05
    n <- length(values)
    threshold <- alert_thresholds[c$category]
    if (is.null(threshold) || length(threshold) == 0) threshold <- NA_real_

    vmin <- 0
    vmax <- max(values, na.rm = TRUE) * 1.15
    if (vmax <= 0) vmax <- 1
    if (!is.na(threshold) && is.finite(threshold) &&
        threshold <= max(values, na.rm = TRUE) * 1.3) {
      vmax <- max(vmax, threshold * 1.05)
    }

    to_vis_x <- function(idx) spark_x0 + (idx - 1) / (n - 1) * (spark_x1 - spark_x0)
    to_vis_y <- function(v)   spark_y0 + (v - vmin) / (vmax - vmin) * (spark_y1 - spark_y0)

    if (!is.na(threshold) && is.finite(threshold) && threshold <= vmax) {
      th_y <- to_vis_y(threshold)
      p <- p +
        annotate("segment", x = spark_x0, xend = spark_x1, y = th_y, yend = th_y,
                 color = "#cbd5e1", linewidth = 0.3, linetype = "dashed")
    }

    runs <- split_runs_at_threshold(values, threshold)
    for (run in runs) {
      if (length(run$idx) < 2) next
      df <- data.frame(x = to_vis_x(run$idx), y = to_vis_y(run$val))
      seg_color <- if (isTRUE(run$alert)) SPARK_RED else SPARK_GRAY
      seg_width <- if (isTRUE(run$alert)) 1.2 else 0.7
      p <- p + geom_path(data = df, aes(x = x, y = y),
                         color = seg_color, linewidth = seg_width,
                         inherit.aes = FALSE)
    }

    end_alert <- !is.na(threshold) && is.finite(threshold) && values[n] > threshold
    p <- p + annotate("point",
                       x = to_vis_x(n), y = to_vis_y(values[n]),
                       color = if (end_alert) SPARK_RED else SPARK_GRAY, size = 1.5)
  }
}

# フッター
p <- p +
  annotate("text", x = W / 2, y = 0.35,
           label = "ryomakom.github.io/infectious_diseases",
           family = ff, size = SZ_FOOTER, color = "#888888")

ggsave("docs/ogp.png", p, width = W, height = H, dpi = 100, bg = "white")
message("OGP画像を生成: docs/ogp.png")
