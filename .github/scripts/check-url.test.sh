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
#
# 它也照 -D / -o 把 header 與 body 寫進呼叫端指定的檔案，跟真 curl 一樣。
# WAF 驗證頁只能從這兩個檔案認出來：check_url 若忘了傳 -D 或 -o，下面那幾個
# 驗證頁的案例就拿不到 header / body，會被算成 OK，測試就紅。
mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
url="${!#}"          # 最後一個參數就是 URL
host="${url#*://}"; host="${host%%/*}"
hdr=''; body=''; prev=''
for a in "$@"; do
  case "$prev" in
    -D) hdr="$a" ;;
    -o) body="$a" ;;
  esac
  prev="$a"
done
if [ -n "${CURL_LOG:-}" ]; then printf '%s\n' "$hdr" >> "$CURL_LOG"; fi
# respond <http_code> <header 區塊（%b）> <body（%b）>
respond() {
  if [ -n "$hdr" ]; then printf '%b' "$2" > "$hdr"; fi
  if [ -n "$body" ]; then printf '%b' "$3" > "$body"; fi
  printf '%s' "$1"
  exit 0
}
HTML='HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n'
IMPERVA='HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nX-Iinfo: 1-2-0 0CNN RT(1 2)\r\nSet-Cookie: visid_incap_1=x; path=/\r\n\r\n'
IMPERVA_JS='<html><head><META NAME="robots" CONTENT="noindex,nofollow"><script src="/_Incapsula_Resource?SWJIYLWA=5074a744e2e3d891814e9a2dace20bd4,719d34d31c8e3a6e6fffd425f7e032f3"></script><body></body></html>'
case "$host" in
  # 以下這幾個 host 的 header 與 body 照 2026-11-04 的實測寫（unfccc.int、EUR-Lex、ifrs.org、anubis.techaro.lol）
  waf-aws.example)   respond 202 'HTTP/1.1 202 Accepted\r\nServer: CloudFront\r\nx-amzn-waf-action: challenge\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n' \
                       '<html><head><script src="https://x.token.awswaf.com/x/y/challenge.js"></script></head><body><div id="challenge-container"></div></body></html>' ;;
  imperva-js.example) respond 200 "$IMPERVA" "$IMPERVA_JS" ;;
  imperva-iframe.example)
                     respond 200 "$IMPERVA" '<html><head><META NAME="ROBOTS" CONTENT="NOINDEX, NOFOLLOW"></head><body style="margin:0px;height:100%"><iframe id="main-iframe" src="/_Incapsula_Resource?SWUDNSAI=31&incident_id=000-111&cip=192.0.2.1&mth=GET" frameborder=0 width="100%" height="100%">Request unsuccessful. Incapsula incident ID: 000-111</iframe></body></html>' ;;
  anubis.example)    respond 200 'HTTP/2 200\r\ncontent-type: text/html; charset=utf-8\r\n\r\n' \
                       '<html><head><title>Making sure you&#39;re not a bot!</title><script id="anubis_challenge" type="application/json">{"rules":{}}</script></head><body></body></html>' ;;
  # 轉址之後才拿到驗證頁：-D 檔裡有兩個 header 區塊，只有最後一個算數
  hop-waf.example)   respond 202 'HTTP/1.1 301 Moved Permanently\r\nLocation: https://hop-waf.example/oj\r\nContent-Type: text/html\r\n\r\nHTTP/1.1 202 Accepted\r\nx-amzn-waf-action: challenge\r\nContent-Type: text/html\r\n\r\n' '' ;;
  # 以下必須維持 OK：經 Imperva 的真 PDF、提到 Incapsula 的一般文章
  imperva-pdf.example) respond 200 'HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nX-CDN: Imperva\r\nX-Iinfo: 1-2-3 NNNY CT(1 2 0)\r\nSet-Cookie: incap_ses_1_1=y; path=/\r\n\r\n' \
                       '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n' ;;
  mentions.example)  respond 200 "$HTML" '<html><body><p>The server answers 200 with <code>&lt;script src="/_Incapsula_Resource?SWJIYLWA=abc"&gt;&lt;/script&gt;&lt;body&gt;&lt;/body&gt;</code>. Request unsuccessful. Incapsula incident ID: 1-2.</p></body></html>' ;;
  ok.example)        respond 200 "$HTML" '<html><body><p>ok</p></body></html>' ;;
  accepted.example)  respond 202 'HTTP/1.1 202 Accepted\r\nContent-Type: text/html\r\n\r\n' '<html><body><p>Accepted.</p></body></html>' ;;
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
expect_cat https://accepted.example OK        '(202 但沒有 WAF header：照狀態碼算)'
expect_cat https://moved.example    OK
expect_cat https://dead.example     DEAD
expect_cat https://gone.example     DEAD
expect_cat https://blocked.example  BLOCKED   '(WAF 擋 runner，站台活著)'
expect_cat https://retry.example    RETRYABLE '(503 不是連結壞掉)'
expect_cat https://weird.example    OTHER     '(絕不靜默歸成 DEAD)'

