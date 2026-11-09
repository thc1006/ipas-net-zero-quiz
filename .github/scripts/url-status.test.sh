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

echo '-- OK：2xx / 3xx，且不是 WAF 驗證頁（驗證頁見下方 WAF 段）'
check 200 0 OK
check 201 0 OK
check 202 0 OK '← 狀態碼本身不是驗證頁的證據；EUR-Lex 的 202 靠 x-amzn-waf-action 認出來'
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
check_icon OK        '[OK]'
check_icon DEAD      '[DEAD]'
check_icon DEAD_DNS  '[DEAD]'
check_icon BLOCKED   '[BLOCKED]'
check_icon RETRYABLE '[RETRY]'
check_icon UNREACHABLE_DNS '[UNREACH]'
check_icon OTHER     '[?]'

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


# -----------------------------------------------------------------------------
# WAF 驗證頁：狀態碼是 2xx，內容卻不是那一頁。
#
# 2026-11-04 實測（與 check-url.sh 相同的 curl 旗標）：
#   - EUR-Lex 的 10 個網址全回 202，header 帶 x-amzn-waf-action: challenge，
#     body 是 AWS WAF 的 challenge.js。先前文件說「EUR-Lex 正常回 202」，其實是驗證頁。
#   - unfccc.int 的首頁、一個不存在的路徑、清單裡的兩頁都回 200：212 bytes 的
#     Incapsula JS 驗證頁，或 iframe 的 "Request unsuccessful. Incapsula incident ID"。
#     不存在的頁面也是 200，所以 unfccc.int 的死連結一律被報成 OK。
# 驗證頁證明不了那一頁還在，也證明不了它不在：站台活著、內容沒驗到，所以是 BLOCKED。
# -----------------------------------------------------------------------------
echo '-- WAF 驗證頁：2xx / 3xx 也不算 OK，改判 BLOCKED（只警告，不開 issue）'
check_waf() {
  local http="$1" waf="$2" expected="$3" note="${4:-}" got
  got="$(classify_url_status "$http" 0 '' "$waf")"
  if [ "$got" = "$expected" ]; then pass=$((pass + 1)); else
    fail=$((fail + 1))
    printf '  ✗ http=%-4s waf=%-10s 期望 %-10s 實得 %-10s %s\n' "$http" "$waf" "$expected" "$got" "$note"
  fi
}
check_waf 200 imperva BLOCKED '← unfccc.int 的 Incapsula 驗證頁'
check_waf 202 aws-waf BLOCKED '← EUR-Lex 的 AWS WAF challenge'
check_waf 302 imperva BLOCKED '← 3xx 原本也算 OK，同樣不能放行'
check_waf 200 ''      OK      '← 沒有驗證頁的跡象就照狀態碼'
check_waf 404 imperva DEAD    '← 只改「原本會是 OK」的那些，不動其他分類'
check_waf 403 aws-waf BLOCKED
if [ "$(classify_url_status 000 28 '' aws-waf)" = 'UNREACHABLE_TIMEOUT' ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); echo '  ✗ curl 失敗時 exit code 仍要優先於驗證頁判定'
fi

# detect_challenge <header 檔> <body 檔>：讀 curl -D 與 -o 寫下的檔案，印出廠商名或空字串。
# fixture 一律寫成檔案，跟 check-url.sh 實際餵給它的形式一樣（header 用 CRLF）。
CH="$TMPDIR_T/challenge"; mkdir -p "$CH"
fx() { printf '%b' "$2" > "$CH/$1.h"; printf '%b' "$3" > "$CH/$1.b"; }
expect_waf() {
  local name="$1" want="$2" note="${3:-}" got
  got=$(detect_challenge "$CH/$name.h" "$CH/$name.b")
  if [ "$got" = "$want" ]; then pass=$((pass + 1)); else
    fail=$((fail + 1))
    printf '  ✗ detect_challenge %-22s 期望 %-10s 實得 %-10s %s\n' "$name" "${want:-<空>}" "${got:-<空>}" "$note"
  fi
}

