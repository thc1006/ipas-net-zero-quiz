#!/usr/bin/env bash
# GitHub 的 repo description（About）宣稱的題數，必須與實際資料一致。
#
# 為什麼需要這一支：
#
# About 不在 git 裡 —— 沒有任何測試看得到它。結果它長年寫著「719 題官方考古題 +
# 151 題加強練習」，而 main 的實際資料是 647 + 157、開發分支是 783 + 157：
# 這個數字跟**任何一個版本**都對不上，卻是所有訪客第一眼看到的東西。
# 沒有人發現，是因為根本沒有東西在看它。
#
# 同一個時期，README 也寫著 648（實際 647）—— 文件與資料各說各話。
# docs-counts.test.ts 已經把 README / CONTENT-CURRENCY 釘住了，但它只能讀 repo 裡的檔案。
# About 得靠 gh api 去拿，所以另外開這一支。
#
# 約定的寫法（description 必須包含這兩段，數字由本腳本驗證）：
#     ... <N> 題主題庫 ... <M> 題加強練習 ...
# 刻意要求固定字樣而不是「隨便抓數字」：description 裡還有 IFRS S1/S2、ISO 14064
# 這類含數字的詞，鬆散比對只會抓錯人。
#
# 用法：
#   check_description "<description>" <expected_main> <expected_pool>
#   -> exit 0 = 一致；exit 1 = 不一致（並在 stderr 說明哪裡不對）

# 從 description 取出「N 題主題庫」的 N。取不到就印空字串。
extract_main_count() {
  printf '%s' "${1:-}" | grep -oE '[0-9]+ *題主題庫' | grep -oE '[0-9]+' | head -1
}

# 從 description 取出「M 題加強練習」的 M。
extract_pool_count() {
  printf '%s' "${1:-}" | grep -oE '[0-9]+ *題加強練習' | grep -oE '[0-9]+' | head -1
}

check_description() {
  local desc="${1:-}"
  local want_main="${2:-}"
  local want_pool="${3:-}"
  local got_main got_pool rc=0

  got_main=$(extract_main_count "$desc")
  got_pool=$(extract_pool_count "$desc")

  if [ -z "$got_main" ]; then
    echo "✗ description 找不到「<N> 題主題庫」字樣。" >&2
    echo "  About 必須用這個固定寫法，否則沒辦法自動驗證它有沒有說謊。" >&2
    rc=1
  elif [ "$got_main" != "$want_main" ]; then
    echo "✗ 主題庫題數不符：About 寫 $got_main，實際資料是 $want_main" >&2
    rc=1
  fi

  if [ -z "$got_pool" ]; then
    echo "✗ description 找不到「<M> 題加強練習」字樣。" >&2
    rc=1
  elif [ "$got_pool" != "$want_pool" ]; then
    echo "✗ 加強練習題數不符：About 寫 $got_pool，實際資料是 $want_pool" >&2
    rc=1
  fi

  if [ "$rc" -eq 0 ]; then
    echo "✅ About 題數與資料一致：主題庫 $want_main、加強練習 $want_pool"
  else
    echo "" >&2
    echo "  修正方式：" >&2
    echo "    gh repo edit --description \"...${want_main} 題主題庫 + ${want_pool} 題加強練習...\"" >&2
    echo "" >&2
    echo "  提醒：About 曾經寫「N 題官方考古題」——「主題庫」並不全是官方考古題" >&2
    echo "  （含 our_unique_items），那個講法本身就過度宣稱。" >&2
  fi
  return "$rc"
}

# 允許直接執行
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_description "$@"
fi
