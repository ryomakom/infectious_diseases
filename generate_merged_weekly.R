# generate_merged_weekly.R
# merged_data.csv から週次集計（by_week）を年別ファイルに分割して出力する。
# bullets_tester.html が必要な年だけ遅延ロードできるよう、
# docs/results/merged_weekly_YYYY.csv として1年1ファイル形式で書き出す。
#
# 使い方:
#   Rscript generate_merged_weekly.R
# または RStudio で source()

library(tidyverse)
library(lubridate)

{
  args <- commandArgs(trailingOnly = FALSE)
  script_flag <- grep("--file=", args, value = TRUE)
  if (length(script_flag) > 0) {
    script_path <- sub("--file=", "", script_flag[1])
    setwd(dirname(normalizePath(script_path)))
  } else if (requireNamespace("rstudioapi", quietly = TRUE) &&
             rstudioapi::isAvailable()) {
    setwd(dirname(rstudioapi::getActiveDocumentContext()$path))
  }
}

message("merged_data.csv を読み込んでいます...")
cleaned_diseases <- read_csv("merged_data/merged_data.csv", show_col_types = FALSE) %>%
  mutate(date = as.Date(date), value = as.numeric(value))

message("週次集計を計算しています...")

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

out_dir <- "docs/results"
if (!dir.exists(out_dir)) dir.create(out_dir, recursive = TRUE)

years <- sort(unique(by_week$yr))
for (y in years) {
  out_path <- file.path(out_dir, sprintf("merged_weekly_%d.csv", y))
  yr_data  <- filter(by_week, yr == y)
  write_csv(yr_data, out_path)
  message(sprintf("  %d: %d 行 → %s", y, nrow(yr_data), out_path))
}
message(sprintf("完了: %d 年分を出力しました", length(years)))