# 實測的 Incapsula JS 驗證頁（unfccc.int，212 bytes，逐字）
IMPERVA_JS='<html><head><META NAME="robots" CONTENT="noindex,nofollow"><script src="/_Incapsula_Resource?SWJIYLWA=5074a744e2e3d891814e9a2dace20bd4,719d34d31c8e3a6e6fffd425f7e032f3"></script><body></body></html>'
# 實測的 Incapsula 擋頁（unfccc.int）。incident ID、xinfo 與用戶端 IP 換成假值，結構照抄。
IMPERVA_IFRAME='<html style="height:100%"><head><META NAME="ROBOTS" CONTENT="NOINDEX, NOFOLLOW"><meta name="format-detection" content="telephone=no"><meta name="viewport" content="initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1"></head><body style="margin:0px;height:100%"><iframe id="main-iframe" src="/_Incapsula_Resource?SWUDNSAI=31&xinfo=1-2-0%200NNN&incident_id=000-111&edet=12&cinfo=04000000&rpinfo=0&cip=192.0.2.1&mth=GET" frameborder=0 width="100%" height="100%" marginheight="0px" marginwidth="0px">Request unsuccessful. Incapsula incident ID: 000-111</iframe></body></html>'
IMPERVA_HDR='HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nCache-Control: no-cache, no-store\r\nX-Iinfo: 1-2-0 0CNN RT(1 2) q(0 -1 -1 -1) r(0 -1)\r\nSet-Cookie: visid_incap_1=x; path=/\r\nSet-Cookie: incap_ses_1_1=y; path=/\r\n\r\n'

echo '-- detect_challenge：AWS WAF（認 header，不認狀態碼）'
fx aws-challenge 'HTTP/1.1 202 Accepted\r\nServer: CloudFront\r\nx-amzn-waf-action: challenge\r\nContent-Type: text/html; charset=UTF-8\r\nAccess-Control-Expose-Headers: x-amzn-waf-action\r\n\r\n' \
  '<!DOCTYPE html><html><head><script src="https://x.token.awswaf.com/x/y/challenge.js"></script></head><body><div id="challenge-container"></div></body></html>'
expect_waf aws-challenge aws-waf '← EUR-Lex 實測的 header 組合'
fx aws-captcha 'HTTP/2 405\r\nx-amzn-waf-action: captcha\r\ncontent-type: text/html\r\n\r\n' '<html></html>'
expect_waf aws-captcha aws-waf
fx aws-case 'HTTP/1.1 202 Accepted\r\nX-Amzn-Waf-Action:   Challenge\r\n\r\n' ''
expect_waf aws-case aws-waf '← header 名稱不分大小寫（HTTP/1.1 不保證小寫）'
# 必須不命中：EUR-Lex 連正常回應都可能帶這個 CORS header，它的「值」提到 x-amzn-waf-action
fx aws-expose 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nAccess-Control-Expose-Headers: x-amzn-waf-action\r\n\r\n' \
  '<html><body><h1>Regulation (EU) 2023/956</h1></body></html>'
expect_waf aws-expose '' '← 只認 header 名稱，不認別的 header 的值'
fx aws-prefixed 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nX-Original-X-Amzn-Waf-Action: challenge\r\n\r\n' '<html><body><p>ok</p></body></html>'
expect_waf aws-prefixed '' '← header 名稱要整個相同，不能只是別的名稱的結尾'
fx plain-202 'HTTP/1.1 202 Accepted\r\nContent-Type: text/html\r\n\r\n' '<html><body><p>Your request has been accepted.</p></body></html>'
expect_waf plain-202 '' '← 202 本身不是驗證頁的證據'

