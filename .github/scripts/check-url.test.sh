#!/usr/bin/env bash
# check-url.sh 的離線測試 —— 用假的 curl / dig（PATH 注入）把每條路徑跑過一遍。
#
# 這一支測的是 **glue**：「要不要做 DNS 二次確認、有沒有把結果傳給分類器」。
# 分類器本身有 url-status.test.sh，聚合有 aggregate-results.test.sh，但把 curl 的
# exit code 接到 resolve_dns_status、再接到 classify_url_status 的那幾行，
# 原本只存在於 workflow 的 `run:` 區塊裡 —— 沒有任何測試碰得到。
#
# 那正是最危險的地方：只要忘了把 $dns 傳進 classify_url_status，DEAD_DNS 就
# **永遠不會觸發**，網域真的停用也不會開 issue，而且所有測試照樣全綠。
# 「安靜地少報」比誤報更難發現。

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pass=0
fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── 假的 curl ────────────────────────────────────────────────────────────────
# 行為完全由 URL 的主機名決定。重點是它「像真的 curl 一樣」：
# 失敗時**自己就會印出 000**，而且同時回非 0 的 exit code。
# （真 curl 的這個行為，正是舊版 `|| echo "000"` 產生 "000000" 的原因。）
mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
url="${!#}"          # 最後一個參數就是 URL
host="${url#*://}"; host="${host%%/*}"
case "$host" in
  ok.example)        printf '200'; exit 0 ;;
  accepted.example)  printf '202'; exit 0 ;;  # EUR-Lex 正常回這個
  moved.example)     printf '301'; exit 0 ;;
  dead.example)      printf '404'; exit 0 ;;
  gone.example)      printf '410'; exit 0 ;;
  blocked.example)   printf '403'; exit 0 ;;
  retry.example)     printf '503'; exit 0 ;;
  weird.example)     printf '418'; exit 0 ;;
  timeout.example)   printf '000'; exit 28 ;;
  tls.example)       printf '000'; exit 35 ;;
  refused.example)   printf '000'; exit 7  ;;
  # 以下全都是 curl exit 6（"Couldn't resolve host"）—— 差別只在 dig 怎麼說
  nxdomain.example)  printf '000'; exit 6 ;;
  servfail.example)  printf '000'; exit 6 ;;
  split.example)     printf '000'; exit 6 ;;
  digless.example)   printf '000'; exit 6 ;;
  *)                 printf '000'; exit 6 ;;
esac
FAKE_CURL
chmod +x "$TMP/bin/curl"

# ── 假的 dig ─────────────────────────────────────────────────────────────────
# 參數形如：dig +time=3 +tries=2 @1.1.1.1 <host> A
#
# 這支假 dig 有兩個職責：
#  1. 依 host 回不同的 status（測比較邏輯）
#  2. **把自己收到的 argv 記錄下來**，並且「只有在被指定了 @resolver 時才肯回 NXDOMAIN」
#
# 第 2 點是關鍵。整個 DEAD_DNS 閘門（curl exit 6 -> 自動開 issue 之間唯一的煞車）
# 建立在「1.1.1.1 與 8.8.8.8 是**各自獨立**被查詢」之上。但把 dig 指令裡的
# "@$resolver" 拿掉（兩次查詢都走系統 resolver），先前**四支測試全綠** ——
# 也就是說這道把關的「獨立性」根本沒有任何東西在守。
#
# 真實後果：一個被劫持或壞掉的系統 resolver 連續回兩次 NXDOMAIN，就會產生 DEAD_DNS
# 並自動開 issue —— 正是這個設計存在的理由所要防的那件事。
#
# 所以：沒有 @resolver 就一律回 NOERROR。拿掉 @resolver 的變異會讓
# nxdomain.example 得不到 NXDOMAIN，DEAD_DNS 那條測試就會紅。
cat > "$TMP/bin/dig" <<'FAKE_DIG'
#!/usr/bin/env bash
[ "${1:-}" = '-v' ] && { echo 'DiG 9.18.0 (fake)'; exit 0; }
resolver=''; host=''
for a in "$@"; do
  case "$a" in
    @*) resolver="${a#@}" ;;
    A|+*) ;;
    *) host="$a" ;;
  esac
done
# 記錄每一次查詢用的 resolver（測試會據此斷言兩個 resolver 都真的被問過）
printf '%s	%s
' "${resolver:-NONE}" "$host" >> "$DIG_LOG"

emit() { echo ";; ->>HEADER<<- opcode: QUERY, status: $1, id: 1234"; }

# 沒有指定 @resolver -> 我們就不知道是誰回答的 -> 絕不給 NXDOMAIN。
if [ -z "$resolver" ]; then emit NOERROR; exit 0; fi

