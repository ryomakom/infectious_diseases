# run_analysis.R
# Reads merged_data.csv and regenerates all docs/results/ output files.
# Extracted from daily_task.Rmd - no pandoc/Rmd rendering required.

short_path <- "C:/Users/1030202/DOWNLO~1/INFECT~2/INFECT~1"
setwd(short_path)

user_lib <- file.path(Sys.getenv("USERPROFILE"), "R", "library")
if (!dir.exists(user_lib)) dir.create(user_lib, recursive = TRUE)
.libPaths(c(user_lib, .libPaths()))

library(tidyverse)
library(lubridate)
library(jsonlite)

# ---- category display name conversion ----
category_to_display <- function(x) {
  dplyr::recode(x,
    "COVID-19" = "新型コロナウイルス",
    "ＲＳウイルス感染症" = "RSウイルス",
    "Ａ群溶血性レンサ球菌咽頭炎" = "A群溶血性レンサ球菌咽頭炎",
    .default = x
  )
}

cleaned_diseases <- read_csv("merged_data/merged_data.csv", show_col_types = FALSE) %>%
  mutate(category = category_to_display(category))

cat("Loaded merged_data.csv:", nrow(cleaned_diseases), "rows\n")
cat("Date range:", as.character(min(cleaned_diseases$date)), "to", as.character(max(cleaned_diseases$date)), "\n")

if (!dir.exists("docs/results")) dir.create("docs/results", recursive = TRUE)

# ---- Write per-region CSVs ----
cleaned_diseases %>% filter(pref == "全国")    %>% write_excel_csv("docs/results/data-全国.csv")
cleaned_diseases %>% filter(pref == "東京都")  %>% write_excel_csv("docs/results/data-東京都.csv")
cleaned_diseases %>% filter(pref == "大阪府")  %>% write_excel_csv("docs/results/data-大阪府.csv")
cleaned_diseases %>% filter(!pref %in% c("全国", "東京都", "大阪府")) %>% write_excel_csv("docs/results/data-その他.csv")
cat("Per-region CSVs written.\n")

# ---- Ranking ----
yw <- cleaned_diseases %>%
  mutate(date = as.Date(date)) %>%
  distinct(date) %>%
  mutate(
    yr = lubridate::year(date),
    wk = lubridate::isoweek(date),
    year_week = sprintf("%04d-%02d", yr, wk)
  ) %>%
  select(date, year_week, yr, wk)

d <- cleaned_diseases %>%
  mutate(date = as.Date(date)) %>%
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
    ma4 = last(ma4),
    weekly_value = last(value),
    yr = last(yr),
    wk = last(wk),
    .groups = "drop"
  )

latest_yr_wk <- by_week %>% pull(year_week) %>% max()
latest_yr <- as.integer(substr(latest_yr_wk, 1, 4))
latest_wk <- substr(latest_yr_wk, 6, 7)
past_3_weeks <- sprintf("%04d-%s", (latest_yr - 1):(latest_yr - 3), latest_wk)

cat("Latest week:", latest_yr_wk, "\n")

current_ma4 <- d %>%
  filter(year_week == latest_yr_wk) %>%
  group_by(pref, category) %>%
  slice_max(date, n = 1, with_ties = FALSE) %>%
  ungroup() %>%
  select(pref, category, current_ma4 = value)

reference_date <- d %>% filter(year_week == latest_yr_wk) %>% pull(date) %>% max(na.rm = TRUE)

baseline_ma4 <- by_week %>%
  filter(year_week %in% past_3_weeks) %>%
  group_by(pref, category) %>%
  summarise(baseline_ma4 = mean(ma4), .groups = "drop")

alert <- read_csv("data/alert_thresholds.csv", col_types = "cdddc")

ranking <- current_ma4 %>%
  inner_join(baseline_ma4, by = c("pref", "category")) %>%
  filter(baseline_ma4 > 0) %>%
  mutate(
    ratio_heinen = round(current_ma4 / baseline_ma4, 2),
    year_week = latest_yr_wk,
    reference_date = as.character(reference_date)
  ) %>%
  left_join(alert %>% select(category, alert_start), by = "category") %>%
  mutate(
    ratio_alert = if_else(
      !is.na(alert_start) & alert_start > 0,
      round(current_ma4 / alert_start, 2),
      NA_real_
    )
  ) %>%
  select(category, pref, year_week, reference_date, current_ma4, baseline_ma4, ratio_heinen, alert_start, ratio_alert)

# ranking.csv は news_base 計算後に ratio_wow を付与してから書き出す（下記）

# ---- Top highlights JSON ----
ranking_valid <- ranking %>% filter(!is.na(ratio_alert))

