#!/usr/bin/env bash
# check-description.sh 的離線測試（不碰網路、不碰 gh）。
#
# 兩面都測：說謊的 description 必須被擋下來，正確的 description 不得誤報。
# 特別要測「description 裡有其他數字」（IFRS S1/S2、ISO 14064、Art.50…）的情況 ——
# 鬆散地「抓第一個數字」會把 14064 當成題數，那種 gate 只是在自我安慰。

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./check-description.sh
. "$SCRIPT_DIR/check-description.sh"

pass=0
fail=0

# 真實世界的 description（含一堆會干擾的數字）
REAL_TAIL='（含 IFRS S1/S2、ISSB 整合 TCFD、永續揭露準則、ISO 14064、CBAM、SBTi）。React + TypeScript SPA + AI 輔助解析（puter.js），符合 EU AI Act Art.50 揭露。'

expect_rc() {
  local name="$1" want="$2" desc="$3" main="$4" pool="$5"
  check_description "$desc" "$main" "$pool" > /dev/null 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  ✗ %-46s 期望 exit=%s 實得 exit=%s\n' "$name" "$want" "$got"
  fi
}

echo '── 正確的 description 不得誤報'
expect_rc '783/157 完全相符' 0 \
  "iPAS 練習工具：783 題主題庫 + 157 題加強練習${REAL_TAIL}" 783 157
expect_rc '數字與「題」之間有空格' 0 \
  "783 題主題庫 + 157 題加強練習" 783 157
expect_rc '數字與「題」之間無空格' 0 \
  "783題主題庫 + 157題加強練習" 783 157

echo '── 說謊的 description 必須被擋'
# 這就是實際線上的狀態：719/151，跟任何一個版本都對不上
expect_rc '線上實況 719/151 vs 實際 783/157' 1 \
  "iPAS 練習工具：719 題官方考古題 + 151 題加強練習${REAL_TAIL}" 783 157
expect_rc '主題庫數字錯（157 對）' 1 \
  "648 題主題庫 + 157 題加強練習" 783 157
expect_rc '加強練習數字錯（783 對）' 1 \
  "783 題主題庫 + 151 題加強練習" 783 157
expect_rc 'main 的數字（647/157）拿到 783 分支上比對' 1 \
  "647 題主題庫 + 157 題加強練習" 783 157

echo '── 缺少約定字樣 -> 擋（不能無聲放行）'
expect_rc '完全沒有題數字樣' 1 "iPAS 淨零碳規劃管理師練習工具" 783 157
expect_rc '只有主題庫、沒有加強練習' 1 "783 題主題庫" 783 157
expect_rc '寫成「題官方考古題」而非「題主題庫」' 1 \
  "783 題官方考古題 + 157 題加強練習" 783 157
expect_rc '空字串' 1 "" 783 157

echo '── 抽取器不得被 description 裡的其他數字騙到'
# ISO 14064 / Art.50 / S1/S2 都含數字。若抽取器只是「抓第一個數字」，這裡會炸。
got=$(extract_main_count "iPAS：ISO 14064、Art.50、783 題主題庫 + 157 題加強練習")
if [ "$got" = '783' ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf '  ✗ extract_main_count 被干擾數字騙到：期望 783 實得 %s\n' "${got:-<空>}"
fi
got=$(extract_pool_count "iPAS：ISO 14064、Art.50、783 題主題庫 + 157 題加強練習")
if [ "$got" = '157' ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf '  ✗ extract_pool_count 被干擾數字騙到：期望 157 實得 %s\n' "${got:-<空>}"
fi

echo
echo "通過 $pass 項，失敗 $fail 項"
[ "$fail" -eq 0 ] || exit 1
echo 'check-description 測試全部通過'
