# test_bullets.R
# 任意の週について bullets の生成結果を確認するテストスクリプト。
# daily_task.Rmd と同じロジックを使用。
#
# 使い方:
#   1. target_week を確認したい週番号（"YYYY-WW" 形式）に変える
#   2. Rscript test_bullets.R  または RStudio で source()
#
# 例: target_week <- "2025-18"

library(tidyverse)
library(lubridate)

# スクリプトは R/tests/ にある前提。プロジェクトルートは2階層上。
{
  args <- commandArgs(trailingOnly = FALSE)
  script_flag <- grep("--file=", args, value = TRUE)
  if (length(script_flag) > 0) {
    script_path <- sub("--file=", "", script_flag[1])
    setwd(normalizePath(file.path(dirname(script_path), "..", "..")))
  } else if (requireNamespace("rstudioapi", quietly = TRUE) &&
             rstudioapi::isAvailable()) {
    setwd(normalizePath(file.path(
      dirname(rstudioapi::getActiveDocumentContext()$path), "..", "..")))
  }
}

# ---- 設定 ----
# コマンドライン引数があればそちらを優先: Rscript test_bullets.R 2025-18
target_week <- NULL  # NULL にすると最新週を自動選択
{
  cli_args <- commandArgs(trailingOnly = TRUE)
  if (length(cli_args) > 0 && grepl("^\\d{4}-\\d{2}$", cli_args[1])) {
    target_week <- cli_args[1]
  }
}

# ---- 定数 ----
MIN_CURRENT_MA4    <- 0.1
MIN_AVG_FOR_GROWTH <- 0.1
PERSISTENCE_WINDOW <- 4L

# ---- データ読み込み ----
cleaned_diseases <- read_csv("data/merged/merged_data.csv", show_col_types = FALSE) %>%
  mutate(date = as.Date(date), value = as.numeric(value))

alert <- read_csv("docs/data/alert_thresholds.csv", col_types = "cdddc")

# ---- 週集計 ----
yw <- cleaned_diseases %>%
  distinct(date) %>%
  mutate(
    yr        = year(date),
    wk        = isoweek(date),
    year_week = sprintf("%04d-%02d", yr, wk)
  ) %>%
  select(date, year_week, yr, wk)

d <- cleaned_diseases %>%
  left_join(yw, by = "date") %>%
  group_by(pref, category) %>%
  arrange(date) %>%
  mutate(
    ma4 = if_else(
      row_number() >= 4,
      (value + lag(value, 1) + lag(value, 2) + lag(value, 3)) / 4,
      NA_real_
    )
  ) %>%
  ungroup() %>%
  filter(!is.na(ma4))

by_week <- d %>%
  group_by(pref, category, year_week) %>%
  summarise(
    ma4          = last(ma4),
    weekly_value = last(value),
    yr           = last(yr),
    wk           = last(wk),
    .groups      = "drop"
  )

# target_week の決定
all_weeks   <- sort(unique(by_week$year_week))
target_week <- if (is.null(target_week)) max(all_weeks) else target_week

if (!target_week %in% all_weeks) {
  stop("指定した週 '", target_week, "' がデータに存在しません。\n利用可能な週: ",
       paste(tail(all_weeks, 10), collapse = ", "))
}

message("対象週: ", target_week)

# ---- ranking 相当の計算 ----
latest_yr      <- as.integer(substr(target_week, 1, 4))
latest_wk_int  <- as.integer(substr(target_week, 6, 7))

past_3_window_yr_wks <- sprintf("%04d-%02d",
  rep((latest_yr - 1):(latest_yr - 3), each = 4),
  rep((latest_wk_int - 3):latest_wk_int, times = 3)
)

current_ma4 <- d %>%
  filter(year_week == target_week) %>%
  group_by(pref, category) %>%
  slice_max(date, n = 1, with_ties = FALSE) %>%
  ungroup() %>%
  select(pref, category, current_ma4 = ma4)

baseline_ma4 <- by_week %>%
  filter(year_week %in% past_3_window_yr_wks) %>%
  group_by(pref, category) %>%
  summarise(baseline_ma4 = mean(weekly_value, na.rm = TRUE), .groups = "drop")

ranking <- current_ma4 %>%
  inner_join(baseline_ma4, by = c("pref", "category")) %>%
  filter(baseline_ma4 > 0) %>%
  mutate(
    ratio_heinen = round(current_ma4 / baseline_ma4, 2),
    year_week    = target_week
  ) %>%
  left_join(alert %>% select(category, alert_start), by = "category") %>%
  mutate(
    ratio_alert = if_else(
      !is.na(alert_start) & alert_start > 0,
      round(current_ma4 / alert_start, 2),
      NA_real_
    )
  )

