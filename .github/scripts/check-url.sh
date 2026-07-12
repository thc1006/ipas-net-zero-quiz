#!/usr/bin/env bash
# 單一 URL 的健康檢查：curl 一次 -> （必要時）DNS 二次確認 -> 分類 -> 輸出一列 TSV。
#
# 為什麼這段也要從 workflow 抽出來：
#
# 分類器（url-status.sh）與聚合（aggregate-results.sh）都已經有離線測試了，但
# 「決定要不要去做 DNS 二次確認」的那段 glue 一直寫死在 YAML 的 `run:` 裡。
# 而 glue 正是 bug 的居所：
#   - 只要忘記把 $dns 傳進 classify_url_status，DEAD_DNS 就**永遠不會觸發**，
#     網域真的停用了也不會開 issue —— 而且所有測試照樣全綠。
#   - 只要把 `if [ "$rc" -eq 6 ]` 寫成別的條件，二次確認就形同不存在。
# 這種「安靜地少報」比誤報更難發現。寫在 YAML 裡就只能等季排程跑一次再猜，
# 這正是 `*) DEAD` catch-all 與 `grep -c || echo 0` 能活那麼久的環境。
#
# 抽出來之後，可以用假的 curl / dig（PATH 注入）離線把每條路徑都跑過一遍。
#
# 用法：
#   check_url $'<url>\t<id1,id2>'   -> stdout 一列：cat \t url \t ids \t http \t rc \t dns
#                                      stderr 一列人類可讀
#
# 可覆寫（給測試用）：
#   CURL_BIN  預設 curl
#   HTTP_UA   預設一組桌面瀏覽器 UA

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./url-status.sh
. "$SCRIPT_DIR/url-status.sh"

: "${CURL_BIN:=curl}"
: "${HTTP_UA:=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36}"

check_url() {
  local line="$1"
  local url ids http rc dns cat icon
  url="${line%%$'\t'*}"
  ids="${line#*$'\t'}"
  [ -z "$url" ] && return 0

  # 直接 GET：許多 WAF 擋 HEAD。-o /dev/null 丟棄 body。
  # --retry 2 帶指數退避，吸收暫時性的 5xx / 連線重置。
  # 關鍵：http_code 與 curl 的 exit code **分開保留**，不再壓成單一個 '000'。
  # （舊版 `status=$(curl ... -w '%{http_code}' || echo "000")` 會得到 "000000"：
  #   curl 失敗時自己已經印了 "000"，`||` 又印一次 —— 命令印過值就不能再 `|| echo`。）
  #
  # 注意這裡刻意寫成 `... && rc=0 || rc=$?` 而不是「賦值後再取 $?」。
  # 呼叫端（workflow）是 set -euo pipefail：在 -e 之下，`http=$(curl ...)` 只要 curl
  # 回非 0，**整個 shell 當場就結束**，後面的 rc=$? 根本不會執行 —— 第一個連不上的
  # URL 就會讓整個 step 死掉，而不是被記錄下來。
  # 目前因為 check_url 是在 xargs 的 `bash -c` 子行程裡跑（子行程不繼承 -e）而僥倖沒事，
  # 但那是巧合不是設計：哪天把 xargs 換成普通迴圈就會爆。放進 `||` 串列就不受 -e 影響。
  http=$("$CURL_BIN" -sL --compressed \
           -A "$HTTP_UA" \
           -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' \
           -H 'Accept-Language: en-US,en;q=0.9' \
           --connect-timeout 10 --max-time 30 \
           --retry 2 --retry-delay 2 --retry-connrefused \
           -o /dev/null -w '%{http_code}' "$url" 2>/dev/null) && rc=0 || rc=$?
  [ -n "$http" ] || http='000'

  # curl exit 6 只代表「Couldn't resolve host」，**不保證是 NXDOMAIN**。
  # 暫時性 resolver 故障、SERVFAIL、runner 自己的 DNS 問題都長成同一個碼。
  # 所以再用兩個獨立的公共 resolver（1.1.1.1 / 8.8.8.8）確認一次；
  # 只有兩邊都回 NXDOMAIN，才敢說這個網域真的沒了（-> DEAD_DNS -> 開 issue）。
  # 其餘一律 UNREACHABLE_DNS，只警告 —— 單次 exit 6 就宣告網域停用是過度推論。
  dns=''
  if [ "$rc" -eq 6 ]; then
    dns=$(resolve_dns_status "$(url_host "$url")")
  fi

  cat=$(classify_url_status "$http" "$rc" "$dns")
  icon=$(status_icon "$cat")

  # 所有分類都寫進 results.tsv（含 OK），報告才能誠實呈現全貌
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$cat" "$url" "$ids" "$http" "$rc" "$dns"
  printf '%s %-20s http=%-4s rc=%-3s dns=%-9s %s (ids: %s)\n' \
    "$icon" "$cat" "$http" "$rc" "${dns:--}" "$url" "$ids" >&2
}
