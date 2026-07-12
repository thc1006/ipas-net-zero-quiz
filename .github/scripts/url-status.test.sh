#!/usr/bin/env bash
# url-status.sh 的 status matrix 測試 —— 完全不碰網路。
#
# 原本這個分類邏輯只能靠「實際跑一次 quarterly workflow、看它報什麼」來驗證，
# 而那要等到季排程觸發、還受當下網路狀況影響。結果就是 catch-all 的 `*) DEAD`
# 活了很久沒人發現，直到它把一堆活著的網址寫進 issue。
#
# 這裡把 (http_code, curl_exit) -> 分類 的對應表整個攤開來測，離線、確定性、秒級。

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./url-status.sh
. "$SCRIPT_DIR/url-status.sh"

pass=0
fail=0

check() {
  local http="$1" exit_code="$2" expected="$3" note="${4:-}"
  local got
  got="$(classify_url_status "$http" "$exit_code")"
  if [ "$got" = "$expected" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  ✗ http=%-4s exit=%-2s  期望 %-20s 實得 %-20s %s\n' \
      "$http" "$exit_code" "$expected" "$got" "$note"
  fi
}

echo '── OK：2xx / 3xx 一律視為活著 ─────────────────────────────'
check 200 0 OK
check 201 0 OK
check 202 0 OK '← EUR-Lex 正常回這個；舊版只收 200，把它判成失效'
check 204 0 OK
check 206 0 OK
check 301 0 OK
check 302 0 OK
check 304 0 OK
check 308 0 OK

echo '── DEAD：只有這兩個才算「連結真的死了」 ────────────────────'
check 404 0 DEAD
check 410 0 DEAD

echo '── BLOCKED：站台活著，只是擋我們 ───────────────────────────'
check 401 0 BLOCKED
check 403 0 BLOCKED '← Cloudflare 擋 Actions runner；ghgprotocol/fsb-tcfd/iea 實測皆 200'
check 405 0 BLOCKED
check 429 0 BLOCKED
check 451 0 BLOCKED

echo '── RETRYABLE：伺服器端暫時性問題，不是連結壞掉 ──────────────'
check 408 0 RETRYABLE
check 425 0 RETRYABLE
check 500 0 RETRYABLE
check 502 0 RETRYABLE
check 503 0 RETRYABLE '← 舊版會把它寫成「真的失效」'
check 504 0 RETRYABLE

echo '── OTHER：其餘 HTTP 碼必須明示，絕不靜默歸成 DEAD ───────────'
check 400 0 OTHER
check 402 0 OTHER
check 406 0 OTHER
check 409 0 OTHER
check 418 0 OTHER
check 431 0 OTHER
check 501 0 OTHER
check 505 0 OTHER

echo '── UNREACHABLE：curl 失敗，保留 exit code 以區分成因 ────────'
check 000 6  UNREACHABLE_DNS     '← NXDOMAIN，例如 ghg.tgpf.org.tw'
check 000 7  UNREACHABLE_CONNECT
check 000 28 UNREACHABLE_TIMEOUT
check 000 35 UNREACHABLE_TLS
check 000 60 UNREACHABLE_TLS
check 000 99 UNREACHABLE_OTHER
check 200 6  UNREACHABLE_DNS     '← curl 失敗時 exit code 優先於 http_code'

echo '── is_failure：只有 DEAD 與 DNS 失敗才開 issue ──────────────'
for s in DEAD UNREACHABLE_DNS; do
  if is_failure "$s"; then pass=$((pass + 1)); else
    fail=$((fail + 1)); echo "  ✗ is_failure($s) 應為 true"
  fi
done
for s in OK BLOCKED RETRYABLE UNREACHABLE_TIMEOUT UNREACHABLE_TLS UNREACHABLE_CONNECT OTHER; do
  if is_failure "$s"; then
    fail=$((fail + 1)); echo "  ✗ is_failure($s) 應為 false —— 這會再次製造『喊狼來了』"
  else pass=$((pass + 1)); fi
done


# ─────────────────────────────────────────────────────────────────────────────
# 計數：這裡才是真正出事的地方。
#
# 我把 classify_url_status 做了離線測試，卻沒測它「外面」的計數邏輯 ——
# 而 bug 就在那裡：`grep -c ... || echo 0` 在分類為 0 時會產生 $'0\n0'
# （grep -c 找不到時「印 0」而且「exit 1」，於是 || 又印一次），
# 接著 $(( dead + dns )) 直接 syntax error，set -euo pipefail 讓整個 step 爆掉。
#
# 也就是說：只要「任何一個分類是 0」—— 幾乎每一次健康的執行 —— workflow 就掛。
# 這跟先前 `status=$(curl ... || echo "000")` 產生 "000000" 是完全同一種錯。
# ─────────────────────────────────────────────────────────────────────────────
TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT
FIX="$TMPDIR_T/results.tsv"

check_count() {
  local desc="$1" expected="$2" got="$3"
  if [ "$got" = "$expected" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  ✗ %-46s 期望 %-6s 實得 %s\n' "$desc" "$expected" "$(printf '%q' "$got")"
  fi
}

echo
echo '── 計數：分類為 0 時不得產生 "0\n0" 或炸掉 ─────────────────'

# 只有 OK，其餘分類全部是 0 —— 這正是「健康執行」的樣子，也正是舊版會爆掉的情況
printf 'OK\thttps://a\tid1\t200\t0\n' > "$FIX"
printf 'OK\thttps://b\tid2\t202\t0\n' >> "$FIX"

check_count 'count_exact OK'              2 "$(count_exact OK "$FIX")"
check_count 'count_exact DEAD（0 筆）'    0 "$(count_exact DEAD "$FIX")"
check_count 'count_exact BLOCKED（0 筆）' 0 "$(count_exact BLOCKED "$FIX")"
check_count 'count_prefix UNREACHABLE_（0 筆）' 0 "$(count_prefix UNREACHABLE_ "$FIX")"

# 全部為 0 的計數必須能安全地做算術展開（舊版就是死在這一步）
dead_c=$(count_exact DEAD "$FIX")
dns_c=$(count_exact UNREACHABLE_DNS "$FIX")
if total=$((dead_c + dns_c)) 2>/dev/null && [ "$total" = "0" ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo '  ✗ $(( dead + dns )) 在計數為 0 時炸掉了 —— 這正是舊版的 bug'
fi

echo '── 計數：混合分類 + 前綴不得重複計算 ────────────────────────'
cat > "$FIX" <<'FIXTURE'
OK	https://a	id1	200	0
OK	https://b	id2	202	0
DEAD	https://c	id3	404	0
DEAD	https://d	id4	410	0
BLOCKED	https://e	id5	403	0
RETRYABLE	https://f	id6	503	0
UNREACHABLE_DNS	https://g	id7	000	6
UNREACHABLE_TLS	https://h	id8	000	35
UNREACHABLE_TIMEOUT	https://i	id9	000	28
OTHER	https://j	id10	400	0
FIXTURE

check_count 'count_exact OK'                 2 "$(count_exact OK "$FIX")"
check_count 'count_exact DEAD'               2 "$(count_exact DEAD "$FIX")"
check_count 'count_exact BLOCKED'            1 "$(count_exact BLOCKED "$FIX")"
check_count 'count_exact RETRYABLE'          1 "$(count_exact RETRYABLE "$FIX")"
check_count 'count_exact OTHER'              1 "$(count_exact OTHER "$FIX")"
check_count 'count_exact UNREACHABLE_DNS'    1 "$(count_exact UNREACHABLE_DNS "$FIX")"
# 前綴要抓到全部 3 個 UNREACHABLE_*，但 count_exact 不可把 UNREACHABLE_DNS 算進 UNREACHABLE_
check_count 'count_prefix UNREACHABLE_（3 個）' 3 "$(count_prefix UNREACHABLE_ "$FIX")"
check_count 'count_exact UNREACHABLE_（精確比對，0 筆）' 0 "$(count_exact UNREACHABLE_ "$FIX")"

# 會開 issue 的 = DEAD + DNS = 3
d=$(count_exact DEAD "$FIX"); n=$(count_exact UNREACHABLE_DNS "$FIX")
check_count '會開 issue 的筆數 (DEAD + DNS)' 3 "$((d + n))"

echo '── 計數：空檔案也不能炸 ─────────────────────────────────────'
: > "$FIX"
check_count 'count_exact OK（空檔）'          0 "$(count_exact OK "$FIX")"
check_count 'count_prefix UNREACHABLE_（空檔）' 0 "$(count_prefix UNREACHABLE_ "$FIX")"
e1=$(count_exact DEAD "$FIX")
if t=$((e1 + 0)) 2>/dev/null && [ "$t" = "0" ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); echo '  ✗ 空檔案的計數無法做算術展開'
fi

echo
echo "通過 $pass 項，失敗 $fail 項"
[ "$fail" -eq 0 ] || exit 1
echo '✅ status matrix + 計數 全部通過'
