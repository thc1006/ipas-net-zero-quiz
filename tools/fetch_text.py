# 抓取 + 正規化的**唯一一份**實作。
#
# 為什麼要抽出來：這段邏輯我已經寫過三次（verify_agent_quotes.py、writeback、一堆臨時腳本），
# 而**每一次複製都是一次漂移的機會**。這個 repo 已經被「兩份清單一定會漂」咬過：
#   - PRIMARY host 清單手抄一次 → 漏了 re100.org.tw
#   - sync_derived_counts.py 的「無來源」定義跟 gate 不一樣 → 275 vs 274
#
# 這一份把六個真的踩過的坑都固化在裡面。**不要再複製它，import 它。**

import html
import re
import ssl
import unicodedata
import urllib.request

_UA = 'Mozilla/5.0 (compatible; ipas-quiz-quote-verifier/1.0)'


def norm(t):
    """比對用的正規化：NFKC + 去掉所有標點/空白。

    ⚠️ **NFKC 是必要的**：這些中文 PDF 用 CJK 相容字 ——
    「理」可能是 U+F9E4 而不是 U+7406，「生態衝擊」用 str.find() 直接找會回 -1。

    ⚠️ **標點必須用 Unicode 類別剝，不可以手列**：
    我手列過一次，漏了 `'`(U+2019) 對上 `'`(U+0027)，害三筆真引文被判成捏造。

    ⚠️ **但絕對不可以剝 \\p{S}（符號）**：× ÷ + − = 都是符號，
    而題庫裡有公式題，四個選項的差別**只在運算子** —— 剝掉會塌成同一個字串。
    """
    t = unicodedata.normalize('NFKC', t or '')
    return ''.join(
        c for c in t
        if not (unicodedata.category(c)[0] in ('P', 'Z') or c.isspace())
    )


def _get(url, timeout=60):
    # ⚠️ `Accept-Encoding: identity` 是必要的。
    # icao.int 會回**壓縮過的 bytes**，而 urllib **不會自動解壓** ——
    # 於是我們拿到一坨亂碼，然後把一筆真的引文判成「查無此句（捏造）」。
    # 這又是一次「檢查器比資料還常出錯」：**亂碼不是「頁面上沒有這句話」。**
    req = urllib.request.Request(url, headers={
        'User-Agent': _UA,
        'Accept-Encoding': 'identity',
    })
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE   # 學術網站憑證鏈常不完整；抓不到頁面 != 捏造
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read(), (r.headers.get('Content-Type') or '').lower(), r.status


def _to_text(raw, ctype):
    """bytes -> 純文字。**PDF 只認 magic bytes，不認副檔名。**

    這是第 6 次「檢查器比資料還常出錯」：
    原本寫 `is_pdf = ... or url.endswith('.pdf')`。抓 unfccc.int/...07a01.pdf 時，
    伺服器回的是 **212 bytes 的 Incapsula 擋頁（Content-Type: text/html）**，
    但因為網址以 .pdf 結尾，程式照樣把那段 HTML 餵進 PyMuPDF ——
    **fitz 不會抱怨，它回一個「1 頁、0 個字」的文件**，接著搜 baseline 得到 0 次。

    **那個 0 是假的。** 不是「文件裡沒有」，是「我根本沒拿到文件」。
    副檔名是網址作者的宣告，不是伺服器實際給了什麼。
    """
    if raw[:5] == b'%PDF-':
        import fitz
        doc = fitz.open(stream=raw, filetype='pdf')
        return chr(10).join(p.get_text() for p in doc)

    txt = raw.decode('utf-8', errors='replace')
    txt = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>', ' ', txt, flags=re.I)
    return html.unescape(re.sub(r'<[^>]+>', ' ', txt))


# 少於這個字數就當「沒抓到」。
#
# ⚠️ 這條線的意義是「**我抓不到** ≠ **它捏造了**」。
# gist[322] 打過我的臉：unfccc.int 那一頁是 JS 渲染的，我只抓到 84 個字元，
# 於是「引文不在頁面上」—— 但那證明不了任何事，只證明我的抓取器壞了。
# 一個「抓不到就判有罪」的驗證器，會把每一個擋爬蟲的網站都變成偽造指控。
MIN_CHARS = 500


def fetch(url):
    """回傳 (text, resolved_url)。活站抓不到就改走 Wayback。

    text == '' 代表**抓失敗**，呼叫端必須把它當成「無法判斷」，
    **不可以**當成「頁面上沒有這句話」。
    """
    try:
        raw, ctype, _ = _get(url)
        txt = _to_text(raw, ctype)
        if len(norm(txt)) >= MIN_CHARS:
            return txt, url
    except Exception:
        pass

    # 擋爬／JS 渲染／404 —— 換一個地方讀**同一份文件**。這不是猜。
    snap = 'https://web.archive.org/web/2024id_/' + url
    try:
        raw, ctype, _ = _get(snap, timeout=90)
        txt = _to_text(raw, ctype)
        if len(norm(txt)) >= MIN_CHARS:
            return txt, snap
    except Exception:
        pass

    return '', url


def quote_status(quote, page_text):
    """引文與頁面的關係。**分三類，不是兩類。**

    gist[77] 打過我的臉：agent 引「檢驗測定機構未依第四十一條第一項取得許可證逕行檢驗測定，
    處新臺幣十萬元以上一百萬元以下罰鍰」，而真正的氣候法 §50 是
    「有下列情形之一者，處…罰鍰…：一、檢驗測定機構未依第四十一條第一項…」——
    **兩個片段都逐字存在，只是 agent 把順序對調了讓句子讀得順。**
    內容完全正確。判成「捏造」是**我的檢查器錯**，不是資料錯。

    回傳 'verbatim' | 'reordered' | 'absent'
    """
    pn, qn = norm(page_text), norm(quote)
    if not qn:
        return 'absent'
    if qn in pn:
        return 'verbatim'
    # 換行也要當切分點：agent 從 PDF 抄多行清單時，行與行之間可能夾著頁碼／頁首
    frags = [x for x in re.split(r'[、，。；：…\n\r]+|\.{3}', quote) if len(norm(x)) >= 8]
    if frags and all(norm(x) in pn for x in frags):
        return 'reordered'
    return 'absent'


def load_primary(path='quiz-app/src/utils/source-authority.ts'):
    """一手來源清單 —— **從 source-authority.ts 讀，不要手抄。**

    我手抄過一次，漏了 re100.org.tw；還有一次把 ipas.org.tw（考試的主辦單位！）
    判成「不是一手來源」。**兩份清單一定會漂。**
    """
    src = open(path, encoding='utf-8').read()
    block = src.split('export const PRIMARY')[1].split('];')[0]
    return tuple(re.findall(r"host:\s*'([^']+)'", block))


def is_primary(url, primary=None):
    primary = primary or load_primary()
    h = re.sub(r'^https?://', '', url or '').split('/')[0].lower()
    return any(h == p or h.endswith('.' + p) for p in primary)
