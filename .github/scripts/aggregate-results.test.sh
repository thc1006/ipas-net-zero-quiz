#!/usr/bin/env bash
# aggregate-results.sh 的整合測試 —— 餵 fixture，跑「完整的聚合 + $GITHUB_OUTPUT 產生」路徑。
#
# 為什麼需要這一支：
#
# `grep -c ... || echo 0` 產生 $'0\n0'、進而讓 $(( )) 炸掉的那個 bug，就發生在
# 「分類之後」的聚合階段。而當時的離線測試只驗到 classify_url_status
# （http_code, curl_exit -> 分類），**完全沒碰聚合、計數與 output 產生**。
#
# 結果是：CI 全綠，但只要任何一個分類為 0（幾乎每一次健康的執行），
# workflow 就會在寫入 $GITHUB_OUTPUT 之前直接死掉。
#
# 教訓：把「最容易出錯的那一段」排除在測試之外，等於沒測。
# 這裡把整個 step 的邏輯（含 exit code、GITHUB_OUTPUT 內容、failures.tsv）都跑一遍。

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./aggregate-results.sh
. "$SCRIPT_DIR/aggregate-results.sh"

pass=0
fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

expect_kv() {
  local file="$1" key="$2" want="$3"
  local got
  got=$(grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2-)
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  ✗ %-22s 期望 %-4s 實得 %s\n' "$key" "$want" "$(printf '%q' "${got:-<缺少>}")"
  fi
}

# 注意：run_case 是用 OUT=$(run_case ...) 呼叫的 —— 那是**子 shell**。
# 在子 shell 裡做 pass=$((pass+1)) 不會傳回父層，那個計數會被靜默吞掉。
# （第一版就是這樣寫的：「aggregate_results 是否 exit 0」這個檢查根本沒被計入，
#   就算它爆掉，fail++ 也會消失在子 shell 裡。）
# 所以 exit code 寫到檔案，由父層讀出來判定。
run_case() {
  local name="$1" fixture="$2"
  local res="$TMP/results.tsv" out="$TMP/gh_output"
  printf '%b' "$fixture" > "$res"
  : > "$out"
  ( cd "$TMP" && aggregate_results "$res" "$out" ) > "$TMP/stdout" 2>&1
  printf '%s' "$?" > "$TMP/rc"
  echo "── $name" >&2   # stdout 只能有 output 檔路徑
  printf '%s' "$out"
}

