"""iPAS 參考樣題 PDF 的擷取器：「淨零碳規劃管理師能力鑑定 參考樣題(114 年版)」。

版面
Word 存檔，Acrobat PDFMaker 轉成 PDF。
- 第一頁的第一行是標題「淨零碳規劃管理師能力鑑定 參考樣題(114 年版)」。每一頁接著一行科目：第一頁
  「L11 淨零碳規劃管理基礎概論」，第二頁「L12 淨零碳盤查規範與程序概要」。一頁一個科目，題目不跨頁。
- 每一題：「N.」開頭的題幹（可以多行、多段），接著一段選項「(A)…；(B)…；(C)…；(D)…」（可以折行），
  最後一行「解答：(X)」。沒有表格、頁碼、圖片或其他文字。

文字
規則與公告試題相同，直接用 ipas_exam_pdf 的 text_lines 與 join_lines：行內空白一律一個，同一行裡中文與英數字
之間的間距變成一個空格，斷行依 PDF 在行尾有沒有留下空白字元接回（段落結尾的行尾有空白，折行沒有）。
「N.」後面、選項標號後面的空白，以及選項之間的「；」，不算內容。

閱讀器畫的與擷取到的要一致：公告試題擷取器的檢查，這裡都跑（_pages），刻意不跑的列在 NOT_APPLIED 並寫明理由，
tests/test_ipas_sample_pdf.py 拿兩邊實際呼叫的函式對帳（公告試題那邊多了一道，這裡沒有決定跑不跑，測試就紅）。
- 物件與 xref（ipas_exam_pdf._syntax_problem，pdfplumber 開檔之前查）：線性化的 PDF 有第二條讀法（Poppler 與 PDFium 的
  FPDFAvail_GetDocument 先讀第一段 xref，Chrome、Firefox、Poppler 的第一頁是線性化字典的 /O），pdfminer 與 MuPDF 只走檔尾那一條，
  所以線性化字典要與檔案相符、第一段之後不能再有更新（_linearized_problem），檔案裡每一個 startxref 都要指到讀過的那幾段
  xref、最後一個 %%EOF 之後只有空白（_tail_problem：PDFium 會另外找 startxref，註解藏起來的也算）；同一個物件在幾段 xref 登記的位置不同、
  物件名稱裡的 NUL、整個物件只是一個參照（/Info 繞回自己時 pdfminer 開檔就卡住）等等。
- 串流（ipas_exam_pdf._stream_problems）：字典只收 STREAM_KEYS（/F 在 pdfminer 與 MuPDF 是 /Filter，PDFium 不看），濾鏡只收
  直接寫的 /FlateDecode、/DCTDecode，/DecodeParms 只在 xref 串流，/Length 的落點後面要正好是 endstream。
- 字有沒有真的畫出來（ipas_exam_pdf._check_chars）：pdfminer 抽到的每一個字，PyMuPDF 都要在同一個起點畫出同一個
  字形，看得清楚，墨跡完整在頁面內（MediaBox 切掉字的下半部，「B」與「D」看不出差別）；反過來，PyMuPDF 畫出來的每一個字，pdfminer 也要抽得到（_unextracted_glyph：字型的 ToUnicode
  把字對到空字串時，閱讀器照畫，抽出來卻是空的）。整頁的字要像正常的文件（_text_profile：字級、與白紙的對比、
  描邊只用來加粗）。
- PyMuPDF 畫的東西（bboxlog）只能是一般的填色文字：隱形字、描邊字、漸層、圖片都不行（只當剪裁的字 bboxlog 不列，
  由內容串流的寫法擋）。剪裁路徑一律不准（_clip_operator）：真的樣題 PDF 兩頁都沒有，而字只要碰到剪裁範圍，在
  PyMuPDF 看來就算畫出來了（0.01pt 高的細條、兩個小三角形），閱讀器上卻看不到。
- 檔案結構：頁面樹（_page_list_problem：是頁面又帶 /Kids 的節點，Chrome 畫出另一頁；頁面字典的鍵、CropBox 要等於
  MediaBox）、目錄字典的鍵（_catalog_problem：/XFA 讓 Firefox 整份畫另一份文件）、註解直接讀 /Annots
  （_annotations）、頁面資源（_resources：只收 RESOURCE_KEYS，/DefaultGray 讓 Poppler 上的字消失；字型的對照表讓畫的字與
  抽出來的字不同）、內容串流是兩套程式讀法一致的寫法（_content_problem）、沒有圖層或表單物件（_layers_or_forms：
  表單裡用白字蓋掉答案再印另一個字，抽出來的是原來的答案）、xref 表不用重建（開檔時與畫完頁面後各查一次）。

與公告試題不同的地方
這份 PDF 是 Acrobat PDFMaker 輸出的，有四處與 Word 的寫法不同（真的樣題 PDF 兩頁、兩份來源都實測過）：
- 起點的水平容差 ORIGIN_X：兩套程式算出的起點，水平方向最多差 0.144pt（實測兩頁 1042 個字：1036 個差 0、0.036、
  0.072、0.108 或 0.144pt，沿著同一行累加，看起來是英文字型的字寬表與字型檔差了千分之三 em；另有 6 個差
  0.048pt），垂直方向最多差 0.00012pt。公告試題的 Word PDF 兩個方向都不到 0.0002pt。
- 字型（FONT_RULES）：內嵌字型的字型描述多寫 /CIDSet、/FontFamily、/FontStretch（閱讀器照描述換字型只發生在沒有
  內嵌時，字型檔要是解得開的 TrueType）；英文粗體是 Arial-BoldMT；內嵌的 TrueType 帶 /ToUnicode，但每一個字碼對到的
  字都與 /WinAnsiEncoding 相同（不同就擋：字形照編碼選，抽出來的字照 ToUnicode）。
- PDF 物件的寫法（SYNTAX_RULES）：真的樣題對 _syntax_problem 只有三處與 Word 不同，只放寬這三處，其餘照查（實測）：
  物件串流裡陣列中的 null（結構樹的 /ParentTree，兩份來源同一個檔，15 個）；整份只有 xref 串流、沒有 trailer；線性化，
  線性化字典要與檔案相符、之後沒有更新（ipas_exam_pdf._linearized_problem）。
- 白名單（CATALOG_KEYS、RESOURCE_KEYS、STREAM_KEYS）：目錄字典多 /PageLayout、少 /ViewerPreferences，頁面資源只有 /Font，
  串流多物件串流、xref 串流與提示串流的鍵。擋下時訊息列出全部不在白名單裡的鍵與下一步。

擷取器保證什麼：pdfminer 抽到的與 MuPDF 畫出來的逐字對得上，兩者讀的是同一份物件。其他閱讀器（Chrome 的 PDFium、
Firefox 的 pdf.js、Poppler）不在擷取時跑：已知它們與這兩套讀法不同的地方，用白名單（只收真實 PDF 寫的鍵、濾鏡）與結構上的
不變量（xref 的段數與 startxref、線性化、CropBox、字要完整在頁面內）去掉。閱讀器自己的修復與搜尋行為不一定都涵蓋，所以
登記新的 PDF 時仍要在 Chrome 與 Firefox 都開過、逐題比對（AGENTS.md「匯入 iPAS 官方公告試題」第 7 步）。

已知擋不住、要靠人工讀一遍的，除了下面這一條，還有 ipas_exam_pdf 模組說明列的幾條（字型檔、字寬表、/H 提示資料）：內嵌字型的字形與抽出來的字不一致（公告試題也一樣，見 ipas_exam_pdf 的模組說明）。
內嵌的 Type0 字型的 /ToUnicode 把字形對到另一個字時，抽出來的字變了，畫出來的像素沒有變（審查實測：題幹抽出來是「不確」，
PDFium、Poppler、MuPDF 畫的都與原檔逐點相同）：起點與字形都對得上，擷取只能照對照表，是文字擷取本身的極限。所以來源
PDF 的 sha256 釘在 restore_from_source_pdf.SOURCES，換了檔案要人工確認，SOURCE_REVIEWS 有查核紀錄才走得到擷取。

不在預期內的版面一律 ValueError：頁面有圖片、向量圖形、註解（Link 也算，直接讀 /Annots）或表單欄位，或頁面有旋轉；物件與
xref、串流、頁面樹、頁面資源、內容串流不是兩邊讀法一致的寫法；有剪裁路徑；字的墨跡沒有完整在頁面內；PyMuPDF 畫了填色文字以外的東西、
有圖層或表單物件、xref 表要重建；
第一頁的第一行不是標題；某一頁的第一行（第一頁是第二行）不是認得的科目，或同一個科目出現在兩頁；題目不是「題號、題幹、選項、
解答」的順序；選項標號不是 (A) 到 (D) 各一次，或前三個選項不是以「；」結尾；題號不是從 1 起連續；以及
_check_chars、text_lines 擋下的字（特殊字元、沒有真的畫出來、疊印、定位點排的版面）。
"""
from __future__ import annotations

