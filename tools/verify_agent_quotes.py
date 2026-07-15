#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""驗證 AI 代理交回來的引文 —— 把它引的 URL 抓回來，檢查那段話真的在上面。

## 為什麼這支工具存在

這個專案的 metadata 裡曾經有一整組「已查證」欄位，全部是 AI 自評：

  - 練習池 `provenance.verify_verdict = CONFIRMED`（155/157，驗證者 adversarial_subagent）
  - 主題庫 `metadata.verification_source = "research_agent"`（14 題）
  - 主題庫 `metadata.answer_verified = true`（**全部 773 題**）

拿法條原文逐條比對後，找到 13 個實質缺陷 —— **13 個當初全部被判 CONFIRMED**。

**AI 驗 AI 沒有用。** 所以派代理蒐證時，契約寫死：

  **代理只准交「一手來源 URL + 該頁面上的逐字引文」，不准交「判定」。**
  **判定由人做；引文由這支程式抓回原網頁逐字比對。**

第一輪 32 筆引文：代理**捏造了 1 筆**、引了 2 筆非一手來源 —— 全部被這支程式擋下。
第二輪把這件事寫進契約後，143 題 **0 筆捏造**。

## 這支工具自己踩過的坑（每一個都害我誤指代理捏造）

| 我的錯 | 後果 |
| --- | --- |
| 沒處理 PDF | 環境部盤查指引的**真引文**被判成捏造（政府 PDF 用 CID 內嵌字型，要 PyMuPDF） |
| 要求逐字「連續」 | 片段皆真、只是被重排的也判成捏造 |
| 抓不到內容就判有罪 | JS 渲染的頁面全部變成偽造指控 |
| **手列標點清單** | **`'`(U+0027) vs `’`(U+2019)** —— 直引號 vs 彎引號，3 筆真引文被判成捏造 |
| **手抄 PRIMARY 清單** | 把代理引用 **ipas.org.tw（考試主辦單位官網）** 判成「不是一手來源」 |

**每一次，錯的都是這個檢查器，不是資料。**

所以：
  - 正規化剝掉**所有** Unicode 標點類別（讓 Unicode 回答「什麼是標點」，不要手列）
  - PRIMARY 直接從 `source-authority.ts` 讀（**兩份清單一定會漂移**）
  - 分**三類**（逐字／重組／查無），不是有罪/無罪二分
  - **「我抓不到」≠「它捏造了」** —— 抓不到就回報抓不到，由人用別的方法複驗

用法：
    python tools/verify_agent_quotes.py <代理輸出的 res*.json 所在目錄>