case "$host" in
  nxdomain.example) emit NXDOMAIN ;;
  servfail.example) emit SERVFAIL ;;
  # 關鍵鑑別案例：兩個 resolver **不一致**。
  # 1.1.1.1 說 NXDOMAIN、8.8.8.8 說 NOERROR —— 這種情況**不可以**升級成 DEAD_DNS。
  # 若把「兩邊都要 NXDOMAIN」錯寫成「任一邊 NXDOMAIN」，就會在這裡誤報。
  split.example)
    if [ "$resolver" = '1.1.1.1' ]; then emit NXDOMAIN; else emit NOERROR; fi ;;
  *) emit NXDOMAIN ;;
esac
exit 0
FAKE_DIG
chmod +x "$TMP/bin/dig"
DIG_LOG="$TMP/dig.log"; : > "$DIG_LOG"; export DIG_LOG

# ── 測試骨架 ─────────────────────────────────────────────────────────────────
# 每個 case 都在乾淨的子 shell 裡跑，PATH 前置假的 bin。
run_check() {
  local url="$1" ids="${2:-id1}" extra_path="${3:-}"
  (
    PATH="$TMP/bin:$PATH"
    [ -n "$extra_path" ] && PATH="$extra_path"
    export PATH
    # shellcheck source=./check-url.sh
    . "$SCRIPT_DIR/check-url.sh"
    check_url "$(printf '%s\t%s' "$url" "$ids")" 2>/dev/null
  )
}

# 取第 N 欄
field() { printf '%s' "$1" | cut -f"$2"; }

expect_cat() {
  local url="$1" want="$2" note="${3:-}"
  local out got
  out=$(run_check "$url")
  got=$(field "$out" 1)
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  ✗ %-24s 期望 %-16s 實得 %-16s %s\n' "$url" "$want" "${got:-<空>}" "$note"
  fi
}

echo '── HTTP 狀態碼 -> 分類'
expect_cat https://ok.example       OK
expect_cat https://accepted.example OK        '(202 Accepted — EUR-Lex 正常回這個)'
expect_cat https://moved.example    OK
expect_cat https://dead.example     DEAD
expect_cat https://gone.example     DEAD
expect_cat https://blocked.example  BLOCKED   '(WAF 擋 runner，站台活著)'
expect_cat https://retry.example    RETRYABLE '(503 不是連結壞掉)'
expect_cat https://weird.example    OTHER     '(絕不靜默歸成 DEAD)'

echo '── curl exit code -> 分類（非 DNS）'
expect_cat https://timeout.example  UNREACHABLE_TIMEOUT
expect_cat https://tls.example      UNREACHABLE_TLS
expect_cat https://refused.example  UNREACHABLE_CONNECT

echo '── curl exit 6 -> DNS 二次確認（本測試的重點）'
# 兩個 resolver 都說 NXDOMAIN -> 真的死了 -> 開 issue
expect_cat https://nxdomain.example DEAD_DNS        '(兩個 resolver 都 NXDOMAIN)'
# SERVFAIL 是暫時性故障，不是「網域不存在」-> 只警告
expect_cat https://servfail.example UNREACHABLE_DNS '(SERVFAIL 不等於網域停用)'
# 兩個 resolver 不一致 -> 不可升級。這條是「必須兩邊都同意」的鑑別力所在：
# 若錯寫成「任一邊 NXDOMAIN 就算」，這裡會得到 DEAD_DNS 而炸掉。
expect_cat https://split.example    UNREACHABLE_DNS '(resolver 不一致，不得升級)'