echo '-- detect_challenge：Imperva / Incapsula（header 分不出來，只能認 body 的結構）'
# X-Iinfo、visid_incap_、X-CDN: Imperva 在正常內容頁上也都有（ifrs.org、moi.gov.tw 實測），不能拿來判斷。
fx imperva-js "$IMPERVA_HDR" "$IMPERVA_JS"
expect_waf imperva-js imperva '← 實測 212 bytes，逐字'
fx imperva-iframe "$IMPERVA_HDR" "$IMPERVA_IFRAME"
expect_waf imperva-iframe imperva '← 實測的 Request unsuccessful 擋頁'
fx imperva-multiline 'HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\n\r\n' \
  '<HTML>\r\n<HEAD>\r\n<META NAME="robots" CONTENT="noindex,nofollow">\r\n<SCRIPT SRC="/_Incapsula_Resource?SWJIYLWA=abc">\r\n</SCRIPT>\r\n</HEAD>\r\n<BODY>\r\n</BODY>\r\n</HTML>\r\n'
expect_waf imperva-multiline imperva '← 換行、大小寫、多一個 </head> 都不影響'
# 必須不命中：經 Imperva 的正常內容頁，body 結尾也有 _Incapsula_Resource 的 script。
# 這段照 ifrs.org 實測的結尾寫（真頁面在 64 KiB 之後，這裡縮成小頁，才落在讀取範圍內）。
fx imperva-real-page "$IMPERVA_HDR" \
  '<html><head><title>IFRS S2</title></head><body><h1>IFRS S2 Climate-related Disclosures</h1><p>Content.</p><script type="text/javascript" src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3&ns=14&cb=172250363" async></script></body></html>'
expect_waf imperva-real-page '' '← 正常頁也會被注入這支 script，光看字串會誤判'
fx imperva-pdf 'HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nX-CDN: Imperva\r\nX-Iinfo: 1-2-3 NNNY CT(1 2 0)\r\nSet-Cookie: visid_incap_1=x; path=/\r\nSet-Cookie: incap_ses_1_1=y; path=/\r\n\r\n' \
  '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'
expect_waf imperva-pdf '' '← unfccc.int 的 PDF 實測就是這樣經 Imperva 送來的'
fx mentions-incapsula 'HTTP/2 200\r\ncontent-type: text/html; charset=utf-8\r\n\r\n' \
  '<html><body><h1>Why does my scraper see a blank page?</h1><p>The server answers 200 with <code>&lt;script src="/_Incapsula_Resource?SWJIYLWA=abc"&gt;&lt;/script&gt;&lt;body&gt;&lt;/body&gt;</code>, or with an iframe that says Request unsuccessful. Incapsula incident ID: 123-456.</p></body></html>'
expect_waf mentions-incapsula '' '← 文章提到 Incapsula 不等於驗證頁'
# 純文字檔（例如 raw.githubusercontent.com 上的說明）逐字貼了驗證頁的 HTML：不是 HTML 回應就不看 body
fx plain-text-sample 'HTTP/2 200\r\ncontent-type: text/plain; charset=utf-8\r\n\r\n' "$IMPERVA_JS"
expect_waf plain-text-sample '' '← 只有 text/html 的回應才看 body'

echo '-- detect_challenge：Anubis（預設對驗證頁與拒絕頁都回 200，也沒有專屬 header）'
# anubis.techaro.lol 實測：真頁面與不存在的路徑都回 200 的驗證頁。結構照抄，值換成假的。
fx anubis 'HTTP/2 200\r\ncontent-type: text/html; charset=utf-8\r\nset-cookie: techaro.lol-anubis-cookie-verification-1=x; Path=/\r\n\r\n' \
  '<!doctype html><html lang="en"><head><title>Making sure you&#39;re not a bot!</title><meta name="robots" content="noindex,nofollow"><script id="anubis_version" type="application/json">"v1.28.3"\n</script><script id="anubis_challenge" type="application/json">{"rules":{"algorithm":"metarefresh","difficulty":1}}\n</script></head><body id="top"><main><h1 id="title" class="centered-div">Making sure you&#39;re not a bot!</h1></main></body></html>'