"""

import json, sys, io, re, glob, collections, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ⚠️ **抓取／正規化／PRIMARY 清單一律 import，不要在這裡再寫第二份。**
#
# 「兩份實作一定會漂」在這個 repo 已經應驗過三次：
#   1. 量測腳本手抄 PRIMARY → 漏了 re100.org.tw
#   2. 這個檔案第一版手抄 → 把 **ipas.org.tw（這場考試的主辦單位！）** 判成「不是一手來源」
#   3. sync_derived_counts.py 的「無來源」定義跟 gate 不一樣 → 275 vs 274
#
# 底下這些坑全部固化在 fetch_text.py 裡了：
#   - PDF 只認 magic bytes（不認副檔名 —— Incapsula 擋頁會被 fitz 默默解成「0 字的 PDF」）
#   - 抓不到就走 Wayback（否則被擋的站永遠無法驗證）
#   - NFKC（中文 PDF 用 CJK 相容字）
#   - 引文分三類：逐字 / 重排但片段皆真 / 查無此句（不是兩類）
from fetch_text import fetch, load_primary, norm, quote_status   # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

S = (r'C:\Users\thc1006\AppData\Local\Temp\claude'
     r'\D--dev-06-june-exam\2a55d42b-3609-4580-be5d-18f505590582\scratchpad')
PRIMARY = load_primary()

ROUND = sys.argv[1] if len(sys.argv) > 1 else 'r3'
results = []
for f in sorted(glob.glob(f'{S}/{ROUND}/res*.json')):
    try:
        results += json.load(open(f, encoding='utf-8'))
    except Exception as e:
        print(f'!! 讀不到 {f}: {e}')

print(f'agents 交回 {len(results)} 題\n')
print('=' * 100)
print('引文機械驗證：把 agent 引的那個 URL 抓下來，檢查引文是否逐字存在')
print('=' * 100)

cache = {}
tally = collections.Counter()
rows = []
for r in results:
    qid = r.get('id')
    v = r.get('verdict')
    url = (r.get('source_url') or '').strip()
    quote = (r.get('quote') or '').strip()

    if v == 'NO_PRIMARY_SOURCE':
        tally['NO_PRIMARY_SOURCE'] += 1
        rows.append((qid, v, '—', '（誠實回報找不到 —— 這是正確的行為）'))
        continue

    if not url or not quote:
        tally['❌ 沒交來源或引文'] += 1
        rows.append((qid, v, '❌', '宣稱有結論，卻沒有 URL 或引文'))
        continue

    host = re.sub(r'^https?://', '', url).split('/')[0].lower()
    if not any(host == p or host.endswith('.' + p) for p in PRIMARY):
        tally['❌ 不是一手來源'] += 1
        rows.append((qid, v, '❌', f'{host} 不在一手來源清單裡'))
        continue

    if url not in cache:
        try:
            cache[url] = fetch(url)
        except Exception as e:
            cache[url] = (f'__FETCH_FAIL__{e}', url)
    page, via = cache[url]
    if page.startswith('__FETCH_FAIL__'):
        tally['⚠️ 抓不到頁面'] += 1
        rows.append((qid, v, '⚠️', f'抓不到：{page[14:60]}'))
        continue

    # 走了存檔才讀到 —— 引文仍然算數（是同一份文件），但要說出來源是哪裡讀到的
    archived = 'web.archive.org' in via

    pn = norm(page)
    qn = norm(quote)

    # ⚠️ **「我抓不到內容」不等於「它捏造了」。**
    #
    # gist[322] 打臉了我第二版：unfccc.int 那一頁是 JS 渲染的，我的抓取只拿到 84 個字元。
    # 頁面上什麼都沒有，於是「引文不在頁面上」——但那證明不了任何事，
    # 只證明**我的抓取器壞了**。
    #
    # （後來用 WebFetch 獨立確認：那一頁確實沒有那句話，agent 真的捏造了。
    #   但那是**另一個檢查**得出的結論，不是這一個。**兩者不能混為一談。**）
    #
    # 一個「抓不到就判有罪」的驗證器，會把每一個擋爬蟲的網站都變成偽造指控。
    if len(pn) < 500:
        tally['⚠️ 頁面抓不到內容（無法判斷，需人工／WebFetch 複驗）'] += 1
        rows.append((qid, v, '⚠️', f'{host} 只抓到 {len(pn)} 字（JS 渲染或擋爬）—— **無法判斷，不等於捏造**'))
        continue

    if qn in pn:
        tally[f'✅ 逐字連續存在 ({v})'] += 1
        where = f'{host}（活站擋爬，經 Wayback 存檔讀到）' if archived else host
        rows.append((qid, v, '✅', f'引文在 {where} 上逐字連續存在'))
        continue

    # ⚠️ 「不是連續原文」不等於「捏造」。
    #
    # gist[77] 打臉了我的第一版：agent 引「檢驗測定機構未依第四十一條第一項取得許可證
    # 逕行檢驗測定，處新臺幣十萬元以上一百萬元以下罰鍰」，而真正的氣候法 §50 是
    # 「有下列情形之一者，**處…罰鍰**，…：一、**檢驗測定機構未依第四十一條第一項…**」
    # —— **兩個片段都逐字存在，只是 agent 把順序對調了讓句子讀得順。**
    #
    # 內容完全正確。判成「捏造」是**我的檢查器錯**，不是資料錯。
    # 這是這一輪我第 N 次犯同一個錯：**斷言比資料還嚴格時，錯的是斷言。**
    #
    # 所以分三類，不是兩類：
    #   ✅ 逐字連續      —— 完全符合契約
    #   ⚙️ 重組但片段皆真 —— 內容可信，引用方式不合契約（要退回請 agent 修）
    #   🚨 片段查無此句   —— **真的捏造**
    # 換行也要當作切分點：agent 從 PDF 抄多行清單時，行與行之間可能夾著頁碼／頁首
    frags = [x for x in re.split(r'[、，。；：…\n\r]+|\.{3}', quote) if len(norm(x)) >= 8]
    if frags and all(norm(x) in pn for x in frags):
        tally[f'⚙️ 重組但每個片段都逐字存在 ({v})'] += 1
        rows.append((qid, v, '⚙️', f'{host}：片段皆真，但被重新排序（內容可信，引用方式不合契約）'))
        continue

    missing = [x for x in frags if norm(x) not in pn] or [quote]
    tally['🚨 引文查無此句（捏造）'] += 1
    rows.append((qid, v, '🚨', f'{host} 上**查無**：「{missing[0][:36]}…」 ← 捏造'))

for qid, v, mark, note in rows:
    print(f'  {mark} {str(qid):14} {str(v):18} {note}')

print('\n' + '=' * 100)
print('統計')
print('=' * 100)
for k, n in tally.most_common():
    print(f'  {k:34} {n:3}')

ver = lambda mark, v: sum(n for k, n in tally.items() if k.startswith(mark) and v in k)
sup = ver('✅','SUPPORTED') + ver('⚙️','SUPPORTED')
con = ver('✅','CONTRADICTED') + ver('⚙️','CONTRADICTED')
fab = tally['🚨 引文查無此句（捏造）']
nos = tally['NO_PRIMARY_SOURCE']
checked = sup + con
print()
if checked:
    print(f'  ▶ 引文通過機械驗證的題目：{checked} 題')
    print(f'      其中答案**正確**（SUPPORTED）：{sup}')
    print(f'      其中答案**錯誤**（CONTRADICTED）：{con}')
    print(f'      → 錯誤率 = {con}/{checked} = {con/checked*100:.1f}%')
print(f'  ▶ 找不到一手來源：{nos} 題（無從查證）')
if fab:
    print(f'  🚨 **agent 捏造了 {fab} 筆引文** —— 這正是為什麼不能相信 AI 的「判定」')
json.dump(rows, open(f'{S}/r2/quote_check.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