if (nrow(ranking_valid) > 0) {
  nationwide_anchor <- ranking_valid %>% filter(pref == "全国")
  if (nrow(nationwide_anchor) == 0) nationwide_anchor <- ranking_valid

  target_row <- nationwide_anchor %>%
    arrange(desc(ratio_alert), desc(ratio_heinen), desc(current_ma4)) %>%
    slice(1)
  target_category <- target_row$category[[1]]

  top_pref_rows <- ranking_valid %>%
    filter(category == target_category, pref != "全国") %>%
    arrange(desc(ratio_alert), desc(ratio_heinen), desc(current_ma4)) %>%
    slice_head(n = 3)

  nationwide_row <- ranking %>%
    filter(category == target_category, pref == "全国") %>%
    slice_head(n = 1)
  if (nrow(nationwide_row) == 0) nationwide_row <- target_row %>% mutate(pref = "全国")

  spark_targets <- c("全国", top_pref_rows$pref)
  spark_map <- cleaned_diseases %>%
    mutate(date = as.Date(date), value = as.numeric(value)) %>%
    filter(category == target_category, pref %in% spark_targets, !is.na(value)) %>%
    arrange(date) %>%
    group_by(pref) %>%
    slice_tail(n = 52) %>%
    summarise(series52 = list(as.numeric(value)), .groups = "drop")

  get_series52 <- function(pref_name) {
    row <- spark_map %>% filter(pref == pref_name)
    if (nrow(row) == 0) return(list())
    unname(as.list(row$series52[[1]]))
  }

  nationwide_obj <- list(
    category = target_category,
    pref = "全国",
    rankLabel = "全国",
    current_ma4 = as.numeric(nationwide_row$current_ma4[[1]]),
    ratio_alert = as.numeric(nationwide_row$ratio_alert[[1]]),
    series52 = get_series52("全国")
  )

  top_pref_objs <- lapply(seq_len(nrow(top_pref_rows)), function(i) {
    row <- top_pref_rows[i, ]
    list(
      category = target_category,
      pref = as.character(row$pref[[1]]),
      rankLabel = paste0(i, "."),
      current_ma4 = as.numeric(row$current_ma4[[1]]),
      ratio_alert = as.numeric(row$ratio_alert[[1]]),
      series52 = get_series52(as.character(row$pref[[1]]))
    )
  })

  top_payload <- list(
    targetCategory = target_category,
    generatedAt = as.character(Sys.time()),
    nationwideRow = nationwide_obj,
    topPrefRows = top_pref_objs
  )

  writeLines(toJSON(top_payload, auto_unbox = TRUE, pretty = TRUE, na = "null"), "docs/results/top_highlights.json")
  cat("top_highlights.json written.\n")
}

# ---- News digest ----
safe_num <- function(x, digits = 4) ifelse(is.finite(x), round(as.numeric(x), digits), NA_real_)
fmt_num  <- function(x, digits = 2) ifelse(is.finite(x), format(round(x, digits), nsmall = digits), "—")

MIN_CURRENT_MA4      <- 0.1
MIN_AVG_FOR_GROWTH   <- 0.1
PERSISTENCE_WINDOW   <- 4L
W_ANOMALY <- 0.6; W_ALERT <- 0.8; W_LEVEL <- 0.4; W_PERSISTENCE <- 0.5; W_GROWTH <- 0.3
BONUS_ANOMALY <- 1.0; BONUS_ALERT <- 2.0; BONUS_PERSIST <- 3.0; BONUS_RISING <- 0.5

major_categories <- c(
  "インフルエンザ", "RSウイルス", "感染性胃腸炎", "手足口病",
  "A群溶血性レンサ球菌咽頭炎", "咽頭結膜熱", "新型コロナウイルス"
)

PREF_TO_BLOCK <- c(
  "北海道"="北海道",
  "青森県"="東北","岩手県"="東北","宮城県"="東北","秋田県"="東北","山形県"="東北","福島県"="東北",
  "茨城県"="関東","栃木県"="関東","群馬県"="関東","埼玉県"="関東","千葉県"="関東","東京都"="関東","神奈川県"="関東",
  "新潟県"="中部","富山県"="中部","石川県"="中部","福井県"="中部","山梨県"="中部","長野県"="中部","岐阜県"="中部","静岡県"="中部","愛知県"="中部",
  "三重県"="近畿","滋賀県"="近畿","京都府"="近畿","大阪府"="近畿","兵庫県"="近畿","奈良県"="近畿","和歌山県"="近畿",
  "鳥取県"="中国","島根県"="中国","岡山県"="中国","広島県"="中国","山口県"="中国",
  "徳島県"="四国","香川県"="四国","愛媛県"="四国","高知県"="四国",
  "福岡県"="九州","佐賀県"="九州","長崎県"="九州","熊本県"="九州","大分県"="九州","宮崎県"="九州","鹿児島県"="九州","沖縄県"="九州"
)

is_major_category <- function(cat) !is.na(cat) & cat %in% major_categories
prefToBlock <- function(pref) { out <- unname(PREF_TO_BLOCK[pref]); ifelse(is.na(out), NA_character_, out) }
classifySpreadType <- function(blocks) { n <- length(unique(blocks[!is.na(blocks)])); if (n<=1) "局所" else if (n<=3) "地域拡散" else "全国拡散" }

