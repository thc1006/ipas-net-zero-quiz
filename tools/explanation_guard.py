# 反捏造閘門：**新寫的解析裡，每一個「可查證的斷言」都必須已經出現在引文或題目裡。**
#
# 為什麼非有不可 —— 這是這一輪血淋淋換來的：
#   練習池的 AI 產題，**答案幾乎全對，但題幹裡的引註是捏造的**：
#     「年報準則 §10-4」    → 該準則全文中「第 10-4 條」出現 **0 次**
#     「IFRS S2 Appendix B」→ 該附錄沒有衡量不確定性條款
#     「金管會路徑圖 2.0」   → 查無此文件
#   **大方向對，細節捏造。** 這是 LLM 的典型病。
#
# 主題庫有 393 題「有經機械驗證的逐字引文、但沒有解析」。要補解析，
# **就是開 393 個捏造條號的機會** —— 除非**擋它的不是契約，而是程式**。
#
# 判準：解析裡的**條號／標準編號／數字**，必須都能在
#   （引文 + 題幹 + 選項 + 已通過查核的舊解析）裡找到。找不到 → 退件。
#
# 這道閘門**不保證解析是對的** —— 它只保證解析**沒有無中生有**。
#    兩件事不要混為一談。

import re
import unicodedata

# 「可查證的斷言」—— 這些東西一旦寫錯，使用者背起來就會在考場上出錯
CLAIM = [
    # 條號可以帶點或連字號（「第 6.2 條」「第 10-4 條」）：以前遇到點或連字號整個抽不到，等於沒有檢查
    (r'第\s*[0-9０-９一二三四五六七八九十百]+(?:\s*[-\u2013.]\s*[0-9]+)*\s*[條項款目]', '條號'),
    # 節（#148）：「依 ISO 14064-1 第 8.3 節」以前整句通過，CLAIM 只認條／項／款／目。
    # 節號多半帶點（8.3、11.2），沒有「第」字的「8.3 節」與附錄的「B.2.19 節」也算
    (r'第\s*[0-9０-９一二三四五六七八九十百]+(?:\s*[.]\s*[0-9]+)*\s*節', '節號'),
    (r'(?:[A-Z]\.)?[0-9]+(?:\.[0-9]+)+\s*節', '節號'),
    (r'§\s*[0-9]+(?:[-–.][0-9]+)*', '條號(§)'),
    (r'(?:Article|Art\.|Para\.?|Section|Clause)\s*[0-9]+(?:\.[0-9]+)*', '條號(英)'),
    (r'ISO\s*[0-9]{4,5}(?:[-–][0-9]+)?', '標準編號'),
    (r'IFRS\s*S[0-9]', '標準編號'),
    (r'PAS\s*[0-9]{4}', '標準編號'),
    (r'(?:EU|EC)\s*[0-9]{4}/[0-9]{2,4}', '法規編號'),
    # 附錄／附件也要擋 —— 練習池那筆真實捏造就是「IFRS S2 之 **Appendix B**」
    #    （S2 的 Appendix B 是應用指引，**沒有**衡量不確定性條款）。
    (r'(?:Appendix|Annex)\s*[A-Z0-9]+', '附錄'),
    (r'附[錄件表]\s*[一二三四五六七八九十0-9A-Z]+', '附錄'),
    (r'[0-9]+(?:\.[0-9]+)?\s*%', '百分比'),
    (r'(?:19|20)[0-9]{2}\s*年?', '年份'),
    (r'[0-9][0-9,\.]*\s*(?:公噸|噸|萬|億|元|GW|MW|kg|tCO2e|公斤)', '數量'),
]

# 只有這幾類可以走「數字寬容」（「2015年」對上引文裡的「2015」不該算捏造）。
# **條號／標準編號／附錄不可以走寬容。**
#    第一版讓它們也走，結果「IFRS S2」的數字部分被抽成「2」，
#    而「2」在任何題目裡都找得到 —— **一個「只要有個 2 就算數」的寬容，等於沒有閘門。**
NUMERIC_OK = ('年份', '百分比', '數量')

# § 條號與英文條號比對時不能只是子字串：「Section 8.3」不在「Section 8.31」或「Section 8.3.1」裡，結尾後面不能緊接
# 數字或「點加數字」。比對的是保留空白的引文：「Article 6 1. Parties」的 6 後面隔著空白，不是 61。
# 帶點的節號另外只比節號本身（見 check），前後都看邊界；沒有點的「第 5 節」要原文寫著，只比數字的話「5」到處都找得到。
# 「第N條」「第N節」前後都是字，不必另看邊界。
BOUNDED = ('條號(§)', '條號(英)')


def _n(t):
    """比對用：NFKC + 去空白 + 全形數字轉半形。"""
    t = unicodedata.normalize('NFKC', t or '')
    return re.sub(r'\s+', '', t)