import re
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import ipas_exam_pdf

TITLE = re.compile(r'淨零碳規劃管理師能力鑑定 參考樣題\((\d{3}) 年版\)')
SUBJECTS = {'L11': '淨零碳規劃管理基礎概論', 'L12': '淨零碳盤查規範與程序概要'}  # iPAS 的科目代號 → 科目名稱
SUBJECT_LINE = re.compile(r'(L\d{2}) (\S+)')
NUMBER = re.compile(r'(\d{1,2})\.(.*)')
ANSWER = re.compile(r'解答：\(([A-D])\)')
MARK = re.compile(r'\(([A-Z])\)')
KEYS = ['A', 'B', 'C', 'D']
ORIGIN_X = 0.5  # 起點的水平容差（pt），見模組說明
# 字型照公告試題的規則查（ipas_exam_pdf._resources），只有這三處不同（見模組說明「與公告試題不同的地方」）
FONT_RULES = {
    'embedded_descriptor_keys': frozenset({'CIDSet', 'FontFamily', 'FontStretch'}),
    'simple_fonts': ipas_exam_pdf.SIMPLE_FONTS | {'Arial-BoldMT'},
    'simple_tounicode': True,
}
# _syntax_problem 只放寬這三處（另給白名單），見模組說明「與公告試題不同的地方」
# 真的樣題 PDF 寫的全部的鍵（實測）。公告試題的在 ipas_exam_pdf：多 /ViewerPreferences、/ExtGState、/ProcSet、/XObject，
# 串流多圖片的鍵、少物件串流與 xref 串流那幾個（/Extends、/Index、/Prev、/DecodeParms）與提示串流的 /C、/I、/S
CATALOG_KEYS = frozenset({'Type', 'Pages', 'Lang', 'MarkInfo', 'Metadata', 'PageLayout', 'StructTreeRoot'})
RESOURCE_KEYS = frozenset({'Font'})
STREAM_KEYS = frozenset({'Length', 'Filter', 'Type', 'Subtype', 'Length1', 'First', 'N', 'Extends', 'W', 'Size', 'Root',
                         'Info', 'ID', 'Index', 'Prev', 'DecodeParms', 'C', 'I', 'S'})