computeSeasonalBaseline <- function(rows) {
  rows %>%
    mutate(
      seasonal_mean = pmap_dbl(
        list(weekly_value_series, year_series, week_series),
        function(wvs, yrs, wks) {
          if (length(wvs)<=1 || length(yrs)!=length(wvs) || length(wks)!=length(wvs)) return(NA_real_)
          cur_yr <- tail(yrs,1); cur_wk <- tail(wks,1)
          max_wk <- ifelse(any(wks==53,na.rm=TRUE),53,52)
          wd <- pmin(abs(wks-cur_wk), max_wk-abs(wks-cur_wk))
          idx <- yrs<cur_yr & wd<=2 & is.finite(wvs)
          hv <- wvs[idx]; if(length(hv)==0) return(NA_real_)
          m <- mean(hv,na.rm=TRUE); ifelse(is.finite(m),m,NA_real_)
        }
      ),
      seasonal_std = pmap_dbl(
        list(weekly_value_series, year_series, week_series),
        function(wvs, yrs, wks) {
          if (length(wvs)<=2 || length(yrs)!=length(wvs) || length(wks)!=length(wvs)) return(NA_real_)
          cur_yr <- tail(yrs,1); cur_wk <- tail(wks,1)
          max_wk <- ifelse(any(wks==53,na.rm=TRUE),53,52)
          wd <- pmin(abs(wks-cur_wk), max_wk-abs(wks-cur_wk))
          idx <- yrs<cur_yr & wd<=2 & is.finite(wvs)
          hv <- wvs[idx]; if(length(hv)<=1) return(NA_real_)
          sdv <- sd(hv,na.rm=TRUE); ifelse(is.finite(sdv)&&sdv>0,sdv,NA_real_)
        }
      )
    )
}

computeSeasonalZscore <- function(row) {
  cv<-row$current_value; sm<-row$seasonal_mean; ss<-row$seasonal_std
  if(!is.finite(cv)||!is.finite(sm)||!is.finite(ss)||ss<=0) return(NA_real_)
  z<-(cv-sm)/ss; ifelse(is.finite(z),z,NA_real_)
}

computeImportanceScore <- function(row) {
  sz<-ifelse(is.finite(row$seasonal_zscore),as.numeric(row$seasonal_zscore),0)
  ra<-ifelse(is.finite(row$ratio_alert),as.numeric(row$ratio_alert),0)
  cm<-ifelse(is.finite(row$current_ma4),as.numeric(row$current_ma4),0)
  pr<-ifelse(is.finite(row$persistenceRate),as.numeric(row$persistenceRate),0)
  gr<-ifelse(is.finite(row$growth1Rate),as.numeric(row$growth1Rate),0)
  wo<-ifelse(is.finite(row$weeksOverAlert),as.numeric(row$weeksOverAlert),0)
  score <- max(sz,0)*W_ANOMALY + max(ra,0)*W_ALERT + log(1+max(cm,0))*W_LEVEL + max(pr,0)*W_PERSISTENCE + max(gr,0)*0.15
  if(sz>=2.5) score<-score+BONUS_ANOMALY
  if(ra>=1) score<-score+1.5
  if(wo>=2) score<-score+BONUS_PERSIST
  if(gr>=0.2) score<-score+BONUS_RISING
  ifelse(is.finite(score),as.numeric(score),0)
}

attachImportanceScore <- function(df) {
  if(nrow(df)==0){df$importance_score<-numeric(0);return(df)}
  getcol <- function(nm,default=NA_real_) if(nm %in% names(df)) df[[nm]] else rep(default,nrow(df))
  df %>% mutate(
    importance_score = mapply(
      function(sz,ra,cm,pr,gr,wo) computeImportanceScore(list(seasonal_zscore=sz,ratio_alert=ra,current_ma4=cm,persistenceRate=pr,growth1Rate=gr,weeksOverAlert=wo)),
      getcol("seasonal_zscore"),getcol("ratio_alert"),getcol("current_ma4"),getcol("persistenceRate"),getcol("growth1Rate"),getcol("weeksOverAlert")
    )
  )
}

pick_top_major_first <- function(df,sort_exprs,n=3) {
  if(nrow(df)==0) return(df)
  mdf<-df%>%filter(is_major); ndf<-df%>%filter(!is_major)
  omdf<-mdf%>%arrange(!!!sort_exprs)
  if(nrow(omdf)>=n) return(slice_head(omdf,n=n))
  bind_rows(omdf, ndf%>%arrange(!!!sort_exprs)%>%slice_head(n=n-nrow(omdf)))
}

detectAnomalies <- function(rows) {
  rows %>%
    mutate(
      anomaly_z=mapply(function(cv,sm,ss) computeSeasonalZscore(list(current_value=cv,seasonal_mean=sm,seasonal_std=ss)), current_value,seasonal_mean,seasonal_std),
      anomaly_ratio=if_else(is.finite(seasonal_mean)&seasonal_mean>=MIN_CURRENT_MA4, current_value/seasonal_mean, NA_real_),
      anomaly_diff=if_else(is.finite(seasonal_mean), current_value-seasonal_mean, NA_real_)
    ) %>%
    filter(pref=="全国", is.finite(current_value), current_value>=MIN_CURRENT_MA4,
           is.finite(seasonal_mean), seasonal_mean>=MIN_CURRENT_MA4, is.finite(anomaly_z)) %>%
    arrange(desc(anomaly_z),desc(anomaly_ratio),desc(anomaly_diff),desc(current_value)) %>%
    slice_head(n=3) %>%
    mutate(seasonal_zscore=anomaly_z, seasonal_ratio=anomaly_ratio)
}

