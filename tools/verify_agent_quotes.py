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

import json, sys, io, re, html, glob, unicodedata, urllib.request, collections, ssl
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

S = r'C:\Users\thc1006\AppData\Local\Temp\claude\D--dev-06-june-exam\2a55d42b-3609-4580-be5d-18f505590582\scratchpad'

# ⚠️ **不要手抄這份清單。**
#
# 我已經抄錯三次了：
#   1. 上一輪的量測腳本手抄 PRIMARY，漏了 re100.org.tw
#   2. 這個檔案第一版手抄，漏了 ipas.org.tw / ecovadis.com / iea.org / trec.org.tw…
#      —— 於是把 agent 引用 **iPAS 官方網站**（ipas.org.tw，這場考試的主辦單位！）
#      判成「不是一手來源」。
#
# **兩份清單一定會漂移。** 直接從 source-authority.ts 讀 —— 那是唯一的真相來源。
def _load_primary():
    src = open('quiz-app/src/utils/source-authority.ts', encoding='utf-8').read()
    block = src.split('export const PRIMARY')[1].split('];')[0]
    return tuple(re.findall(r"host:\s*'([^']+)'", block))

PRIMARY = _load_primary()

def norm(t):
    """逐字比對前的正規化。

    ⚠️ **不要手列標點清單。** 我第一版手列了 `、，。；：（）「」…` 這一串，
    結果漏了 **`'`（U+0027 直引號）vs `’`（U+2019 彎引號）** ——
    agent 把 SBTi PDF 裡的彎引號抄成直引號，我就把一筆**真的引文判成捏造**。

    那是我在這個 pilot 裡第四次「檢查器比資料還常出錯」：
      1. 沒處理 PDF          → 會把環境部指引的真引文判成捏造
      2. 要求逐字「連續」     → 片段皆真、只是被重排的也判成捏造
      3. 抓不到內容就判有罪   → JS 渲染的頁面全部變成偽造指控
      4. **手列標點清單**     → 直引號 vs 彎引號就爆掉

    改成剝掉**所有** Unicode 標點（P*）與分隔符（Z*）—— 讓 Unicode 自己回答
    「什麼是標點」，不要我來列。

    （注意這裡可以剝符號類，因為我們比對的是「引文在不在頁面上」；
      主題庫的**重複偵測**則絕對不能剝 \\p{S} —— 公式題的選項只差在運算子。
      兩者的取捨不同，不要混用同一個 norm。）
    """
    t = unicodedata.normalize('NFKC', t or '')
    return ''.join(
        c for c in t
        if not (unicodedata.category(c)[0] in ('P', 'Z') or c.isspace())
    )

def _get(url):
    """抓一次，回傳 (raw_bytes, content_type)。"""
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; ipas-quiz-quote-verifier/1.0)'})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE   # 學術網站憑證鏈常不完整；抓不到頁面 != 捏造
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        return r.read(), (r.headers.get('Content-Type') or '').lower()


def _to_text(raw, ctype):
    """把 bytes 轉純文字。**PDF 只認內容，不認副檔名。**

    第 6 個「檢查器比資料還常出錯」：
    原本這裡寫 `is_pdf = ... or url.endswith('.pdf')`。
    於是抓 `unfccc.int/.../07a01.pdf` 時，伺服器回的是一個 **212 bytes 的
    Incapsula 擋頁（Content-Type: text/html）**，但因為網址以 .pdf 結尾，
    程式照樣把那段 HTML 餵進 PyMuPDF —— fitz 不會抱怨，它回一個
    **「1 頁、0 個字」的文件**。接著搜尋 baseline 得到 0 次。

    **那個 0 是假的。** 它不是「文件裡沒有」，是「我根本沒拿到文件」。
    副檔名是網址作者的宣告，不是伺服器實際給了什麼 —— 只信真正的 magic bytes。
    """
    if raw[:5] == b'%PDF-' or ('pdf' in ctype and raw[:5] != b'<html'):
        import fitz
        doc = fitz.open(stream=raw, filetype='pdf')
        return chr(10).join(p.get_text() for p in doc)

    txt = raw.decode('utf-8', errors='replace')
    txt = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>', ' ', txt, flags=re.I)
    txt = html.unescape(re.sub(r'<[^>]+>', ' ', txt))
    return txt


def fetch(url):
    """抓下來轉成純文字，抓不到就改走 Wayback Machine。

    ⚠️ **必須處理 PDF。** agents 引的來源有好幾個是 PDF（環境部盤查作業指引、
    GHG Protocol Scope 3 指南）。如果只當 HTML 剝標籤，會抓到二進位亂碼，
    然後把**真的引文誤判成「捏造」** —— 那就是「檢查器比資料還常出錯」。
    而且這些政府 PDF 用 CID 內嵌中文字型，pdftotext 會吐出空白或亂碼；
    PyMuPDF (fitz) 能正確解碼。

    ⚠️ **而且必須處理「被擋」。** unfccc.int 有 Incapsula、
    sciencebasedtargets.org 有 Cloudflare —— 直接抓只會拿到擋頁。
    只回報「⚠️ 抓不到」雖然誠實（不會誣賴 agent 捏造），但那是**死路**：
    這些站的引文將**永遠無法被確認**，等於這個驗證器對它們沒有作用。
    契約已經要求 agent 用 web.archive.org，驗證器就必須跟得上去同一個地方查。
    """
    try:
        raw, ctype = _get(url)
        txt = _to_text(raw, ctype)
        if len(norm(txt)) >= 500:
            return txt, url
    except Exception:
        pass

    # 活站抓不到（擋爬／JS 渲染／404）—— 改抓存檔。**這不是猜，是換一個地方讀同一份文件。**
    snap = 'https://web.archive.org/web/2024id_/' + url
    try:
        raw, ctype = _get(snap)
        return _to_text(raw, ctype), snap
    except Exception:
        return '', url

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