expect_waf anubis anubis '← anubis.techaro.lol 實測的結構'
fx mentions-anubis 'HTTP/2 200\r\ncontent-type: text/html; charset=utf-8\r\n\r\n' \
  '<html><body><p>Anubis pages carry <code>&lt;script id="anubis_challenge" type="application/json"&gt;</code>. This site is protected by Anubis.</p></body></html>'
expect_waf mentions-anubis '' '← 文章提到 Anubis 不等於驗證頁'

echo '-- detect_challenge：只看最後一個回應（curl -L 會把每一跳的 header 都寫進 -D 檔）'
fx hop-final-challenge 'HTTP/1.1 301 Moved Permanently\r\nLocation: /eli/reg/2023/956/oj\r\nContent-Type: text/html\r\n\r\nHTTP/1.1 202 Accepted\r\nx-amzn-waf-action: challenge\r\nContent-Type: text/html\r\n\r\n' ''
expect_waf hop-final-challenge aws-waf
fx hop-early-header 'HTTP/1.1 302 Found\r\nLocation: /real\r\nx-amzn-waf-action: challenge\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n' \
  '<html><body><p>Real content.</p></body></html>'
expect_waf hop-early-header '' '← 前一跳的 header 不算數'
# 前一跳是 text/html 的轉址頁，最後一跳是純文字：content-type 也只看最後一跳
fx hop-early-ctype 'HTTP/1.1 301 Moved Permanently\r\nLocation: /raw.txt\r\nContent-Type: text/html\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n' "$IMPERVA_JS"
expect_waf hop-early-ctype '' '← content-type 也只看最後一跳'

echo '-- detect_challenge：body 只讀前 64 KiB'
# 驗證頁都很小（實測 212 / 851 / 2038 bytes）；整份 body 可能是好幾 MB 的 PDF。
pad=$(printf '%65536s' '')
fx past-cap "$IMPERVA_HDR" "<!--${pad}-->$IMPERVA_JS"
expect_waf past-cap '' '← 第 64 KiB 之後的內容不讀'
pad=$(printf '%65000s' '')
fx within-cap "$IMPERVA_HDR" "<!--${pad}-->$IMPERVA_JS"
expect_waf within-cap imperva '← 對照組：落在 64 KiB 之內就讀得到'

echo '-- detect_challenge：檔案不在、或在 set -euo pipefail 底下沒命中，都不能出錯'
# curl 連不上時 -D / -o 的檔案可能根本沒建立
got=$(detect_challenge "$CH/nope.h" "$CH/nope.b" 2>&1; printf 'rc=%s' "$?")
if [ "$got" = 'rc=0' ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); printf '  ✗ 檔案不存在時應安靜地印空字串並 exit 0，實得 %s\n' "$got"
fi
# 呼叫端（workflow）是 set -euo pipefail：沒命中時 grep 回 1，若漏到函式外，整個 step 會當場結束
got=$(
  set -euo pipefail
  v=$(detect_challenge "$CH/plain-202.h" "$CH/plain-202.b")
  echo "SURVIVED:$v"
)
if [ "$got" = 'SURVIVED:' ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); printf '  ✗ set -euo pipefail 之下沒命中就讓 shell 中止了（輸出：%s）\n' "$(printf '%q' "$got")"
fi
# header 說是 text/html，body 檔卻不存在（-o 的檔案是收到第一筆 body 才建立，收完 header 就斷線時不會有）
printf '%b' 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n' > "$CH/no-body.h"
got=$(
  set -euo pipefail
  v=$(detect_challenge "$CH/no-body.h" "$CH/no-body.b" 2>&1)
  echo "SURVIVED:$v"
)
if [ "$got" = 'SURVIVED:' ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); printf '  ✗ body 檔不存在時應安靜地印空字串（輸出：%s）\n' "$(printf '%q' "$got")"
fi

echo
echo "通過 $pass 項，失敗 $fail 項"
[ "$fail" -eq 0 ] || exit 1
echo 'status matrix + 計數 + url_host + status_icon 全部通過'