selectLead <- function(rows) {
  nw <- rows%>%filter(pref=="全国")
  cg <- nw%>%filter(is.finite(current_value),current_value>=MIN_CURRENT_MA4,
                    is.finite(previous_value),previous_value>=MIN_CURRENT_MA4,is.finite(growth1Rate))%>%
    mutate(growth_diff=current_value-previous_value)%>%arrange(desc(growth1Rate),desc(current_value),desc(growth_diff))
  if(nrow(cg)>0) return(list(row=cg%>%slice(1),reason="D: 全国で前週比増加率最大"))
  ca<-nw%>%filter(is.finite(anomaly_z))%>%arrange(desc(anomaly_z),desc(anomaly_ratio),desc(anomaly_diff),desc(current_value))
  if(nrow(ca)>0) return(list(row=ca%>%slice(1),reason="A: 全国で季節逸脱度最大"))
  list(row=nw%>%arrange(desc(current_value))%>%slice_head(n=1),reason="E: 代替（全国の現在値最大）")
}

integrateAnomalyIntoLead <- function(digest) {
  anomalies_df<-digest$anomalies_df; rows<-digest$rows
  if(nrow(anomalies_df)==0) return(digest)
  top_anom<-anomalies_df%>%slice(1); target_cat<-as.character(top_anom$category[[1]])
  nw_row<-rows%>%filter(pref=="全国",category==target_cat)%>%arrange(desc(ratio_alert),desc(current_ma4))%>%slice_head(n=1)
  digest$lead$category<-target_cat
  digest$lead$reason<-sprintf("A: 季節パターン逸脱（%s %s, z=%s）",target_cat,as.character(top_anom$pref[[1]]),fmt_num(top_anom$seasonal_zscore[[1]],2))
  if(nrow(nw_row)>0){
    digest$lead$nationwide_ratio_alert<-ifelse(is.finite(nw_row$ratio_alert[[1]]),as.numeric(nw_row$ratio_alert[[1]]),NA_real_)
    digest$lead$nationwide_current_ma4<-ifelse(is.finite(nw_row$current_ma4[[1]]),as.numeric(nw_row$current_ma4[[1]]),NA_real_)
    digest$lead_row<-nw_row
  } else {
    digest$lead$nationwide_ratio_alert<-NA_real_; digest$lead$nationwide_current_ma4<-NA_real_
    digest$lead_row<-rows%>%filter(category==target_cat)%>%arrange(desc(current_ma4))%>%slice_head(n=1)
  }
  digest$lead_category<-target_cat; digest
}

selectTopPrefectures <- function(rows,lead_row,anomalies_df=NULL,prefer_anomaly_prefs=FALSE) {
  if(nrow(lead_row)==0) return(rows%>%slice(0))
  lead_cat<-as.character(lead_row$category[[1]])
  base<-rows%>%filter(category==lead_cat,pref!="全国",is.finite(ratio_alert),current_ma4>=MIN_CURRENT_MA4)%>%
    mutate(priority_high=ratio_alert>0.5)%>%arrange(desc(priority_high),desc(ratio_alert),desc(current_ma4))%>%slice_head(n=3)
  if(!prefer_anomaly_prefs||is.null(anomalies_df)||nrow(anomalies_df)==0) return(base)
  anomaly_prefs<-anomalies_df%>%filter(category==lead_cat)%>%arrange(desc(seasonal_zscore))%>%pull(pref)%>%unique()
  if(length(anomaly_prefs)==0) return(base)
  rows%>%filter(category==lead_cat,pref!="全国",is.finite(ratio_alert),current_ma4>=MIN_CURRENT_MA4)%>%
    mutate(priority_high=ratio_alert>0.5,anomaly_rank=match(pref,anomaly_prefs),is_anomaly_pref=!is.na(anomaly_rank))%>%
    arrange(desc(is_anomaly_pref),anomaly_rank,desc(priority_high),desc(ratio_alert),desc(current_ma4))%>%slice_head(n=3)
}

selectRising <- function(rows) {
  rows%>%filter(pref=="全国",is.finite(growth1Rate),growth1Rate>=0.2,
                is.finite(current_value),current_value>=1.0,
                is.finite(previous_value),previous_value>=0.5)%>%
    mutate(growth_diff=current_value-previous_value)%>%
    arrange(desc(growth1Rate),desc(current_value),desc(growth_diff))%>%
    slice_head(n=3)
}

selectPersistentAlerts <- function(rows) {
  base<-rows%>%filter(is.finite(ratio_alert),ratio_alert>1,is.finite(weeksOverAlert),weeksOverAlert>=2,
                      is.finite(persistenceRate),current_ma4>=MIN_CURRENT_MA4)
  pick_top_major_first(base,rlang::quos(desc(persistenceRate),desc(ratio_alert),desc(weeksOverAlert),desc(current_ma4)),n=3)
}

buildNewsCandidates <- function(digest) {
  parts<-list()
  if(nrow(digest$anomalies_df)>0) parts<-append(parts,list(digest$anomalies_df%>%mutate(flag="anomaly")))
  if(nrow(digest$rising_df)>0) parts<-append(parts,list(digest$rising_df%>%mutate(flag="rising")))
  if(nrow(digest$persistent_df)>0) parts<-append(parts,list(digest$persistent_df%>%mutate(flag="persistent_alert")))
  if(length(parts)==0) return(tibble())
  bind_rows(parts)%>%group_by(category,pref)%>%
    summarise(importance_score=max(importance_score,na.rm=TRUE),flags=list(sort(unique(flag))),.groups="drop")%>%
    arrange(desc(importance_score))
}

