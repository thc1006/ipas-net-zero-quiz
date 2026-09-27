"""iPAS 公告試題 PDF（表格版面）的擷取器。

版面（Word 產生）：每頁一張表。第一列是表頭「答案｜題目」，之後每列一題：

    [答案欄：A–D]  [題目欄：左側是題號「12.」，右側是題幹，接著 (A)–(D) 各占一行]

一題跨頁時，下一頁的表頭之後先接一個「續列」：答案欄與題號都空白，只有題目欄的後半段。
表格外只有頁首（場次、科目、考試日期）、首頁的注意事項與「一、單選題」、末頁的「《以下空白》」、頁碼
（「第 N 頁，共 M 頁」，或只印 N），以及 Word 的頁面框線；每一頁同一位置、內容相同的圖片是浮水印
（真實卷的浮水印是每頁第一個畫的東西，在所有字的下面；很淡，最深的顏色與壓在上面的黑字對比 15:1，MuPDF 與
Poppler 畫出來的邊緣深一些，也有 10:1）。

擷取時做的正規化（都不改變題意）：
  - 行內的空白一律一個：PDF 的空白字元（U+0020 與全形空白，連續一兩個），以及同一行裡中文與英數字之間約 3pt 的
    間距，都變成一個空格。
  - 斷行接回，依據 PDF 在行尾有沒有留下空白字元（Word 在硬換行、以及斷在已打空格處時才留下它）：
      全形標點 + 行尾空白        直接接（全形標點之後本來就不空格）；
      中文字 + 行尾空白 + 中文    硬換行（段落、列點）：補一個空格；
      其他有行尾空白的          補一個空格（'Global' + 'Stocktake'、'屬於' + 'ISO'）；
      沒有行尾空白              中文字與英數字交界補一個空格（與同一行內 Word 的中英間距一致），
                                其餘直接接（中文之間，以及詞中間的斷行，例如 'C-' + 'Corp'）。
  - 選項行尾的列舉標點「；」拿掉：PDF 把四個選項排成一句「(A)…；(B)…；(C)…；(D)…」。
  - 字級較小、基線略低的數字是下標（L12 第 8 題的「CO₂」），換成 Unicode 下標並移回所屬的那一行。

其餘照 PDF，特殊字元也不轉換（NFKC 會連照原樣保留的 ₂、全形標點、％、～ 一起改掉）。
下列情形一律丟 ValueError，不猜（兩套程式讀不了的寫法也一樣，見 _unreadable）：
  物件：字典裡同一個鍵寫兩次、名稱裡的 NUL 與不標準的 # 跳脫、詞與詞之間的垂直定位字元、關鍵字裡的 NUL、超過
        NAME_BYTES 的名稱（照原始的寫法數）、不是 Word 寫法的數字、十六進位字串不是偶數個數字以 > 結束、Word 不寫的
        關鍵字或不在它的位置的關鍵字、對不上的 > 與對不上的結尾（字典裡的 ]、陣列裡的 >>）、一個物件不只一個值（串流
        前面也只能有它的字典）、字典
        裡值是 null 的鍵、字串裡不標準的跳脫與 CR、世代號不是 0（參照、xref、物件開頭）、同一個物件在幾段 xref 裡登記的位置
        不同、
        物件串流開頭的編號與位置和 xref 對不上、整個物件只是一個參照、pdfminer 與 MuPDF 採用的 xref 登記逐號不同
        （startxref 沒有單獨一行、新一段把物件標成空的）、xref 表不是標準的 20 個位元組寫法、檔案裡有不是 xref 登記的
        「N G obj」（字串、串流裡的也算）、/Prev 繞回讀過的一段、物件編號超過 OBJECTS、參照指向 xref 沒有登記的物件、
        檔案裡另有 trailer 或沒有讀到的 xref 串流、trailer 後面不是剛好一個字典接 startxref、trailer 的 /Root 不一致、Poppler 或 MuPDF 重建 xref 時讀到的與原本的
        不同（各家讀到不同的物件，或 pdfminer 卡住，見 _syntax_problem；MuPDF 開檔時就重建 xref 的報 xref 壞了）、
        Poppler 重建 xref 時會放棄（物件編號放不下，或找不到 /Root 是參照的 trailer：只有 xref 串流的檔案就是）；
  版面：頁面樹不是 Word 的寫法（根節點只寫 /Type /Pages、/Kids、/Count，每一頁自己寫 /MediaBox）或兩套程式讀到的
        頁面清單不同（見 _page_list_problem）、表格不是每頁剛好一張（空白頁、只有「《以下空白》」的頁另有說明）、某一列不是「答案欄 + 題目欄」兩格
        （表頭除外：灰底會多切出兩格）、表格裡有不屬於任何一列的字、整份找不到選項標記、
        表頭不是「答案｜題目」或不在頁首、題號不連續、答案不是 A–D、選項不是正好 A–D（(E) 也算）、一行兩個選項、
        題幹或選項是空的、續列不是緊接在頁首的表頭之後、同一行裡有定位點的大空隙或連續三個以上的空白
        （無框線的表格，見 _check_spacing）、同一個視覺行的字分成上下兩行（基線錯開超過 3pt 的上下標、分數、
        錯開的兩欄，見 _check_line_overlap）、
        PDF 註解（Link 以外的都算，帶外觀串流 /AP 的 Link 也算：文字方塊、印章、便利貼、螢光筆、表單欄位，
        都不在頁面內容裡）、選擇性內容（圖層）、表單物件（Form XObject）、/Subtype 不是直接名稱的物件
        （見 _layers_or_forms）、xref 表壞了而兩套程式各自重建（讀到的可能是不同版本的頁面，見 _rebuilt_xref；畫完每一頁
        再查一次）、Word 不會寫的圖形狀態（/TR、/TR2、Normal 以外的混色、/SMask）、頁面自己沒有 /Resources 字典
        （沿用上層節點的也算，見 _resources）、Word 不會寫的字型（見 _font_problem：內嵌的只收 Word 的 Type0（帶
        ToUnicode 串流、/CIDSystemInfo (Adobe)(Identity)、/CIDToGIDMap /Identity）與 TrueType、沒有內嵌的不准帶
        ToUnicode、字集與 CMap 不同、/Differences、真實卷沒有用的簡單字型（符號字型）與 /Flags、字型描述裡 Word 不寫的
        欄位、沒有內嵌的 Type0 不是 PyMuPDF 內建中文字型的名稱）、Type 3 字型（頁面資源以外的也算）；
  內容串流：不是兩套 PDF 程式讀法一致的寫法（見 _content_grammar：運算子後面接 NUL 之類的切詞差異、超過各家上限的
        數字、名稱與字串、多給或少給的運算元、inline 圖、圖樣與自訂色彩空間、Word 不寫的文字畫法），或兩套程式解出來的
        位元組不同；
  圖：  題目欄裡有圖片、漸層或向量圖形（矩形、曲線、線段：圖表題的內容讀不到；螢光筆、儲存格底色也算。
        圖片看 pdfminer 讀到的，向量圖形與漸層看 PyMuPDF 真的畫出來的（見 _log_drawings），範圍含線寬：描 16pt
        粗邊的細矩形也算；不論粗細，底線也算：一條細條就能把「一」變成閱讀器上的「二」）、
        題目欄裡有穿過文字中段的細線或細矩形（刪除線、遮住字的白色細條：另外報出位置）、
        答案欄裡除了字還畫了任何東西（不論粗細的矩形與線、圖片、漸層：蓋住、塗改、劃掉的答案，字照樣抽得出來；
        表頭的灰底除外）、圖片或漸層畫在它蓋住的字之後（浮水印也一樣）、範圍無法判斷的漸層、
        不是單一個矩形的剪裁路徑（整頁都查）、浮水印以外的圖片不在任何題目欄裡、浮水印不是 Word 的寫法（圖與遮罩
        的資料也要剛好解完，見 _watermark_problem）、壓在浮水印上的字沒有比浮水印最深的顏色深、或比最淺的淺，到
        MIN_CONTRAST 的對比（深色的圖也會被當成浮水印；黑白細點在閱讀器上平均成灰色，見 _on_watermark）；
  字：  特殊碼位（見 _odd_character；U+0020、U+3000 以外的空白也算，表格外的字也查），以及表格裡旋轉、倒置、
        鏡像、斜切、負字級、壓扁（字寬不到字級的一成）、
        沒有真的畫出來（看不清楚：顏色連同不透明度疊在白紙上，對比不到 MIN_CONTRAST；被剪裁路徑整個切掉；沒有墨跡）、
        畫出來的樣子與 pdfminer 算的不同（兩個方向的縮放不同：被壓扁；墨跡的中心不在 pdfminer 的字框裡：字框被字型描述的
        /Descent 移開，分行分列就跟著錯，見 _drawn）、
        疊印（同一個字印兩次，或不同的字疊在一起）的字，比本文小卻不是下標數字、或不到本文一半的字；
  整頁（包括表格外）：字級超過 MAX_TEXT_SIZE 或不到 MIN_TEXT_SIZE、看不清楚的字、描邊不是同色的加粗或在頁面上超過字級的一成
        （線寬乘上當下座標系的縮放）、表格外的字碰到表格（見 _text_profile、_probe）、表格外的字沒有真的畫出來
        （被剪裁掉、畫到頁面外的「《以下空白》」）；
  反方向：PyMuPDF 畫出來、pdfminer 卻沒有抽到的字與圖，整頁都查（字型的 ToUnicode 把字對到空字串：閱讀器照畫，
        抽出來是空的；圖片 XObject 把 /Width /Height 寫成縮寫的 /W /H：MuPDF 與 Poppler 照畫，pdfminer 整張跳過）。
        字以同一個字、同一個起點（ORIGIN）與字級配對，圖一對一（兩張圖不能共用一張抽到的圖）；
  表格外（含表格兩側的頁邊）：允許清單以外的文字（科目只認 SUBJECTS）、頁碼與頁序不符、「共 M 頁」與實際頁數不符、
        「《以下空白》」不在最後一頁、最後一頁既沒有「共 M 頁」也沒有「《以下空白》」（看不出 PDF 是否被截斷）。

已知擋不住、要靠人工讀一遍的（在目前的公告試題裡都沒有出現）：
  - 換頁表頭之後、兩格版面的題組說明列（會被當成續列併進上一題）；與 (D) 同一格、接在它後面的註記段落
    （會併進選項 D）。
  - 內嵌字型的字形與抽出來的字不一致（ToUnicode 或字型檔自己的對照表說是 A，畫的是 C；有筆畫的字形對到空白也是）：
    擷取只能照對照表，是文字擷取本身的極限。沒有筆畫的字形對到看得見的字（畫的是空白、抽出來是「不」）擋得住：
    內嵌的字型看墨跡，沒有內嵌的字型不准帶 ToUnicode（見 _font_problem）。
  - 墨跡的中心仍在 pdfminer 的字框裡、只移開不到半個字的字框（字型描述的 /Descent 小改）：刻意畫在格線旁邊的字，
    歸到哪一格、哪一行以 pdfminer 的字框為準（真實卷的字離格線都在十點以上）。
  - 只切掉字的一部分的矩形剪裁路徑（還看得到一部分就算畫出來）。
  - 錯開超過四分之一個字寬的不同字（重疊不到 75%）。
  - 表頭列（「答案｜題目」）裡的圖形：表頭不是題目，不影響擷取。
  - Link 註解的外框（/Border）：MuPDF 與 PDFium 都不畫，Acrobat 可能畫一個框（不會蓋住字）。
  - 表格外畫成向量圖形的字（轉成外框、沒有文字層的勘誤），以及表格外蓋在字上的向量圖形：表格外只查文字層與
    圖片（反方向的核對也只核字與圖）；真實卷頁首的橫線本來就壓在字上，沒辦法一律擋。
  - 組合字元與異體字選擇器（Unicode 的 Mn 類，照原樣保留）；字級與本文相同、基線升降不到 3pt 的上下標數字
    （併進同一行，當成一般的字）。
另一個方向（誤報，不會安靜通過）：MediaBox 原點不是 (0,0)、CropBox 比 MediaBox 小、有 /UserUnit、或 /Rotate
不是 0 的 PDF，兩套 PDF 程式的座標對不上，字會被判成沒有畫出來而報錯；有水平縮放的字（Tz 不是 100，例如 Word 的
「字元比例」，或文字矩陣兩個方向的縮放不同）也一樣：pdfminer 的字級不含水平縮放，兩邊的字級對不上。字型只收 8 份
真實卷的寫法（_font_problem）：公告試題改用 Word 內嵌成別種寫法的字型（例如 CFF 的 OpenType 字型）時也會報錯。
Word 以外的程式存的 PDF（Acrobat 的增量更新、根節點帶頁面屬性、別種物件串流的寫法）也一樣（_syntax_problem、
_page_list_problem）。
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
import zlib
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from operator import itemgetter
from pathlib import Path

# 相容字（U+F900–FAFF）不列：_check_chars 已經把它們當特殊碼位擋掉，走不到斷行接回
CJK = re.compile('[\u2e80-\u9fff\uff00-\uffef]')        # 中文字與全形標點
IDEOGRAPH = re.compile('[\u3400-\u4dbf\u4e00-\u9fff]')  # 中文字（不含標點）
NUMBER_RE = re.compile(r'(\d{1,3})\.')
OPTION_RE = re.compile(r'\(([A-Z])\)(.*)')  # 認得 (E)，才擋得住「第五個選項被併進 (D)」
OPTION_MARK = re.compile(r'\([A-Z]\)')
LIST_SEPARATOR = re.compile(r'[；;]\s*$')
DIGITS = frozenset('0123456789')
SUBSCRIPT = str.maketrans('0123456789', '₀₁₂₃₄₅₆₇₈₉')
SMALL = 0.8              # 字級不到本文的八成，就當成下標
TINY = 0.5               # 下標不會不到本文的一半（真實卷 8.04pt 對 12pt，67%）：更小的數字看不見，不是下標
BASELINE_TOLERANCE = 0.5  # 下標的基線不可以比所屬的字高；高出來的是上標（m²），不是下標
X_TOLERANCE = 1.5        # PDF 的字距只有兩群：≤0.3pt（同一個詞）與約 3pt（中英交界），1.5 分得開
Y_TOLERANCE = 3
# 疊印：同一個字又印一次，水平相差不到半個字寬、垂直相差不到半個字級（兩者都至少 1pt）。相鄰的兩個相同字
# 大約相差一個字寬，不會被當成疊印：8 份真實 PDF 同一行的相同字最近是字寬的 0.88 倍（兩個「1」相距 5.28pt）。
OVERPRINT = 1.0
# 不同的字疊在一起：垂直相差不到半個字級、水平重疊超過較窄那個字的 75%。Word 擠壓相鄰的全形標點時字框會重疊，
# 8 份真實卷最多 51%（「）」後面接「」」）。
STACKED = 0.75
SQUASHED = 0.1  # 字寬不到字級的一成是壓扁的字（Tz、文字矩陣）：8 份真實卷最窄的是「.」「,」，25%
SPACES = frozenset(' \u3000')  # 真正的空白。8 份真實卷只有 U+0020；其他 Python 當成空白的字元都算特殊字元
# 細矩形、細線：最窄的一邊 ≤ THIN（Word 的格線）。題目欄裡穿過文字中段的另外報出位置（見 _strike）
THIN = 1.5
# 文字中段：基線以上 15%–75% 字級。刪除線在基線以上約三成；Word 的底線在基線下方，碰不到
STRIKE_ZONE = (0.15, 0.75)
STROKE_COVER = 0.1  # 頁面上的描邊線寬超過字級的一成就糊成一團：8 份真實卷的描邊都是字級的 2.9%（黑 0.343pt／12pt、紅 0.456pt／16pt）
ORIGIN = 0.1        # pdfminer 的字與 PyMuPDF 的字形，起點相差多少以內算同一個：8 份真實卷最多差 0.0002pt
SIZE_MATCH = 0.01   # 兩邊的字級相差一成的十分之一以內
MAX_TEXT_SIZE = 24  # 頁面上的字最大多少 pt：8 份真實卷最大 18pt（大字會蓋住表格或別的字）
MIN_TEXT_SIZE = 6   # 頁面上的字最小多少 pt：8 份真實卷最小 8.04pt（下標）。更小的字閱讀器上看不見，擷取卻抽得到
# 看得清楚：顏色連同不透明度疊在白紙上，與白紙的對比至少 3:1（WCAG 對大字的最低要求，見 _contrast）。8 份真實卷的字
# 只有黑（21:1）與紅（4.0:1），不透明度都是 1。以前逐個色版看 ≥ 0.9 才算白，(1, 1, 0.89) 的字（1.02:1）算看得見（審查實測）
MIN_CONTRAST = 3
# 同一行的字距（見 _check_spacing）。4 份初級卷：相鄰兩個字（空白字元也算）之間的空隙最多 3.2pt（中英間距），
# 兩個字之間最多夾 1 個空白；4 份中級卷：3.3pt、2 個（多打的空白），另有一處定位點空了 16.9pt。
GAP = 9.0
BLANKS = 2

# 表格外的每一行都要完全符合其中一個，或是頁碼、末頁的「《以下空白》」。場次、日期、頁數會變；
# 考試名稱只認淨零碳規劃管理師初級，科目只認 SUBJECTS 裡的：新的要人工確認過版面再加進來。
SUBJECTS = frozenset({'第一科：淨零碳規劃管理基礎概論', '第二科：淨零碳盤查規範與程序概要'})
OUTSIDE_TABLE = tuple(re.compile(p) for p in (
    r'\d{3} 年第[一二三四五六七八九十]+次淨零碳規劃管理師-初級能力鑑定【公告試題】',
    r'考試日期：\d{3} 年 \d{2} 月 \d{2} 日',
    r'※相關法規可能修訂，試題參考答案以該次考試公告時之法規內容為準。',
    r'一、單選題',
))
SUBJECT_LINE = re.compile(r'第[一二三四五六七八九十]+科：.*')
END_MARK = '《以下空白》'
PAGE_NUMBER = re.compile(r'第 (\d+) 頁，共 (\d+) 頁|(\d+)')  # 115 年第一次印「第 N 頁，共 M 頁」，第二次只印 N

# 網頁上會顯示錯、或看起來一樣其實是別的字的碼位（見 _odd_character）。
ODD_CATEGORIES = frozenset({'Cc', 'Cf', 'Co', 'Cs', 'Cn'})  # 控制、格式（零寬空白、軟連字號）、私用區、代理對、未指派
ODD_RANGES = (
    (0x2E80, 0x2FDF),  # CJK 部首補充、康熙部首：U+2F00 長得像「一」
    (0xF900, 0xFAFF),  # CJK 相容字
    (0xFB00, 0xFB4F),  # 拉丁連字等字母表現形式
    (0xFFFD, 0xFFFD),  # 取代字元：轉碼失敗
)
CID = re.compile(r'\(cid:\d+\)')  # pdfminer 對應不到 Unicode 的字形

# PyMuPDF 的 bboxlog 裡字以外的種類（答案欄裡出現就報錯，報錯時用這些名字）
DRAWING_KINDS = {'fill-path': '填色的圖形', 'stroke-path': '線段', 'fill-image': '圖片', 'fill-imgmask': '圖片遮罩',
                 'fill-shade': '漸層'}
COVERING_KINDS = ('fill-image', 'fill-imgmask', 'fill-shade')  # 不可以畫在字之後、蓋住字的
UNBOUNDED = 1e9  # MuPDF 算不出範圍時給的外框是 ±2³¹（沒有 /BBox 的軸向、放射漸層）

# 內容串流的運算子 → 運算元的種類（n 數字、/ 名稱、s 字串、a 陣列、d 字典；見 _content_grammar）。PDF 標準的運算子，
# 扣掉 pdfminer 與閱讀器做法不同的：inline 圖（BI ID EI：pdfminer 只認 /W /H）、Type 3 字形（d0 d1）、相容區段
# （BX EX：不認得的運算子各家處理不同）、引號運算子（' "：pdfminer 的 " 少做 T*）、運算元數目看色彩空間的顏色運算子
# （CS cs SC SCN sc scn：數目不對時兩邊取的不同，也帶進特別色、調色盤、圖樣這些 pdfminer 讀不出真值的色彩空間）。
# 8 份真實卷 102 頁用到其中 29 個，運算元的數目都剛好。
OPERATORS = {
    'w': 'n', 'J': 'n', 'j': 'n', 'M': 'n', 'd': 'an', 'ri': '/', 'i': 'n', 'gs': '/', 'q': '', 'Q': '', 'cm': 'nnnnnn',
    'm': 'nn', 'l': 'nn', 'c': 'nnnnnn', 'v': 'nnnn', 'y': 'nnnn', 'h': '', 're': 'nnnn',
    'S': '', 's': '', 'f': '', 'F': '', 'f*': '', 'B': '', 'B*': '', 'b': '', 'b*': '', 'n': '', 'W': '', 'W*': '',
    'G': 'n', 'g': 'n', 'RG': 'nnn', 'rg': 'nnn', 'K': 'nnnn', 'k': 'nnnn', 'sh': '/', 'Do': '/',
    'BT': '', 'ET': '', 'Tc': 'n', 'Tw': 'n', 'Tz': 'n', 'TL': 'n', 'Tf': '/n', 'Tr': 'n', 'Ts': 'n',
    'Td': 'nn', 'TD': 'nn', 'Tm': 'nnnnnn', 'T*': '', 'Tj': 's', 'TJ': 'a',
    'MP': '/', 'DP': '/d', 'BMC': '/', 'BDC': '/d', 'EMC': '',
}
OPERAND_KINDS = {'n': '數字', '/': '名稱', 's': '字串', 'a': '陣列', 'd': '字典'}
RENDER_MODES = (0, 2)  # Word 只寫 Tr 0（一般的字）與 2（粗體：填色加同色描邊）；_probe 只量 Tr 2 的描邊
# 內容串流的詞：兩套程式切法一定相同、讀出來的值也一定相同的寫法。詞與詞之間只准空白、定位字元、換行與換頁字元（NUL
# 在 MuPDF 是空白、在 pdfminer 是字的一部分，\v 反過來）；數字、名稱、運算子之後要接空白或分隔字元（「1.5.5」「388Tm」
# 「d0」不收）；註解（%）與大括號都不收。每一種詞都有上限，遠低於各家的上限（審查實測：256 字以上的數字與名稱，MuPDF
# 與 PDFium 只讀前 255 字、pdfminer 讀全部；整數部分 2³² 以上，MuPDF 繞回 0）：數字最多 6 位整數、10 位小數，名稱最多
# 127 字、不收 # 跳脫，字串最多 4096 個位元組，十六進位字串不收空白與奇數位，字串只收看得見的 ASCII 與標準的跳脫：
# \n \r \t \b \f \( \) \\ 與正好三位、不超過 \377 的八進位（\777 這種超過一個位元組的，pdfminer 直接出錯，MuPDF 與
# PDFium 取低 8 位；一兩位的八進位不收）。8 份真實卷：數字最多 3 位整數、9 位小數，名稱最多 10 字，字串最多 76 個
# 位元組，沒有跳脫；PyMuPDF 的 clean_contents 把位元組寫成 \000 這種三位的八進位。
SPACE = re.compile(rb'[ \t\n\f\r]*')
TOKEN = re.compile(rb"""
    (?P<number>-?(?:\d{1,6}(?:\.\d{0,10})?|\.\d{1,10}))(?=[ \t\n\f\r\[\]<>(/]|\Z)
  | (?P<name>/[A-Za-z0-9_.+-]{1,127})(?=[ \t\n\f\r\[\]<>(/]|\Z)
  | (?P<string><(?:[0-9A-Fa-f]{2}){0,4096}>|\((?:[\x20-\x27\x2a-\x5b\x5d-\x7e]|\\[nrtbf()\\]|\\[0-3][0-7]{2}){0,4096}\))
  | (?P<open><<|\[)
  | (?P<close>>>|\])
  | (?P<operator>[A-Za-z]+\*?)(?=[ \t\n\f\r\[\]<>(/]|\Z)
""", re.VERBOSE)
FONT_FILES = ('FontFile', 'FontFile2', 'FontFile3')  # 字型描述裡內嵌的字型檔（Type 1、TrueType、CFF／OpenType）
# 簡單字型的 /BaseFont（去掉子集字型的前綴）：前四個是 8 份真實卷的，後兩個是 PyMuPDF 內建的標準字型（合成卷用）
SIMPLE_FONTS = frozenset({'ArialMT', 'TimesNewRomanPSMT', 'TimesNewRomanPS-BoldMT', 'DFKaiShu-SB-Estd-BF',
                          'Helvetica', 'Courier'})
BUILTIN_CJK = frozenset({'Fangti'})  # PyMuPDF 內建中文字型（china-t）的 /BaseFont：合成卷用它，真實卷沒有沒內嵌的 Type0
SUBSET = re.compile(r'^[A-Z]{6}\+')  # 內嵌的子集字型在 /BaseFont 前面加的六個大寫字母與「+」
# 字型描述（/FontDescriptor）裡 Word 會寫的欄位（8 份真實卷的全部），加上字型檔（是哪一種另外查）
ROOT_KEYS = frozenset({'Type', 'Kids', 'Count'})  # Word 的頁面樹根節點只寫這三項：沒有可以沿用給頁面的屬性
DESCRIPTOR_KEYS = frozenset({'Type', 'FontName', 'Flags', 'FontBBox', 'ItalicAngle', 'Ascent', 'Descent', 'CapHeight',
                             'AvgWidth', 'MaxWidth', 'FontWeight', 'XHeight', 'Leading', 'StemV', *FONT_FILES})
OBJECT_HEADER = re.compile(rb'(\d+) 0 obj')  # xref 指到的物件開頭：編號、世代號 0（8 份真實卷每一個都是這樣寫）
SYNTAX = 'PDF 的物件不是 Word 的寫法：'
REBUILT = ('PDF 的 xref 表壞了，pdfminer 或 PyMuPDF 只好自己重建 —— 兩套 PDF 程式讀到的可能是不同版本的頁面，需要人工確認'
           '（重新下載，或向出題單位確認）。')
OBJECTS = 100_000  # 物件編號的上限：8 份真實卷最多 2,870 個物件；再多就不逐一核對（二十萬個就要好幾秒）
XREF_TABLE = re.compile(rb'xref(?:\r\n|\r|\n)')
XREF_SUBSECTION = re.compile(rb'(\d+) (\d+)(?:\r\n|\r|\n)')
XREF_ENTRY = re.compile(rb'\d{10} \d{5} [fn](?: \r| \n|\r\n)')  # 標準的一筆：20 個位元組，類型只有 n 與 f
XREF_TRAILER = re.compile(rb'[\0\t\n\f\r ]*trailer')  # PyMuPDF 在表與 trailer 之間空一行
TRAILER = re.compile(rb'trailer')
# Word 的 trailer：「trailer」、一個不巢狀的字典，接著就是 startxref。pdfminer 的 trailer 是 startxref 之前最後一個
# 物件，Poppler 只讀 trailer 後面第一個（第二十四輪審查實測：字典後面接一個串流、再寫一次字典，pdfminer 讀到第二個，
# Poppler 讀到的是串流，整份打不開）。字典裡的 < > 只能在十六進位字串或一般的字串裡：PyMuPDF 的 /ID 有時寫成一般的
# 字串，隨機的位元組裡剛好有 >。字典裡的大括號由關鍵字那一條擋（OBJECT_KEYWORDS，物件裡的每一處都一樣）
NAME_HEX = re.compile(rb'[0-9A-Fa-f]')  # 名稱裡 # 後面的一位（pdfminer 的 HEX）
NAME_BYTES = 127  # 物件裡名稱的上限（照原始的寫法數，# 跳脫算三個位元組），與內容串流的相同；10 份真實 PDF 最長 33
# 物件裡的數字（pdfminer 讀到的原始寫法）：可以有負號、最多 9 位整數（10⁹ 以下，在 2³¹ 以內）與 10 位小數，後面接空白或
# 分隔字元。與內容串流的數字同一種寫法，整數多三位，給整數的欄位用（xref 的位置、串流的長度）；當成實數讀的欄位超過 2²⁴
# 時，MuPDF 與 PDFium 以 32 位元的浮點數讀（16777217 讀成 16777216），頁面的座標遠小於這個數。10 份真實 PDF（12 個
# 檔案，有 2 個是重複的）：最多 6 位整數、2 位小數，後面只接空白、/、>、[、]。後面的空白照 pdfminer 的算（含垂直定位
# 字元，由詞與詞之間的那一條擋，說出真正的原因）；) 不算分隔：多出來的 ) 由關鍵字那一條擋
OBJECT_NUMBER = re.compile(rb'-?(?:\d{1,9}(?:\.\d{0,10})?|\.\d{1,10})')
NUMBER_END = re.compile(rb'[\s\0(<>\[\]/%]')
HEX_STRING = re.compile(rb'(?:[0-9A-Fa-f]{2})*')  # 物件裡十六進位字串的內容：偶數個數字、沒有空白（與內容串流的相同）
# 物件裡的關鍵字（pdfminer 讀到的）：10 份真實 PDF 只有 null 以外的這幾個；null 是 PDF 的空值（PyMuPDF 會寫）。位置另外
# 查（Watched.do_keyword）：物件串流裡的 null pdfminer 讀成關鍵字、不是空值，所以物件串流裡只收 R
OBJECT_KEYWORDS = frozenset({b'obj', b'endobj', b'stream', b'endstream', b'R', b'xref', b'trailer', b'startxref', b'<<',
                             b'>>', b'[', b']', b'null'})
NOT_ON_TOP = frozenset({b'obj', b'xref', b'trailer', b'null'})  # 不會出現在檔案裡物件最上層的關鍵字（xref 與 trailer pdfminer 另外讀）
# 字串裡反斜線後面的第一個字：標準的跳脫、八進位數字與 LF（接下一行）。CR 不收：CR 落在 pdfminer 緩衝區的最後一個
# 位元組時，後面的 LF 被 pdfminer 讀進字串，閱讀器不會（第三十三輪審查實測）。10 份真實 PDF 的物件裡只有 ( ) \\ n r
STRING_ESCAPES = frozenset(bytes((c,)) for c in b'nrtbf()\\01234567\n')
STRING_PART = re.compile(rb'[()\\]')  # 字串裡 pdfminer 照原樣收下的一段到哪裡為止（pdfminer 的 END_STRING）
PDFMINER_WORD = re.compile(rb'\S')  # pdfminer 的 NONSPC：它的空白多一個垂直定位字元
PDF_STRING = rb'\((?:[^()\\]|\\[\s\S]|\((?:[^()\\]|\\[\s\S])*\))*\)'  # 一般的字串：跳脫與一層括號
TRAILER_FORM = re.compile(rb'trailer[\r\n ]*<<(?:[^<>()]|<[0-9A-Fa-f]*>|' + PDF_STRING + rb')*>>[\r\n ]*startxref')
COMMENT = re.compile(rb'%[^\r\n]*')  # 一段註解：到行尾
# 「N G obj」這幾個字，字串、串流裡的也算。註解先換成同樣長的空白（PDFium 與 MuPDF 重建 xref 時逐詞掃描，空白與
# 註解都跳過），再找以空白隔開的兩串數字與 obj。一串數字只從頭算（不然一長串數字從每一位各找一次，時間是平方）
DEFINITION = re.compile(rb'(?<![0-9])([0-9]+)[\0\t\n\f\r ]+([0-9]+)[\0\t\n\f\r ]+obj(?![A-Za-z0-9])')
FILLER = re.compile(rb'(?:[\0\t\n\f\r ]|%[^\r\n]*)*')  # 從一個位置開始讀物件時，各家先跳過的空白與註解
POPPLER_LINE = 256                         # Poppler 的 getLine(buf, 256)：一次最多讀 255 個字元
POPPLER_SPACE = frozenset(b'\0\t\n\f\r ')  # Poppler 的 Lexer::isSpace
# Poppler 重建 xref 時放得下的物件編號（不含）：XRef::constructXRef 先把 xref 撐到那一號，XRef::reserve 的容量從 1024 起
# 加倍，到了 INT_MAX / sizeof(XRefEntry) 就放棄（Too large XRef size；INT_MAX − 1 − 255 以上的另報 Bad object number）。
# XRefEntry 在 32 到 63 個位元組之間時都是從第 2²⁵ 號起；這台 x86-64 的 Poppler 25.03.0 實測 2²⁵ − 1 照常重建、2²⁵ 放棄
POPPLER_XREF = 2 ** 25
C_SPACE = frozenset(b'\t\n\v\f\r ')        # C 的 isspace（多一個 \v）
ASCII_DIGITS = frozenset(b'0123456789')
LINE_END = re.compile(rb'[\r\n]')
DEPTH = 4     # 陣列、字典最多疊幾層：8 份真實卷最多 2 層（BDC 的 <</Attached [/Top]>>）
ITEMS = 1024  # 一個陣列或字典最多幾項：8 份真實卷最多 43 項（一個 TJ）


@dataclass(frozen=True)
class Row:
    """表格的一列。lines 是題目欄的各行；PDF 在行尾留了空白字元的，保留一個空格（斷行的判斷依據）。"""
    page: int
    answer: str
    number: str
    lines: tuple[str, ...]
    figures: int = 0  # 題目欄裡的圖片（浮水印除外）與向量圖形數


def _latin(ch: str) -> bool:
    return ch.isascii() and ch.isalnum()


def join_lines(a: str, b: str) -> str:
    """把下一行 b 接到 a 後面。a 的行尾空白是 PDF 留下的斷行訊號（見模組說明），b 不含開頭空白。"""
    if not a.strip():
        return b
    if not b.strip():
        return a
    trailing = a != a.rstrip()
    a = a.rstrip()
    x, y = a[-1], b[0]
    if trailing:
        return a + b if CJK.match(x) and not IDEOGRAPH.match(x) else a + ' ' + b
    if (IDEOGRAPH.match(x) and _latin(y)) or (_latin(x) and IDEOGRAPH.match(y)):
        return a + ' ' + b
    return a + b


def inline_subscripts(chars: list[dict], where: str = '') -> list[dict]:
    """小字級的數字（CO₂ 的 2）換成 Unicode 下標，並移到它所屬的那一行。

    所屬的字 = 它左邊最近、字級正常、垂直範圍涵蓋它頂端、基線不比它低的那個字（CO₂ 的 O）。
    比本文小、卻不是單一個數字，不到本文的一半（TINY：看不見的字），或找不到所屬的字（例如基線較高的上標），
    一律 ValueError。where 是報錯時說的位置（第幾頁第幾列）。
    """
    sizes = Counter(c['size'] for c in chars if c['text'].strip())
    if not sizes:
        return list(chars)
    body = max(sizes.items(), key=lambda kv: (kv[1], kv[0]))[0]  # 最常見的字級；同樣多時取大的
    small = body * SMALL
    normal = [c for c in chars if c['size'] >= small]
    out = []
    for c in chars:
        if c['size'] >= small or not c['text'].strip():
            out.append(c)
            continue
        at = f'（x={c["x0"]:.1f}, top={c["top"]:.1f}）'
        if c['text'] not in DIGITS:
            raise ValueError(f'{where}小字級的「{c["text"]}」{at}不是單一個數字 —— 版面不在預期內，需要人工確認。')
        if c['size'] < body * TINY:
            raise ValueError(f'{where}小字級的「{c["text"]}」{at}只有 {c["size"]:.2g}pt，不到本文（{body:g}pt）的一半 —— '
                             '太小，不是下標，閱讀器上幾乎看不到，會被混進題目，需要人工確認。')
        hosts = [h for h in normal
                 if h['x1'] <= c['x0'] + X_TOLERANCE and h['top'] <= c['top'] < h['bottom']
                 and c['bottom'] >= h['bottom'] - BASELINE_TOLERANCE]
        if not hosts:
            raise ValueError(f'{where}找不到小字級「{c["text"]}」{at}所屬的字 —— 它不是下標（上標或位置不明），'
                             '需要人工確認。')
        host = max(hosts, key=lambda h: h['x1'])
        out.append({**c, 'text': c['text'].translate(SUBSCRIPT),
                    **{k: host[k] for k in ('top', 'bottom', 'doctop', 'y0', 'y1') if k in host}})
    return out


def _check_spacing(line: list[dict], where: str) -> None:
    """同一行的字（照左緣排好）：兩個相鄰的非空白字之間，有超過 GAP 的空隙（連空白字元都沒有，例如定位點），
    或夾著超過 BLANKS 個空白字元，就是用定位點或空白排的版面（無框線的表格、對齊的清單），擷取時會被攤平成一行，
    一律 ValueError。行首、行尾的空白不算；一兩個空白（全形空白也是）照常併成一個空格。"""
    prev = right = None  # 上一個非空白字；到目前為止字框蓋到的最右邊（字框會重疊，不能只看前一個字）
    widest, blanks = 0.0, 0  # 從上一個非空白字到這裡：最大的空隙、夾著的空白字元數
    for c in line:
        if right is not None:
            widest = max(widest, c['x0'] - right)
        right = c['x1'] if right is None else max(right, c['x1'])
        if not c['text'].strip():
            blanks += 1
            continue
        if prev is not None:
            at = f'（x={prev["x1"]:.1f}–{c["x0"]:.1f}, top={c["top"]:.1f}）'
            if widest > GAP:
                raise ValueError(f'{where}同一行的「{prev["text"]}」與「{c["text"]}」之間有 {widest:.1f}pt 的空隙{at}，'
                                 f'超過 {GAP:g}pt —— 可能是用定位點排的表格或清單，擷取時會被攤平成一行，需要人工確認。')
            if blanks > BLANKS:
                raise ValueError(f'{where}同一行的「{prev["text"]}」與「{c["text"]}」之間連續 {blanks} 個空白{at}，'
                                 f'超過 {BLANKS} 個 —— 可能是用空白對齊排的表格，擷取時會被攤平成一行，需要人工確認。')
        prev, widest, blanks = c, 0.0, 0


def _check_line_overlap(lines: list[list[dict]], where: str) -> None:
    """分好的行（由上而下）：任兩行的字（空白字元不算）垂直範圍重疊，就是同一個視覺行被拆成兩行 —— 基線錯開
    超過 Y_TOLERANCE 的字（同字級的上下標、分數、錯開的兩欄）會被搬到別行或攤平，一律 ValueError。
    8 份真實卷相鄰兩行之間至少隔 6.6pt；下標在分行之前已經併回所屬的行。只比上一行就夠：沒有重疊的話，
    每一行都從上一行的下緣以下開始，下緣也就一行比一行低。"""
    above = None  # 上一行：(下緣, 字)
    for line in lines:
        ink = sorted((c for c in line if c['text'].strip()), key=itemgetter('x0'))
        if not ink:
            continue
        top = min(c['top'] for c in ink)
        if above is not None and top < above[0]:
            upper, lower = (''.join(c['text'] for c in chars)[:12] for chars in (above[1], ink))
            raise ValueError(f'{where}同一行的字分成了上下兩行：「{upper}」與「{lower}」（top={top:.1f}）的垂直範圍重疊 '
                             f'{above[0] - top:.1f}pt —— 基線錯開超過 {Y_TOLERANCE}pt 的字會被搬到別行（題幹的最前面或'
                             '最後面）或把兩欄攤平，需要人工確認。')
        above = (max(c['bottom'] for c in ink), ink)


def text_lines(chars: list[dict], where: str = '') -> list[str]:
    """題目欄的字元 → 各行文字：行內空白一律一個，去掉開頭空白，行尾空白保留一個，丟掉空行。

    行照 pdfplumber 分行的方式分（依 top、容差 Y_TOLERANCE），每一行先過 _check_spacing，行與行之間過
    _check_line_overlap。where 是報錯時說的位置（第幾頁第幾列）。
    """
    from pdfplumber.utils import cluster_objects, extract_text  # 延後 import：只處理列的單元測試不需要它

    chars = inline_subscripts(chars, where)
    lines = cluster_objects(chars, itemgetter('top'), Y_TOLERANCE)
    for line in lines:
        _check_spacing(sorted(line, key=itemgetter('x0')), where)
    _check_line_overlap(lines, where)
    text = extract_text(chars, x_tolerance=X_TOLERANCE, y_tolerance=Y_TOLERANCE, keep_blank_chars=True)
    lines = (re.sub(r'\s+', ' ', line).lstrip() for line in text.split('\n'))
    return [line for line in lines if line.strip()]


def _mid(obj: dict) -> tuple[float, float]:
    return (obj['x0'] + obj['x1']) / 2, (obj['top'] + obj['bottom']) / 2


def _inside(obj: dict, box) -> bool:
    x, y = _mid(obj)
    return box[0] <= x < box[2] and box[1] <= y < box[3]


def _overlaps(obj: dict, box) -> bool:
    return obj['x0'] < box[2] and box[0] < obj['x1'] and obj['top'] < box[3] and box[1] < obj['bottom']


def _intersects(a, b) -> bool:
    """兩個 (x0, top, x1, bottom) 框有沒有重疊（PyMuPDF 的 bboxlog 給的就是這種框）。"""
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _luminance(rgb, alpha=1.0) -> float:
    """顏色（0–1 的 RGB）以不透明度 alpha 疊在白紙上的相對亮度（WCAG 2 的算法）：白紙是 1，黑色是 0。"""
    def channel(value):
        value = alpha * value + 1 - alpha
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
    red, green, blue = map(channel, rgb)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _contrast(rgb, alpha=1.0) -> float:
    """顏色（0–1 的 RGB）以不透明度 alpha 疊在白紙上，與白紙的對比（WCAG 2 的算法）：1 是看不見，黑色是 21。"""
    return 1.05 / (_luminance(rgb, alpha) + 0.05)


def _shades(doc, xref) -> list[float]:
    """圖片（連同它的 /SMask）疊在白紙上，每一種顏色的相對亮度（_luminance），由深到淺排好；圖片先照
    _watermark_problem 查過（/DeviceRGB，遮罩是同樣大小的 /DeviceGray）。PyMuPDF 的 Pixmap(doc, xref) 不套 /SMask：
    遮罩帶 /Matte（Word 的寫法）時，顏色已經照遮罩還原（除以透明度，超過 255 的夾回 255），另給一個全是 255 的
    alpha，要先拿掉，再把遮罩接上去；接上去之後的顏色是預乘過的，疊在白紙上是 c + 255 − a（單色的一塊與 MuPDF 自己
    畫在白紙上的相差不到一個色階）。閱讀器縮放時相鄰的點會混在一起，混出來的顏色可能在最深與最淺之間，MuPDF 與
    Poppler 在透明與不透明的交界還會更深一些（_on_watermark）。"""
    import pymupdf  # 延後 import：只處理列的單元測試不需要它

    pix = pymupdf.Pixmap(doc, xref)
    if pix.alpha:
        pix = pymupdf.Pixmap(pix, 0)
    kind, value = doc.xref_get_key(xref, 'SMask')
    if kind == 'xref':
        pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, int(value.split()[0])))
    samples = pix.samples
    if pix.alpha:
        colours = {(red + 255 - alpha, green + 255 - alpha, blue + 255 - alpha) for red, green, blue, alpha
                   in zip(samples[0::4], samples[1::4], samples[2::4], samples[3::4])}
    else:
        colours = set(zip(samples[0::3], samples[1::3], samples[2::3]))
    return sorted({_luminance((red / 255, green / 255, blue / 255)) for red, green, blue in colours})


def _skewed(char: dict) -> bool:
    """字不是正放的：旋轉、倒置、鏡像或斜切。pdfminer 的 upright 只看 a·d 與 b·c 的正負，擋得住鏡像；
    但轉 180 度（a、d 都是負的）時仍是 True，斜切與小角度的旋轉也擋不住，所以另外要求 d > 0、b 與 c 是 0：
    b 與 a 比（水平軸轉了多少）、c 與 d 比（垂直軸斜了多少），超過千分之一（0.06 度）就算。以前與絕對的 1e-3 比：
    pdfminer 的矩陣不含 Tf 的字級，文字矩陣縮小 1000 倍、字級放大 1000 倍，b、c 只有 0.0007 就是轉了 45 度（第十一輪
    審查實測：「×」擷取成「+」）。8 份真實卷每一個字的 b、c 都是 0。
    負字級（`/F1 -12 Tf`）不在矩陣裡：字倒過來、由右往左排，只看得出前進量（adv）是負的。"""
    a, b, c, d = char['matrix'][:4]
    return (not char['upright'] or d <= 0 or abs(b) > 1e-3 * abs(a) or abs(c) > 1e-3 * abs(d)
            or char['adv'] < 0)


def _odd_character(text: str) -> str | None:
    """網頁上會顯示錯、或看起來一樣其實是別的字的碼位（ODD_CATEGORIES、ODD_RANGES、CID），以及 SPACES 以外的空白
    （不斷行空白、em 空白、分行符；控制字元已在 Cc 裡）：看得見的字對到它們會安靜地變成空格。回傳描述，沒有就回 None。"""
    if m := CID.search(text):
        return m.group()
    for ch in text:
        if (unicodedata.category(ch) in ODD_CATEGORIES or any(lo <= ord(ch) <= hi for lo, hi in ODD_RANGES)
                or (ch.isspace() and ch not in SPACES)):
            return f'U+{ord(ch):04X} {unicodedata.name(ch, "")}'.rstrip()
    return None


def _rawdict(page, flags):
    """PyMuPDF rawdict 的每一個字：(字, 起點, 字所在那一段的字級, 字框)。"""
    return [(char['c'], tuple(char['origin']), span['size'], tuple(char['bbox']))
            for block in page.get_text('rawdict', flags=flags)['blocks']
            for line in block.get('lines', ()) for span in line['spans'] for char in span['chars']]


def _visible_glyphs(page, trace=None) -> dict[str, list[tuple]]:
    """PyMuPDF 真的畫出來、看得清楚的字形：字 → [(起點 x, 起點 y, 字級, 紀錄)]，紀錄是 rawdict 裡同一個字、同一個
    起點的每一筆 (兩個方向的縮放, 墨跡)。pdfminer 不看顏色、透明度與剪裁，看不見的字照樣抽得出來。
    看得清楚看 texttrace 的顏色（它換算成 RGB；描邊的字形是描邊色）連同不透明度：與白紙的對比至少 MIN_CONTRAST
    （_contrast）。被剪裁路徑整個切掉的字 texttrace 照列、TEXT_CLIP 的 rawdict 不列：rawdict 裡沒有同一個字、同一個
    起點的紀錄，就不算畫出來。trace 是這一頁的 texttrace（呼叫端已經取過就傳進來）。
    - 字級是 texttrace 的：文字矩陣水平方向的縮放。兩個方向的縮放是 rawdict 的字級：矩陣行列式的平方根（√|ad−bc|），
      垂直方向被壓扁的字，它就變小。
    - 墨跡是 rawdict 開 TEXT_ACCURATE_BBOXES 算的字形外框（筆畫實際畫到哪裡，不是字型宣稱的上下緣）；沒有筆畫的字形
      沒有墨跡。沒有內嵌的字型，MuPDF 給的是整個字型的外框（所以沒有內嵌的字型不准帶 ToUnicode，見 _font_problem）。
    - 以（字, 起點）配對：以前只對起點，同一個起點上別的字形（空白、別的字）都能替它作證 —— 倒過來的 51pt 空白
      借出墨跡，被 /Descent 移開字框的選項標記就過了；兩個空白湊足數目，被剪掉、被 float32 下溢壓扁的「不」就算畫出來
      （第十一輪審查實測）。8 份真實卷每一個不是空白的字形，texttrace 與 rawdict 的（字, 起點）都對得上（空白不查：
      呼叫端只核對看得見的字）。
    - texttrace 的字先依（字, 起點）去重：填色加描邊的字（Word 表頭的粗體）它列兩次，rawdict 只列一次。
    - 描邊蓋掉填色（別的顏色、在頁面上太粗的描邊）不在這裡判斷：整頁的字另由 _text_profile、_probe 擋。"""
    import pymupdf  # 延後 import：只處理列的單元測試不需要它

    flags = (pymupdf.TEXT_CLIP | pymupdf.TEXT_PRESERVE_LIGATURES | pymupdf.TEXT_PRESERVE_WHITESPACE
             | pymupdf.TEXT_IGNORE_ACTUALTEXT  # 不照 ActualText 換字：起點才對得上 texttrace
             | pymupdf.TEXT_ACCURATE_BBOXES)
    records: dict[tuple[str, tuple[float, float]], list[tuple]] = {}  # (字, 起點) → [(兩個方向的縮放, 墨跡)]
    for text, origin, scale, ink in _rawdict(page, flags):
        records.setdefault((text, origin), []).append((scale, ink))
    visible: dict[tuple[str, tuple[float, float]], float] = {}  # (字, 起點) → 字級
    for span in page.get_texttrace() if trace is None else trace:
        if _contrast(span['color'], span['opacity']) >= MIN_CONTRAST:
            for ucs, _, origin, _ in span['chars']:
                visible[(chr(ucs), tuple(origin))] = span['size']
    glyphs: dict[str, list[tuple]] = {}
    for (text, origin), size in visible.items():
        if (text, origin) in records:
            glyphs.setdefault(text, []).append((*origin, size, tuple(records[(text, origin)])))
    return glyphs


def _origin(char: dict) -> tuple[float, float]:
    """pdfminer 的字的起點（基線上、左緣），換成 PyMuPDF 的座標（原點在左上）：矩陣的 e、f 是起點（原點在左下）。"""
    return char['matrix'][4], char['top'] + char['y1'] - char['matrix'][5]


def _same_glyph(char_origin, char_size, origin, size) -> bool:
    """同一個字形：起點相差 ORIGIN 以內、字級相差 SIZE_MATCH 以內。以前比的是「左緣 0.5pt、垂直中心半個字級」：
    字級由 PDF 決定，400pt 的隱形字就能借到 200pt 外另一列同一個字母的「看得見」（審查實測：兩題答案互換）。"""
    return (abs(char_origin[0] - origin[0]) <= ORIGIN and abs(char_origin[1] - origin[1]) <= ORIGIN
            and abs(char_size - size) <= SIZE_MATCH * max(char_size, size))


def _drawn(char: dict, glyphs) -> bool:
    """pdfplumber 的字在 PyMuPDF 畫出來的字形（_visible_glyphs）裡找得到：同一個字、同一個起點與字級（_same_glyph），
    而且畫出來的樣子就是 pdfminer 算的樣子 —— rawdict 裡這個字形自己的某一筆紀錄同時符合：
    - 兩個方向的縮放也與 pdfminer 的字級（字框的高）相差 SIZE_MATCH 以內：兩套程式讀到不同的矩陣時，閱讀器上的字
      可能被壓成一條線，水平方向的字級卻相同（審查實測：256 字的數字，MuPDF 只讀到 1、pdfminer 讀到 10）；
    - 真的有墨跡（寬與高都大於 0：沒有筆畫的字形對到「不」，閱讀器上是空的），而且墨跡的垂直中心落在 pdfminer 的
      字框裡：分行、分列都看 pdfminer 的字框，它是 pdfminer 用字型描述（/Descent）自己算的；把 /Descent 改大，字框
      往下移一行，選項標記就配到下一行的文字，閱讀器上的字卻沒動（審查實測）。
    8 份真實卷的每一個字都對得上：兩種字級相差不到十億分之五，墨跡的中心離字框邊緣至少字級的 18%。
    對不上也可能是兩邊解碼不同（少見的字型編碼），一樣報錯。"""
    here = _origin(char)
    for x, y, size, records in glyphs.get(char['text'], ()):
        if _same_glyph(here, char['size'], (x, y), size) and any(
                abs(scale - char['size']) <= SIZE_MATCH * max(scale, char['size'])
                and ink[2] > ink[0] and ink[3] > ink[1] and char['top'] <= (ink[1] + ink[3]) / 2 <= char['bottom']
                for scale, ink in records):
            return True
    return False


def _check_chars(chars: list[dict], where: str, glyphs) -> None:
    """表格一列裡的字：碼位（空白字元也查：只有 SPACES 是真正的空白）、方向、字寬、有沒有真的畫出來（看得清楚、
    沒被剪掉，見 _visible_glyphs）、有沒有疊印（同一個字印兩次，或不同的字疊在一起）。where 是報錯時說的位置。"""
    seen: dict[str, list[dict]] = {}
    for c in chars:
        text = c['text']
        at = f'（x={c["x0"]:.1f}, top={c["top"]:.1f}）'
        odd = _odd_character(text)
        if odd:
            raise ValueError(f'{where}有特殊字元 {odd}{at} —— 網頁會顯示錯，或看起來一樣其實是別的字，'
                             '需要人工確認後換成正確的字。')
        if not text.strip():
            continue
        if _skewed(c):
            raise ValueError(f'{where}有旋轉、鏡像或斜切的字「{text}」{at} —— 會被混進題目，需要人工確認。')
        if c['x1'] - c['x0'] < SQUASHED * c['size']:
            raise ValueError(f'{where}有壓扁的字「{text}」{at}：字寬 {c["x1"] - c["x0"]:.2f}pt，不到字級 {c["size"]:g}pt '
                             '的一成 —— 閱讀器上幾乎看不到，會被混進題目，需要人工確認。')
        if not _drawn(c, glyphs):
            raise ValueError(f'{where}的字「{text}」{at}在 PyMuPDF 畫出的頁面上找不到：沒有真的畫出來（看不清楚：與白紙的'
                             f'對比不到 {MIN_CONTRAST}:1，或被剪裁掉、沒有墨跡），或兩套 PDF 程式讀到的字、位置、大小不同'
                             ' —— 會被混進題目，需要人工確認。')
        same = seen.setdefault(text, [])
        dx, dy = max(OVERPRINT, (c['x1'] - c['x0']) / 2), max(OVERPRINT, c['size'] / 2)
        if any(abs(o['x0'] - c['x0']) < dx and abs(o['top'] - c['top']) < dy for o in same):
            raise ValueError(f'{where}的字「{text}」{at}在同一個位置印了兩次（疊印）—— 抽出來會重複，需要人工確認。')
        same.append(c)
    ink = sorted((c for c in chars if c['text'].strip()), key=itemgetter('x0'))
    for i, a in enumerate(ink):  # 不同的字疊在一起：依左緣排好，只比水平上重疊的
        for b in ink[i + 1:]:
            if b['x0'] >= a['x1']:
                break
            overlap = min(a['x1'], b['x1']) - b['x0']
            if (a['text'] != b['text'] and abs(a['top'] - b['top']) < max(OVERPRINT, min(a['size'], b['size']) / 2)
                    and overlap > STACKED * min(a['x1'] - a['x0'], b['x1'] - b['x0'])):
                raise ValueError(f'{where}的字「{b["text"]}」（x={b["x0"]:.1f}, top={b["top"]:.1f}）與「{a["text"]}」'
                                 '疊在一起（疊印）—— 抽出來兩個字都在，閱讀器上卻疊成一團，需要人工確認。')


def _check_page_numbers(numbers: dict[int, list[tuple[int, int | None]]], ends: list[int], total: int) -> None:
    """頁碼要與頁序一致、「共 M 頁」要等於實際頁數，而且看得出最後一頁：被截斷的 PDF 不能安靜地少幾題。

    numbers：頁序 → 那一頁印的（頁碼, 總頁數或 None）；ends：有「《以下空白》」的頁序。
    """
    for pno in range(1, total + 1):
        found = numbers.get(pno, [])
        if len(found) != 1:
            raise ValueError(f'第 {pno} 頁找到 {len(found)} 個頁碼，應為 1 個 —— 版面不在預期內，需要人工確認。')
        number, of = found[0]
        if number != pno or of not in (None, total):
            printed = f'第 {number} 頁' + (f'，共 {of} 頁' if of else '')
            raise ValueError(f'第 {pno} 頁印的是「{printed}」，但這份 PDF 有 {total} 頁、這是第 {pno} 頁'
                             ' —— 頁面缺漏、多出或順序不對（可能被截斷），需要人工確認。')
    early = [pno for pno in ends if pno != total]
    if early:
        raise ValueError(f'第 {early[0]} 頁有「{END_MARK}」，但它不是最後一頁 —— 後面多出來的頁面需要人工確認。')
    if numbers[total][0][1] is None and total not in ends:
        raise ValueError(f'最後一頁（第 {total} 頁）的頁碼沒有「共 M 頁」，也沒有「{END_MARK}」'
                         '—— 看不出 PDF 是否完整（可能被截斷），需要人工確認。')


def _digest(obj) -> str:
    """PDF 物件的內容雜湊：字典（鍵排序）與陣列逐項展開，間接參照換成它指向的物件，串流再加上原始位元組的雜湊。
    物件編號與鍵的順序不算在內，所以兩份一模一樣的物件雜湊相同；圖片資料、色彩空間、遮罩、Decode 等任何一項
    不同就不同。比「同一個物件」寬的只有這一點：內容逐位元相同、只是存了好幾份，畫出來一定一樣。
    obj 是 pdfplumber 給的 pdfminer 物件（圖片的 stream）；依類別名稱分辨，不另外 import pdfminer。"""
    def canonical(o, path: tuple[int, ...]):
        kind = type(o).__name__
        if kind == 'PDFObjRef':
            if o.objid in path:  # 參照回上層：記往上第幾層，不記物件編號
                return ('^', len(path) - path.index(o.objid))
            return canonical(o.resolve(), (*path, o.objid))
        if kind == 'PDFStream':
            raw = o.get_rawdata()
            data = ('raw', raw) if raw is not None else ('decoded', o.get_data())
            return (kind, canonical(o.attrs, path), data[0], hashlib.sha256(data[1]).hexdigest())
        if isinstance(o, dict):
            items = sorted(o.items(), key=lambda kv: str(kv[0]))
            return ('dict', tuple((str(k), canonical(v, path)) for k, v in items))
        if isinstance(o, (list, tuple)):
            return ('list', tuple(canonical(v, path) for v in o))
        return (kind, repr(o))  # 數字、字串、名稱（PSLiteral 的 repr 就是 /'名稱'）

    return hashlib.sha256(repr(canonical(obj, ())).encode()).hexdigest()


def _image_key(image: dict) -> tuple:
    """同一張圖、同一個位置。圖比的是內容（_digest），不是物件編號：有的 PDF 每一頁各存一份一樣的浮水印；
    也不是頁內的資源名稱：不同的圖在各頁可能叫同一個名字。"""
    return (_digest(image['stream']), *(round(image[k]) for k in ('x0', 'top', 'x1', 'bottom')))


def _inner(box) -> tuple[float, float, float, float]:
    """儲存格往內縮 2pt：格線是細矩形（最窄的一邊 ≤ THIN），表頭底色只蓋到下一列 0.4pt，內縮之後都碰不到。"""
    return box[0] + 2, box[1] + 2, box[2] - 2, box[3] - 2


def _log_drawings(log, box) -> int:
    """儲存格內部 PyMuPDF 真的畫出來的向量圖形（填色與描線：矩形、曲線、線段），不論粗細。細的也算：一條細條就能把
    「一」變成閱讀器上的「二」，底線也一樣（審查在真實卷上實測）；8 份真實卷的題目欄內縮框裡什麼圖形都沒有。
    bboxlog 的外框含線寬：0.2pt 高的細矩形描 16pt 粗的邊也算（pdfminer 只看得到一條細線）。內容串流已經限定成兩邊讀法
    一致的寫法，pdfminer 讀到的圖形 bboxlog 都有，所以只看這一邊。"""
    inner = _inner(box)
    return sum(1 for kind, b in log if kind in ('fill-path', 'stroke-path') and _intersects(b, inner))


def _unextracted_glyph(trace, chars):
    """反方向的核對：PyMuPDF 畫出來、pdfminer 卻沒有抽到的字（空白不算）：同一個字、同一個起點與字級（_same_glyph，
    與 _drawn 相同）。內容串流已經限定成兩邊讀法一致的寫法（_content_grammar），剩下的是字型：ToUnicode 把字對到
    空字串，閱讀器照畫，pdfminer 抽出來是空的。8 份真實卷全頁 90,263 個字形都對得上。回傳 (字, 字框)，沒有就回 None。"""
    known: dict[str, list[tuple[tuple[float, float], float]]] = {}
    for c in chars:
        known.setdefault(c['text'], []).append((_origin(c), c['size']))
    for span in trace:
        for ucs, _, origin, bbox in span['chars']:
            text = chr(ucs)
            if not text.isspace() and not any(_same_glyph(here, size, origin, span['size'])
                                               for here, size in known.get(text, ())):
                return text, bbox
    return None


def _unextracted_image(log, images):
    """反方向的核對：PyMuPDF 畫出來、pdfminer 卻沒有的圖（圖片與圖片遮罩）：外框相差 1pt 內要對得到 pdfplumber 的
    一張圖。pdfminer 讀不出、閱讀器照樣畫的圖，題目欄裡的圖表會被當成純文字題。已知兩種：inline 圖寫完整的
    /Width /Height（pdfminer 只認 /W /H），在內容串流的檢查就擋掉了；圖片 XObject 反過來寫縮寫的 /W /H（pdfminer 的
    Do 要有 /Width /Height 才讀，MuPDF 與 Poppler 照畫；第二十輪審查實測），只有這一道擋得到。8 份真實卷的 104 張圖
    都對得上。回傳圖的外框，沒有就回 None。"""
    free = [(im['x0'], im['top'], im['x1'], im['bottom']) for im in images]  # 一對一：對上的就拿掉
    for kind, box in log:
        if kind in ('fill-image', 'fill-imgmask'):
            match = next((known for known in free if all(abs(a - b) <= 1 for a, b in zip(box, known))), None)
            if match is None:  # 兩張圖同一個外框（藏在浮水印的位置）只有一張對得上
                return box
            free.remove(match)
    return None


def _text_profile(trace, table_box) -> str | None:
    """整頁的字要像 Word 寫出來的（8 份真實卷全是這樣）：字級在 MIN_TEXT_SIZE 到 MAX_TEXT_SIZE 之間、看得清楚
    （顏色連同不透明度，與白紙的對比至少 MIN_CONTRAST）、描邊只用來加粗（同一個字、同一個起點上有同色的填色）、
    表格外的字不碰到表格。表格裡的字另外逐字核對（_check_chars）；這裡管的是整頁，包括表格外。回傳錯誤訊息，
    沒有就回 None。
    以前只查表格裡的字：表格下方允許的「《以下空白》」描 90pt 的白邊，蓋掉第 5 題的選項 (D)；400pt 的白色
    「一、單選題」每個字的中心都在表格外，橫畫卻塗白了半張表（審查實測）。"""
    fills = {}
    for span in trace:
        if span['type'] == 0:
            for ucs, _, origin, _ in span['chars']:
                fills[(ucs, tuple(origin))] = tuple(span['color'])
    for span in trace:
        for ucs, _, origin, box in span['chars']:
            text = chr(ucs)
            if text.isspace() and span['type'] != 1:
                continue
            at = f'「{text}」（x={box[0]:.1f}, top={box[1]:.1f}）'
            if span['size'] > MAX_TEXT_SIZE:
                return f'有字級 {span["size"]:.1f}pt 的字{at}：超過 {MAX_TEXT_SIZE}pt（真實卷最大 18pt），大字可能蓋住表格或別的字'
            if span['size'] < MIN_TEXT_SIZE:
                return (f'有字級 {span["size"]:.2f}pt 的字{at}：不到 {MIN_TEXT_SIZE}pt（真實卷最小 8.04pt），'
                        '閱讀器上看不見，擷取時卻抽得到（例如頁碼只印數字時，0.3pt 的假「《以下空白》」讓被截斷的 PDF '
                        '看起來完整）')
            contrast = _contrast(span['color'], span['opacity'])
            if span['type'] == 0 and contrast < MIN_CONTRAST:
                return (f'有看不清楚的字{at}：與白紙的對比 {contrast:.2f}:1，不到 {MIN_CONTRAST}:1（真實卷的字是黑色 21:1、'
                        '紅色 4.0:1）；閱讀器上看不到，擷取時卻抽得到（例如假的「《以下空白》」），也可能蓋住別的字')
            if span['type'] == 1 and fills.get((ucs, tuple(origin))) != tuple(span['color']):
                return f'的字{at}描了與填色不同顏色的邊，或只有描邊：Word 的粗體是同色的填色加描邊，別的描邊可能把字蓋掉'
            center = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
            outside = not (table_box[0] <= center[0] < table_box[2] and table_box[1] <= center[1] < table_box[3])
            if outside and _intersects(box, table_box):
                return f'表格外的字{at}蓋到表格'
    return None


def _probe(page) -> tuple[str, float, float] | None:
    """pdfminer 自己的直譯器把這一頁再跑一遍，量 PyMuPDF 看不出來的頁面上真正的描邊線寬：畫字當下的線寬（w，使用者
    座標）乘上當下座標系的縮放（texttrace 給的是縮放前的線寬，放大 10 倍的座標系裡 0.4 的線寬在頁面上是 4pt；審查
    實測），與頁面上的字級（Tf 的字級乘上文字矩陣與座標系的縮放）比。pdfminer 自己的 linewidth 是在 w 那一刻就換算
    好的，之後再 cm 就不準，所以另外記原始的 w（跟著 q／Q 存回）。只看粗體的畫法 Tr 2（內容串流只准 RENDER_MODES）；
    超過字級的 STROKE_COVER 就回 (字, 線寬, 字級)：字糊成一團、蓋到旁邊的字。沒有就回 None。"""
    import math
    from pdfminer.pdfdevice import PDFDevice
    from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
    from pdfminer.utils import mult_matrix

    class Probe(PDFDevice):
        found = None
        line_width = 1.0  # 畫字當下的 w（使用者座標；PDF 的預設是 1），由 Interpreter 維護

        def render_string(self, textstate, seq, ncs, graphicstate):
            if self.found is None and textstate.render == 2:
                a, b, c, d = self.ctm[:4]
                width = self.line_width * math.sqrt(abs(a * d - b * c))
                size = textstate.fontsize * math.hypot(*mult_matrix(textstate.matrix, self.ctm)[2:4])
                if width > STROKE_COVER * size:
                    text = ''.join(x.decode('latin-1', 'replace') if isinstance(x, bytes) else '' for x in seq)
                    self.found = (text, width, size)

    class Interpreter(PDFPageInterpreter):
        def do_w(self, linewidth):
            super().do_w(linewidth)
            self.device.line_width = float(linewidth)  # 內容串流的檢查已經確定它是數字

        def do_q(self):
            super().do_q()
            self.widths.append(self.device.line_width)

        def do_Q(self):
            super().do_Q()
            if self.widths:
                self.device.line_width = self.widths.pop()

    manager = PDFResourceManager()
    probe = Probe(manager)
    interpreter = Interpreter(manager, probe)
    interpreter.widths = []
    interpreter.process_page(page.page_obj)
    return probe.found


def _operator_problem(operator: str, operands: list[tuple[str, object]]) -> str | None:
    """一個運算子與它的運算元（(種類, 值)，見 _content_grammar）：在 OPERATORS 裡、運算元的數目與種類剛好、TJ 與 d
    的陣列裡是它們該有的東西、文字畫法只有 RENDER_MODES、沒有選擇性內容。回傳問題的描述，沒有就回 None。"""
    want = OPERATORS.get(operator)
    if want is None:
        return f'內容串流有 Word 不會寫的運算子「{operator}」'
    got = ''.join(kind for kind, _ in operands)
    if got != want:
        def kinds(letters):
            return f'（{"、".join(OPERAND_KINDS[k] for k in letters)}）' if letters else ''
        return f'內容串流的運算子「{operator}」接了 {len(got)} 個運算元{kinds(got)}，應為 {len(want)} 個{kinds(want)}'
    if operator == 'Tr' and float(operands[0][1]) not in RENDER_MODES:
        return (f'內容串流有文字畫法「{operands[0][1].decode()} Tr」：Word 只寫 0（一般的字）與 2（粗體：填色加同色描邊），'
                '隱形、只描邊、拿字形當剪裁路徑的字 pdfminer 一律照抽')
    if operator == 'TJ' and any(kind not in 'sn' for kind, _ in operands[0][1]):
        return '內容串流的 TJ 陣列裡有字串與數字以外的東西'
    if operator == 'd' and any(kind != 'n' for kind, _ in operands[0][1]):
        return '內容串流的 d 陣列裡有數字以外的東西'
    if operator in ('BDC', 'BMC') and operands[0][1] == b'/OC':
        return '內容串流有選擇性內容（/OC 標記的內容，閱讀器可能不畫）'
    return None


def _content_tokens(data: bytes) -> Iterator[tuple[str | None, bytes | int]]:
    """一段內容串流，一個詞一個詞切：依序給出 (種類, 位元組)，切不下去時最後給 (None, 那個位置)。開頭與詞與詞之間只
    跳過 SPACE，每一個詞都要是 TOKEN 認得的。_content_grammar 邊切邊讀，遇到第一個問題就停，不先把整段切完（第四十輪
    審查實測：先切完再讀，壓縮後 123 KB 的 PDF 要 45 秒、2.5 GB）；測試拿它與照說明寫的參考讀法逐一比"""
    pos = SPACE.match(data).end()
    while pos < len(data):
        token = TOKEN.match(data, pos)
        if token is None:
            yield None, pos
            return
        yield token.lastgroup, token.group()
        pos = SPACE.match(data, token.end()).end()


def _content_grammar(streams: list[bytes]) -> str | None:
    """內容串流（各段解壓縮後的位元組，照 /Contents 的順序）是不是兩套 PDF 程式讀法一致的寫法：每一段都切得成詞
    （_content_tokens：每一個詞都是 TOKEN 認得的，兩邊切詞一定相同：NUL 在 MuPDF 是空白、在 pdfminer 是運算子的一部分，
    整個運算子被 pdfminer 丟掉），運算子與運算元都合 _operator_problem（多給的運算元 pdfminer 取最後幾個、MuPDF 取最前面
    幾個）。審查用這兩招讓閱讀器把「不」壓成一條線、把答案描成一團黑，擷取照樣是原字。陣列與字典可以跨段（兩邊都把段
    接起來讀），詞不可以；最多疊 DEPTH 層、每個最多 ITEMS 項。回傳問題的描述，沒有就回 None。"""
    operands: list[tuple[str, object]] = []    # 目前這個運算子的運算元
    containers: list[tuple[bytes, list]] = []  # 還沒關上的陣列、字典：(開頭, 裡面的東西)

    def put(item) -> bool:
        """放進目前的陣列或字典（沒有的話是運算元）；陣列或字典超過 ITEMS 項就回 True。"""
        (containers[-1][1] if containers else operands).append(item)
        return bool(containers) and len(containers[-1][1]) > ITEMS

    for number, data in enumerate(streams, start=1):
        for kind, text in _content_tokens(data):
            if kind is None:  # 切不下去：text 是那個位置
                return (f'內容串流第 {number} 段第 {text + 1} 個位元組起的 {data[text:text + 12]!r} '
                        '不是兩套 PDF 程式讀法一致的寫法')
            if kind == 'operator':
                if containers:
                    return f'內容串流的陣列或字典裡有運算子「{text.decode()}」'
                if problem := _operator_problem(text.decode(), operands):
                    return problem
                operands = []
            elif kind == 'open':
                if len(containers) == DEPTH:
                    return f'內容串流的陣列或字典疊了超過 {DEPTH} 層'
                containers.append((text, []))
            elif kind == 'close':
                opener = b'[' if text == b']' else b'<<'
                if not containers or containers[-1][0] != opener:
                    return f'內容串流的「{text.decode()}」沒有對應的「{opener.decode()}」'
                items = containers.pop()[1]
                if opener == b'<<' and (len(items) % 2 or any(key != '/' for key, _ in items[::2])):
                    return '內容串流的字典不是「名稱 值」成對'
                if put(('a' if opener == b'[' else 'd', items)):
                    return f'內容串流有超過 {ITEMS} 項的陣列或字典'
            elif put(({'number': 'n', 'name': '/', 'string': 's'}[kind], text)):
                return f'內容串流有超過 {ITEMS} 項的陣列或字典'
    if operands or containers:
        return '內容串流最後有沒用到的運算元或沒關上的陣列、字典'
    return None


def _content_problem(page, shown) -> str | None:
    """這一頁的內容串流：兩套程式解壓縮出來的位元組要逐段相同（壓縮資料壞了、/Length 不對時，兩邊各自補救，讀到的
    可能不同），而且是兩邊讀法一致的寫法（_content_grammar）。page 是 pdfplumber 的頁面，shown 是 PyMuPDF 的。"""
    from pdfminer.pdftypes import list_value, stream_value  # 延後 import：只處理列的單元測試不需要它

    ours = [stream_value(content).get_data() for content in list_value(page.page_obj.contents)]
    theirs = [shown.parent.xref_stream(xref) for xref in shown.get_contents()]
    if ours != theirs:
        return '內容串流兩套 PDF 程式解出來的不一樣'
    return _content_grammar(ours)


def _marks(log, box) -> list[str]:
    """框裡字以外畫的東西：PyMuPDF bboxlog 的種類（填色、描線、圖片、圖片遮罩、漸層），不論粗細，依畫的順序、不重複。"""
    kinds: list[str] = []
    for kind, bbox in log:
        if not kind.endswith('-text') and _intersects(bbox, box) and kind not in kinds:
            kinds.append(kind)
    return kinds


def _strike(log, chars, box, text_left):
    """題目欄內縮框 box 裡，穿過文字中段的細線或細矩形（最窄的一邊 ≤ THIN）：刪除線、遮住字的白色細條、手畫的
    破折號。文字中段 = 字的基線以上 STRIKE_ZONE 的範圍，在題號那一欄（text_left 左邊）與題目文字那一欄各自整欄都算
    （兩欄的基線不同）。底線在基線下方，碰不到（它照一般的圖算，見 _log_drawings）。回傳那條線的外框，沒有就回 None。"""
    low, high = STRIKE_ZONE
    zones = []  # (欄的左右, 中段的上下)
    for c in chars:
        if c['text'].strip():
            baseline = c['bottom'] + c['y0'] - c['matrix'][5]  # 矩陣的 f 是基線（PDF 座標，往上為正）
            column = (box[0], text_left) if _mid(c)[0] < text_left else (text_left, box[2])
            zones.append((column, (baseline - high * c['size'], baseline - low * c['size'])))
    for kind, bbox in log:
        if (kind in ('fill-path', 'stroke-path') and min(bbox[2] - bbox[0], bbox[3] - bbox[1]) <= THIN
                and any(_intersects(bbox, (left, top, right, bottom)) for (left, right), (top, bottom) in zones)):
            return bbox
    return None


def _covered(log, trace):
    """畫在字之後、把字蓋住的圖片、圖片遮罩或漸層（浮水印也一樣：真實卷的浮水印是每頁第一個畫的東西）：
    字（空白以外）的中心落在圖的外框裡，而且比圖先畫（texttrace 的 seqno 就是 bboxlog 的索引）。
    回傳 (種類, 圖的外框, 字, 字框)，沒有就回 None。"""
    glyphs = [(span['seqno'], chr(ucs), bbox) for span in trace for ucs, _, _, bbox in span['chars']
              if not chr(ucs).isspace()]
    for seqno, (kind, box) in enumerate(log):
        if kind in COVERING_KINDS:
            for drawn, text, glyph in glyphs:
                x, y = (glyph[0] + glyph[2]) / 2, (glyph[1] + glyph[3]) / 2
                if drawn < seqno and box[0] <= x <= box[2] and box[1] <= y <= box[3]:
                    return kind, box, text, glyph
    return None


def _odd_clip(page):
    """不是單一個矩形的剪裁路徑（整頁都查：表格外的字也要真的畫出來）：TEXT_CLIP 只看剪裁路徑的外框，外框包住字、
    剪出來的範圍卻是空的（兩個小三角形、兩條窄長方形）也算畫出來。8 份真實卷的 20,430 個剪裁路徑都是一個矩形
    （整頁或儲存格）。page 是 PyMuPDF 的頁面；回傳剪裁範圍，沒有就回 None。"""
    for drawing in page.get_drawings(extended=True):
        items = drawing.get('items', ())
        if drawing['type'] == 'clip' and (len(items) != 1 or items[0][0] != 're'):
            return drawing['scissor']
    return None


def _page_lines(chars: list[dict]) -> list[str]:
    """表格外的字 → 各行文字（去掉頭尾空白，丟掉空行）。"""
    from pdfplumber.utils import extract_text  # 延後 import：只處理列的單元測試不需要它

    text = extract_text(chars, x_tolerance=X_TOLERANCE, y_tolerance=Y_TOLERANCE)
    return [line.strip() for line in text.split('\n') if line.strip()]


def _allowed(line: str) -> bool:
    """表格外允許的一行：頁首（科目只認 SUBJECTS）、首頁的注意事項與「一、單選題」。"""
    return line in SUBJECTS or any(p.fullmatch(line) for p in OUTSIDE_TABLE)


def _table_count_error(pno: int, page, count: int) -> str:
    """一頁的表格不是剛好一張時的訊息。沒有表格、除了頁首頁碼只有「《以下空白》」或什麼都沒有的頁另外說明：
    Word 在表格之後可能多出一頁空白頁，或把「《以下空白》」擠到下一頁。"""
    if count == 0:
        rest = [line for line in _page_lines(page.chars)
                if not _allowed(line) and not PAGE_NUMBER.fullmatch(line)]
        if not rest:
            return f'第 {pno} 頁是空白頁（沒有表格，只有頁首與頁碼）—— 這種版面沒有驗證過，需要人工確認。'
        if rest == [END_MARK]:
            return f'第 {pno} 頁沒有表格，只有頁首、頁碼與「{END_MARK}」—— 這種版面沒有驗證過，需要人工確認。'
    return f'第 {pno} 頁有 {count} 張表，應為 1 張。'


def _annotations(page) -> list[str]:
    """頁面 /Annots 裡的註解（連同表單欄位）的種類：/Subtype 的名稱，沒有 /Subtype 的是 'None'。
    Link 不算，除非它帶外觀串流（/AP）：Word 的網址只有 Link 本身，不畫任何東西；/AP 則會被 PDFium（Chrome）畫出來。
    直接讀 /Annots，不用 PyMuPDF 的 annot_xrefs：它會跳過不認得的種類，閱讀器卻照樣畫出那種註解的外觀。"""
    from pdfplumber.utils import resolve  # 延後 import：只處理列的單元測試不需要它

    kinds = []
    for annot in resolve(page.page_obj.annots) or ():
        annot = resolve(annot)
        subtype = resolve(annot.get('Subtype')) if isinstance(annot, dict) else None
        kind = str(getattr(subtype, 'name', subtype))
        if kind != 'Link':
            kinds.append(kind)
        elif resolve(annot.get('AP')) is not None:
            kinds.append('Link（帶外觀串流 /AP）')
    return kinds


def _font_problem(font: dict) -> str | None:
    """字型字典（pdfminer 讀到的）裡 Word 不會寫、各家讀法可能不同的地方：回傳「/鍵（原因）」，沒有就回 None。
    畫哪一個字形、抽出哪一個字，各家都照字型的這幾張對照表；寫法不同，就可能畫的是一個字、抽出來是另一個：
    - 內嵌的 Type0 只收 Word 的寫法：Identity-H（字碼就是 CID）、一個 CIDFontType2、/CIDToGIDMap /Identity（CID 就是
      字形編號）、/FontFile2、/ToUnicode 串流、/CIDSystemInfo (Adobe)(Identity) 0。抽出來的字照 ToUnicode；沒有時各家
      改查 /CIDSystemInfo 的字集表，畫的卻是字形編號（第十二輪審查實測：寫成 CNS1，三套程式的文字層都說「不」，畫的是
      「ㄽ」）；寫成名稱 /Identity-H 就把字碼當成 Unicode。/CIDToGIDMap 寫成比字碼短的串流時，MuPDF 照字碼畫、PDFium
      不畫，pdfminer 根本不看它（第十一輪審查實測）。
    - 沒有內嵌的 Type0 只收 PyMuPDF 內建中文字型的寫法：UniCNS-UTF16-H（字碼就是 Unicode）、一個 CIDFontType0、
      /CIDSystemInfo (Adobe)(CNS1)，不寫 /CIDToGIDMap，字型與 CIDFont 的 /BaseFont 都在 BUILTIN_CJK 裡。/Ordering 換成
      別的字集時，pdfminer 與 MuPDF 照那個字集把 CID 換成 Unicode（「不」），PDFium 畫字碼本來的字（「傷」），Poppler
      不畫（第十二輪審查實測）；閱讀器照名稱換字型，CIDFont 叫 ZapfDingbats、Symbol 時 PDFium 把「不」畫成空白
      （第十四輪審查實測）。
    - 只有內嵌的 Type0 可以帶 /ToUnicode：沒有內嵌的字型由閱讀器自己換字型、照字碼畫，抽出來的卻是 ToUnicode 對到的
      字（空白的字碼對到「不」），MuPDF 又算不出沒有內嵌字型的墨跡（給整個字型的外框），擋不住；簡單字型的字由
      編碼決定。
    - 簡單字型（TrueType、Type1）只收 /WinAnsiEncoding（/Differences 能把字碼改對到別的字形名稱）、/BaseFont 在
      SIMPLE_FONTS 裡（去掉子集字型的前綴）、字型描述的 /Flags 是 32（非符號字型）：符號字型（Symbol、ZapfDingbats）
      不照編碼選字形，擷取是答案「C」，閱讀器畫的是一個星形符號（U+2723，第十二輪審查實測）。內嵌的只收 TrueType、/FontFile2。
    - /DW 是數字、/W 是陣列：pdfminer 拿它們算字寬，別的寫法讓它出錯。字型描述只收 DESCRIPTOR_KEYS：沒有內嵌的字型，
      閱讀器照描述換字型，/FontFamily (Symbol) 讓 Poppler 換成符號字型，答案 C 畫成空白（第十三輪審查實測）。
    8 份真實卷全是這些寫法（簡單字型的 /BaseFont 只有 ArialMT、TimesNewRomanPSMT、TimesNewRomanPS-BoldMT 與內嵌的
    DFKaiShu-SB-Estd-BF）；沒有內嵌的 Type1 與 Type0 是 PyMuPDF 內建字型的寫法。Type 3 另外報（_resources）。"""
    from pdfminer.pdftypes import PDFStream  # 延後 import：只處理列的單元測試不需要它
    from pdfplumber.utils import resolve

    def name(value):
        return getattr(resolve(value), 'name', None)

    subtype = name(font.get('Subtype'))
    if subtype not in ('Type0', 'TrueType', 'Type1'):
        return f'/Subtype /{subtype}（只收 Type0、TrueType 與 Type1）'
    kid = None
    if subtype == 'Type0':
        kids = resolve(font.get('DescendantFonts'))
        kid = resolve(kids[0]) if isinstance(kids, list) and len(kids) == 1 else None
        if not isinstance(kid, dict):  # 是哪一種 CIDFont，內嵌與沒有內嵌的各自查
            return '/DescendantFonts（要剛好一個 CIDFont）'
    descriptor = resolve((font if kid is None else kid).get('FontDescriptor'))
    files = [key for key in FONT_FILES if isinstance(descriptor, dict) and key in descriptor]
    if isinstance(descriptor, dict) and (extra := sorted(set(descriptor) - DESCRIPTOR_KEYS)):
        return (f'/FontDescriptor /{extra[0]}（字型描述只收 Word 會寫的欄位：沒有內嵌的字型，閱讀器照它換字型，'
                '/FontFamily (Symbol) 就讓 Poppler 換成符號字型）')
    if 'ToUnicode' in font and (kid is None or not files):
        return ('/ToUnicode（只有內嵌的 Type0 字型可以帶：簡單字型的字由編碼決定；沒有內嵌的字型，閱讀器照字碼換字型畫，'
                '抽出來的卻是 ToUnicode 對到的字）')
    encoding = name(font.get('Encoding'))
    if kid is None:
        if encoding != 'WinAnsiEncoding':
            return '/Encoding（簡單字型只收 /WinAnsiEncoding：/Differences 能把字碼改對到別的字形）'
        base = name(font.get('BaseFont'))  # 不是 UTF-8 的名稱，pdfminer 給的是 bytes
        if not isinstance(base, str) or SUBSET.sub('', base) not in SIMPLE_FONTS:
            return f'/BaseFont /{base}（簡單字型只收真實卷用的幾種：符號字型不照編碼選字形，答案 C 畫成星形符號）'
        if descriptor is not None and (not isinstance(descriptor, dict) or resolve(descriptor.get('Flags')) != 32):
            return '/FontDescriptor（/Flags 只收 32：非符號字型）'
        if files and (subtype != 'TrueType' or files != ['FontFile2']):
            return f'/{"、/".join(files)}（內嵌的簡單字型只收 Word 的 TrueType 與 /FontFile2）'
        return None
    info = resolve(kid.get('CIDSystemInfo'))
    system = tuple(resolve(info.get(key)) for key in ('Registry', 'Ordering', 'Supplement')) \
        if isinstance(info, dict) else None
    if not files:
        if encoding != 'UniCNS-UTF16-H':
            return '/Encoding（沒有內嵌的 Type0 只收字碼就是 Unicode 的 UniCNS-UTF16-H）'
        if name(kid.get('Subtype')) != 'CIDFontType0':
            return '/DescendantFonts（沒有內嵌的 Type0 只收 CIDFontType0）'
        if system is None or system[:2] != (b'Adobe', b'CNS1') or type(system[2]) is not int:
            return '/CIDSystemInfo（沒有內嵌的 Type0 只收與 CMap 相同的 (Adobe)(CNS1)：字集不同，各家畫出不同的字）'
        if 'CIDToGIDMap' in kid:
            return '/CIDToGIDMap（沒有內嵌的字型不寫）'
        if name(font.get('BaseFont')) not in BUILTIN_CJK or name(kid.get('BaseFont')) not in BUILTIN_CJK:
            return ('/BaseFont（沒有內嵌的 Type0 只收 PyMuPDF 內建中文字型的名稱：閱讀器照名稱換字型，CIDFont 叫 '
                    'ZapfDingbats 時 PDFium 把字畫成空白）')
    else:
        if encoding != 'Identity-H':
            return '/Encoding（內嵌的 Type0 只收 Word 的 Identity-H：內嵌的 CMap 各家各自解析）'
        if name(kid.get('Subtype')) != 'CIDFontType2' or files != ['FontFile2']:
            return '/DescendantFonts（內嵌的 Type0 只收 Word 的 CIDFontType2 與 /FontFile2）'
        if not isinstance(resolve(font.get('ToUnicode')), PDFStream):
            return ('/ToUnicode（內嵌的 Type0 要帶 ToUnicode 串流：沒有時抽出來的字改查字集表，畫的卻是字形編號；'
                    '寫成名稱就把字碼當成 Unicode）')
        if system != (b'Adobe', b'Identity', 0):
            return '/CIDSystemInfo（內嵌的 Type0 只收 Word 的 (Adobe)(Identity) 0）'
        if name(kid.get('CIDToGIDMap')) != 'Identity':
            return '/CIDToGIDMap（內嵌的字型只收 /Identity：寫成串流時 pdfminer 不看它，比字碼短的 PDFium 不畫、MuPDF 照畫）'
    widths, default = resolve(kid.get('W')), resolve(kid.get('DW'))
    if default is not None and type(default) not in (int, float):
        return '/DW（要是數字：pdfminer 拿它算字寬）'
    if widths is not None and not isinstance(widths, list):
        return '/W（要是陣列：pdfminer 拿它算字寬）'
    return None


def _resources(page) -> list[str]:
    """頁面資源裡 Word 不會寫的東西：圖形狀態（ExtGState）只准 /Type、/BM /Normal（或 /Compatible）、/CA、/ca、
    /SMask /None；字型不准 Type 3，其他的照 _font_problem。回傳問題清單（「圖形狀態 GS9 的 /TR」「Type 3 字型 F3」
    「字型 F1 的 /ToUnicode（…）」）。
    - /TR、/TR2（轉換函數）：PDFium 與 Poppler 照做（黑字變白字），MuPDF 不支援、照畫黑字（審查實測）。
    - /BM 其他的混色：疊在不透明的底色上，字就看不見；/SMask 的群組沒寫 /Subtype，不算「表單」卻照樣把字遮掉。
    - Type 3 字型：字形程序是一段完整的內容串流，畫什麼都可以，與抽出來的字沒有關係。
    - 頁面自己要有 /Resources 字典：沒有寫、寫成 null、指向不存在的物件時，各家沿用上層節點資源的方法不同 ——
      pdfminer 丟掉 null 的鍵、順著 /Kids 找上層，MuPDF 順著 /Parent 找，PDFium 遇到 null 當成沒有資源、遇到壞掉的
      參照改用上層的（審查實測：PDFium 整頁中文變亂碼、畫出上層的 Type 3 字形；/Parent 指向樹外的節點，兩邊讀到
      不同的資源）。
    - 字型表、圖形狀態表與其中每一項都要是字典（不是字典時，這裡不猜各家怎麼讀）。
    8 份真實卷的圖形狀態只有 /BM /Normal 與 /CA、/ca 1，字型只有 Type0 與 TrueType，每一頁都有自己的 /Resources 字典。"""
    from pdfplumber.utils import resolve  # 延後 import：只處理列的單元測試不需要它

    def name(value):
        return getattr(resolve(value), 'name', None)

    own = resolve(page.page_obj.doc.getobj(page.page_obj.pageid))  # 頁面字典本身：pdfminer 的 attrs 含沿用上層的
    resources = resolve(own.get('Resources')) if isinstance(own, dict) else None
    if not isinstance(resources, dict):
        return ['頁面資源（頁面自己的 /Resources 不是字典：沒有寫、寫成 null 或指向不存在的物件時，各家閱讀器有的沿用'
                '上層節點的資源、有的當成沒有資源）']
    problems = []
    states, fonts = resolve(resources.get('ExtGState')), resolve(resources.get('Font'))
    for field, table in (('ExtGState', states), ('Font', fonts)):
        if table is not None and not isinstance(table, dict):
            problems.append(f'頁面資源的 /{field}（不是字典）')
    for key, state in (states if isinstance(states, dict) else {}).items():
        state = resolve(state)
        if not isinstance(state, dict):
            problems.append(f'圖形狀態 {key}（不是字典）')
            continue
        for field, value in state.items():
            if field == 'Type' or (field == 'BM' and name(value) in ('Normal', 'Compatible')) \
                    or (field in ('CA', 'ca') and isinstance(resolve(value), (int, float))) \
                    or (field == 'SMask' and name(value) == 'None'):
                continue
            problems.append(f'圖形狀態 {key} 的 /{field}')
    for key, font in (fonts if isinstance(fonts, dict) else {}).items():
        font = resolve(font)
        if not isinstance(font, dict):
            problems.append(f'字型 {key}（不是字典）')
        elif name(font.get('Subtype')) == 'Type3':
            problems.append(f'Type 3 字型 {key}')
        elif problem := _font_problem(font):
            problems.append(f'字型 {key} 的 {problem}')
    return problems


def _layers_or_forms(doc) -> str | None:
    """選擇性內容（圖層）與表單物件（Form XObject）：兩者都會讓抽出來的字與閱讀器上看到的不同。
    圖層：各家閱讀器顯示哪些圖層並不一致（關著的 /Intent /Design 圖層，MuPDF 不畫、PDFium 照畫），pdfminer 則不分圖層照抽。
    表單：pdfminer 不一定讀得到表單裡的內容（沒有 /BBox 的整個跳過），MuPDF 與 PDFium 卻照樣畫出來 ——
    表單裡用白字蓋掉答案、再印另一個字，抽出來的是原來的答案。真實的公告試題（Word 匯出）兩種都沒有，
    所以整份一律擋，不逐一判斷。註解的外觀串流也是表單，但註解在這之前就擋掉了（訊息比較準）。"""
    if doc.xref_get_key(doc.pdf_catalog(), 'OCProperties')[0] != 'null':
        return ('PDF 有選擇性內容（圖層，/OCProperties）—— 各家閱讀器顯示哪些圖層並不一致，擷取時卻不分圖層照抽，'
                '抽出來的字可能與閱讀器上看到的不同，需要人工確認。')
    forms = [x for x in range(1, doc.xref_length()) if doc.xref_get_key(x, 'Subtype') == ('name', '/Form')]
    if forms:
        return (f'PDF 裡有表單物件（Form XObject，xref {"、".join(map(str, forms))}）—— 表單裡的內容擷取時不一定讀得到'
                '（沒有 /BBox 的整個跳過），閱讀器卻照樣畫出來，抽出來的字可能與看到的不同，需要人工確認。')
    # /Subtype 寫成間接參照（/Subtype 12 0 R，12 號物件是 /Form）：pdfminer 不解參照，當成不認得的物件整個跳過，
    # 閱讀器照樣畫。8 份真實卷的 /Subtype 全是直接的名稱
    indirect = [x for x in range(1, doc.xref_length()) if doc.xref_get_key(x, 'Subtype')[0] not in ('name', 'null')]
    if indirect:
        return (f'PDF 裡有 /Subtype 不是直接名稱的物件（xref {"、".join(map(str, indirect))}）—— pdfminer 不解這種參照，'
                '會把它（表單、圖片）整個跳過，閱讀器卻照樣畫出來，需要人工確認。')
    type3 = [x for x in range(1, doc.xref_length()) if doc.xref_get_key(x, 'Subtype') == ('name', '/Type3')]
    if type3:  # 頁面資源裡直接寫的，_resources 逐頁先查；這裡擋的是其他地方的（上層節點的資源、沒被參照的物件）
        return (f'PDF 裡有 Type 3 字型（xref {"、".join(map(str, type3))}）—— 字形程序畫什麼都可以，與抽出來的字沒有關係；'
                '頁面資源以外的也擋（資源的參照壞掉時，PDFium 改用上層節點的資源），需要人工確認。')
    return None


def _rebuilt_xref(pdf, rendered) -> bool:
    """xref 表壞了、pdfminer 或 PyMuPDF 只好自己重建：pdfminer 改成掃描整個檔案，PyMuPDF 的 is_repaired。
    兩套程式各自重建，讀到的可能是不同版本的頁面（審查實測：一筆 xref 多一個空白，pdfminer 讀到另一份沒被參照的
    頁面，PyMuPDF 照讀）。8 份真實卷兩邊都不用重建。"""
    from pdfminer.pdfdocument import PDFXRefFallback  # 延後 import：只處理列的單元測試不需要它

    return rendered.is_repaired or any(isinstance(x, PDFXRefFallback) for x in pdf.doc.xrefs)


def _page_list_problem(pdf, rendered) -> str | None:
    """頁面樹只收 Word 的寫法：根節點只寫 /Type /Pages、直接列出每一頁的 /Kids 與整數的 /Count（ROOT_KEYS，/Count
    等於頁數），每一頁都是 /Type /Page、沒有 /Kids、/Parent 指回根節點、自己寫 /MediaBox（四個數字的陣列）（8 份真實卷
    都是）。
    別的寫法各家找頁面的方法不同 —— 沒有 /Type 的頁面 pdfminer 跳過、MuPDF 與 Poppler 照畫（第十二輪審查實測：藏在
    第 3 頁的「更正：第 1 題答案改為 A」被安靜地丟掉）；是頁面又帶 /Kids 的節點，pdfminer 與 MuPDF 當成頁面，PDFium
    照 /Kids 往下走、畫出另一頁（第十三輪審查實測：擷取是答案 B，Chrome 上是 D）；頁面的 /MediaBox 寫成 null 時，
    pdfminer、MuPDF 與 Poppler 沿用根節點的，PDFium 改用 US Letter、頁面上方 50pt 看不到（第十四輪審查實測），根節點
    也就不帶可以沿用的屬性；/Type /Page 的根節點 pdfminer 當成一頁，其他三套照 /Kids 往下走；pdfminer 只認直接寫的
    /Type（間接參照的那一頁它跳過，MuPDF 照讀）；/Count 與 /Kids 不符時 MuPDF 開檔時照 /Count 算頁數，逐頁讀時才照
    /Kids 修正（頁數要在逐頁讀之前記下來）。
    樹照 Word 寫了，兩套程式讀到的頁面（物件編號、順序）還是要逐一相同；兩邊都沒有頁面也報錯（頁碼的核對要有頁面）。
    回傳錯誤訊息，沒有就回 None。"""
    root_ref = pdf.doc.catalog.get('Pages')
    root = pdf.doc.getobj(root_ref.objid) if hasattr(root_ref, 'objid') else None
    kids = root.get('Kids') if isinstance(root, dict) else None

    def word_page(kid):
        page = pdf.doc.getobj(kid.objid) if hasattr(kid, 'objid') else None
        box = page.get('MediaBox') if isinstance(page, dict) else None
        return (isinstance(page, dict) and getattr(page.get('Type'), 'name', None) == 'Page'
                and 'Kids' not in page and getattr(page.get('Parent'), 'objid', None) == root_ref.objid
                and isinstance(box, list) and len(box) == 4 and all(type(v) in (int, float) for v in box))
    if not (isinstance(kids, list) and set(root) == ROOT_KEYS and getattr(root['Type'], 'name', None) == 'Pages'
            and type(root['Count']) is int and root['Count'] == len(kids) and all(map(word_page, kids))):
        return ('頁面樹不是 Word 的寫法（根節點只寫 /Type /Pages、直接列出每一頁的 /Kids 與等於頁數的 /Count；每一頁都是'
                ' /Type /Page、沒有 /Kids、/Parent 指回根節點、自己寫四個數字的 /MediaBox）—— 各家找頁面、沿用屬性的方法'
                '不同，閱讀器上看到的頁可能是另一頁、或被裁掉一部分，需要人工確認。')
    count = rendered.page_count
    mine, theirs = [page.page_obj.pageid for page in pdf.pages], [page.xref for page in rendered]
    if mine != theirs or count != len(theirs):
        return (f'兩套 PDF 程式讀到的頁面不同（pdfminer 讀到 {len(mine)} 頁、PyMuPDF 讀到 {count} 頁）—— 頁面樹的寫法'
                '各家讀法不同（沒有 /Type 的頁面、/Count 與 /Kids 不符），被略過的頁面可能是勘誤，需要人工確認。')
    if not mine:
        return 'PDF 沒有任何頁面 —— 頁面樹是空的，需要人工確認（重新下載，或向出題單位確認）。'
    return None


def _table_trailer(data: bytes, start: int) -> int | None:
    """xref 表（start 是「xref」的位置）是標準的寫法時，接在後面的 trailer 的位置；不是就 None。標準的寫法：每一個
    子段是「起頭 筆數」一行，接著剛好那麼多筆 20 個位元組的項目（類型只有 n 與 f，結尾是規範的空白 CR、空白 LF 或
    CR LF），子段不重疊，最後接 trailer（前面可以有空白）。別的寫法各家讀法不同：pdfminer 只收第三欄剛好是 n 的（「nx」「o」它跳過、MuPDF 照讀），同一個物件登記兩次時
    pdfminer 取後面的、MuPDF 取前面的，19 個位元組的項目 PDFium 當成 xref 壞了、自己掃描整個檔案（第十六輪審查實測）。"""
    table = XREF_TABLE.match(data, start)
    if not table:
        return None
    pos, listed = table.end(), set()
    while subsection := XREF_SUBSECTION.match(data, pos):
        first, count = int(subsection[1]), int(subsection[2])
        if count > OBJECTS or not listed.isdisjoint(range(first, first + count)):
            return None
        listed.update(range(first, first + count))
        pos = subsection.end()
        for _ in range(count):
            if not XREF_ENTRY.match(data, pos):
                return None
            pos += 20
    trailer = XREF_TRAILER.match(data, pos)
    return trailer.end() - len(b'trailer') if trailer else None


def _listed(xref) -> list[int] | None:
    """xref 一段登記的物件編號（含空的那幾筆），寫法不對時回 None。xref 表照 pdfminer 的 get_objids；xref 串流照
    get_pos 的算法各段累加：pdfminer 的 get_objids 在 /Index 有兩段以上時，每一段都從資料的開頭重新數（第十五輪審查
    實測：第二段的物件整個沒查）。/Index 的每一個數都要是非負整數（true 在 pdfminer 是 1、在 MuPDF 是 0），筆數加起來
    不超過 OBJECTS、剛好是資料的筆數（/Index 說有一百萬筆、資料只有幾筆，逐筆列就耗盡記憶體）。"""
    ranges = getattr(xref, 'ranges', None)
    if ranges is None:
        return list(xref.get_objids())
    if (not xref.entlen or any(type(value) is not int or value < 0 for pair in ranges for value in pair)
            or sum(count for _, count in ranges) > OBJECTS
            or sum(count for _, count in ranges) * xref.entlen != len(xref.data)):
        return None
    return [objid for start, count in ranges for objid in range(start, start + count)]


def _poppler_rebuild(data: bytes, trailers: list[int] | None = None) -> dict[int, tuple[int, int]] | None:
    """Poppler xref 壞掉、自己掃描檔案重建時登記的物件：{編號: (它從哪裡開始讀, 世代號)}；物件編號放不下、它整個放棄是
    None。trailers 有給的話，記下它讀 trailer 字典的每一個位置：行首（跳過空白）或同一行 endobj 之後是「trailer」，就從
    pos + 7 讀一個物件 —— pos 是行首或 endobj 後面的位置，行首的空白不算進去，所以前面有空白的 trailer，它多半從
    「trailer」這個字裡面讀起、讀不到字典（除非 getLine 剛好在那裡切開一段）。它只照這些 trailer 找 /Root（不看
    xref 串流），找不到 /Root 是參照的也整個放棄（Couldn't find trailer dictionary，_rebuild_problem 判斷）。另一個
    放棄點沒有照做：endstream 多到 INT_MAX / sizeof(int) 個（要超過 5 GB 的檔案）。照 Poppler 25.03.0 的
    XRef::constructXRef 一步一步做：逐行讀（getLine：一次最多 255 個字元，CR、LF、CR LF 是行尾），行首
    （跳過空白）或同一行 endobj 之後是「編號 世代號 obj」就登記，世代號不小於前一份的就換掉。它與別家不同的地方都
    照原樣：C 字串（NUL 就是結尾）；編號或世代號後面是字串結尾，就把下一行讀進同一個緩衝區接著找（下一行不再當成
    一行看）；編號之間的空白照 C 的 isspace（多一個垂直定位字元）；obj 後面接什麼都收；atoi 超過 int 的只留低 32 位元；編號到
    POPPLER_XREF 以上就整個放棄，而且在比世代號之前（照它的順序：世代號被截成負數的一份也讓它放棄，以前這裡既不放棄
    也不登記，整卷放行 —— 第十九、二十二輪審查指出）。物件串流裡的物件它不登記（只找「N G obj」）：
    Word 的卷它一重建就讀不到大部分的物件，所以不讓它有理由重建（_syntax_problem：參照都要指向登記的物件）比這裡
    更要緊；這裡管的是另一份物件開頭。"""
    buf = bytearray(POPPLER_LINE + 1)
    at = 0

    def line():  # getLine(buf, 256)：讀到行尾或 255 個字元；已經到檔尾就不動 buf、回 False
        nonlocal at
        if at >= len(data):
            return False
        end = min(at + POPPLER_LINE - 1, len(data))
        stop = eol.start() if (eol := LINE_END.search(data, at, end)) else end
        buf[:stop - at] = data[at:stop]
        buf[stop - at] = 0
        at = stop + 1 + (data[stop:stop + 2] == b'\r\n') if eol else stop
        return True

    def number(p):  # atoi = (int) strtol：超過 LONG_MAX 取 LONG_MAX，再只留低 32 位元
        q = p
        while buf[q] in ASCII_DIGITS:
            q += 1
        return (min(int(bytes(buf[p:q])), 2 ** 63 - 1) + 2 ** 31) % 2 ** 32 - 2 ** 31, q

    def after(p):  # 編號或世代號之後：字串結尾就讀下一行進來（回傳值不看），再跳過 C 的空白
        if buf[p] == 0:
            line()
            p = 0
        else:
            p += 1
        while buf[p] and buf[p] in C_SPACE:
            p += 1
        return p

    entries = {}
    while True:
        pos = at
        if not line():
            return entries
        p = 0
        while buf[p] and buf[p] in POPPLER_SPACE:
            p += 1
        once = True
        while True:
            found = bytes(buf[p:buf.index(0, p)]).find(b'endobj')
            token = p + found if found >= 0 else -1
            if token < 0 and not once:
                break
            once = token >= 0
            if token >= 0:  # 只看到 endobj 為止，之後的下一輪再看
                buf[token] = 0
                offset = token - p
            if bytes(buf[p:p + 7]) == b'trailer':  # 從 pos + 7 讀 trailer 字典（見上面）；是 trailer 就不找編號
                if trailers is not None:
                    trailers.append(pos + 7)
            elif buf[p] in ASCII_DIGITS:
                num, p = number(p)
                if num > 0 and (buf[p] == 0 or buf[p] in C_SPACE):
                    p = after(p)
                    if buf[p] in ASCII_DIGITS:
                        gen, p = number(p)
                        if buf[p] == 0 or buf[p] in C_SPACE:
                            p = after(p)
                            if buf[p:p + 3] == b'obj':
                                if num >= POPPLER_XREF:  # 放不下，整個放棄（在比世代號之前）
                                    return None
                                if gen >= entries.get(num, (0, 0))[1]:  # 新的一格：世代號當成 0
                                    entries[num] = (pos, gen)
            if token >= 0:
                p = token + 6
                pos += offset + 6
                while buf[p] and buf[p] in POPPLER_SPACE:
                    p += 1
                    pos += 1


def _mupdf_entry(native, length: int, number: int):
    """MuPDF xref 的一筆寫成 pdfminer 的樣子：n 是 (None, 位置, 0)，o 是 (物件串流, 索引, 0)，空的是 None。超過長度的
    不問 MuPDF：問了它就把 xref 撐大（第十七輪修正時實測：問第 5000 號，長度從 7 變成 5001）。"""
    from pymupdf import mupdf  # 延後 import：只處理列的單元測試不需要它

    if number >= length:
        return None
    entry = mupdf.ll_pdf_get_xref_entry_no_null(native.m_internal, number)
    return {'n': (None, entry.ofs, 0), 'o': (entry.ofs, entry.gen, 0)}.get(entry.type)


def _rebuild_problem(data: bytes, entries: dict, rendered, rooted: set[int]) -> str | None:
    """xref 要重建時，Poppler 或 MuPDF 讀到的與原本的不同之處；都相同是 None。entries 是 pdfminer 採用的 xref 登記
    （{編號: (物件串流, 位置或索引, 0)}，與 MuPDF 逐號相同），rendered 是 MuPDF 照 xref 開的文件，rooted 是 xref 表後面
    那幾個 trailer 裡，pdfminer 讀到 /Root 是參照的那幾個（「trailer」這個字）的位置。
    - Poppler：照原始碼重演（_poppler_rebuild）。它要找得到 /Root 是參照的 trailer：它讀 trailer 字典的位置（重演記下
      的）要正好在 rooted 的一個 trailer 後面（兩邊從同一個位置讀同一個字典），找不到就整個放棄 —— 只有 xref 串流的
      檔案、每一個那種 trailer 前面都有空白的檔案都是（第二十三輪審查實測：只有 xref 串流、它又讀不了那個串流的，開檔就重建，整份
      打不開，別家照樣讀）。它登記的每一個物件，從它記的位置跳過空白與註解，要正好是 xref 登記在
      檔案裡的那一個開頭（那裡是「N 0 obj」，世代號也就是 0）；xref 登記在檔案裡的每一個物件，它都要找得到。
    - MuPDF：真的重建一次（startxref 指到檔頭，它只好掃描整個檔案；10 份真實 PDF（12 個檔案）每份約 0.01–0.02 秒）。每一個編號重建
      前後要相同（它記的位置是上一個詞的結尾，跳過空白與註解再比），目錄物件也要相同。最壞的情形它看到的編號大到
      8,388,607：多花約 0.7 GB 與 1 秒，超過 OBJECTS 就不逐號比對。
    PDFium 的重建叫不出來看，靠 DEFINITION：它逐詞掃描，只看位元組的 DEFINITION 涵蓋它會當成物件開頭的每一處。"""
    import pymupdf  # 延後 import：只處理列的單元測試不需要它
    from pymupdf import mupdf

    starts = {objid: where for objid, (stream, where, _) in entries.items() if stream is None}
    read = []  # Poppler 讀 trailer 字典的位置
    if (rebuilt := _poppler_rebuild(data, read)) is None:
        return 'Poppler 重建 xref 會失敗（有它放不下的物件編號），重建之後物件都讀不到'
    if not any(start - len(b'trailer') in rooted for start in read):
        return 'Poppler 重建 xref 會失敗（找不到 /Root 是參照的 trailer），重建之後物件都讀不到'
    for number, (pos, _) in sorted(rebuilt.items()):
        if FILLER.match(data, pos).end() != starts.get(number):
            return f'Poppler 重建 xref 時，第 {number} 號物件讀到的是位置 {pos} 的另一份'
    if (lost := next((number for number in sorted(starts) if number not in rebuilt), None)) is not None:
        return f'Poppler 重建 xref 時找不到第 {lost} 號物件'
    native = mupdf.pdf_document_from_fz_document(rendered.this)
    size = mupdf.pdf_xref_len(native)
    with pymupdf.open(stream=data + b'\nstartxref\n1\n%%EOF\n', filetype='pdf') as repaired:
        fixed = mupdf.pdf_document_from_fz_document(repaired.this)
        if (length := mupdf.pdf_xref_len(fixed)) > OBJECTS:
            return f'MuPDF 重建 xref 時物件太多（編號到 {length - 1}，超過 {OBJECTS}）'
        for number in range(1, max(size, length)):
            if (after := _mupdf_entry(fixed, length, number)) and after[0] is None:
                after = (None, FILLER.match(data, after[1]).end(), 0)
            if _mupdf_entry(native, size, number) != after:
                return f'MuPDF 重建 xref 時，第 {number} 號物件讀到的與原本的不同'
        if (catalog := repaired.pdf_catalog()) != rendered.pdf_catalog():
            return f'MuPDF 重建 xref 時，目錄物件是第 {catalog} 號（原本是第 {rendered.pdf_catalog()} 號）'
    return None


def _syntax_problem(pdf_path: Path, rendered) -> str | None:
    """PDF 物件的寫法只收 Word 的：pdfminer 解析時會丟掉、各家讀法卻不同的地方，在 pdfplumber 開檔之前先查。
    - 字典裡同一個鍵寫兩次：Poppler 的字型表取第一個、一般的字典取最後一個（32 項以上看排序），pdfminer、MuPDF 與
      PDFium 取最後一個（第十四輪審查實測：頁面的字型表寫兩個 /FS，擷取與 MuPDF、PDFium 是答案 C，Poppler 畫的是 A）。
      pdfminer 與 MuPDF 解析時就把重複的鍵合併了，只能在解析的當下看（Watched.end_type）。
    - 名稱裡的 NUL 與不標準的 # 跳脫：#00 在 Poppler 是 C 字串的結尾（/Root#00 就是 /Root，第二十四輪審查實測：trailer
      多寫一個指到另一個目錄，Poppler 多顯示一頁），原始的 NUL 它當成分隔字元，pdfminer 都讀成名稱的一部分；# 後面不是
      剛好兩位十六進位時，pdfminer 丟掉 # 或只取那一位，Poppler 留著 # 或把下一個字吃掉（Watched）。兩位十六進位的
      其他跳脫（#20、#31）各家解法相同，照收。
    - 垂直定位字元與關鍵字裡的 NUL：pdfminer 把垂直定位字元當成空白（名稱、數字、關鍵字都斷在那裡），Poppler、MuPDF、
      PDFium 當成字的一部分（第二十五輪審查實測：真卷第 2 題 (D) 的「1」改用 /F7<VT> 這個字型畫，Poppler 顯示「提升至
      現有的 0 倍」）；NUL 反過來，兩個詞之間的各家都當空白，寫在關鍵字裡的 pdfminer 讀成字的一部分。字串裡的照收。
    - 名稱超過 NAME_BYTES 個位元組（照原始的寫法數，# 跳脫算三個）：Poppler 超過 1 MB 就整段放棄、MuPDF 截到 4095 個
      位元組，pdfminer 照單全收（第二十五輪審查實測：1 MB 的名稱塞在字型表裡，Poppler 把「不」吃掉）；PDFium 照原始的
      寫法只讀前 255 個位元組（第二十六輪審查實測：#41 寫的 86 個 A，PDFium 找不到字型，把「不」畫成「N」）。
    - 數字不是 Word 的寫法（OBJECT_NUMBER，後面接 NUMBER_END）：257 個字的數字 PDFium 只讀前 256 個（第二十六輪審查
      實測：透明度 /ca 讀成 0，字不見了）；2³² 以上 MuPDF 差一截、PDFium 讀成 0；單獨的負號 pdfminer 丟掉，MuPDF 與
      Poppler 當成壞掉的頁面大小（改用美國信紙），PDFium 讀成 0；--595、0.-842、842.0.5、842x 各家也不同（修正時實測
      頁面的 /MediaBox）。
    - 十六進位字串、關鍵字與一串 >（第二十七輪審查實測）：遇到不是十六進位數字的字，pdfminer 就結束字串、接著讀下一個
      詞，MuPDF 一直讀到 >（/Z<41/Q 1> 在 pdfminer 多一個鍵 /Q）；多出來的 ) pdfminer 讀成關鍵字（多一個鍵），MuPDF 整個
      物件丟錯；單獨的 > pdfminer 默默丟掉。所以十六進位字串只收偶數個數字、沒有空白、以 > 結束（HEX_STRING：奇數個時
      pdfminer 把最後一位當成低半位元組、別家補 0，垂直定位字元 pdfminer 跳過、別家不跳過），關鍵字只收 OBJECT_KEYWORDS，
      一串 > 照各家的切法從頭兩兩配成字典的結尾（十六進位字串的結尾不算在內），要剛好配完（Watched._parse_wclose）。
    - 對不上的結尾與不在位置上的關鍵字（第二十八輪審查實測）：字典裡的 ]、陣列裡的 >>，pdfminer 吞掉型別不符的例外、
      整個丟掉，MuPDF 在那裡讀成 null 或整個物件讀不了（真卷的 ExtGState 寫成 /ca 0]，擷取照原卷，Poppler 與 PDFium 上整頁的字都是
      透明的）；物件串流裡的 obj、endobj pdfminer 默默丟掉，null 讀成關鍵字。所以結尾要與開頭配對（Watched.end_type），
      字典與陣列裡只能有 R 與 null，物件串流裡只能有 R，其餘的關鍵字只在檔案裡物件的最上層（Watched.do_keyword）。
    - 一個物件不只一個值、字典裡值是 null 的鍵、字串裡不標準的跳脫（第二十九輪審查實測）：endobj 時 pdfminer 取前面
      最多四個值裡的第一個（startxref 取最後一個），閱讀器取 obj 後面第一個（真卷的 GS7 前面多一個帶 /TR 的字典，擷取
      照原卷，Poppler 與 PDFium 上十頁全白）；pdfminer 組字典時丟掉值是 null 的鍵，PDFium 把 /ca null 讀成 0；字串裡
      反斜線後面不是標準的跳脫時，pdfminer 連那個字一起丟掉，別家只丟反斜線。所以檔案裡物件的最上層要剛好一個值（或
      一個串流接 endstream），字典裡不收值是 null 的鍵（PyMuPDF 寫的 /DecodeParms null 除外），字串裡反斜線後面只收
      STRING_ESCAPES。
    - 字串裡的 CR：反斜線接 CR LF（接下一行），CR 落在 pdfminer 緩衝區的最後一個位元組時，pdfminer 把 LF 讀進字串，
      MuPDF、Poppler、PDFium 都不會（第三十三輪審查實測）；字串裡原始的 CR，MuPDF 照 PDF 的規定讀成 LF，別家照原樣
      （第三十三輪修正時實測，第三十四輪審查重現）。所以反斜線後面不收 CR，字串裡也不收原始的 CR（10 份真實 PDF 的
      物件字串裡兩種都沒有）。
    - 串流前面多寫的值（第三十輪審查實測）：pdfminer 讀到 stream 時取前面最後一個值當字典，接著清空堆疊（seek），
      前面的值就不見了，兩個串流讀到後面那一個；閱讀器取 obj 後面第一個（真卷的浮水印圖前面多一個 /Indexed 的串流，
      擷取照原卷，MuPDF 把越界的索引畫成白的，PDFium 上浮水印那一塊整個是黑的、蓋住題目）。所以 stream 前面也要剛好
      一個值，而且是字典。
    - 世代號不是 0：參照（`N G R`）、xref 表的每一筆、物件的開頭（`N G obj`，要是 OBJECT_HEADER）。Poppler 找不到
      世代號不符的物件、當成 null，pdfminer 與 MuPDF 不看世代號（第十四輪審查實測：字型的參照寫成 97 7 R，「不」在
      Poppler 上消失）。參照的編號與世代號也要是整數（`6 0.0 R` 在 pdfminer 是參照，在 Poppler 是兩個數字）。
    - 同一個物件在幾段 xref（增量更新、Word 的混合 xref）裡登記的位置不同：各家採用哪一段的順序不一定相同。xref 串流
      的 /Index 不照 pdfminer 的 get_objids 列：/Index 有兩段以上時它每一段都從資料的開頭重新數，第二段的物件整個
      沒查（第十五輪審查實測：答案 C 在 Poppler 上畫成 A）；/Index 的兩段不可以重疊（同一個物件登記兩次，pdfminer
      取第一筆），各段的筆數加起來要剛好是資料的筆數（/Index 說有一百萬筆、資料只有幾筆，逐筆列就耗盡記憶體）。
    - 物件串流開頭的物件編號與位置和 xref 對不上：pdfminer 照 xref 給的索引依序數，MuPDF 照開頭的編號與位置找，
      兩邊讀到不同的物件（實測：對調兩個編號，pdfminer 用 Helvetica 畫、MuPDF 用 Courier 畫）。
    - 整個物件只是一個參照（`N 0 obj M 0 R endobj`）：pdfminer 解參照時一路跟下去，繞回自己就不會停（第十四輪審查
      實測：/Info 指向它，pdfplumber 開檔就卡住），所以這裡要在 pdfplumber 開檔之前、用自己的 Document 查。
    - xref 本身：pdfminer 讀 xref 的方法與 MuPDF、Poppler、PDFium 不同的地方，讀到的就是另一份物件（第十六輪審查
      實測：startxref 沒有單獨一行時 pdfminer 讀前一版，三套閱讀器讀最新的；新一段把物件標成空的，pdfminer 還用
      舊的一筆）。每一個物件編號，pdfminer 採用的那一筆（doc.xrefs 裡第一個登記它的）要與 MuPDF 的（rendered）
      相同；xref 表只收標準的寫法（_table_trailer）；/Prev、/XRefStm 繞回讀過的一段就停（pdfminer 自己會同一段讀一千次
      才丟 RecursionError）。物件編號超過 OBJECTS 就不逐一核對。
    - xref 要重建時各家讀到的也要相同（第十八輪審查實測：目錄的 /ViewerPreferences 指向不存在的物件，Poppler 讀到它
      就丟掉 xref、自己掃描檔案，讀到另一份內容串流，答案從 C 換成 A）。不讓閱讀器有理由重建：每一個參照都要指向 xref
      登記的物件（Poppler 取不到物件就重建，重建之後物件串流裡的物件它都讀不到）。重建時照檔案裡的 trailer 與 xref
      串流找 /Root（第十八輪修正時實測：檔尾之後另一個 trailer，三套閱讀器重建之後都畫成另一棵頁面樹）：trailer 只能是
      讀到的每一段 xref 表後面那一個，xref 串流都要是讀到的那幾段，/Root 都要相同。重建時被當成物件的另一份：檔案裡
      每一段「N G obj」（DEFINITION：中間隔著空白或註解，字串、串流裡的也算）都要是 xref 登記的物件開頭，同一個編號
      也就只有一份；Poppler 與 MuPDF 再各照自己的方法重建一次（_rebuild_problem），讀到的都要與原本的相同。
      DEFINITION 是 PDFium 那一邊的：它逐詞掃描、跳過字串與串流，重建時各家在哪裡斷字串與串流也不一定相同（串流的
      /Length 不一定讀得到），所以只看位元組 —— 字串裡行中間寫著「6 0 obj」、沒有人會讀成物件的也擋，寧可錯擋（第十七輪
      審查的 /Title；Word 匯出的卷沒有這種字）。
    8 份真實卷（與另兩份 Word 匯出的還原來源卷）都是 Word 的混合 xref：物件大多在物件串流裡，重複登記的都相同，
    世代號全是 0，沒有重複的鍵，也沒有只是一個參照的物件，兩套程式逐號相同，每一個物件開頭都是登記的那一個；
    每一個參照都有登記的物件，兩個 trailer 都在 xref 表後面、/Root 相同，Poppler 與 MuPDF 重建之後讀到的與原本相同。
    MuPDF 開檔時就重建了 xref 的，直接報 xref 壞了（REBUILT）；pdfminer 自己重建時不查（開檔之後由 _rebuilt_xref 報）。
    回傳錯誤訊息，沒有就回 None。"""
    import io
    from pdfminer.pdfdocument import PDFDocument, PDFXRefFallback  # 延後 import：只處理列的單元測試不需要它
    from pdfminer.pdfparser import PDFParser, PDFStreamParser
    from pdfminer.pdftypes import PDFObjRef, PDFStream
    from pdfminer.psparser import KWD, PSEOF, PSKeyword, PSLiteral, literal_name
    from pymupdf import mupdf

    if rendered.is_repaired:
        return REBUILT
    native = mupdf.pdf_document_from_fz_document(rendered.this)  # MuPDF 自己的 xref（PyMuPDF 沒有包裝這一層）
    size = mupdf.pdf_xref_len(native)
    if size > OBJECTS:
        return f'{SYNTAX}物件太多（編號到 {size - 1}，超過 {OBJECTS}）—— 8 份真實卷最多 2,870 個物件，需要人工確認。'
    found, targets = [], []

    class Watched:
        """解析時記下 pdfminer 會丟掉的：字典裡重複的鍵（解析完只剩最後一個）、參照的世代號、名稱裡的 NUL 與不標準的
        # 跳脫、詞與詞之間的垂直定位字元、關鍵字裡的 NUL、太長的名稱、不是 Word 寫法的數字、十六進位字串、Word 不寫的
        或不在位置上的關鍵字、對不上的 > 與結尾、一個物件不只一個值、字典裡值是 null 的鍵、字串裡不標準的跳脫與 CR，以及
        每一個參照指向的編號（targets）。"""
        hex_end = gt_cont = gt_at = -1  # 上一個十六進位字串結尾的位置、同一串的下一個 >、交給 _parse_wclose 的那一個 >
        gt_closer = False  # 這一串 > 的第一個是十六進位字串的結尾

        def _peek(self):  # 還沒讀進緩衝區的下一個位元組
            at = self.fp.tell()
            after = self.fp.read(1)
            self.fp.seek(at)
            return after

        def _parse_main(self, s, i):  # 詞與詞之間：pdfminer 跳過的空白裡有垂直定位字元（別家當成字的一部分）
            m = PDFMINER_WORD.search(s, i)
            if b'\x0b' in s[i:(m.start() if m else len(s))]:
                found.append('物件的語法裡，詞與詞之間有垂直定位字元（pdfminer 當成空白，Poppler、MuPDF、PDFium 當成字的一部分）')
            if m and s[m.start()] == 0x3E:  # 一個 >：pdfminer 交給 _parse_wclose，與下一個 > 配成字典的結尾，或丟掉它
                at = self.bufpos + m.start()
                if at != self.gt_cont:  # 一串 > 的第一個
                    self.gt_closer = at == self.hex_end
                self.gt_at = at
            return super()._parse_main(s, i)

        def _parse_string(self, s, i):  # 字串裡照原樣收下的一段：原始的 CR MuPDF 照 PDF 的規定讀成 LF，別家照原樣
            m = STRING_PART.search(s, i)
            if b'\r' in s[i:m.start() if m else len(s)]:
                found.append('物件的語法裡，字串裡有 CR（MuPDF 照 PDF 的規定讀成 LF，pdfminer、Poppler、PDFium 照原樣）')
            return super()._parse_string(s, i)

        def _parse_string_1(self, s, i):  # 字串裡反斜線後面的第一個字（之後的是八進位的第二、三位）
            if not self.oct and s[i:i + 1] not in STRING_ESCAPES:
                found.append('物件的語法裡，字串裡有不標準的跳脫（反斜線後面不是 n r t b f ( ) \\、八進位數字或 LF：'
                             'pdfminer 連那個字一起丟掉，別家只丟反斜線；CR 接 LF 被緩衝區切開時，pdfminer 多讀一個 LF）')
            return super()._parse_string_1(s, i)

        def _parse_hexstring(self, s, i):  # 十六進位字串讀完時：原始的寫法（_curtoken）與結束它的那一個位元組
            j = super()._parse_hexstring(s, i)
            if self._parse1 == self._parse_main:
                if not (s[j:j + 1] == b'>' and HEX_STRING.fullmatch(self._curtoken)):
                    found.append('物件的語法裡，十六進位字串不是 Word 的寫法（只收偶數個十六進位數字、以 > 結束：遇到別的字'
                                 ' pdfminer 就結束字串、MuPDF 一直讀到 >，奇數個時 pdfminer 把最後一位當成低半位元組）')
                self.hex_end = self.bufpos + j
            return j

        def _parse_wclose(self, s, i):  # 前一個字是 >：這一個也是 > 就配成字典的結尾，不是就丟掉前一個
            paired = s[i:i + 1] == b'>'
            if paired and (s[i + 1:i + 2] or self._peek()) == b'>':  # 後面還有 >：同一串，下一個 > 從頭配
                self.gt_cont = self.gt_at + 2
            else:  # 這一串 > 到這裡為止。各家從頭兩兩配對，十六進位字串的結尾不算在內：第一個是那個結尾時，pdfminer
                # 最後要丟掉一個（就是那個結尾）；不是時要剛好配完
                if paired == self.gt_closer:
                    found.append('物件的語法裡有對不上的 >（單獨的 > pdfminer 默默丟掉，Poppler 報錯、MuPDF 讀成 null；十六進位'
                                 '字串的結尾後面緊接一個 >，pdfminer 把兩個配成字典的結尾、後面的鍵都丟了，別家報錯）')
                self.gt_cont = -1
            return super()._parse_wclose(s, i)

        def _parse_literal_hex(self, s, i):  # 名稱裡 # 後面的字：湊滿兩位之前就結束的，是不標準的跳脫
            if not (NAME_HEX.match(s, i) and len(self.hex) < 2) and len(self.hex) != 2:
                found.append('名稱裡的 # 後面不是兩位十六進位（pdfminer 丟掉 # 或只取那一位，Poppler 留著 # 或把下一個字吃掉）')
            return super()._parse_literal_hex(s, i)

        def _parse_literal(self, s, i):  # 名稱讀完時：原始的寫法有多長（# 跳脫算三個位元組，PDFium 照原始的寫法截斷）
            j = super()._parse_literal(s, i)
            if self._parse1 == self._parse_main and self.bufpos + j - self._curtokenpos - 1 > NAME_BYTES:
                found.append(f'名稱超過 {NAME_BYTES} 個位元組（照原始的寫法數，# 跳脫算三個：Poppler 超過 1 MB 就整段放棄、'
                             'MuPDF 截到 4095 個位元組、PDFium 只讀前 255 個位元組）')
            return j

        def _parse_number(self, s, i):  # 整數讀完時（遇到小數點就交給 _parse_float）
            j = super()._parse_number(s, i)
            if self._parse1 == self._parse_main:
                self._number_read(s, j)
            return j

        def _parse_float(self, s, i):
            j = super()._parse_float(s, i)
            if self._parse1 == self._parse_main:
                self._number_read(s, j)
            return j

        def _number_read(self, s, j):  # 原始的寫法（pdfminer 讀不成數字、整個丟掉的也算）與後面接的那一個位元組
            if not (OBJECT_NUMBER.fullmatch(self._curtoken) and NUMBER_END.match(s, j)):
                found.append('物件的語法裡，數字不是 Word 的寫法（只收：可以有負號、最多 9 位整數與 10 位小數，後面接空白或'
                             '分隔字元；別的寫法各家讀到的數字不同）')

        def _add_token(self, obj):  # #00 解出來也是 NUL
            if isinstance(obj, (PSLiteral, PSKeyword)):
                name = obj.name.encode('utf-8') if isinstance(obj.name, str) else obj.name
                if 0 in name and isinstance(obj, PSLiteral):
                    found.append('名稱裡有 NUL（寫成 #00 或原始的位元組：Poppler 的名稱在那裡斷開，pdfminer 讀成名稱的一部分）')
                elif 0 in name:
                    found.append('物件的語法裡，關鍵字裡有 NUL（pdfminer 讀成關鍵字的一部分，Poppler 在那裡斷開）')
                elif isinstance(obj, PSKeyword) and name not in OBJECT_KEYWORDS:
                    found.append(f'物件的語法裡有 Word 不寫的關鍵字「{name[:20].decode("latin-1")}」（pdfminer 讀成關鍵字、'
                                 '照樣讀下去，MuPDF 讀成 null 或整個物件丟錯）')
            super()._add_token(obj)

        def end_type(self, type_):  # 結尾與開頭對不上時 pdfminer 丟出例外、自己吞掉，那個結尾就不見了：在這裡先記下
            if self.curtype != type_:
                found.append('物件的語法裡有對不上的結尾（字典裡的 ]、陣列裡的 >>：pdfminer 默默丟掉，MuPDF 在那裡讀成'
                             ' null 或整個物件讀不了）')
            pos, objs = super().end_type(type_)
            keys = [literal_name(key) for key in objs[::2]]
            if type_ == 'd' and len(set(keys)) != len(keys):
                found.append(f'字典裡同一個鍵寫了兩次（/{next(key for key in keys if keys.count(key) > 1)}）')
            if type_ == 'd' and any(value is None and key != 'DecodeParms' for key, value in zip(keys, objs[1::2])):
                found.append('物件的語法裡，字典裡有值是 null 的鍵（pdfminer 整個丟掉，PDFium 把 /ca null 讀成 0）')
            return pos, objs

        def do_keyword(self, pos, token):  # 字典與陣列裡只能有 R 與 null，物件串流裡只能有 R；檔案裡物件的最上層剛好一個值
            on_top = not self.context and not isinstance(self, PDFStreamParser)
            if (token is not self.KEYWORD_R and isinstance(self, PDFStreamParser)
                    or self.context and token not in (self.KEYWORD_R, self.KEYWORD_NULL)
                    or on_top and token.name in NOT_ON_TOP):
                found.append(f'物件的語法裡，關鍵字「{token.name[:20].decode("latin-1")}」不在它的位置（物件串流裡的 obj、'
                             'endobj pdfminer 默默丟掉，null 讀成關鍵字；字典與陣列裡只能有 R 與 null）')
            elif on_top and token in (self.KEYWORD_ENDOBJ, self.KEYWORD_STARTXREF, self.KEYWORD_STREAM):
                # 前面要剛好一個值：stream 前面是它的字典（pdfminer 讀串流時清空堆疊，字典前面的值就不見了），endobj 前面
                # 也可以是串流接 endstream
                stack = [value for _, value in self.curstack]
                one = len(stack) == 1 and not isinstance(stack[0], PSKeyword)
                if not (one and (token is not self.KEYWORD_STREAM or isinstance(stack[0], dict))
                        or token is self.KEYWORD_ENDOBJ and len(stack) == 2 and isinstance(stack[0], PDFStream)
                        and stack[1] == KWD(b'endstream')):
                    found.append('物件的語法裡，物件的最上層不是剛好一個值（pdfminer 取 endobj 前面最多四個值裡的第一個、'
                                 'startxref 前面的最後一個，讀串流時丟掉字典前面的值；閱讀器取 obj 後面第一個）')
            if token is self.KEYWORD_R:
                operands = [value for _, value in self.curstack[-2:]]
                if len(operands) != 2:  # 物件串流最上層的數字先被當成物件：整個物件只是一個參照時 pdfminer 讀不了
                    found.append('參照前面少了編號與世代號')
                    return
                if type(operands[0]) is not int or operands[0] <= 0 or type(operands[1]) is not int or operands[1] != 0:
                    found.append(f'參照不是「編號 0 R」（{operands[0]} {operands[1]} R）')
                else:
                    targets.append(operands[0])
            super().do_keyword(pos, token)

    class FileParser(Watched, PDFParser):
        pass

    class StreamParser(Watched, PDFStreamParser):
        pass

    class Chained(Exception):
        pass

    class Document(PDFDocument):
        def __init__(self, parser):
            self.starts = []  # 讀過的每一段 xref 的位置，與 self.xrefs 同序
            super().__init__(parser)

        def read_xref_from(self, parser, start, xrefs):
            if start in self.starts:
                found.append('xref 的 /Prev 或 /XRefStm 繞回讀過的一段')
                return
            self.starts.append(start)
            super().read_xref_from(parser, start, xrefs)

        def getobj(self, objid):
            obj = super().getobj(objid)
            if isinstance(obj, PDFObjRef):  # 開檔時解 /Info、/Root 也走這裡：在繞回自己之前停下來
                raise Chained(objid)
            return obj

    data = Path(pdf_path).read_bytes()
    try:
        doc = Document(FileParser(io.BytesIO(data)))
        if any(isinstance(xref, PDFXRefFallback) for xref in doc.xrefs):
            return None
        entries, trailers, rooted = {}, set(), set()
        for start, xref in zip(doc.starts, doc.xrefs):
            if not hasattr(xref, 'ranges'):
                if (trailer := _table_trailer(data, start)) is None:
                    found.append('xref 表不是標準的寫法（每一筆 20 個位元組、類型只有 n 與 f，同一個物件只登記一次）')
                else:
                    trailers.add(trailer)
                    if not TRAILER_FORM.match(data, trailer):
                        found.append('trailer 不是 Word 的寫法（「trailer」、一個不巢狀的字典，接著就是 startxref；pdfminer 取 '
                                     'startxref 之前最後一個物件，Poppler 只讀 trailer 後面第一個）')
                    if isinstance(xref.get_trailer().get('Root'), PDFObjRef):  # Poppler 重建時找 /Root 的地方
                        rooted.add(trailer)
            if (listed := _listed(xref)) is None:
                found.append('xref 串流的 /Index 與資料的筆數對不上')
                continue
            for objid, times in Counter(listed).items():
                if times > 1:
                    found.append(f'第 {objid} 號物件在 xref 串流的 /Index 裡登記了兩次')
                try:
                    entry = xref.get_pos(objid)
                except KeyError:  # 空的一筆
                    continue
                if entry[2] != 0:
                    found.append(f'xref 登記第 {objid} 號物件的世代號是 {entry[2]}')
                elif entries.setdefault(objid, entry) != entry:
                    found.append(f'第 {objid} 號物件在幾段 xref 裡登記的位置不同')
        streams, unread = {}, []
        for objid, (stream, where, _) in sorted(entries.items()):
            if stream is not None:
                streams.setdefault(stream, {})[where] = objid
            elif not (header := OBJECT_HEADER.match(data, where)) or int(header[1]) != objid:
                found.append(f'第 {objid} 號物件的開頭不是「{objid} 0 obj」')
            elif (isinstance(obj := doc.getobj(objid), PDFStream) and getattr(obj.get('Type'), 'name', None) == 'XRef'
                  and where not in doc.starts):
                unread.append(objid)
        for number, members in sorted(streams.items()):
            stream = doc.getobj(number)
            count, first = stream.get('N'), stream.get('First')
            parser = StreamParser(stream.get_data())
            parser.set_document(doc)
            items = []
            try:
                while True:
                    items.append(parser.nextobject())
            except PSEOF:
                pass
            head = [value for _, value in items[:2 * count]] if type(count) is int else []
            if (type(first) is not int or len(head) != 2 * len(members) or len(items) != 3 * len(members)
                    or any(type(value) is not int for value in head)
                    or members != {index: head[2 * index] for index in range(len(members))}
                    or any(first + head[2 * index + 1] != items[len(head) + index][0] for index in members)):
                found.append(f'物件串流（第 {number} 號物件）開頭的物件編號或位置與 xref 對不上')
        highest = max(entries, default=0)
        if highest >= OBJECTS:
            found.append(f'物件太多（編號到 {highest}，超過 {OBJECTS}）')
        else:
            differs = next((n for n in range(1, max(size, highest + 1))
                            if entries.get(n) != _mupdf_entry(native, size, n)), None)
            if differs is not None:
                found.append(f'第 {differs} 號物件 pdfminer 與 MuPDF 讀到的 xref 登記不同')
        blank = COMMENT.sub(lambda comment: b' ' * len(comment[0]), data)  # 位置不變
        stray = next((d for d in DEFINITION.finditer(blank)  # 物件串流裡的物件沒有開頭，只看檔案裡的
                      if entries.get(int(d[1]), (0,))[0] is not None or entries[int(d[1])][1] != d.start()), None)
        if stray:  # 每一個開頭都在登記的位置：同一個編號也就只有一份
            found.append(f'「{stray[1].decode()} {stray[2].decode()} obj」不是 xref 登記的物件開頭（位置 {stray.start()}；'
                         '字串、串流裡的也算：xref 要重建時，Poppler 逐行找這個寫法，不跳過字串與串流，最後一份勝出）')
        dangling = next((n for n in targets if n not in entries), None)
        if dangling is not None:  # Poppler 的 XRef::fetch：取不到物件就重建
            found.append(f'參照指向 xref 沒有登記的第 {dangling} 號物件（Poppler 讀到它就丟掉 xref、自己掃描整個檔案重建）')
        extra = next((m.start() for m in TRAILER.finditer(data) if m.start() not in trailers), None)
        if extra is not None:
            found.append(f'位置 {extra} 的「trailer」不是 xref 表後面的那一個（xref 要重建時，閱讀器照檔案裡的 trailer '
                         '找 /Root）')
        if unread:
            found.append(f'第 {unread[0]} 號物件是沒有讀到的 xref 串流（xref 要重建時，MuPDF 與 PDFium 照它找 /Root）')
        roots = set()
        for xref in doc.xrefs:
            if 'Root' in (dictionary := xref.get_trailer()):
                root = dictionary['Root']
                roots.add(root.objid if isinstance(root, PDFObjRef) else repr(root))
        if len(roots) > 1:
            found.append(f'trailer 的 /Root 不一致（第 {" 號與第 ".join(map(str, sorted(roots, key=str)))} 號物件）')
        if not found and (problem := _rebuild_problem(data, entries, rendered, rooted)):  # 前面有問題就不重建（最壞多花 0.7 GB）
            found.append(problem)
    except Chained as chained:
        return (f'{SYNTAX}第 {chained.args[0]} 號物件整個只是一個參照 —— pdfminer 解參照時一路跟下去，繞回自己就不會停'
                '（開檔就卡住），需要人工確認。')
    if found:
        return (f'{SYNTAX}{found[0]} —— 各家讀到的物件可能不同（重複的鍵各家取的不同、Poppler 的名稱遇到 NUL 就斷、找不到世代號不符的物件；'
                'pdfminer 照索引、MuPDF 照編號讀物件串流；xref 的讀法不同、重建時掃描檔案的方法不同，就讀到另一份），抽出來的'
                '字不一定是閱讀器上看到的，需要人工確認。')
    return None


@contextmanager
def _opened(pdf_path: Path):
    """同一份 PDF 用兩套程式開：(pdfplumber 的 pdf, PyMuPDF 的 rendered)。PyMuPDF 先開（它不會卡住），pdfplumber 開檔
    之前先查物件的寫法（_syntax_problem，要拿 MuPDF 讀到的 xref 逐號比對）：整個物件只是一個參照時，pdfminer 開檔就
    卡住。關檔只關 pdfplumber 開的檔案：它的 close() 會把每一頁都建出來，頁面樹不是 Word 的寫法時在這裡出錯，蓋掉
    原本要報的 ValueError（第十四輪：頁面的 /MediaBox 寫成 null，報出來的是 TypeError）。"""
    import pdfplumber  # 延後 import：只處理列的單元測試不需要它
    import pymupdf

    with pymupdf.open(pdf_path) as rendered:
        if problem := _syntax_problem(pdf_path, rendered):
            raise ValueError(problem)
        pdf = pdfplumber.open(pdf_path)
        try:
            yield pdf, rendered
        finally:
            pdf.stream.close()


@contextmanager
def _unreadable():
    """讀 PDF 時出的錯一律換成 ValueError（擷取器只丟 ValueError，呼叫端也只接 ValueError）；擷取器自己丟的 ValueError
    （最裡面一層在這個模組裡）照原樣傳出。pdfplumber 把頁面直譯時的錯包成 PdfminerException，pdfminer 自己的錯是
    PSException 一族（第十二輪審查實測：字型的 /DW 寫成名稱；其中 PDFValueError 也是 ValueError）；PyMuPDF 開檔的錯是
    FileDataError，MuPDF 的錯是 FzErrorBase 一族（第十三輪審查實測：浮水印的 ICC 是懸空的參照）；其他的是兩套程式都
    沒有歸類的（第十三輪審查實測：截斷的 RunLength 串流丟 StopIteration、寫成名稱的 /Rotate 丟 TypeError、三個數字的
    /MediaBox 丟 IndexError；第十四輪：pdfminer 讀物件串流時自己丟 ValueError，以前被當成擷取器的訊息照原樣傳出）。"""
    import pymupdf  # 延後 import：只處理列的單元測試不需要它
    from pdfminer.psexceptions import PSException
    from pdfplumber.utils.exceptions import PdfminerException

    try:
        yield
    except (PdfminerException, PSException) as error:
        raise ValueError(f'pdfminer 讀不了這份 PDF（{type(error).__name__}：{error}）—— 它不認得的寫法，閱讀器卻可能照樣'
                         '畫出來，抽出來的字不一定是閱讀器上看到的，需要人工確認。') from error
    except (pymupdf.FileDataError, pymupdf.mupdf.FzErrorBase) as error:
        raise ValueError(f'PyMuPDF 讀不了這份 PDF（{type(error).__name__}：{error}）—— 閱讀器上看到的是什麼核對不了，'
                         '需要人工確認。') from error
    except Exception as error:
        if isinstance(error, ValueError) and _raised_here(error):
            raise
        raise ValueError(f'讀這份 PDF 時出錯（{type(error).__name__}：{error}）—— 兩套 PDF 程式都沒有處理的寫法，'
                         '需要人工確認。') from error


def _raised_here(error) -> bool:
    """error 是這個模組自己丟的：最裡面一層的程式碼在這個模組裡（別的套件丟的 ValueError 不是擷取器的判斷）。"""
    trace = error.__traceback__
    while trace.tb_next:
        trace = trace.tb_next
    return trace.tb_frame.f_globals.get('__name__') == __name__


def _watermark_problem(image) -> str | None:
    """浮水印（每一頁同一個位置、內容相同的圖）只收 Word 的寫法：/DeviceRGB、8 位元、FlateDecode 或不壓縮，不寫
    /Decode、/DecodeParms、/Mask、/ImageMask；/SMask 也一樣（/DeviceGray、與圖同樣大小，/Matte 只收 [0 0 0]）；圖與
    遮罩的資料都要剛好解完（Flate 解到結尾、後面沒有多的位元組）、剛好是寬 × 高 × 色版數個位元組。字壓在浮水印上
    看不看得清楚，靠它夠淡（_on_watermark），淡不淡是照 MuPDF 讀出來的顏色算的（_shades）；別的寫法各家讀法不同 ——
    索引超過 /Indexed 範圍的圖，MuPDF 夾回調色盤（白色）、PDFium 畫黑色；JPX 的 /Decode，MuPDF 照做、PDFium 不照做；
    懸空的 ICC，MuPDF 讀不了（第十三輪審查實測）；解不完整的遮罩，MuPDF 與 PDFium 當成透明，Poppler 當成不透明
    （第十四輪審查實測：黑圖在 Poppler 上把「不」蓋成一塊黑）。8 份真實卷的浮水印都是這個寫法。回傳「/鍵（原因）」，
    沒有就回 None。"""
    from pdfminer.pdftypes import PDFStream  # 延後 import：只處理列的單元測試不需要它
    from pdfplumber.utils import resolve

    def name(value):
        return getattr(resolve(value), 'name', None)

    def unfinished(stream, channels) -> bool:
        data = stream.get_rawdata()  # pdfminer 解碼過就沒有原始位元組，核對不了（pdfplumber 不解圖）
        if data is not None and 'Filter' in stream.attrs:
            inflate = zlib.decompressobj()
            try:
                data = inflate.decompress(data)
            except zlib.error:
                return True
            if not inflate.eof or inflate.unused_data:
                return True
        width, height = (resolve(stream.attrs.get(key)) for key in ('Width', 'Height'))
        return data is None or len(data) != width * height * channels

    def problem(attrs, colour_space):
        if name(attrs.get('ColorSpace')) != colour_space:
            return f'/ColorSpace（只收 /{colour_space}）'
        if resolve(attrs.get('BitsPerComponent')) != 8:
            return '/BitsPerComponent（只收 8）'
        if 'Filter' in attrs and name(attrs.get('Filter')) != 'FlateDecode':
            return '/Filter（只收 /FlateDecode 或不壓縮）'
        for key in ('Decode', 'DecodeParms', 'Mask', 'ImageMask'):
            if key in attrs:
                return f'/{key}（Word 不寫）'
        return None

    unreadable = '資料（要剛好解完、剛好是寬 × 高 × 色版數個位元組：解不完整的，各家畫法不同）'
    if found := problem(image.attrs, 'DeviceRGB'):
        return found
    if unfinished(image, 3):
        return unreadable
    if 'SMask' not in image.attrs:
        return None
    mask = resolve(image.attrs.get('SMask'))
    if not isinstance(mask, PDFStream):
        return '/SMask（要是一張圖）'
    if found := problem(mask.attrs, 'DeviceGray'):
        return f'/SMask 的 {found}'
    size = [resolve(image.attrs.get(key)) for key in ('Width', 'Height')]
    if [resolve(mask.attrs.get(key)) for key in ('Width', 'Height')] != size:
        return '/SMask（與圖的大小不同）'
    if 'Matte' in mask.attrs and resolve(mask.attrs.get('Matte')) != [0, 0, 0]:
        return '/SMask 的 /Matte（只收 [0 0 0]）'
    if unfinished(mask, 1):
        return f'/SMask 的 {unreadable}'
    return None


def _on_watermark(trace, marks):
    """壓在浮水印上的字（空白不算）要比浮水印最深的顏色深、或比最淺的顏色淺，到 MIN_CONTRAST 的對比：浮水印只看
    「每一頁同一個位置、內容相同」，深色的圖也算（第十二輪審查在兩頁同一個位置墊一塊黑色的小圖，閱讀器上是
    「下列何者█正確？」，擷取照樣有「不」）。字的亮度落在最深與最淺之間就擋：閱讀器縮放時相鄰的點混在一起，
    黑白交錯的細點平均成灰色，與灰字一樣亮（每一點與字的對比都夠，以前只比亮度最接近字的兩種顏色）；MuPDF 與
    Poppler 混的是還原後的顏色，透明與不透明的交界比兩邊都深一些（真實卷的浮水印最深的一點是 0.71，畫出來的交界
    是 0.47–0.53，黑字仍有 10:1）。字的亮度照 _luminance（顏色連同不透明度疊在白紙上），浮水印照 _shades。
    marks 是這一頁的浮水印：[(外框, 由深到淺的亮度)]。8 份真實卷壓在浮水印上的字都是不透明的黑字，浮水印最深的顏色
    亮度 0.71，對比 15:1。回傳 (字, 字框, 對比)，沒有就回 None。"""
    for span in trace:  # 描邊只用來加粗、與填色同色（_text_profile），一起看就好
        text = _luminance(span['color'], span['opacity'])
        for ucs, _, _, box in span['chars']:
            if chr(ucs).isspace():  # 與 _text_profile 一致：空白沒有筆畫，什麼顏色都看不見
                continue
            for mark, shades in marks:
                if _intersects(box, mark):
                    contrast = max((shades[0] + 0.05) / (text + 0.05), (text + 0.05) / (shades[-1] + 0.05), 1.0)
                    if contrast < MIN_CONTRAST:
                        return chr(ucs), box, contrast
    return None


def rows_of(pdf_path: Path) -> list[Row]:
    """PDF → 表格的列（閱讀順序）。版面的檢查都在這裡做；題目層級的檢查在 parse_rows()。"""
    with _unreadable(), _opened(pdf_path) as (pdf, rendered):
        if _rebuilt_xref(pdf, rendered):
            raise ValueError(REBUILT)
        if problem := _page_list_problem(pdf, rendered):
            raise ValueError(problem)
        for pno, page in enumerate(pdf.pages, start=1):
            # 註解（文字方塊、印章、便利貼、螢光筆、表單欄位）不在頁面內容裡，pdfminer 抽不到。
            # Link 除外（帶外觀串流的不算）：Word 的網址會變成 Link，它本身不畫任何東西。
            if odd := _annotations(page):
                raise ValueError(f'第 {pno} 頁有 PDF 註解（{"、".join(odd)}）—— 註解不在頁面內容裡，擷取不到，'
                                 '可能是勘誤或補充說明，需要人工確認。')
            if odd := _resources(page):
                raise ValueError(f'第 {pno} 頁有 Word 不會寫的{"、".join(odd)} —— 各家算繪器畫法不同（轉換函數、混色、'
                                 '遮罩、字型的對照表），或字形程序畫什麼都可以，抽出來的字不一定是閱讀器上看到的，'
                                 '需要人工確認。')
        if problem := _layers_or_forms(rendered):
            raise ValueError(problem)
        pages = []
        for pno, page in enumerate(pdf.pages, start=1):
            if problem := _content_problem(page, rendered[pno - 1]):
                raise ValueError(f'第 {pno} 頁的{problem} —— 兩套 PDF 程式可能讀成不同的內容（審查實測：運算子後面接 NUL、'
                                 '多給的運算元，閱讀器把字壓成一條線，擷取照樣是原字），需要人工確認。')
            tables = page.find_tables()
            if len(tables) != 1:
                raise ValueError(_table_count_error(pno, page, len(tables)))
            pages.append((pno, page, tables[0]))

        numbers, ends = {}, []
        for pno, page, table in pages:
            outside = [c for c in page.chars if not _inside(c, table.bbox)]
            for c in outside:  # 行尾的控制字元、不斷行空白會被 strip 掉，整行照樣符合允許清單
                if odd := _odd_character(c['text']):
                    raise ValueError(f'第 {pno} 頁表格外有特殊字元 {odd}（x={c["x0"]:.1f}, top={c["top"]:.1f}）'
                                     '—— 看得見的字可能被對到空白或控制字元，需要人工確認。')
            for line in _page_lines(outside):
                if _allowed(line):
                    continue
                if line == END_MARK:
                    ends.append(pno)
                elif m := PAGE_NUMBER.fullmatch(line):
                    numbers.setdefault(pno, []).append((int(m[1] or m[3]), int(m[2]) if m[2] else None))
                elif SUBJECT_LINE.fullmatch(line):
                    raise ValueError(f'第 {pno} 頁的科目「{line}」不在已知的科目（SUBJECTS）裡 —— 新科目要人工確認版面後'
                                     '再加進清單；也可能是黏在科目後面的勘誤。')
                else:
                    raise ValueError(f'第 {pno} 頁表格外有預期之外的文字：「{line}」—— 可能是勘誤或補充說明，'
                                     '需要人工確認。')
        _check_page_numbers(numbers, ends, len(pages))

        # 浮水印 = 每一頁都在同一位置出現、內容相同的圖。只有一頁時無從判斷，一律當成內容。
        per_page = [{_image_key(im) for im in page.images} for _, page, _ in pages]
        watermarks = set.intersection(*per_page) if len(per_page) > 1 else set()
        palettes = {}  # 浮水印的 xref → 每一種顏色的亮度（_shades，每一張只算一次）

        # 題目欄裡，題號在左、文字在右。文字的左緣 = 選項標記「(」最靠左的位置（每題四個選項都從那裡起頭）。
        text_left = min((c['x0'] for _, page, table in pages for c in page.chars
                         if c['text'] == '(' and _inside(c, table.bbox)), default=None)
        if text_left is None:
            raise ValueError('整份 PDF 找不到選項標記「(」—— 版面不在預期內。')

        rows = []
        for pno, page, table in pages:
            shown = rendered[pno - 1]
            log, trace = shown.get_bboxlog(), shown.get_texttrace()  # 畫的順序：trace 的 seqno 是 log 的索引
            thick = _probe(page)
            if any(kind == 'fill-shade' and max(map(abs, box)) >= UNBOUNDED for kind, box in log):
                raise ValueError(f'第 {pno} 頁有範圍無法判斷的漸層（sh，沒有 /BBox）—— 它的範圍只由剪裁路徑決定，'
                                 '看不出蓋住了哪些字，需要人工確認。')
            if hit := _covered(log, trace):
                kind, box, text, glyph = hit
                raise ValueError(f'第 {pno} 頁的{DRAWING_KINDS[kind]}（x={box[0]:.1f}–{box[2]:.1f}, '
                                 f'top={box[1]:.1f}–{box[3]:.1f}）畫在字「{text}」（x={glyph[0]:.1f}, top={glyph[1]:.1f}）'
                                 '之後，把字蓋住了 —— 浮水印要最先畫、在字的下面；蓋在字上的圖會讓抽出來的字與閱讀器上'
                                 '看到的不同，需要人工確認。')
            if clip := _odd_clip(shown):
                raise ValueError(f'第 {pno} 頁有不是矩形的剪裁路徑（範圍 x={clip[0]:.1f}–{clip[2]:.1f}, '
                                 f'top={clip[1]:.1f}–{clip[3]:.1f}）—— 被剪裁的字可能只看得到一部分或完全看不到，'
                                 '擷取時卻照樣抽得出來，需要人工確認。')
            glyphs = _visible_glyphs(shown, trace)
            figures = [im for im in page.images if _image_key(im) not in watermarks]
            taken, placed = set(), set()  # 分到某一列的字、落在某一題題目欄裡的圖
            for k, r in enumerate(table.rows, start=1):
                cells = [c for c in r.cells if c is not None]
                if len(cells) < 2:
                    raise ValueError(f'第 {pno} 頁第 {k} 列只有 {len(cells)} 格，應為「答案欄 + 題目欄」。')
                answer_x1 = cells[0][2]
                top, bottom = min(c[1] for c in cells), max(c[3] for c in cells)
                chars = [c for c in page.chars if _inside(c, (cells[0][0], top, cells[-1][2], bottom))]
                taken.update(id(c) for c in chars)
                answer = ''.join(c['text'] for c in chars if _mid(c)[0] < answer_x1).strip()
                number = ''.join(c['text'] for c in chars if answer_x1 <= _mid(c)[0] < text_left).strip()
                where = f'第 {pno} 頁第 {k} 列' + (f'（題號 {number}）' if number else '')
                _check_chars(chars, where, glyphs)  # 先確定字可信，再用答案欄的字認表頭
                if len(cells) != 2 and answer != '答案':  # 表頭的灰底會多切出兩格（8 份真實卷都是 4 格）
                    raise ValueError(f'{where}有 {len(cells)} 格，應為「答案欄 + 題目欄」兩格 —— 多出來的格'
                                     '（題目欄被切開，或多一欄）可能是註記或勘誤，需要人工確認。')
                question_cell = (answer_x1, top, cells[-1][2], bottom)
                if answer != '答案':  # 表頭的答案格有兩塊灰底（8 份真實卷都有）
                    # 答案欄是最要緊的一個字：被蓋住、塗改、劃掉時，pdfminer 照樣抽得出原本的字。
                    # 除了字，畫了任何東西都算，不論粗細（細矩形、漸層、圖片）：8 份真實卷的答案欄裡什麼都沒有
                    if marks := _marks(log, _inner((cells[0][0], top, answer_x1, bottom))):
                        raise ValueError(f'{where}的答案欄裡有圖形（{"、".join(DRAWING_KINDS.get(m, m) for m in marks)}）'
                                         '—— 答案可能被蓋住、塗改或劃掉，抽出來的字不一定是閱讀器上看到的，需要人工確認。')
                    in_question = [c for c in chars if _mid(c)[0] >= answer_x1]
                    if line := _strike(log, in_question, _inner(question_cell), text_left):
                        raise ValueError(f'{where}的題目欄裡有穿過文字中段的細線（x={line[0]:.1f}–{line[2]:.1f}, '
                                         f'top={line[1]:.1f}–{line[3]:.1f}）—— 可能是刪除線或遮住字的細條，抽出來的字'
                                         '不一定是閱讀器上看到的，需要人工確認。')
                text = [c for c in chars if _mid(c)[0] >= text_left]
                in_cell = {i for i, im in enumerate(figures) if _overlaps(im, question_cell)}
                if answer != '答案':  # 表頭列不算題目欄
                    placed |= in_cell
                # pdfminer 看得到圖片與圖片遮罩（page.images），看不到漸層（sh）
                shades = sum(1 for kind, box in log if kind == 'fill-shade' and _intersects(box, _inner(question_cell)))
                rows.append(Row(page=pno, answer=answer, number=number, lines=tuple(text_lines(text, where)),
                                figures=len(in_cell) + _log_drawings(log, question_cell)
                                + shades))
            stray = [c for c in page.chars if _inside(c, table.bbox) and c['text'].strip() and id(c) not in taken]
            if stray:
                raise ValueError(f'第 {pno} 頁的表格裡有不屬於任何一列的字「{stray[0]["text"]}」'
                                 f'（x={stray[0]["x0"]:.1f}, top={stray[0]["top"]:.1f}）—— 擷取時會被丟掉，'
                                 '可能是註記或勘誤，需要人工確認。')
            unplaced = [im for i, im in enumerate(figures) if i not in placed]
            if unplaced:
                raise ValueError(f'第 {pno} 頁有不在任何題目欄裡的圖片（x={unplaced[0]["x0"]:.1f}, '
                                 f'top={unplaced[0]["top"]:.1f}）—— 浮水印以外的圖只該出現在題目裡，'
                                 '可能是勘誤或補充說明，需要人工確認。')
            if lost := _unextracted_glyph(trace, page.chars):
                text, box = lost
                raise ValueError(f'第 {pno} 頁畫出了擷取不到的字「{text}」（x={box[0]:.1f}, top={box[1]:.1f}）—— 閱讀器上'
                                 '看得到，pdfminer 卻沒有讀到（例如字型的 ToUnicode 把字對到空字串、它不認得的寫法，或兩套程式讀到不同版本的頁面），'
                                 '抽出來的與看到的不同，需要人工確認。')
            if box := _unextracted_image(log, page.images):
                raise ValueError(f'第 {pno} 頁畫出了擷取不到的圖（x={box[0]:.1f}–{box[2]:.1f}, top={box[1]:.1f}–{box[3]:.1f}）'
                                 '—— 閱讀器上看得到，pdfminer 卻讀不出來（例如圖片 XObject 把 /Width /Height 寫成縮寫的 /W /H；'
                                 '放在題目欄裡，那一題就會被當成純文字題），需要人工確認。')
            if problem := _text_profile(trace, table.bbox):
                raise ValueError(f'第 {pno} 頁{problem} —— 需要人工確認。')
            marks = []
            for im in page.images:
                if _image_key(im) in watermarks:
                    if problem := _watermark_problem(im['stream']):
                        raise ValueError(f'第 {pno} 頁的浮水印不是 Word 的寫法：{problem} —— 各家畫這張圖的方法不同，'
                                         '看起來夠淡、閱讀器上卻可能是深色，壓在上面的字看不見，需要人工確認。')
                    if (xref := im['stream'].objid) not in palettes:
                        palettes[xref] = _shades(rendered, xref)
                    marks.append(((im['x0'], im['top'], im['x1'], im['bottom']), palettes[xref]))
            if hit := _on_watermark(trace, marks):
                text, box, contrast = hit
                raise ValueError(f'第 {pno} 頁的字「{text}」（x={box[0]:.1f}, top={box[1]:.1f}）壓在浮水印上，與浮水印的'
                                 f'顏色對比只有 {contrast:.2f}:1，不到 {MIN_CONTRAST}:1 —— 每一頁同一個位置、內容相同的圖當成'
                                 '浮水印，它要夠淡，壓在上面的字才看得清楚；深色的圖把字蓋成一團，擷取時卻照樣抽得出來，'
                                 '需要人工確認。')
            if thick:
                text, width, size = thick
                raise ValueError(f'第 {pno} 頁的字「{text}」描邊在頁面上寬 {width:.2f}pt，超過字級 {size:.1f}pt 的一成 —— '
                                 '字會糊成一團、蓋到旁邊的字，需要人工確認。')
            for c in page.chars:  # 表格裡的字已經逐字核對過（_check_chars）
                if c['text'].strip() and not _inside(c, table.bbox) and not _drawn(c, glyphs):
                    raise ValueError(f'第 {pno} 頁表格外的字「{c["text"]}」（x={c["x0"]:.1f}, top={c["top"]:.1f}）'
                                     '在 PyMuPDF 畫出的頁面上找不到：被剪裁掉，或兩套 PDF 程式讀到的字不同 —— 例如假的'
                                     '「《以下空白》」：讀者看不到結尾，檢查卻以為 PDF 完整，需要人工確認。')
        if rendered.is_repaired:  # PyMuPDF 有時畫到那一頁才重建 xref：開檔時查過一次還不夠
            raise ValueError('PDF 的 xref 表壞了，PyMuPDF 畫頁面時才自己重建 —— 兩套 PDF 程式讀到的可能是不同版本的頁面，'
                             '需要人工確認（重新下載，或向出題單位確認）。')
        return rows


def parse_rows(rows) -> list[dict]:
    """表格的列 → 題目：{number, page, column, answer, stem, options}。

    column 一律是 None：表格版面只有一欄，題目的位置由頁碼與題號決定。
    page 是題目開始的那一頁。題號必須從 1 起連續編號。
    """
    questions = []
    after_header = False  # 上一列是頁首的表頭：續列只能緊接在這裡
    page = None
    for row in rows:
        first_on_page, page = row.page != page, row.page
        if row.answer == '答案':
            if not first_on_page:
                raise ValueError(f'第 {row.page} 頁：表頭出現在頁中（表頭只會是每頁的第一列）—— 可能是另一張表或題組，'
                                 f'需要人工確認：{row}')
            if row.number or tuple(line.strip() for line in row.lines) != ('題目',):
                raise ValueError(f'第 {row.page} 頁的表頭不是「答案｜題目」：{row}')
            after_header = True
            continue
        if not row.answer and not row.number:
            if not questions:
                raise ValueError(f'第 {row.page} 頁：續列之前沒有任何題目：{row.lines[:2]}')
            if not after_header:
                raise ValueError(f'第 {row.page} 頁：題目之間出現沒有答案與題號的列（續列只會緊接在頁首的表頭之後）'
                                 f'—— 可能是題組說明或勘誤，需要人工確認：{row.lines[:2]}')
            questions[-1]['lines'].extend(row.lines)
            questions[-1]['figures'] += row.figures
            after_header = False
            continue
        after_header = False
        m = NUMBER_RE.fullmatch(row.number)
        if not m:
            raise ValueError(f'第 {row.page} 頁：題號是「{row.number}」，不是「12.」這種格式。')
        number, expected = int(m.group(1)), len(questions) + 1
        if number != expected:
            raise ValueError(f'第 {row.page} 頁：題號 {number}，應為 {expected}（題號必須從 1 連續編號）。')
        if row.answer not in ('A', 'B', 'C', 'D'):
            raise ValueError(f'第 {row.page} 頁第 {number} 題：答案欄是「{row.answer}」，不是 A–D。')
        questions.append({'number': number, 'page': row.page, 'answer': row.answer,
                          'lines': list(row.lines), 'figures': row.figures})
    if not questions:
        raise ValueError('沒有任何題目。')
    with_figures = [q['number'] for q in questions if q['figures']]
    if with_figures:
        raise ValueError(f'第 {"、".join(map(str, with_figures))} 題的題目欄裡有圖片或圖形 —— 可能是圖表（內容讀不到，'
                         '只匯入文字會變成無解的題目），也可能是螢光筆、儲存格底色這類標記（看不出用意），需要人工處理。')
    return [_question(q) for q in questions]


def _question(q: dict) -> dict:
    stem, options = '', []
    for line in q['lines']:
        m = OPTION_RE.match(line)
        if m:
            if OPTION_MARK.search(m.group(2)):
                raise ValueError(f'第 {q["number"]} 題：同一行有兩個選項標記：{line.strip()}')
            options.append({'key': m.group(1), 'text': m.group(2)})
        elif options:
            options[-1]['text'] = join_lines(options[-1]['text'], line)
        else:
            stem = join_lines(stem, line)
    keys = [o['key'] for o in options]
    if keys != ['A', 'B', 'C', 'D']:
        raise ValueError(f'第 {q["number"]} 題：選項是 {keys}，應為 A、B、C、D。')
    stem = stem.strip()
    if not stem:
        raise ValueError(f'第 {q["number"]} 題：沒有題幹。')
    for o in options:
        o['text'] = LIST_SEPARATOR.sub('', o['text'].strip()).strip()
        if not o['text']:
            raise ValueError(f'第 {q["number"]} 題：選項 ({o["key"]}) 是空的。')
    return {'number': q['number'], 'page': q['page'], 'column': None, 'answer': q['answer'],
            'stem': stem, 'options': options}


def extract(pdf_path: Path) -> list[dict]:
    return parse_rows(rows_of(pdf_path))
