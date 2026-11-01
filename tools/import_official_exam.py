"""把 iPAS 官方公告試題匯入主題庫（integrated_dataset.json 的 our_unique_items）。

用法（repo 根目錄）：
    uv run --locked --project tools python tools/import_official_exam.py <來源代號> ... [--cache 目錄]
    uv run --locked --project tools python tools/restore_from_source_pdf.py --emit [--cache 目錄]
    cd quiz-app && pnpm preflight        # 同步題庫的衍生統計（meta）與文件數字，並跑所有 gate

來源（網址、sha256、場次、考試日期、科目）登記在 restore_from_source_pdf.py 的 SOURCES（kind 為
official_exam）；題目由 ipas_exam_pdf.py 從 PDF 擷取。這支只負責把擷取結果寫成題庫的題目：
  - 題幹、選項、答案照 PDF；
  - 標上 official_exam（場次、考試日期、科目、題號）；
  - PDF 首頁註明「試題參考答案以該次考試公告時之法規內容為準」，所以每一題都標時效
    （quality_flags: time_sensitive），查證日期（metadata.valid_as_of）就是考試日期；
  - 答案依據是官方題目本身與它的答案欄；個別題目另有一手依據（例如題幹點名的法條）時，
    登記在 EXTRA_EVIDENCE，排在前面。
  - 登記為圖表題的（SOURCES 的 figure_questions：題目要讀圖、題庫還不支援圖片）照常擷取、核對，但不寫進題庫；
    manifest 記為 not_imported_figure 並寫明理由。
已經在題庫裡的題目（重新匯入時）：
  - 題幹、選項、答案、考科或 official_exam 與這次擷取的結果不同就中止 —— 來源 PDF 變了要先查清楚，
    題庫被改過就要先還原；
  - 解析由 EXTRA_EXPLANATIONS 帶進來（metadata.explanation_source 帶 generated_by 標記），重新匯入時換成表上
    的版本、從表上拿掉就拿掉；人工寫的解析不覆寫；
  - 工具負責的引文（官方題目本身與 EXTRA_EVIDENCE，每一則都帶 generated_by 標記）整批換成這次建出來的
    版本：改了、加了、從表上拿掉了 EXTRA_EVIDENCE，重新匯入就會生效；被手改的也換回工具建出來的版本；
  - metadata.sources 以工具的網址開頭；工具的引文帶進來、這次不再需要的網址一併拿掉，除非還有人工的
    引文用它（sources 沒有歸屬標記，所以用引文來判斷：人工另外列在 sources、剛好與工具引文同網址的，
    也會被當成工具帶進來的）；
  - 其他的（之後補上的解析、標籤、另外附的引文 —— 即使網址與工具的引文相同 —— 以及人工另外列的網址）
    照原樣保留。
題庫裡工具負責的部分被手改時，tools/tests/test_official_exam_import.py 的
test_the_bank_holds_what_the_importer_builds 拿擷取快照重建每一題、逐欄比對而轉紅。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import explanation_guard
import ipas_exam_pdf
import restore_from_source_pdf as R
from restore_from_source_pdf import load_pdf

DATASET = R.DATASET
OWNED = ('stem', 'options', 'answer', 'exam_subject', 'official_exam')  # 匯入工具負責、不准被別處改掉的欄位
SUBJECT_LABEL = {'L11': '第一科', 'L12': '第二科'}
GENERATED_BY = 'tools/import_official_exam.py'  # 工具建出來的引文都帶這個標記；重新匯入時只換帶標記的
ORDINAL = '一二三四五六七八九十'  # 第十一次起寫阿拉伯數字（題卡的標籤也是這樣寫）

# 個別題目的額外一手依據（排在官方題目之前）。每一筆都必須支持官方答案。
# 鍵：(來源代號, 題號)。法條（全國法規資料庫的網址）要寫 clause，由 law_evidence_problems 對照
# law-articles.pinned.json 的釘選條文核對：法規要已釘選、網址的 flno 與 clause 是同一條、引文逐字在那一條裡
# （匯入時與 CI 的工具測試都跑）。
GUM = 'https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf'  # JCGM 100:2008（GUM）
EXTRA_EVIDENCE: dict[tuple[str, int], list[dict]] = {
    # 題幹點名的條文本身就寫著答案（引文與 law-articles.pinned.json 的釘選條文逐字相同）
    ('S_IPAS_115_01_L12', 17): [{
        'url': 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=O0020102&flno=4',
        'quote': '依前項排放係數法計算燃料燃燒產生之排放量，應以燃料用量乘以低位熱值及係數。',
        'supports_option': 'C',
        'clause': '第4條',
    }],
    ('S_IPAS_115_01_L12', 32): [{
        'url': 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=O0020098&flno=37',
        'quote': '應於指定期限內向中央主管機關申請核定碳足跡，經中央主管機關審查、查驗及核算後核定之，'
                 '並於規定期限內依核定內容使用及分級標示於產品之容器或外包裝。',
        'supports_option': 'B',
        'clause': '第37條',
    }],
    # 《巴黎協定》第 6 條：UNFCCC 現行的官方出版本（2026-09-28 下載，sha256 9c19b811a9e346bc532de9c64430494776dc4348
    # 04d84cb48ad1ceacb66c884e；先前引的 english_paris_agreement.pdf 已從網站移除）。引文從條標「Article 6」
    # 起引到第 2 項（引文取 PDF 文字層、空白合併為一個）：題幹點名的「第六條」由條標綁住。
    ('S_IPAS_115_01_L11', 18): [{
        'url': 'https://unfccc.int/sites/default/files/resource/parisagreement_publication.pdf',
        'quote': ('Article 6 1. Parties recognize that some Parties choose to pursue voluntary cooperation in '
                  'the implementation of their nationally determined contributions to allow for higher ambition'
                  ' in their mitigation and adaptation actions and to promote sustainable development and '
                  'environmental integrity. 2. Parties shall, where engaging on a voluntary basis in '
                  'cooperative approaches that involve the use of internationally transferred mitigation '
                  'outcomes towards nationally determined contributions, promote sustainable development and '
                  'ensure environmental integrity and transparency'),
        'supports_option': 'C',
        'clause': 'Article 6',
        'note': '《巴黎協定》第 6 條第 1、2 項：締約方以自願合作的方式，使用國際轉讓減緩成果（ITMOs）'
                '來達成國家自定貢獻。',
    }],
    ('S_IPAS_115_02_L11', 17): [{
        'url': 'https://unfccc.int/sites/default/files/resource/parisagreement_publication.pdf',
        'quote': ('Article 6 1. Parties recognize that some Parties choose to pursue voluntary cooperation in the '
                  'implementation of their nationally determined contributions to allow for higher ambition in '
                  'their mitigation and adaptation actions and to promote sustainable development and environmental '
                  'integrity. 2. Parties shall, where engaging on a voluntary basis in cooperative approaches that '
                  'involve the use of internationally transferred mitigation outcomes towards nationally determined '
                  'contributions, promote sustainable development and ensure environmental integrity and '
                  'transparency, including in governance, and shall apply robust accounting to ensure, inter alia, '
                  'the avoidance of double counting, consistent with guidance adopted by the Conference of the '
                  'Parties serving as the meeting of the Parties to this Agreement. 3. The use of internationally '
                  'transferred mitigation outcomes to achieve nationally determined contributions under this '
                  'Agreement shall be voluntary and authorized by participating Parties.'),
        'supports_option': 'B',
        'clause': 'Article 6',
        'note': '《巴黎協定》第 6 條第 2 項：以國際轉讓減緩成果達成國家自定貢獻時，要以健全的核算確保避免重複計算；'
                '第 3 項：這種使用須出於自願，並經參與的締約方授權。',
    }],
    # #148：學員回報這一題「先說答案是 D、後來說是 B」。答案照 PDF 是 B，題庫原本只有官方題目本身這一則依據。
    # 量測的誤差、修正與不確定性用 JCGM 100:2008（GUM；BIPM 網站上的免費全文，2026-11-01 下載）：題幹的
    # ISO 14064-1 沒有公開全文，GUM 是這兩個詞的通用定義。溫管辦法（已釘選）放在最後：第 2 條第 6 款是「查驗」的
    # 定義，第 9 條是查驗結果與原登錄資料不一致時，由事業上傳修正後的清冊。兩條都只撐解析的最後一句。
    ('S_IPAS_115_01_L12', 6): [
        {
            'url': GUM,
            'quote': 'B.2.19 error (of measurement) result of a measurement minus a true value of the measurand',
            'supports_option': 'B',
            'note': 'JCGM 100:2008 附錄 B.2.19：誤差是量測結果減去被測量的真值。',
        },
        {
            'url': GUM,
            'quote': '3.2.3 Systematic error, like random error, cannot be eliminated but it too can often be reduced. '
                     'If a systematic error arises from a recognized effect of an influence quantity on a measurement '
                     'result, hereafter termed a systematic effect, the effect can be quantified and, if it is '
                     'significant in size relative to the required accuracy of the measurement, a correction (B.2.23) '
                     'or correction factor (B.2.24) can be applied to compensate for the effect. It is assumed that, '
                     'after correction, the expectation or expected value of the error arising from a systematic '
                     'effect is zero.',
            'supports_option': 'B',
            'note': 'JCGM 100:2008 第 3.2.3 節：系統誤差和隨機誤差一樣無法完全消除，但常可減小；已知的系統效應可以'
                    '量化，用修正值或修正因子補償。',
        },
        {
            'url': GUM,
            'quote': '3.2.4 It is assumed that the result of a measurement has been corrected for all recognized '
                     'significant systematic effects and that every effort has been made to identify such effects.',
            'supports_option': 'B',
            'note': 'JCGM 100:2008 第 3.2.4 節：評估不確定性時，假設量測結果已針對所有已知的顯著系統效應修正。',
        },
        {
            'url': GUM,
            'quote': '3.2.2 Random error presumably arises from unpredictable or stochastic temporal and spatial '
                     'variations of influence quantities. The effects of such variations, hereafter termed random '
                     'effects, give rise to variations in repeated observations of the measurand. Although it is not '
                     'possible to compensate for the random error of a measurement result, it can usually be reduced '
                     'by increasing the number of observations; its expectation or expected value (C.2.9, C.3.1) is '
                     'zero.',
            'supports_option': 'B',
            'note': 'JCGM 100:2008 第 3.2.2 節：隨機誤差無法補償，通常可以增加觀測次數來減小。',
        },
        {
            'url': GUM,
            'quote': 'B.2.18 uncertainty (of measurement) parameter, associated with the result of a measurement, that '
                     'characterizes the dispersion of the values that could reasonably be attributed to the measurand',
            'supports_option': 'B',
            'note': 'JCGM 100:2008 附錄 B.2.18：不確定性是表示可合理歸屬於被測量的值的分散程度的參數。',
        },
        {
            'url': GUM,
            'quote': 'The parameter may be, for example, a standard deviation (or a given multiple of it), or the '
                     'half-width of an interval having a stated level of confidence.',
            'supports_option': 'B',
            'note': 'JCGM 100:2008 附錄 B.2.18 NOTE 1：這個參數可以是標準差（或它的倍數），或在某個信賴水準下區間的半寬。',
        },
        {
            'url': GUM,
            'quote': 'Often, measuring instruments and systems are adjusted or calibrated using measurement standards '
                     'and reference materials to eliminate systematic effects; however, the uncertainties associated '
                     'with these standards and materials must still be taken into account.',
            'supports_option': 'B',
            'note': 'JCGM 100:2008 第 3.2.4 節 NOTE 1：校正可以去除系統效應，校正所用的量測標準與參考物質的不確定性仍要納入。',
        },
        {
            'url': 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=O0020102&flno=2',
            'quote': '六、查驗：指以系統化、文件化及獨立性等方式，執行查證或重要項目評估之作業。',
            'supports_option': 'B',
            'clause': '第2條',
            'note': '溫室氣體排放量盤查登錄及查驗管理辦法第 2 條第 6 款：查驗是以系統化、文件化及獨立性等方式執行查證或重要項目'
                    '評估的作業。',
        },
        {
            'url': 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=O0020102&flno=9',
            'quote': '事業原登錄之排放量盤查資料與查驗機構查驗結果不一致者，事業應於上傳查驗結果時併同上傳修正後之排放量清冊'
                     '及盤查報告書。',
            'supports_option': 'B',
            'clause': '第9條',
            'note': '溫室氣體排放量盤查登錄及查驗管理辦法第 9 條：原登錄的盤查資料與查驗結果不一致時，由事業在上傳查驗結果時'
                    '一併上傳修正後的排放量清冊及盤查報告書。',
        },
    ],
}


# 官方題目的解析（#148）。官方 PDF 只公布答案、沒有解析；要替官方題寫解析，寫在這裡再重新匯入，不手改題庫。
# 鍵與 EXTRA_EVIDENCE 相同：(來源代號, 題號)。text 是解析，why 是為什麼要寫（記進題庫的 metadata.explanation_source）。
# 解析裡的條號、節號、標準編號、百分比、年份、數量，都必須出現在這一題的題幹、選項或引文（官方題目本身與
# EXTRA_EVIDENCE）裡：build_item 用 tools/explanation_guard.py 核對，匯入時與 Tools CI 都跑，找不到就中止。
# 解析指涉選項的內容，不寫選項字母（quiz-app 的 explanation-hygiene gate）；引號裡寫法條原文要逐字。
EXTRA_EXPLANATIONS: dict[tuple[str, int], dict[str, str]] = {
    ('S_IPAS_115_01_L12', 6): {
        'text': '誤差是量測結果減去被測量的真值。已知的系統效應可以量化，用修正值或修正因子補償；評估不確定性時也假設量測結果已針'
                '對所有已知的顯著系統效應修正，所以已知的系統誤差應予以修正。隨機誤差則無法補償，通常可以增加觀測次數來減小。不確'
                '定性描述的是可合理歸屬於被測量的值的分散程度，可用標準差，或在某個信賴水準下區間的半寬表示：±5% 是這個區間的'
                '範圍，不是有 5% 的數據出錯。校正儀器是為了去除系統效應，但校正所用的量測標準與參考物質本身的不確定性仍要納入'
                '，校正不能完全消除不確定性。查驗是以系統化、文件化及獨立性等方式執行查證或重要項目評估的作業；查驗結果與原登錄的'
                '盤查資料不一致時，事業要上傳修正後的排放量清冊及盤查報告書。',
        'why': '#148：學員回報這一題先說答案是 D、後來說是 B。查過的事：題庫與官方 PDF 的答案都是 B；這一題原本沒'
               '有解析，答案依據只有官方題目本身。補上解析，每一句都對應到這一題的引文：誤差的定義、已知系統誤差的修正與隨機誤差'
               '（JCGM 100:2008 B.2.19、3.2.2、3.2.3、3.2.4）；不確定性的定義與表示方式、校正'
               '所用標準的不確定性（B.2.18 與它的 NOTE 1、3.2.4 NOTE 1）；查驗的定義（溫管辦法第 2 '
               '條第 6 款）；查驗結果與原登錄資料不一致時，修正的義務在事業：由事業上傳修正後的清冊（溫管辦法第 9 條）。',
    },
}


# 不是釘選法條的額外引文（例如 UNFCCC 的《巴黎協定》出版本）：CI 拿不到原文，引文是不是逐字出自來源，
# 由 --verify-extra 對照本機快取裡的那一份 PDF 核對（檔名是它的 sha256；網站擋下載時用瀏覽器存）。
# 每一個網址登記核對時那一份 PDF 的 sha256。法條引文不在這裡：law_evidence_problems 拿釘選的條文核對。
LAW_HOST = 'law.moj.gov.tw'
PINNED_LAWS = DATASET.parent / 'law-articles.pinned.json'
CLAUSE = re.compile(r'第(\d+)條(?:之(\d+))?')
EXTRA_SOURCES = {
    'https://unfccc.int/sites/default/files/resource/parisagreement_publication.pdf':
        '9c19b811a9e346bc532de9c64430494776dc434804d84cb48ad1ceacb66c884e',
    GUM: '41bbf068fbc0d7986c98691b2d1af6680cb3044f6a1a89b3560933ed9ef9626c',  # 2026-11-01 下載
}


def _flat(text: str) -> str:
    """空白不計：PDF 的文字層在斷行處留下空白（「pre- industrial」、中文換行），閱讀器上看不到。"""
    return re.sub(r'\s+', '', text)


def load_pinned_laws() -> dict:
    return json.loads(PINNED_LAWS.read_text(encoding='utf-8'))


def law_query(url: str) -> dict[str, list[str]] | None:
    """全國法規資料庫（主機名稱就是 law.moj.gov.tw）的網址 → 查詢參數，名稱一律小寫（pcode、PCode 都認）；
    不是就回傳 None。比的是主機名稱，不是子字串：law.moj.gov.tw.example.org 不算。"""
    parts = urlsplit(url)
    if parts.hostname != LAW_HOST:
        return None
    query: dict[str, list[str]] = {}
    for name, values in parse_qs(parts.query).items():
        query.setdefault(name.lower(), []).extend(values)
    return query


def law_evidence_problems(pinned: dict, sources=None) -> list[str]:
    """EXTRA_EVIDENCE 的法條引文，對照 law-articles.pinned.json 的釘選條文核對。回傳問題清單。
    網址的 pcode 恰好一個、而且是釘選的法規；clause 寫成「第N條」或「第N條之M」，對得到那部法規的一條；
    網址帶 flno 時必須是同一條；引文逐字（空白不計）在那一條的條文裡。不需要網路：匯入時與 CI 的工具測試都跑。
    sources：只核對這幾份來源的項目（匯入時）；None 是全部。"""
    laws = pinned['laws']
    problems = []
    for key, entries in sorted(EXTRA_EVIDENCE.items()):
        if sources is not None and key[0] not in sources:
            continue
        for e in entries:
            query = law_query(e['url'])
            if query is None:
                continue
            codes = query.get('pcode', [])
            if len(codes) != 1:
                problems.append(f'{key}：{e["url"]} 的 pcode 不是恰好一個 —— 看不出是哪一部法規')
                continue
            law = laws.get(codes[0])
            if law is None:
                problems.append(f'{key}：{codes[0]} 不在 law-articles.pinned.json —— 法規沒有釘選，引文無從核對。'
                                '要釘選新的法規，先問專案所有者（AGENTS.md）')
                continue
            m = CLAUSE.fullmatch(str(e.get('clause')))
            if not m:
                problems.append(f'{key}：clause「{e.get("clause")}」不是「第N條」或「第N條之M」的寫法')
                continue
            article = m[1] + (f'-{m[2]}' if m[2] else '')
            flno = query.get('flno')
            if flno is not None and flno != [article]:
                problems.append(f'{key}：網址的 flno={",".join(flno)} 與 clause「{e["clause"]}」不是同一條')
                continue
            text = law['articles'].get(article)
            if text is None:
                problems.append(f'{key}：{law["name"]}沒有第 {article} 條（釘選的條文裡查無此條）')
                continue
            if _flat(e['quote']) not in _flat(text):
                problems.append(f'{key}：引文不在{law["name"]}第 {article} 條裡（{e["quote"][:40]}…）')
    return problems


def verify_extra_evidence(cache: Path) -> list[str]:
    """EXTRA_EVIDENCE 裡非法條的引文，是否逐字（空白不計）出自登記的那一份來源 PDF。回傳問題清單。
    引文不能跨頁：頁碼會夾在中間。"""
    import pymupdf  # 延後 import：只有核對時才讀 PDF

    problems, texts = [], {}
    for key, entries in sorted(EXTRA_EVIDENCE.items()):
        for e in entries:
            url = e['url']
            if law_query(url) is not None:  # 法條：law_evidence_problems 核對
                continue
            sha = EXTRA_SOURCES.get(url)
            if sha is None:
                problems.append(f'{key}：{url} 沒有登記在 EXTRA_SOURCES（核對時那一份 PDF 的 sha256）')
                continue
            if url not in texts:
                texts[url] = None
                path = cache / f'{sha}.pdf'
                if not path.exists():
                    problems.append(f'{key}：快取裡沒有 {path}（下載 {url}，存成這個檔名）')
                    continue
                data = path.read_bytes()
                if R.sha256_bytes(data) != sha:
                    problems.append(f'{key}：{path} 的 sha256 不符 —— 不是登記的那一份 PDF')
                    continue
                with pymupdf.open(stream=data, filetype='pdf') as doc:
                    texts[url] = _flat(' '.join(page.get_text() for page in doc))
            if texts[url] is not None and _flat(e['quote']) not in texts[url]:
                problems.append(f'{key}：引文不在 {url} 裡（{e["quote"][:40]}…）')
    return problems


def _label(meta: dict) -> str:
    year, round_ = meta['session'].split('-')
    n = int(round_)
    session = f'第{ORDINAL[n - 1]}次' if 1 <= n <= len(ORDINAL) else f'第 {n} 次'
    return f'{year} 年{session}公告試題{SUBJECT_LABEL[meta["subject"]]}'


def _printed(question: dict) -> str:
    """題目在 PDF 上的樣子：題幹，下一行接四個選項（PDF 以「；」分隔）。"""
    return question['stem'] + '\n' + '；'.join(f'({o["key"]}){o["text"]}' for o in question['options'])


def _explanation(src_id: str, question: dict, evidence: list[dict]) -> dict | None:
    """EXTRA_EXPLANATIONS 的那一則（沒有就 None），先用 explanation_guard 對照題幹、選項與這一題的引文核對。"""
    entry = EXTRA_EXPLANATIONS.get((src_id, question['number']))
    if entry is None:
        return None
    item_id = f'{src_id}-q{question["number"]:03d}'
    text, why = entry.get('text'), entry.get('why')
    if not (isinstance(text, str) and text.strip() and isinstance(why, str) and why.strip()):
        sys.exit(f'✗ {item_id}：EXTRA_EXPLANATIONS 的項目要有 text（解析）與 why（為什麼寫），兩個都不能是空的。')
    allowed = [question['stem'], *(o['text'] for o in question['options']), *(e['quote'] for e in evidence)]
    if bad := explanation_guard.check(text, allowed):
        sys.exit(f'✗ {item_id} 的解析有題幹、選項與引文裡都找不到的斷言：'
                 f'{", ".join(f"{kind}「{claim}」" for kind, claim in bad)}：改解析，或在 EXTRA_EVIDENCE 補上依據。')
    return {'text': text, 'source': {'generated_by': GENERATED_BY, 'why': why}}


def build_item(src_id: str, meta: dict, question: dict, extra_evidence: list[dict] | None = None) -> dict:
    """一題擷取結果 → 題庫的一題。"""
    number, answer = question['number'], question['answer']
    for e in extra_evidence or []:
        if e.get('supports_option') != answer:
            sys.exit(f'✗ {src_id} 第 {number} 題：額外依據的 supports_option 是 {e.get("supports_option")!r}，'
                     f'官方答案是 {answer}。')
    official = {
        'url': meta['url'],
        'quote': _printed(question),
        'supports_option': answer,
        'note': f'{_label(meta)}第 {number} 題：PDF 的答案欄印 {answer}。',
        'generated_by': GENERATED_BY,
    }
    extras = [{**e, 'generated_by': GENERATED_BY} for e in extra_evidence or []]
    explanation = _explanation(src_id, question, [*extras, official])
    return {
        'item_id': f'{src_id}-q{number:03d}',
        'year': int(meta['exam_date'][:4]),
        'year_confidence': 'high',
        'credential': 'iPAS 淨零碳規劃管理師',
        'level': '初級',
        'topic_tags': [],
        'question_type': 'single_choice',
        'stem': question['stem'],
        'options': [dict(o) for o in question['options']],
        'answer': answer,
        'explanation': explanation['text'] if explanation else None,
        'source': {
            'source_id': src_id,
            'url': meta['url'],
            'publisher': 'iPAS',
            'authority': 'official',
            'evidence': {'page': question['page'], 'quote': question['stem']},
        },
        'alt_sources': [],
        'notes': '由官方公告試題 PDF 擷取（tools/import_official_exam.py）；題幹、選項、答案照 PDF。',
        'exam_subject': meta['exam_subject'],
        'subject_confidence': 1.0,
        'official_exam': {
            'session': meta['session'],
            'exam_date': meta['exam_date'],
            'subject': meta['subject'],
            'question_number': number,
        },
        'quality_flags': ['time_sensitive'],
        'metadata': {
            'valid_as_of': meta['exam_date'],
            # 題庫的慣例：引文的網址也列在 sources 裡（季排程依它檢查連結）
            'sources': list(dict.fromkeys([meta['url'], *(e['url'] for e in extras)])),
            'evidence': [*extras, official],
            # 解析是工具寫的（EXTRA_EXPLANATIONS）才有這一欄；放在最後，與重新匯入時加進去的位置相同
            **({'explanation_source': explanation['source']} if explanation else {}),
        },
    }


def _refresh_owned_evidence(current: dict, built: dict, *, generated_by: str = GENERATED_BY) -> bool:
    """工具負責的引文（帶 generated_by 標記）整批換成這次建出來的版本，排在前面；其他引文照留，
    即使網址相同。sources 以工具的網址開頭；舊的工具引文帶進來的網址，這次不再需要、也沒有人工引文
    用它，就拿掉。回傳檔案裡寫出來的內容有沒有變（含順序）。generated_by 是呼叫的工具自己的標記
    （參考樣題的匯入工具有它自己的）。"""
    meta = current.get('metadata') or {}
    current['metadata'] = meta
    before = json.dumps([meta.get('evidence'), meta.get('sources')], ensure_ascii=False)
    evidence = meta.get('evidence') or []
    others = [e for e in evidence if e.get('generated_by') != generated_by]
    dropped = ({e.get('url') for e in evidence if e.get('generated_by') == generated_by}
               - {e.get('url') for e in others})
    meta['evidence'] = [dict(e) for e in built['metadata']['evidence']] + others
    ours = built['metadata']['sources']
    meta['sources'] = [*ours, *(u for u in meta.get('sources') or [] if u not in ours and u not in dropped)]
    return json.dumps([meta['evidence'], meta['sources']], ensure_ascii=False) != before


def merge(dataset: dict, items: list[dict], *, owned: tuple[str, ...] = OWNED, generated_by: str = GENERATED_BY) -> int:
    """新題接在 our_unique_items 最後；已經在的題目核對工具負責的欄位（owned）、更新工具負責的引文。
    owned、generated_by 給參考樣題的匯入工具用（tools/import_official_sample.py），預設是這支工具的。

    回傳更新了引文的題數。
    """
    existing = {i.get('item_id'): i for i in dataset['our_unique_items']}
    refreshed = 0
    for item in items:
        current = existing.get(item['item_id'])
        if current is None:
            dataset['our_unique_items'].append(item)
            existing[item['item_id']] = item  # 同一個來源傳了兩次：第二次當成「已經在題庫裡」
            continue
        changed = [f for f in owned if current.get(f) != item[f]]
        if changed:
            sys.exit(f'✗ {item["item_id"]} 已經在題庫裡，而且 {changed} 與這次擷取的結果不同 —— '
                     '不覆寫。來源 PDF 變了要先查清楚；題庫被改過就要先還原。')
        evidence_changed = _refresh_owned_evidence(current, item, generated_by=generated_by)
        explanation_changed = _refresh_owned_explanation(current, item, generated_by=generated_by)
        refreshed += evidence_changed or explanation_changed
    return refreshed


def _refresh_owned_explanation(current: dict, built: dict, *, generated_by: str = GENERATED_BY) -> bool:
    """工具負責的解析（metadata.explanation_source 帶 generated_by 標記）換成這次建出來的版本；表上拿掉了，
    工具的解析也拿掉。沒有標記的解析是人工寫的：表上沒有這一題就照留，表上有就中止，不覆寫。
    回傳題庫有沒有變。"""
    meta = current.get('metadata') or {}
    current['metadata'] = meta
    owned = (meta.get('explanation_source') or {}).get('generated_by') == generated_by
    want, source = built.get('explanation'), (built.get('metadata') or {}).get('explanation_source')
    if want is None:
        if not owned:
            return False
        current['explanation'] = None
        del meta['explanation_source']
        return True
    if not owned and (current.get('explanation') or '').strip():
        sys.exit(f'✗ {current.get("item_id")} 已經有人工寫的解析，EXTRA_EXPLANATIONS 也有一則，不覆寫。'
                 '要改由工具負責，先把人工的那一則搬進 EXTRA_EXPLANATIONS 並從題庫拿掉。')
    before = (current.get('explanation'), meta.get('explanation_source'))
    current['explanation'] = want
    meta['explanation_source'] = dict(source)
    return before != (want, source)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description='把 iPAS 官方公告試題匯入主題庫。')
    ap.add_argument('sources', nargs='*', help='SOURCES 裡 kind 為 official_exam 的來源代號')
    ap.add_argument('--cache', default=str(Path.home() / '.cache' / 'ipas-src-pdf'),
                    help='來源 PDF 的快取目錄：沒有才下載，sha256 與 SOURCES 不符就中止')
    ap.add_argument('--verify-extra', action='store_true',
                    help='不匯入：核對 EXTRA_EVIDENCE 的引文（法條對照釘選的條文，其他對照快取裡登記的來源 PDF）')
    a = ap.parse_args(argv)

    cache = Path(a.cache)
    if a.verify_extra:
        problems = law_evidence_problems(load_pinned_laws()) + verify_extra_evidence(cache)
        if problems:
            sys.exit('✗ 額外引文核對不過：\n  ' + '\n  '.join(problems))
        print('✓ EXTRA_EVIDENCE 的引文都逐字核對過（法條對照釘選的條文，其他對照快取裡登記 sha256 的來源 PDF）。')
        return 0
    if not a.sources:
        ap.error('要匯入的來源代號（或 --verify-extra）')
    sources = list(dict.fromkeys(a.sources))  # 同一個來源寫兩次只匯入一次
    for src_id in sources:  # 先確認每一份都登記齊全，再開始下載
        meta = R.SOURCES.get(src_id)
        if not meta or meta.get('kind') != 'official_exam':
            sys.exit(f'✗ {src_id} 不是官方公告試題的來源（SOURCES 裡沒有，或 kind 不是 official_exam）。')
        if src_id not in R.EXPECTED_QUESTION_COUNT:
            sys.exit(f'✗ {src_id} 沒有登記總題數（restore_from_source_pdf.py 的 EXPECTED_QUESTION_COUNT）。')
    R.check_figure_questions(sources)  # 圖表題的登記說得通，才下載
    on_figures = sorted(k for k in EXTRA_EVIDENCE
                        if k[0] in sources and k[1] in R.SOURCES[k[0]].get('figure_questions', {}))
    if on_figures:
        sys.exit(f'✗ EXTRA_EVIDENCE 掛在不收錄的圖表題上：{on_figures} —— 那幾題不會進題庫。')
    if problems := law_evidence_problems(load_pinned_laws(), sources):  # 不需要網路：下載之前先核對
        sys.exit('✗ 法條引文核對不過：\n  ' + '\n  '.join(problems))
    items, used = [], set()
    for src_id in sources:
        meta = R.SOURCES[src_id]
        cache.mkdir(parents=True, exist_ok=True)
        load_pdf(src_id, cache)
        path = cache / f'{src_id}.pdf'
        try:
            R.check_official_header(src_id, meta, ipas_exam_pdf.header(path))  # 是 SOURCES 說的那一場、那一科
            figures = meta.get('figure_questions', {})
            questions = ipas_exam_pdf.extract(path, figure_questions=frozenset(figures))
        except ValueError as e:
            sys.exit(f'✗ {src_id}: {e}')
        expected = R.EXPECTED_QUESTION_COUNT[src_id]
        if len(questions) != expected:
            sys.exit(f'✗ {src_id}: 擷取到 {len(questions)} 題，應為 {expected} 題。')
        kept = [q for q in questions if q['number'] not in figures]  # 圖表題不收錄（憑證裡記下理由）
        items += [build_item(src_id, meta, q, EXTRA_EVIDENCE.get((src_id, q['number']))) for q in kept]
        used |= {(src_id, q['number']) for q in kept}
    stale = sorted(k for k in EXTRA_EVIDENCE if k[0] in sources and k not in used)
    if stale:
        sys.exit(f'✗ EXTRA_EVIDENCE 有對不到任何題目的項目：{stale} —— 題號打錯，或那一題不在這份 PDF 裡。')

    dataset = json.loads(DATASET.read_text(encoding='utf-8'))
    before = len(dataset['our_unique_items'])
    refreshed = merge(dataset, items)
    added = len(dataset['our_unique_items']) - before
    # 與 tools/sync_derived_counts.py 相同的寫法：縮排 2、不跳脫中文、檔尾不換行
    DATASET.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding='utf-8', newline='\n')
    print(f'新增 {added} 題；已在題庫裡 {len(items) - added} 題，其中 {refreshed} 題更新了工具負責的引文、來源或解析。'
          '接著跑 restore_from_source_pdf.py --emit 記進憑證，再 cd quiz-app && pnpm preflight。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