computeBlockCounts <- function(tp,ri,pe) {
  bind_rows(tp%>%select(category,pref),ri%>%select(category,pref),pe%>%select(category,pref))%>%
    mutate(block=prefToBlock(pref))%>%filter(!is.na(block))%>%group_by(category,block)%>%summarise(n=n(),.groups="drop")
}

buildGeoContext <- function(digest) {
  tn<-digest$top_news; tp<-digest$top_pref_df; ri<-digest$rising_df; pe<-digest$persistent_df
  bc<-computeBlockCounts(tp,ri,pe)
  if(nrow(tn)==0) return(list(spread_type="局所",affected_blocks=character(0),sentence="地域分布は限定的です。"))
  tc<-as.character(tn$category[[1]])
  tb<-bc%>%filter(category==tc)%>%arrange(desc(n),block); ab<-tb$block
  st<-classifySpreadType(ab)
  tf<-unlist(tn$flags[[1]]); bt<-if(length(ab)>0) paste(ab,collapse="・") else "限定的な地域"
  sent<-if("rising"%in%tf) sprintf("%sの増加は%sを中心にみられます。",tc,bt) else
    if("persistent_alert"%in%tf) sprintf("%sの警報超えは%sを中心に続いています。",tc,bt) else
      sprintf("%sの発生は%sを中心にみられます。",tc,bt)
  list(spread_type=st,affected_blocks=ab,sentence=sent)
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
    n_total <- nrow(prefs_in_alert)
    top3 <- head(as.character(prefs_in_alert$pref), 3)
    if (n_total <= 3) {
      sprintf("%s：%sで患者数が警報レベル", cat, paste(top3, collapse = "、"))
    } else {
      sprintf("%s：%sなど%d都道府県で患者数が警報レベル", cat, paste(top3, collapse = "、"), n_total)
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
    if (length(top_prefs) >= 1) {
      sprintf("%s：全国の患者数が平年比+%d%%で、とくに%sで多い", cat, pct, paste(top_prefs, collapse = "、"))
    } else {
      sprintf("%s：全国の患者数が平年比+%d%%", cat, pct)
    }
  })
}

buildGeneratedText <- function(digest, top_pref_df, rising_df, persistent_df, rows, in_alert_now) {
  alert_diseases  <- unique(as.character(
    in_alert_now %>% filter(in_alert_level == TRUE, pref != "全国") %>% pull(category)
  ))
  alert_bullets   <- buildAlertBullets(rows, in_alert_now)
  anomaly_bullets <- buildAnomalyBullets(rows, alert_diseases)
  bullets <- c(alert_bullets, anomaly_bullets)
  list(bullets=bullets)
}

