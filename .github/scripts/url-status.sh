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
#   classify_url_status <http_code> <curl_exit_code>
#   -> 印出 OK | DEAD | BLOCKED | RETRYABLE | UNREACHABLE | OTHER
#
# 只有 DEAD 與 UNREACHABLE_DNS 會開 issue；其餘只警告。

classify_url_status() {
  local http="${1:-000}"
  local exit_code="${2:-0}"

  # curl 本身失敗（連 HTTP 回應都沒拿到）—— 保留 exit code 以區分成因
  if [ "$exit_code" -ne 0 ] 2>/dev/null; then
    case "$exit_code" in
      6)  echo 'UNREACHABLE_DNS'     ;; # 網域無法解析：NXDOMAIN 通常代表真的沒了
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

# 這個分類是否應該開 issue（＝我們認為連結真的失效）
is_failure() {
  case "$1" in
    DEAD|UNREACHABLE_DNS) return 0 ;;
    *)                    return 1 ;;
  esac
}

# 人類可讀的圖示
status_icon() {
  case "$1" in
    OK)                 echo '✅' ;;
    DEAD)               echo '❌' ;;
    UNREACHABLE_DNS)    echo '❌' ;;
    BLOCKED)            echo '🟡' ;;
    RETRYABLE)          echo '🔄' ;;
    UNREACHABLE_*)      echo '🔌' ;;
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