SYNTAX_RULES = {'array_null_in_object_streams': True, 'xref_streams_only': True, 'linearized': True,
                'stream_keys': STREAM_KEYS, 'home': __name__}
CLIP_OPERATORS = frozenset({b'W', b'W*'})
# 公告試題擷取器跑、這裡不跑的檢查與理由（tests/test_ipas_sample_pdf.py 拿兩邊實際呼叫的函式對帳）
NOT_APPLIED = {
    '_odd_clip': '不是矩形的剪裁路徑：這裡矩形也不准，內容串流不能有剪裁運算子（_clip_operator）',
    '_covered': '畫在字之後蓋住字的圖片、圖片遮罩、漸層：bboxlog 只准填色文字，這些畫不上去',
    '_probe': '描邊加粗的字太粗：描邊字（Tr 1、2）在 bboxlog 是 stroke-text，已經擋下',
    '_unextracted_image': 'pdfminer 讀不出的圖：bboxlog 只准填色文字，圖畫不上去',
    '_marks': '答案欄裡的圖形：沒有表格，頁面上也不准有任何圖形（_decorations）',
    '_strike': '題目欄裡的刪除線：頁面上不准有任何圖形（_decorations）',
    '_log_drawings': '題目欄裡的圖形：頁面上不准有任何圖形（_decorations）',
    '_shades': '浮水印的顏色：頁面上不准有圖，沒有浮水印',
    '_watermark_problem': '浮水印的寫法：頁面上不准有圖，沒有浮水印',
    '_on_watermark': '壓在浮水印上的字：頁面上不准有圖，沒有浮水印',
    '_drawn': '表格外的字：沒有表格，整頁的字都過 _check_chars',
    '_outside_table': '表格外的頁首、頁碼：沒有表格，標題與科目那兩行由 _header 認，題目由 _questions 認',
    '_table_count_error': '一頁一張表：沒有表格',
}
XREF_REBUILT = ipas_exam_pdf.REBUILT
WRITER = '真的樣題 PDF'  # 訊息裡的「Word」：ipas_exam_pdf 的訊息是寫給 Word 輸出的 PDF 的，這份是 Acrobat 輸出的