# ---- 地方ベースの集計（案A） ----
# 人口加重平均：定点あたり患者数を県単純平均すると人口の少ない県が過大に効くため、
# 人口で重みを付ける（厳密には定点数加重が筋だが、人口を proxy として用いる）。
pref_population <- read_csv("data/prefecture_population.csv", show_col_types = FALSE)
buildBlockSummary <- function(by_week, in_alert_now, in_attention_now, latest_yr_wk) {
  block_weekly <- by_week %>%
    left_join(pref_population, by = "pref") %>%
    mutate(block = prefToBlock(pref)) %>%
    filter(!is.na(block), pref != "全国", !is.na(population)) %>%
    group_by(category, block, year_week, yr, wk) %>%
    summarise(
      avg_value = sum(weekly_value * population, na.rm = TRUE) / sum(population[!is.na(weekly_value)], na.rm = TRUE),
      n_prefs = sum(!is.na(weekly_value)),
      .groups = "drop"
    )

  latest_yr <- as.integer(substr(latest_yr_wk, 1, 4))
  latest_wk <- as.integer(substr(latest_yr_wk, 6, 7))

  all_weeks <- sort(unique(block_weekly$year_week))
  latest_idx <- match(latest_yr_wk, all_weeks)
  previous_yr_wk <- if (!is.na(latest_idx) && latest_idx > 1) all_weeks[latest_idx - 1] else NA_character_

  current_block <- block_weekly %>% filter(year_week == latest_yr_wk) %>% select(category, block, avg_value, n_prefs)
  previous_block <- block_weekly %>% filter(year_week == previous_yr_wk) %>% select(category, block, previous_avg_value = avg_value)

  hist <- block_weekly %>%
    filter(yr < latest_yr) %>%
    mutate(wd = pmin(abs(wk - latest_wk), 52L - abs(wk - latest_wk))) %>%
    filter(wd <= 2) %>%
    group_by(category, block) %>%
    summarise(seasonal_mean = mean(avg_value, na.rm = TRUE), seasonal_sd = sd(avg_value, na.rm = TRUE), .groups = "drop")

  alert_block <- in_alert_now %>%
    filter(in_alert_level == TRUE, pref != "全国") %>%
    mutate(block = prefToBlock(pref)) %>%
    filter(!is.na(block)) %>%
    group_by(category, block) %>%
    summarise(n_alert = n(), alert_prefs = list(as.character(pref)), .groups = "drop")

  attention_block <- in_attention_now %>%
    filter(in_attention_level == TRUE, pref != "全国") %>%
    mutate(block = prefToBlock(pref)) %>%
    filter(!is.na(block)) %>%
    group_by(category, block) %>%
    summarise(n_attention = n(), attention_prefs = list(as.character(pref)), .groups = "drop")

  combined <- current_block %>%
    left_join(previous_block, by = c("category", "block")) %>%
    left_join(hist, by = c("category", "block")) %>%
    left_join(alert_block, by = c("category", "block")) %>%
    left_join(attention_block, by = c("category", "block")) %>%
    mutate(
      growth1Rate = if_else(is.finite(previous_avg_value) & previous_avg_value > 0 & is.finite(avg_value), (avg_value - previous_avg_value) / previous_avg_value, NA_real_),
      zscore = if_else(is.finite(seasonal_mean) & is.finite(seasonal_sd) & seasonal_sd > 0 & is.finite(avg_value), (avg_value - seasonal_mean) / seasonal_sd, NA_real_),
      ratio_heinen = if_else(is.finite(seasonal_mean) & seasonal_mean > 0 & is.finite(avg_value), avg_value / seasonal_mean, NA_real_),
      n_alert = ifelse(is.na(n_alert), 0L, as.integer(n_alert)),
      n_attention = ifelse(is.na(n_attention), 0L, as.integer(n_attention))
    )

  spotlight_by_block <- combined %>%
    mutate(score = (n_alert > 0) * 1e6 + (n_attention > 0) * 1e4 + pmax(coalesce(zscore, 0), 0) * 100) %>%
    group_by(block) %>%
    arrange(desc(score), .by_group = TRUE) %>%
    slice_head(n = 3) %>%
    ungroup()

  block_order <- c("北海道","東北","関東","中部","近畿","中国","四国","九州")
  blocks_present <- intersect(block_order, unique(spotlight_by_block$block))

  out <- list()
  for (b in blocks_present) {
    rows_b <- spotlight_by_block %>% filter(block == b)
    spots <- lapply(seq_len(nrow(rows_b)), function(i) {
      r <- rows_b[i, ]
      alert_prefs_v <- r$alert_prefs[[1]]; if (is.null(alert_prefs_v)) alert_prefs_v <- character(0)
      attention_prefs_v <- r$attention_prefs[[1]]; if (is.null(attention_prefs_v)) attention_prefs_v <- character(0)
      list(
        category=as.character(r$category[[1]]),
        avg_value=safe_num(r$avg_value[[1]],4),
        growth1Rate=safe_num(r$growth1Rate[[1]],4),
        zscore=safe_num(r$zscore[[1]],4),
        ratio_heinen=safe_num(r$ratio_heinen[[1]],4),
        n_alert=as.integer(r$n_alert[[1]]),
        alert_prefs=unname(as.list(alert_prefs_v)),
        n_attention=as.integer(r$n_attention[[1]]),
        attention_prefs=unname(as.list(attention_prefs_v)),
        n_prefs=as.integer(r$n_prefs[[1]])
      )
    })
    out[[b]] <- list(spotlights = spots)
  }
  out
}

as_item_list <- function(df,n=3) {
  if(nrow(df)==0) return(list())
  out<-df%>%slice_head(n=n)
  lapply(seq_len(nrow(out)),function(i){
    row<-out[i,]
    list(category=as.character(row$category[[1]]),pref=as.character(row$pref[[1]]),
         current_ma4=ifelse(is.finite(row$current_ma4[[1]]),as.numeric(row$current_ma4[[1]]),NA_real_),
         current_value=ifelse(is.finite(row$current_value[[1]]),as.numeric(row$current_value[[1]]),NA_real_),
         previous_value=ifelse(is.finite(row$previous_value[[1]]),as.numeric(row$previous_value[[1]]),NA_real_),
         ratio_alert=ifelse(is.finite(row$ratio_alert[[1]]),as.numeric(row$ratio_alert[[1]]),NA_real_),
         ratio_heinen=ifelse(is.finite(row$ratio_heinen[[1]]),as.numeric(row$ratio_heinen[[1]]),NA_real_),
         growth1Rate=ifelse(is.finite(row$growth1Rate[[1]]),as.numeric(row$growth1Rate[[1]]),NA_real_),
         weeksOverAlert=ifelse(is.finite(row$weeksOverAlert[[1]]),as.integer(row$weeksOverAlert[[1]]),NA_integer_),
         persistenceRate=ifelse(is.finite(row$persistenceRate[[1]]),as.numeric(row$persistenceRate[[1]]),NA_real_),
         persistenceWindow=ifelse(is.finite(row$persistenceWindow[[1]]),as.integer(row$persistenceWindow[[1]]),NA_integer_),
         importance_score=ifelse(is.finite(row$importance_score[[1]]),as.numeric(row$importance_score[[1]]),NA_real_))
  })
}

