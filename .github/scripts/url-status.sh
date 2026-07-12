#!/usr/bin/env bash
# URL 健康狀態分類 —— 單一事實來源。
#
# 為什麼要抽出來：quarterly workflow 原本寫成
#
#     case "$status" in
#       2??|3??)      OK
#       403|405|429)  BLOCKED
#       *)            DEAD      # ← catch-all
#     esac
#
# 而 issue body 與 step summary 卻宣稱「只有 404 / 410 / DNS 失敗才算真的失效」。
# 兩者不一致：400、401、408、451、500、502、503、504、TLS 錯誤、逾時、連線重設
# 全都會被寫成「DEAD（真的失效）」。網站短暫回 503，重試後仍失敗，就會被報成
# 「連結已死」—— 這正是這個 workflow 剛修掉的「喊狼來了」，只是換了個形式。
#
# 另外，原本 `|| status='000'` 把 DNS 失敗、TLS 錯誤、逾時、連線拒絕全壓成同一個
# 「000」，事後根本分不出來是哪一種。curl 的 exit code 本來就分得很清楚：
#   6=DNS 無法解析  7=TCP 連不上  28=逾時  35=TLS 失敗  60=憑證無法驗證
# 保留它，才能分辨「網域不存在（真的死了）」與「網路抖一下」。
#
# 用法：
#   classify_url_status <http_code> <curl_exit_code> [dns_verdict]
#   -> 印出 OK | DEAD | DEAD_DNS | BLOCKED | RETRYABLE | UNREACHABLE_* | OTHER
#
# 只有 DEAD 與 DEAD_DNS 會開 issue（見 is_failure）；其餘一律只警告。

#   classify_url_status <http_code> <curl_exit> [dns_verdict]
#
# dns_verdict 只在 curl_exit=6 時有意義，可為：
#   NXDOMAIN  —— 獨立 resolver 確認該網域不存在  -> DEAD_DNS（真的死了，開 issue）
#   SERVFAIL / TIMEOUT / OK / UNKNOWN / (空)     -> UNREACHABLE_DNS（只警告）
#
# 為什麼要分：curl 的 exit 6 官方定義只是「Couldn't resolve host」，**不保證是 NXDOMAIN**。
# 暫時性 resolver 故障、SERVFAIL、GitHub runner 自己的 DNS 問題，都會長成同一個 exit 6。
# 單憑一次 exit 6 就宣告「網域已停用」並開 issue，是過度推論 —— 又是一種喊狼來了。
classify_url_status() {
  local http="${1:-000}"
  local exit_code="${2:-0}"
  local dns_verdict="${3:-}"

  # curl 本身失敗（連 HTTP 回應都沒拿到）—— 保留 exit code 以區分成因
  if [ "$exit_code" -ne 0 ] 2>/dev/null; then
    case "$exit_code" in
      6)
        # 只有在「第二個獨立 resolver 也說 NXDOMAIN」時，才敢說它真的死了
        if [ "$dns_verdict" = 'NXDOMAIN' ]; then
          echo 'DEAD_DNS'
        else
          echo 'UNREACHABLE_DNS'
        fi
        ;;
      7)  echo 'UNREACHABLE_CONNECT' ;; # TCP 連不上
      28) echo 'UNREACHABLE_TIMEOUT' ;; # 逾時
      35|60|58|59|77|83)
          echo 'UNREACHABLE_TLS'     ;; # TLS/憑證問題
      *)  echo 'UNREACHABLE_OTHER'   ;;
    esac
    return 0
  fi

  case "$http" in
    2??|3??)                echo 'OK'        ;; # 含 202 Accepted —— EUR-Lex 正常會回這個
    404|410)                echo 'DEAD'      ;; # 資源真的不存在／已移除
    401|403|405|429|451)    echo 'BLOCKED'   ;; # 站台活著，只是擋自動化流量／需授權／法律封鎖
    408|425|500|502|503|504) echo 'RETRYABLE' ;; # 伺服器端暫時性問題，不是連結壞掉
    *)                      echo 'OTHER'     ;; # 其餘一律明示為 OTHER，絕不靜默歸成 DEAD
  esac
}

# 向單一 resolver 查詢，取出 header 裡的 status。查不動就回空字串。
dig_status() {
  local resolver="$1" host="$2" out
  out=$(dig +time=3 +tries=2 "@$resolver" "$host" A 2>/dev/null) || { echo ''; return 0; }
  printf '%s' "$out" | sed -n 's/.*status: \([A-Z]*\).*/\1/p' | head -1
}