@dataclass(frozen=True)
class Header:
    """PDF 自己說的版次與科目：title 是第一頁的標題，subject 是那一科所在那一頁的科目那一行。"""
    title: str
    subject: str
    subject_code: str
    edition: str


def _header(title: str, heading: str) -> Header:
    """標題那一行與科目那一行 → Header（版次從標題推出，科目代號從科目那一行推出）。對不上就 ValueError。
    擷取時與測試共用：快照裡的頁首就是這兩行推出來的樣子（手改其中一邊，離線就看得出來）。"""
    m = TITLE.fullmatch(title)
    if not m:
        raise ValueError(f'「{title}」不是參考樣題的標題，需要人工確認。')
    s = SUBJECT_LINE.fullmatch(heading)
    if not s or SUBJECTS.get(s.group(1)) != s.group(2):
        raise ValueError(f'「{heading}」不是認得的科目（{"、".join(f"{k} {v}" for k, v in SUBJECTS.items())}），'
                         '需要人工確認。')
    return Header(title=title, subject=heading, subject_code=s.group(1), edition=m.group(1))


@contextmanager
def _unreadable():
    """讀 PDF 時出的錯一律換成 ValueError，與 ipas_exam_pdf._unreadable 相同；擷取器自己丟的 ValueError（最裡面一層在
    這個模組或 ipas_exam_pdf 裡）照原樣傳出。"""
    import pymupdf
    from pdfminer.psexceptions import PSException
    from pdfplumber.utils.exceptions import PdfminerException

    try:
        yield
    except (PdfminerException, PSException) as error:
        raise ValueError(f'pdfminer 讀不了這份 PDF（{type(error).__name__}：{error}），需要人工確認。') from error
    except (pymupdf.FileDataError, pymupdf.mupdf.FzErrorBase) as error:
        raise ValueError(f'PyMuPDF 讀不了這份 PDF（{type(error).__name__}：{error}），需要人工確認。') from error
    except Exception as error:
        if isinstance(error, ValueError) and _innermost_module(error) in (__name__, ipas_exam_pdf.__name__):
            raise ValueError(re.sub(' ?Word', WRITER, str(error))) from error
        raise ValueError(f'讀這份 PDF 時出錯（{type(error).__name__}：{error}），需要人工確認。') from error


def _innermost_module(error) -> str | None:
    trace = error.__traceback__
    while trace.tb_next:
        trace = trace.tb_next
    return trace.tb_frame.f_globals.get('__name__')


