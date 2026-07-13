# -*- coding: utf-8 -*-
"""驗證 agents 交回來的引文 —— 去把那個 URL 抓下來，檢查那段話真的在上面。

**這一步是整套設計的重點。** 沒有它，agents 交回來的東西跟
`research_agent` / `adversarial_subagent` 沒有任何差別 —— 都是「相信我」。

有了它，agent 的輸出變成**可證偽的**：捏造的引文會當場被抓出來。
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

def fetch(url):
    """抓下來轉成純文字。

    ⚠️ **必須處理 PDF。** agents 引的來源有好幾個是 PDF（環境部盤查作業指引、
    GHG Protocol Scope 3 指南）。如果只當 HTML 剝標籤，會抓到二進位亂碼，
    然後把**真的引文誤判成「捏造」** —— 那就是「檢查器比資料還常出錯」。

    而且這些政府 PDF 用 CID 內嵌中文字型，pdftotext 會吐出空白或亂碼；
    PyMuPDF (fitz) 能正確解碼。
    """
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; ipas-quiz-quote-verifier/1.0)'})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE   # 學術網站憑證鏈常不完整；抓不到頁面 != 捏造
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        raw = r.read()
        ctype = (r.headers.get('Content-Type') or '').lower()

    is_pdf = raw[:5] == b'%PDF-' or 'pdf' in ctype or url.lower().endswith('.pdf')
    if is_pdf:
        import fitz
        doc = fitz.open(stream=raw, filetype='pdf')
        return chr(10).join(p.get_text() for p in doc)

    txt = raw.decode('utf-8', errors='replace')
    txt = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>', ' ', txt, flags=re.I)
    txt = html.unescape(re.sub(r'<[^>]+>', ' ', txt))
    return txt

results = []
for f in sorted(glob.glob(f'{S}/r2/res*.json')):
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
            cache[url] = f'__FETCH_FAIL__{e}'
    page = cache[url]
    if page.startswith('__FETCH_FAIL__'):
        tally['⚠️ 抓不到頁面'] += 1
        rows.append((qid, v, '⚠️', f'抓不到：{page[14:60]}'))
        continue

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
        rows.append((qid, v, '✅', f'引文在 {host} 上逐字連續存在'))
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