as_anomaly_list <- function(df,n=3) {
  if(nrow(df)==0) return(list())
  out<-df%>%slice_head(n=n)
  lapply(seq_len(nrow(out)),function(i){
    row<-out[i,]
    list(category=as.character(row$category[[1]]),pref=as.character(row$pref[[1]]),
         current_ma4=ifelse(is.finite(row$current_ma4[[1]]),as.numeric(row$current_ma4[[1]]),NA_real_),
         current_value=ifelse(is.finite(row$current_value[[1]]),as.numeric(row$current_value[[1]]),NA_real_),
         seasonal_mean=ifelse(is.finite(row$seasonal_mean[[1]]),as.numeric(row$seasonal_mean[[1]]),NA_real_),
         seasonal_zscore=ifelse(is.finite(row$seasonal_zscore[[1]]),as.numeric(row$seasonal_zscore[[1]]),NA_real_),
         importance_score=ifelse(is.finite(row$importance_score[[1]]),as.numeric(row$importance_score[[1]]),NA_real_))
  })
}

as_top_news <- function(df) {
  if(nrow(df)==0) return(NULL)
  row<-df[1,]
  list(category=as.character(row$category[[1]]),pref=as.character(row$pref[[1]]))
}

# ---- Build news_base ----
weekly_series <- by_week %>%
  arrange(pref,category,year_week) %>%
  group_by(pref,category) %>%
  summarise(ma4_series=list(ma4),weekly_value_series=list(weekly_value),year_series=list(yr),week_series=list(wk),.groups="drop")

news_base <- ranking %>%
  left_join(weekly_series,by=c("pref","category")) %>%
  mutate(
    is_major=is_major_category(category),
    persistenceWindow=PERSISTENCE_WINDOW,
    recent4_avg=map_dbl(ma4_series,~if(length(.x)>=4) mean(tail(.x,4),na.rm=TRUE) else NA_real_),
    previous4_avg=map_dbl(ma4_series,~if(length(.x)>=8) mean(tail(head(.x,length(.x)-4),4),na.rm=TRUE) else NA_real_),
    growth4Rate=if_else(is.finite(previous4_avg)&previous4_avg>=MIN_AVG_FOR_GROWTH&is.finite(recent4_avg),(recent4_avg-previous4_avg)/previous4_avg,NA_real_),
    growth4Rate=if_else(is.finite(growth4Rate),pmax(pmin(growth4Rate,10),-1),NA_real_),
    current_value=map_dbl(weekly_value_series,~if(length(.x)>=1) dplyr::last(.x) else NA_real_),
    previous_value=map_dbl(weekly_value_series,~if(length(.x)>=2) dplyr::nth(.x,length(.x)-1) else NA_real_),
    growth1Rate=if_else(is.finite(previous_value)&previous_value>=MIN_CURRENT_MA4&is.finite(current_value)&current_value>=MIN_CURRENT_MA4,(current_value-previous_value)/previous_value,NA_real_),
    growth1Diff=if_else(is.finite(current_value)&is.finite(previous_value),current_value-previous_value,NA_real_),
    weeksOverAlert=map2_int(ma4_series,alert_start,~{if(!is.finite(.y)||length(.x)==0) return(NA_integer_); sum(tail(.x,PERSISTENCE_WINDOW)>.y,na.rm=TRUE)}),
    persistenceRate=if_else(is.finite(weeksOverAlert),weeksOverAlert/persistenceWindow,NA_real_),
    current_ma4=safe_num(current_ma4,4),current_value=safe_num(current_value,4),previous_value=safe_num(previous_value,4),
    ratio_alert=safe_num(ratio_alert,4),ratio_heinen=safe_num(ratio_heinen,4),growth1Rate=safe_num(growth1Rate,4),
    growth1Diff=safe_num(growth1Diff,4),growth4Rate=safe_num(growth4Rate,4),persistenceRate=safe_num(persistenceRate,4),
    recent4_avg=safe_num(recent4_avg,4),previous4_avg=safe_num(previous4_avg,4)
  ) %>%
  computeSeasonalBaseline() %>%
  mutate(
    anomaly_z=mapply(function(cv,sm,ss) computeSeasonalZscore(list(current_value=cv,seasonal_mean=sm,seasonal_std=ss)),current_value,seasonal_mean,seasonal_std),
    anomaly_ratio=if_else(is.finite(seasonal_mean)&seasonal_mean>=MIN_CURRENT_MA4,current_value/seasonal_mean,NA_real_),
    anomaly_diff=if_else(is.finite(seasonal_mean),current_value-seasonal_mean,NA_real_),
    seasonal_zscore=anomaly_z
  ) %>%
  select(category,pref,year_week,reference_date,is_major,current_ma4,current_value,previous_value,ratio_alert,ratio_heinen,
         recent4_avg,previous4_avg,growth1Rate,growth1Diff,growth4Rate,weeksOverAlert,persistenceRate,persistenceWindow,
         ma4_series,weekly_value_series,year_series,week_series,seasonal_mean,seasonal_std,seasonal_zscore,anomaly_z,anomaly_ratio,anomaly_diff) %>%
  filter(!is.na(category),!is.na(pref))

# ---- ranking.csv に ratio_wow（前週比）を付与して書き出す ----
ranking_wow <- news_base %>%
  mutate(ratio_wow = if_else(
    is.finite(previous_value) & previous_value > 0 & is.finite(current_value),
    round(current_value / previous_value, 4),
    NA_real_
  )) %>%
  select(category, pref, ratio_wow)

ranking <- ranking %>%
  left_join(ranking_wow, by = c("category", "pref")) %>%
  select(category, pref, year_week, reference_date, current_ma4, baseline_ma4, ratio_heinen, alert_start, ratio_alert, ratio_wow)

