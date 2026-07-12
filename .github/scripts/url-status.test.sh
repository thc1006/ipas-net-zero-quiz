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

echo
echo "通過 $pass 項，失敗 $fail 項"
[ "$fail" -eq 0 ] || exit 1
echo '✅ status matrix 全部通過'
