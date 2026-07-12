#!/usr/bin/env bash
# 把 results.tsv 聚合成計數 + $GITHUB_OUTPUT。
#
# 為什麼要抽出來：`grep -c ... || echo 0` 產生 $'0\n0' 進而讓 $(( )) 炸掉的 bug，
# 就發生在「分類之後」的這段。而當時的離線測試只驗了 classify_url_status
# （http_code, curl_exit -> 分類），完全沒碰聚合、計數與 output 產生。
# 也就是說：CI 全綠，但整個 workflow 在「任何一個分類為 0」時就會死。
#
# 現在聚合也是一支可以離線餵 fixture 測的腳本。
#
# 用法：
#   aggregate_results <results.tsv> <github_output_file>
#
# results.tsv 欄位：category \t url \t ids \t http_code \t curl_exit

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./url-status.sh
. "$SCRIPT_DIR/url-status.sh"

aggregate_results() {
  local results="${1:-results.tsv}"
  local out="${2:-/dev/null}"

  [ -f "$results" ] || : > "$results"

  local ok dead dead_dns dns blocked retryable other unreach_nondns fail

  ok=$(count_exact OK "$results")
  dead=$(count_exact DEAD "$results")
  dead_dns=$(count_exact DEAD_DNS "$results")
  dns=$(count_exact UNREACHABLE_DNS "$results")
  blocked=$(count_exact BLOCKED "$results")
  retryable=$(count_exact RETRYABLE "$results")
  other=$(count_exact OTHER "$results")

  # UNREACHABLE_* 但「不含 DNS」—— UNREACHABLE_DNS 自己已經是一欄了。
  # 若這裡直接用 count_prefix UNREACHABLE_，同一筆會同時被算進 dns 與 unreachable，
  # 在報表上出現兩次，各分類加總也會超過 total。
  unreach_nondns=$(( $(count_prefix UNREACHABLE_ "$results") - dns ))

  # 「什麼算失效」**只有一個定義**：url-status.sh 的 is_failure()。
  # 這裡實際去呼叫它，不再手抄一份 `dead + dead_dns` 出來。
  #
  # 先前這裡是手抄的，而 is_failure() 變成死程式碼 —— 它有 10 項單元測試、
  # 註解宣稱自己是單一事實來源，但生產路徑上根本沒人呼叫。於是「什麼算失效」
  # 有三份各自獨立、靠人工同步的定義（is_failure、這裡的 fail=、下面的 awk）。
  # 哪天新增一個失效分類，開發者照註解去改 is_failure，所有測試都會綠，
  # 而聚合會靜默地漏掉它 —— 正是這個 workflow 一直在對付的「安靜地少報」。
  #
  # UNREACHABLE_DNS 不在失效之列：curl exit 6 只代表「無法解析主機」，不保證是
  # NXDOMAIN；暫時性 resolver 故障、SERVFAIL、runner 自己的 DNS 問題都長成同一個碼。
  local cat_list=''
  fail=0
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    fail=$(( fail + $(count_exact "$c" "$results") ))
    cat_list="${cat_list:+$cat_list,}$c"
  done <<EOF
$(failure_categories)
EOF

  # 失效清單（會開 issue 的）—— 分類同樣來自 is_failure()，不是寫死的字串。
  awk -F'\t' -v cats="$cat_list" '
    BEGIN { n = split(cats, a, ","); for (i = 1; i <= n; i++) fail[a[i]] = 1 }
    fail[$1]
  ' "$results" > failures.tsv || : > failures.tsv

  {
    echo "fail_count=$fail"
    echo "ok_count=$ok"
    echo "dead_count=$dead"
    echo "dead_dns_count=$dead_dns"
    echo "dns_count=$dns"
    echo "blocked_count=$blocked"
    echo "retryable_count=$retryable"
    echo "unreachable_count=$unreach_nondns"
    echo "other_count=$other"
    echo "total_count=$(awk 'END { print NR + 0 }' "$results")"
  } >> "$out"

  printf 'OK=%s DEAD=%s DEAD_DNS=%s DNS(warn)=%s BLOCKED=%s RETRYABLE=%s UNREACHABLE(non-dns)=%s OTHER=%s\n' \
    "$ok" "$dead" "$dead_dns" "$dns" "$blocked" "$retryable" "$unreach_nondns" "$other"
  printf '→ 視為失效（會開 issue）：%s\n' "$fail"
}

# 允許直接執行：aggregate-results.sh results.tsv "$GITHUB_OUTPUT"
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  aggregate_results "$@"
fi