# ---- weekly_series ----
weekly_series <- by_week %>%
  filter(year_week <= target_week) %>%
  arrange(pref, category, year_week) %>%
  group_by(pref, category) %>%
  summarise(
    ma4_series          = list(ma4),
    weekly_value_series = list(weekly_value),
    year_series         = list(yr),
    week_series         = list(wk),
    .groups             = "drop"
  )

# ---- ユーティリティ関数 ----
safe_num <- function(x, digits = 4) ifelse(is.finite(x), round(as.numeric(x), digits), NA_real_)

computeSeasonalBaseline <- function(rows) {
  rows %>%
    mutate(
      seasonal_mean = pmap_dbl(
        list(weekly_value_series, year_series, week_series),
        function(wvs, yrs, wks) {
          if (length(wvs) <= 1) return(NA_real_)
          cy <- tail(yrs, 1); cw <- tail(wks, 1)
          byr <- (cy - 1L):(cy - 3L)
          bwk <- (cw - 3L):cw
          idx <- yrs %in% byr & wks %in% bwk & is.finite(wvs)
          m <- mean(wvs[idx], na.rm = TRUE)
          ifelse(is.finite(m), m, NA_real_)
        }
      ),
      seasonal_std = pmap_dbl(
        list(weekly_value_series, year_series, week_series),
        function(wvs, yrs, wks) {
          if (length(wvs) <= 2) return(NA_real_)
          cy <- tail(yrs, 1); cw <- tail(wks, 1)
          byr <- (cy - 1L):(cy - 3L)
          bwk <- (cw - 3L):cw
          idx <- yrs %in% byr & wks %in% bwk & is.finite(wvs)
          sdv <- sd(wvs[idx], na.rm = TRUE)
          ifelse(is.finite(sdv) && sdv > 0, sdv, NA_real_)
        }
      )
    )
}

computeSeasonalZscore <- function(cv, sm, ss) {
  if (!is.finite(cv) || !is.finite(sm) || !is.finite(ss) || ss <= 0) return(NA_real_)
  z <- (cv - sm) / ss
  ifelse(is.finite(z), z, NA_real_)
}

# ---- news_base ----
news_base <- ranking %>%
  left_join(weekly_series, by = c("pref", "category")) %>%
  mutate(
    recent4_avg   = map_dbl(ma4_series, ~ if (length(.x) >= 4) mean(tail(.x, 4), na.rm = TRUE) else NA_real_),
    previous4_avg = map_dbl(ma4_series, ~ if (length(.x) >= 8) mean(tail(head(.x, length(.x) - 4), 4), na.rm = TRUE) else NA_real_),
    current_value  = map_dbl(weekly_value_series, ~ if (length(.x) >= 1) last(.x) else NA_real_),
    previous_value = map_dbl(weekly_value_series, ~ if (length(.x) >= 2) nth(.x, length(.x) - 1) else NA_real_),
    growth1Rate    = if_else(
      is.finite(previous_value) & previous_value >= MIN_CURRENT_MA4 & is.finite(current_value) & current_value >= MIN_CURRENT_MA4,
      (current_value - previous_value) / previous_value, NA_real_
    ),
    current_ma4    = safe_num(current_ma4, 4),
    current_value  = safe_num(current_value, 4),
    previous_value = safe_num(previous_value, 4),
    ratio_alert    = safe_num(ratio_alert, 4),
    ratio_heinen   = safe_num(ratio_heinen, 4),
    growth1Rate    = safe_num(growth1Rate, 4)
  ) %>%
  computeSeasonalBaseline() %>%
  mutate(
    anomaly_z     = mapply(computeSeasonalZscore, current_value, seasonal_mean, seasonal_std),
    anomaly_ratio = if_else(is.finite(seasonal_mean) & seasonal_mean >= MIN_CURRENT_MA4,
                            current_value / seasonal_mean, NA_real_),
    anomaly_diff  = if_else(is.finite(seasonal_mean), current_value - seasonal_mean, NA_real_)
  ) %>%
  filter(!is.na(category), !is.na(pref))