# 用「獨立於系統 resolver」的公共 DNS 再問一次，區分 NXDOMAIN 與暫時性故障。
# 只有 Cloudflare (1.1.1.1) 與 Google (8.8.8.8) **兩邊都** 回 NXDOMAIN 才算數。
# 拿不到 dig 就回 UNKNOWN —— UNKNOWN 不會升級成 DEAD_DNS（寧可漏報，不要誤報）。
resolve_dns_status() {
  local host="${1:-}"
  [ -n "$host" ] || { echo 'UNKNOWN'; return 0; }
  command -v dig > /dev/null 2>&1 || { echo 'UNKNOWN'; return 0; }

  local r1 r2
  r1=$(dig_status 1.1.1.1 "$host")
  r2=$(dig_status 8.8.8.8 "$host")

  if [ "$r1" = 'NXDOMAIN' ] && [ "$r2" = 'NXDOMAIN' ]; then
    echo 'NXDOMAIN'
    return 0
  fi

  # 以下全部**保證不是 NXDOMAIN** —— 這是這個函式唯一真正的職責。
  #
  # 上一版最後一行是 `else echo "$r1"`，而 r1 在「只有 1.1.1.1 說 NXDOMAIN」時
  # 就是 NXDOMAIN —— 於是上面那個 `&&`（兩邊都要同意）被這行整個繞過，
  # 單一個 resolver 抖動或被劫持就足以誤判「網域已停用」並開 issue。
  # 一個永遠不會擋下任何東西的把關，等於沒有把關。
  if [ "$r1" = 'NXDOMAIN' ] || [ "$r2" = 'NXDOMAIN' ]; then
    echo 'DISAGREE'   # 一邊說沒了、一邊說還在 -> 不升級
  elif [ -z "$r1" ] || [ -z "$r2" ]; then
    echo 'UNKNOWN'    # 至少一邊查不動 -> 不升級
  else
    echo "$r1"        # SERVFAIL / NOERROR / REFUSED ...（此處必非 NXDOMAIN）
  fi
}

# 從 URL 取出主機名（給 resolve_dns_status 用）
url_host() {
  printf '%s' "$1" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##; s#:[0-9]+$##; s#^.*@##'
}

# classify_url_status 可能吐出的所有分類。
# 聚合要靠它列舉「哪些分類算失效」（見 is_failure），所以它必須是完整的 ——
# url-status.test.sh 會反過來驗證：classify 吐得出來的每一種分類都必須在這裡面。
ALL_STATUS_CATEGORIES='OK DEAD DEAD_DNS BLOCKED RETRYABLE OTHER
UNREACHABLE_DNS UNREACHABLE_CONNECT UNREACHABLE_TIMEOUT UNREACHABLE_TLS UNREACHABLE_OTHER'

# 這個分類是否應該開 issue（＝我們認為連結真的失效）
#
# UNREACHABLE_DNS **不在此列** —— 它只代表「這次解析不到」，可能是 resolver 抖動。
# 只有 DEAD（404/410）與 DEAD_DNS（兩個獨立 resolver 都確認 NXDOMAIN）才算真的死了。
#
# 這是「什麼算失效」的**唯一**定義。aggregate-results.sh 會實際呼叫它來決定
# fail_count 與 failures.tsv 的內容 —— 不准再手抄第二份清單。
#
# 為什麼要強調：先前這個函式是**死程式碼**。它有 10 項單元測試、註解宣稱自己是
# 單一事實來源，但生產路徑上沒有任何地方呼叫它 —— 真正做決定的是 aggregate-results.sh
# 裡手抄的 `fail=$(( dead + dead_dns ))` 與 awk 的 `$1=="DEAD" || $1=="DEAD_DNS"`。
# 也就是說「什麼算失效」有三份各自獨立、靠人工同步的定義。
# 哪天新增一個失效分類，開發者照註解改了這裡（那個被宣稱是 SSOT 的地方），
# 所有測試都會綠，而聚合會靜默地漏掉它 —— 正是這個 workflow 一直在對付的「安靜地少報」。
is_failure() {
  case "$1" in
    DEAD|DEAD_DNS) return 0 ;;
    *)             return 1 ;;
  esac
}

# 列出所有「算失效」的分類。聚合用它，不要自己手抄。
failure_categories() {
  local c
  for c in $ALL_STATUS_CATEGORIES; do
    if is_failure "$c"; then printf '%s\n' "$c"; fi
  done
}

# 人類可讀的圖示
status_icon() {
  case "$1" in
    OK)                 echo '✅' ;;
    DEAD)               echo '❌' ;;
    DEAD_DNS)           echo '❌' ;;
    BLOCKED)            echo '🟡' ;;
    RETRYABLE)          echo '🔄' ;;
    UNREACHABLE_*)      echo '🔌' ;;  # 含 UNREACHABLE_DNS —— 只警告，不算失效
    *)                  echo '❓' ;;
  esac
}

# ── 計數 ────────────────────────────────────────────────────────────────────
#
# 不要用 `grep -c ... || echo 0`。
#
# grep -c 找不到時會「印出 0」**而且** exit 1，所以 `|| echo 0` 是**串接**不是覆寫，
# 結果是 $'0\n0'。接著 $(( dead + dns )) 就會炸：
#
#     line 11: 0
#     0: syntax error in expression (error token is "0")
#
# 而 workflow 有 set -euo pipefail —— 也就是說，只要「任何一個分類是 0」
# （幾乎每一次健康的執行都是），這個 step 就直接爆掉。
#
# 這跟先前 `status=$(curl ... -w '%{http_code}' || echo "000")` 產生 "000000"
# 是**完全同一種錯**：命令自己已經印了值，`||` 又印一次。
#
# 用 awk：永遠 exit 0、永遠印一個數字、而且是「欄位精確比對」而不是 regex 前綴比對
# （前綴比對會讓 UNREACHABLE_DNS 被 UNREACHABLE_ 重複算到）。
count_exact() {
  awk -F'\t' -v c="$1" '$1 == c { n++ } END { print n + 0 }' "${2:-results.tsv}"
}

count_prefix() {
  awk -F'\t' -v p="$1" 'index($1, p) == 1 { n++ } END { print n + 0 }' "${2:-results.tsv}"
}