def _decorations(page, rendered) -> list[str]:
    """這一頁上不是文字的東西：參考樣題的版面一樣都沒有，出現了就可能是要讀圖的題目，或蓋住文字的東西。"""
    # 註解直接讀 /Annots（ipas_exam_pdf._annotations）：PyMuPDF 的 annots() 跳過不認得的種類與直接寫在 /Annots 裡的
    # 註解，閱讀器卻照樣畫出它們的外觀
    annotations = ipas_exam_pdf._annotations(page)
    found = [(name, count) for name, count in (
        ('圖片', max(len(page.images), len(rendered.get_images()))),  # 兩套程式各數一次，取多的那個
        ('向量圖形', len(rendered.get_drawings())),
        ('註解', len(annotations)),
        ('連結', len(rendered.get_links())),
        ('表單欄位', len(list(rendered.widgets()))),
    ) if count]
    kinds = f'（{"、".join(annotations)}）' if annotations else ''
    return ([f'{name} {count} 個{kinds if name == "註解" else ""}' for name, count in found]
            + ([f'旋轉 {rendered.rotation} 度'] if rendered.rotation else []))


def _clip_operator(page) -> str | None:
    """這一頁內容串流裡第一個剪裁運算子，沒有就回 None。看運算子、不看 PyMuPDF 的 get_drawings：沒有路徑的「W n」它不列。
    其他會切掉字的寫法：文字畫法（Tr）由 _content_problem 擋，表單物件由 _layers_or_forms 擋，CropBox 由
    _page_list_problem 擋，MediaBox 切掉字由 _visible_glyphs 擋（墨跡要完整在頁面內）。
    內容串流要先過 _content_problem：切得成詞，兩套程式讀到的位元組也相同。"""
    from pdfminer.pdftypes import list_value, stream_value

    for content in list_value(page.page_obj.contents):
        for _, text in ipas_exam_pdf._content_tokens(stream_value(content).get_data()):
            if text in CLIP_OPERATORS:
                return text.decode()
    return None