def claims(text):
    """抽出解析裡所有「可查證的斷言」。"""
    t = _n(text)
    out = []
    for pat, kind in CLAIM:
        for m in re.finditer(pat, t, re.I):
            out.append((kind, m.group(0)))
    return out


def _spaced_pattern(claim):
    """去掉空白的斷言 → 比對保留空白的引文用的 regex。字與字之間可以有空白（「Article 6」「§ 6.3」「Art. 6」），
    同一個號碼（「61」「6.3」）裡面不行：引文「Article 6 1.」裡沒有 Article 61，「§ 6 .3」裡也沒有 §6.3。"""
    inside = set()
    for m in re.finditer(r'[0-9]+(?:\.[0-9]+)*', claim):
        inside.update(range(m.start() + 1, m.end()))
    return ''.join(('' if k == 0 or k in inside else r'\s*') + re.escape(ch) for k, ch in enumerate(claim))


# 帶點的數字後面接這些，就是數量，不是節號（「2.5kgCO₂e」「8.3%」「4.2 億公噸」）
_QUANTITY_AFTER = re.compile(r'\s*(?:%|億|萬|千|百|兆|公噸|噸|公斤|公升|公尺|公里|度|元|倍|年|個|項|次|人|家|°|kg|g(?![a-z])'
                             r'|t(?![a-z])|kWh|MWh|GWh|kW|MW|GW|L(?![a-z])|m(?![a-z]))')
# 帶點的數字前面是這些，才像節號：引文或其中一行、一句的開頭，Section／Clause／§／節之後，
# 兩個以上大寫字母開頭、接數字的編號後面隔一個空白（「ISO 14064-1:2018 9.3.1」；「CO2 2.5」「TABLE 3 8.3」也算，
# 「Table 3 8.3」不算）。「第 3.2」不算：後面接「節」才是節號（另外看），接「條」「款」就不是。
# 已知的限制：單位只認上面那張清單，沒列到的（ppm、mm、小時、美元，或接著 ± 與範圍）在句首、行首時照樣算節號的位置；
# 節號的位置只認這幾種，「ISO 14064-1:2018, 5.2」「附錄 B.2.19」「（9.3.1）」「see 4.2.3」這些寫法找不到出處，
# 要換寫法或補一則引文。
_SECTION_BEFORE = re.compile(r'(?:^|\n|[。！？.!?]|(?i:Section|Clause)|[§節]|[A-Z]{2,}[\s-]*[0-9][0-9:-]*\s)\s*$')


def _section_number_in(number, texts):
    """帶點的節號（「3.2.4」）有沒有以節號的樣子出現在其中一段引文裡（見 _SECTION_BEFORE；後面接「節」也算），
    而且整個對得上（前面不緊接英數字或點，後面不緊接數字或「點加數字」）、後面不是單位。"""
    pattern = re.compile(r'(?<![0-9A-Za-z.])' + re.escape(number) + r'(?![0-9]|\.[0-9])')
    for text in texts:
        t = unicodedata.normalize('NFKC', text)
        for m in pattern.finditer(t):
            after = t[m.end():]
            if _QUANTITY_AFTER.match(after):
                continue
            if re.match(r'\s*節', after) or _SECTION_BEFORE.search(t[:m.start()]):
                return True
    return False


def check(explanation, allowed_texts):
    """回傳 [(類別, 斷言)] —— **在允許的來源裡找不到的**斷言。空清單 = 通過。

    allowed_texts：引文、題幹、選項、（若有）已通過查核的舊解析。
    """
    joined = ' '.join(x for x in allowed_texts if x)
    hay = _n(joined)
    spaced = unicodedata.normalize('NFKC', joined)  # 邊界要在保留空白的文字上看
    bad = []
    for kind, c in claims(explanation):
        number = re.sub(r'^第|節$', '', _n(c)) if kind == '節號' else ''
        if '.' in number:
            # 帶點的節號：英文來源（GUM、ISO）只寫「3.2.4」不寫「節」，引文裡有同一個節號、而且是在節號的位置就算有出處，
            # 「第」也不必有。「2.5kgCO₂e」「8.3%」這種數量不算（見 _section_number_in）
            if _section_number_in(number, [x for x in allowed_texts if x]):
                continue
            bad.append((kind, c))
            continue
        if kind in BOUNDED:
            if re.search(_spaced_pattern(_n(c)) + r'(?![0-9]|\.[0-9])', spaced):
                continue
        elif _n(c) in hay:
            continue
        if kind in NUMERIC_OK:
            # 「2015年」vs 引文裡的「2015」、「5.2%」vs「5.2」—— 不該當成捏造。
            # 但數字至少要 2 位，否則「2」到處都找得到。
            num = re.sub(r'[^0-9.]', '', _n(c))
            if len(num) >= 2 and num in hay:
                continue
        bad.append((kind, c))
    return bad
