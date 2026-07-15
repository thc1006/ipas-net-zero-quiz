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
    """比對用的正規化：NFKC + 去掉標點、空白、項目符號、私用區字元。

    ⚠️ **NFKC 是必要的**：這些中文 PDF 用 CJK 相容字 ——
    「理」可能是 U+F9E4 而不是 U+7406，「生態衝擊」用 str.find() 直接找會回 -1。

    ⚠️ **標點必須用 Unicode 類別剝，不可以手列**：
    我手列過一次，漏了 `'`(U+2019) 對上 `'`(U+0027)，害三筆真引文被判成捏造。

    ⚠️ **項目符號與私用區必須剝。**
    第七輪 `gist[169]` 的引文「確定宣告或標示單位**◼**常使用產品銷售單位」被判成「捏造」——
    但 `◼` 是那份投影片 PDF 的**項目符號**，而 PDF 內嵌字型常把它存成
    **私用區字元**（U+F06E 之類）。兩邊長得一樣、位元不同 → 對不上 → **我誣賴了一筆真引文**。

    ⚠️ **但絕對不可以整片剝 Sm（數學符號）**：× ÷ + − = 都是 Sm，
    而題庫裡有公式題，四個選項的差別**只在運算子** —— 剝掉會塌成同一個字串。

    ⚠️ 而這正是我第一次修錯的地方：我以為項目符號是 `So`，就寫「剝 So、保留 Sm」——
    **但 `◼`(U+25FC) 的類別偏偏是 `Sm`**，於是修法完全打不到它，`gist[169]` 還是紅的。
    「我猜這個字是什麼類別」再一次比資料本身更常出錯。

    所以判準要用**區段**、不要用類別猜：剝掉
      - **幾何圖形區 U+25A0–U+25FF**（■ ◆ ▲ ● ◼ ▪ —— 這些 PDF 的項目符號全在這裡）
      - **So**（其他符號）與 **Co**（私用區）
    而 **× ÷ = − + 不在幾何圖形區、類別是 Sm，全部保留。**

    （去重用的正規化是另一回事 —— 那邊連 So 都不能剝。判準要跟著用途走。）
    """
    t = unicodedata.normalize('NFKC', t or '')
    out = []
    for c in t:
        cat = unicodedata.category(c)
        if cat[0] in ('P', 'Z') or c.isspace():
            continue
        if cat in ('So', 'Co'):          # 其他符號、私用區 —— 剝
            continue
        if 0x25A0 <= ord(c) <= 0x25FF:   # 幾何圖形區（含被歸成 Sm 的 ◼）—— 剝
            continue
        out.append(c)                    # × ÷ = − + 留著
    return ''.join(out)


def _get(url, timeout=60):
    """抓回 (bytes, content-type, status)。**壓縮一定要自己解。**

    第一版寫 `Accept-Encoding: identity`，理由是 icao.int 會回壓縮 bytes 而
    urllib **不會自動解壓** —— 拿到一坨亂碼，然後把真引文判成「捏造」。

    ⚠️ 但那個修法只是**請求**對方不要壓縮，而 **web.archive.org 根本不理**：
       它照樣回 gzip。於是亂碼又回來了 —— 而且這次更陰險，因為
       **一坨亂碼的字元數輕鬆超過 MIN_CHARS**，守衛放它過關，
       接著「loss and damage 出現 0 次」。**那個 0 是假的。**

    → 正解：**大方接受壓縮，然後照 `Content-Encoding` 自己解。**
      不要去求伺服器配合，要讓自己有能力處理它給的東西。
    """
    req = urllib.request.Request(url, headers={
        'User-Agent': _UA,
        'Accept-Encoding': 'gzip, deflate',
    })
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE   # 學術網站憑證鏈常不完整；抓不到頁面 != 捏造
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        raw = r.read()
        enc = (r.headers.get('Content-Encoding') or '').lower()
        if 'gzip' in enc or raw[:2] == b'\x1f\x8b':      # 也認 magic bytes：標頭會說謊
            import gzip
            raw = gzip.decompress(raw)
        elif 'deflate' in enc:
            import zlib
            try:
                raw = zlib.decompress(raw)
            except zlib.error:
                raw = zlib.decompress(raw, -zlib.MAX_WBITS)   # raw deflate（無 zlib 標頭）
        return raw, (r.headers.get('Content-Type') or '').lower(), r.status