def _pages(pdf_path: Path) -> list[list[str]]:
    """每一頁的各行文字（ipas_exam_pdf.text_lines：行尾留著的一個空格是段落結尾的訊號）。字先過 _check_chars。"""
    import pdfplumber
    import pymupdf

    pages = []
    with _unreadable(), pymupdf.open(pdf_path) as rendered:
        # pdfplumber 開檔之前查：/Info 指向繞回自己的參照時，pdfminer 開檔就卡住（見 ipas_exam_pdf._opened）
        if problem := ipas_exam_pdf._syntax_problem(pdf_path, rendered, **SYNTAX_RULES):
            raise ValueError(problem)
        pdf = pdfplumber.open(pdf_path)
        try:
            if ipas_exam_pdf._rebuilt_xref(pdf, rendered):
                raise ValueError(XREF_REBUILT)
            # 頁面樹，以及兩套程式讀到的頁面逐一相同（頁數不同也在這裡擋）：是頁面又帶 /Kids 的節點，Chrome（PDFium）
            # 照 /Kids 畫出另一頁，兩套擷取程式讀的是原本那一頁
            if problem := ipas_exam_pdf._page_list_problem(pdf, rendered):
                raise ValueError(problem)
            # 再逐頁看文字以外的東西（註解的外觀也是表單物件，先報註解比較準），以及頁面資源：圖形狀態的轉換函數、
            # 混色、遮罩，字型的對照表，都能讓閱讀器畫的與抽出來的字不同
            for pno, page in enumerate(pdf.pages, 1):
                if other := _decorations(page, rendered[pno - 1]):
                    raise ValueError(f'第 {pno} 頁有{"、".join(other)}：參考樣題的版面只有文字，題目可能要讀圖，'
                                     '或有東西蓋住文字，需要人工確認。')
                if odd := ipas_exam_pdf._resources(page, **FONT_RULES):
                    raise ValueError(f'第 {pno} 頁有{"、".join(odd)}：各家算繪器畫法不同（轉換函數、混色、遮罩、字型的'
                                     '對照表），抽出來的字不一定是閱讀器上看到的，需要人工確認。')
            if problem := ipas_exam_pdf._layers_or_forms(rendered):
                raise ValueError(problem)
            if problem := ipas_exam_pdf._catalog_problem(pdf, CATALOG_KEYS, __name__):
                raise ValueError(problem)
            if problem := ipas_exam_pdf._resource_keys_problem(pdf, RESOURCE_KEYS, __name__):
                raise ValueError(problem)
            for pno, page in enumerate(pdf.pages, 1):
                where = f'第 {pno} 頁'
                shown = rendered[pno - 1]
                if kinds := sorted({kind for kind, _ in shown.get_bboxlog()} - {'fill-text'}):
                    raise ValueError(f'{where}畫了填色文字以外的東西（PyMuPDF 的 {"、".join(kinds)}）：參考樣題只有一般的'
                                     '填色文字，隱形字、描邊字、只當剪裁的字、漸層、圖片都會讓抽出來的字與閱讀器上看到的'
                                     '不同，需要人工確認。')
                if problem := ipas_exam_pdf._content_problem(page, shown):
                    raise ValueError(f'{where}：{problem}，需要人工確認。')
                if clip := _clip_operator(page):
                    raise ValueError(f'{where}有剪裁路徑（內容串流的「{clip}」）：_visible_glyphs 只看字碰不碰到剪裁範圍，'
                                     '被切到看不見的字擷取時照樣抽得出來，需要人工確認。')
                trace = shown.get_texttrace()
                ipas_exam_pdf._check_chars(page.chars, where, ipas_exam_pdf._visible_glyphs(shown, trace),
                                           x_tolerance=ORIGIN_X)
                if lost := ipas_exam_pdf._unextracted_glyph(trace, page.chars, x_tolerance=ORIGIN_X):
                    text, box = lost
                    raise ValueError(f'{where}畫出了擷取不到的字「{text}」（x={box[0]:.1f}, top={box[1]:.1f}）：閱讀器上看得到，'
                                     'pdfminer 卻沒有讀到（例如字型的 ToUnicode 把字對到空字串），需要人工確認。')
                # 整頁的字：字級、與白紙的對比、描邊只用來加粗（參考樣題沒有表格，表格的範圍給空的）
                if problem := ipas_exam_pdf._text_profile(trace, (0, 0, 0, 0)):
                    raise ValueError(f'{where}{problem}，需要人工確認。')
                pages.append(ipas_exam_pdf.text_lines(page.chars, where))
            if rendered.is_repaired:  # PyMuPDF 有時畫到那一頁才重建 xref：開檔時查過一次還不夠
                raise ValueError(XREF_REBUILT)
        finally:
            pdf.stream.close()
    return pages


def _options(text: str, where: str) -> list[dict]:
    """「(A)…；(B)…；(C)…；(D)…」切成四個選項（這一段是從 (A) 開始的那一行接起來的）。標號要正好是 (A) 到 (D)
    各一次；前三個選項要以「；」結尾（選項裡另有像標號的字，就會在這裡被擋下，而不是切錯）。"""
    marks = list(MARK.finditer(text))
    keys = [m.group(1) for m in marks]
    if keys != KEYS:
        raise ValueError(f'{where}的選項標號是 {keys}（應為 (A) 到 (D) 各一次、從 (A) 開始）：「{text}」，需要人工確認。')
    options = []
    for i, m in enumerate(marks):
        body = text[m.end():marks[i + 1].start() if i + 1 < len(marks) else len(text)].strip()
        if i < len(marks) - 1:
            if not body.endswith('；'):
                raise ValueError(f'{where}的 ({m.group(1)})「{body}」不是以「；」結尾：選項可能切錯了，需要人工確認。')
            body = body[:-1].rstrip()
        if not body:
            raise ValueError(f'{where}的 ({m.group(1)}) 是空的，需要人工確認。')
        options.append({'key': m.group(1), 'text': body})
    return options