# ---- in_alert_now（ヒステリシス警報判定） ----
in_alert_now <- by_week %>%
  filter(year_week <= target_week) %>%
  left_join(alert %>% select(category, alert_start, alert_end), by = "category") %>%
  filter(!is.na(alert_start) & alert_start > 0) %>%
  arrange(pref, category, year_week) %>%
  group_by(pref, category) %>%
  mutate(in_alert = {
    a_start <- first(alert_start)
    a_end   <- first(alert_end)
    if (is.na(a_end) || !is.finite(a_end) || a_end <= 0) a_end <- a_start
    flag  <- FALSE
    state <- logical(length(weekly_value))
    for (i in seq_along(weekly_value)) {
      v <- weekly_value[i]
      if (is.finite(v)) {
        if (!flag && v >= a_start) flag <- TRUE
        else if (flag && v < a_end) flag <- FALSE
      }
      state[i] <- flag
    }
    state
  }) %>%
  filter(year_week == target_week) %>%
  ungroup() %>%
  select(pref, category, in_alert_level = in_alert)

# ---- bullet 生成関数（daily_task.Rmd と同一） ----
# 都道府県名の末尾文字（都/道/府/県）のうち、実際に含まれるものだけを正規順で連結する
prefTypeSuffix <- function(prefs) {
  if (length(prefs) == 0) return("")
  last_chars <- substr(prefs, nchar(prefs), nchar(prefs))
  ordered <- c("都", "道", "府", "県")
  present <- ordered[ordered %in% unique(last_chars)]
  if (length(present) == 0) return("")
  paste(present, collapse = "")
}

buildAlertBullets <- function(rows, in_alert_now) {
  alert_prefs <- in_alert_now %>%
    filter(in_alert_level == TRUE, pref != "全国") %>%
    left_join(rows %>% select(category, pref, current_ma4), by = c("category", "pref")) %>%
    filter(is.finite(current_ma4), current_ma4 >= MIN_CURRENT_MA4) %>%
    arrange(category, desc(current_ma4))
  if (nrow(alert_prefs) == 0) return(list())
  alert_diseases <- unique(as.character(alert_prefs$category))
  lapply(alert_diseases, function(cat) {
    prefs_in_alert <- alert_prefs %>% filter(category == cat)
    n_total   <- nrow(prefs_in_alert)
    all_prefs <- as.character(prefs_in_alert$pref)
    top3      <- head(all_prefs, 3)
    if (n_total <= 3) {
      sprintf("%s：%sで患者数が警報レベル", cat, paste(top3, collapse = "、"))
    } else {
      suffix <- prefTypeSuffix(all_prefs)
      sprintf("%s：%sなど%d%sで患者数が警報レベル", cat, paste(top3, collapse = "、"), n_total, suffix)
    }
  })
}

buildAnomalyBullets <- function(rows, alert_diseases) {
  nationwide_anomalies <- rows %>%
    filter(pref == "全国", is.finite(anomaly_z), anomaly_z >= 3,
           is.finite(current_ma4), current_ma4 >= MIN_CURRENT_MA4,
           is.finite(anomaly_ratio), anomaly_ratio > 1,
           !category %in% alert_diseases) %>%
    arrange(desc(anomaly_z))
  if (nrow(nationwide_anomalies) == 0) return(list())
  lapply(seq_len(nrow(nationwide_anomalies)), function(i) {
    row <- nationwide_anomalies[i, ]
    cat <- as.character(row$category[[1]])
    pct <- round((as.numeric(row$anomaly_ratio[[1]]) - 1) * 100)
    top_prefs <- rows %>%
      filter(category == cat, pref != "全国",
             is.finite(current_ma4), current_ma4 >= MIN_CURRENT_MA4) %>%
      arrange(desc(current_ma4)) %>%
      slice_head(n = 3) %>%
      pull(pref) %>%
      as.character()
    if (length(top_prefs) >= 1)
      sprintf("%s：全国の患者数が平年比+%d%%で、とくに%sで多い", cat, pct, paste(top_prefs, collapse = "、"))
    else
      sprintf("%s：全国の患者数が平年比+%d%%", cat, pct)
  })
}

buildGeneratedText <- function(rows, in_alert_now) {
  alert_diseases  <- unique(as.character(
    in_alert_now %>% filter(in_alert_level == TRUE, pref != "全国") %>% pull(category)
  ))
  alert_bullets   <- buildAlertBullets(rows, in_alert_now)
  anomaly_bullets <- buildAnomalyBullets(rows, alert_diseases)
  list(bullets = c(alert_bullets, anomaly_bullets))
}

# ---- 実行 ----
result <- buildGeneratedText(rows = news_base, in_alert_now = in_alert_now)

cat("\n=== bullets（週:", target_week, "）===\n")
if (length(result$bullets) == 0) {
  cat("（該当なし）\n")
} else {
  for (b in result$bullets) cat("-", b, "\n")
}