echo '-- WAF 驗證頁：狀態碼是 2xx，但 header / body 是驗證頁 -> BLOCKED'
# check_url 要把 -D / -o 的檔案交給 detect_challenge，再把結果交給 classify_url_status。
# 任何一段沒接上，驗證頁就照狀態碼算成 OK：unfccc.int 不存在的頁面也回 200，死連結永遠報不出來。
expect_cat https://waf-aws.example        BLOCKED '(AWS WAF challenge，EUR-Lex 實測)'
expect_cat https://imperva-js.example     BLOCKED '(Incapsula JS 驗證頁，unfccc.int 實測)'
expect_cat https://imperva-iframe.example BLOCKED '(Incapsula 擋頁，unfccc.int 實測)'
expect_cat https://anubis.example         BLOCKED '(Anubis 驗證頁，anubis.techaro.lol 實測)'
expect_cat https://hop-waf.example        BLOCKED '(轉址後才是驗證頁)'
expect_cat https://imperva-pdf.example    OK      '(經 Imperva 的真 PDF 不能誤判)'
expect_cat https://mentions.example       OK      '(文章提到 Incapsula 不能誤判)'
expect_field() {
  local out="$1" n="$2" want="$3" msg="$4"
  if [ "$(field "$out" "$n")" = "$want" ]; then pass=$((pass + 1)); else
    fail=$((fail + 1)); printf '  ✗ %s（實得 %s）\n' "$msg" "$(field "$out" "$n")"
  fi
}
out=$(run_check https://waf-aws.example)
expect_field "$out" 7 aws-waf '第 7 欄應記下認出的 WAF（aws-waf）'
expect_field "$out" 4 202     '第 4 欄仍要是原本的 http code（202）'
out=$(run_check https://ok.example)
expect_field "$out" 7 ''      '不是驗證頁時第 7 欄應為空'
# Actions log 只看得到 stderr 那一行：BLOCKED 配 http=200，要寫出是哪個 WAF，看的人才知道為什麼
log=$(
  PATH="$TMP/bin:$PATH"; export PATH
  # shellcheck source=./check-url.sh
  . "$SCRIPT_DIR/check-url.sh"
  check_url "$(printf 'https://imperva-js.example\tid1')" 2>&1 > /dev/null
)
case "$log" in
  *'waf=imperva'*) pass=$((pass + 1)) ;;
  *) fail=$((fail + 1)); printf '  ✗ stderr 那一行應寫出 waf=imperva，實得：%s\n' "$log" ;;
esac

echo '-- 暫存的 header / body 用完就刪'
# 每個 URL 一份暫存目錄；workflow 一次跑一百多個 URL，body 可能是好幾 MB 的 PDF。
CLEAN="$TMP/clean-tmpdir"; mkdir -p "$CLEAN"
CURL_LOG="$TMP/curl.log"; : > "$CURL_LOG"
(
  TMPDIR="$CLEAN"; export TMPDIR CURL_LOG
  run_check https://imperva-pdf.example > /dev/null
  run_check https://waf-aws.example > /dev/null
  run_check https://timeout.example > /dev/null
)
# 先確認暫存檔真的建在這個目錄底下，否則下面的「目錄是空的」什麼也證明不了
if [ "$(command grep -c "^$CLEAN/" "$CURL_LOG")" = '3' ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); printf '  ✗ -D 的檔案應建在 TMPDIR（%s）底下，實得：%s\n' "$CLEAN" "$(tr '\n' ' ' < "$CURL_LOG")"
fi
left=$(ls -A "$CLEAN")
if [ -z "$left" ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); printf '  ✗ 暫存檔沒有刪掉：%s\n' "$left"
fi
unset CURL_LOG

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
if [ "$nf" = '7' ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf '  ✗ 輸出應為 7 欄（cat/url/ids/http/rc/dns/waf），實得 %s 欄\n' "$nf"
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
# 驗證頁的判定也一樣：沒命中（一般頁面）與命中，都不能讓 -e 的 shell 中止
out=$(
  set -euo pipefail
  PATH="$TMP/bin:$PATH"; export PATH
  # shellcheck source=./check-url.sh
  . "$SCRIPT_DIR/check-url.sh"
  check_url "$(printf 'https://ok.example\tid8')" 2>/dev/null
  check_url "$(printf 'https://imperva-js.example\tid9')" 2>/dev/null
  echo "SURVIVED"
)
if [ "$(printf '%s\n' "$out" | cut -f1 | tr '\n' ',')" = 'OK,BLOCKED,SURVIVED,' ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf '  ✗ set -e 之下判定驗證頁時 shell 中止了，或分類不對（輸出：%s）\n' "$(printf '%q' "$out")"
fi

echo '-- 照 workflow 的方式跑：xargs 開的 bash -c 子行程裡也要認得出驗證頁'
# workflow 在 xargs 開的 `bash -c` 子行程裡呼叫 check_url，子行程只看得到 export 的函式。
# 新增的 helper 沒有 export，子行程裡就是 command not found：驗證頁照狀態碼算成 OK、
# DNS 二次確認也不會發生，而且沒有任何錯誤會讓 step 變紅。
out=$(
  set -euo pipefail
  PATH="$TMP/bin:$PATH"; export PATH
  # shellcheck source=./check-url.sh
  . "$SCRIPT_DIR/check-url.sh"
  printf 'https://imperva-js.example\tid-a\nhttps://nxdomain.example\tid-b\n' \
    | xargs -d '\n' -P 2 -I{} bash -c 'check_url "$@"' _ {} 2>/dev/null | sort
)
want=$(printf 'BLOCKED\thttps://imperva-js.example\tid-a\t200\t0\t\timperva\nDEAD_DNS\thttps://nxdomain.example\tid-b\t000\t6\tNXDOMAIN\t')
if [ "$out" = "$want" ]; then pass=$((pass + 1)); else
  fail=$((fail + 1))
  printf '  ✗ xargs 子行程的輸出不對：\n%s\n' "$(printf '%s' "$out" | sed 's/^/      /')"
fi

echo
echo "通過 $pass 項，失敗 $fail 項"
[ "$fail" -eq 0 ] || exit 1
echo 'check-url glue 測試全部通過'