echo '── 兩個 resolver 必須「各自獨立」被查詢（這道把關先前完全沒人守）'
# 整個 DEAD_DNS 閘門建立在「1.1.1.1 與 8.8.8.8 各自獨立回答」之上。
# 但把 dig 指令裡的 "@$resolver" 拿掉，先前四支測試**全綠** —— 兩次查詢都走系統
# resolver，一個被劫持的 resolver 連回兩次 NXDOMAIN 就會自動開 issue，
# 而那正是這個設計要防的事。這裡直接斷言 dig 真的被指定了兩個不同的 resolver。
: > "$TMP/dig.log"
run_check https://nxdomain.example id-indep > /dev/null
resolvers=$(cut -f1 "$TMP/dig.log" | sort -u | tr '
' ',' )
if [ "$resolvers" = '1.1.1.1,8.8.8.8,' ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf '  ✗ dig 應被指定 1.1.1.1 與 8.8.8.8 兩個獨立 resolver，實得：%s
' "${resolvers:-<沒有任何查詢>}"
fi
# 而且不得有任何一次查詢是「沒指定 resolver」的
if grep -q '^NONE' "$TMP/dig.log"; then
  fail=$((fail + 1))
  echo '  ✗ 有 dig 查詢沒有指定 @resolver —— 那次查的是系統 resolver，獨立性不成立'
else
  pass=$((pass + 1))
fi

echo '── 拿不到 dig 時必須降級（寧可漏報，不要誤報）'
# PATH 只留假 curl，沒有 dig。resolve_dns_status 回 UNKNOWN，
# 因此就算 curl exit 6，也**不可以**變成 DEAD_DNS。
out=$(
  # coreutils 仍需可用（cut / printf 等），但 dig 不在裡面
  DIGLESS="$TMP/digless"; mkdir -p "$DIGLESS"
  ln -sf "$TMP/bin/curl" "$DIGLESS/curl" 2>/dev/null || cp "$TMP/bin/curl" "$DIGLESS/curl"
  for b in bash env cut printf sed head; do
    p=$(command -v "$b" 2>/dev/null) && ln -sf "$p" "$DIGLESS/$b" 2>/dev/null
  done
  run_check https://nxdomain.example id9 "$DIGLESS:/usr/bin:/bin"
)
got=$(field "$out" 1)
if [ "$got" = 'UNREACHABLE_DNS' ] || [ "$got" = 'DEAD_DNS' ]; then
  # 這個 case 的環境（PATH 裡有沒有 dig）在不同機器上不保證，
  # 所以只斷言「至少是 DNS 類」，真正的 dig-missing 行為由下面的直接單元測試涵蓋。
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf '  ✗ dig-less：期望 *_DNS 分類，實得 %s\n' "${got:-<空>}"
fi

# 直接測 resolve_dns_status 在「完全沒有 dig」時的行為（不依賴 PATH 伎倆）
digless_verdict=$(
  PATH="/nonexistent-dir-for-test"
  export PATH
  # shellcheck source=./url-status.sh
  . "$SCRIPT_DIR/url-status.sh"
  resolve_dns_status nxdomain.example
)
if [ "$digless_verdict" = 'UNKNOWN' ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf '  ✗ 沒有 dig 時 resolve_dns_status 應回 UNKNOWN，實得 %s\n' "$digless_verdict"
fi
# 且 UNKNOWN 絕不可升級成 DEAD_DNS
if [ "$(. "$SCRIPT_DIR/url-status.sh"; classify_url_status 000 6 UNKNOWN)" = 'UNREACHABLE_DNS' ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo '  ✗ dns_verdict=UNKNOWN 竟被升級成 DEAD_DNS —— 寧可漏報，不要誤報'
fi

echo '── 輸出格式（下游 aggregate-results.sh / github-script 都靠它）'
out=$(run_check https://dead.example 'gist-1,pool-2')
nf=$(printf '%s' "$out" | awk -F'\t' '{ print NF }')
if [ "$nf" = '6' ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf '  ✗ 輸出應為 6 欄（cat/url/ids/http/rc/dns），實得 %s 欄\n' "$nf"
fi
[ "$(field "$out" 2)" = 'https://dead.example' ] && pass=$((pass + 1)) || { fail=$((fail + 1)); echo '  ✗ 第 2 欄應為 url'; }
[ "$(field "$out" 3)" = 'gist-1,pool-2' ]        && pass=$((pass + 1)) || { fail=$((fail + 1)); echo '  ✗ 第 3 欄應為 ids（逗號分隔，不得被切碎）'; }
[ "$(field "$out" 4)" = '404' ]                  && pass=$((pass + 1)) || { fail=$((fail + 1)); echo '  ✗ 第 4 欄應為 http code'; }

# 空行不得產生輸出
if [ -z "$(run_check '' '')" ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo '  ✗ 空 URL 不該產生任何輸出'
fi

echo '── set -euo pipefail 之下，curl 失敗不得讓整個 shell 當場結束'
# workflow 就是 set -euo pipefail。若 check_url 寫成「賦值後再取 $?」，
# 在 -e 之下第一個連不上的 URL 就會讓整個 step 直接死掉，而不是被記錄下來。
# 目前是靠「跑在 xargs 的子行程裡（不繼承 -e）」僥倖沒事 —— 那是巧合，不是設計。
out=$(
  set -euo pipefail
  PATH="$TMP/bin:$PATH"; export PATH
  # shellcheck source=./check-url.sh
  . "$SCRIPT_DIR/check-url.sh"
  check_url "$(printf 'https://timeout.example\tid7')" 2>/dev/null
  echo "SURVIVED"
)
if printf '%s' "$out" | grep -q 'SURVIVED' && printf '%s' "$out" | grep -q 'UNREACHABLE_TIMEOUT'; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf '  ✗ set -e 之下 curl 失敗就讓 shell 中止了（輸出：%s）\n' "$(printf '%q' "$out")"
fi

echo
echo "通過 $pass 項，失敗 $fail 項"
[ "$fail" -eq 0 ] || exit 1
echo 'check-url glue 測試全部通過'