def _readable(t):
    """這段文字是**人看得懂的**，還是解壓失敗後的亂碼？

    ⚠️ 這個守衛是必要的，`MIN_CHARS` 擋不住它 ——
    一坨 gzip 亂碼 decode('utf-8', errors='replace') 之後，
    字元數輕鬆上萬，於是「頁面很長」而「關鍵詞 0 次」。
    **那不是「頁面上沒有」，那是我根本沒解開它。**
    """
    if not t:
        return False
    bad = t.count('�')                       # decode 失敗留下的替換字元
    return bad / max(len(t), 1) < 0.02


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
        if len(norm(txt)) >= MIN_CHARS and _readable(txt):
            return txt, url
    except Exception:
        pass

    # 擋爬／JS 渲染／404 —— 換一個地方讀**同一份文件**。這不是猜。
    snap = 'https://web.archive.org/web/2024id_/' + url
    try:
        raw, ctype, _ = _get(snap, timeout=90)
        txt = _to_text(raw, ctype)
        if len(norm(txt)) >= MIN_CHARS and _readable(txt):
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

    ⚠️ 第七輪 `gist[520]` 差點被我當成捏造：代理引
    「…排放量削減29% 再生能源:裝置容量自9.6GW…」，而投影片原文在這兩句
    **中間夾了一行標題**「2030 NDC 五大強化關鍵作為」。代理跨過標題把兩段接起來 ——
    兩段都逐字存在，但我當初只切**中文標點**，接縫落在片段**內部**，於是判成 'absent'。
    **那不是捏造，是拼接。** 而那一題裡藏著一個真的錯答案（B→C），
    我差點因為自己的檢查器而把它丟掉。

    ⚠️ 修法**不可以是「連空白一起切」**。中文很少用空白，英文卻是**每個字都用空白分隔** ——
    切下去之後 "Commission"、"published" 這種常見字各自都在頁面上，
    於是一句**捏造的英文**會被判成「拼接」。**那會開一個比原本更大的洞。**

    所以改用一個**中英都成立**的判準：把引文**貪婪拆成「頁面上的逐字連續段」**。
      - 段數少、每段夠長  → 'reordered'（作者跨過頁首/標題把原文接起來，內容是真的）
      - 拆不動、或碎成一堆短段 → 'absent'（真的捏造）
    一句捏造的話沒辦法用少數幾段長的原文拼出來。

    回傳 'verbatim' | 'reordered' | 'absent'
    """
    pn, qn = norm(page_text), norm(quote)
    if not qn:
        return 'absent'
    if qn in pn:
        return 'verbatim'
    return 'reordered' if _splice_runs(qn, pn) is not None else 'absent'


_MIN_RUN = 12   # 一段「逐字連續」至少要這麼長才算數（短於此的巧合太廉價）
_MAX_RUNS = 4   # 最多允許接幾段（跨一兩個頁首/標題是合理的；接五段以上是在拼貼）


def _splice_runs(qn, pn):
    """把 qn 貪婪拆成 pn 裡的逐字連續段。回傳段數；拆不成就回 None。"""
    i, runs = 0, 0
    while i < len(qn):
        lo, hi = 0, len(qn) - i          # 二分找「還在頁面上」的最長前綴
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if qn[i:i + mid] in pn:
                lo = mid
            else:
                hi = mid - 1
        # 只有「剛好收尾」的最後一段可以短於門檻
        if lo == 0 or (lo < _MIN_RUN and i + lo < len(qn)):
            return None
        i += lo
        runs += 1
        if runs > _MAX_RUNS:
            return None
    return runs


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