# 在**父層**判定上一個 run_case 的 exit code（子 shell 的計數傳不回來）
check_rc0() {
  local rc
  rc=$(cat "$TMP/rc" 2>/dev/null || echo 'missing')
  if [ "$rc" = '0' ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  ✗ aggregate_results 以 exit=%s 結束（不該失敗）\n' "$rc"
    sed 's/^/      /' "$TMP/stdout"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Case 1：全部 OK —— 其餘分類皆為 0。
# 這正是「健康執行」的樣子，也正是舊版 `grep -c || echo 0` 會爆掉的情況。
# ─────────────────────────────────────────────────────────────────────────────
OUT=$(run_case '全部 OK（所有其他分類皆為 0）—— 舊版就是死在這裡' \
  'OK\thttps://a\tid1\t200\t0\nOK\thttps://b\tid2\t202\t0\n')
check_rc0
expect_kv "$OUT" fail_count        0
expect_kv "$OUT" ok_count          2
expect_kv "$OUT" dead_count        0
expect_kv "$OUT" dead_dns_count    0
expect_kv "$OUT" dns_count         0
expect_kv "$OUT" blocked_count     0
expect_kv "$OUT" retryable_count   0
expect_kv "$OUT" unreachable_count 0
expect_kv "$OUT" other_count       0
expect_kv "$OUT" total_count       2

# ─────────────────────────────────────────────────────────────────────────────
# Case 2：完全空的 results.tsv（例如一題 time_sensitive 都沒有）
# ─────────────────────────────────────────────────────────────────────────────
OUT=$(run_case '空的 results.tsv' '')
check_rc0
expect_kv "$OUT" fail_count  0
expect_kv "$OUT" ok_count    0
expect_kv "$OUT" total_count 0

# ─────────────────────────────────────────────────────────────────────────────
# Case 3：混合分類。重點：
#   - UNREACHABLE_DNS **不算失效**（curl exit 6 不保證是 NXDOMAIN）
#   - DEAD_DNS 才算（獨立 resolver 確認 NXDOMAIN）
#   - unreachable_count 不得把 DNS 重複計入（否則同一筆錯誤在報表出現兩次）
# ─────────────────────────────────────────────────────────────────────────────
# fixture 刻意讓 DEAD_DNS(1) 與 UNREACHABLE_DNS(2) **數量不同**。
# 第一版兩者都是 1，於是 fail = dead + dead_dns 與 fail = dead + dns 算出來一樣，
# 「把 UNREACHABLE_DNS 誤當成失效」這個變異完全測不出來 —— fixture 沒有鑑別力，
# 測試就只是在自我安慰。
OUT=$(run_case '混合分類：DNS 不得重複計數，UNREACHABLE_DNS 不算失效' \
  'OK\thttps://a\tid1\t200\t0\n'\
'DEAD\thttps://b\tid2\t404\t0\n'\
'DEAD_DNS\thttps://c\tid3\t000\t6\n'\
'UNREACHABLE_DNS\thttps://d\tid4\t000\t6\n'\
'UNREACHABLE_DNS\thttps://d2\tid10\t000\t6\n'\
'UNREACHABLE_TLS\thttps://e\tid5\t000\t35\n'\
'UNREACHABLE_TIMEOUT\thttps://f\tid6\t000\t28\n'\
'BLOCKED\thttps://g\tid7\t403\t0\n'\
'RETRYABLE\thttps://h\tid8\t503\t0\n'\
'OTHER\thttps://i\tid9\t400\t0\n')
check_rc0
expect_kv "$OUT" ok_count        1
expect_kv "$OUT" dead_count      1
expect_kv "$OUT" dead_dns_count  1
expect_kv "$OUT" dns_count       2   # UNREACHABLE_DNS（只警告）—— 刻意 ≠ dead_dns
expect_kv "$OUT" blocked_count   1
expect_kv "$OUT" retryable_count 1
expect_kv "$OUT" other_count     1
# UNREACHABLE_* 共 4 筆（DNS×2 / TLS / TIMEOUT），扣掉 DNS 那 2 筆 -> 2
expect_kv "$OUT" unreachable_count 2
# 失效 = DEAD(1) + DEAD_DNS(1) = 2。UNREACHABLE_DNS 不算。
# 若誤寫成 dead + dns，會得到 1 + 2 = 3 -> 這條就會炸（這正是鑑別力所在）
expect_kv "$OUT" fail_count      2
expect_kv "$OUT" total_count     10

# 各分類加總必須等於 total —— 若有重複計數，這條會炸
ok=$(grep '^ok_count=' "$OUT" | cut -d= -f2)
dead=$(grep '^dead_count=' "$OUT" | cut -d= -f2)
ddns=$(grep '^dead_dns_count=' "$OUT" | cut -d= -f2)
dns=$(grep '^dns_count=' "$OUT" | cut -d= -f2)
blk=$(grep '^blocked_count=' "$OUT" | cut -d= -f2)
rty=$(grep '^retryable_count=' "$OUT" | cut -d= -f2)
unr=$(grep '^unreachable_count=' "$OUT" | cut -d= -f2)
oth=$(grep '^other_count=' "$OUT" | cut -d= -f2)
tot=$(grep '^total_count=' "$OUT" | cut -d= -f2)
sum=$((ok + dead + ddns + dns + blk + rty + unr + oth))
if [ "$sum" = "$tot" ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf '  ✗ 各分類加總 %s ≠ total %s —— 有分類被重複計數或漏算\n' "$sum" "$tot"
fi

# failures.tsv 只能含 DEAD 與 DEAD_DNS
if [ -f "$TMP/failures.tsv" ]; then
  badcat=$(awk -F'\t' '$1 != "DEAD" && $1 != "DEAD_DNS" { print $1 }' "$TMP/failures.tsv")
  n=$(awk 'END { print NR + 0 }' "$TMP/failures.tsv")
  if [ -z "$badcat" ] && [ "$n" = "2" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  ✗ failures.tsv 有 %s 筆，且含不該出現的分類：%s\n' "$n" "$badcat"
  fi
else
  fail=$((fail + 1))
  echo '  ✗ 沒有產生 failures.tsv'
fi

echo
echo "通過 $pass 項，失敗 $fail 項"
[ "$fail" -eq 0 ] || exit 1
echo '✅ aggregate-results 整合測試全部通過'