def _questions(pno: int, lines: list[str]) -> list[dict]:
    """一頁的題目：每一題是題號開頭的題幹、從 (A) 開始的選項、一行解答。"""
    questions, i = [], 0
    while i < len(lines):
        m = NUMBER.fullmatch(lines[i])
        if not m:
            raise ValueError(f'第 {pno} 頁的「{lines[i].rstrip()}」應該是下一題的題號開頭：題目不是「題號、題幹、選項、'
                             '解答」的順序，需要人工確認。')
        number = int(m.group(1))
        where = f'第 {pno} 頁第 {number} 題'
        stem = m.group(2).lstrip(' ')
        i += 1
        while i < len(lines) and not lines[i].startswith('(A)'):
            if ANSWER.fullmatch(lines[i].rstrip()):
                raise ValueError(f'{where}在選項之前就是解答，需要人工確認。')
            stem = ipas_exam_pdf.join_lines(stem, lines[i])
            i += 1
        if i == len(lines):
            raise ValueError(f'{where}沒有從 (A) 開始的選項，需要人工確認。')
        options = lines[i]
        i += 1
        while i < len(lines) and not ANSWER.fullmatch(lines[i].rstrip()):
            options = ipas_exam_pdf.join_lines(options, lines[i])
            i += 1
        if i == len(lines):
            raise ValueError(f'{where}沒有「解答：(X)」那一行，需要人工確認。')
        answer = ANSWER.fullmatch(lines[i].rstrip()).group(1)
        i += 1
        if not stem.strip():
            raise ValueError(f'{where}的題幹是空的，需要人工確認。')
        questions.append({'number': number, 'page': pno, 'column': None, 'answer': answer,
                          'stem': stem.rstrip(), 'options': _options(options.rstrip(), where)})
    numbers = [q['number'] for q in questions]
    if numbers != list(range(1, len(numbers) + 1)):
        raise ValueError(f'第 {pno} 頁的題號是 {numbers}，不是從 1 起連續，需要人工確認。')
    return questions


def _read(pdf_path: Path) -> dict[str, tuple[int, Header, list[str]]]:
    """{科目代號: (頁碼, 那一科的 Header, 題目的各行)}。標題只在第一頁的第一行。"""
    pages = _pages(pdf_path)
    if not pages or not pages[0]:
        raise ValueError('第 1 頁沒有字：不是參考樣題的版面，需要人工確認。')
    title = pages[0][0].rstrip()
    subjects: dict[str, tuple[int, Header, list[str]]] = {}
    for pno, lines in enumerate(pages, 1):
        body = lines[1:] if pno == 1 else lines
        if not body:
            raise ValueError(f'第 {pno} 頁沒有科目與題目，需要人工確認。')
        try:
            head = _header(title, body[0].rstrip())
        except ValueError as e:
            raise ValueError(f'第 {pno} 頁：{e}') from None
        if head.subject_code in subjects:
            raise ValueError(f'科目 {head.subject_code} 出現在第 {subjects[head.subject_code][0]} 頁與第 {pno} 頁，'
                             '需要人工確認。')
        subjects[head.subject_code] = (pno, head, body[1:])
    return subjects


def _page_of(subjects: dict, subject_code: str) -> tuple[int, Header, list[str]]:
    if subject_code not in subjects:
        raise ValueError(f'這份參考樣題沒有科目 {subject_code}（有的是 {sorted(subjects)}），需要人工確認。')
    return subjects[subject_code]


def header(pdf_path: Path, subject_code: str) -> Header:
    """PDF 自己說的版次、科目與標題（subject_code 那一科所在的那一頁）。"""
    return _page_of(_read(pdf_path), subject_code)[1]


def extract(pdf_path: Path, subject_code: str) -> list[dict]:
    """subject_code 那一科的題目：number、page、column（一律 None）、answer、stem、options。"""
    pno, _, lines = _page_of(_read(pdf_path), subject_code)
    return _questions(pno, lines)