write_excel_csv(ranking, "docs/results/ranking.csv")
cat("ranking.csv written.\n")

anomalies_df <- detectAnomalies(news_base)
lead_pick <- selectLead(news_base)
lead_row <- lead_pick$row
lead_category <- if(nrow(lead_row)>0) as.character(lead_row$category[[1]]) else NA_character_

lead_bundle <- integrateAnomalyIntoLead(list(
  lead=list(category=lead_category,
            nationwide_ratio_alert=if(nrow(lead_row)>0&&is.finite(lead_row$ratio_alert[[1]])) as.numeric(lead_row$ratio_alert[[1]]) else NA_real_,
            nationwide_current_ma4=if(nrow(lead_row)>0&&is.finite(lead_row$current_ma4[[1]])) as.numeric(lead_row$current_ma4[[1]]) else NA_real_,
            reason=lead_pick$reason),
  anomalies_df=anomalies_df,rows=news_base,lead_row=lead_row,lead_category=lead_category
))

lead_row <- lead_bundle$lead_row
lead_category <- lead_bundle$lead_category

top_pref_df    <- selectTopPrefectures(news_base,lead_row,anomalies_df=anomalies_df,prefer_anomaly_prefs=isTRUE(grepl("^A: 季節パターン逸脱",lead_bundle$lead$reason)))
rising_df      <- selectRising(news_base)
persistent_df  <- selectPersistentAlerts(news_base)

top_pref_df   <- attachImportanceScore(top_pref_df)
rising_df     <- attachImportanceScore(rising_df)
persistent_df <- attachImportanceScore(persistent_df)
anomalies_df  <- attachImportanceScore(anomalies_df)

news_candidates_df <- buildNewsCandidates(list(anomalies_df=anomalies_df,rising_df=rising_df,persistent_df=persistent_df))
top_news_df <- if(nrow(news_candidates_df)>0) news_candidates_df%>%slice_head(n=1) else tibble()
geo_context <- buildGeoContext(list(top_news=top_news_df,top_pref_df=top_pref_df,rising_df=rising_df,persistent_df=persistent_df))

# ---- ヒステリシス警報状態（alert_start超え→alert_end未満になるまで継続） ----
in_alert_now <- cleaned_diseases %>%
  mutate(date = as.Date(date), value = as.numeric(value)) %>%
  left_join(alert %>% select(category, alert_start, alert_end), by = "category") %>%
  filter(!is.na(alert_start), alert_start > 0) %>%
  arrange(pref, category, date) %>%
  group_by(pref, category) %>%
  mutate(in_alert = {
    a_start <- first(alert_start)
    a_end   <- first(alert_end)
    if (is.na(a_end) || !is.finite(a_end) || a_end <= 0) a_end <- a_start
    flag  <- FALSE
    state <- logical(n())
    for (i in seq_along(value)) {
      v <- value[i]
      if (is.finite(v)) {
        if (!flag && v >= a_start)  flag <- TRUE
        else if (flag && v < a_end) flag <- FALSE
      }
      state[i] <- flag
    }
    state
  }) %>%
  filter(date == max(date)) %>%
  ungroup() %>%
  select(pref, category, in_alert_level = in_alert)

# 注意報レベル状態：現在週の値が attention 閾値以上か（単純判定）
in_attention_now <- cleaned_diseases %>%
  mutate(date = as.Date(date), value = as.numeric(value)) %>%
  left_join(alert %>% select(category, attention), by = "category") %>%
  filter(!is.na(attention), attention > 0) %>%
  group_by(pref, category) %>%
  filter(date == max(date)) %>%
  ungroup() %>%
  mutate(in_attention_level = is.finite(value) & value >= attention) %>%
  select(pref, category, in_attention_level)

generated_text <- buildGeneratedText(list(lead=lead_bundle$lead,anomalies_df=anomalies_df,top_news=top_news_df,geo_context=geo_context),top_pref_df,rising_df,persistent_df,rows=news_base,in_alert_now=in_alert_now)

news_digest <- list(
  week=as.character(reference_date),
  lead=list(category=ifelse(is.na(lead_category),NA_character_,lead_category)),
  top_prefectures=as_item_list(top_pref_df,3),
  rising=as_item_list(rising_df,3),
  alerts=as_item_list(persistent_df,3),
  anomalies=as_anomaly_list(anomalies_df,3),
  top_news=as_top_news(top_news_df),
  spread_type=geo_context$spread_type,
  affected_blocks=unname(as.list(geo_context$affected_blocks)),
  by_block=buildBlockSummary(by_week, in_alert_now, in_attention_now, latest_yr_wk),
  generated_text=list(bullets=generated_text$bullets)
)

writeLines(toJSON(news_digest,auto_unbox=TRUE,pretty=TRUE,na="null"),"docs/results/news_digest.json")
cat("news_digest.json written.\n")

# ---- Update last_fetch.txt ----
writeLines(format(Sys.Date(),"%Y-%m-%d"),"docs/results/last_fetch.txt")
cat("last_fetch.txt written.\n")

cat("\nAll docs/results/ files regenerated successfully.\n")
cat("Reference date:", as.character(reference_date), "\n")
cat("Latest week:", latest_yr_wk, "\n")
