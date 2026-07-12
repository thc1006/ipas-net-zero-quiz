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
check 000 6  UNREACHABLE_DNS     '← 單次 exit 6：只警告，不敢斷言 NXDOMAIN'
check 000 7  UNREACHABLE_CONNECT
check 000 28 UNREACHABLE_TIMEOUT
check 000 35 UNREACHABLE_TLS
check 000 60 UNREACHABLE_TLS
check 000 99 UNREACHABLE_OTHER
check 200 6  UNREACHABLE_DNS     '← curl 失敗時 exit code 優先於 http_code'

echo '── DNS：exit 6 只有在獨立 resolver 也確認 NXDOMAIN 時才算真死 ──'
# curl 的 exit 6 官方定義只是「Couldn't resolve host」，不保證是 NXDOMAIN。
# 暫時性 resolver 故障 / SERVFAIL / runner 自己的 DNS 問題都長成同一個碼。
check_dns() {
  local http="$1" rc="$2" verdict="$3" expected="$4" note="${5:-}"
  local got; got="$(classify_url_status "$http" "$rc" "$verdict")"
  if [ "$got" = "$expected" ]; then pass=$((pass + 1)); else
    fail=$((fail + 1))
    printf '  ✗ http=%-4s exit=%-2s dns=%-9s 期望 %-18s 實得 %-18s %s
'       "$http" "$rc" "$verdict" "$expected" "$got" "$note"
  fi
}
check_dns 000 6 NXDOMAIN DEAD_DNS        '← 兩個獨立 resolver 都說 NXDOMAIN -> 真的死了'
check_dns 000 6 SERVFAIL UNREACHABLE_DNS '← SERVFAIL 是 resolver 故障，不是網域沒了'
check_dns 000 6 NOERROR  UNREACHABLE_DNS '← 解析得到卻連不上 -> 不是 NXDOMAIN'
check_dns 000 6 UNKNOWN  UNREACHABLE_DNS '← 拿不到 dig -> 寧可漏報，不要誤報'
check_dns 000 6 ''       UNREACHABLE_DNS '← 沒給 verdict -> 保守處理'
check_dns 000 7 NXDOMAIN UNREACHABLE_CONNECT '← verdict 只在 exit 6 時有意義'

echo '── is_failure：只有 DEAD 與 DNS 失敗才開 issue ──────────────'
for s in DEAD DEAD_DNS; do
  if is_failure "$s"; then pass=$((pass + 1)); else
    fail=$((fail + 1)); echo "  ✗ is_failure($s) 應為 true"
  fi
done
for s in OK BLOCKED RETRYABLE UNREACHABLE_DNS UNREACHABLE_TIMEOUT UNREACHABLE_TLS UNREACHABLE_CONNECT OTHER; do
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

# 會開 issue 的 = DEAD + DEAD_DNS。
# UNREACHABLE_DNS **不算** —— curl exit 6 不保證是 NXDOMAIN，單次解析失敗只警告。
# 這個 fixture 有 2 筆 DEAD、1 筆 UNREACHABLE_DNS、0 筆 DEAD_DNS -> 應為 2。
d=$(count_exact DEAD "$FIX"); dd=$(count_exact DEAD_DNS "$FIX")
check_count '會開 issue 的筆數 (DEAD + DEAD_DNS)' 2 "$((d + dd))"
check_count 'UNREACHABLE_DNS 不得計入失效' 0 "$(count_exact DEAD_DNS "$FIX")"

echo '── 計數：空檔案也不能炸 ─────────────────────────────────────'
: > "$FIX"
check_count 'count_exact OK（空檔）'          0 "$(count_exact OK "$FIX")"
check_count 'count_prefix UNREACHABLE_（空檔）' 0 "$(count_prefix UNREACHABLE_ "$FIX")"
e1=$(count_exact DEAD "$FIX")
if t=$((e1 + 0)) 2>/dev/null && [ "$t" = "0" ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); echo '  ✗ 空檔案的計數無法做算術展開'
fi


# ─────────────────────────────────────────────────────────────────────────────
# url_host 與 status_icon 先前是零覆蓋。
#
# url_host 的輸出直接餵給 dig，也就是**直接餵給 DEAD_DNS 的決策** ——
# 它一旦壞掉（例如不再剝掉 port 或 userinfo），dig 會查一個不存在的主機名而回
# NXDOMAIN，於是一個活著的網址被判定為「網域已停用」並自動開 issue，
# 而所有測試都是綠的。這種地方不能沒有測試。
echo '── url_host（輸出直接餵給 dig -> 直接影響 DEAD_DNS 判定）'
check_host() {
  local url="$1" want="$2" got
  got=$(url_host "$url")
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  ✗ url_host %-44s 期望 %-24s 實得 %s\n' "$url" "$want" "${got:-<空>}"
  fi
}
check_host 'https://example.org/a/b?c=d'          'example.org'
check_host 'http://example.org'                    'example.org'
check_host 'https://example.org:8443/x'            'example.org'      # 必須剝掉 port
check_host 'https://user:pass@example.org/x'       'example.org'      # 必須剝掉 userinfo
check_host 'https://user@example.org:8443/x'       'example.org'      # 兩者並存
check_host 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0956-20251020' 'eur-lex.europa.eu'

echo '── status_icon（報表的門面：DEAD 不可以長得像成功）'
check_icon() {
  local cat="$1" want="$2" got
  got=$(status_icon "$cat")
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  ✗ status_icon %-20s 期望 %s 實得 %s\n' "$cat" "$want" "$got"
  fi
}
check_icon OK        '✅'
check_icon DEAD      '❌'
check_icon DEAD_DNS  '❌'
check_icon BLOCKED   '🟡'
check_icon RETRYABLE '🔄'
check_icon UNREACHABLE_DNS '🔌'
check_icon OTHER     '❓'

echo '── ALL_STATUS_CATEGORIES 必須涵蓋 classify 吐得出來的每一種分類'
# 聚合是靠 ALL_STATUS_CATEGORIES 去列舉「哪些算失效」的（failure_categories）。
# 它一旦漏列某個分類，那個分類就永遠不可能被判成失效 —— 又一次「安靜地少報」。
missing=''
for probe in '200 0' '404 0' '410 0' '403 0' '503 0' '418 0' '000 6' '000 7' '000 28' '000 35' '000 99'; do
  # shellcheck disable=SC2086
  c=$(classify_url_status $probe)
  case " $(echo $ALL_STATUS_CATEGORIES) " in
    *" $c "*) ;;
    *) missing="$missing $c" ;;
  esac
done
c=$(classify_url_status 000 6 NXDOMAIN)
case " $(echo $ALL_STATUS_CATEGORIES) " in *" $c "*) ;; *) missing="$missing $c" ;; esac
if [ -z "$missing" ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf '  ✗ 這些分類 classify 吐得出來，卻不在 ALL_STATUS_CATEGORIES 裡：%s\n' "$missing"
fi

echo
echo "通過 $pass 項，失敗 $fail 項"
[ "$fail" -eq 0 ] || exit 1
echo '✅ status matrix + 計數 + url_host + status_icon 全部通過'
