# iPAS 公告試題 PDF 擷取器的測試。官方 PDF 不進 CI：這裡用合成的列與字元驗斷行、下標與各條檢查，
# 再用 PyMuPDF 畫與官方同結構的小 PDF 跑整條管線，連同模組說明裡列出的每一種「一律報錯」的版面。
# 合成 PDF 照 Word 的寫法（test_the_synthetic_pdf_is_structured_like_word 釘住）：格線、表頭底色都是
# `x y w h re f` 的填色矩形，pdfminer 認成 rect（PyMuPDF 的 draw_rect 會多寫一個 h，pdfminer 就認成 curve：
# 只在測 curve 那條路時用它）；表頭的答案格裡另有兩塊灰底；表格外有 12 條頁面框線（描線，pdfminer 認成 line）；
# 儲存格的字後面跟著空白字元（「答案 」「C 」「1.  」「題目 」）；表頭的字填色加描邊（粗體）；
# 浮水印帶透明度，是每頁第一個畫的東西（在所有字的下面）。
# 字型、字寬、字距與官方 PDF 不同，所以字距門檻與下標另外用合成的字元驗。
import functools
import re
import string
import struct
import threading
import tracemalloc
import zlib
from types import SimpleNamespace

import pdfplumber
import pymupdf
import pytest
from pdfminer.pdfexceptions import PDFValueError
from pdfminer.pdftypes import PDFStream
from pdfminer.psexceptions import PSSyntaxError
from pdfminer.psparser import END_STRING, ESC_STRING, HEX, LIT, NONSPC, OCT_STRING, SPC
from pdfplumber.utils import extract_text
from pdfplumber.utils.exceptions import PdfminerException

import ipas_exam_pdf
from ipas_exam_pdf import (C_SPACE, COMMENT, DEFINITION, FILLER, HEX_STRING, LINE_END, MIN_CONTRAST, NAME_HEX,
                           NOT_ON_TOP, NUMBER_END, OBJECT_HEADER, OBJECT_KEYWORDS, OBJECT_NUMBER, OBJECTS, OPERATORS,
                           PDF_STRING, PDFMINER_WORD, POPPLER_SPACE, SPACE, STRING_ESCAPES, STRING_PART, TOKEN,
                           TRAILER_FORM, X_TOLERANCE, XREF_ENTRY, XREF_SUBSECTION, XREF_TABLE, XREF_TRAILER,
                           Y_TOLERANCE, Row, _check_chars, _content_grammar, _content_tokens,
                           _contrast, _drawn, _font_problem, _inside, _intersects, _luminance,
                           _odd_character, _on_watermark, _origin, _overlaps, _page_list_problem, _resources,
                           _listed, _poppler_rebuild, _same_glyph, _shades, _skewed, _syntax_problem, _table_trailer,
                           _text_profile, _unextracted_glyph, _unextracted_image, _visible_glyphs, _watermark_problem,
                           extract, header, inline_subscripts, join_lines, parse_rows, text_lines)


def _header(page=1):
    return Row(page=page, answer='答案', number='', lines=('題目',))


HEADER = _header()


def _q(number, answer, *lines, page=1, figures=0):
    return Row(page=page, answer=answer, number=f'{number}.', lines=lines, figures=figures)


def _four_options(n):
    return (f'(A)甲{n}；', f'(B)乙{n}；', f'(C)丙{n}；', f'(D)丁{n}')


# ── 斷行接回：PDF 行尾有沒有空白字元，決定怎麼接 ─────────────────────────────────

@pytest.mark.parametrize(('a', 'b', 'joined'), [
    ('設定減碳目', '標。經盤查', '設定減碳目標。經盤查'),                      # 中文之間的一般斷行
    ('盤點（Global ', 'Stocktake）', '盤點（Global Stocktake）'),              # 英文字之間
    ('分別屬於 ', 'ISO 14064-1', '分別屬於 ISO 14064-1'),                      # 中英交界，PDF 留了空白
    ('依據 IPCC ', '規範，關於', '依據 IPCC 規範，關於'),
    ('下列何者屬於', 'CDP 用以', '下列何者屬於 CDP 用以'),                      # 中英交界，沒留空白也補一個
    ('ASB 與 TCFD', '以簡化報告', 'ASB 與 TCFD 以簡化報告'),
    ('目標年', '2030 年', '目標年 2030 年'),                                  # 數字也算英數字
    ('名稱含㐀', 'ABC 公司', '名稱含㐀 ABC 公司'),                             # 擴充 A 區的字也是中文字
    ('係數（例如電力係數、', 'GWP 值）', '係數（例如電力係數、GWP 值）'),        # 全形標點與英文之間不補
    ('例如 GWP', '）的定義', '例如 GWP）的定義'),                              # 英文與全形標點之間也不補
    ('下列何者', '(1)甲', '下列何者(1)甲'),                                    # 半形括號不是英數字
    ('組合之被投資公司。 ', '依據 SBTi', '組合之被投資公司。依據 SBTi'),        # 硬換行，前面是標點
    ('一、公司基本資料 ', '二、盤查邊界設定', '一、公司基本資料 二、盤查邊界設定'),  # 硬換行的列點
    ('已知如下： ', 'ISO 14064-1', '已知如下：ISO 14064-1'),                   # 全形標點之後不空格
    ('排放（範疇一） ', '二、外購電力', '排放（範疇一）二、外購電力'),          # 全形括號也是標點
    ('計入 C-', 'Corp 的 Scope 2', '計入 C-Corp 的 Scope 2'),                  # 詞中間斷行：沒有行尾空白
    ('kgCO₂e/', 'kWh', 'kgCO₂e/kWh'),
    ('', '第一行', '第一行'),
    ('  ', '第一行', '第一行'),                                                # 選項標記之後直接換行
    ('最後一行', ' ', '最後一行'),
], ids=['cjk-soft', 'latin-words', 'cjk-latin-trailing', 'latin-cjk-trailing', 'cjk-latin-soft',
        'latin-cjk-soft', 'cjk-digit-soft', 'extension-a-ideograph', 'punct-latin', 'latin-punct',
        'cjk-halfwidth-paren', 'hard-after-punct', 'hard-list-item', 'hard-punct-then-latin',
        'hard-after-fullwidth-paren', 'mid-word-hyphen', 'mid-word-slash', 'first-line', 'blank-before',
        'blank-after'])
def test_line_joins_follow_the_pdf_signals(a, b, joined):
    assert join_lines(a, b) == joined


# ── parse_rows：列 → 題目 ───────────────────────────────────────────────────

def test_rows_become_questions_in_order():
    qs = parse_rows([HEADER,
                     _q(1, 'C', '第一題的題幹', '接到下一行？ ', *_four_options(1)),  # 題幹行尾的空白要去掉
                     _q(2, 'A', '第二題？', *_four_options(2))])
    assert qs == [
        {'number': 1, 'page': 1, 'column': None, 'answer': 'C', 'stem': '第一題的題幹接到下一行？',
         'options': [{'key': 'A', 'text': '甲1'}, {'key': 'B', 'text': '乙1'},
                     {'key': 'C', 'text': '丙1'}, {'key': 'D', 'text': '丁1'}]},
        {'number': 2, 'page': 1, 'column': None, 'answer': 'A', 'stem': '第二題？',
         'options': [{'key': 'A', 'text': '甲2'}, {'key': 'B', 'text': '乙2'},
                     {'key': 'C', 'text': '丙2'}, {'key': 'D', 'text': '丁2'}]},
    ]


def test_an_option_that_wraps_continues_on_the_next_line():
    # 選項在儲存格裡折成兩行：第二行接回選項，不是題幹（L11 第 5 題）
    qs = parse_rows([_q(1, 'A', '關於 RE100，下列敘述何者不正確？ ', '(A)所接受的再生能源包含風力、太陽能、地熱、',
                        '水力、生質能、核能等 6 種； ', '(B)乙； ', '(C)丙； ', '(D)丁')])
    assert qs[0]['stem'] == '關於 RE100，下列敘述何者不正確？'
    assert [o['text'] for o in qs[0]['options']] == ['所接受的再生能源包含風力、太陽能、地熱、水力、生質能、核能等 6 種',
                                                     '乙', '丙', '丁']


def test_every_option_can_wrap_onto_the_next_line():
    # 每個選項都可能折行，折行接回的是「剛才那個」選項（115-02 L11 第 26 題四個都折）。
    # (D) 折在「TCFD」與「以簡化報告」之間，PDF 沒留行尾空白：中英交界要補一個空格
    qs = parse_rows([_q(1, 'D', '關於這三個揭露框架及其應用，下列何者不正確？ ',
                        '(A)CDP 著重氣候與環境數據揭露，常作為投資人評估企業之', '依據； ',
                        '(B)GRI 提供利害關係人導向框架，強調透明度與完整資', '訊揭露； ',
                        '(C)SASB 以投資人為主要對象，聚焦永續議題之揭', '露； ',
                        '(D)應優先採用 GRI 並可取代 SASB 與 TCFD', '以簡化報告 ')])
    assert [o['text'] for o in qs[0]['options']] == [
        'CDP 著重氣候與環境數據揭露，常作為投資人評估企業之依據', 'GRI 提供利害關係人導向框架，強調透明度與完整資訊揭露',
        'SASB 以投資人為主要對象，聚焦永續議題之揭露', '應優先採用 GRI 並可取代 SASB 與 TCFD 以簡化報告']


def test_a_row_split_across_pages_continues_the_previous_question():
    qs = parse_rows([Row(page=1, answer='D', number='1.', lines=('題幹？', '(A)甲；', '(B)乙；')),
                     _header(2),
                     Row(page=2, answer='', number='', lines=('(C)丙；', '(D)丁')),
                     _q(2, 'A', '下一題？', *_four_options(2), page=2)])
    assert [o['text'] for o in qs[0]['options']] == ['甲', '乙', '丙', '丁']
    assert qs[0]['page'] == 1  # 題目從哪一頁開始
    assert qs[1]['number'] == 2


def test_only_the_trailing_list_separator_is_removed_from_options():
    # 只拿掉行尾列舉用的「；」（含半形「;」與前後的空白）：選項中間的「；」（L12 第 14、20 題）、
    # 選項本身的句號、逗號、頓號都留著
    qs = parse_rows([_q(1, 'C', '題幹？', '(A)（1）屬於類別 4；（2）屬於類別 3； ', '(B)乙;', '(C)強制揭露 Scope 1 ；',
                        '(D)丁。'),
                     _q(2, 'A', '題幹？', '(A)甲，', '(B)乙、', '(C)丙。；', '(D)丁')])
    assert [o['text'] for o in qs[0]['options']] == ['（1）屬於類別 4；（2）屬於類別 3', '乙', '強制揭露 Scope 1', '丁。']
    assert [o['text'] for o in qs[1]['options']] == ['甲，', '乙、', '丙。', '丁']


def test_question_numbers_can_have_three_digits():
    qs = parse_rows([HEADER, *(_q(n, 'A', '題幹？', *_four_options(n)) for n in range(1, 101))])
    assert [q['number'] for q in qs] == list(range(1, 101))


def test_parenthesised_letters_inside_a_stem_are_not_options():
    # 選項標記只認行首的大寫字母：題幹裡的 (a)、句中的 (B) 都是題幹
    qs = parse_rows([_q(1, 'A', '(a)甲方案與 (b)乙方案中，', '承上題 (B) 的做法，何者正確？', *_four_options(1))])
    assert qs[0]['stem'] == '(a)甲方案與 (b)乙方案中，承上題 (B) 的做法，何者正確？'


@pytest.mark.parametrize(('rows', 'message'), [
    ([Row(page=1, answer='', number='', lines=('(A)孤兒續列',))], '續列之前沒有任何題目'),
    ([_q(1, 'A', '題幹？', *_four_options(1)), Row(page=1, answer='', number='', lines=('題組說明',))],
     '題目之間出現沒有答案與題號的列'),
    ([HEADER, _q(1, 'A', '題幹？', *_four_options(1)), Row(page=1, answer='', number='', lines=('（本題送分）',))],
     '題目之間出現沒有答案與題號的列'),
    ([HEADER, _q(1, 'A', '題幹？', *_four_options(1)), HEADER, Row(page=1, answer='', number='', lines=('（以下為題組）',))],
     '表頭出現在頁中'),
    ([_q(1, 'E', '題幹？', *_four_options(1))], '答案'),
    ([_q(1, '', '題幹？', *_four_options(1))], '答案'),
    ([Row(page=1, answer='A', number='一、', lines=('題幹？', *_four_options(1)))], '題號'),
    ([Row(page=1, answer='A', number='1', lines=('題幹？', *_four_options(1)))], '題號'),
    ([Row(page=1, answer='A', number='1、', lines=('題幹？', *_four_options(1)))], '題號'),
    ([Row(page=1, answer='A', number='1.5', lines=('題幹？', *_four_options(1)))], '題號'),
    ([Row(page=1, answer='A', number='1.', lines=('題幹？', '(A)甲；', '(B)乙；')), _header(2),
      Row(page=2, answer='B', number='', lines=('(C)丙；', '(D)丁'))], '題號'),  # 有答案沒有題號：不是續列
    ([_q(1, 'A', '題幹？', '(A)甲；', '(B)乙；', '(D)丁')], '選項'),
    ([_q(1, 'A', '題幹？', '(A)甲；', '(B)乙；', '(B)乙；', '(C)丙')], '選項'),
    ([_q(1, 'A', '題幹？', '(A)甲；(B)乙；', '(C)丙；', '(D)丁')], '同一行'),
    ([_q(1, 'A', '(A)甲；', '(B)乙；', '(C)丙；', '(D)丁')], '沒有題幹'),
    ([_q(1, 'A', '題幹？', '(A)甲；', '(B)；', '(C)丙；', '(D)丁')], r'選項 \(B\) 是空的'),
    ([_q(2, 'A', '題幹？', *_four_options(2))], '題號'),
    ([_q(1, 'A', '題幹？', *_four_options(1)), _q(3, 'A', '題幹？', *_four_options(3))], '題號'),
    ([Row(page=1, answer='答案', number='', lines=('題目', '多出來的字'))], '表頭'),
    ([Row(page=1, answer='答案', number='1.', lines=('題目',))], '表頭'),
    ([_q(1, 'A', '題幹？', *_four_options(1), figures=1), _q(2, 'B', '題幹？', *_four_options(2)),
      _q(3, 'C', '依下表？', *_four_options(3), figures=1)], '第 1、3 題的題目欄裡有圖片'),
    ([Row(page=1, answer='A', number='1.', lines=('依下圖？', '(A)甲；', '(B)乙；')), _header(2),
      Row(page=2, answer='', number='', lines=('(C)丙；', '(D)丁'), figures=1)], '第 1 題的題目欄裡有圖片'),
    ([Row(page=1, answer='A', number='1.', lines=('題幹？', '(A)甲；')), _header(2),
      Row(page=2, answer='', number='', lines=('(B)乙；', '(C)丙；')),
      Row(page=2, answer='', number='', lines=('(D)丁',))], '題目之間出現沒有答案與題號的列'),
    ([_q(1, 'A', '題幹？', '(A)甲；', '(B)乙；', '(C)丙；', '(D)丁；', '(E)戊')], '選項'),
    ([_q(1, 'A', '題幹？', '(A)甲；', '(B)乙；', '(C)丙；', '(D)丁；(E)戊')], '同一行'),
    ([], '沒有任何題目'),
], ids=['orphan-continuation', 'mid-page-continuation', 'note-row-after-a-question', 'mid-page-header',
        'answer-E', 'answer-blank', 'number-not-digits', 'number-without-dot', 'number-with-ideographic-comma',
        'number-with-more-digits', 'answer-without-number', 'missing-option', 'repeated-option',
        'two-options-one-line', 'no-stem', 'empty-option', 'numbering-starts-at-2', 'numbering-skips', 'odd-header',
        'header-with-number', 'figures', 'figure-on-the-continuation', 'two-continuations-in-a-row', 'fifth-option',
        'fifth-option-same-line', 'empty'])
def test_anything_unexpected_stops_the_extraction(rows, message):
    with pytest.raises(ValueError, match=message):
        parse_rows(rows)


# ── 字元 → 行：行內空白、行尾空白、字距門檻、下標 ────────────────────────────────

def _ch(text, x0, top, size=12.0):
    width = size * (0.55 if text.isascii() else 1.0)
    return {'text': text, 'x0': x0, 'x1': x0 + width, 'top': top, 'bottom': top + size,
            'doctop': top, 'y0': 800 - top - size, 'y1': 800 - top, 'upright': True, 'size': size}


def _kgco2e(top=320.0):
    return [_ch('k', 100, top), _ch('g', 106.6, top), _ch('C', 113.2, top), _ch('O', 119.8, top),
            _ch('2', 126.4, top + 4.3, size=8.0), _ch('e', 130.8, top)]


def test_the_raw_pdf_layout_really_breaks_without_inlining():
    # 對照組：不處理下標時，pdfplumber 會把 2 放到另一行 —— 這正是 L12 第 8 題「柴2油」的成因
    raw = extract_text(_kgco2e() + [_ch('下', 100, 340)], x_tolerance=X_TOLERANCE, y_tolerance=Y_TOLERANCE)
    assert raw.split('\n') == ['kgCO e', '2', '下']


def test_a_small_digit_becomes_a_subscript_on_its_own_line():
    assert text_lines(_kgco2e() + [_ch('下', 100, 340)]) == ['kgCO₂e', '下']


def test_a_subscript_belongs_to_its_own_line_not_the_line_above():
    # 下標只找同一行的字：上一行的 x 右緣雖然更靠近那個 2，也不是它所屬的字（L12 第 8 題的 tCO₂e 在各選項上下對齊）
    chars = [_ch('x', 100.5, 300), _ch('C', 100, 320), _ch('2', 106.6, 324.3, size=8.0)]
    assert text_lines(chars) == ['x', 'C₂']


def test_a_subscript_right_after_the_first_character_of_a_line():
    assert text_lines([_ch('O', 100, 320), _ch('2', 106.6, 324.3, size=8.0), _ch('濃', 111, 320)]) == ['O₂濃']


def test_every_digit_can_be_a_subscript():
    chars = [_ch('C', 100, 320), _ch('O', 106.6, 320), _ch('1', 113.2, 324.3, size=8.0),
             _ch('0', 117.6, 324.3, size=8.0), _ch('e', 122.0, 320)]
    assert text_lines(chars) == ['CO₁₀e']


def test_a_small_space_is_not_mistaken_for_a_stray_character():
    chars = [_ch('C', 100, 320), _ch('O', 106.6, 320), _ch('2', 113.2, 324.3, size=8.0),
             _ch(' ', 117.6, 324.3, size=8.0), _ch('e', 120.0, 320)]
    assert text_lines(chars) == ['CO₂ e']  # 下標格式的空白照樣是空白，不是「比本文小的字」


def test_a_trailing_space_character_is_kept_as_the_line_break_signal():
    line = [_ch('句', 100, 320), _ch('。', 112, 320), _ch(' ', 124, 320)]
    assert text_lines(line + [_ch('下', 100, 340)]) == ['句。 ', '下']


def test_spaces_inside_a_line_collapse_to_one():
    chars = [_ch('A', 100, 320), _ch(' ', 106.6, 320), _ch(' ', 113.2, 320), _ch('B', 119.8, 320)]
    assert text_lines(chars) == ['A B']


def test_a_run_of_both_blank_characters_becomes_one_space():
    # 真正的空白只有兩個：U+0020 與全形空白 U+3000。其他 Python 視為空白的字元（不斷行空白、控制字元）
    # 在 _check_chars 就以特殊字元擋下，走不到這裡（見 test_a_glyph_mapped_to_an_odd_code_point_...）
    chars = [_ch('A', 100, 320), _ch(chr(0x3000), 106.6, 320), _ch(' ', 118.6, 320), _ch('B', 125.2, 320)]
    assert text_lines(chars) == ['A B']


def test_a_line_does_not_start_with_a_space():
    assert text_lines([_ch(' ', 100, 320), _ch('A', 106.6, 320)]) == ['A']


def test_a_row_without_text_has_no_lines():
    # 空白列：沒有字，或只有空白字元（找下標時沒有本文字級可比，不能因此出錯）
    assert text_lines([]) == []
    assert text_lines([_ch(' ', 100, 320), _ch(chr(0x3000), 110, 320)]) == []


@pytest.mark.parametrize(('gap', 'text'), [(0.3, 'AB'), (1.2, 'AB'), (1.8, 'A B'), (3.0, 'A B')],
                         ids=['same-word', 'just-under-the-threshold', 'just-over-the-threshold', 'cjk-latin-spacing'])
def test_the_gap_threshold_splits_the_two_spacings_word_uses(gap, text):
    # PDF 的字距只有兩群：≤0.3pt（同一個詞）與約 3pt（Word 的中英間距），門檻 1.5pt 在中間
    a = _ch('A', 100, 320)
    assert text_lines([a, _ch('B', a['x1'] + gap, 320)]) == [text]


@pytest.mark.parametrize(('chars', 'text'), [
    ([_ch('A', 100, 320), _ch('B', 115.1, 320)], 'A B'),                                        # 空隙 8.5pt
    ([_ch('A', 100, 320), _ch(' ', 106.6, 320), _ch(' ', 113.2, 320), _ch('B', 119.8, 320)], 'A B'),  # 兩個空白
    ([_ch('A', 100, 320), _ch(chr(0x3000), 106.6, 320), _ch('B', 118.6, 320)], 'A B'),        # 全形空白 12pt 寬
    ([_ch(' ', 100, 320), _ch('A', 130, 320)], 'A'),                                            # 行首的空白不算
    ([_ch('A', 100, 320), _ch(' ', 130, 320)], 'A '),                                           # 行尾的空白不算
    ([_ch('A', 100, 320), _ch('B', 106.6, 340)], 'A\nB'),                                      # 不同行的字不比
    ([_ch('中', 100, 320), {**_ch('.', 101, 320), 'x1': 102}, _ch('B', 113.5, 320)], '中. B'),  # 字框重疊：空隙從 112 算
], ids=['gap-8.5pt', 'two-blanks', 'ideographic-space', 'leading-blank', 'trailing-blank', 'next-line',
        'overlapping-boxes'])
def test_ordinary_spacing_is_not_mistaken_for_a_table(chars, text):
    # 4 份初級卷：相鄰兩個字的空隙最多 3.2pt、兩個字之間最多夾 1 個空白；中級卷有多打一個空白的（2 個）
    assert '\n'.join(text_lines(chars)) == text


TAB_STOP = [_ch('A', 100, 320), _ch('B', 116.1, 320)]
THREE_BLANKS = [_ch('A', 100, 320), *(_ch(' ', 106.6 + 6.6 * i, 320) for i in range(3)), _ch('B', 126.4, 320)]


@pytest.mark.parametrize(('chars', 'message'), [
    (TAB_STOP, '「A」與「B」之間有 9.5pt 的空隙'),                                                    # 定位點
    ([_ch('A', 100, 320), _ch(' ', 106.6, 320), _ch('B', 123.2, 320)], '「A」與「B」之間有 10.0pt 的空隙'),  # 空白後再跳
    (THREE_BLANKS, '「A」與「B」之間連續 3 個空白'),
    ([_ch('排', 100, 320), _ch('源', 112, 320), _ch('1', 150, 322), _ch('2', 156.6, 322)], '「源」與「1」之間有 26.0pt'),
    (TAB_STOP[::-1], '「A」與「B」之間有 9.5pt 的空隙'),       # PDF 裡的畫字順序不一定是由左到右
    (THREE_BLANKS[::-1], '「A」與「B」之間連續 3 個空白'),
], ids=['tab-stop', 'blank-then-tab', 'three-blanks', 'second-column', 'tab-stop-drawn-right-to-left',
        'three-blanks-drawn-right-to-left'])
def test_text_laid_out_with_tabs_or_runs_of_blanks_stops_the_extraction(chars, message):
    # 無框線、用定位點或空白排的表格：擷取時會被攤平成一行（「排放量固定燃燒 120」）
    with pytest.raises(ValueError, match=message):
        text_lines(chars)


@pytest.mark.parametrize(('rgb', 'alpha', 'contrast'), [
    ((0, 0, 0), 1, 21.0), ((1, 1, 1), 1, 1.0), ((1, 0, 0), 1, 3.9985), ((0, 0, 1), 1, 8.5925),
    ((0.5, 0.5, 0.5), 1, 3.9767), ((0.58, 0.58, 0.58), 1, 3.0373), ((0.59, 0.59, 0.59), 1, 2.9412),
    ((1, 1, 0.89), 1, 1.0162), ((0.95, 0.95, 0.8), 1, 1.1421), ((0.9, 0.9, 0.9), 1, 1.2539),
    ((0, 0, 0), 0.5, 3.9767), ((0, 0, 0), 0.45, 3.3517), ((0, 0, 0), 0.3, 2.1085), ((0, 0, 0), 0, 1.0),
], ids=['black', 'white', 'red', 'blue', 'grey-0.5', 'grey-0.58', 'grey-0.59', 'yellowish-white', 'pale-yellow',
        'grey-0.9', 'black-half-opaque', 'black-45-percent', 'black-30-percent', 'black-transparent'])
def test_contrast_is_measured_against_white_paper(rgb, alpha, contrast):
    # WCAG 2 的對比：顏色連同不透明度疊在白紙上。以前逐個色版看 ≥ 0.9，(1, 1, 0.89) 的字算看得見（審查實測：
    # 對比 1.02:1），不透明度只要大於 0.1 也算
    assert _contrast(rgb, alpha) == pytest.approx(contrast, abs=1e-4)


def test_the_real_colours_are_well_above_the_contrast_floor():
    # 8 份真實卷的字只有黑（21:1）與紅（4.0:1），門檻 3:1（WCAG 對大字的最低要求）；灰 0.58 剛好過、0.59 不過
    assert MIN_CONTRAST == 3
    assert _contrast((1, 0, 0)) >= MIN_CONTRAST > _contrast((0.59, 0.59, 0.59))


def test_characters_whose_tops_differ_by_less_than_3pt_share_a_line():
    assert text_lines([_ch('A', 100, 320), _ch('B', 106.6, 322.5), _ch('下', 100, 340)]) == ['AB', '下']


@pytest.mark.parametrize('chars', [
    [_ch('量', 100, 320), _ch('2', 112, 316), _ch('噸', 118.6, 320)],                    # 同字級的 2 提高 4pt
    [_ch('量', 100, 320), _ch('2', 112, 324), _ch('噸', 118.6, 320)],                    # 降低 4pt
    [_ch('約', 100, 320), _ch('1', 112, 316.5), _ch('/', 118.6, 320), _ch('2', 125.2, 323.5), _ch('倍', 131.8, 320)],
    [_ch('排', 100, 320), _ch('源', 112, 320), _ch('排', 132, 324), _ch('量', 144, 324)],  # 兩欄的基線錯開 4pt
    [_ch('大', 100, 316, size=16.0), _ch('字', 116, 320), _ch('下', 100, 340)],           # 大一號的字，基線相同
    [_ch('上', 100, 320), _ch('下', 100, 331.5)],                                          # 只重疊 0.5pt 也算
    [_ch('上', 100, 320), _ch('下', 100, 331), _ch('字', 112, 333.4)],                      # 下一行最高的字碰到
    [_ch('上', 100, 320), _ch('字', 112, 321.5), _ch('下', 100, 333)],                      # 上一行最低的字被碰到
], ids=['raised-4pt', 'lowered-4pt', 'fraction-7pt-apart', 'two-columns-4pt-apart', 'larger-character',
        'overlapping-by-half-a-point', 'uneven-lower-line', 'uneven-upper-line'])
def test_one_visual_line_split_into_two_stops_the_extraction(chars):
    # 基線錯開超過 3pt（Y_TOLERANCE）的字會被分到另一行：搬到題幹最前面（「2 排放量為 噸？」）、最後面，
    # 或把兩欄攤平。分行之後相鄰兩行的垂直範圍重疊就報錯：8 份真實卷兩行之間至少隔 6.6pt
    with pytest.raises(ValueError, match='分成了上下兩行'):
        text_lines(chars, '第 1 頁第 2 列')


def test_a_split_line_is_reported_with_both_parts():
    with pytest.raises(ValueError, match='「2」與「量噸」（top=320\\.0）的垂直範圍重疊 8\\.0pt'):
        text_lines([_ch('量', 100, 320), _ch('2', 112, 316), _ch('噸', 118.6, 320)])


def test_lines_that_just_touch_are_separate_lines():
    # 行距等於字級：上一行的下緣正好是下一行的上緣，不算重疊
    assert text_lines([_ch('上', 100, 320), _ch('下', 100, 332)]) == ['上', '下']


def test_a_line_split_by_a_raised_digit_is_reported_with_the_page_and_row(tmp_path):
    raised = [('排放量為 ', 'china-t', 12, 0), ('2', 'helv', 12, -4), (' 噸？ ', 'china-t', 12, 0)]
    rows = [('header',), ('C', '1.', [raised, *_options()])]
    with pytest.raises(ValueError, match=r'^第 1 頁第 2 列（題號 1\.）同一行的字分成了上下兩行'):
        extract(_exam(tmp_path, [rows, [('header',)]]))


@pytest.mark.parametrize(('size', 'text'), [(9.0, 'CO₂'), (10.0, 'CO2')], ids=['three-quarters', 'five-sixths'])
def test_only_digits_under_eighty_percent_of_the_body_size_are_subscripts(size, text):
    # 字級不到本文的八成才算下標（真實 PDF：本文 12pt，下標 8.04pt）
    chars = [_ch('C', 100, 320), _ch('O', 106.6, 320), _ch('2', 113.2, 332.1 - size, size=size)]
    assert text_lines(chars) == [text]


def test_a_subscript_may_be_well_under_the_body_size():
    # Word 的下標是本文的三分之二左右；不到一半才當成看不見的字（見 half-a-point）
    assert text_lines([_ch('C', 100, 320), _ch('2', 106.6, 325, size=7.0)]) == ['C₂']


def test_a_subscript_may_sit_slightly_above_the_baseline():
    # 基線最多可以比所屬的字高 0.5pt（真實的下標是低 0.1pt）；高 1pt 就當成上標，見下面的 baseline-1pt-high
    assert text_lines([_ch('C', 100, 320), _ch('2', 106.6, 323.7, size=8.0)]) == ['C₂']


def test_the_body_size_is_the_most_common_one_not_the_largest():
    chars = [_ch('大', 100, 316, size=16.0), _ch('C', 116, 320), _ch('O', 122.6, 320), _ch('e', 129.2, 320)]
    assert inline_subscripts(chars) == chars


def test_inlining_leaves_normal_size_characters_alone():
    chars = [_ch('C', 100, 320), _ch('O', 106.6, 320), _ch('2', 113.2, 320)]
    assert inline_subscripts(chars) == chars


@pytest.mark.parametrize(('chars', 'message'), [
    ([_ch('C', 100, 320), _ch('x', 106.6, 324.3, size=8.0)], '不是單一個數字'),
    ([_ch('C', 100, 320), _ch('12', 106.6, 324.3, size=8.0)], '不是單一個數字'),
    ([_ch('2', 90, 324.3, size=8.0), _ch('C', 100, 320)], '找不到'),
    ([_ch('C', 100, 320), _ch('2', 106.6, 312.0, size=8.0)], '找不到'),
    ([_ch('m', 100, 320), _ch('3', 106.6, 321.5, size=8.0)], '找不到'),
    ([_ch('C', 100, 320), _ch('2', 106.6, 323.0, size=8.0)], '找不到'),
    # 下標是本文的三分之二（真實卷 8.04pt 對 12pt）；不到一半的數字看不見，不是下標（0.5pt 的「7」）
    ([_ch('C', 100, 320), _ch('2', 106.6, 331.5, size=0.5)], '太小'),
    ([_ch('C', 100, 320), _ch('2', 106.6, 326.1, size=5.9)], '太小'),
], ids=['small-letter', 'two-digits-in-one-glyph', 'nothing-to-the-left', 'raised-above-the-line',
        'superscript-baseline-too-high', 'baseline-1pt-high', 'half-a-point', 'just-under-half-the-body-size'])
def test_small_characters_that_are_not_subscript_digits_stop_the_extraction(chars, message):
    with pytest.raises(ValueError, match=message):
        inline_subscripts(chars)


# ── 特殊碼位：網頁上會顯示錯，或看起來一樣其實是別的字 ─────────────────────────────

@pytest.mark.parametrize('code_point', [
    0x200B, 0x00AD, 0xFEFF, 0x0007,  # 零寬空白、軟連字號、BOM、控制字元
    0x0009, 0x000B, 0x001C, 0x001F, 0x0085,  # Python 當成空白的控制字元：以前被當成空格
    0x00A0, 0x2003, 0x202F, 0x2028,  # U+0020、U+3000 以外的空白：不斷行空白、em 空白、窄不斷行空白、分行符
    0xE000, 0xF09E, 0xF0000,         # 私用區（M1_S1 第 46 題的 U+F09E 是 Wingdings 的符號）
    0xD800, 0x0378,                  # 代理對、未指派
    0x2E80, 0x2F00, 0x2FD5,          # CJK 部首補充、康熙部首（M1_S2 第 30 題的 U+2F00 長得像「一」）
    0xF900, 0xFA6D,                  # CJK 相容字
    0xFB00, 0xFB01, 0xFB4F,          # 拉丁連字等字母表現形式（含起點 U+FB00 ff）
    0xFFFD,                          # 取代字元
], ids=lambda code_point: f'U+{code_point:04X}')
def test_odd_code_points_are_named(code_point):
    assert _odd_character(f'題幹{chr(code_point)}文字').startswith(f'U+{code_point:04X}')


def test_an_unmapped_glyph_is_named():
    assert _odd_character('題幹(cid:129)文字') == '(cid:129)'


@pytest.mark.parametrize('text', [
    'CO₂e 與 m²', '（全形括號）、，。；：？！「」', '100％', '1～3', chr(0x3000), '(c) 與 (12)',
    chr(0x2E5D), chr(0x2FF0), chr(0xFB50), chr(0xFFFC),  # 緊鄰擋掉範圍的一般字元
], ids=['sub-and-superscript', 'fullwidth-punctuation', 'fullwidth-percent', 'fullwidth-tilde', 'ideographic-space',
        'parentheses', 'just-below-the-radicals', 'just-above-the-radicals', 'just-above-the-ligatures',
        'just-below-the-replacement-character'])
def test_ordinary_text_is_left_alone(text):
    # 不做 NFKC：115-01 照原樣保留的 ₂、全形標點、％、～ 都不是特殊字元
    assert _odd_character(text) is None


# ── 整條管線：用 PyMuPDF 畫與官方同結構的 PDF ────────────────────────────────

TOP = 110.0
PAGE_HEADER = ('115 年第一次淨零碳規劃管理師-初級能力鑑定【公告試題】', '第一科：淨零碳規劃管理基礎概論',
               '考試日期：115 年 05 月 16 日')
FIRST_PAGE = ('※相關法規可能修訂，試題參考答案以該次考試公告時之法規內容為準。', '一、單選題')  # 只在首頁
IN_Q1 = (400, 230)  # 第 1 題題目欄裡的空白處（選項行的右邊）
# Word 的頁面框線：表格外 12 條白色虛線（`m l S`），座標照 115-01 L11 第 1 頁（每一頁都一樣）
FRAME = ((24.24, 24.0, 24.24, 24.48), (24.24, 24.0, 24.24, 24.48), (24.48, 24.24, 570.96, 24.24),
         (571.2, 24.0, 571.2, 24.48), (571.2, 24.0, 571.2, 24.48), (24.24, 24.48, 24.24, 817.54),
         (571.2, 24.48, 571.2, 817.54), (24.0, 817.78, 24.48, 817.78), (24.0, 817.78, 24.48, 817.78),
         (24.48, 817.78, 570.96, 817.78), (570.96, 817.78, 571.44, 817.78), (570.96, 817.78, 571.44, 817.78))


def _pixmap(value):
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 8, 8), False)
    pix.clear_with(value)
    return pix


WATERMARK = pymupdf.Rect(102, 362, 493, 526)  # 真實卷的浮水印在 102.5, 362.5–492.8, 526.2
HEADER_GREY = (0.851, 0.851, 0.851)


def _watermark():
    """淺灰、帶透明度（SMask）的圖，與真實卷的浮水印一樣。"""
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 8, 8), True)
    pix.clear_with(200)
    pix.set_alpha(bytes([60]) * 64)
    return pix


def _insert_watermark(page):
    """畫浮水印（_watermark()），寫法照 Word 的（_word_image_of）。"""
    _word_image_of(page, _watermark(), WATERMARK)


def _word_image_of(page, pix, rect):
    """帶透明度的 pix 畫在 rect，寫法改成 Word 的：/DeviceRGB、FlateDecode，遮罩也是 FlateDecode、帶 /Matte [0 0 0]
    （顏色先乘上透明度才存；PyMuPDF 原本寫 ICCBased、不壓縮、沒有 /Matte）。回傳圖的 xref。"""
    xref = page.insert_image(rect, pixmap=pix)
    doc = page.parent
    mask = int(doc.xref_get_key(xref, 'SMask')[1].split()[0])
    doc.xref_set_key(xref, 'ColorSpace', '/DeviceRGB')
    doc.xref_set_key(mask, 'Matte', '[0 0 0]')
    for image in (xref, mask):
        doc.xref_set_key(image, 'DecodeParms', 'null')
    colours = bytes(value for i, value in enumerate(pix.samples) if i % 4 != 3)  # Pixmap 的顏色本來就預乘過
    doc.update_stream(xref, colours)
    doc.update_stream(mask, doc.xref_stream(mask))  # 重寫一次就壓縮成 FlateDecode
    return xref


def _fill(page, x0, y0, x1, y1, color=(0, 0, 0)):
    """Word 的填色矩形：內容串流是 `x y w h re f`（沒有 h），pdfminer 認成 rect。"""
    shape = page.new_shape()
    shape.draw_rect(pymupdf.Rect(x0, y0, x1, y1))
    shape.finish(color=None, fill=color, closePath=False)
    shape.commit()


def _raw(page, operators: bytes, first=False):
    """直接在頁面內容串流加 PDF 運算子：PyMuPDF 的 API 畫不出來的字（未定義的字碼、自訂色彩空間、剪裁）。
    預設加在最後（畫在所有東西上面），first 則另起一個內容串流放在最前面（畫在所有東西下面）。"""
    doc = page.parent
    if first:
        xref = doc.get_new_xref()
        doc.update_object(xref, '<<>>')
        doc.update_stream(xref, b'q\n' + operators + b'\nQ\n', new=True)
        contents = ' '.join(f'{x} 0 R' for x in (xref, *page.get_contents()))
        doc.xref_set_key(page.xref, 'Contents', f'[{contents}]')
        return
    xref = page.get_contents()[-1]
    doc.update_stream(xref, doc.xref_stream(xref) + b'\n' + operators + b'\n')


def _shading(rect, grey=1, first=False, bounded=True):
    """在 rect 畫一塊單色的漸層（`sh`，不是路徑也不是圖片），範圍由剪裁路徑決定。first：畫在頁面內容的最前面
    （字的下面）。bounded：漸層帶 /BBox（MuPDF 才算得出它的範圍；沒有 /BBox 的軸向漸層範圍是無限大）。"""
    def draw(page):
        doc = page.parent
        kind, resources = doc.xref_get_key(page.xref, 'Resources')
        assert kind == 'xref'
        shading = doc.get_new_xref()
        x0, y0, x1, y1 = rect
        box = f'/BBox[{x0} {842 - y1} {x1} {842 - y0}]' if bounded else ''
        doc.update_object(shading, f'<</ShadingType 2/ColorSpace/DeviceGray/Coords[{x0} 0 {x1} 0]{box}'
                                   f'/Function<</FunctionType 2/Domain[0 1]/C0[{grey}]/C1[{grey}]/N 1>>>>')
        doc.xref_set_key(int(resources.split()[0]), 'Shading/Sh0', f'{shading} 0 R')
        _raw(page, f'q {x0} {842 - y1} {x1 - x0} {y1 - y0} re W n /Sh0 sh Q'.encode(), first=first)
    return draw


def _stencil(rect, grey=1):
    """在 rect 畫一張全不透明的圖片遮罩（`/ImageMask true`，用填色 grey 塗滿），畫在所有東西上面。"""
    def draw(page):
        doc = page.parent
        kind, resources = doc.xref_get_key(page.xref, 'Resources')
        assert kind == 'xref'
        mask = doc.get_new_xref()
        doc.update_object(mask, '<</Type/XObject/Subtype/Image/Width 8/Height 8/ImageMask true/BitsPerComponent 1'
                                '/Decode[1 0]>>')
        doc.update_stream(mask, bytes(8), new=True)
        doc.xref_set_key(int(resources.split()[0]), 'XObject/Stencil0', f'{mask} 0 R')
        x0, y0, x1, y1 = rect
        _raw(page, f'q {grey} g {x1 - x0} 0 0 {y1 - y0} {x0} {842 - y1} cm /Stencil0 Do Q'.encode())
    return draw


def _line(text):
    return [(text, 'china-t', 12, 0)]


def _options():
    return [_line('(A)甲； '), _line('(B)乙； '), _line('(C)丙； '), _line('(D)丁')]


def _draw_page(doc, rows, *, page_no, pages, watermark=True, header=PAGE_HEADER, first_page=FIRST_PAGE, outside=(),
               extras=(), footer='第 {n} 頁，共 {m} 頁'):
    """rows 的每一列：('header',)、('merged', [各行])（整列只有一格）、(答案, 題號, [各行])，
    或 ('narrow', 答案, 題號, [各行])（右緣在 500，比別列窄）。每行是 [(字串, 字型, 字級, 基線下移), ...]，
    其中的數字是定位點：往右跳過這麼多 pt，中間不畫任何字。rows 是空的就不畫表格。
    頁首畫在表格上方（首頁再加 first_page），outside 畫在表格下方。
    watermark：True 是真實卷的畫法（最先畫、在字的下面），'over' 最後才畫（蓋在字上），False 不畫。"""
    page = doc.new_page(width=595, height=842)
    if watermark is True:
        _insert_watermark(page)
    for i, text in enumerate(tuple(header) + (tuple(first_page) if page_no == 1 else ())):
        page.insert_text((60, 30 + 16 * i), text, fontname='china-t', fontsize=12)
    for i, text in enumerate(outside):
        page.insert_text((60, 780 - 16 * i), text, fontname='china-t', fontsize=12)
    page.insert_text((250, 820), footer.format(n=page_no, m=pages), fontname='china-t', fontsize=10)
    y = TOP
    for row in rows:
        kind = row[0] if row[0] in ('header', 'merged', 'narrow') else 'question'
        lines = [] if kind == 'header' else row[-1]
        height = 24 if kind == 'header' else 20 * (len(lines) + 1)
        _fill(page, 39, y - 0.25, 556, y + 0.25)  # Word 的表格線是填色的細矩形，不是描線
        dividers = {'header': (39, 88, 94, 551, 556), 'merged': (39, 556), 'narrow': (39, 88, 500),
                    'question': (39, 88, 556)}[kind]
        for x in dividers:
            _fill(page, x - 0.25, y, x + 0.25, y + height)
        # 儲存格的字後面都跟著空白字元，與真實卷一樣（「答案 」「C 」「1.  」「題目 」）
        if kind == 'header':
            # 真實 PDF 的表頭灰底會多蓋到下一列 0.4pt，答案格裡另有一塊內縮的灰底；表頭的字填色加描邊（粗體）
            for box in ((39.25, y, 87.75, y + height + 0.4), (44.4, y, 82.6, y + 19.92),
                        (88.7, y, 556.2, y + height + 0.4)):
                _fill(page, *box, color=HEADER_GREY)
            page.insert_text((52, y + 17), '答案 ', fontname='china-t', fontsize=12, render_mode=2)
            page.insert_text((310, y + 17), '題目 ', fontname='china-t', fontsize=12, render_mode=2)
        elif kind != 'merged':
            answer, number = row[-3], row[-2]
            if answer:
                page.insert_text((59, y + 30), f'{answer} ', fontname='helv', fontsize=12)
            if number:
                page.insert_text((97, y + 26), f'{number}  ', fontname='helv', fontsize=12)
        for i, segments in enumerate(lines):
            x = 122.0
            for segment in segments:
                if isinstance(segment, (int, float)):
                    x += segment
                    continue
                text, font, size, drop = segment
                page.insert_text((x, y + 20 + 20 * i + drop), text, fontname=font, fontsize=size)
                x += pymupdf.get_text_length(text, fontname=font, fontsize=size)
        y += height
    if rows:
        _fill(page, 39, y - 0.25, 556, y + 0.25)
    if watermark == 'over':
        _insert_watermark(page)
    for x0, y0, x1, y1 in FRAME:
        page.draw_line((x0, y0), (x1, y1), color=(1, 1, 1), width=0.48, dashes='[0.48 0.48] 0')
    for extra in extras:
        extra(page)


def _exam(tmp_path, pages, page_options=None):
    """page_options：{頁碼: _draw_page 的選項}。"""
    doc = pymupdf.open()
    for number, rows in enumerate(pages, start=1):
        _draw_page(doc, rows, page_no=number, pages=len(pages), **(page_options or {}).get(number, {}))
    path = tmp_path / 'exam.pdf'
    doc.save(path)
    return path


def _tco2e(key, amount):
    """「(A)0.5tCO₂e；」：下標的 2 字級較小、基線略低（L12 第 8 題）。"""
    return [(f'({key}){amount}tCO', 'helv', 12, 0), ('2', 'helv', 8, 1.0), ('e', 'helv', 12, 0), ('； ', 'china-t', 12, 0)]


# 與官方同結構的兩頁卷。內容用的是真實卷裡碰過的寫法：題幹的硬換行、選項在儲存格裡折行（(A) 以外的也會，
# 也會折在中英交界）、儲存格第二行以後的下標、選項中間的「；」、「；」前的空白、題幹裡的半形括號、句中跨頁的續列、
# 相鄰的相同字（「常常」、窄字「ll」、數字「11」）。第 3 題在第 1 頁中間；第 1 頁的表格延伸到頁面下半
# （第 654pt，真實卷到 790pt 附近）。
PAGE1 = [('header',),
         ('C', '1.', [_line('某企業的排放大多來自投資組合之被投資公司。 '), _line('依據 SBTi 指引，應優先強化何者？ '),
                      _line('(A)太陽光電、風力、地熱、'), _line('水力、生質能等 5 種； '), *_options()[1:]]),
         ('A', '2.', [_line('依 ISO 14064-1 (2018) 計算，排放量為多少？ '), _tco2e('A', '0.5'), _tco2e('B', '1.5'),
                      _line('(C)（1）屬於類別 4；（2）屬於類別 3； '), _line('(D)丁')]),
         ('D', '3.', [_line('關於 GRI、SASB 與 CDP 這三個揭露框架，常常被一起比較， '), _line('下列何者不正確？ '),
                      _line('(A)CDP 著重氣候與環境數據揭露； '),
                      _line('(B)GRI 提供利害關係人導向框架，強調透明度與完整資'), _line('訊揭露； '),
                      _line('(C)SASB 以投資人為主要對象； '),
                      _line('(D)應優先採用 GRI 並可取代 SASB 與 TCFD'), _line('以簡化報告 ')]),
         ('A', '4.', [_line('溫室氣體盤查的組織邊界分別屬於 '), _line('ISO 14064-1 的哪一種方法，')])]
PAGE2 = [('header',),
         ('', '', [[('下列何者', 'china-t', 12, 0), ('正確', 'china-t', 12, 0), ('？ ', 'china-t', 12, 0)], *_options()]),
         ('B', '5.', [_line('報告書應包含：一、基本資料 '), _line('二、邊界設定 '), _line('若要更完整，應補充何者？ '),
                      _line('(A)強制揭露 Scope 1 ； '),
                      [('(B)', 'china-t', 12, 0), ('Carbon Pull 2011', 'helv', 12, 0), ('； ', 'china-t', 12, 0)],
                      *_options()[2:]])]


def _options_of(*texts):
    return [{'key': key, 'text': text} for key, text in zip('ABCD', texts, strict=True)]


EXPECTED = [
    {'number': 1, 'page': 1, 'column': None, 'answer': 'C',
     'stem': '某企業的排放大多來自投資組合之被投資公司。依據 SBTi 指引，應優先強化何者？',
     'options': _options_of('太陽光電、風力、地熱、水力、生質能等 5 種', '乙', '丙', '丁')},
    {'number': 2, 'page': 1, 'column': None, 'answer': 'A',
     'stem': '依 ISO 14064-1 (2018) 計算，排放量為多少？',
     'options': _options_of('0.5tCO₂e', '1.5tCO₂e', '（1）屬於類別 4；（2）屬於類別 3', '丁')},
    {'number': 3, 'page': 1, 'column': None, 'answer': 'D',  # (B)、(D) 折行，(D) 折在中英交界
     'stem': '關於 GRI、SASB 與 CDP 這三個揭露框架，常常被一起比較，下列何者不正確？',
     'options': _options_of('CDP 著重氣候與環境數據揭露', 'GRI 提供利害關係人導向框架，強調透明度與完整資訊揭露',
                            'SASB 以投資人為主要對象', '應優先採用 GRI 並可取代 SASB 與 TCFD 以簡化報告')},
    {'number': 4, 'page': 1, 'column': None, 'answer': 'A',  # 句中跨頁
     'stem': '溫室氣體盤查的組織邊界分別屬於 ISO 14064-1 的哪一種方法，下列何者正確？',
     'options': _options_of('甲', '乙', '丙', '丁')},
    {'number': 5, 'page': 2, 'column': None, 'answer': 'B',  # 硬換行的列點
     'stem': '報告書應包含：一、基本資料 二、邊界設定 若要更完整，應補充何者？',
     'options': _options_of('強制揭露 Scope 1', 'Carbon Pull 2011', '丙', '丁')},
]


def _two_page_exam(tmp_path, page2_extra_rows=(), page_options=None):
    return _exam(tmp_path, [PAGE1, [*PAGE2, *page2_extra_rows]], page_options)


def _in_q1(extra):
    return {1: {'extras': [extra]}}


def test_a_whole_pdf_is_extracted_row_by_row(tmp_path):
    assert extract(_two_page_exam(tmp_path)) == EXPECTED


def _insets(row):
    """一列的答案欄與題目欄各往內縮 2pt 的框（與擷取器看的一樣）。"""
    cells = [cell for cell in row.cells if cell is not None]
    top, bottom = min(cell[1] for cell in cells), max(cell[3] for cell in cells)
    return ((cells[0][0] + 2, top + 2, cells[0][2] - 2, bottom - 2),
            (cells[0][2] + 2, top + 2, cells[-1][2] - 2, bottom - 2))


def test_the_synthetic_pdf_is_structured_like_word(tmp_path):
    # 與真實卷同構，只有真實卷才有的東西才測得到（第四輪審查：拿掉儲存格文字的 strip、把題目欄的內縮框算錯，
    # 真實卷會失敗，合成卷卻照過；第五輪：拿掉表頭答案格的豁免、浮水印蓋在字上，也是一樣）：
    # 格線、表頭底色是 rect；描線只有表格外的 12 條頁面框線；表頭 4 格（灰底切出來的）、其他列 2 格；
    # 表頭的答案格裡有兩塊灰底，其他列的答案欄與題目欄裡沒有任何路徑；
    # 浮水印是頁面第一個畫的東西（在所有字的下面），帶透明度（SMask）；儲存格的字後面跟著空白字元
    path = _two_page_exam(tmp_path)
    with pdfplumber.open(path) as pdf, pymupdf.open(path) as doc:
        for page, shown in zip(pdf.pages, doc, strict=True):
            table = page.find_tables()[0]
            assert page.rects and not page.curves
            assert len(page.lines) == 12 and not any(_overlaps(line, table.bbox) for line in page.lines)
            cells = [sum(cell is not None for cell in row.cells) for row in table.rows]
            assert cells == [4] + [2] * (len(table.rows) - 1)
            log = shown.get_bboxlog()
            assert log[0] == ('fill-image', tuple(WATERMARK)) and shown.get_images(full=True)[0][1]  # 有 SMask
            image = shown.get_images(full=True)[0][0]  # 寫法照 Word（_watermark_problem）
            assert [doc.xref_get_key(image, key)[1] for key in ('ColorSpace', 'Filter')] == ['/DeviceRGB',
                                                                                             '/FlateDecode']
            drawn = [([kind for kind, box in log if not kind.endswith('-text') and _intersects(box, answer)],
                      [kind for kind, box in log if kind.endswith('-path') and _intersects(box, question)])
                     for answer, question in map(_insets, table.rows)]
            assert drawn[0][0] == ['fill-path', 'fill-path']  # 表頭答案格的兩塊灰底
            assert [cells for row in drawn[1:] for cells in row] == [[]] * (2 * len(drawn) - 2)
        page = pdf.pages[0]
        header, first = ([cell for cell in row.cells if cell] for row in page.find_tables()[0].rows[:2])

        def text(cell):
            return ''.join(c['text'] for c in page.chars if _inside(c, cell))
        assert (text(header[0]), text(header[2]), text(first[0])) == ('答案 ', '題目 ', 'C ')
        assert text(first[1]).startswith('1.  某企業')
        # 表格延伸到頁面下半：有些列的下緣（y）大過右側頁面框線的 x（571pt），內縮框把下緣錯當右緣時才碰得到框線
        assert max(bottom for _, _, _, bottom in (row.bbox for row in page.find_tables()[0].rows)) > 600


def test_the_page_watermark_is_not_mistaken_for_a_figure(tmp_path):
    path = _two_page_exam(tmp_path)
    with pymupdf.open(path) as doc:
        assert all(len(page.get_images()) == 1 for page in doc)  # 每頁都有浮水印，範圍涵蓋第 2、3、5 題（在字的下面）
    assert extract(path) == EXPECTED


@pytest.mark.parametrize(('options', 'message'), [
    ({1: {'watermark': 'over'}, 2: {'watermark': 'over'}}, r'^第 1 頁的圖片（.*）畫在字「.」（.*）之後'),
    (_in_q1(lambda page: page.insert_image(pymupdf.Rect(122, 144, 300, 158), pixmap=_pixmap(255))),
     r'^第 1 頁的圖片（x=122\.0–300\.0, top=144\.0–158\.0）畫在字「某」（x=122\.0, top=144\.0）之後'),
    (_in_q1(_shading((50, 150, 80, 170))), r'^第 1 頁的漸層（.*）畫在字「C」（x=59\.0, '),
    (_in_q1(_stencil((122, 144, 300, 158))), r'^第 1 頁的圖片遮罩（.*）畫在字「某」（x=122\.0, '),
], ids=['watermark-over-the-text', 'white-image-over-the-stem', 'white-shading-over-the-answer',
        'white-stencil-over-the-stem'])
def test_an_image_drawn_over_text_stops_the_extraction(tmp_path, options, message):
    # 真實卷的浮水印是頁面第一個畫的東西，在所有字的下面；最後才畫的圖（浮水印也一樣）會把先畫的字蓋掉，
    # pdfminer 照樣抽得出那些字（以前合成卷的浮水印就是這樣蓋住第 2 題的 (C)(D) 與大半個第 3 題）
    with pytest.raises(ValueError, match=message):
        extract(_two_page_exam(tmp_path, page_options=options))


def test_an_image_over_nothing_but_a_space_is_only_a_figure(tmp_path):
    # 空白字元沒有墨：圖蓋在第 1 題第一行行尾的空白上，不算把字蓋住，照一般的圖報
    end = 122 + pymupdf.get_text_length('某企業的排放大多來自投資組合之被投資公司。', fontname='china-t', fontsize=12)
    image = _in_q1(lambda page: page.insert_image(pymupdf.Rect(end + 0.5, 144, end + 40, 158), pixmap=_pixmap(90)))
    with pytest.raises(ValueError, match='^第 1 題的題目欄裡有圖片'):
        extract(_two_page_exam(tmp_path, page_options=image))


@pytest.mark.parametrize('first', [False, True], ids=['over-the-text', 'under-the-text'])
def test_a_shading_without_bounds_stops_the_extraction(tmp_path, first):
    # 沒有 /BBox 的軸向漸層，範圍只由剪裁路徑決定，MuPDF 給的外框是無限大：看不出蓋住了什麼（真實卷沒有任何漸層）
    shading = _shading((50, 150, 80, 170), bounded=False, first=first)
    with pytest.raises(ValueError, match='^第 1 頁有範圍無法判斷的漸層'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(shading)))


def _copy_object(doc, xref):
    """把一個物件另存一份（物件編號不同、內容相同）。串流連資料一起複製；陣列、字典裡參照的物件也各另存一份。"""
    copy = doc.get_new_xref()
    if doc.xref_is_stream(xref):
        doc.update_object(copy, '<<>>')
        doc.xref_copy(xref, copy)
    else:
        doc.update_object(copy, re.sub(r'(\d+) 0 R', lambda ref: f'{_copy_object(doc, int(ref[1]))} 0 R',
                                       doc.xref_object(xref)))
    return copy


def _own_copy_of_the_watermark(key=None, value=None, cyclic=False):
    """把這一頁的浮水印換成它自己的一份：圖片與它的遮罩（/SMask）都另存一份（物件編號都不同），圖片字典的
    鍵順序也不同，內容逐位元相同（有的 PDF 產生器每頁各存一份）。給了 key、value 就再把這一項加進這一份的
    圖片字典，讓它畫出來不一樣；cyclic 讓圖片字典（原本那份與這一份）各有一個參照回自己的鍵。"""
    def draw(page):
        doc = page.parent
        xref, name = page.get_images()[0][0], page.get_images()[0][7]
        if cyclic:
            doc.xref_set_key(xref, 'Self', f'{xref} 0 R')
        image = _copy_object(doc, xref)
        if cyclic:
            doc.xref_set_key(image, 'Self', f'{image} 0 R')
        kind, mask = doc.xref_get_key(image, 'SMask')
        assert kind == 'xref'  # 遮罩是另一個物件：比對要跟著參照比內容，不能比物件編號
        doc.xref_set_key(image, 'SMask', f'{_copy_object(doc, int(mask.split()[0]))} 0 R')
        source = doc.xref_object(image, compressed=True)
        reordered = re.sub(r'(/Width \d+)(/Height \d+)', r'\2\1', source)  # 同值的鍵（都是 8）換個順序
        assert reordered != source
        doc.update_object(image, reordered)
        if key:
            doc.xref_set_key(image, key, value)
        kind, resources = doc.xref_get_key(page.xref, 'Resources')
        assert kind == 'xref'
        doc.xref_set_key(int(resources.split()[0]), f'XObject/{name}', f'{image} 0 R')
        assert page.get_images()[0][0] == image
    return draw


@pytest.mark.parametrize('cyclic', [False, True], ids=['plain', 'refers-to-itself'])
def test_a_watermark_stored_once_per_page_is_still_a_watermark(tmp_path, cyclic):
    # 浮水印比的是圖的內容：每一頁各存一份一樣的也認得；圖片字典裡有循環參照也一樣（不能無窮遞迴）
    copy = {2: {'extras': [_own_copy_of_the_watermark(cyclic=cyclic)]}}
    assert extract(_two_page_exam(tmp_path, page_options=copy)) == EXPECTED


def test_a_copy_that_draws_differently_is_not_the_watermark(tmp_path):
    # 同樣的位元組，Decode 反過來（負片）：畫出來不一樣，不是浮水印 —— 內容雜湊要涵蓋圖片字典，不只資料
    inverted = _own_copy_of_the_watermark('Decode', '[1 0 1 0 1 0]')
    with pytest.raises(ValueError, match='題目欄裡有圖片'):
        extract(_two_page_exam(tmp_path, page_options={2: {'extras': [inverted]}}))


def test_a_bare_page_number_footer_is_allowed_when_the_last_page_says_so(tmp_path):
    # 115 年第二次的頁碼只印數字，末頁有「《以下空白》」
    bare = {1: {'footer': '{n}'}, 2: {'footer': '{n}', 'outside': ('《以下空白》',)}}
    assert extract(_two_page_exam(tmp_path, page_options=bare)) == EXPECTED


TITLE, SUBJECT, DATE = PAGE_HEADER
NOTICE, SECTION = FIRST_PAGE


@pytest.mark.parametrize('subject', ['第一科：淨零碳規劃管理基礎概論', '第二科：淨零碳盤查規範與程序概要'],
                         ids=['subject-1', 'subject-2'])
def test_both_known_subjects_are_allowed(tmp_path, subject):
    both = {n: {'header': (TITLE, subject, DATE)} for n in (1, 2)}
    assert extract(_two_page_exam(tmp_path, page_options=both)) == EXPECTED


@pytest.mark.parametrize(('options', 'message'), [
    ({1: {'header': (TITLE + '（更正版）', SUBJECT, DATE)}}, '表格外有預期之外的文字'),
    ({1: {'header': (TITLE.replace('【', '第二題答案更正為丙【'), SUBJECT, DATE)}}, '表格外有預期之外的文字'),
    ({1: {'header': (TITLE.replace('初級', '中級'), SUBJECT, DATE)}}, '表格外有預期之外的文字'),
    ({1: {'header': (TITLE.replace('【公告試題】', ''), SUBJECT, DATE)}}, '表格外有預期之外的文字'),
    ({1: {'header': (TITLE.replace('115', '2026'), SUBJECT, DATE)}}, '表格外有預期之外的文字'),
    ({1: {'header': (TITLE, SUBJECT + '第二題答案更正為丙', DATE)}}, '不在已知的科目'),  # 全用中文字的勘誤
    ({1: {'header': (TITLE, SUBJECT + '※第1題答案更正為B', DATE)}}, '不在已知的科目'),
    ({1: {'header': (TITLE, '第一科：節能減碳技術實務', DATE)}}, '不在已知的科目'),
    ({1: {'header': (TITLE, '第三科：淨零碳管理實務', DATE)}}, '不在已知的科目'),
    ({1: {'header': (TITLE, SUBJECT, DATE + '（第 2 題答案更正為 C）')}}, '表格外有預期之外的文字'),
    ({1: {'header': (TITLE, SUBJECT, DATE.replace('05 月', '5 月'))}}, '表格外有預期之外的文字'),
    ({1: {'first_page': (NOTICE + '第 2 題更正為 C', SECTION)}}, '表格外有預期之外的文字'),
    ({1: {'first_page': (NOTICE, '二、複選題')}}, '表格外有預期之外的文字'),
    ({1: {'first_page': (NOTICE, '一、複選題')}}, '表格外有預期之外的文字'),
    ({1: {'first_page': (NOTICE, SECTION + '（第 2 題送分）')}}, '表格外有預期之外的文字'),
    ({1: {'outside': ('※第 2 題答案更正為 (B)。',)}}, '表格外有預期之外的文字'),
    ({2: {'outside': ('《以下空白》第 2 題更正',)}}, '表格外有預期之外的文字'),
    ({1: {'footer': '第 {n} 頁，共 {m} 頁（勘誤見第 2 頁）'}}, '表格外有預期之外的文字'),
], ids=['title-suffix', 'title-infix', 'another-level', 'title-without-the-notice-mark', 'western-year',
        'subject-ideograph-erratum', 'subject-erratum', 'new-subject', 'third-subject', 'date-suffix',
        'one-digit-month', 'notice-suffix', 'another-section', 'multiple-choice-section', 'section-suffix',
        'erratum-line', 'end-mark-suffix', 'footer-suffix'])
def test_text_outside_the_table_must_be_on_the_allowlist(tmp_path, options, message):
    with pytest.raises(ValueError, match=message):
        extract(_two_page_exam(tmp_path, page_options=options))


# ── 頁首：每一頁都有考試名稱、科目、考試日期各一行，而且每一頁都相同 ────────────────────────────
#
# 頁首是這份 PDF 自己說「我是哪一場、哪一科」的地方，匯入時拿它對 SOURCES 登記的場次、考試日期、科目。
# 混進別場、別科的頁面時，那一頁的頁首會不同；少了頁首，就說不出這一頁是哪一場。

def _both_pages(title=TITLE, subject=SUBJECT, date=DATE):
    return {n: {'header': (title, subject, date)} for n in (1, 2)}


def test_the_header_says_which_exam_this_is(tmp_path):
    h = header(_two_page_exam(tmp_path))
    assert (h.title, h.subject, h.session, h.exam_date, h.subject_code) == (
        TITLE, SUBJECT, '115-01', '2026-05-16', 'L11')


@pytest.mark.parametrize(('title', 'session'), [
    (TITLE.replace('第一次', '第二次'), '115-02'),
    (TITLE.replace('第一次', '第十次'), '115-10'),
    (TITLE.replace('第一次', '第十一次'), '115-11'),
    (TITLE.replace('第一次', '第二十次'), '115-20'),
    (TITLE.replace('115', '116'), '116-01'),
], ids=['second', 'tenth', 'eleventh', 'twentieth', 'next-year'])
def test_the_session_is_read_from_the_title(tmp_path, title, session):
    assert header(_two_page_exam(tmp_path, page_options=_both_pages(title=title))).session == session


def test_the_exam_date_is_converted_from_the_roc_calendar(tmp_path):
    exam = _two_page_exam(tmp_path, page_options=_both_pages(date='考試日期：115 年 08 月 15 日'))
    assert header(exam).exam_date == '2026-08-15'


def test_the_second_subject_has_its_own_code(tmp_path):
    exam = _two_page_exam(tmp_path, page_options=_both_pages(subject='第二科：淨零碳盤查規範與程序概要'))
    assert header(exam).subject_code == 'L12'


@pytest.mark.parametrize(('options', 'message'), [
    ({2: {'header': (TITLE, '第二科：淨零碳盤查規範與程序概要', DATE)}}, '^第 2 頁的頁首與第 1 頁不同'),
    ({2: {'header': (TITLE.replace('第一次', '第二次'), SUBJECT, DATE)}}, '^第 2 頁的頁首與第 1 頁不同'),
    ({2: {'header': (TITLE, SUBJECT, DATE.replace('16 日', '17 日'))}}, '^第 2 頁的頁首與第 1 頁不同'),
    ({2: {'header': (SUBJECT, DATE)}}, '^第 2 頁的頁首少了考試名稱'),
    ({1: {'header': (TITLE, DATE)}}, '^第 1 頁的頁首少了科目'),
    ({1: {'header': (TITLE, SUBJECT)}}, '^第 1 頁的頁首少了考試日期'),
    ({1: {'header': (TITLE, SUBJECT, SUBJECT, DATE)}}, '^第 1 頁的頁首有 2 行科目'),
    ({1: {'header': (TITLE, TITLE, SUBJECT, DATE)}}, '^第 1 頁的頁首有 2 行考試名稱'),
    ({1: {'header': (TITLE, SUBJECT, DATE, DATE)}}, '^第 1 頁的頁首有 2 行考試日期'),
    (_both_pages(date='考試日期：115 年 02 月 30 日'), '^第 1 頁：考試日期「115 年 02 月 30 日」不是有效的日期'),
    ({2: {'header': (TITLE, SUBJECT, '考試日期：115 年 02 月 30 日')}}, '^第 2 頁：考試日期「115 年 02 月 30 日」'),
    (_both_pages(title=TITLE.replace('第一次', '第十十次')), '^第 1 頁：考試名稱裡的「十十」不是有效的次序'),
    (_both_pages(title=TITLE.replace('第一次', '第一一次')), '考試名稱裡的「一一」不是有效的次序'),
], ids=['another-subject', 'another-session', 'another-date', 'no-title', 'no-subject', 'no-date',
        'two-subjects', 'two-titles', 'two-dates', 'no-such-date', 'no-such-date-on-page-2', 'bad-ordinal',
        'repeated-digit'])
def test_every_page_carries_one_and_the_same_header(tmp_path, options, message):
    exam = _two_page_exam(tmp_path, page_options=options)
    with pytest.raises(ValueError, match=message):
        extract(exam)
    with pytest.raises(ValueError, match=message):
        header(exam)


@pytest.mark.parametrize('x', [26, 559], ids=['left-margin', 'right-margin'])
def test_text_beside_the_table_is_text_outside_the_table(tmp_path, x):
    # 寫在表格左右兩側頁邊的字（手寫的更正、旁註）也是表格外的字，不在允許清單裡就報錯，不能安靜地丟掉
    note = lambda page: page.insert_text((x, 300), '更', fontname='china-t', fontsize=12)
    with pytest.raises(ValueError, match='表格外有預期之外的文字：「更」'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(note)))


@pytest.mark.parametrize(('options', 'message'), [
    ({1: {'footer': '第 {n} 頁，共 3 頁'}, 2: {'footer': '第 {n} 頁，共 3 頁'}}, '頁面缺漏'),  # 截斷：共 3 頁只剩 2 頁
    ({2: {'footer': '第 1 頁，共 {m} 頁'}}, '頁面缺漏'),
    ({1: {'footer': '{n}'}, 2: {'footer': '3', 'outside': ('《以下空白》',)}}, '頁面缺漏'),
    ({2: {'footer': ''}}, '找到 0 個頁碼'),
    ({2: {'outside': ('7',)}}, '找到 2 個頁碼'),
    ({1: {'footer': '{n}'}, 2: {'footer': '{n}'}}, '看不出 PDF 是否完整'),  # 只印頁碼，末頁又沒有「《以下空白》」
    ({1: {'outside': ('《以下空白》',)}}, '不是最後一頁'),
], ids=['total-too-large', 'page-out-of-order', 'bare-number-out-of-order', 'no-page-number', 'two-page-numbers',
        'no-sign-of-the-last-page', 'end-mark-before-the-end'])
def test_page_numbers_must_account_for_every_page(tmp_path, options, message):
    with pytest.raises(ValueError, match=message):
        extract(_two_page_exam(tmp_path, page_options=options))


@pytest.mark.parametrize(('outside', 'message'), [
    ((), '^第 3 頁是空白頁（沒有表格，只有頁首與頁碼）'),
    (('《以下空白》',), '^第 3 頁沒有表格，只有頁首、頁碼與「《以下空白》」'),
], ids=['blank-page', 'end-mark-alone'])
def test_a_last_page_without_the_table_says_what_is_on_it(tmp_path, outside, message):
    # Word 在表格之後可能多出一頁空白頁，或把「《以下空白》」擠到下一頁：照樣報錯，但要說清楚是哪一種
    options = {3: {'outside': outside}}
    with pytest.raises(ValueError, match=message):
        extract(_exam(tmp_path, [PAGE1, PAGE2, []], options))


def test_a_page_with_two_tables_and_no_text_is_not_called_blank(tmp_path):
    # 空白頁、只有「《以下空白》」的頁的說明只給沒有表格的頁：這一頁有兩張空表格，照表格數報
    def two_empty_tables(page):
        for top in (300, 400):
            for y in (top, top + 40):
                _fill(page, 39, y - 0.25, 556, y + 0.25)
            for x in (39, 88, 556):
                _fill(page, x - 0.25, top, x + 0.25, top + 40)
    options = {3: {'extras': [two_empty_tables]}}
    with pytest.raises(ValueError, match='^第 3 頁有 2 張表'):
        extract(_exam(tmp_path, [PAGE1, PAGE2, []], options))


def _line_chart(page, top=179):
    points = [(150, top + 45), (210, top + 15), (270, top + 30), (330, top)]
    for i in range(len(points) - 1):
        page.draw_line(points[i], points[i + 1], color=(0, 0, 0), width=1.5)


# 第 1 題（第 1 頁第 2 列）與第 3 題（第 1 頁中間那一列，第 414–594pt）裡的圖。第 3 題的圖畫在 x < 416
# （它的上緣往右量過去的左邊）、第 1、2 題的下緣之下，也有一條緊貼它的上緣：題目欄內縮框的每一邊算錯，
# 都會把圖漏掉或算給相鄰的題目。點陣圖放在字旁邊的空白處：蓋在字上的另外報錯（見 test_an_image_drawn_over_text_...）
FIGURES = [
    (1, lambda page: page.insert_image(pymupdf.Rect(300, 180, 470, 226), pixmap=_pixmap(90))),   # 點陣圖
    (1, lambda page: page.insert_image(pymupdf.Rect(500, 250, 552, 270), pixmap=_pixmap(90))),   # 貼著題目欄右緣
    (1, lambda page: page.insert_image(pymupdf.Rect(90, 250, 118, 270), pixmap=_pixmap(90))),    # 在題號那一欄
    (1, lambda page: _fill(page, 150, 230, 170, 250, color=(0.3, 0.3, 0.3))),                  # Word 畫的長條（rect）
    (1, lambda page: _fill(page, 150, 200, 153, 250, color=(0.3, 0.3, 0.3))),                  # 寬 3pt 的細長條
    (1, lambda page: _fill(page, 160, 200, 162, 250, color=(0.3, 0.3, 0.3))),                  # 寬 2pt：比細矩形粗
    (1, lambda page: page.draw_rect(pymupdf.Rect(150, 230, 170, 250), color=None, fill=(0.3, 0.3, 0.3))),  # curve
    (1, lambda page: page.draw_sector((250, 220), (290, 220), 120, color=None, fill=(0.4, 0.4, 0.4))),     # 圓餅圖
    (1, _line_chart),                                                                          # 折線圖（line）
    (1, lambda page: page.draw_line((140, 280), (360, 280), color=(0, 0, 0), width=0.75)),     # 一條水平線
    (3, lambda page: page.insert_image(pymupdf.Rect(200, 498, 300, 526), pixmap=_pixmap(90))),
    (3, lambda page: _fill(page, 150, 520, 170, 560, color=(0.3, 0.3, 0.3))),
    (3, lambda page: page.draw_rect(pymupdf.Rect(150, 520, 170, 560), color=None, fill=(0.3, 0.3, 0.3))),
    (3, lambda page: _line_chart(page, top=500)),
    (3, lambda page: page.draw_line((140, 424), (360, 424), color=(0, 0, 0), width=0.75)),  # 上緣下方 10pt
]


@pytest.mark.parametrize(('number', 'draw'), FIGURES,
                         ids=['raster', 'at-the-right-edge', 'in-the-number-column', 'word-bar', 'thin-bar',
                              'bar-2pt', 'bar-as-curve', 'pie', 'line-chart', 'lone-line', 'q3-raster', 'q3-word-bar',
                              'q3-bar-as-curve', 'q3-line-chart', 'q3-line-near-the-top'])
def test_a_figure_inside_a_question_stops_the_extraction(tmp_path, number, draw):
    # 只報那一題：圖算到相鄰的題目上也是錯
    with pytest.raises(ValueError, match=f'^第 {number} 題的題目欄裡有圖片'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


# 答案欄是這份 PDF 最要緊的一個字。蓋住、塗改、劃掉的答案，pdfminer 照樣抽得出原本的字，閱讀器上卻看不到它
# （或看到它被劃掉）：答案欄裡除了字，畫了任何東西都要停下來，不論粗細（8 份真實卷的 464 個答案欄裡什麼都沒有）。
# 第 1 題的答案「C」印在 (59, 164)，字框 59–67.3 × 154.5–166.5。
@pytest.mark.parametrize(('draw', 'kind'), [
    (lambda page: _fill(page, 50, 150, 80, 170, color=(1, 1, 1)), '填色的圖形'),                  # 白色方塊（rect）
    (lambda page: page.draw_rect(pymupdf.Rect(50, 150, 80, 170), color=None, fill=(1, 1, 1)), '填色的圖形'),  # curve
    (lambda page: page.draw_line((45, 160), (82, 160), color=(0, 0, 0), width=1), '線段'),       # 劃掉
    (lambda page: _fill(page, 56, 159.5, 69, 160.1), '填色的圖形'),                               # 0.6pt 的細矩形劃掉
    (lambda page: _fill(page, 56, 159, 69, 160.5), '填色的圖形'),                                 # 1.5pt
    (lambda page: [_fill(page, 50, 154 + 1.4 * i, 80, 155.4 + 1.4 * i, color=(1, 1, 1)) for i in range(10)],
     '填色的圖形'),                                                                                # 10 條白色細矩形蓋住
    (_shading((50, 150, 80, 170), grey=0, first=True), '漸層'),                                   # 字下面的黑色漸層
    (lambda page: page.insert_image(pymupdf.Rect(45, 200, 80, 220), pixmap=_pixmap(40), overlay=False), '圖片'),
], ids=['white-box', 'white-box-as-curve', 'strike-through', 'thin-bar-0.6pt', 'thin-bar-1.5pt', 'white-strips',
        'black-shading-underneath', 'image-underneath'])
def test_a_drawing_in_the_answer_column_stops_the_extraction(tmp_path, draw, kind):
    with pytest.raises(ValueError, match=rf'^第 1 頁第 2 列（題號 1\.）的答案欄裡有圖形（{kind}）'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


# 題目欄裡穿過文字中段的細矩形與細線（最窄的一邊 ≤ 1.5pt：刪除線、遮住字的白色細條、手畫的破折號）會讓抽出來的
# 字與閱讀器上看到的不同，另外報出位置。第 1 題題幹第一行的基線在 154pt（「某」的字框 144.4–156.4），
# 題號「1.」的基線在 160pt；第二行的基線在 174pt。
@pytest.mark.parametrize('draw', [
    lambda page: _fill(page, 122, 150.2, 300, 150.8),                                         # 0.6pt 的刪除線
    lambda page: _fill(page, 122, 149.8, 300, 151.3),                                         # 1.5pt
    lambda page: page.draw_line((122, 150.5), (300, 150.5), color=(0, 0, 0), width=0.5),      # 描線
    lambda page: [_fill(page, 122, 144 + 1.4 * i, 460, 145.4 + 1.4 * i, color=(1, 1, 1)) for i in range(10)],
    lambda page: _fill(page, 127.7, 144, 128.3, 157),                                         # 直的細條穿過「某」
    lambda page: _fill(page, 390, 150.2, 420, 150.8),                                         # 行尾之後的一橫（像破折號）
    lambda page: _fill(page, 95, 156.2, 108, 156.8),                                          # 題號「1.」被劃掉
    lambda page: _fill(page, 122, 145.9, 300, 146.5),                                         # 中段的上緣（基線以上 65%）
    lambda page: _fill(page, 122, 151.3, 300, 151.9),                                         # 中段的下緣（基線以上 20%）
], ids=['thin-bar-0.6pt', 'thin-bar-1.5pt', 'stroked-line', 'white-strips', 'vertical-bar', 'dash-after-the-line',
        'number', 'upper-part', 'lower-part'])
def test_a_thin_line_through_the_middle_of_the_text_stops_the_extraction(tmp_path, draw):
    with pytest.raises(ValueError, match=r'^第 1 頁第 2 列（題號 1\.）的題目欄裡有穿過文字中段的細線'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


def test_a_strike_through_is_reported_with_its_place(tmp_path):
    strike = _in_q1(lambda page: _fill(page, 122, 150.2, 300, 150.8))
    with pytest.raises(ValueError, match=r'穿過文字中段的細線（x=122\.0–300\.0, top=150\.2–150\.8）'):
        extract(_two_page_exam(tmp_path, page_options=strike))


@pytest.mark.parametrize(('number', 'box'), [
    (1, (122, 155.2, 300, 155.8)), (2, (122, 334.6, 200, 335.2)), (1, (122, 155.2, 134, 155.8)),
    (1, (122, 159.7, 300, 160.3)), (1, (122, 163.3, 300, 163.9)), (1, (150, 219.7, 300, 220.3)),
    (1, (500, 213, 500.6, 224)),
], ids=['underline-just-below-the-baseline', 'underline-under-a-subscript', 'bar-under-one-glyph', 'rule-between-lines',
        'rule-just-above-a-line', 'rule-between-options', 'short-tick-between-lines'])
def test_every_thin_line_in_a_question_is_a_figure(tmp_path, number, box):
    # 不穿過文字中段的細線也是圖，底線也一樣：以前貼在基線下方的細條當成 Word 的底線放行，一條細條就把
    # 「範疇一」變成閱讀器上的「範疇二」（審查在真實卷上實測），細條也疊得出一整張長條圖。8 份真實卷的
    # 464 個題目欄內縮框裡什麼圖形都沒有。題號「1.」的基線比題幹低 6pt、下標的基線比所屬的字低 1pt：
    # 這些細線都不在文字中段，不是刪除線，照圖報
    with pytest.raises(ValueError, match=f'^第 {number} 題的題目欄裡有圖片或圖形'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(lambda page: _fill(page, *box))))


def test_a_shading_inside_a_question_is_a_figure(tmp_path):
    # pdfminer 看不到漸層（sh）：從 PyMuPDF 的 bboxlog 算。畫在字的下面（蓋在字上的另外報錯）
    shading = _shading((300, 180, 470, 226), grey=0.5, first=True)
    with pytest.raises(ValueError, match='^第 1 題的題目欄裡有圖片或圖形'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(shading)))


def test_a_highlight_is_reported_as_a_possible_mark_not_only_a_chart(tmp_path):
    # 螢光筆（文字上的黃色矩形）、儲存格底色也是題目欄裡的向量圖形：照樣報錯，但訊息不能只說是圖表
    highlight = lambda page: _fill(page, 122, TOP + 24 + 7, 300, TOP + 24 + 23, color=(1, 1, 0))
    with pytest.raises(ValueError, match='^第 1 題的題目欄裡有圖片或圖形 —— 可能是圖表.*也可能是螢光筆、儲存格底色'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(highlight)))


@pytest.mark.parametrize(('box', 'numbers'), [
    ((300, 300, 340, 320), '1、5'),                          # 移到另一題
    ((370, 160, 420, 180), '1、4'), ((380, 150, 420, 180), '1、4'),  # 只差一個座標：左緣、上緣
    ((380, 160, 430, 180), '1、4'), ((380, 160, 420, 190), '1、4'),  # 右緣、下緣
], ids=['moved', 'left-edge', 'top-edge', 'right-edge', 'bottom-edge'])
def test_the_same_image_at_a_different_place_on_each_page_is_a_figure(tmp_path, box, numbers):
    # 同一張圖、每頁都有，但第 2 頁的位置或大小不同（第 1 頁在 380, 160, 420, 180）：那不是浮水印
    pix = _pixmap(60)
    moving = {1: {'extras': [lambda page: page.insert_image(pymupdf.Rect(380, 160, 420, 180), pixmap=pix)]},
              2: {'extras': [lambda page: page.insert_image(pymupdf.Rect(*box), pixmap=pix)]}}
    with pytest.raises(ValueError, match=f'^第 {numbers} 題的題目欄裡有圖片'):
        extract(_two_page_exam(tmp_path, page_options=moving))


def test_different_images_at_the_same_place_are_not_a_watermark(tmp_path):
    # 兩頁同一位置各放一張不同的圖：各頁的資源名稱相同（fzImg1），要比的是圖片本身
    def figure(value):
        return lambda page: page.insert_image(pymupdf.Rect(380, 160, 420, 175), pixmap=_pixmap(value))
    pages = {1: {'extras': [figure(60)]}, 2: {'extras': [figure(120)]}}
    with pytest.raises(ValueError, match='^第 1、4 題的題目欄裡有圖片'):  # 第 2 頁那一格是第 4 題的續列
        extract(_two_page_exam(tmp_path, page_options=pages))


def test_a_one_page_pdf_counts_its_watermark_as_a_figure(tmp_path):
    # 只有一頁時看不出哪張圖是浮水印，一律當成內容
    rows = [('header',), ('A', '1.', [_line('第一題？ '), *_options(), _line(''), _line('')]),
            ('B', '2.', [_line('第二題？ '), *_options(), _line(''), _line('')])]
    with pytest.raises(ValueError, match='第 2 題的題目欄裡有圖片'):
        extract(_exam(tmp_path, [rows]))


@pytest.mark.parametrize('box', [(560, 150, 590, 170), (400, 112, 440, 130)], ids=['page-margin', 'header-row'])
def test_an_image_outside_every_question_stops_the_extraction(tmp_path, box):
    # 答案欄裡的圖由答案欄的檢查報（test_a_drawing_in_the_answer_column_stops_the_extraction）
    image = _in_q1(lambda page: page.insert_image(pymupdf.Rect(*box), pixmap=_pixmap(40)))
    with pytest.raises(ValueError, match='不在任何題目欄裡的圖片'):
        extract(_two_page_exam(tmp_path, page_options=image))


def _text(text='ELPM', fontname='helv', **kwargs):
    return lambda page: page.insert_text(IN_Q1, text, fontname=fontname, fontsize=12, **kwargs)


def _transformed(matrix):
    return _text(morph=(pymupdf.Point(*IN_Q1), matrix))


def _colour_space(page, spec):
    """在頁面資源加一個色彩空間 /CS0（PyMuPDF 的 insert_text 只會寫 DeviceRGB）。"""
    doc = page.parent
    kind, resources = doc.xref_get_key(page.xref, 'Resources')
    assert kind == 'xref'
    doc.xref_set_key(int(resources.split()[0]), 'ColorSpace/CS0', spec)


def _coloured_text(spec, value):
    def draw(page):
        _colour_space(page, spec)
        _raw(page, f'q BT /helv 12 Tf /CS0 cs {value} scn {IN_Q1[0]} {842 - IN_Q1[1]} Td (Spot) Tj ET Q'.encode())
    return draw


SPOT = '[/Separation /Spot /DeviceGray <</FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1>>]'  # 色調 0 = 白
TINT = '<</FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 0 0 1] /N 1>>'
WHITE_INK = '[/Separation /White /DeviceCMYK <</FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 0 0 0] /N 1>>]'
NO_INK = '[/Separation /None /DeviceGray <</FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1>>]'


def _operators(operators):
    """在第 1 題題目欄（IN_Q1）用 /helv 直接寫文字運算子：PyMuPDF 的 API 寫不出來的字（Tz、Tr、負字級、剪裁）。"""
    x, y = IN_Q1[0], 842 - IN_Q1[1]
    return _in_q1(lambda page: _raw(page, operators.format(x=x, y=y).encode()))


@pytest.mark.parametrize('draw', [
    _text(rotate=90),
    _text(rotate=180),                                   # 倒置：pdfminer 的 upright 仍是 True
    _transformed(pymupdf.Matrix(-1, 0, 0, 1, 0, 0)),     # 左右鏡像
    _text('樣本', 'china-t', morph=(pymupdf.Point(*IN_Q1), pymupdf.Matrix(30))),  # 斜放 30 度的浮水印字
    _transformed(pymupdf.Matrix(1, 0, 0.3, 1, 0, 0)),    # 水平斜切（假斜體）
    _transformed(pymupdf.Matrix(1, 0.3, 0, 1, 0, 0)),    # 垂直斜切
], ids=['rotated-90', 'upside-down', 'mirrored', 'tilted-30', 'horizontal-shear', 'vertical-shear'])
def test_rotated_mirrored_or_skewed_text_inside_the_table_stops_the_extraction(tmp_path, draw):
    with pytest.raises(ValueError, match='旋轉、鏡像或斜切'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


@pytest.mark.parametrize('draw', [
    _text('隱藏', 'china-t', color=(1, 1, 1)),
    _text('7', color=(1, 1, 1)),                         # 數字也要檢查：白色的「7」會被併進選項
    _text('淡', 'china-t', color=(1, 1, 0.89)),          # 逐個色版看都不到 0.9，對比卻只有 1.02:1（審查實測）
    _text('淡', 'china-t', color=(0.95, 0.95, 0.8)),
    _text('灰', 'china-t', color=(0.59, 0.59, 0.59)),     # 2.94:1，剛好不到 3:1
    _text('透', 'china-t', fill_opacity=0.3),            # 黑字、三成不透明：疊在白紙上是淺灰（2.11:1）
], ids=['white', 'white-digit', 'yellowish-white', 'pale-yellow', 'light-grey', 'black-30-percent-opaque'])
def test_text_too_faint_to_read_inside_the_table_stops_the_extraction(tmp_path, draw):
    # 看得清楚要看顏色連同不透明度疊在白紙上的對比（至少 3:1），pdfminer 不管顏色與透明度，照樣抽得出來
    with pytest.raises(ValueError, match='找不到：沒有真的畫出來（看不清楚'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


@pytest.mark.parametrize('operators', [
    'BT /helv -12 Tf 0 g {x} {y} Td (Negative) Tj ET',   # 負字級：字倒過來、由右往左排，pdfminer 的 upright 仍是 True
    'BT /helv 12 Tf -100 Tz 0 g {x} {y} Td (Mirror) Tj ET',  # 負的水平縮放：左右鏡像
], ids=['negative-font-size', 'negative-horizontal-scaling'])
def test_text_running_backwards_stops_the_extraction(tmp_path, operators):
    # 抽出來是反序的（「乙；evitageN」），閱讀器上是倒著的字
    with pytest.raises(ValueError, match='旋轉、鏡像或斜切'):
        extract(_two_page_exam(tmp_path, page_options=_operators(operators)))


@pytest.mark.parametrize(('operators', 'message'), [
    ('BT /helv 12 Tf 1 Tz 0 g {x} {y} Td (Squashed) Tj ET', r'壓扁的字「S」.*字寬 0\.08pt，不到字級 12pt 的一成'),  # 1%
    ('BT /helv 12 Tf 0 g 0.01 0 0 1 {x} {y} Tm (Squashed) Tj ET', '壓扁'),  # 文字矩陣把字壓成 1% 寬
    ('BT /helv 12 Tf 10 Tz 0 g {x} {y} Td (Squashed) Tj ET', '壓扁'),       # 10%：每個字都在字級的 5.5%–6.7%
], ids=['horizontal-scaling-1-percent', 'text-matrix', 'horizontal-scaling-10-percent'])
def test_squashed_text_stops_the_extraction(tmp_path, operators, message):
    # 字寬不到字級的一成，閱讀器上只剩一條細線（8 份真實卷最窄的字是「.」「,」，字寬是字級的 25%）
    with pytest.raises(ValueError, match=message):
        extract(_two_page_exam(tmp_path, page_options=_operators(operators)))


@pytest.mark.parametrize('draw', [
    _coloured_text('[/Indexed /DeviceRGB 1 <FFFFFF000000>]', 0),  # 調色盤索引：0 號在這裡是白色，照灰階判斷卻是黑色
    _coloured_text(f'[/DeviceN [/Cyan /Black] /DeviceCMYK {TINT}]', '0 1'),  # 黑字，pdfminer 卻給 (0,)，看起來像白字
    _coloured_text(f'[/DeviceN [/Black] /DeviceCMYK {TINT}]', 1),
    # 特別色：pdfminer 不給色料名稱與換算函數，色調高低看不出畫出來是什麼顏色。/White 色調 1 是白色；
    # /None 照規格從不上墨（PDFium 不畫，MuPDF 卻照替代色畫成黑字）
    _coloured_text(SPOT, 0),
    _coloured_text(WHITE_INK, 1),
    _coloured_text(NO_INK, 1),
], ids=['indexed-palette', 'devicen-two-inks', 'devicen-one-ink', 'spot-colour-without-ink', 'white-ink', 'no-ink'])
def test_text_in_a_colour_space_of_its_own_stops_the_extraction(tmp_path, draw):
    # 自訂色彩空間（cs、scn）pdfminer 讀不出真的顏色（調色盤索引、特別色的色調、DeviceN 一律給 (0,)），
    # 運算元數目也看色彩空間：內容串流的檢查就擋掉（真實卷只用 g、rg 設顏色）
    with pytest.raises(ValueError, match='^第 1 頁的內容串流有 Word 不會寫的運算子「cs」'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


def test_a_row_without_a_number_is_named_by_its_page_and_row(tmp_path):
    # 續列沒有題號：訊息只說第幾頁第幾列，不能出現空的「（題號 ）」
    white = lambda page: page.insert_text((400, 190), '隱藏', fontname='china-t', fontsize=12, color=(1, 1, 1))
    with pytest.raises(ValueError, match='^第 2 頁第 2 列的字「隱」'):
        extract(_two_page_exam(tmp_path, page_options={2: {'extras': [white]}}))


def _clipped(clip: bytes):
    """在第 1 題題目欄裡畫一段字，但先設剪裁路徑 clip（`x y w h re W n`）。"""
    return lambda page: _raw(page, b'q ' + clip + f' BT /helv 12 Tf 0 g {IN_Q1[0]} {842 - IN_Q1[1]} Td (Hidden) Tj ET Q'
                             .encode())


@pytest.mark.parametrize('draw', [
    _text('隱形', 'china-t', fill_opacity=0),
    _text('隱形', 'china-t', fill_opacity=0.05),
    _text('7', fill_opacity=0),                               # 數字也要檢查
    _clipped(b'0 0 0 0 re W n'),                              # 剪裁路徑是空的：整個切掉
    _clipped(b'300 700 50 20 re W n'),                        # 剪裁路徑在別處：整個切掉
    # 看得見的同一個字在旁邊 3pt、或正上方一行：都不能拿來當成它
    lambda page: page.insert_text((125, TOP + 24 + 20), '某', fontname='china-t', fontsize=12, fill_opacity=0),
    lambda page: page.insert_text((122, TOP + 24 + 40), '某', fontname='china-t', fontsize=12, fill_opacity=0),
], ids=['transparent', 'nearly-transparent', 'transparent-digit', 'empty-clip', 'clip-elsewhere',
        'next-to-the-same-character', 'below-the-same-character'])
def test_text_that_is_not_really_drawn_stops_the_extraction(tmp_path, draw):
    # pdfminer 不看透明度與剪裁，這些字照樣抽得出來，會被併進題目
    with pytest.raises(ValueError, match='沒有真的畫出來'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


@pytest.mark.parametrize(('draw', 'mode'), [
    (_text('隱形', 'china-t', render_mode=3), 3),
    (_text('隱形', 'china-t', render_mode=7), 7),              # 只當剪裁路徑：texttrace 根本不列
    (_text('7', render_mode=3), 3),
    # 只描邊、描邊是白的：pdfminer 只給填色（黑），看起來像黑字
    (lambda page: _raw(page, f'BT /helv 12 Tf 1 Tr 0 g 1 G {IN_Q1[0]} {842 - IN_Q1[1]} Td (Stroked) Tj ET'.encode()), 1),
    (_text('填', 'china-t', render_mode=4), 4),              # 填色、再拿字形當剪裁路徑：之後畫的東西只剩字形裡的部分
    (_text('填', 'china-t', render_mode=6), 6),
], ids=['render-mode-3', 'clip-only', 'invisible-digit', 'white-outline-only', 'fill-and-clip', 'fill-stroke-and-clip'])
def test_a_text_render_mode_word_does_not_write_stops_the_extraction(tmp_path, draw, mode):
    # Word 只寫 Tr 0（一般的字）與 2（粗體：填色加同色描邊）。隱形、只描邊、拿字形當剪裁路徑的畫法，
    # pdfminer 一律照抽，閱讀器上卻看不到字或剪出別的形狀：內容串流的檢查就擋掉
    with pytest.raises(ValueError, match=f'^第 1 頁的內容串流有文字畫法「{mode} Tr」'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


@pytest.mark.parametrize('clip', [
    b'{x0} {y0} m {x1} {y0} l {x0} {y1} l h {x3} {y3} m {x2} {y3} l {x3} {y2} l h W n',  # 對角的兩個小三角形
    b'{x0} {y0} 1 20 re {x2} {y0} 1 20 re W n',                                      # 左右兩條窄長方形
    b'{x0} {y0} m {x3} {y3} l W n',                                                 # 一條斜線：面積是 0
], ids=['two-corner-triangles', 'two-rectangles', 'single-line'])
def test_a_clip_that_is_not_one_rectangle_stops_the_extraction(tmp_path, clip):
    # 剪裁路徑的外框包住整段字，剪出來的範圍卻幾乎是空的：TEXT_CLIP 只看外框，照樣算畫出來
    x, y = IN_Q1[0], 842 - IN_Q1[1]
    corners = {'x0': x - 1, 'y0': y - 3, 'x1': x, 'y1': y - 2, 'x2': x + 60, 'y2': y + 11, 'x3': x + 61, 'y3': y + 12}
    draw = _clipped(clip.decode().format(**corners).encode())
    with pytest.raises(ValueError, match='^第 1 頁有不是矩形的剪裁路徑'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


def _clip_whole_page(page):
    """整頁包在一個剪裁路徑裡（有的 PDF 產生器會這樣寫）：字都在剪裁範圍內，照常算畫出來。"""
    doc = page.parent
    page.clean_contents()
    xref = page.get_contents()[0]
    doc.update_stream(xref, b'q 0 0 595 842 re W n\n' + doc.xref_stream(xref) + b'\nQ\n')


def test_an_odd_clip_is_reported_with_its_extent(tmp_path):
    x, y = IN_Q1[0], 842 - IN_Q1[1]
    draw = _clipped(f'{x - 1} {y - 3} 1 20 re {x + 60} {y - 3} 1 20 re W n'.encode())
    with pytest.raises(ValueError, match=r'不是矩形的剪裁路徑（範圍 x=399\.0–461\.0, top=213\.0–233\.0）'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


def test_text_inside_a_clip_that_contains_it_is_drawn(tmp_path):
    clipped = {1: {'extras': [_clip_whole_page]}, 2: {'extras': [_clip_whole_page]}}
    assert extract(_two_page_exam(tmp_path, page_options=clipped)) == EXPECTED


def test_a_clip_outside_the_table_must_be_a_rectangle_too(tmp_path):
    # 表格外的字也要真的畫出來（見 test_text_outside_the_table_must_really_be_drawn），而判斷剪裁只看外框：
    # 表格外的剪裁路徑一樣要是一個矩形。8 份真實卷整頁的 20,430 個剪裁路徑都是
    logo = lambda page: _raw(page, b'q 500 820 m 520 820 l 510 835 l h W n 0 g 500 820 20 15 re f Q')
    with pytest.raises(ValueError, match='^第 1 頁有不是矩形的剪裁路徑'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(logo)))


def test_text_outside_the_table_must_really_be_drawn(tmp_path):
    # 頁碼只印數字時，看得出 PDF 完整全靠最後一頁的「《以下空白》」：它整個被剪裁掉，讀者看不到結尾，
    # 檢查卻以為 PDF 完整。表格外的字也要在 PyMuPDF 畫出來的字形裡找得到
    hidden = lambda page: _raw(page, b'q 0 0 0 0 re W n BT /china-t 12 Tf 1 0 0 1 60 52 Tm '
                                     b'<300A4EE54E0B7A7A767D300B> Tj ET Q')
    options = {1: {'footer': '{n}'}, 2: {'footer': '{n}', 'extras': [hidden]}}
    with pytest.raises(ValueError, match='^第 2 頁表格外的字「《」.*找不到'):
        extract(_two_page_exam(tmp_path, page_options=options))
    shown = {1: {'footer': '{n}'}, 2: {'footer': '{n}', 'outside': ('《以下空白》',)}}
    assert extract(_two_page_exam(tmp_path, page_options=shown)) == EXPECTED


def test_only_glyphs_left_by_the_clip_count_as_drawn():
    # 四段字用的字母互不重複，才看得出是哪一段留下來
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((100, 100), 'N', fontname='helv', fontsize=12)       # 讓頁面資源裡有 /helv
    _raw(page, b'q 90 730 60 20 re W n BT /helv 12 Tf 100 736 Td (Kept) Tj ET Q')         # 剪裁路徑包住它
    _raw(page, b'q 90 700 12 20 re W n BT /helv 12 Tf 100 706 Td (Hazy) Tj ET Q')         # 只包住 H 的一部分
    _raw(page, b'q 0 0 0 0 re W n BT /helv 12 Tf 100 676 Td (Gum) Tj ET Q')              # 整個切掉
    _raw(page, b'q BT /helv 12 Tf 2 Tr 0 g 0 G 100 646 Td (Bold) Tj ET Q')               # 填色加描邊：texttrace 列兩次
    glyphs = _visible_glyphs(page)
    assert all(ch in glyphs for ch in 'KeptHBold')
    assert not any(ch in glyphs for ch in 'azyGum')


def test_only_glyphs_in_a_visible_colour_count_as_drawn():
    # texttrace 的顏色（換算成 RGB；只描邊的字是描邊色）連同不透明度，與白紙的對比至少 3:1：紅、藍、中灰是畫出來
    # 的字（真實卷頁首的日期就是紅字），淺灰、白色描邊、三成不透明的黑字不是。每段字用的字母互不重複
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((100, 100), 'N', fontname='helv', fontsize=12)
    _add_resource(page, 'ExtGState', 'GS9', '<</Type/ExtGState/ca 0.3>>')
    _raw(page, b'q BT /helv 12 Tf 1 0 0 rg 100 700 Td (RED) Tj ET Q')
    _raw(page, b'q BT /helv 12 Tf 1 Tr 0 0 1 RG 100 670 Td (BLU) Tj ET Q')  # Tr 跨 BT/ET 留著，要用 q/Q 包起來
    _raw(page, b'q BT /helv 12 Tf 0.95 g 100 640 Td (PAK) Tj ET Q')
    _raw(page, b'q BT /helv 12 Tf 1 Tr 0 g 1 G 100 610 Td (WIS) Tj ET Q')
    _raw(page, b'q BT /helv 12 Tf 0.58 g 100 580 Td (GHT) Tj ET Q')            # 3.04:1
    _raw(page, b'q BT /helv 12 Tf 0.59 g 100 550 Td (MX) Tj ET Q')             # 2.94:1
    _raw(page, b'q /GS9 gs BT /helv 12 Tf 0 g 100 520 Td (VZ) Tj ET Q')       # 黑字、三成不透明：2.11:1
    glyphs = _visible_glyphs(page)
    assert all(ch in glyphs for ch in 'REDBLUGHT')
    assert not any(ch in glyphs for ch in 'PAKWISMXVZ')


def test_glyphs_inside_an_actualtext_span_are_matched_one_by_one():
    # 有的 PDF 用 ActualText 標記替代文字：rawdict 預設照它換字，三個字形只剩一個起點，另外兩個會被當成
    # 被剪裁掉（pdfminer 與 texttrace 都照字形抽）。所以叫 PyMuPDF 不要換
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((100, 100), 'N', fontname='helv', fontsize=12)
    _raw(page, b'/Span <</ActualText (a)>> BDC BT /helv 12 Tf 100 700 Td (WXY) Tj ET EMC')
    assert all(ch in _visible_glyphs(page) for ch in 'WXY')


def _inked(text, x0, top=320.0, width=None):
    """_check_chars 看的字：黑色、正放；width 不給就用 _ch 的字寬。"""
    c = _ch(text, x0, top)
    if width is not None:
        c['x1'] = x0 + width
    return {**c, 'non_stroking_color': (0,), 'ncs': 'DeviceGray', 'matrix': (1, 0, 0, 1, x0, 800 - top),
            'adv': c['x1'] - x0}


def _check(chars):
    glyphs = {}  # 每個字都真的畫出來了：同一個起點、同一個字級，墨跡就在 pdfminer 的字框裡
    for c in chars:
        ink = (c['x0'], c['top'], c['x1'], c['bottom'])
        glyphs.setdefault(c['text'], []).append((*_origin(c), c['size'], ((c['size'], ink),)))
    _check_chars(chars, '', glyphs)


@pytest.mark.parametrize('chars', [
    [_inked('常', 100), _inked('常', 112)],                                  # 相鄰的相同中文字：差一個字寬
    [_inked('l', 100, width=2.67), _inked('l', 102.43, width=2.67)],        # 窄字 ll，字距還被縮了 0.24pt
    [_inked('1', 100, width=6.67), _inked('1', 106.67, width=6.67)],
    [_inked('(', 122, top=300), _inked('(', 122, top=320)],                 # 上下兩行同一個位置的「(」
    # Word 擠壓相鄰的全形標點：字框重疊半個字寬（8 份真實卷最多重疊較窄那個字的 51%：「）」後面接「」」）
    [_inked('）', 100), _inked('」', 105.88)],
    [_inked('；', 100), _inked('（', 106)],
    [_inked('甲', 100), _inked('乙', 100, top=327)],                         # 同一個位置，但差了半個字級以上
], ids=['cjk-pair', 'kerned-narrow-pair', 'digit-pair', 'same-place-next-line', 'squeezed-punctuation',
        'squeezed-punctuation-half', 'different-characters-a-line-apart'])
def test_repeated_characters_are_not_overprints(chars):
    _check(chars)


@pytest.mark.parametrize('chars', [
    [_inked('某', 100), _inked('某', 105.9)],                                # 偏移不到半個字寬
    [_inked('某', 100), _inked('某', 100, top=325.9)],                       # 往下不到半個字級
    [_inked('l', 100, width=2.67), _inked('l', 101.2, width=2.67)],         # 窄字：半個字寬是 1.33pt
    [_inked('.', 100, width=1.5), _inked('.', 100.8, width=1.5)],           # 更窄的字，門檻至少 1pt
    # 不同的字疊在一起：抽出來是「甲乙」，閱讀器上是一團。字框重疊超過較窄那個字的 75% 就算
    [_inked('甲', 100), _inked('乙', 100)],
    [_inked('甲', 100), _inked('乙', 102.5)],                                # 重疊 79%
    [_inked('甲', 100), _inked('i', 104, width=2.67)],                       # 窄字整個落在寬字裡
    [_inked('甲', 100), _inked('乙', 101, top=325.9)],                       # 往下不到半個字級
    [_inked('i', 100, width=2.67), _inked('甲', 100.2)],                     # 寬字蓋住左邊的窄字
], ids=['cjk-5.9pt', 'cjk-5.9pt-lower', 'narrow-1.2pt', 'tiny-0.8pt', 'different-characters-stacked',
        'different-characters-79-percent', 'narrow-inside-wide', 'different-characters-lower', 'wide-over-narrow'])
def test_the_overprint_threshold_follows_the_glyph_size(chars):
    with pytest.raises(ValueError, match='疊印'):
        _check(chars)


@pytest.mark.parametrize('offset', [(0.3, 0), (1.2, 0), (1.2, 0.8), (5, 0), (0, 1.2)],
                         ids=['fake-bold-0.3pt', 'reprint-1.2pt', 'shadow', 'less-than-half-a-glyph', 'raised-1.2pt'])
def test_overprinted_text_stops_the_extraction(tmp_path, offset):
    # 同一段字偏移一點再印一次（假粗體、陰影），抽出來會變成「某某企企業業」：水平相差不到半個字寬、
    # 垂直不到半個字級就算疊印。相鄰的相同字（「常常」、「ll」、「11」）至少差一個字寬，在整份卷裡照常擷取
    dx, dy = offset
    def draw(page):
        page.insert_text((122 + dx, TOP + 24 + 20 + dy), '某企業', fontname='china-t', fontsize=12)
    with pytest.raises(ValueError, match='疊印'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


def _superscript(page):
    """m²：上標的 2 字級較小、基線比 m 高。"""
    page.insert_text(IN_Q1, 'm', fontname='helv', fontsize=12)
    page.insert_text((IN_Q1[0] + 10, IN_Q1[1] - 5), '2', fontname='helv', fontsize=8)


@pytest.mark.parametrize(('draw', 'message'), [
    (_superscript, r'^第 1 頁第 2 列（題號 1\.）找不到小字級「2」'),
    (lambda page: page.insert_text((134.2, 156), '7', fontname='helv', fontsize=0.5),  # 「某」右下角看不見的 7
     r'^第 1 頁第 2 列（題號 1\.）小字級的「7」.*太小'),
    (lambda page: page.insert_text(IN_Q1, 'x', fontname='helv', fontsize=8), r'^第 1 頁第 2 列（題號 1\.）小字級的「x」'),
], ids=['superscript', 'invisible-digit', 'small-letter'])
def test_small_characters_are_reported_with_the_page_and_row(tmp_path, draw, message):
    # 上標（m²、10³）在未來的題目裡是合理的內容，照設計報錯；訊息要說在哪一頁哪一題，不能只有座標
    with pytest.raises(ValueError, match=message):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


def test_different_characters_printed_on_top_of_each_other_stop_the_extraction(tmp_path):
    # 「某」上面再印一個「甲」：抽出來是「某甲企業」，閱讀器上是一團
    stacked = lambda page: page.insert_text((122, TOP + 24 + 20), '甲', fontname='china-t', fontsize=12)
    with pytest.raises(ValueError, match=r'^第 1 頁第 2 列（題號 1\.）的字「甲」.*與「某」疊在一起'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(stacked)))


def _data_table(spacer):
    """題目裡沒有框線的資料表：兩欄之間是 spacer（數字是定位點的跳距，或一段空白字元）。"""
    return ('C', '6.', [_line('某廠排放資料如下，何者正確？ '),
                        [('排放源', 'china-t', 12, 0), spacer, ('排放量', 'china-t', 12, 0)],
                        [('固定燃燒', 'china-t', 12, 0), spacer, ('120', 'helv', 12, 0)], *_options()])


@pytest.mark.parametrize(('spacer', 'message'), [
    (60, r'^第 2 頁第 4 列（題號 6\.）同一行的「源」與「排」之間有 60\.0pt 的空隙'),
    (('          ', 'helv', 12, 0), r'^第 2 頁第 4 列（題號 6\.）同一行的「源」與「排」之間連續 10 個空白'),
], ids=['tab-stops', 'spaces'])
def test_a_borderless_table_inside_a_question_stops_the_extraction(tmp_path, spacer, message):
    # 擷取時會被攤平成「排放源 排放量 固定燃燒 120」，看不出是表格
    with pytest.raises(ValueError, match=message):
        extract(_two_page_exam(tmp_path, page2_extra_rows=[_data_table(spacer)]))


CJK = pymupdf.Font('cjk')  # PyMuPDF 內建的中文 TrueType 字型（Droid Sans Fallback），可以整個內嵌


def _embedded_cjk(page, text, at, cid_to_gid='/Identity', name='kai'):
    """在 at 用內嵌的 CJK 字型畫 text，寫法照 Word：Type0、Identity-H（字碼就是字形編號）、一個 CIDFontType2、
    FontFile2、ToUnicode。PyMuPDF 不寫 /CIDToGIDMap，這裡補上 cid_to_gid（Word 寫 /Identity；None 就不寫）。
    回傳 (Type0 字型, CIDFont) 的 xref。"""
    page.insert_font(fontname=name, fontbuffer=CJK.buffer)
    page.insert_text(at, text, fontname=name, fontsize=12)
    doc = page.parent
    font = next(xref for xref, _, _, _, font_name, _ in page.get_fonts() if font_name == name)
    kid = int(doc.xref_get_key(font, 'DescendantFonts')[1].strip('[]').split()[0])
    if cid_to_gid is not None:
        doc.xref_set_key(kid, 'CIDToGIDMap', cid_to_gid)
    return font, kid


def _to_unicode(page, font, text, target):
    """把內嵌字型 font 裡 text 那個字形（字碼 = 字形編號）的 ToUnicode 改指到 target（四位十六進位，空字串也可以）。"""
    cmap = ('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def '
            '/CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar '
            f'<{CJK.has_glyph(ord(text)):04X}> <{target}> endbfchar endcmap CMapName currentdict /CMap defineresource '
            'pop end end')
    doc = page.parent
    stream = doc.get_new_xref()
    doc.update_object(stream, '<<>>')
    doc.update_stream(stream, cmap.encode(), new=True)
    doc.xref_set_key(font, 'ToUnicode', f'{stream} 0 R')


def _mapped_glyph(code_point, at=IN_Q1):
    """在 at 用內嵌字型畫一個 Q，再把它的 ToUnicode 指到 code_point：字形看起來正常，抽出來卻是特殊碼位。
    （沒有內嵌的字型不准帶 ToUnicode，見 _font_problem。）"""
    def draw(page):
        font, _ = _embedded_cjk(page, 'Q', at)
        _to_unicode(page, font, 'Q', f'{code_point:04X}')
    return draw


@pytest.mark.parametrize('code_point', [0x2F00, 0xF09E, 0x200B, 0x00AD, 0xF9E4, 0xFB01, 0xFFFD,
                                        0x001F, 0x001C, 0x0009, 0x0085, 0x000B, 0x00A0, 0x2028],
                         ids=['kangxi-radical', 'private-use-symbol', 'zero-width-space', 'soft-hyphen',
                              'compatibility-ideograph', 'ligature', 'replacement-character', 'unit-separator',
                              'file-separator', 'tab', 'next-line', 'vertical-tab', 'no-break-space', 'line-separator'])
def test_a_glyph_mapped_to_an_odd_code_point_stops_the_extraction(tmp_path, code_point):
    # M1_S2 第 30 題的 U+2F00、M1_S1 第 46 題的 U+F09E 都是這樣來的；不轉換，擋下來讓人工改。
    # 對到控制字元或 U+0020、U+3000 以外的空白：以前先被當成空白跳過，看得見的字安靜地變成空格
    with pytest.raises(ValueError, match=f'第 1 頁第 2 列（題號 1.）有特殊字元 U\\+{code_point:04X}'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(_mapped_glyph(code_point))))


@pytest.mark.parametrize('code_point', [0x001F, 0x00A0], ids=['unit-separator', 'no-break-space'])
def test_an_odd_code_point_outside_the_table_stops_the_extraction(tmp_path, code_point):
    # 科目那一行最後多一個字，對到控制字元或不斷行空白：以前在行尾被 strip 掉，整行照樣符合允許清單
    glyph = _mapped_glyph(code_point, at=(60 + 12 * len(SUBJECT) + 1, 30 + 16))  # 科目那一行的最後面
    with pytest.raises(ValueError, match=f'^第 1 頁表格外有特殊字元 U\\+{code_point:04X}'):
        extract(_two_page_exam(tmp_path, page_options={1: {'extras': [glyph]}}))


def test_a_glyph_without_unicode_stops_the_extraction(tmp_path):
    # 字型的編碼沒有定義的字碼：pdfminer 抽成「(cid:129)」
    def draw(page):
        _text('Q', 'cour')(page)  # 讓頁面資源裡有 /cour
        _raw(page, f'BT /cour 12 Tf {IN_Q1[0] + 20} {842 - IN_Q1[1]} Td <81> Tj ET'.encode())
    with pytest.raises(ValueError, match=r'特殊字元 \(cid:129\)'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


def _form_field(page):
    field = pymupdf.Widget()
    field.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    field.field_name = 'erratum'
    field.rect = pymupdf.Rect(300, 150, 540, 170)
    field.field_value = 'C'
    page.add_widget(field)


LINK = {'kind': pymupdf.LINK_URI, 'from': pymupdf.Rect(122, 144, 300, 158), 'uri': 'https://example.com/'}


def _link_with_appearance(page):
    """Link 註解帶外觀串流（/AP）：一塊白色方塊蓋住第 1 題題幹第一行。PDFium（Chrome）會畫出來，MuPDF 不畫。"""
    page.insert_link(LINK)
    doc = page.parent
    link = page.annot_xrefs()[0][0]
    appearance = doc.get_new_xref()
    doc.update_object(appearance, '<</Type/XObject/Subtype/Form/BBox[0 0 178 14]/Resources<<>>>>')
    doc.update_stream(appearance, b'1 g 0 0 178 14 re f', new=True)
    doc.xref_set_key(link, 'AP', f'<</N {appearance} 0 R>>')


def _raw_annotation(spec, direct=False):
    """直接把一個註解字典寫進頁面的 /Annots：PyMuPDF 的 API 做不出來的（自訂種類、沒有 /Subtype、直接物件）。"""
    def draw(page):
        doc = page.parent
        if direct:
            doc.xref_set_key(page.xref, 'Annots', f'[{spec}]')
            return
        xref = doc.get_new_xref()
        doc.update_object(xref, spec)
        doc.xref_set_key(page.xref, 'Annots', f'[{xref} 0 R]')
    return draw


@pytest.mark.parametrize(('annotate', 'kind'), [
    (lambda page: page.add_freetext_annot(pymupdf.Rect(300, 150, 540, 170), 'C', fontsize=10), 'FreeText'),
    (lambda page: page.add_stamp_annot(pymupdf.Rect(300, 150, 500, 200), stamp=0), 'Stamp'),
    (lambda page: page.add_text_annot((300, 160), 'C'), 'Text'),                              # 便利貼
    (lambda page: page.add_highlight_annot(pymupdf.Rect(122, 144, 300, 158)), 'Highlight'),
    (lambda page: page.add_rect_annot(pymupdf.Rect(300, 150, 400, 200)), 'Square'),
    (_form_field, 'Widget'),                                                                   # 表單欄位
    # PyMuPDF 的 annot_xrefs 會跳過這兩種，閱讀器卻會畫出它們的外觀
    (_raw_annotation('<</Type/Annot/Subtype/Erratum/Rect[300 600 500 620]/Contents(C)>>'), 'Erratum'),
    (_raw_annotation('<</Type/Annot/Rect[300 600 500 620]/Contents(C)>>'), 'None'),
    (_raw_annotation('<</Type/Annot/Subtype/FreeText/Rect[300 600 500 620]/Contents(C)>>', direct=True), 'FreeText'),
    (_raw_annotation('null', direct=True), 'None'),                     # 壞掉的項目：看不出是什麼，一樣報
    (lambda page: (page.insert_link(LINK), page.add_freetext_annot(pymupdf.Rect(300, 150, 540, 170), 'C')), 'FreeText'),
    (_link_with_appearance, r'Link（帶外觀串流 /AP）'),
], ids=['free-text', 'stamp', 'sticky-note', 'highlight', 'rectangle', 'form-field', 'unknown-kind', 'no-kind',
        'direct-object', 'null-entry', 'after-a-link', 'link-with-an-appearance'])
def test_a_pdf_annotation_stops_the_extraction(tmp_path, annotate, kind):
    # 註解不在頁面內容裡，pdfminer 抽不到：寫在上面的勘誤（「更正：本題答案為 C」）會被安靜丟掉
    with pytest.raises(ValueError, match=f'^第 1 頁有 PDF 註解（{kind}'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(annotate)))


def test_a_link_is_not_treated_as_an_annotation_to_worry_about(tmp_path):
    # Word 把網址轉成 Link 註解，它本身不畫任何東西（沒有 /AP；帶 /AP 的見上面的 link-with-an-appearance）
    assert extract(_two_page_exam(tmp_path, page_options=_in_q1(lambda page: page.insert_link(LINK)))) == EXPECTED


def _page_resources(page) -> int:
    """頁面的 /Resources（合成卷一律是間接物件）的 xref。"""
    kind, value = page.parent.xref_get_key(page.xref, 'Resources')
    assert kind == 'xref', kind
    return int(value.split()[0])


def _add_resource(page, category, name, value):
    """在頁面的 /Resources/<category> 加一項，保留原有的（浮水印、字型）。"""
    doc, resources = page.parent, _page_resources(page)
    kind, entries = doc.xref_get_key(resources, category)
    doc.xref_set_key(resources, category, (entries[:-2] if kind == 'dict' else '<<') + f'/{name} {value}>>')


def _append_content(page, content: bytes):
    """在頁面內容的最後接一段原始的內容串流（PyMuPDF 的 API 畫不出來的寫法）。"""
    doc = page.parent
    stream = doc.get_new_xref()
    doc.update_object(stream, '<<>>')
    doc.update_stream(stream, content, new=True)
    kind, value = doc.xref_get_key(page.xref, 'Contents')
    doc.xref_set_key(page.xref, 'Contents', f'[{value.strip("[]") if kind == "array" else value} {stream} 0 R]')


HELVETICA = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>'


def _raw_stream(content: bytes, font=False):
    """頁面最後接一段原始內容；font 為真時先在資源裡加上 /F9（Helvetica）。"""
    def draw(page):
        if font:
            _add_resource(page, 'Font', 'F9', HELVETICA)
        _append_content(page, content)
    return draw


def _form_xobject(bbox=True, subtype='name', last=False):
    """表單物件（Form XObject）：用白色粗描邊的字蓋住第 1 題的答案 C，再印一個黑色的 A（都是字，不是圖形）。
    沒有 /BBox 的表單，pdfminer 整個跳過（抽出 C），MuPDF 與 PDFium 都照樣畫出來（看到的是 A；審查實測）。
    subtype='indirect'：/Subtype 寫成指向 /Form 的間接參照（pdfminer 不解參照，也整個跳過）。
    last：表單是整份 PDF 的最後一個物件（先接內容串流，再建表單）。"""
    def draw(page):
        doc = page.parent
        if last:
            _append_content(page, b'q /Fx9 Do Q')
        form = doc.get_new_xref()
        box = '/BBox[0 0 595 842]' if bbox else ''
        if subtype == 'indirect':
            name = doc.get_new_xref()
            doc.update_object(name, '/Form')
            kind = f'{name} 0 R'
        else:
            kind = '/Form'
        doc.update_object(form, f'<</Type/XObject/Subtype {kind}{box}/Resources<</Font<</F1 {HELVETICA}>>>>>>')
        doc.update_stream(form, b'BT /F1 16 Tf 1 g 1 G 2 Tr 8 w 1 0 0 1 57 676 Tm (M) Tj ET '
                                b'BT /F1 16 Tf 0 g 0 Tr 1 0 0 1 59 676 Tm (A) Tj ET', new=True)
        _add_resource(page, 'XObject', 'Fx9', f'{form} 0 R')
        if not last:
            _append_content(page, b'q /Fx9 Do Q')
    return draw


def _optional_content(on, indirect=False):
    """選擇性內容（圖層）：一塊白色方塊放在圖層裡，蓋住第 1 題的答案。圖層關著時 MuPDF 不畫，PDFium 會畫
    （/Intent /Design 的圖層，審查實測）；各家閱讀器顯示哪些圖層並不一致，pdfminer 則一律照抽。
    indirect：目錄的 /OCProperties 寫成間接物件。"""
    def draw(page):
        doc = page.parent
        layer = doc.add_ocg('勘誤', on=on)
        page.draw_rect(pymupdf.Rect(70, 142, 90, 162), color=None, fill=(1, 1, 1), oc=layer)
        if indirect:
            kind, value = doc.xref_get_key(doc.pdf_catalog(), 'OCProperties')
            assert kind == 'dict', kind
            moved = doc.get_new_xref()
            doc.update_object(moved, value)
            doc.xref_set_key(doc.pdf_catalog(), 'OCProperties', f'{moved} 0 R')
    return draw


@pytest.mark.parametrize(('structure', 'message'), [
    (_form_xobject(bbox=False), r'^PDF 裡有表單物件（Form XObject'),
    (_form_xobject(bbox=True), r'^PDF 裡有表單物件（Form XObject'),
    (_optional_content(on=False), r'^PDF 有選擇性內容（圖層'),
    (_optional_content(on=True), r'^PDF 有選擇性內容（圖層'),
    (_optional_content(on=False, indirect=True), r'^PDF 有選擇性內容（圖層'),
    (_form_xobject(subtype='indirect'), r'^PDF 裡有 /Subtype 不是直接名稱的物件'),
], ids=['form-without-bbox', 'form-with-bbox', 'layer-off', 'layer-on', 'layer-list-elsewhere', 'indirect-subtype'])
def test_a_form_xobject_or_a_layer_stops_the_extraction(tmp_path, structure, message):
    # 表單裡的內容 pdfminer 不一定讀得到（沒有 /BBox 就整個跳過），圖層則是各家閱讀器顯示的不一樣：
    # 兩者都會讓抽出來的字與閱讀器上看到的不同。真實的公告試題（Word 匯出）兩種都沒有。
    with pytest.raises(ValueError, match=message):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(structure)))


def test_a_form_that_is_the_last_object_of_the_pdf_stops_the_extraction(tmp_path):
    # 增量更新附加上去的物件編號最大：表單剛好是最後一個物件也要擋
    with pytest.raises(ValueError, match=r'^PDF 裡有表單物件（Form XObject'):
        extract(_two_page_exam(tmp_path, page_options={2: {'extras': [_form_xobject(last=True)]}}))


def _minimal_pdf(objects: list[bytes], root: int) -> bytes:
    """手寫一份最小的 PDF：objects[i] 是第 i+1 號物件的內容。"""
    out, offsets = bytearray(b'%PDF-1.7\n'), []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % number + body + b'\nendobj\n'
    start = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1)
    out += b''.join(b'%010d 00000 n \n' % o for o in offsets)
    out += b'trailer\n<</Size %d /Root %d 0 R>>\nstartxref\n%d\n%%%%EOF\n' % (len(objects) + 1, root, start)
    return bytes(out)


def test_a_form_that_is_the_first_object_of_the_pdf_stops_the_extraction(tmp_path):
    # 手寫的 PDF：第 1 號物件就是表單（PyMuPDF 做出來的第 1 號物件是目錄）
    path = tmp_path / 'first.pdf'
    path.write_bytes(_minimal_pdf([
        b'<</Type/XObject/Subtype/Form/BBox[0 0 10 10]/Length 7>>\nstream\n0 0 m S\nendstream',
        b'<</Type/Catalog/Pages 3 0 R>>',
        b'<</Type/Pages/Kids[4 0 R]/Count 1>>',
        b'<</Type/Page/Parent 3 0 R/MediaBox[0 0 595 842]/Resources<</XObject<</Fx 1 0 R>>>>/Contents 5 0 R>>',
        b'<</Length 11>>\nstream\nq /Fx Do Q\nendstream',
    ], root=2))
    with pytest.raises(ValueError, match=r'^PDF 裡有表單物件（Form XObject，xref 1）'):
        extract(path)


# 以下都是 pdfminer 讀不到、閱讀器照樣畫出來的內容（審查以 MuPDF 與 PDFium 兩套算繪器實測）：抽出來的與看到的不同。
# pdfminer 不認得的寫法（運算子後面接 NUL、圖樣、inline 圖）由內容串流的檢查擋掉（見下面第九輪的測試）；
# 反方向核對是最後一道：PyMuPDF 畫出來的每一個字、每一張圖，都要在 pdfminer 抽到的東西裡找得到。

NUL_TEXT = (b'BT /F9 16 Tf 1 g 1 G 2 Tr 8 w 1 0 0 1 57 676 Tm (M) Tj\x00 ET '
            b'BT /F9 16 Tf 0 g 0 Tr 1 0 0 1 59 676 Tm (A) Tj\x00 ET')


def _pattern_text(page):
    """表格外（右側頁邊）用圖樣（tiling pattern）填一塊三角形：圖樣的格子裡寫著「A」。pdfminer 不讀圖樣的內容。
    用三角形不用矩形：矩形的四條邊會被 pdfplumber 當成另一張表。"""
    doc = page.parent
    pattern = doc.get_new_xref()
    doc.update_object(pattern, f'<</Type/Pattern/PatternType 1/PaintType 1/TilingType 1/BBox[0 0 30 20]/XStep 30'
                               f'/YStep 20/Resources<</Font<</F9 {HELVETICA}>>>>>>')
    doc.update_stream(pattern, b'BT /F9 12 Tf 0 g 1 0 0 1 8 5 Tm (A) Tj ET', new=True)
    _add_resource(page, 'Pattern', 'P9', f'{pattern} 0 R')
    _append_content(page, b'q /Pattern cs /P9 scn 560 400 m 590 400 l 575 430 l h f Q')


INLINE_IMAGE = b'BI /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 ID \x00\xff\xff\x00 EI'


def _glyph_without_text(page):
    """第 1 題題目欄用內嵌字型畫一個 Q，字型的 ToUnicode 卻把它對到空字串：閱讀器照畫 Q，pdfminer 抽出來是空的
    （空的字不是空白、也不是特殊字元，逐字核對時直接跳過），題目安靜地少一個字。MuPDF 把這個字形記成 U+FFFD。"""
    font, _ = _embedded_cjk(page, 'Q', IN_Q1)
    _to_unicode(page, font, 'Q', '')


def test_a_glyph_drawn_but_extracted_as_nothing_stops_the_extraction(tmp_path):
    with pytest.raises(ValueError, match='^第 1 頁畫出了擷取不到的字「\ufffd」') as refused:
        extract(_two_page_exam(tmp_path, page_options=_in_q1(_glyph_without_text)))
    assert '（例如字型的 ToUnicode 把字對到空字串、' in str(refused.value)  # 人工排查的提示：先列已知的成因


def test_a_shape_that_pdfminer_underestimates_counts_as_a_drawing(tmp_path):
    # 題目欄裡畫了什麼，看的是 PyMuPDF 真的畫出來的範圍（含線寬），不是 pdfminer 讀到的外框：
    # 0.2pt 高的細矩形、16pt 粗的白色描邊，pdfminer 當成一條細線
    thick = _raw_stream(b'q 1 G 16 w 122 692 108 0.2 re S Q')
    with pytest.raises(ValueError, match='第 1 題的題目欄裡有圖片或圖形'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(thick)))


@pytest.mark.parametrize('ops', [
    b'BT /F9 12 Tf 0 g 1 G 2 Tr 4 w 1 0 0 1 170 388 Tm (X) Tj ET',     # 填黑色、描 4pt 白邊：看不見
    b'BT /F9 12 Tf 0 g 1 G 2 Tr 1 w 1 0 0 1 170 388 Tm (X) Tj ET',     # 白邊 1pt（字級的 8%）：筆畫被吃掉大半
    b'BT /F9 12 Tf 0 g 0.8 G 2 Tr 3 w 1 0 0 1 170 388 Tm (X) Tj ET',   # 淺灰、3pt（字級的 25%）：一樣蓋住
], ids=['white-stroke', 'thin-white-stroke', 'thick-grey-stroke'])
def test_a_stroke_in_another_colour_stops_the_extraction(tmp_path, ops):
    # 填色加描邊（2 Tr）的字，描邊畫在填色之上：與填色不同色的描邊（白、灰）把字蓋掉，pdfminer 只看填色，照樣抽得出來。
    # 真實卷的描邊是黑色 0.343pt（12pt 字）與紅色 0.456pt（16pt 字），都與填色同色
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [_raw_stream(ops, font=True)]}})
    with pytest.raises(ValueError, match='描了與填色不同顏色的邊'):
        extract(exam)


def _xref_with_two_spaces(path):
    """xref 表的一筆寫成「000000042  00000 n」（仍是 20 個位元組）：MuPDF 照讀，pdfminer 判為壞掉、改成掃描整個檔案。"""
    data = path.read_bytes()
    table = data.rindex(b'\nxref\n')  # 表本身（不是 startxref）
    entry = re.compile(rb'0(\d{9}) (\d{5}) n')
    m = entry.search(data, table)
    path.write_bytes(data[:m.start()] + m.group(1) + b'  ' + m.group(2) + b' n' + data[m.end():])
    return path


def test_a_pdf_whose_xref_the_two_programs_read_differently_stops_the_extraction(tmp_path):
    # 兩套 PDF 程式各自修復壞掉的 xref，讀到的可能是不同版本的頁面（審查實測：pdfminer 讀到另一份沒被參照的頁面）
    path = _xref_with_two_spaces(_two_page_exam(tmp_path))
    assert not pymupdf.open(path).is_repaired  # 只有 pdfminer 改成掃描
    with pytest.raises(ValueError, match=r'^PDF 的 xref 表'):
        extract(path)


def test_a_pdf_that_pymupdf_had_to_repair_stops_the_extraction(tmp_path, monkeypatch):
    # 反過來：只有 PyMuPDF 重建 xref（pdfminer 照讀）
    monkeypatch.setattr(pymupdf.Document, 'is_repaired', property(lambda self: True))
    with pytest.raises(ValueError, match=r'^PDF 的 xref 表'):
        extract(_two_page_exam(tmp_path))


# ── 第八輪審查：容差、描邊、圖形狀態、表格外的字、圖與細條 ─────────────────────────────────────────

def _blank_answers(rows):
    """第 1、2 題的答案欄留空（答案另外用原始內容畫）。"""
    rows = list(rows)
    rows[1] = ('', *rows[1][1:])
    rows[2] = ('', *rows[2][1:])
    return rows


def _transparent_decoys(page):
    """全透明（/ca 0）、字級 400pt 的 B、A，中心分別落在第 1、2 題的答案欄：閱讀器上看不到。"""
    _add_resource(page, 'ExtGState', 'GS0', '<</Type/ExtGState/ca 0>>')
    _raw_stream(b'q /GS0 gs BT /F9 400 Tf 16 Tz 0 g 1 0 0 1 45 474.8 Tm (B) Tj ET '
                b'BT /F9 400 Tf 16 Tz 0 g 1 0 0 1 45 414.8 Tm (A) Tj ET Q', font=True)(page)


def test_a_letter_cannot_borrow_another_glyphs_visibility(tmp_path):
    # 第 1、2 題的答案欄留空，只有看不見的 B、A：以前「附近有同一個字」就算對上（容差是字級的一半，400pt 的字就是
    # 200pt），借到選項標記「(B)」「(A)」的看得見，兩題憑空多出答案。現在一對一配對：起點相差 0.1pt 以內、
    # 字級相同（真實卷相差 0.0002pt）
    exam = _exam(tmp_path, [_blank_answers(PAGE1), PAGE2], {1: {'extras': [_transparent_decoys]}})
    with pytest.raises(ValueError, match='^第 1 頁第 2 列（題號 1\\.）的字「B」.*找不到'):
        extract(exam)


def _q3_with_a_gap():
    """第 3 題第二行寫成「下列何者」+ 12pt 空隙 +「正確？」：空隙裡要是藏了「不」，題意就翻過來。"""
    rows = list(PAGE1)
    q3 = rows[3]
    lines = list(q3[2])
    lines[1] = [('下列何者', 'china-t', 12, 0), 12, ('正確？ ', 'china-t', 12, 0)]
    rows[3] = (q3[0], q3[1], lines)
    return rows


BU = '<4E0D>'  # 「不」


@pytest.mark.parametrize(('ops', 'message'), [
    # 黑字描 0.85 灰的邊，整段畫在放大 10 倍的座標系裡：線寬讀起來只有 0.4，頁面上其實是 4pt，字糊成一團淺灰
    (b'q 10 0 0 10 0 0 cm BT /china-t 1.2 Tf 0 g 0.85 G 2 Tr 0.4 w 1 0 0 1 17 38.8 Tm <4E0D> Tj ET Q',
     '描了與填色不同顏色的邊'),
    # 同色的描邊一樣放大：頁面上 4pt 的黑邊，字糊成一團、蓋到旁邊的字
    (b'q 10 0 0 10 0 0 cm BT /china-t 1.2 Tf 0 g 0 G 2 Tr 0.4 w 1 0 0 1 17 38.8 Tm <4E0D> Tj ET Q',
     r'描邊在頁面上寬 4\.00pt'),
    # 先設線寬、再放大座標系：pdfminer 在 w 那一刻換算的線寬（0.4）已經不準，頁面上一樣是 4pt
    (b'q 0.4 w 10 0 0 10 0 0 cm BT /china-t 1.2 Tf 0 g 0 G 2 Tr 1 0 0 1 17 38.8 Tm <4E0D> Tj ET Q',
     r'描邊在頁面上寬 4\.00pt'),
    # 沒有縮放、同色、4pt 的描邊（字級的 33%）
    (b'q BT /china-t 12 Tf 0 g 0 G 2 Tr 4 w 1 0 0 1 170 388 Tm <4E0D> Tj ET Q', r'描邊在頁面上寬 4\.00pt'),
    # 6pt 的線寬在 q 裡暫時改細，Q 之後又是 6pt：線寬要跟著 q／Q 存回
    (b'q 6 w q 0.3 w Q BT /china-t 12 Tf 0 g 0 G 2 Tr 1 0 0 1 170 388 Tm <4E0D> Tj ET Q', r'描邊在頁面上寬 6\.00pt'),
    # 24pt 的字在文字矩陣裡縮成一半：頁面上是 12pt，1.5pt 的描邊超過一成（只看 Tf 的 24pt 就放過了）
    (b'q BT /china-t 24 Tf 0 g 0 G 2 Tr 1.5 w 0.5 0 0 0.5 170 388 Tm <4E0D> Tj ET Q', r'超過字級 12\.0pt 的一成'),
], ids=['scaled-grey-stroke', 'scaled-thick-stroke', 'width-set-before-scaling', 'thick-stroke-same-colour',
        'width-restored-by-Q', 'size-scaled-by-the-text-matrix'])
def test_a_stroke_may_only_embolden_its_own_glyph(tmp_path, ops, message):
    # 真實卷的描邊都是 Word 的粗體：填色加描邊、同一個顏色、頁面上的線寬是字級的 2.9%
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [_raw_stream(ops, font=True)]}})
    with pytest.raises(ValueError, match=message):
        extract(exam)


@pytest.mark.parametrize('space', [
    b'BT /F9 12 Tf 1 g 1 0 0 1 170 388 Tm ( ) Tj ET',             # 白色的空白
    b'q /GS0 gs BT /F9 12 Tf 0 g 1 0 0 1 170 388 Tm ( ) Tj ET Q',  # 全透明的空白
    b'BT /F9 12 Tf 1 1 0.89 rg 1 0 0 1 170 388 Tm ( ) Tj ET',     # 看起來是白色的空白
], ids=['white-space', 'transparent-space', 'yellowish-white-space'])
def test_a_clipped_glyph_cannot_hide_behind_a_space_at_its_origin(tmp_path, space):
    # 「不」整個被剪掉，同一個起點再畫一個看不見的空白：以前只數看得見的字形，剪裁後留下的字（那個空白）與它
    # 一樣多，「不」就算畫出來了，抽出來是「下列何者不正確？」，閱讀器上是「下列何者　正確？」（審查實測）
    def draw(page):
        _add_resource(page, 'ExtGState', 'GS0', '<</Type/ExtGState/ca 0>>')
        _raw_stream(b'q 0 0 0 0 re W n BT /china-t 12 Tf 0 g 1 0 0 1 170 388 Tm <4E0D> Tj ET Q ' + space,
                    font=True)(page)
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [draw]}})
    with pytest.raises(ValueError, match='的字「不」.*找不到'):
        extract(exam)


def test_a_white_stroke_outside_the_table_stops_the_extraction(tmp_path):
    # 表格下方允許的「《以下空白》」，最後一個字描 90pt 的白邊：蓋掉第 5 題的 (D)
    def end_mark(page):
        x = 100.0
        page.insert_text((x, 434), '《以下空白', fontname='china-t', fontsize=12)
        last = x + pymupdf.get_text_length('《以下空白', fontname='china-t', fontsize=12)
        _append_content(page, b'q BT /china-t 12 Tf 0 g 1 G 2 Tr 90 w 1 0 0 1 %.2f %.2f Tm <300B> Tj ET Q'
                        % (last, 842 - 434))
    with pytest.raises(ValueError, match='描邊'):
        extract(_two_page_exam(tmp_path, page_options={2: {'extras': [end_mark], 'footer': '{n}'}}))


WHITE_TRANSFER = '<</FunctionType 2 /Domain [0 1] /C0 [1] /C1 [1] /N 1>>'


def _graphics_state(state):
    """用一個圖形狀態（ExtGState）畫第 3 題空隙裡的「不」。"""
    def draw(page):
        _add_resource(page, 'ExtGState', 'GS9', f'<</Type/ExtGState{state}>>')
        _append_content(page, b'q /GS9 gs BT /china-t 12 Tf 0 g 1 0 0 1 170 388 Tm <4E0D> Tj ET Q')
    return draw


def _soft_mask_group(page):
    doc = page.parent
    group = doc.get_new_xref()
    doc.update_object(group, '<</Type/XObject/BBox[0 0 595 842]/Group<</S/Transparency/CS/DeviceGray>>>>')
    doc.update_stream(group, b'', new=True)
    _graphics_state(f'/SMask<</S/Luminosity/G {group} 0 R>>')(page)


@pytest.mark.parametrize('draw', [
    _graphics_state(f'/TR {WHITE_TRANSFER}'),   # PDFium 與 Poppler 畫成白字，MuPDF 不支援 /TR、照畫黑字
    _graphics_state(f'/TR2 {WHITE_TRANSFER}'),
    _graphics_state('/BM/Lighten'),             # 疊在不透明的底色上就看不見
    _soft_mask_group,                           # 遮罩的群組沒寫 /Subtype：不是「表單」，照樣把字遮掉
    _graphics_state('/ca/Half'),                # 不透明度不是數字：各家算繪器怎麼解讀都不一定
    _graphics_state('/CA(0.5)'),
], ids=['transfer-function', 'transfer-function-2', 'blend-mode', 'soft-mask', 'opacity-as-a-name',
        'stroke-opacity-as-a-string'])
def test_a_graphics_state_outside_the_word_profile_stops_the_extraction(tmp_path, draw):
    # 真實卷的圖形狀態只有 /BM /Normal 與 /CA、/ca 1：其他的各家算繪器畫法不同，一律擋
    with pytest.raises(ValueError, match='圖形狀態'):
        extract(_exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [draw]}}))


def test_a_plain_graphics_state_is_fine(tmp_path):
    # Word 寫的就是這種：一般的混色、不透明
    exam = _exam(tmp_path, [PAGE1, PAGE2], {1: {'extras': [lambda page: (
        _add_resource(page, 'ExtGState', 'GS9', '<</Type/ExtGState/BM/Normal/CA 1/ca 1>>'),
        _append_content(page, b'q /GS9 gs Q'))]}})
    assert extract(exam) == EXPECTED


def _type3_font(page):
    """一個 Type 3 字型：字形程序是一段內容串流，畫什麼都可以（這裡是一個實心方塊）。"""
    doc = page.parent
    proc = doc.get_new_xref()
    doc.update_object(proc, '<<>>')
    doc.update_stream(proc, b'1000 0 0 0 1000 1000 d1 0 0 1000 1000 re f', new=True)
    _add_resource(page, 'Font', 'F3', f'<</Type/Font/Subtype/Type3/FontBBox[0 0 1000 1000]/FontMatrix[0.001 0 0 0.001 0 0]'
                                     f'/CharProcs<</sq {proc} 0 R>>/Encoding<</Type/Encoding/Differences[97/sq]>>'
                                     f'/FirstChar 97/LastChar 97/Widths[1000]/Resources<<>>>>')
    _append_content(page, b'BT /F3 12 Tf 1 0 0 1 400 600 Tm (a) Tj ET')


def test_a_type3_font_stops_the_extraction(tmp_path):
    # 字形程序和表單一樣是完整的內容串流：抽出來的字與畫出來的東西沒有關係
    with pytest.raises(ValueError, match='Type 3 字型'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(_type3_font)))


@pytest.mark.parametrize(('page', 'draw', 'message'), [
    # 允許的「一、單選題」，畫在表格之後、白色、400pt：每個字的中心都在表格右邊，「一」的橫畫卻塗白了表格右半邊
    (1, lambda page: page.insert_text((360, 760), '一、單選題', fontname='china-t', fontsize=400, color=(1, 1, 1)),
     '字級'),
    (1, lambda page: page.insert_text((60, 760), '一、單選題', fontname='china-t', fontsize=30), '字級'),  # 30pt
    # 第 1 頁的表格到 654pt：這一行字的中心在表格下方，字框卻壓到表格的下緣
    (1, lambda page: page.insert_text((60, 662), '一、單選題', fontname='china-t', fontsize=12), '蓋到表格'),
    # 最後一頁隱形的「《以下空白》」：讀者看不到結尾，檢查卻以為 PDF 完整
    (2, lambda page: page.insert_text((60, 790), '《以下空白》', fontname='china-t', fontsize=12, render_mode=3),
     '文字畫法「3 Tr」'),
    (2, lambda page: page.insert_text((60, 790), '《以下空白》', fontname='china-t', fontsize=12, fill_opacity=0),
     r'看不清楚的字「《」.*對比 1\.00:1'),
    # 一般字級的白字、淡黃的字（允許清單上的字）：看不見，可能蓋住別的字
    (1, lambda page: page.insert_text((60, 760), '一、單選題', fontname='china-t', fontsize=12, color=(1, 1, 1)),
     '看不清楚的字「一」'),
    (1, lambda page: page.insert_text((60, 760), '一、單選題', fontname='china-t', fontsize=12, color=(1, 1, 0.89)),
     r'看不清楚的字「一」.*對比 1\.02:1'),
], ids=['giant-white-text', 'oversized-text', 'text-overlapping-the-table', 'invisible-end-mark',
        'transparent-end-mark', 'white-text', 'yellowish-white-text'])
def test_text_outside_the_table_follows_the_word_profile(tmp_path, page, draw, message):
    # 真實卷表格外的字：黑（21:1）或紅（4.0:1）、8–18pt、不碰表格、沒有隱形的字
    first = tuple(line for line in FIRST_PAGE if line != '一、單選題')
    options = {1: {'first_page': first, 'extras': [draw] if page == 1 else []}}
    if page == 2:
        options[1] = {'extras': []}
        options[2] = {'extras': [draw]}
    with pytest.raises(ValueError, match=message):
        extract(_two_page_exam(tmp_path, page_options=options))


INLINE_MASK = b'BI /Width 2 /Height 2 /ImageMask true /BitsPerComponent 1 ID \x40\x00 EI'


def _sliced_bars(page):
    """第 1 題右邊空白處四根長條，每根由 1.4pt 高的細矩形疊成（每一條都「細」），放在兩行字之間
    （第 234 與 254pt 兩條基線之間，不碰任何一行的文字中段）。"""
    ops = b'q 0 g '
    for i, slices in enumerate((6, 4, 5, 3)):
        x = 420 + 16 * i
        for step in range(slices):
            ops += b'%d %.1f 10 1.4 re f ' % (x, 842 - 244 + step * 1.5)
    _append_content(page, ops + b'Q')


def test_a_chart_of_thin_slices_is_a_figure(tmp_path):
    # 每一條都「細」（1.4pt），疊起來是一整張長條圖（審查實測）：題目欄裡的圖形不論粗細都算圖
    with pytest.raises(ValueError, match='第 1 題的題目欄裡有圖片或圖形'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(_sliced_bars)))


def test_an_xref_that_pymupdf_repairs_while_drawing_stops_the_extraction(tmp_path, monkeypatch):
    # PyMuPDF 有時畫到那一頁才重建 xref：開檔時查一次不夠，畫完再查一次。開檔時還沒重建（開檔前的檢查放行），畫過
    # 頁面之後才重建（確認審查：以前整段都當成重建過，開檔前就擋下，畫完之後那一次查不查都測不出來）
    drawn = []
    trace = pymupdf.Page.get_texttrace
    monkeypatch.setattr(pymupdf.Page, 'get_texttrace', lambda self: drawn.append(self.number) or trace(self))
    monkeypatch.setattr(pymupdf.Document, 'is_repaired', property(lambda self: bool(drawn)))
    with pytest.raises(ValueError, match='^PDF 的 xref 表壞了，PyMuPDF 畫頁面時才自己重建'):
        extract(_two_page_exam(tmp_path))
    assert drawn


def _indirect_subtype_last(page):
    """圖的 /Subtype 寫成間接參照，圖是整份 PDF 的最後一個物件。"""
    doc = page.parent
    name = doc.get_new_xref()
    image = doc.get_new_xref()  # 圖是整份 PDF 的最後一個物件
    doc.update_object(name, '/Image')
    doc.update_object(image, f'<</Type/XObject/Subtype {name} 0 R/Width 1/Height 1/ColorSpace/DeviceGray'
                             '/BitsPerComponent 8>>')
    doc.update_stream(image, b'\x00', new=True)
    _add_resource(page, 'XObject', 'Im9', f'{image} 0 R')


def test_an_indirect_subtype_on_the_last_object_stops_the_extraction(tmp_path):
    with pytest.raises(ValueError, match='^PDF 裡有 /Subtype 不是直接名稱的物件'):
        extract(_two_page_exam(tmp_path, page_options={2: {'extras': [_indirect_subtype_last]}}))


@pytest.mark.parametrize(('origin', 'size', 'same'), [
    ((100.0, 200.0), 12.0, True), ((100.1, 200.1), 12.0, True), ((100.11, 200.0), 12.0, False),
    ((100.0, 199.89), 12.0, False), ((100.0, 200.0), 12.12, True), ((100.0, 200.0), 12.13, False),
], ids=['identical', 'within-0.1pt', 'x-off-by-0.11', 'y-off-by-0.11', 'size-within-1-percent', 'size-off-by-more'])
def test_the_same_glyph_means_the_same_origin_and_size(origin, size, same):
    # 真實卷兩邊的起點最多差 0.0002pt、字級相同：寬鬆的比法讓別的字「借」到看得見（審查實測）
    assert _same_glyph((100.0, 200.0), 12.0, origin, size) is same


def test_a_drawn_glyph_must_match_the_size_of_the_extracted_one():
    # 反方向也比字級：同一個起點、同一個字，字級不同就不是同一個
    span = {'type': 0, 'size': 12.0, 'chars': [(ord('A'), 0, (100.0, 200.0), (100.0, 190.0, 108.0, 202.0))]}
    char = {'text': 'A', 'size': 24.0, 'matrix': (1, 0, 0, 1, 100.0, 600.0), 'top': 176.0, 'y1': 624.0}
    assert _unextracted_glyph([span], [char]) == ('A', (100.0, 190.0, 108.0, 202.0))
    assert _unextracted_glyph([span], [{**char, 'size': 12.0}]) is None


def test_two_drawn_images_cannot_share_one_extracted_image():
    # 一對一：藏在浮水印同一個外框上的第二張圖，以前兩張都「對上」pdfplumber 的那一張
    box = (102.0, 362.0, 493.0, 526.0)
    image = {'x0': box[0], 'top': box[1], 'x1': box[2], 'bottom': box[3]}
    assert _unextracted_image([('fill-image', box)], [image]) is None
    assert _unextracted_image([('fill-image', box), ('fill-image', box)], [image]) == box
    assert _unextracted_image([('fill-image', box), ('fill-imgmask', box)], [image, image]) is None


def test_a_drawn_image_mask_needs_an_extracted_image_too():
    # 圖片遮罩（/ImageMask）也是圖：閱讀器用填色把它塗出來，一樣要在 pdfminer 抽到的圖裡找得到
    box = (450.0, 200.0, 490.0, 240.0)
    assert _unextracted_image([('fill-imgmask', box)], []) == box
    assert _unextracted_image([('fill-imgmask', box)], [{'x0': 450.0, 'top': 200.0, 'x1': 490.0, 'bottom': 240.0}]) is None


@pytest.mark.parametrize(('shift', 'matched'), [(0.0, True), (1.0, True), (1.5, False), (15.0, False)],
                         ids=['same-box', 'within-1pt', 'off-by-1.5pt', 'elsewhere'])
def test_a_drawn_image_matches_an_extracted_one_within_1pt(shift, matched):
    # 外框的每一邊相差 1pt 以內才算同一張（真實卷的 104 張圖都對得上）
    box = (450.0, 200.0, 490.0, 240.0)
    image = {'x0': 450.0 + shift, 'top': 200.0, 'x1': 490.0 + shift, 'bottom': 240.0}
    assert (_unextracted_image([('fill-image', box)], [image]) is None) is matched


def test_an_image_pdfminer_did_not_extract_stops_the_extraction(tmp_path, monkeypatch):
    # 反方向核對圖的那一道（rows_of 呼叫 _unextracted_image，最後一道防線）：PyMuPDF 畫出來、pdfminer 卻沒有的圖。
    # 這一條與 pdfminer 的版本無關：題目欄的空白處放一張真的圖，再把它從 pdfplumber 的 page.images 拿掉，模擬 pdfminer
    # 讀不出的圖 —— 閱讀器照樣畫，題目卻會被當成純文字題（不靠 monkeypatch 的自然樣本見下一條）
    raster = lambda page: page.insert_image(pymupdf.Rect(300, 180, 470, 226), pixmap=_pixmap(90))  # 字旁邊的空白處
    exam = _two_page_exam(tmp_path, page_options=_in_q1(raster))
    images = pdfplumber.page.Page.images
    monkeypatch.setattr(pdfplumber.page.Page, 'images', property(lambda page: [
        im for im in images.fget(page) if not (page.page_number == 1 and abs(im['x0'] - 300) < 1)]))
    with pytest.raises(ValueError, match='^' + re.escape('第 1 頁畫出了擷取不到的圖（x=300.0–470.0, top=180.0–226.0）')):
        extract(exam)


def test_an_image_xobject_with_abbreviated_keys_stops_the_extraction(tmp_path):
    # 圖片 XObject 寫縮寫的 /W /H（沒有 /Width /Height）：MuPDF 與 Poppler 照畫，pdfminer 的 Do 要有 /Width /Height
    # 才讀，整張跳過（PDFium 也不畫；第二十輪審查實測）。題目欄裡的圖安靜地不見、題目被當成純文字題，只有反方向核對圖
    # 的那一道擋得到
    def raster(page):
        xref = page.insert_image(pymupdf.Rect(300, 180, 470, 226), pixmap=_pixmap(90))  # 字旁邊的空白處
        doc = page.parent
        doc.update_object(xref, doc.xref_object(xref, compressed=True).replace('/Width 8', '/W 8')
                          .replace('/Height 8', '/H 8'))
        assert '/Width' not in doc.xref_object(xref) and '/W 8' in doc.xref_object(xref)
    with pytest.raises(ValueError, match='^' + re.escape('第 1 頁畫出了擷取不到的圖（x=300.0–470.0, top=180.0–226.0）')) as refused:
        extract(_two_page_exam(tmp_path, page_options=_in_q1(raster)))
    assert '（例如圖片 XObject 把 /Width /Height 寫成縮寫的 /W /H；' in str(refused.value)  # 人工排查的提示


# ── 第九輪審查：內容串流只收兩套程式讀法一致的寫法 ─────────────────────────────────────────────
# pdfminer 與 MuPDF 讀同一段內容串流，有幾處讀法不同：NUL 在 MuPDF 是空白、在 pdfminer 是運算子的一部分（整個
# 運算子被丟掉），多給的運算元 pdfminer 取最後幾個、MuPDF 取最前面幾個。審查用這兩招讓閱讀器把「不」壓成一條線、
# 把答案描成一團黑，擷取照樣是原字。所以內容串流先過 _content_grammar：只收兩邊一定讀成一樣的寫法。

# Word 寫的內容串流（照 115-01 L11 第 1 頁的寫法）：8 份真實卷 102 頁用到的 29 個運算子都在這裡
WORD_CONTENT = (
    b'/Artifact <</Attached [/Top]/Type/Pagination/Subtype/Header>> BDC /GS7 gs\r\n'
    b'q\r\n0 0.000061035 595.32 841.92 re\r\nW* n\r\n390.25 0 0 163.7 102.5 315.77 cm\r\n/Image5 Do Q\r\n'
    b'q\r\n0.000008871 0 595.32 841.92 re\r\nW* n\r\nBT\r\n/F1 15.96 Tf\r\n1 0 0 1 103.46 802.8 Tm\r\n0 g\r\n'
    b'/GS13 gs\r\n0 G\r\n[<0014>34<0014>-3<0018>] TJ\r\nET\r\nQ\r\n EMC  /Span <</MCID 72/Lang (en-US)>> BDC q\r\n'
    b'BT\r\n/F3 12 Tf\r\n2 Tr 0.34286 w\r\n0.12 Tc\r\n1 0 0 1 96.624 652.54 Tm\r\n1 0 0 rg 1 0 0 RG\r\n[(1.)] TJ\r\n'
    b'ET\r\nQ\r\n EMC  /Artifact BMC q\r\n1 j [] 0 d 0.48 w 1 1 1 RG\r\n24.24 24 m\r\n24.24 24.48 l\r\nS\r\n'
    b'39 731.75 517 0.5 re\r\nf*\r\nQ\r\n EMC ')
WORD_OPERATORS = {'BDC', 'BMC', 'EMC', 'gs', 'q', 'Q', 'cm', 're', 'W*', 'n', 'm', 'l', 'S', 'f*', 'w', 'j', 'd', 'Do',
                  'g', 'G', 'rg', 'RG', 'BT', 'ET', 'Tf', 'Tm', 'Tc', 'Tr', 'TJ'}


def test_the_word_sample_uses_every_operator_of_the_real_papers():
    assert set(re.findall(rb'(?<![/\w])[A-Za-z]+\*?(?![\w*])', WORD_CONTENT.replace(b'(en-US)', b''))) \
        == {op.encode() for op in WORD_OPERATORS}


@pytest.mark.parametrize('streams', [
    [WORD_CONTENT],
    # PyMuPDF 的寫法（合成卷全是這樣）：一段一段接、.6 這種數字、]TJ 中間不空格
    [b'\nq\n/fitzca9930 gs\nBT\n1 0 0 1 100 742 Tm\n/helv 12 Tf [<41>]TJ\nET\nQ\n',
     b'\nq\nBT\n1 0 0 1 100 712 Tm\n/helv 12 Tf 2 Tr .6 w 1 M [<42>]TJ\nET\nQ\n'],
    [b'BT /F1 12 Tf 1 0 0 1 0 0 Tm [<0041>', b'-5 <0042>] TJ ET'],  # 陣列跨兩段：兩邊都把段與段接起來讀
    [b'1 0 0 1 .5 -.5 cm 5. w -7 Tc', b''],                           # 各種數字；空的一段
    [b'BT /F1 12 Tf 0 0 Td (\\(a\\)\\\\\\101\\000\\377\\n\\r\\t\\b\\f) Tj ET'],  # 字串裡的跳脫（clean_contents 寫 \000）
    [b'q\t1 0 0 1 0 0 cm\fQ'],                                        # 定位字元、換頁字元也是兩邊都認的空白
    [b'BT 0 Tr 2 Tr ET'],
    [b''], [],
], ids=['word', 'pymupdf', 'array-across-two-streams', 'numbers', 'string-escapes', 'tab-and-form-feed',
        'render-modes-0-and-2', 'empty-stream', 'no-stream'])
def test_a_content_stream_both_programs_read_alike_is_accepted(streams):
    assert _content_grammar(streams) is None


def test_the_operators_the_two_programs_read_differently_are_not_accepted():
    # inline 圖、Type 3 字形、相容區段、引號運算子、看色彩空間決定運算元數目的顏色運算子
    assert not {'BI', 'ID', 'EI', 'd0', 'd1', 'BX', 'EX', "'", '"', 'cs', 'CS', 'sc', 'SC', 'scn', 'SCN'} & OPERATORS.keys()


SYNTAX = '不是兩套 PDF 程式讀法一致的寫法'


@pytest.mark.parametrize(('streams', 'message'), [
    # 詞法：兩套程式切詞不同的寫法
    ([b'BT /F1 12 Tf 1 0 0 1 170 388 Tm\x00 (A) Tj ET'], rf'^內容串流第 1 段第 30 個位元組起的 .*{SYNTAX}'),
    ([b'q \x00 Q'], SYNTAX),                                   # NUL：MuPDF 當空白，pdfminer 當成字
    ([b'q\x0bQ'], SYNTAX),                                     # \v：反過來，pdfminer 當空白
    ([b'q % note\nQ'], SYNTAX),                                # 註解
    ([b'{ q }'], SYNTAX),
    ([b'1.2.3 w'], SYNTAX), ([b'--1 w'], SYNTAX), ([b'+1 w'], SYNTAX), ([b'1e5 w'], SYNTAX),
    ([b'1 0 0 1 170 388Tm'], SYNTAX),                          # 數字後面直接接運算子
    ([b'/F#31 12 Tf'], SYNTAX),                                # 名稱裡的 # 跳脫
    ([b'<414> Tj'], SYNTAX), ([b'<41 42> Tj'], SYNTAX),        # 奇數個、夾空白的十六進位字串
    ([b'<41\x0042> Tj'], SYNTAX),                            # pdfminer 讀到 NUL 就當成字串結束
    ([b'(a\x80) Tj'], SYNTAX), ([b'(a(b)c) Tj'], SYNTAX), ([b'(a\\q) Tj'], SYNTAX),
    # 第三十六輪審查實測：數字緊接運算子（640c：Poppler 畫成一塊黑，MuPDF、PDFium 不畫；0g：pdfminer、Poppler 黑字，
    # MuPDF、PDFium 白字）、詞與詞之間的垂直定位字元、字串後面多一個 )、名稱裡的垂直定位字元、十六進位字串裡的 tab
    ([b'0 0 m 550 640c f'], SYNTAX), ([b'1 g 0g'], SYNTAX), ([b'1 g 0 \x0bg'], SYNTAX), ([b'BT (A)) Tj ET'], SYNTAX),
    ([b'BT /F2\x0b 24 Tf ET'], SYNTAX), ([b'<4142\t4> Tj'], SYNTAX),
    # 第三十七輪審查實測：數字裡的逗號（0,0 g：Poppler 不畫，字留在白色；20,5 Tm：只有 pdfminer 讀到）、數字前面的 *、
    # 兩個小數點（.9.0 g：PDFium 讀成 0.9 的淺灰）、名稱開頭不是 /（#F2：pdfminer 抽不到）、單獨的 /（Poppler 不畫）、
    # 字典的結尾寫成 } 或單獨的 >（pdfminer 的字典沒關上，後面的字都抽不到）
    ([b'1 g 0,0 g'], SYNTAX), ([b'BT 1 0 0 1 20,5 40 Tm ET'], SYNTAX), ([b'1 g *0 g'], SYNTAX), ([b'0 g .9.0 g'], SYNTAX),
    ([b'BT #F2 24 Tf ET'], SYNTAX), ([b'BT / 24 Tf ET'], SYNTAX), ([b'/Span <</MCID 0 } BDC EMC'], SYNTAX),
    ([b'/Span <</MCID 0> BDC EMC'], SYNTAX),
    # 第三十八輪審查實測：八進位跳脫的第一位不是數字（\v00：pdfminer 讀成 00，閱讀器讀成 v00）、{ 開頭的字串、} 開頭的
    # >>、十六進位字串每一對的第一位是空白類的字（<4E VT D>：PDFium 畫成「仐」）、小數第二位起的逗號、名稱的第一個字是 #
    ([b'BT (A\\v00) Tj ET'], SYNTAX), ([b'BT {41> Tj ET'], SYNTAX), ([b'BT {A) Tj ET'], SYNTAX),
    ([b'/Span <</MCID 0 }> BDC EMC'], SYNTAX), ([b'BT <41 4> Tj ET'], SYNTAX), ([b'BT <4E\x0bD> Tj ET'], SYNTAX),
    ([b'1 g 0.0,0 g'], SYNTAX), ([b'BT /#G1 24 Tf ET'], SYNTAX),
    # 第三十九輪審查實測：段的開頭是 VT 或 NUL（\v1 g：pdfminer 讀成白字，MuPDF、PDFium 畫黑字，Poppler 不畫 —— 只改
    # _content_grammar 自己的迴圈，整套照樣全綠）、字串裡的「\ CR LF」（CR 落在 pdfminer 緩衝區的最後一個位元組時，
    # pdfminer 把 LF 收進字串）、十六進位字串兩對之間的 CR LF
    ([b'\x0b1 g'], SYNTAX), ([b'q', b'\x0bQ'], SYNTAX), ([b'\x00q Q'], SYNTAX), ([b'BT (A\\\r\nB) Tj ET'], SYNTAX),
    ([b'BT <41\r\n42> Tj ET'], SYNTAX),
    # 第四十輪審查實測：負號、小數點後面的 CR LF（- CR LF 1 g、0. CR LF 9 g：pdfminer 讀成白色，MuPDF 畫黑字，Poppler、
    # PDFium 不畫）；第四十一輪：只改 _content_grammar 自己的迴圈，切詞前拿掉這兩種 CR LF，整套照樣全綠
    ([b'-\r\n1 g'], SYNTAX), ([b'0.\r\n9 g'], '「g」接了 2 個運算元'),
    ([b"BT (A) ' ET"], SYNTAX), ([b'BT 0 0 (A) " ET'], SYNTAX),  # 引號運算子（pdfminer 的 " 少做 T*）
    ([b'1000 0 d0'], SYNTAX),                                  # Type 3 字形的運算子
    ([b'BT /F1 12 Tf 1 0 0 1 0 0 Tm (A', b') Tj ET'], SYNTAX),  # 字串跨兩段
    # 運算子：兩套程式做法不同的
    ([INLINE_IMAGE], '^內容串流有 Word 不會寫的運算子「BI」'),
    ([b'BX q Q EX'], '「BX」'), ([b'/CS0 cs 1 scn'], '「cs」'), ([b'/CS0 CS'], '「CS」'), ([b'0.5 sc'], '「sc」'),
    ([b'0.5 SC'], '「SC」'), ([b'/P9 scn'], '「scn」'), ([b'/P9 SCN'], '「SCN」'), ([b'Foo'], '「Foo」'),
    # 運算元：多給、少給、給錯種類
    ([b'8 0.5 w'], '^內容串流的運算子「w」接了 2 個運算元（數字、數字），應為 1 個（數字）'),
    ([b'BT 2 0 Tr ET'], '「Tr」接了 2 個運算元'),
    ([b'BT 1 0 0 0.001 170 388 1 0 0 1 170 388 Tm ET'], '「Tm」接了 12 個運算元'),
    ([b'BT 0.001 Tm ET'], '「Tm」接了 1 個運算元'),
    ([b'q Q 5'], '^內容串流最後有沒用到的運算元'), ([b'1 2 3'], '最後有沒用到的運算元'),
    ([b'5 q Q'], '「q」接了 1 個運算元（數字），應為 0 個'),
    ([b'/X w'], r'「w」接了 1 個運算元（名稱），應為 1 個（數字）'),
    ([b'BT (a) 0 0 1 0 0 Tm ET'], '「Tm」接了 6 個運算元（字串、'),
    ([b'[(a)] 0 d'], '^內容串流的 d 陣列裡有數字以外的東西'),
    ([b'BT [[<41>]] TJ ET'], '^內容串流的 TJ 陣列裡有字串與數字以外的東西'),
    ([b'/Span /MC0 BDC EMC'], '「BDC」接了 2 個運算元（名稱、名稱），應為 2 個（名稱、字典）'),
    # 文字畫法：Word 只寫 0 與 2
    ([b'BT 3 Tr ET'], '^內容串流有文字畫法「3 Tr」'), ([b'BT 1 Tr ET'], '「1 Tr」'), ([b'BT 7 Tr ET'], '「7 Tr」'),
    ([b'BT 8 Tr ET'], '「8 Tr」'), ([b'BT -1 Tr ET'], '「-1 Tr」'), ([b'BT 2.5 Tr ET'], '「2.5 Tr」'),
    # 選擇性內容：/OC 標記的內容閱讀器可能不畫
    ([b'/OC <</Type/OCG>> BDC EMC'], '^內容串流有選擇性內容'), ([b'/OC BMC EMC'], '有選擇性內容'),
    # 陣列、字典的結構
    ([b'BT [<41> TJ] ET'], '^內容串流的陣列或字典裡有運算子「TJ」'),
    ([b'/Span <</A true>> BDC EMC'], '陣列或字典裡有運算子「true」'),
    ([b'BT [<41>'], '最後有沒用到的運算元或沒關上的陣列'), ([b'<</A 1>>'], '最後有沒用到的運算元'),
    ([b'] TJ'], '^內容串流的「\\]」沒有對應的「\\[」'), ([b'<</A 1] BDC'], '「\\]」沒有對應的「\\[」'),
    ([b'[1 2>> d'], '「>>」沒有對應的「<<」'),
    ([b'/Span <<1 2>> BDC EMC'], '^內容串流的字典不是「名稱 值」成對'), ([b'/Span <</A>> BDC EMC'], '字典不是'),
], ids=lambda value: None if isinstance(value, str) else repr(value)[:40])
def test_a_content_stream_the_two_programs_may_read_differently_is_refused(streams, message):
    assert re.search(message, _content_grammar(streams) or '')


@pytest.mark.parametrize(('ops', 'message'), [
    # 審查實測：pdfminer 讀不到 NUL 後面的 Tm，閱讀器照做，把「不」壓成一條線；擷取照樣是「下列何者不正確？」
    (b'BT /china-t 12 Tf 0 g 1 0 0 1 170 388 Tm 1 0 0 0.001 170 388 Tm\x00 <4E0D> Tj ET', SYNTAX),
    # 多給的運算元：pdfminer 取最後 6 個（正常的字），MuPDF 取最前面 6 個（壓扁）
    (b'BT /china-t 12 Tf 0 g 1 0 0 0.001 170 388 1 0 0 1 170 388 Tm <4E0D> Tj ET', '「Tm」接了 12 個運算元'),
    # 描邊線寬的 w 後面接 NUL、或多給一個運算元：pdfminer 以為 0.3pt，閱讀器畫 6pt，字糊成一團
    (b'BT /F9 12 Tf 0 g 0 G 2 Tr 6 w\x00 1 0 0 1 170 388 Tm (X) Tj ET', SYNTAX),
    (b'BT /F9 12 Tf 0 g 0 G 2 Tr 6 0.3 w 1 0 0 1 170 388 Tm (X) Tj ET', '「w」接了 2 個運算元'),
    (b'BT /F9 12 Tf 0 g 0 G 2 0 Tr 6 w 1 0 0 1 170 388 Tm (X) Tj ET', '「Tr」接了 2 個運算元'),
    (NUL_TEXT, SYNTAX),
    (b'q 1 g 122 686 108 16 re f\x00 Q', SYNTAX),             # 白色方塊蓋住題幹第一行，pdfminer 看不到
    (b'q 40 0 0 40 450 602 cm ' + INLINE_IMAGE + b' Q', '運算子「BI」'),  # 寫完整 /Width /Height 的 inline 圖
    (b'q 40 0 0 40 450 602 cm ' + INLINE_MASK + b' Q', '運算子「BI」'),
], ids=['squashed-after-a-nul', 'extra-operands-squash', 'width-after-a-nul', 'extra-width-operand',
        'extra-render-mode-operand', 'text-after-a-nul', 'white-box-after-a-nul', 'inline-image', 'inline-image-mask'])
def test_content_the_two_programs_read_differently_stops_the_extraction(tmp_path, ops, message):
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [_raw_stream(ops, font=True)]}})
    with pytest.raises(ValueError, match=f'^第 1 頁的內容串流.*{message}.*兩套 PDF 程式可能讀成不同的內容'):
        extract(exam)


@pytest.mark.parametrize('draw', [
    _pattern_text,                                             # 圖樣（tiling pattern）裡的字，pdfminer 不讀
    lambda page: _raw(page, b'391 0 0 164 102 316 cm BI /W 2 /H 2 /CS /G /BPC 8 ID \x00\xff\xff\x00 EI', first=True),
], ids=['text-in-a-pattern', 'inline-image-both-read'])
def test_patterns_and_inline_images_stop_the_extraction(tmp_path, draw):
    with pytest.raises(ValueError, match='^第 1 頁的內容串流有 Word 不會寫的運算子「(cs|BI)」'):
        extract(_two_page_exam(tmp_path, page_options={1: {'extras': [draw]}, 2: {'extras': [draw]}}))


def test_an_extra_restore_of_the_graphics_state_is_harmless(tmp_path):
    # 多一個 Q（沒有對應的 q）兩邊都照樣略過；量描邊線寬時也不能因此出錯
    assert extract(_two_page_exam(tmp_path, page_options=_in_q1(_raw_stream(b'Q Q')))) == EXPECTED


def test_content_the_two_programs_decode_differently_stops_the_extraction(tmp_path, monkeypatch):
    # 壓縮資料壞了、/Length 不對時，兩套程式各自補救，解出來的內容串流可能不同：逐段比對位元組
    # （這裡直接讓 PyMuPDF 多讀一個空白）
    exam = _two_page_exam(tmp_path)
    decode = pymupdf.Document.xref_stream
    monkeypatch.setattr(pymupdf.Document, 'xref_stream', lambda self, xref: decode(self, xref) + b' ')
    with pytest.raises(ValueError, match='^第 1 頁的內容串流兩套 PDF 程式解出來的不一樣'):
        extract(exam)


def test_text_profile_measures_contrast_with_opacity():
    # 表格外的字也看對比（連同不透明度）：灰 0.58 剛好看得見、0.59 不行；黑字三成不透明不行
    def span(color, opacity=1.0):
        return {'type': 0, 'size': 12.0, 'color': color, 'opacity': opacity,
                'chars': [(ord('一'), 0, (60.0, 760.0), (60.0, 750.0, 72.0, 762.0))]}
    table = (39.0, 120.0, 556.0, 654.0)
    assert _text_profile([span((0.58, 0.58, 0.58))], table) is None
    assert '看不清楚的字「一」' in _text_profile([span((0.59, 0.59, 0.59))], table)
    assert '對比 2.11:1' in _text_profile([span((0.0, 0.0, 0.0), opacity=0.3)], table)
    assert _text_profile([span((0.0, 0.0, 0.0), opacity=0.45)], table) is None


# ── 第十輪審查：詞的長度與大小、字的幾何、看不見的小字、資源 ────────────────────────────────────────
# 三套程式讀超長的詞各有上限（MuPDF 與 PDFium 的數字、名稱只讀前 255 字，MuPDF 把 2³² 以上的整數部分繞回），
# 字型描述的 /Descent 只移動 pdfminer 的字框：都是審查在閱讀器上實測，擷取卻照樣是原字。

def test_the_token_limits_leave_room_for_what_word_writes():
    # 8 份真實卷：數字最多 3 位整數、9 位小數，名稱最多 10 個字元，字串最多 76 個位元組，陣列最多 43 項，
    # 陣列與字典最多疊 2 層
    longest = (b'/Span <</' + b'N' * 127 + b' [[[1]]]>> BDC EMC 123456 w 0.1234567890 w -.1234567890 w '
               b'BT /F1 12 Tf 0 0 Td <' + b'00' * 4096 + b'> Tj (' + b'a' * 4096 + b') Tj ET [' + b'1 ' * 1024 + b'] 0 d')
    assert _content_grammar([longest]) is None


@pytest.mark.parametrize(('streams', 'message'), [
    ([b'1 0 0 ' + b'0' * 254 + b'10 0 0 cm'], SYNTAX),  # 256 字：MuPDF 與 PDFium 只讀前 255 字（pdfminer 10、它們 1）
    ([b'1234567 w'], SYNTAX), ([b'0.12345678901 w'], SYNTAX), ([b'.12345678901 w'], SYNTAX),
    ([b'BT 4294967296.0 Ts ET'], SYNTAX),               # MuPDF 把 2³² 以上的整數部分繞回：讀成 0
    ([b'/' + b'F' * 128 + b' 12 Tf'], SYNTAX),          # 名稱上限 127 字（256 字以上兩邊選到不同的字型）
    ([b'BT <' + b'00' * 4097 + b'> Tj ET'], SYNTAX), ([b'BT (' + b'a' * 4097 + b') Tj ET'], SYNTAX),
    ([b'BT (\\777) Tj ET'], SYNTAX), ([b'BT (\\400) Tj ET'], SYNTAX),  # 超過一個位元組的八進位：pdfminer 直接出錯
    ([b'BT (\\0) Tj ET'], SYNTAX), ([b'BT (\\12) Tj ET'], SYNTAX),     # 一兩位的八進位不收
    ([b'<41  42> Tj'], SYNTAX),                         # 十六進位字串夾兩個空白（湊成偶數個字元）
    ([b'/Span <</A [[[[1]]]]>> BDC EMC'], '^內容串流的陣列或字典疊了超過 4 層'),
    ([b'[' + b'1 ' * 1025 + b'] 0 d'], '^內容串流有超過 1024 項的陣列或字典'),
    ([b'[' + b'[] ' * 1025 + b'] 0 d'], '^內容串流有超過 1024 項的陣列或字典'),  # 超過的那一項是關上的陣列
], ids=['256-character-number', '7-digit-integer', '11-decimals', '11-decimals-no-integer', 'integer-part-2-to-32',
        '128-character-name', 'long-hex-string', 'long-literal-string', 'octal-escape-past-255', 'octal-escape-400',
        'one-digit-octal', 'two-digit-octal', 'hex-string-with-two-spaces', 'five-levels', '1025-items',
        '1025-nested-items'])
def test_a_content_stream_token_past_the_common_limits_is_refused(streams, message):
    assert re.search(message, _content_grammar(streams) or '')


@pytest.mark.parametrize('stream', [
    b'BT [-7(A)] TJ ET', b'/Span <</A [1[2]]>> BDC EMC', b'/P <</MCID 3>> BDC EMC', b'[3 2]0 d',
    b'1\t0 0 1 0\f0 cm', b'1\n0\r0 1 0 0 cm',
    b'/Span <</A[1]>> BDC EMC', b'/Span <</A<41>>> BDC EMC', b'/Span <</Lang(en)>> BDC EMC', b'/Span <</B /A>> BDC EMC',
    b'/F1\t12 Tf', b'/GS7\ngs', b'/F1\f12 Tf', b'/GS7\rgs',
    b'BT /F1 12 Tf<0041> Tj ET', b'BT /F1 12 Tf(A) Tj ET', b'BT 0 0 Td[<41>]TJ ET', b'EMC/P <<>> BDC EMC',
], ids=['number-then-paren', 'number-then-bracket', 'number-then-angle', 'number-then-close-bracket',
        'number-then-tab-and-form-feed', 'number-then-newlines', 'name-then-bracket', 'name-then-angle',
        'name-then-paren', 'name-then-close-angle', 'name-then-tab', 'name-then-newline', 'name-then-form-feed',
        'name-then-return', 'operator-then-angle', 'operator-then-paren', 'operator-then-bracket',
        'operator-then-slash'])
def test_every_delimiter_both_programs_split_on_is_accepted(stream):
    # 數字、名稱、運算子後面可以直接接分隔字元：每一種都釘住，改窄了才會轉紅
    assert _content_grammar([stream]) is None


def test_a_token_may_end_where_a_stream_ends():
    assert _content_grammar([b'1 0 0 1 0', b' 0 cm /Span <</A 1>> BDC /P', b' BMC EMC EMC']) is None


@pytest.mark.parametrize('ops', [
    # 審查實測：三個 256 字的「10」與一個 0.001：pdfminer 算出正常的字，MuPDF 與 PDFium 把「不」壓成一條線
    b'q 1 0 0 1 170 388 cm' + (b' 1 0 0 ' + b'0' * 254 + b'10 0 0 cm') * 3 + b' 1 0 0 0.001 0 0 cm '
    b'BT /china-t 12 Tf 0 g 1 0 0 1 0 0 Tm <4E0D> Tj ET Q',
    # 2³² 的上移：pdfminer 把字移到頁面外、當成頁碼，MuPDF 繞回 0、畫在題目裡
    b'BT /F9 12 Tf 0 g 4294967296.0 Ts 1 0 0 1 170 388 Tm (1) Tj ET',
], ids=['256-character-scaling', 'rise-past-2-to-32'])
def test_numbers_the_programs_read_differently_stop_the_extraction(tmp_path, ops):
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [_raw_stream(ops, font=True)]}})
    with pytest.raises(ValueError, match=f'^第 1 頁的內容串流.*{SYNTAX}'):
        extract(exam)


def _china_copy(page, old, new):
    """題目用的字型（china-t）另存一份，字型描述（FontDescriptor）裡的 old 換成 new，以 /chinax 加進頁面資源。"""
    doc = page.parent
    font = next(xref for xref, _, _, _, name, _ in page.get_fonts() if name == 'china-t')
    cid = int(doc.xref_get_key(font, 'DescendantFonts')[1].strip('[]').split()[0])
    descriptor = int(doc.xref_get_key(cid, 'FontDescriptor')[1].split()[0])
    new_descriptor, new_cid, new_font = doc.get_new_xref(), doc.get_new_xref(), doc.get_new_xref()
    text = doc.xref_object(descriptor)
    assert old in text
    doc.update_object(new_descriptor, text.replace(old, new))
    doc.update_object(new_cid, doc.xref_object(cid).replace(f'/FontDescriptor {descriptor} 0 R',
                                                            f'/FontDescriptor {new_descriptor} 0 R'))
    doc.update_object(new_font, doc.xref_object(font).replace(f'[ {cid} 0 R ]', f'[ {new_cid} 0 R ]'))
    _add_resource(page, 'Font', 'chinax', f'{new_font} 0 R')


MARKED_ROWS = [('header',), ('B', '1.', [_line('下列何者為溫室氣體？ '), [36, ('氧氣； ', 'china-t', 12, 0)],
                                          [36, ('二氧化碳； ', 'china-t', 12, 0)], [36, ('氮氣； ', 'china-t', 12, 0)],
                                          [36, ('氬氣', 'china-t', 12, 0)], [36, ('（單選）', 'china-t', 12, 0)]])]


def _markers_one_line_off(page):
    """(A)–(D) 四個選項標記用另一份字型畫，字型描述的 /Descent 改成 -1866.67：pdfminer 算出來的字框往下移一行
    （20pt），閱讀器上的字沒動。審查實測：擷取出來的 (B) 是氮氣，三套算繪器畫的 (B) 都是二氧化碳（答案 B）。"""
    _china_copy(page, '/Descent -200', '/Descent -1866.67')
    ops = b'q BT /chinax 12 Tf 0 g '
    for i, key in enumerate('ABCD', start=1):
        ops += b'1 0 0 1 122 %d Tm <0028%04X0029> Tj ' % (842 - (TOP + 24 + 20 + 20 * i), ord(key))
    _append_content(page, ops + b'ET Q')


def test_a_character_box_the_font_description_moved_stops_the_extraction(tmp_path):
    # 分行、分列都看 pdfminer 的字框；字框被字型度量移開，墨跡的中心就不在字框裡
    exam = _exam(tmp_path, [MARKED_ROWS, [('header',)]], {1: {'extras': [_markers_one_line_off]}})
    with pytest.raises(ValueError, match=r'^第 1 頁第 2 列（題號 1\.）的字「\(」.*找不到'):
        extract(exam)


def _blank_glyph_as_bu(page):
    """內嵌字型的空白字形畫在第 3 題的空隙，字型的 ToUnicode 卻把它對到「不」：閱讀器上是「下列何者　正確？」，
    擷取出來是「下列何者不正確？」（以前照樣通過）。"""
    font, _ = _embedded_cjk(page, ' ', (170, 842 - 388))
    _to_unicode(page, font, ' ', '4E0D')


def test_a_blank_glyph_extracted_as_a_character_stops_the_extraction(tmp_path):
    # 字形要真的有墨跡。沒有內嵌的字型 MuPDF 算不出墨跡（給整個字型的外框），所以不准帶 ToUnicode（_font_problem）
    with pytest.raises(ValueError, match='的字「不」.*找不到'):
        extract(_exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [_blank_glyph_as_bu]}}))


def _glyph(scale=12.0, ink=(100.0, 190.0, 112.0, 201.0), *more):
    """_visible_glyphs 記的一個字形：起點、字級與 rawdict 裡同一個字、同一個起點的紀錄（兩個方向的縮放, 墨跡）。"""
    return {'A': [(100.0, 200.0, 12.0, ((scale, ink),) + more if ink else more)]}


A_CHAR = {'text': 'A', 'size': 12.0, 'matrix': (1, 0, 0, 1, 100.0, 642.0), 'top': 188.0, 'y1': 654.0, 'bottom': 202.0}


@pytest.mark.parametrize(('glyphs', 'drawn'), [
    (_glyph(), True),
    (_glyph(scale=11.8), False),                                    # 兩個方向合起來的縮放不同：被壓扁的字
    (_glyph(ink=(100.0, 203.0, 112.0, 214.0)), False),              # 墨跡在字框下面
    (_glyph(ink=(100.0, 176.0, 112.0, 187.0)), False),              # 墨跡在字框上面
    (_glyph(ink=(100.0, 200.0, 112.0, 200.0)), False),              # 沒有墨跡（高度是 0）
    (_glyph(ink=(100.0, 190.0, 100.0, 201.0)), False),              # 沒有墨跡（寬度是 0）
    (_glyph(ink=None), False),                                      # 剪裁之後沒留下墨跡
    (_glyph(ink=(100.0, 150.0, 112.0, 240.0)), True),               # 墨跡比字框高，中心仍在字框裡
    (_glyph(ink=(100.0, 199.0, 112.0, 210.0)), False),              # 墨跡的中心在字框下緣之下（與字框仍有重疊）
    (_glyph(11.0, (100.0, 190.0, 112.0, 201.0), (12.0, (100.0, 203.0, 112.0, 214.0))), False),  # 縮放與墨跡各對一筆
    (_glyph(11.0, (100.0, 190.0, 112.0, 201.0), (12.0, (100.0, 190.0, 112.0, 201.0))), True),   # 其中一筆兩樣都對
], ids=['same', 'squashed', 'ink-below-the-box', 'ink-above-the-box', 'flat-ink', 'thin-ink', 'no-ink', 'tall-ink',
        'ink-centre-below-the-box', 'scale-and-ink-from-different-records', 'one-record-matches'])
def test_a_drawn_glyph_must_have_the_scale_and_the_ink_of_the_extracted_one(glyphs, drawn):
    assert _drawn(A_CHAR, glyphs) is drawn


def test_visible_glyphs_record_both_scales_and_the_ink():
    # 垂直縮成四分之一的字：texttrace 的字級只看水平方向（12），rawdict 的是兩個方向的幾何平均（6）
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((100, 100), 'N', fontname='helv', fontsize=12)
    _raw(page, b'q BT /helv 12 Tf 1 0 0 0.25 100 670 Tm (V) Tj ET Q')
    (x, y, size, records), = _visible_glyphs(page)['V']
    (scale, (x0, top, x1, bottom)), = records
    assert (x, y, size) == pytest.approx((100.0, 172.0, 12.0)) and scale == pytest.approx(6.0)
    assert 168 < top < bottom <= 172.01 and 100 <= x0 < x1 < 109


def test_text_too_small_to_see_stops_the_extraction(tmp_path):
    # 頁碼只印數字時，看得出 PDF 完整全靠最後一頁的「《以下空白》」：0.3pt 的字閱讀器上看不見，擷取卻抽得到。
    # 整頁的字至少 MIN_TEXT_SIZE（真實卷最小的是 8.04pt 的下標）
    tiny = lambda page: _raw(page, b'q BT /china-t 0.3 Tf 0 g 1 0 0 1 60 52 Tm <300A4EE54E0B7A7A767D300B> Tj ET Q')
    options = {1: {'footer': '{n}'}, 2: {'footer': '{n}', 'extras': [tiny]}}
    with pytest.raises(ValueError, match=r'^第 2 頁有字級 0\.30pt 的字「《」.*不到 6pt'):
        extract(_two_page_exam(tmp_path, page_options=options))


HELVETICA_FONT = b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>'


def test_page_resources_that_are_not_a_dictionary_stop_the_extraction(tmp_path):
    # /Resources 不是字典（指向一個數字）：pdfminer 與 MuPDF 當成沒有資源，PDFium 改用上層節點的資源（審查實測：畫出
    # 上層的 Type 3 字形）。根節點帶 /Resources，頁面樹的檢查先擋下（第十四輪）；頁面自己的那一項見
    # test_a_page_must_carry_its_own_resource_dictionary。指向不存在的物件在物件那一層就擋下（見
    # test_a_reference_to_an_object_the_xref_does_not_list_is_refused）
    content = b'BT /F1 24 Tf 1 0 0 1 100 700 Tm (A) Tj ET'
    path = tmp_path / 'broken-resources.pdf'
    path.write_bytes(_minimal_pdf([
        b'<</Type/Catalog/Pages 2 0 R>>',
        b'<</Type/Pages/Kids[3 0 R]/Count 1/Resources<</Font<</F1 5 0 R>>>>>>',
        b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources 6 0 R/Contents 4 0 R>>',
        b'<</Length %d>>\nstream\n' % len(content) + content + b'\nendstream',
        HELVETICA_FONT, b'42'], root=1))
    with pytest.raises(ValueError, match='^頁面樹不是 Word 的寫法'):
        extract(path)


def test_a_type3_font_anywhere_in_the_pdf_stops_the_extraction(tmp_path):
    # 頁面資源以外的 Type 3 字型也擋（上層節點的資源、沒被參照的物件）：有的閱讀器會改用上層的資源
    def stray_type3(page):
        doc = page.parent
        font = doc.get_new_xref()
        doc.update_object(font, '<</Type/Font/Subtype/Type3/FontBBox[0 0 1000 1000]/FontMatrix[0.001 0 0 0.001 0 0]'
                                '/CharProcs<<>>/Encoding<</Type/Encoding/Differences[]>>/FirstChar 97/LastChar 97'
                                '/Widths[1000]/Resources<<>>>>')
    with pytest.raises(ValueError, match=r'^PDF 裡有 Type 3 字型（xref \d+）'):
        extract(_two_page_exam(tmp_path, page_options={2: {'extras': [stray_type3]}}))


@pytest.mark.parametrize('structure', [_form_xobject(bbox=False), _optional_content(on=False)], ids=['form', 'layer'])
def test_the_header_is_not_read_from_a_pdf_with_forms_or_layers(tmp_path, structure):
    # 頁首也是抽出來的字：表單與圖層裡的字，閱讀器上看到的與抽出來的不同，拿它對 SOURCES 之前就擋
    with pytest.raises(ValueError, match='^PDF (裡有表單物件|有選擇性內容)'):
        header(_two_page_exam(tmp_path, page_options=_in_q1(structure)))


def test_the_header_is_not_read_from_content_the_two_programs_read_differently(tmp_path):
    # 內容串流的檢查也在讀頁首之前：NUL 後面的字閱讀器照畫、pdfminer 讀不到，頁首一樣可以這樣改
    with pytest.raises(ValueError, match='^第 1 頁的內容串流'):
        header(_two_page_exam(tmp_path, page_options=_in_q1(_raw_stream(NUL_TEXT, font=True))))


def _resources_not_a_dictionary(tmp_path):
    """頁面的 /Resources 不是字典（指向一個數字），根節點照 Word 的寫法、不帶 /Resources：擋在頁面自己的 /Resources
    那一條（_resources），不是頁面樹。"""
    content = b'BT /F1 24 Tf 1 0 0 1 100 700 Tm (A) Tj ET'
    path = tmp_path / 'broken-resources.pdf'
    path.write_bytes(_minimal_pdf([
        b'<</Type/Catalog/Pages 2 0 R>>',
        b'<</Type/Pages/Kids[3 0 R]/Count 1>>',
        b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources 6 0 R/Contents 4 0 R>>',
        b'<</Length %d>>\nstream\n' % len(content) + content + b'\nendstream',
        HELVETICA_FONT, b'42'], root=1))
    return path


def _page_resources_null(tmp_path):
    """整卷第 1 頁的 /Resources 改寫成同樣長度的 /Resources null，根節點不動（不帶 /Resources）：擋在頁面自己的
    /Resources 那一條。"""
    doc = pymupdf.open(_two_page_exam(tmp_path))
    reference = doc.xref_get_key(doc[0].xref, 'Resources')[1]
    page = doc[0].xref
    data = doc.tobytes()
    old = b'/Resources ' + reference.encode()
    at = data.index(old, data.index(b'\n%d 0 obj' % page))
    return _rewritten(tmp_path, data[:at] + b'/Resources null'.ljust(len(old)) + data[at + len(old):])


def _stray_type3(page):
    """一個沒有任何頁面資源參照的 Type 3 字型物件（整份掃描才擋得到）。"""
    doc = page.parent
    font = doc.get_new_xref()
    doc.update_object(font, '<</Type/Font/Subtype/Type3/FontBBox[0 0 1000 1000]/FontMatrix[0.001 0 0 0.001 0 0]'
                            '/CharProcs<<>>/Encoding<</Type/Encoding/Differences[]>>/FirstChar 97/LastChar 97'
                            '/Widths[1000]/Resources<<>>>>')


def _second_table(page):
    """表格下方另一張兩格的小表（一頁兩張表）。"""
    for y in (700, 740):
        _fill(page, 39, y - 0.25, 556, y + 0.25)
    for x in (39, 88, 556):
        _fill(page, x - 0.25, 700, x + 0.25, 740)


def _rewritten(tmp_path, data: bytes):
    path = tmp_path / 'rewritten.pdf'
    path.write_bytes(data)
    return path


# ── header() 拒絕 extract() 在表格之前拒絕的每一樣東西 ─────────────────────────────────────────────────────────

# extract() 在表格以後才做的檢查（rows_of() 在 _outside_table() 回傳之後的部分、parse_rows()）的訊息，從開頭比：
# 逐列逐字、要先畫出頁面才看得出來，header() 不做 —— 兩個工具都在 header() 之後跑 extract()。這個檔案裡每一次
# extract() 拒絕，_extract_and_compare 都看它是在 _outside_table() 回傳之前還是之後：之後的，訊息要在這張清單上；
# 之前的（共用的檢查：_unreadable、_opened、_pages、_outside_table），訊息不可以在清單上，而且 header() 對同一份
# PDF 要以同樣的訊息拒絕。所以要讓一項檢查只在 extract() 跑，就要把它的訊息加進這裡，是看得見的決定；清單寫得太寬、
# 蓋到共用的檢查，也轉紅（第十四輪確認審查實測：把 /Subtype 間接參照、兩套程式解出來的不一樣從 _pages() 搬到
# rows_of() 表格以後，header() 就不再拒絕，整套測試照樣全綠 —— 共用的檢查拒絕的 128 種訊息，只有 60 種有 header()
# 的樣本）
EXTRACT_ONLY = tuple(re.compile(pattern) for pattern in (
    # 表格的每一列：格數、字（_check_chars、下標、斷行、字距）、答案欄與題目欄裡畫的東西
    r'第 \d+ 頁第 \d+ 列',
    # 題目層級（parse_rows）
    r'第 \d+ 頁：(題號是「|題號 \d+，應為 \d+（|表頭出現在頁中|續列之前沒有任何題目：|題目之間出現沒有答案與題號的列)',
    r'第 \d+ 頁的表頭不是「答案｜題目」：',
    r'第 \d+ 頁第 \d+ 題：答案欄是「',
    r'第 \d+ 題：(選項是 |沒有題幹。|選項 \(.\) 是空的。|同一行有兩個選項標記：)',
    r'第 \d+(、\d+)* 題的題目欄裡有圖片或圖形 ——',
    r'沒有任何題目。$',
    r'整份 PDF 找不到選項標記「\(」',
    # 畫出頁面之後才看得出來的：字級、對比、描邊、浮水印、剪裁、漸層、蓋在字上的圖、擷取不到的字與圖、畫頁面時才重建的 xref
    r'第 \d+ 頁有字級 [\d.]+pt 的字「',
    r'第 \d+ 頁有看不清楚的字「',
    r'第 \d+ 頁的字「.+」（x=[^）]*）(描了與填色不同顏色的邊|壓在浮水印上)',
    r'第 \d+ 頁的字「.+」描邊在頁面上寬 ',
    r'第 \d+ 頁表格外的字「.+」（x=[^）]*）(蓋到表格|在 PyMuPDF 畫出的頁面上找不到)',
    r'第 \d+ 頁的浮水印不是 Word 的寫法：',
    r'第 \d+ 頁有範圍無法判斷的漸層（',
    r'第 \d+ 頁有不是矩形的剪裁路徑（',
    r'第 \d+ 頁的(填色的圖形|線段|圖片|圖片遮罩|漸層)（x=[^）]*）畫在字「',
    r'第 \d+ 頁的表格裡有不屬於任何一列的字「',
    r'第 \d+ 頁有不在任何題目欄裡的圖片（',
    r'第 \d+ 頁畫出了擷取不到的(字「|圖（)',
    r'PDF 的 xref 表壞了，PyMuPDF 畫頁面時才自己重建 ——',
))
_EXTRACT = extract  # ipas_exam_pdf.extract 本身：測試執行時，這個檔案的 extract 是 _extract_and_compare


def _extract_only(message: str) -> bool:
    return any(pattern.match(message) for pattern in EXTRACT_ONLY)


def _check_the_refusal(pdf_path, message: str, after_the_table: bool) -> None:
    if after_the_table:
        assert _extract_only(message), f'表格以後的檢查沒有列在 EXTRACT_ONLY：{message}'
        return
    assert not _extract_only(message), f'EXTRACT_ONLY 寫得太寬，蓋到表格之前的檢查：{message}'
    try:
        header(pdf_path)
    except ValueError as error:
        assert str(error) == message, f'header() 拒絕的訊息不同：extract()「{message}」，header()「{error}」'
    else:
        raise AssertionError(f'extract() 在表格之前拒絕，header() 卻讀得出頁首：{message}')


def _extract_and_compare(pdf_path, *args, **kwargs):
    """extract()；拒絕時看它是在表格之前還是之後拒絕的（見 EXTRACT_ONLY）。"""
    passed = []  # rows_of() 呼叫的 _outside_table() 回傳了：表格之前的檢查都過了
    outside_table = ipas_exam_pdf._outside_table

    def recorded(pages):
        result = outside_table(pages)
        passed.append(True)
        return result

    try:
        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(ipas_exam_pdf, '_outside_table', recorded)
            return _EXTRACT(pdf_path, *args, **kwargs)
    except ValueError as refused:
        _check_the_refusal(pdf_path, str(refused), bool(passed))
        raise


@pytest.fixture(autouse=True)
def _every_refusal_is_checked_against_the_header():
    # 自己的 MonkeyPatch：測試裡的 monkeypatch.undo() 不會連它一起拿掉
    with pytest.MonkeyPatch.context() as patch:
        patch.setitem(globals(), 'extract', _extract_and_compare)
        yield


def test_every_refusal_of_the_extraction_is_checked_against_the_header(tmp_path, monkeypatch):
    # _extract_and_compare 真的會轉紅：header() 讀得出頁首、拒絕的訊息不同、EXTRACT_ONLY 蓋到表格之前的檢查、
    # 清單漏了表格以後的檢查
    (tmp_path / 'before').mkdir()
    (tmp_path / 'after').mkdir()
    annotated = _two_page_exam(tmp_path / 'before', page_options=_in_q1(
        lambda page: page.add_text_annot((300, 160), 'C')))
    no_marker = _exam(tmp_path / 'after', [[('header',), ('A', '1.', [_line('題幹？'), _line('A.甲')])],
                                          [('header',)]])
    with pytest.raises(ValueError, match='^第 1 頁有 PDF 註解'):  # _pages()：header() 以同樣的訊息拒絕
        extract(annotated)
    with pytest.raises(ValueError, match='^整份 PDF 找不到選項標記'):  # 表格以後：清單上有
        extract(no_marker)

    def refuse(path):
        raise ValueError('另一個訊息')

    for name, value, path, complaint in (
            ('header', lambda path: None, annotated, '卻讀得出頁首'),
            ('header', refuse, annotated, '訊息不同'),
            ('EXTRACT_ONLY', (*EXTRACT_ONLY, re.compile('第 1 頁有 PDF 註解')), annotated, '寫得太寬'),
            ('EXTRACT_ONLY', tuple(p for p in EXTRACT_ONLY if not p.match('整份 PDF 找不到選項標記「(」')),
             no_marker, '沒有列在 EXTRACT_ONLY')):
        monkeypatch.setitem(globals(), name, value)
        with pytest.raises(AssertionError, match=complaint):
            extract(path)
        monkeypatch.undo()


# header() 在表格之前拒絕的樣本：每一個階段至少一種（兩個工具的端對端測試也拿它們跑，test_official_exam_import）
HEADER_REFUSALS = {
    'rebuilt-xref': lambda tmp_path: _xref_with_two_spaces(_two_page_exam(tmp_path)),
    'annotation': lambda tmp_path: _two_page_exam(tmp_path, page_options=_in_q1(
        lambda page: page.add_text_annot((300, 160), 'C'))),
    'transfer-function': lambda tmp_path: _two_page_exam(tmp_path, page_options=_in_q1(
        _graphics_state(f'/TR {WHITE_TRANSFER}'))),
    'type3-in-the-page': lambda tmp_path: _two_page_exam(tmp_path, page_options=_in_q1(_type3_font)),
    'resources-not-a-dictionary': _resources_not_a_dictionary,
    'type3-elsewhere': lambda tmp_path: _two_page_exam(tmp_path, page_options={2: {'extras': [_stray_type3]}}),
    'indirect-subtype': lambda tmp_path: _two_page_exam(tmp_path, page_options={2: {'extras': [
        _indirect_subtype_last]}}),
    'font-word-does-not-write': lambda tmp_path: _exam(tmp_path, [_q3_with_a_gap(), PAGE2],
                                                      {1: {'extras': [_space_as_bu_without_embedding]}}),
    'own-resources-null': _page_resources_null,
    'two-tables': lambda tmp_path: _two_page_exam(tmp_path, page_options={2: {'extras': [_second_table]}}),
    'page-out-of-order': lambda tmp_path: _two_page_exam(tmp_path, page_options={2: {'footer': '第 1 頁，共 {m} 頁'}}),
    'odd-character-outside-the-table': lambda tmp_path: _two_page_exam(tmp_path, page_options={1: {'extras': [
        _mapped_glyph(0x001F, at=(60 + 12 * len(SUBJECT) + 1, 30 + 16))]}}),
    'text-in-the-margin': lambda tmp_path: _two_page_exam(tmp_path, page_options=_in_q1(
        lambda page: page.insert_text((26, 300), '更', fontname='china-t', fontsize=12))),
    'unknown-subject': lambda tmp_path: _two_page_exam(tmp_path, page_options=_both_pages(subject='第三科：淨零碳管理實務')),
    'pages-listed-differently': lambda tmp_path: _rewritten(tmp_path, _hidden_third_page(tmp_path)),
    'objects-word-does-not-write': lambda tmp_path: _rewritten(tmp_path, _duplicate_font_name(tmp_path)),  # _opened
}


@pytest.mark.parametrize('make', HEADER_REFUSALS.values(), ids=HEADER_REFUSALS.keys())
def test_the_header_is_refused_by_every_check_extract_runs_first(tmp_path, make):
    # header() 跑的是 extract() 同一組整份與每一頁的檢查（_pages）與表格外的檢查（_outside_table）：
    # 拒絕的訊息逐字相同
    path = make(tmp_path)
    with pytest.raises(ValueError) as refused:
        extract(path)
    with pytest.raises(ValueError, match=f'^{re.escape(str(refused.value))}$'):
        header(path)


def test_the_header_and_the_extraction_run_the_same_checks(tmp_path, monkeypatch):
    # header() 不另寫一份檢查：與 extract() 走同一個 _unreadable、_opened（開檔之前查物件的寫法）、_pages、
    # _outside_table（照這個順序），所以 extract() 在這幾個地方拒絕的，header() 一定以同樣的訊息拒絕（確認審查建議的
    # 結構性測試：逐條補案例補不完）。參數的個數與關鍵字也要相同：header() 多傳一個旗標關掉其中一項檢查，名稱與順序
    # 照樣對得上（第八輪確認審查實測：17 個這樣的變種有 12 個測試全過）
    import ipas_exam_pdf

    exam = _two_page_exam(tmp_path)
    for run in (header, extract):
        calls = []
        for name in ('_unreadable', '_opened', '_pages', '_outside_table'):
            real = getattr(ipas_exam_pdf, name)
            monkeypatch.setattr(ipas_exam_pdf, name, lambda *args, name=name, real=real, **kwargs: calls.append(
                (name, len(args), sorted(kwargs))) or real(*args, **kwargs))
        run(exam)
        monkeypatch.undo()
        assert calls == [('_unreadable', 0, []), ('_opened', 1, []), ('_pages', 2, []), ('_outside_table', 1, [])], \
            run.__name__


def test_the_header_is_nothing_but_the_checks_extract_runs_first():
    # header() 就只是 rows_of() 開頭那一串共用的呼叫。上面的測試只在一份會通過的卷子上看呼叫，看不到：header() 在本體
    # 裡接住某一種拒絕（try/except）再自己讀頁首（第九輪確認審查實測 8 種）；本體不動、讓那幾個名字指到別處 —— 簽名的
    # 預設值、包在工廠函式裡、事後換掉 __code__（第十輪確認審查實測 5 種）；裝飾器與事後包一層（functools.wraps 讓
    # inspect 讀到的仍是原本的原始碼）；偽裝成函式的物件、換掉的命名空間（第十一輪確認審查實測 4 種）；只換掉 code 的
    # 例外表、連 extract 一起換掉（第十二輪確認審查實測 3 種）；函式自己的 __builtins__、依呼叫者比對的鍵（第十三輪確認
    # 審查實測 4 種）；換掉模組的類別，只交給兩個工具另一個 header（同一個思路再往下一層，1 種）。所以這條測試守的是：
    # header() 是一個普通的函式，照一般的名稱解析（這個模組本身的 globals、Python 的 builtins，鍵都是真的 str）執行這段
    # 原始碼，工具從模組拿到的也就是它 —— 型別與命名空間對照不會一起被換掉的東西（這裡現寫的函式、rows_of 的 globals、
    # builtins 模組、ModuleType），本體、簽名與實際執行的整個 code 物件也都釘住。要改 header() 就要改這裡，並說明它為
    # 什麼還是與 extract() 拒絕同樣的東西。這裡釘的是測試執行當下的狀態：header() 以外的程式在別的時候改掉它（import 的
    # hook、背景執行緒）、執行時從外面插手（sys.settrace、sys.monitoring、audit hook、用 ctypes 改寫記憶體），或讓共用
    # 的函式依呼叫者改變行為，一樣能讓 extract() 做別的事，這條測試看不到，交給 code review。行為那一側：這個檔案裡
    # 每一次 extract() 拒絕都拿 header() 比對（EXTRACT_ONLY）
    import __future__
    import ast
    import builtins
    import inspect
    import textwrap
    import types

    import ipas_exam_pdf

    extract = ipas_exam_pdf.extract  # 模組的 extract 本身（這個檔案的 extract 在測試時是 _extract_and_compare）
    assert type(header) is type(extract) is type(lambda: None)  # 真的函式：isinstance() 與 inspect 照 __class__ 回答
    assert header.__globals__ is extract.__globals__ is ipas_exam_pdf.rows_of.__globals__  # 與 rows_of 同一個命名空間
    assert type(header.__globals__) is dict  # dict 的子類別：LOAD_GLOBAL 會走它的 __getitem__，名字就指到別處
    # globals 找不到的名字，LOAD_GLOBAL 查函式建立當下記下的 __builtins__：只替 header 塞一份就指到別處
    assert header.__builtins__ is extract.__builtins__ is ipas_exam_pdf.rows_of.__builtins__ is vars(builtins)
    # str 的子類別當鍵（雜湊相同、比對時依呼叫者回答）：同一個 dict 裡，header 查到的是另一份
    assert all(type(key) is str for namespace in (header.__globals__, header.__builtins__) for key in namespace)
    # 兩個工具讀的是 ipas_exam_pdf.header：模組的類別換成自訂的 __getattribute__，就能依呼叫者交出另一個函式
    assert type(ipas_exam_pdf) is types.ModuleType and ipas_exam_pdf.header is header
    assert not hasattr(header, '__wrapped__') and header.__qualname__ == 'header' and header.__closure__ is None
    assert header.__defaults__ is None and header.__kwdefaults__ is None and header.__globals__ is vars(ipas_exam_pdf)
    source = textwrap.dedent(inspect.getsource(header))
    function = ast.parse(source).body[0]
    assert function.name == 'header' and not function.decorator_list and ast.unparse(function.args) == 'pdf_path: Path'
    body = function.body
    docstring = [node for node in body[:1] if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)]
    assert [ast.unparse(node) for node in body[len(docstring):]] == [
        'with _unreadable(), _opened(pdf_path) as (pdf, rendered):\n    return _outside_table(_pages(pdf, rendered))']
    # 執行的就是這段原始碼：照模組的 future 旗標（ipas_exam_pdf 開頭有 from __future__ import annotations）重新編譯，
    # 整個 code 物件相同 —— bytecode、常數、名稱、例外表（只換例外表，開檔的錯就繞過 _unreadable）……
    compiled = next(const for const in compile(source, '<header>', 'exec', dont_inherit=True,
                                               flags=__future__.annotations.compiler_flag).co_consts
                    if inspect.iscode(const) and const.co_name == 'header')  # 3.14 起第一個是 __annotate__
    assert header.__code__ == compiled.replace(co_firstlineno=header.__code__.co_firstlineno)
    # 測試 import 到的就是 tools/ 裡的那個檔案：pytest 把 tools/tests/ 排在 tools/ 前面，在那裡放一份同名的副本，測試
    # 驗的就是副本，工具跑的卻是 tools/ 裡改過的那一份；另一個檔案編譯、只在 pytest 底下換上的 header() 也有它自己的
    # 檔案（第二十四輪確認審查實測；同一個檔案裡再定義一次的是模組層級的程式，交給 code review）。模組自己報的
    # __file__ 可以偽造，所以也問 import 系統照 sys.path 會找到哪個檔案（第二十五輪確認審查實測）。與兩個工具那一側的
    # 身分測試同樣的條件。只在測試行程裡改寫 import 機制的（預先放進 sys.modules、path hook、.pth）這裡看不到，由
    # test_official_exam_import.py 的 test_the_tools_on_disk_stop_where_the_tested_ones_do 在另一個不跑 site 的 Python
    # 裡跑 tools/ 的檔案（第二十六、二十七輪確認審查實測）
    import importlib.machinery
    import sys
    from pathlib import Path
    tools = Path(__file__).resolve().parents[1]
    own = tools / 'ipas_exam_pdf.py'
    assert Path(ipas_exam_pdf.__file__).resolve() == Path(header.__code__.co_filename).resolve() == own
    assert Path(importlib.machinery.PathFinder.find_spec('ipas_exam_pdf', sys.path).origin).resolve() == own


def test_the_header_turns_what_pdfminer_cannot_read_into_a_value_error(tmp_path, monkeypatch):
    # header() 與 extract() 一樣只丟 ValueError（_unreadable）
    exam = _two_page_exam(tmp_path)
    monkeypatch.setattr(pdfplumber.page.Page, 'find_tables', lambda self, *args, **kwargs: (_ for _ in ()).throw(
        PdfminerException(TypeError('boom'))))
    with pytest.raises(ValueError, match='^pdfminer 讀不了這份 PDF'):
        header(exam)


def test_text_beside_a_narrower_row_stops_the_extraction(tmp_path):
    # 某一列比表格窄（右緣在 500），右邊那一條不屬於任何儲存格：寫在那裡的字以前會被安靜地丟掉
    rows = [('header',), ('narrow', 'A', '1.', [_line('題幹？ '), *_options()]), ('B', '2.', [_line('題幹？ '), *_options()])]
    note = lambda page: page.insert_text((510, 170), '送分', fontname='china-t', fontsize=12)
    with pytest.raises(ValueError, match='不屬於任何一列的字「送」'):
        extract(_exam(tmp_path, [rows, [('header',)]], {1: {'extras': [note]}}))


def _split_question_cell(page):
    """第 1 題的題目欄被一條直線切成兩格，右邊那格寫「本題送分」。"""
    top, bottom = TOP + 24, TOP + 24 + 160
    _fill(page, 469.75, top, 470.25, bottom)
    page.insert_text((475, top + 60), '本題送分', fontname='china-t', fontsize=12)


def _extra_column(page):
    """表格多一欄（從表頭一路往下，表頭那格是空的），第 1 題那一格寫「送分」。"""
    _fill(page, 499.75, TOP, 500.25, TOP + 24 + 160 + 120)
    page.insert_text((505, TOP + 24 + 20), '送分', fontname='china-t', fontsize=12)


@pytest.mark.parametrize('draw', [_split_question_cell, _extra_column], ids=['split-question-cell', 'extra-column'])
def test_a_row_with_more_than_two_cells_stops_the_extraction(tmp_path, draw):
    # 多出來的格裡的字以前會安靜地併進題目（「第一題的題幹？ 本題送分」）；表頭的 4 格（灰底）照常
    with pytest.raises(ValueError, match=r'^第 1 頁第 2 列（題號 1\.）有 3 格'):
        extract(_two_page_exam(tmp_path, page_options=_in_q1(draw)))


def test_a_repeated_header_in_the_middle_of_a_page_stops_the_extraction(tmp_path):
    # 頁中又一個表頭、後面接沒有答案與題號的列：以前會被當成換頁的續列，併成「丁（以下為題組）」
    page1 = [('header',), ('A', '1.', [_line('第一題？ '), *_options()]), ('header',), ('', '', [_line('（以下為題組）')]),
             ('B', '2.', [_line('第二題？ '), *_options()])]
    with pytest.raises(ValueError, match='表頭出現在頁中'):
        extract(_exam(tmp_path, [page1, [('header',)]]))


def test_a_note_row_between_questions_stops_the_extraction(tmp_path):
    # 每頁都以表頭開始；表頭之後已經有題目，再出現沒有答案與題號的列就不是續列
    page1 = [('header',), ('A', '1.', [_line('第一題？ '), *_options()]), ('', '', [_line('（本題送分）')]),
             ('B', '2.', [_line('第二題？ '), *_options()])]
    with pytest.raises(ValueError, match='題目之間出現沒有答案與題號的列'):
        extract(_exam(tmp_path, [page1, [('header',)]]))


def test_a_page_without_the_table_stops_the_extraction(tmp_path):
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), '沒有表格的頁面', fontname='china-t', fontsize=12)
    path = tmp_path / 'no-table.pdf'
    doc.save(path)
    with pytest.raises(ValueError, match='^第 1 頁有 0 張表'):
        extract(path)


def test_a_page_with_two_tables_stops_the_extraction(tmp_path):
    def second_table(page):
        for y in (700, 740):
            _fill(page, 39, y - 0.25, 556, y + 0.25)
        for x in (39, 88, 556):
            _fill(page, x - 0.25, 700, x + 0.25, 740)
    with pytest.raises(ValueError, match='2 張表'):
        extract(_two_page_exam(tmp_path, page_options={2: {'extras': [second_table]}}))


def test_a_row_without_the_answer_column_stops_the_extraction(tmp_path):
    with pytest.raises(ValueError, match='只有 1 格'):
        extract(_two_page_exam(tmp_path, page2_extra_rows=[('merged', [_line('整列只有一格')])]))


def test_a_pdf_without_any_option_marker_stops_the_extraction(tmp_path):
    rows = [('header',), ('A', '1.', [_line('題幹？'), _line('A.甲'), _line('B.乙')])]
    with pytest.raises(ValueError, match='找不到選項標記'):
        extract(_exam(tmp_path, [rows, [('header',)]]))


# ── 第十一輪審查：字形只對自己的紀錄、旋轉看矩陣本身的大小、字型與頁面資源只收 Word 的寫法 ──────────────

def _markers_with_flipped_spaces(page):
    """_markers_one_line_off，再在每個標記字形的起點各畫一個倒過來的 51pt 空白：沒有內嵌的字型，MuPDF 給的墨跡是
    整個字型的外框，倒過來、放大之後中心正好落在往下移一行的字框裡。空白不查字級與方向，以前同一個起點上的字形
    互相作證，標記就借到了空白的墨跡（第十一輪審查實測：擷取的 (B) 是氮氣，三套算繪器畫的 (B) 都是二氧化碳）。"""
    _markers_one_line_off(page)
    ops = b'q '
    for i in range(1, 5):
        for x in (122, 134, 146):  # 標記的三個字形：「(」、字母、「)」
            ops += b'BT /china-t 51 Tf -1 0 0 -1 %d %d Tm <0020> Tj ET ' % (x, 842 - (TOP + 24 + 20 + 20 * i))
    _append_content(page, ops + b'Q')


def test_a_space_at_the_same_origin_cannot_lend_a_glyph_its_ink(tmp_path):
    exam = _exam(tmp_path, [MARKED_ROWS, [('header',)]], {1: {'extras': [_markers_with_flipped_spaces]}})
    with pytest.raises(ValueError, match=r'^第 1 頁第 2 列（題號 1\.）的字「\(」.*找不到'):
        extract(exam)


HIDDEN_BU = {
    'clipped': b'q 0 0 0 0 re W n BT /china-t 12 Tf 0 g 1 0 0 1 170 388 Tm <4E0D> Tj ET Q',
    # float32 下溢：每個數都在上限內，pdfminer（float64）算出 d = 1，MuPDF 與 PDFium（float32）是 0，閱讀器上沒有「不」
    'float32-underflow': (b'q 1 0 0 1 170 388 cm' + b' 1 0 0 .0000000001 0 0 cm' * 5 + b' 1 0 0 100000 0 0 cm' * 10
                          + b' BT /china-t 12 Tf 0 g 1 0 0 1 0 0 Tm <4E0D> Tj ET Q'),
}


@pytest.mark.parametrize('hidden', HIDDEN_BU.values(), ids=HIDDEN_BU.keys())
def test_spaces_at_the_same_origin_cannot_stand_in_for_a_hidden_glyph(tmp_path, hidden):
    # 同一個起點畫兩個空白、中間隔一個畫在頁邊的空白（rawdict 只合併緊接在後、同一位置的相同字，這樣就列兩筆）：
    # 以前起點上 rawdict 的字形與 texttrace 一樣多，看不見的「不」就算畫出來了（第十一輪審查實測）。
    # 閱讀器上是「下列何者　正確？」，擷取是「下列何者不正確？」
    space = b' BT /china-t 12 Tf 0 g 1 0 0 1 170 388 Tm <0020> Tj ET'
    elsewhere = b' BT /F9 12 Tf 0 g 1 0 0 1 30 400 Tm ( ) Tj ET'
    draw = _raw_stream(hidden + space + elsewhere + space, font=True)
    with pytest.raises(ValueError, match='的字「不」.*找不到'):
        extract(_exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [draw]}}))


def test_each_glyph_is_matched_with_its_own_rawdict_record():
    # 字級與墨跡只看同一個字、同一個起點的 rawdict 紀錄：同一個起點上別的字形（空白、別的字）不能替它作證
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((100, 100), 'N', fontname='helv', fontsize=12)
    # K 整個剪掉；同一個起點兩個空白，中間隔一個畫在別處的空白（rawdict 就列兩筆）
    _raw(page, b'q 0 0 0 0 re W n BT /helv 12 Tf 100 700 Td (K) Tj ET Q BT /helv 12 Tf 100 700 Td ( ) Tj ET '
               b'BT /helv 12 Tf 300 300 Td ( ) Tj ET BT /helv 12 Tf 100 700 Td ( ) Tj ET')
    # V 垂直壓成四分之一（兩個方向的縮放是 6）；同一個起點再畫一個正常的 W（縮放 12）
    _raw(page, b'q BT /helv 12 Tf 1 0 0 0.25 100 600 Tm (V) Tj ET Q BT /helv 12 Tf 1 0 0 1 100 600 Tm (W) Tj ET')
    glyphs = _visible_glyphs(page)
    assert 'K' not in glyphs
    (_, _, _, records), = glyphs['V']
    assert [scale for scale, _ in records] == pytest.approx([6.0])


S45 = 0.001 * 0.5 ** 0.5  # 縮小 1000 倍的 cos 45° = sin 45°


@pytest.mark.parametrize(('matrix', 'skewed'), [
    ((1, 0, 0, 1), False),
    ((0.001, 0, 0, 0.001), False),              # 文字矩陣縮小 1000 倍（字級放大 1000 倍）：一樣是正放的
    ((1000, 0, 0, 1000), False),
    ((1, 0.0005, -0.0005, 1), False),           # 0.03 度：看不出來
    ((1, 0.002, -0.002, 1), True),              # 0.11 度
    ((S45, S45, -S45, S45), True),              # 轉 45 度：b、c 只有 0.0007，以前與絕對的 1e-3 比就放過了
    ((0.001, 0, 0.00099, 0.001), True),         # 斜切 45 度
    ((0.001, 0.00099, 0, 0.001), True),         # 垂直斜切 45 度
    ((0.9, 0, 0, 1), False),                    # 水平縮放（Word 的「字元比例」）：正放的
    ((2, 0.0015, 0, 1), False),                 # 寬一倍的字，水平軸轉 0.04 度：b 與 a 比，不是與 d 比
    ((1, 0, 0.0015, 2), False),                 # 高一倍的字，垂直軸斜 0.04 度：c 與 d 比，不是與 a 比
    ((1000, 0, 0.0009, 0.001), True),           # 兩個方向差很多的矩陣：c 與 d 比是 42 度（與 √|ad−bc| 比看不出來）
], ids=['upright', 'tiny-upright', 'huge-upright', 'turned-0.03-degrees', 'turned-0.11-degrees', 'tiny-turned-45',
        'tiny-horizontal-shear', 'tiny-vertical-shear', 'horizontally-scaled', 'wide-turned-0.04-degrees',
        'tall-sheared-0.04-degrees', 'anisotropic-shear'])
def test_rotation_and_shear_are_measured_against_the_size_of_the_matrix(matrix, skewed):
    a, b, c, d = matrix
    char = {'matrix': (a, b, c, d, 0, 0), 'upright': a * d > 0 and b * c <= 0, 'adv': 1.0}  # upright 照 pdfminer 的算法
    assert _skewed(char) is skewed


# 不是 pdfminer 標準 14 種的簡單字型（pdfminer 才照 /Widths 算字寬；寫法照 Word 的 ArialMT）：「+」的字寬是 tan 22.5° em，
# 轉 45 度之後
# pdfminer、texttrace、rawdict 三種字級都相等（第十一輪審查的向量）
TILTED_FONT = ('<</Type/Font/Subtype/TrueType/BaseFont/ArialMT/Encoding/WinAnsiEncoding/FirstChar 43/LastChar 43'
               '/Widths[414]/FontDescriptor<</Type/FontDescriptor/FontName/ArialMT/Flags 32'
               '/FontBBox[-1021 -463 1793 1232]/ItalicAngle 0/Ascent 928/Descent -236/CapHeight 729/StemV 80>>>>')
FORMULA = [('header',), ('A', '1.', [_line('溫室氣體排放量的計算，下列何者正確？ '),
                                      [('(A)排放量＝活動數據', 'china-t', 12, 0), 12, ('排放係數； ', 'china-t', 12, 0)],
                                      _line('(B)排放量＝活動數據－排放係數； '), _line('(C)排放量＝活動數據÷排放係數； '),
                                      _line('(D)排放量＝排放係數－活動數據')])]


def test_a_tiny_text_matrix_cannot_hide_a_rotation(tmp_path):
    # 文字矩陣縮小 1000 倍、字級放大 1000 倍（12000 在數字的上限內）。審查實測：閱讀器上是「活動數據×排放係數」
    # （正確的公式，答案 A），擷取是「活動數據+排放係數」
    x = 122 + pymupdf.get_text_length('(A)排放量＝活動數據', fontname='china-t', fontsize=12) + 6.5  # 12pt 空隙的中間

    def plus(page):
        _add_resource(page, 'Font', 'FR', TILTED_FONT)
        _append_content(page, b'BT /FR 12000 Tf 0 g %.10f %.10f %.10f %.10f %d %d Tm (+) Tj ET'
                        % (S45, S45, -S45, S45, round(x), 842 - (TOP + 24 + 20 + 20)))
    with pytest.raises(ValueError, match=r'^第 1 頁第 2 列（題號 1\.）有旋轉、鏡像或斜切的字「\+」'):
        extract(_exam(tmp_path, [FORMULA, [('header',)]], {1: {'extras': [plus]}}))


def test_an_embedded_font_written_the_way_word_writes_it_is_accepted(tmp_path):
    # Word 的中文字型：內嵌的 TrueType，Type0、Identity-H、一個 CIDFontType2、/CIDToGIDMap /Identity
    bu = lambda page: _embedded_cjk(page, '不', (170, 842 - 388))
    assert extract(_exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [bu]}})) == EXPECTED


def _short_glyph_map(page):
    """第 3 題空隙裡的「不」用內嵌字型畫，/CIDToGIDMap 卻是 2 個位元組的串流：比字碼短，MuPDF 照字碼畫、
    PDFium（Chrome）不畫，pdfminer 根本不看它（第十一輪審查實測：Chrome 上是「下列何者　正確？」）。"""
    _, kid = _embedded_cjk(page, '不', (170, 842 - 388))
    doc = page.parent
    table = doc.get_new_xref()
    doc.update_object(table, '<<>>')
    doc.update_stream(table, b'\x00\x00', new=True)
    doc.xref_set_key(kid, 'CIDToGIDMap', f'{table} 0 R')


@pytest.mark.parametrize('draw', [
    _short_glyph_map,
    lambda page: _embedded_cjk(page, '不', (170, 842 - 388), cid_to_gid=None),  # PyMuPDF 自己的寫法：沒寫
], ids=['short-stream', 'missing'])
def test_a_glyph_map_word_does_not_write_stops_the_extraction(tmp_path, draw):
    with pytest.raises(ValueError, match='^第 1 頁有 Word 不會寫的字型 kai 的 /CIDToGIDMap'):
        extract(_exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [draw]}}))


def _space_as_bu_without_embedding(page):
    """題目用的字型（沒有內嵌）另存一份 /chinau，帶一個 ToUnicode 把空白對到「不」（pdfminer 照 CID 1 查、MuPDF 照
    字碼 <0020> 查，兩個都寫），畫在第 3 題的空隙：閱讀器畫的是空白，沒有內嵌的字型 MuPDF 給的墨跡卻是整個字型的
    外框，以前照樣通過，擷取是「下列何者不正確？」（模組說明以前列為已知限制）。"""
    doc = page.parent
    font = next(xref for xref, _, _, _, name, _ in page.get_fonts() if name == 'china-t')
    copy, cmap = doc.get_new_xref(), doc.get_new_xref()
    doc.update_object(copy, doc.xref_object(font))
    doc.update_object(cmap, '<<>>')
    doc.update_stream(cmap, b'/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName '
                            b'/Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> '
                            b'endcodespacerange 2 beginbfchar <0001> <4E0D> <0020> <4E0D> endbfchar endcmap CMapName '
                            b'currentdict /CMap defineresource pop end end', new=True)
    doc.xref_set_key(copy, 'ToUnicode', f'{cmap} 0 R')
    _add_resource(page, 'Font', 'chinau', f'{copy} 0 R')
    _append_content(page, b'BT /chinau 12 Tf 0 g 1 0 0 1 170 388 Tm <0020> Tj ET')


def test_to_unicode_on_a_font_that_is_not_embedded_stops_the_extraction(tmp_path):
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [_space_as_bu_without_embedding]}})
    with pytest.raises(ValueError, match='^第 1 頁有 Word 不會寫的字型 chinau 的 /ToUnicode'):
        extract(exam)


def _font_file():
    return PDFStream({}, b'')


# 真實卷字型描述的每一個欄位（ArialMT 的值）；Word 內嵌字型的描述另有字型檔
WORD_DESCRIPTOR = {'Type': LIT('FontDescriptor'), 'FontName': LIT('ArialMT'), 'Flags': 32,
                   'FontBBox': [-665, -210, 2000, 728], 'ItalicAngle': 0, 'Ascent': 905, 'Descent': -210,
                   'CapHeight': 716, 'AvgWidth': 441, 'MaxWidth': 2665, 'FontWeight': 400, 'XHeight': 250,
                   'Leading': 33, 'StemV': 44}


def _type0(encoding='Identity-H', kid='CIDFontType2', cid_to_gid='Identity', files=('FontFile2',), to_unicode=True,
           kids=1, csi=(b'Adobe', b'Identity', 0), dw=1000, w=()):
    """pdfminer 讀到的 Type0 字型字典。預設是 Word 的寫法；None 表示不寫那一項。"""
    descendant = {'Subtype': LIT(kid), 'FontDescriptor': {**WORD_DESCRIPTOR, **{key: _font_file() for key in files}}}
    if cid_to_gid is not None:
        descendant['CIDToGIDMap'] = LIT(cid_to_gid) if isinstance(cid_to_gid, str) else cid_to_gid
    if csi is not None:
        descendant['CIDSystemInfo'] = dict(zip(('Registry', 'Ordering', 'Supplement'), csi))
    if dw is not None:
        descendant['DW'] = dw
    if w is not None:
        descendant['W'] = list(w) if isinstance(w, tuple) else w
    font = {'Subtype': LIT('Type0'), 'DescendantFonts': [descendant] * kids}
    if encoding is not None:
        font['Encoding'] = LIT(encoding) if isinstance(encoding, str) else encoding
    if to_unicode:
        font['ToUnicode'] = _font_file()
    return font


def _simple(subtype='TrueType', encoding='WinAnsiEncoding', files=(), to_unicode=False, base='ArialMT', flags=32):
    """pdfminer 讀到的簡單字型字典。預設是 Word 沒有內嵌的 Arial；None 表示不寫那一項。"""
    descriptor = {**WORD_DESCRIPTOR, **{key: _font_file() for key in files}}
    if flags is None:
        del descriptor['Flags']
    else:
        descriptor['Flags'] = flags
    font = {'Subtype': LIT(subtype), 'FontDescriptor': descriptor}
    if base is not None:
        font['BaseFont'] = LIT(base)
    if encoding is not None:
        font['Encoding'] = LIT(encoding) if isinstance(encoding, str) else encoding
    if to_unicode:
        font['ToUnicode'] = _font_file()
    return font


# PyMuPDF 內建字型的寫法（合成卷用它）：沒有內嵌的中文 Type0（字碼就是 Unicode）、標準 14 種的 Type1
PYMUPDF_CHINA = {'Subtype': LIT('Type0'), 'BaseFont': LIT('Fangti'), 'Encoding': LIT('UniCNS-UTF16-H'),
                 'DescendantFonts': [{'Subtype': LIT('CIDFontType0'), 'BaseFont': LIT('Fangti'),
                                      'FontDescriptor': {'Flags': 4},
                                      'CIDSystemInfo': {'Registry': b'Adobe', 'Ordering': b'CNS1', 'Supplement': 7}}]}
PYMUPDF_HELV = {'Subtype': LIT('Type1'), 'BaseFont': LIT('Helvetica'), 'Encoding': LIT('WinAnsiEncoding')}


def _china(**kid):
    """PYMUPDF_CHINA 的 CIDFont 換掉幾項（值是 None 就拿掉那一項）。"""
    descendant = {**PYMUPDF_CHINA['DescendantFonts'][0], **kid}
    return {**PYMUPDF_CHINA, 'DescendantFonts': [{k: v for k, v in descendant.items() if v is not None}]}


@pytest.mark.parametrize('font', [
    _type0(), _simple(), _simple(base='TimesNewRomanPSMT'), _simple(base='TimesNewRomanPS-BoldMT'),
    _simple(base='BCDFEE+DFKaiShu-SB-Estd-BF', files=('FontFile2',)), _type0(dw=None, w=None), PYMUPDF_CHINA,
    PYMUPDF_HELV, {**PYMUPDF_HELV, 'BaseFont': LIT('Courier')},
], ids=['word-type0', 'word-arial', 'word-times', 'word-times-bold', 'word-embedded-kaishu', 'type0-default-widths',
        'pymupdf-china-t', 'pymupdf-helv', 'pymupdf-cour'])
def test_fonts_written_the_way_word_writes_them_are_accepted(font):
    # 8 份真實卷的字型全是前五種的寫法（/DW、/W 可以不寫）；後三種是 PyMuPDF 內建字型的寫法，沒有內嵌、照字碼換字型
    assert _font_problem(font) is None


@pytest.mark.parametrize(('font', 'problem'), [
    (_type0(cid_to_gid=None), '/CIDToGIDMap'),                           # PyMuPDF 內嵌字型的寫法
    (_type0(cid_to_gid=_font_file()), '/CIDToGIDMap'),                    # 對照表是串流：短的 PDFium 不畫
    (_type0(kid='CIDFontType0', files=('FontFile3',), cid_to_gid=None), '/DescendantFonts'),  # PyMuPDF 內嵌的 CFF
    (_type0(kid='CIDFontType0'), '/DescendantFonts'),                     # CIDFontType0 配 TrueType 的字型檔
    (_type0(files=('FontFile3',)), '/DescendantFonts'),
    (_type0(files=('FontFile2', 'FontFile3')), '/DescendantFonts'),
    (_type0(encoding='Identity-V'), '/Encoding'),                         # 直書
    (_type0(encoding=_font_file()), '/Encoding'),                         # 內嵌的 CMap：各家各自解析
    (_type0(encoding=None), '/Encoding'),
    (_type0(kids=2), '/DescendantFonts'),
    (_type0(kids=0), '/DescendantFonts'),
    ({**PYMUPDF_CHINA, 'DescendantFonts': [{'Subtype': LIT('Type1')}]}, '/DescendantFonts'),
    ({**PYMUPDF_CHINA, 'ToUnicode': _font_file()}, '/ToUnicode'),         # 沒內嵌：空白的字碼能對到「不」
    (_type0(files=(), cid_to_gid=None, to_unicode=False), '/Encoding'),   # 沒內嵌的 Identity-H：字碼對不到字
    ({**PYMUPDF_CHINA, 'Encoding': LIT('UniCNS-UTF16-V')}, '/Encoding'),
    (_china(CIDToGIDMap=LIT('Identity')), '/CIDToGIDMap'),
    (_simple(to_unicode=True), '/ToUnicode'),
    (_simple(files=('FontFile2',), to_unicode=True), '/ToUnicode'),        # Word 內嵌的簡單字型也不帶
    ({**PYMUPDF_HELV, 'ToUnicode': _font_file()}, '/ToUnicode'),
    (_simple(encoding={'BaseEncoding': LIT('WinAnsiEncoding'), 'Differences': [81, LIT('C')]}), '/Encoding'),
    (_simple(encoding='MacRomanEncoding'), '/Encoding'),
    (_simple(encoding=None), '/Encoding'),
    (_simple(files=('FontFile3',)), '/FontFile3'),
    (_simple(subtype='Type1', files=('FontFile',)), '/FontFile'),
    (_simple(subtype='Type1', files=('FontFile2',)), '/FontFile2'),       # Type1 配 TrueType 的字型檔
    (_simple(subtype='MMType1'), '/Subtype'),
    ({**_simple(), 'Subtype': LIT('CIDFontType2')}, '/Subtype'),
    # 第十二輪審查：CIDSystemInfo、ToUnicode 的寫法，符號字型，以及 mutation 找到的缺口
    (_type0(to_unicode=False), '/ToUnicode'),                            # 抽出來的字改由字集表決定，畫的是字形編號
    ({**_type0(), 'ToUnicode': LIT('Identity-H')}, '/ToUnicode'),          # 名稱不是對照表：字碼當成 Unicode
    (_type0(csi=None), '/CIDSystemInfo'),
    (_type0(csi=(b'Adobe', b'CNS1', 0)), '/CIDSystemInfo'),
    (_type0(csi=(b'Adobe', b'Identity', 1)), '/CIDSystemInfo'),
    (_type0(csi=(b'Adobe', LIT('Identity'), 0)), '/CIDSystemInfo'),       # 名稱不是字串：pdfminer 讀不了
    (_type0(csi=(7, b'Identity', 0)), '/CIDSystemInfo'),
    (_type0(csi=(b'Adobe', b'Identity', b'0')), '/CIDSystemInfo'),
    (_type0(dw=LIT('Big')), '/DW'),                                        # pdfminer 算字寬時出錯
    (_type0(w=LIT('W')), '/W'),
    (_china(CIDSystemInfo={'Registry': b'Adobe', 'Ordering': b'Japan1', 'Supplement': 6}), '/CIDSystemInfo'),
    (_china(CIDSystemInfo=None), '/CIDSystemInfo'),
    (_china(CIDSystemInfo={'Registry': b'Adobe', 'Ordering': b'CNS1', 'Supplement': LIT('7')}), '/CIDSystemInfo'),
    (_china(Subtype=LIT('CIDFontType2')), '/DescendantFonts'),
    (_china(CIDSystemInfo={'Registry': b'Other', 'Ordering': b'CNS1', 'Supplement': 7}), '/CIDSystemInfo'),
    ({**PYMUPDF_CHINA, 'Encoding': LIT('UniGB-UTF16-H')}, '/Encoding'),
    ({**_type0(), 'DescendantFonts': _type0()['DescendantFonts'][0]}, '/DescendantFonts'),  # 字典不是陣列
    (_simple(encoding='StandardEncoding'), '/Encoding'),
    (_simple(base='ZapfDingbats'), '/BaseFont'),                           # 符號字型照自己的編碼畫：C 畫成星形符號
    (_simple(base='SymbolMT'), '/BaseFont'),
    (_simple(base='Symbol,Bold'), '/BaseFont'),
    (_simple(base='Dingbats'), '/BaseFont'),
    (_simple(base='Wingdings-Regular'), '/BaseFont'),
    (_simple(base='ABCDEF+ZapfDingbats', files=('FontFile2',)), '/BaseFont'),
    ({**PYMUPDF_HELV, 'BaseFont': LIT('ZapfDingbats')}, '/BaseFont'),
    (_simple(base='ArialMTABCDEF+'), '/BaseFont'),                         # 子集字型的前綴只在最前面
    (_simple(base='Symbol+ArialMT'), '/BaseFont'),                         # 前綴是六個大寫字母
    ({**_simple(), 'FontDescriptor': 7}, '/FontDescriptor'),
    (_simple(base=None), '/BaseFont'),
    (_simple(flags=4), '/FontDescriptor'),                                 # symbolic
    (_simple(flags=36), '/FontDescriptor'),
    (_simple(flags=None), '/FontDescriptor'),
    ({**PYMUPDF_HELV, 'FontDescriptor': {'Flags': 4}}, '/FontDescriptor'),
    # 第十三輪審查：字型描述只收 Word 會寫的欄位（/FontFamily (Symbol) 讓 Poppler 換成符號字型，答案 C 畫成空白）
    ({**_simple(), 'FontDescriptor': {'Flags': 32, 'FontFamily': b'Symbol'}}, '/FontDescriptor'),
    ({**_simple(), 'FontDescriptor': {'Flags': 32, 'MissingWidth': 0}}, '/FontDescriptor'),
    (_china(FontDescriptor={'Flags': 4, 'FontFamily': b'Symbol'}), '/FontDescriptor'),
    ({**_simple(), 'BaseFont': LIT(b'Arial\xffMT')}, '/BaseFont'),          # 不是 UTF-8：pdfminer 給的名稱是 bytes
    # 第十四輪審查：沒有內嵌的 Type0，閱讀器照名稱換字型（CIDFont 叫 ZapfDingbats 時 PDFium 把「不」畫成空白）
    (_china(BaseFont=LIT('ZapfDingbats')), '/BaseFont'),
    (_china(BaseFont=LIT('SymbolMT')), '/BaseFont'),
    (_china(BaseFont=None), '/BaseFont'),
    ({**PYMUPDF_CHINA, 'BaseFont': LIT('Symbol')}, '/BaseFont'),
    ({key: value for key, value in PYMUPDF_CHINA.items() if key != 'BaseFont'}, '/BaseFont'),
], ids=['type0-without-glyph-map', 'type0-glyph-map-stream', 'embedded-cff', 'cidfonttype0-with-truetype-file',
        'type0-fontfile3', 'type0-two-font-files',
        'vertical-cmap', 'embedded-cmap', 'type0-without-encoding', 'two-descendants', 'no-descendant',
        'descendant-not-a-cidfont', 'to-unicode-not-embedded', 'identity-h-not-embedded', 'vertical-unicode-cmap',
        'glyph-map-not-embedded', 'truetype-to-unicode', 'embedded-truetype-to-unicode', 'type1-to-unicode',
        'differences', 'mac-roman', 'no-encoding', 'truetype-fontfile3', 'embedded-type1', 'type1-with-truetype-file',
        'multiple-master', 'descendant-as-a-font',
        'embedded-without-to-unicode', 'to-unicode-as-a-name', 'no-system-info', 'embedded-cns1-ordering',
        'identity-supplement-1', 'ordering-as-a-name', 'registry-as-a-number', 'supplement-as-a-string', 'dw-as-a-name',
        'w-as-a-name', 'japan1-ordering', 'china-without-system-info', 'china-supplement-as-a-name',
        'china-cidfonttype2', 'china-other-registry', 'gb-unicode-cmap', 'descendants-as-a-dictionary',
        'standard-encoding', 'zapf-dingbats',
        'symbol-mt', 'symbol-bold', 'dingbats', 'wingdings', 'embedded-zapf-dingbats', 'type1-zapf-dingbats',
        'subset-tag-not-at-the-start', 'odd-subset-tag', 'descriptor-not-a-dictionary', 'no-base-font',
        'symbolic-flags', 'symbolic-and-nonsymbolic-flags', 'no-flags', 'type1-symbolic-descriptor', 'font-family',
        'missing-width', 'china-font-family', 'base-font-not-utf8', 'china-cid-zapf-dingbats', 'china-cid-symbol-mt',
        'china-cid-without-a-name', 'china-symbol', 'china-without-a-name'])
def test_fonts_word_does_not_write_are_refused(font, problem):
    assert (_font_problem(font) or '').startswith(problem)


def _one_page(tmp_path, page, parent=b'', extra=()):
    """一頁的最小 PDF：page 是頁面字典裡 /Resources 那一段（空的就是沒寫），parent 是上層 /Pages 節點另外加的。"""
    content = b'BT /F1 24 Tf 1 0 0 1 100 700 Tm (A) Tj ET'
    path = tmp_path / 'one-page.pdf'
    path.write_bytes(_minimal_pdf([
        b'<</Type/Catalog/Pages 2 0 R>>',
        b'<</Type/Pages/Kids[3 0 R]/Count 1' + parent + b'>>',
        b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]' + page + b'/Contents 4 0 R>>',
        b'<</Length %d>>\nstream\n' % len(content) + content + b'\nendstream',
        HELVETICA_FONT, b'<</Font<</F1 5 0 R>>>>', *extra], root=1))
    return path


@pytest.mark.parametrize(('page', 'parent', 'accepted'), [
    (b'/Resources<</Font<</F1 5 0 R>>>>', b'', True),                         # 真實卷：頁面自己的字典
    (b'/Resources 6 0 R', b'', True),                                          # 合成卷：間接參照到字典
    (b'/Resources null', b'/Resources 6 0 R', False),     # pdfminer 丟掉 null 的鍵、沿用上層的；PDFium 當成沒有資源
    (b'', b'/Resources 6 0 R', False),                                         # 沒寫：沿用上層節點的
    (b'/Resources 99 0 R', b'/Resources 6 0 R', False),                        # 指向不存在的物件
    (b'/Resources[]', b'/Resources 6 0 R', False),
    (b'/Resources<</Font[]>>', b'', False),                                    # 字型表不是字典
    (b'/Resources<</ExtGState 7>>', b'', False),                              # 圖形狀態表不是字典
    (b'/Resources<</ExtGState<</GS0 7>>>>', b'', False),                     # 圖形狀態不是字典
    (b'/Resources<</Font<</F1 7>>>>', b'', False),                            # 字型不是字典
], ids=['own-dictionary', 'own-indirect-dictionary', 'null', 'inherited', 'missing-object', 'array', 'fonts-not-a-dict',
        'states-not-a-dict', 'state-not-a-dict', 'font-not-a-dict'])
def test_a_page_must_carry_its_own_resource_dictionary(tmp_path, page, parent, accepted):
    # 沿用上層節點的資源時，pdfminer 順著 /Kids 找、閱讀器順著 /Parent 找，寫成 null 時 PDFium 又當成沒有（審查實測：
    # PDFium 整頁中文變亂碼）。8 份真實卷 102 頁都是頁面自己的字典
    with pdfplumber.open(_one_page(tmp_path, page, parent)) as pdf:
        assert (_resources(pdf.pages[0]) == []) is accepted


def _drop_key(doc, xref, key):
    """把字典裡的一個鍵真的拿掉：xref_set_key(..., 'null') 寫出來的是「/鍵 null」（pdfminer 才把它當成沒有），值是
    null 的鍵在物件那一層就擋下了（第二十九輪審查：PDFium 把 /ca null 讀成 0）。"""
    doc.xref_set_key(xref, key, 'null')
    text = doc.xref_object(xref, compressed=True)
    assert len(re.findall(rf'/{key}\s*null', text)) == 1, text
    doc.update_object(xref, re.sub(rf'/{key}\s*null', '', text))


def _null_resources(path):
    """把第 1 頁的 /Resources 搬到根 /Pages，頁面自己改寫成同樣長度的 /Resources null（第十一輪審查的向量）。"""
    doc = pymupdf.open(path)
    root = int(doc.xref_get_key(doc.pdf_catalog(), 'Pages')[1].split()[0])
    reference = doc.xref_get_key(doc[0].xref, 'Resources')[1]
    doc.xref_set_key(root, 'Resources', reference)
    page = doc[0].xref
    data = doc.tobytes()
    start = data.index(b'\n%d 0 obj' % page)
    old = b'/Resources ' + reference.encode()
    at = data.index(old, start)
    return data[:at] + b'/Resources null'.ljust(len(old)) + data[at + len(old):]


def _resources_from_a_parent_outside_the_tree(path):
    """第 1 頁不寫 /Resources，/Parent 指向樹外的 /Pages 節點，根節點與它各有一份資源：pdfminer 順著 /Kids 沿用
    根節點的，閱讀器順著 /Parent 沿用樹外那一份（第十輪審查的 e1 向量：那一份多一個把字變白的圖形狀態）。"""
    doc = pymupdf.open(path)
    page = doc[0]
    root = int(doc.xref_get_key(doc.pdf_catalog(), 'Pages')[1].split()[0])
    resources = _page_resources(page)
    doc.xref_set_key(root, 'Resources', f'{resources} 0 R')
    copy, other = doc.get_new_xref(), doc.get_new_xref()
    doc.update_object(copy, doc.xref_object(resources))
    doc.update_object(other, f'<</Type/Pages/Kids[{page.xref} 0 R]/Count 1/Parent {root} 0 R/Resources {copy} 0 R>>')
    _drop_key(doc, page.xref, 'Resources')
    doc.xref_set_key(page.xref, 'Parent', f'{other} 0 R')
    return doc.tobytes()


@pytest.mark.parametrize(('rewrite', 'message'), [
    # 頁面的 /Resources 寫成 null：pdfminer 丟掉那個鍵、沿用根節點的，閱讀器各有讀法 —— 物件那一層就擋下（第二十九輪；
    # 根節點帶 /Resources 本身由頁面樹的檢查擋下，見 root-resources）
    (_null_resources, '^PDF 的物件不是 Word 的寫法：物件的語法裡，字典裡有值是 null 的鍵'),
    # /Parent 指向樹外的節點：頁面樹的檢查先擋下（第十三輪）
    (_resources_from_a_parent_outside_the_tree, '^頁面樹不是 Word 的寫法'),
], ids=['null', 'parent-outside-the-tree'])
def test_resources_a_page_inherits_stop_the_extraction(tmp_path, rewrite, message):
    exam = tmp_path / 'inherited.pdf'
    exam.write_bytes(rewrite(_two_page_exam(tmp_path)))
    with pytest.raises(ValueError, match=message):
        extract(exam)


# ── 第十二輪審查：字集、符號字型、頁面清單、pdfminer 的例外、深色的「浮水印」 ─────────────────────────────

def _china_ordering(ordering, supplement, code):
    """題目用的字型（沒有內嵌、UniCNS-UTF16-H）另存一份 /chinao，/CIDSystemInfo 的 /Ordering 換成 ordering，在第 3 題的
    空隙畫字碼 code：pdfminer 與 MuPDF 先照 CMap 換成 CNS1 的 CID，再照 /Ordering 的字集表換成 Unicode（都是「不」），
    PDFium 畫的是字碼本來的字（第十二輪審查實測：「傷」「宋」「濱」），Poppler 不畫。"""
    def draw(page):
        doc = page.parent
        font = next(xref for xref, _, _, _, name, _ in page.get_fonts() if name == 'china-t')
        cid = int(doc.xref_get_key(font, 'DescendantFonts')[1].strip('[]').split()[0])
        new_cid, new_font = doc.get_new_xref(), doc.get_new_xref()
        text = doc.xref_object(cid)
        assert '/Ordering (CNS1)' in text and '/Supplement 7' in text
        doc.update_object(new_cid, text.replace('/Ordering (CNS1)', f'/Ordering ({ordering})')
                          .replace('/Supplement 7', f'/Supplement {supplement}'))
        doc.update_object(new_font, doc.xref_object(font).replace(f'[ {cid} 0 R ]', f'[ {new_cid} 0 R ]'))
        _add_resource(page, 'Font', 'chinao', f'{new_font} 0 R')
        _append_content(page, b'BT /chinao 12 Tf 0 g 1 0 0 1 170 388 Tm <%s> Tj ET' % code.encode())
    return draw


@pytest.mark.parametrize(('ordering', 'supplement', 'code'), [('Japan1', 6, '50B7'), ('GB1', 5, '5B8B'),
                                                              ('Korea1', 2, '6FF1')], ids=['japan1', 'gb1', 'korea1'])
def test_a_character_set_that_is_not_the_cmaps_stops_the_extraction(tmp_path, ordering, supplement, code):
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [_china_ordering(ordering, supplement, code)]}})
    with pytest.raises(ValueError, match='^第 1 頁有 Word 不會寫的字型 chinao 的 /CIDSystemInfo'):
        extract(exam)


def _cns1_without_to_unicode(page):
    """Word 寫法的內嵌字型拿掉 ToUnicode、/CIDSystemInfo 改成 (Adobe)(CNS1)，畫字形 660「ㄽ」：三套程式的文字層都照 CNS1
    的字集表說 CID 660 是「不」，閱讀器畫的是字形 660（第十二輪審查實測）。"""
    font, kid = _embedded_cjk(page, 'ㄽ', (170, 842 - 388))
    _drop_key(page.parent, font, 'ToUnicode')
    page.parent.xref_set_key(kid, 'CIDSystemInfo', '<</Registry(Adobe)/Ordering(CNS1)/Supplement 0>>')


def _to_unicode_as_a_name(page):
    """Word 寫法的內嵌字型，/ToUnicode 寫成名稱 /Identity-H：字碼 0x4E0D 當成 U+4E0D「不」，畫的卻是字形 0x4E0D「閏」。"""
    font, _ = _embedded_cjk(page, '閏', (170, 842 - 388))
    page.parent.xref_set_key(font, 'ToUnicode', '/Identity-H')


@pytest.mark.parametrize('draw', [_cns1_without_to_unicode, _to_unicode_as_a_name],
                         ids=['cns1-without-to-unicode', 'to-unicode-as-a-name'])
def test_an_embedded_font_needs_its_own_to_unicode_stream(tmp_path, draw):
    with pytest.raises(ValueError, match='^第 1 頁有 Word 不會寫的字型 kai 的 /ToUnicode'):
        extract(_exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [draw]}}))


def _word_truetype(base):
    """真實卷沒有內嵌的 TrueType（ArialMT）的寫法，只換 /BaseFont。"""
    return (f'<</Type/Font/Subtype/TrueType/BaseFont/{base}/Encoding/WinAnsiEncoding/FirstChar 32/LastChar 126'
            f'/Widths[{" ".join(["722"] * 95)}]/FontDescriptor<</Type/FontDescriptor/FontName/{base}/Flags 32'
            '/FontBBox[-665 -210 2000 728]/ItalicAngle 0/Ascent 905/Descent -210/CapHeight 716/StemV 80>>>>')


def _answer_in(font):
    """第 1 題的答案欄留空，答案「C」用 font 畫。"""
    def draw(page):
        _add_resource(page, 'Font', 'FS', font)
        _append_content(page, b'BT /FS 12 Tf 0 g 1 0 0 1 59 %d Tm (C) Tj ET' % (842 - (TOP + 24 + 30)))
    return draw


@pytest.mark.parametrize('font', [
    '<</Type/Font/Subtype/Type1/BaseFont/ZapfDingbats/Encoding/WinAnsiEncoding>>',
    _word_truetype('ZapfDingbats'),
    _word_truetype('SymbolMT'),
    f'<</Type/Font/Subtype/Type1/BaseFont/SymbolMT/Encoding/WinAnsiEncoding/FirstChar 32/LastChar 126'
    f'/Widths[{" ".join(["722"] * 95)}]>>',
], ids=['type1-zapf-dingbats', 'word-shaped-zapf-dingbats', 'word-shaped-symbol', 'type1-symbol-with-widths'])
def test_a_symbol_font_stops_the_extraction(tmp_path, font):
    # 符號字型不照 /WinAnsiEncoding 選字形：擷取是答案 C，三套閱讀器畫的是一個星形符號（U+2723，第十二輪審查實測）
    rows = list(PAGE1)
    rows[1] = ('', *rows[1][1:])
    with pytest.raises(ValueError, match='^第 1 頁有 Word 不會寫的字型 FS 的 /BaseFont'):
        extract(_exam(tmp_path, [rows, PAGE2], {1: {'extras': [_answer_in(font)]}}))


def _hidden_third_page(tmp_path):
    """第 3 頁寫著「更正：第 1 題答案改為 A」，頁面字典卻沒有 /Type：pdfminer 不當成頁面，MuPDF 與 Poppler 照樣畫出來
    （第十二輪審查實測）；前兩頁的頁尾寫「共 2 頁」。"""
    options = {1: {'footer': '第 {n} 頁，共 2 頁'}, 2: {'footer': '第 {n} 頁，共 2 頁'},
               3: {'outside': ['更正：第 1 題答案改為 A'], 'header': (), 'watermark': False, 'footer': '（更正頁）'}}
    doc = pymupdf.open(_exam(tmp_path, [PAGE1, PAGE2, []], options))
    _drop_key(doc, doc[2].xref, 'Type')
    return doc.tobytes()


def _page_count(count):
    def rewrite(tmp_path):
        doc = pymupdf.open(_two_page_exam(tmp_path))
        doc.xref_set_key(int(doc.xref_get_key(doc.pdf_catalog(), 'Pages')[1].split()[0]), 'Count', str(count))
        return doc.tobytes()
    return rewrite


def _hidden_page_in_the_middle(tmp_path):
    """_hidden_third_page，但沒有 /Type 的那一頁排在第 2 個、/Count 寫 2：兩邊都讀到 2 頁，卻不是同樣的 2 頁
    （pdfminer 是第 1、3 頁，MuPDF 是第 1、2 頁）。"""
    doc = pymupdf.open(stream=_hidden_third_page(tmp_path))
    root = int(doc.xref_get_key(doc.pdf_catalog(), 'Pages')[1].split()[0])
    first, second, hidden = (int(x) for x in doc.xref_get_key(root, 'Kids')[1].strip('[]').split()[::3])
    doc.xref_set_key(root, 'Kids', f'[{first} 0 R {hidden} 0 R {second} 0 R]')
    doc.xref_set_key(root, 'Count', '2')
    return doc.tobytes()


@pytest.mark.parametrize('rewrite', [_hidden_third_page, _page_count(1), _page_count(3), _hidden_page_in_the_middle],
                         ids=['page-without-type', 'count-too-small', 'count-too-large', 'same-count-other-pages'])
def test_pages_the_two_programs_list_differently_stop_the_extraction(tmp_path, rewrite):
    # 第十二輪審查的向量：都不是 Word 的頁面樹，先被頁面樹的檢查擋下（第十三輪）
    exam = tmp_path / 'pages.pdf'
    exam.write_bytes(rewrite(tmp_path))
    with pytest.raises(ValueError, match='^頁面樹不是 Word 的寫法'):
        extract(exam)


def _dark_box(value, rect=(169.5, 443, 182.5, 457.5)):
    """黑色（value 是灰階）的小圖，畫在 rect（預設是第 3 題空隙「不」的位置）、所有字的下面。每一頁都畫就是每一頁
    同一個位置、內容相同，被當成浮水印（第十二輪審查實測：閱讀器上是「下列何者█正確？」，擷取是「下列何者不正確？」）。"""
    def draw(page):
        before = page.get_contents()
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 8, 8), False)
        pix.clear_with(value)
        xref = page.insert_image(pymupdf.Rect(*rect), pixmap=pix)
        page.parent.xref_set_key(xref, 'ColorSpace', '/DeviceRGB')  # 照 Word 的寫法（_watermark_problem）
        page.parent.xref_set_key(xref, 'DecodeParms', 'null')
        after = [x for x in page.get_contents() if x not in before]
        page.parent.xref_set_key(page.xref, 'Contents',  # 緊接在頁面的浮水印之後、所有字之前
                                 '[' + ' '.join(f'{x} 0 R' for x in before[:1] + after + before[1:]) + ']')
    return draw


@pytest.mark.parametrize('value', [0, 30], ids=['black', 'dark-grey'])
def test_text_on_a_dark_watermark_stops_the_extraction(tmp_path, value):
    bu = _raw_stream(b'BT /china-t 12 Tf 0 g 1 0 0 1 170 388 Tm <4E0D> Tj ET')
    options = {1: {'extras': [_dark_box(value), bu]}, 2: {'extras': [_dark_box(value)]}}
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], options)
    with pytest.raises(ValueError, match='^第 1 頁的字「[者不]」.*壓在浮水印上'):  # 「者」的字框也碰到那塊圖
        extract(exam)


def test_the_shades_of_an_image_count_its_soft_mask():
    # 紅色的圖配一半透明的遮罩：疊在白紙上是 (255, 127, 127)，不是紅色（PyMuPDF 的 Pixmap 不套 /SMask，套上之後是預乘的）
    doc = pymupdf.open()
    page = doc.new_page()
    red = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 4, 4), False)
    red.set_rect(red.irect, (255, 0, 0))
    mask = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 4, 4), False)
    mask.set_rect(mask.irect, (128,))
    xref = page.insert_image(pymupdf.Rect(0, 0, 40, 40), pixmap=pymupdf.Pixmap(red, mask))
    assert _shades(doc, xref) == pytest.approx([_luminance((1, 127 / 255, 127 / 255))])
    plain = page.insert_image(pymupdf.Rect(50, 0, 90, 40), pixmap=red)
    assert _shades(doc, plain) == pytest.approx([_luminance((1, 0, 0))])


WATERMARK_BOX = (100.0, 100.0, 200.0, 200.0)


def _span(colour, opacity=1.0, text='A', box=(150.0, 150.0, 160.0, 162.0)):
    return {'type': 0, 'color': colour, 'opacity': opacity, 'chars': [(ord(text), 0, box[:2], box)]}


GREY = _luminance((0.5, 0.5, 0.5))  # 0.21：與白紙 4:1，看得清楚


@pytest.mark.parametrize(('span', 'shades', 'refused'), [
    (_span((0, 0, 0)), [0.7058, 1.0], False),                 # 真實卷：不透明的黑字壓在很淡的浮水印上（15:1）
    (_span((0, 0, 0)), [0.05, 1.0], True),                    # 深色的「浮水印」：2:1
    (_span((0, 0, 0), opacity=0.5), [0.7058], True),           # 半透明的黑字：與白紙 4:1，與浮水印只有 2.8:1
    (_span((0.5, 0.5, 0.5)), [0.0, GREY, 1.0], True),          # 灰字壓在同樣亮度的一塊上：最深的那一種看不出來
    (_span((0.5, 0.5, 0.5)), [0.2, 1.0], True),                # 比字稍深的一塊：1.06:1
    # 灰字在黑色上 5.3:1、在白色上 4:1，但黑白細點在閱讀器上平均成灰色（第十四輪）：字的亮度在最深與最淺之間就擋
    (_span((0.5, 0.5, 0.5)), [0.0, 1.0], True),
    (_span((1, 1, 1), text=' '), [0.7058], False),             # 空白沒有筆畫：白色的空白不算（與 _text_profile 一致）
    (_span((0, 0, 0), box=(300.0, 300.0, 310.0, 312.0)), [0.05], False),  # 沒有壓在浮水印上
    (_span((0.75, 0.75, 0.75)), [0.0, 0.1], False),            # 比深色浮水印最淺的一種還淺：0.52 對 0.1，3.8:1
    (_span((0.6, 0.6, 0.6)), [0.0, 0.1], True),                # 只淺一點：0.32 對 0.1，2.5:1
], ids=['black-on-light', 'black-on-dark', 'half-transparent-on-light', 'grey-on-a-grey-patch',
        'grey-on-a-slightly-darker-patch', 'grey-on-black-and-white', 'white-space', 'elsewhere',
        'light-on-dark', 'slightly-lighter-on-dark'])
def test_text_on_a_watermark_must_stand_out_from_every_colour_of_it(span, shades, refused):
    assert (_on_watermark([span], [(WATERMARK_BOX, shades)]) is not None) is refused


def test_text_between_the_shades_of_a_watermark_is_reported_as_one_to_one():
    # 字的亮度在最深與最淺之間：某一處混出來的顏色與字一樣亮，報 1:1（不報比 1 小的「對比」）
    assert _on_watermark([_span((0.5, 0.5, 0.5))], [(WATERMARK_BOX, [0.0, 1.0])])[2] == 1.0


def _image_mask_box(page):
    """黑色的圖片遮罩（/ImageMask，顏色是畫的當下的填色）畫在每一頁第 3 題空隙的位置、所有字的下面。"""
    doc = page.parent
    image = doc.get_new_xref()
    doc.update_object(image, '<</Type/XObject/Subtype/Image/Width 8/Height 8/ImageMask true/BitsPerComponent 1'
                             '/Decode[1 0]>>')
    doc.update_stream(image, b'\xff' * 8, new=True)
    _add_resource(page, 'XObject', 'Mk', f'{image} 0 R')
    _raw(page, b'q 0 g 13 0 0 14.5 169.5 384.5 cm /Mk Do Q', first=True)


def test_an_image_mask_watermark_stops_the_extraction(tmp_path):
    # 圖片遮罩的顏色是畫的當下的填色，看不出深淺：不是 Word 的浮水印寫法
    bu = _raw_stream(b'BT /china-t 12 Tf 0 g 1 0 0 1 170 388 Tm <4E0D> Tj ET')
    options = {1: {'extras': [_image_mask_box, bu]}, 2: {'extras': [_image_mask_box]}}
    with pytest.raises(ValueError, match='^第 1 頁的浮水印不是 Word 的寫法：/ColorSpace'):
        extract(_exam(tmp_path, [_q3_with_a_gap(), PAGE2], options))


def test_a_dark_figure_under_the_text_is_a_figure_not_a_watermark(tmp_path):
    # 只在一頁出現的圖不是浮水印：壓在字下面的深色圖照樣是圖（題目欄裡有圖），不用浮水印的規則
    dark = _in_q1(_dark_box(0, (120, 140, 200, 160)))
    with pytest.raises(ValueError, match='^第 1 題的題目欄裡有圖片'):
        extract(_two_page_exam(tmp_path, page_options=dark))


def test_the_shades_of_an_image_are_every_colour_from_dark_to_light():
    # 左半黑、右半白的圖：兩種顏色都要記，由深到淺（灰字壓在中間亮度的一塊上才找得到）
    doc = pymupdf.open()
    page = doc.new_page()
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 4, 4), False)
    pix.set_rect(pymupdf.IRect(0, 0, 2, 4), (255, 255, 255))
    pix.set_rect(pymupdf.IRect(2, 0, 4, 4), (0, 0, 0))
    pix.set_rect(pymupdf.IRect(0, 0, 1, 1), (128, 128, 128))
    xref = page.insert_image(pymupdf.Rect(0, 0, 40, 40), pixmap=pix)
    assert _shades(doc, xref) == pytest.approx([0.0, _luminance((128 / 255,) * 3), 1.0])


def test_a_pdf_without_pages_stops_the_extraction(tmp_path):
    # 頁面樹是空的：兩套程式讀到的頁面清單一樣（都是空的），以前一路走到核對頁碼才丟 KeyError（確認審查實測），
    # 呼叫端只接 ValueError
    path = tmp_path / 'no-pages.pdf'
    path.write_bytes(_minimal_pdf([b'<</Type/Catalog/Pages 2 0 R>>', b'<</Type/Pages/Kids[]/Count 0>>'], root=1))
    with pytest.raises(ValueError, match='^PDF 沒有任何頁面'):
        extract(path)


# ── 第十三輪審查：頁面樹、浮水印圖片與字型描述只收 Word 的寫法，PyMuPDF 的例外 ───────────────────────────

ALTERNATE_PAGE2 = [PAGE2[0], PAGE2[1], ('D', '5.', PAGE2[2][2])]  # 第 5 題的答案換成 D


def _page_that_is_also_a_node(tmp_path):
    """第 2 頁是 /Type /Page、有自己的內容（答案 B），又帶 /Kids [另一頁]（答案 D）：pdfminer 與 MuPDF 都把它當成頁面，
    PDFium 照 /Kids 往下走、畫出另一頁（第十三輪審查實測：Chrome 上第 5 題的答案是 D，擷取是 B）。"""
    doc = pymupdf.open()
    for rows in (PAGE1, PAGE2, ALTERNATE_PAGE2):
        _draw_page(doc, rows, page_no=min(doc.page_count + 1, 2), pages=2)
    root = int(doc.xref_get_key(doc.pdf_catalog(), 'Pages')[1].split()[0])
    first, second, alternate = doc[0].xref, doc[1].xref, doc[2].xref
    doc.xref_set_key(root, 'Kids', f'[{first} 0 R {second} 0 R]')
    doc.xref_set_key(root, 'Count', '2')
    doc.xref_set_key(second, 'Kids', f'[{alternate} 0 R]')
    doc.xref_set_key(alternate, 'Parent', f'{second} 0 R')
    return doc.tobytes()


def _pages_under_a_node(tmp_path):
    """兩頁放在根節點底下的另一個 /Pages 節點裡：各家都讀得到，但不是 Word 的寫法（Word 的 /Kids 直接列出每一頁）。"""
    doc = pymupdf.open(_two_page_exam(tmp_path))
    root = int(doc.xref_get_key(doc.pdf_catalog(), 'Pages')[1].split()[0])
    node = doc.get_new_xref()
    doc.update_object(node, f'<</Type/Pages/Kids[{doc[0].xref} 0 R {doc[1].xref} 0 R]/Count 2/Parent {root} 0 R>>')
    for page in doc:
        doc.xref_set_key(page.xref, 'Parent', f'{node} 0 R')
    doc.xref_set_key(root, 'Kids', f'[{node} 0 R]')
    return doc.tobytes()


def _parent_elsewhere(tmp_path):
    """第 1 頁的 /Parent 指向樹外的節點（其他都照 Word）：頁面自己帶 /Resources，沿用不到，但仍不是 Word 的寫法。"""
    doc = pymupdf.open(_two_page_exam(tmp_path))
    root = int(doc.xref_get_key(doc.pdf_catalog(), 'Pages')[1].split()[0])
    other = doc.get_new_xref()
    doc.update_object(other, f'<</Type/Pages/Kids[{doc[0].xref} 0 R]/Count 1/Parent {root} 0 R>>')
    doc.xref_set_key(doc[0].xref, 'Parent', f'{other} 0 R')
    return doc.tobytes()


@pytest.mark.parametrize('rewrite', [_page_that_is_also_a_node, _pages_under_a_node, _parent_elsewhere],
                         ids=['page-that-is-also-a-node', 'pages-under-a-node', 'parent-elsewhere'])
def test_a_page_tree_word_does_not_write_stops_the_extraction(tmp_path, rewrite):
    exam = tmp_path / 'tree.pdf'
    exam.write_bytes(rewrite(tmp_path))
    with pytest.raises(ValueError, match='^頁面樹不是 Word 的寫法'):
        extract(exam)


def test_pages_the_two_programs_list_differently_are_named_as_such():
    # 頁面樹照 Word 寫、兩邊讀到的頁面卻不同（目前造不出來：防的是其他讀不到頁面的原因）：說出各讀到幾頁
    class Page:
        def __init__(self, number):
            self.page_obj, self.xref = SimpleNamespace(pageid=number), number
    root = SimpleNamespace(objid=2)
    box = [0, 0, 595.32, 841.92]
    objects = {2: {'Type': LIT('Pages'), 'Kids': [SimpleNamespace(objid=4), SimpleNamespace(objid=5)], 'Count': 2},
               4: {'Type': LIT('Page'), 'Parent': root, 'MediaBox': box},
               5: {'Type': LIT('Page'), 'Parent': root, 'MediaBox': box}}
    pdf = SimpleNamespace(doc=SimpleNamespace(catalog={'Pages': root}, getobj=objects.get), pages=[Page(4), Page(5)])

    class Rendered(list):
        """MuPDF 的文件：開檔時照 /Count 算頁數（page_count），逐頁讀時才照 /Kids 修正。"""
        def __init__(self, pages, count):
            super().__init__(pages)
            self.page_count = count

        def __iter__(self):
            self.page_count = len(self)
            return super().__iter__()
    assert _page_list_problem(pdf, Rendered([Page(4)], 1)).startswith(
        '兩套 PDF 程式讀到的頁面不同（pdfminer 讀到 2 頁、PyMuPDF 讀到 1 頁）')
    assert _page_list_problem(pdf, Rendered([Page(4), Page(6)], 2)) is not None  # 頁數相同、頁面不同
    assert _page_list_problem(pdf, Rendered([Page(4), Page(5)], 3)) is not None  # 頁面相同、開檔時的頁數不對
    assert _page_list_problem(pdf, Rendered([Page(4), Page(5)], 2)) is None


def _odd_watermark(spec, data):
    """每一頁同一個位置、同一張 8×8 的圖，墊在第 3 題空隙「不」的下面、所有字的前面（第十三輪審查的向量）。"""
    state = {}

    def draw(page):
        doc = page.parent
        if 'xref' not in state:  # 兩頁共用同一個圖片物件
            icc = doc.get_new_xref()  # spec 裡的 {icc}：一個三個分量的 ICC 串流
            doc.update_object(icc, '<</N 3/Alternate/DeviceRGB>>')
            doc.update_stream(icc, b'\x00' * 128, new=True)
            state['xref'] = doc.get_new_xref()
            doc.update_object(state['xref'], '<</Type/XObject/Subtype/Image/Width 8/Height 8/BitsPerComponent 8'
                                             + spec.replace('{icc}', str(icc)) + '>>')
            doc.update_stream(state['xref'], data, new=True, compress=False)
        _add_resource(page, 'XObject', 'Wm', f"{state['xref']} 0 R")
        stream = doc.get_new_xref()
        doc.update_object(stream, '<<>>')
        doc.update_stream(stream, b'q 13 0 0 14.5 169.5 384.5 cm /Wm Do Q', new=True)
        before = page.get_contents()
        order = [before[0], stream, *before[1:]]  # 緊接在頁面的浮水印之後、所有字之前
        doc.xref_set_key(page.xref, 'Contents', '[' + ' '.join(f'{x} 0 R' for x in order) + ']')
    return draw


@pytest.mark.parametrize(('spec', 'data'), [
    # 索引超過 /Indexed 的 hival：MuPDF 夾回調色盤（白色），PDFium 畫黑色
    ('/ColorSpace[/Indexed/DeviceRGB 0 <FFFFFF>]/Filter/FlateDecode', zlib.compress(bytes([255]) * 64)),
    # ICC 的色彩空間（Word 的浮水印是 /DeviceRGB）；懸空的 ICC 見 test_a_dangling_icc_in_the_watermark_stops_the_extraction
    ('/ColorSpace[/ICCBased {icc} 0 R]/Filter/FlateDecode', zlib.compress(b'\xff' * 192)),
    # 顛倒的 /Decode：MuPDF 照做（白色），PDFium 在 JPX 上不照做（黑色）；這裡用 Flate 的黑色一樣要擋
    ('/ColorSpace/DeviceRGB/Filter/FlateDecode/Decode[1 0 1 0 1 0]', zlib.compress(bytes(192))),
], ids=['indexed-out-of-range', 'icc', 'inverted-decode'])
def test_a_watermark_word_does_not_write_stops_the_extraction(tmp_path, spec, data):
    draw = _odd_watermark(spec, data)
    bu = _raw_stream(b'BT /china-t 12 Tf 0 g 1 0 0 1 170 388 Tm <4E0D> Tj ET')
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [draw, bu]}, 2: {'extras': [draw]}})
    with pytest.raises(ValueError, match='^第 1 頁的浮水印不是 Word 的寫法'):
        extract(exam)


def test_a_dangling_icc_in_the_watermark_stops_the_extraction(tmp_path):
    # 浮水印的 ICC 指向不存在的物件（第十三輪審查：MuPDF 畫的時候丟出 FzErrorSyntax）：開檔之前、物件那一層就擋下
    draw = _odd_watermark('/ColorSpace[/ICCBased 9999 0 R]/Filter/FlateDecode', zlib.compress(b'\xff' * 192))
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [draw]}, 2: {'extras': [draw]}})
    with pytest.raises(ValueError, match='^' + SYNTAX_PROBLEM + '參照指向 xref 沒有登記的第 9999 號物件'):
        extract(exam)


def _image(attrs, data=b''):
    return PDFStream(attrs, data)


PIXELS = 8 * 8
WORD_MASK = {'Type': LIT('XObject'), 'Subtype': LIT('Image'), 'Width': 8, 'Height': 8, 'ColorSpace': LIT('DeviceGray'),
             'Matte': [0, 0, 0], 'BitsPerComponent': 8, 'Interpolate': False, 'Filter': LIT('FlateDecode')}
WORD_WATERMARK = {'Type': LIT('XObject'), 'Subtype': LIT('Image'), 'Width': 8, 'Height': 8,
                  'ColorSpace': LIT('DeviceRGB'), 'BitsPerComponent': 8, 'Interpolate': False,
                  'Filter': LIT('FlateDecode')}


def _mask(data=None, **changes):
    """Word 的遮罩（8×8、DeviceGray、Flate）換掉幾項（值是 None 就拿掉那一項）；data 預設是剛好解完的資料。"""
    attrs = {key: value for key, value in {**WORD_MASK, **changes}.items() if value is not None}
    size = attrs['Width'] * attrs['Height']
    return _image(attrs, data if data is not None else zlib.compress(bytes(size)) if 'Filter' in attrs else bytes(size))


def _word_image(data=None, **changes):
    """Word 的浮水印（8×8、DeviceRGB、Flate，帶 _mask()）換掉幾項，寫法同 _mask。"""
    attrs = {key: value for key, value in {**WORD_WATERMARK, 'SMask': _mask(), **changes}.items() if value is not None}
    size = 3 * attrs['Width'] * attrs['Height']
    return _image(attrs, data if data is not None else zlib.compress(bytes(size)) if 'Filter' in attrs else bytes(size))


def _decoded():
    """pdfminer 已經解碼過的圖：原始位元組沒了，核對不了。"""
    image = _word_image()
    image.get_data()
    return image


@pytest.mark.parametrize(('image', 'problem'), [
    (_word_image(), None),                                                 # 真實卷的寫法
    (_word_image(Filter=None), None),                                      # 不壓縮
    (_word_image(SMask=None), None),                                       # 不透明
    (_word_image(SMask=_mask(Matte=None)), None),
    (_word_image(ColorSpace=[LIT('ICCBased'), _image({'N': 3})]), '/ColorSpace'),
    (_word_image(ColorSpace=[LIT('Indexed'), LIT('DeviceRGB'), 0, b'\xff\xff\xff']), '/ColorSpace'),
    (_word_image(ColorSpace=LIT('DeviceCMYK')), '/ColorSpace'),
    (_word_image(ColorSpace=LIT('DeviceGray')), '/ColorSpace'),
    (_word_image(BitsPerComponent=16), '/BitsPerComponent'),
    (_word_image(Filter=LIT('JPXDecode')), '/Filter'),
    (_word_image(Filter=LIT('DCTDecode')), '/Filter'),
    (_word_image(Filter=[LIT('FlateDecode')]), '/Filter'),
    (_word_image(Decode=[1, 0, 1, 0, 1, 0]), '/Decode'),
    (_word_image(DecodeParms={'Predictor': 2}), '/DecodeParms'),
    (_word_image(Mask=[0, 10, 0, 10, 0, 10]), '/Mask'),
    (_word_image(ImageMask=True), '/ImageMask'),
    (_word_image(SMask=_mask(ColorSpace=LIT('DeviceRGB'))), '/SMask 的 /ColorSpace'),
    (_word_image(SMask=_mask(Width=4)), '/SMask（與圖的大小不同）'),
    (_word_image(SMask=_mask(Decode=[1, 0])), '/SMask 的 /Decode'),
    (_word_image(SMask=_mask(Matte=[1, 1, 1])), '/SMask 的 /Matte'),
    (_word_image(SMask=_mask(Filter=LIT('JPXDecode'))), '/SMask 的 /Filter'),
    (_word_image(SMask=LIT('None')), '/SMask（要是一張圖）'),
    # 第十四輪審查：mutation 找到沒有釘住的規則（遮罩的每一項、/Matte 的每一個值、圖的位元數）
    (_word_image(BitsPerComponent=4), '/BitsPerComponent'),
    (_word_image(SMask=_mask(BitsPerComponent=1)), '/SMask 的 /BitsPerComponent'),
    (_word_image(SMask=_mask(BitsPerComponent=16)), '/SMask 的 /BitsPerComponent'),
    (_word_image(SMask=_mask(DecodeParms={'Predictor': 2})), '/SMask 的 /DecodeParms'),
    (_word_image(SMask=_mask(Mask=[0, 10])), '/SMask 的 /Mask'),
    (_word_image(SMask=_mask(ImageMask=True)), '/SMask 的 /ImageMask'),
    (_word_image(SMask=_mask(Height=4)), '/SMask（與圖的大小不同）'),
    (_word_image(SMask=_mask(Matte=[0, 0, 1])), '/SMask 的 /Matte'),
    # 第十四輪審查：資料要剛好解完、剛好是寬 × 高 × 色版數（截斷的遮罩，Poppler 當成不透明）
    (_word_image(data=zlib.compress(bytes(3 * PIXELS))[:-4]), '資料'),     # 截斷：少了結尾的檢查碼
    (_word_image(data=zlib.compress(bytes(3 * PIXELS)) + b'\n'), '資料'),  # 解完還有多的位元組
    (_word_image(data=bytes(50)), '資料'),                                 # 不是 Flate 串流
    (_word_image(data=zlib.compress(bytes(3 * PIXELS - 1))), '資料'),      # 少一個位元組
    (_word_image(data=bytes(3 * PIXELS + 1), Filter=None), '資料'),        # 不壓縮也要剛好
    (_word_image(SMask=_mask(data=zlib.compress(bytes(PIXELS))[:-4])), '/SMask 的 資料'),
    (_word_image(SMask=_mask(data=zlib.compress(bytes(3 * PIXELS)))), '/SMask 的 資料'),  # 遮罩只有一個色版
    (_decoded(), '資料'),
], ids=['word', 'uncompressed', 'no-mask', 'mask-without-matte', 'icc', 'indexed', 'cmyk', 'gray', '16-bit', 'jpx',
        'jpeg', 'filter-array', 'decode', 'decode-parameters', 'colour-key-mask', 'image-mask', 'mask-in-rgb',
        'mask-of-another-width', 'mask-decode', 'white-matte', 'jpx-mask', 'mask-as-a-name',
        '4-bit', '1-bit-mask', '16-bit-mask', 'mask-decode-parameters', 'mask-with-a-mask', 'mask-as-an-image-mask',
        'mask-of-another-height', 'blue-matte',
        'truncated', 'bytes-after-the-end', 'not-flate', 'one-byte-short', 'uncompressed-one-byte-long',
        'truncated-mask', 'mask-in-three-channels', 'already-decoded'])
def test_a_watermark_must_be_written_the_way_word_writes_it(image, problem):
    found = _watermark_problem(image)
    assert found is None if problem is None else (found or '').startswith(problem)


@pytest.mark.parametrize('error', [PdfminerException(TypeError('boom')), PSSyntaxError('boom'),
                                   pymupdf.FileDataError('boom'), pymupdf.mupdf.FzErrorSyntax('boom')],
                         ids=['wrapped-by-pdfplumber', 'raised-by-pdfminer', 'pymupdf-file', 'mupdf'])
def test_what_either_program_cannot_read_is_a_value_error(tmp_path, monkeypatch, error):
    # 擷取器只丟 ValueError：pdfminer 讀不了的（字型的 /DW 寫成名稱）與 MuPDF 讀不了的（懸空的 ICC）都一樣
    def fail(self, *args, **kwargs):
        raise error
    monkeypatch.setattr(pdfplumber.page.Page, 'find_tables', fail)
    reader = 'PyMuPDF' if isinstance(error, (pymupdf.FileDataError, pymupdf.mupdf.FzErrorBase)) else 'pdfminer'
    with pytest.raises(ValueError, match=f'^{reader} 讀不了這份 PDF'):
        extract(_two_page_exam(tmp_path))


def test_the_shades_of_a_watermark_with_a_matte_drop_the_alpha_mupdf_adds():
    # 遮罩帶 /Matte 的圖（Word 的寫法），PyMuPDF 的 Pixmap(doc, xref) 多給一個 alpha：要先拿掉才能接遮罩。
    # 算出來的要與 MuPDF 自己畫在白紙上的相差不到一個色階（灰 200、不透明度 60/255）
    doc = pymupdf.open()
    page = doc.new_page()
    _insert_watermark(page)
    xref = page.get_images(full=True)[0][0]
    assert pymupdf.Pixmap(doc, xref).alpha
    shown = page.get_pixmap(clip=pymupdf.Rect(200, 400, 210, 410)).samples[:3]
    assert _shades(doc, xref) == pytest.approx([_luminance(tuple(v / 255 for v in shown))], abs=0.01)
    assert _shades(doc, xref) == pytest.approx([_luminance((200 / 255,) * 3, 60 / 255)], abs=0.01)


def _rewritten_page(change):
    def rewrite(tmp_path):
        doc = pymupdf.open(_two_page_exam(tmp_path))
        change(doc)
        return doc.tobytes()
    return rewrite


def _run_length_content(doc):
    """第 1 頁多一段 RunLengthDecode 的內容串流，資料在半路斷掉：pdfminer 解碼時丟 StopIteration。"""
    stream = doc.get_new_xref()
    doc.update_object(stream, '<<>>')
    doc.update_stream(stream, b'\x81', new=True, compress=False)
    doc.xref_set_key(stream, 'Filter', '/RunLengthDecode')  # 寫完資料才標：PyMuPDF 寫資料時會拿掉這一項
    contents = ' '.join(f'{x} 0 R' for x in (*doc[0].get_contents(), stream))
    doc.xref_set_key(doc[0].xref, 'Contents', f'[{contents}]')


@pytest.mark.parametrize('change', [
    _run_length_content,
    lambda doc: doc.xref_set_key(doc[0].xref, 'Rotate', '/R'),              # TypeError
    lambda doc: doc.xref_set_key(doc[0].xref, 'Rotate', '(90)'),
    lambda doc: doc.xref_set_key(doc[0].xref, 'MediaBox', '[0 0 595]'),      # IndexError
    lambda doc: _add_resource(doc[0], 'Font', 'FX',  # /BaseFont 不是 UTF-8 的名稱
                              '<</Type/Font/Subtype/TrueType/BaseFont/Arial#FFMT/Encoding/WinAnsiEncoding>>'),
], ids=['truncated-run-length', 'rotate-as-a-name', 'rotate-as-a-string', 'media-box-of-three', 'base-font-not-utf8'])
def test_whatever_the_programs_trip_over_is_a_value_error(tmp_path, change):
    # 第十三輪審查的試法：兩套程式在這些寫法上丟出 ValueError 以外的錯，呼叫端接不到（只接 ValueError）
    exam = tmp_path / 'crafted.pdf'
    exam.write_bytes(_rewritten_page(change)(tmp_path))
    with pytest.raises(ValueError):
        extract(exam)


def test_an_unexpected_error_while_reading_is_a_value_error(tmp_path, monkeypatch):
    # 兩套程式都沒有歸類的錯（TypeError 之類）一樣換成 ValueError；擷取器自己的 ValueError 照原樣傳出
    def fail(self, *args, **kwargs):
        raise TypeError('boom')
    monkeypatch.setattr(pdfplumber.page.Page, 'find_tables', fail)
    with pytest.raises(ValueError, match='^讀這份 PDF 時出錯（TypeError：boom）'):
        extract(_two_page_exam(tmp_path))


# ── 第十四輪審查：沒有內嵌的 Type0 的字型名稱、物件層的寫法、浮水印的資料與深淺、頁面的 /MediaBox ──────────────

def _china_named(base):
    """第 3 題空隙裡的「不」改用 china-t 的複本（/chinab）畫，複本的 CIDFont 的 /BaseFont 換成 base（第十四輪審查的向量）。"""
    def draw(page):
        doc = page.parent
        font = next(xref for xref, _, _, _, name, _ in page.get_fonts() if name == 'china-t')
        cid = int(doc.xref_get_key(font, 'DescendantFonts')[1].strip('[]').split()[0])
        new_cid, new_font = doc.get_new_xref(), doc.get_new_xref()
        doc.update_object(new_cid, doc.xref_object(cid))
        doc.xref_set_key(new_cid, 'BaseFont', f'/{base}')
        doc.update_object(new_font, doc.xref_object(font).replace(f'[ {cid} 0 R ]', f'[ {new_cid} 0 R ]'))
        _add_resource(page, 'Font', 'chinab', f'{new_font} 0 R')
        _append_content(page, b'BT /chinab 12 Tf 0 g 1 0 0 1 170 388 Tm <4E0D> Tj ET')
    return draw


@pytest.mark.parametrize('base', ['ZapfDingbats', 'Symbol', 'SymbolMT'])
def test_a_cid_font_named_after_a_symbol_font_stops_the_extraction(tmp_path, base):
    # 沒有內嵌的字型由閱讀器照名稱換字型：PDFium 把「不」畫成空白（Chrome 上是「下列何者　正確？」），MuPDF 與
    # Poppler 照畫，擷取是「下列何者不正確？」（第十四輪審查實測）
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [_china_named(base)]}})
    with pytest.raises(ValueError, match='^第 1 頁有 Word 不會寫的字型 chinab 的 /BaseFont'):
        extract(exam)


def test_a_cid_font_with_pymupdfs_own_name_is_accepted(tmp_path):
    # 對照組：名稱照 PyMuPDF 內建字型寫（Fangti），「不」照樣抽得到
    exam = _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [_china_named('Fangti')]}})
    assert extract(exam)[2]['stem'].endswith('下列何者不正確？')



def _masked_watermark(mask_data, size=8, place=b'13 0 0 14.5 169.5 384.5'):
    """每一頁同一個位置、同一張 size×size 的黑圖，帶 Word 寫法的遮罩（DeviceGray、/Matte [0 0 0]、Flate），遮罩的原始
    資料是 mask_data；以 place（cm 的六個數，預設是第 3 題空隙「不」的位置）墊在所有字的前面（第十四輪審查的向量）。"""
    state = {}

    def draw(page):
        doc = page.parent
        if 'xref' not in state:  # 兩頁共用同一個圖片物件
            mask, image = doc.get_new_xref(), doc.get_new_xref()
            doc.update_object(mask, f'<</Type/XObject/Subtype/Image/Width {size}/Height {size}/ColorSpace/DeviceGray'
                                    '/Matte[0 0 0]/BitsPerComponent 8>>')
            doc.update_stream(mask, mask_data, new=True, compress=False)
            doc.update_object(image, f'<</Type/XObject/Subtype/Image/Width {size}/Height {size}/ColorSpace/DeviceRGB'
                                     f'/BitsPerComponent 8/SMask {mask} 0 R>>')
            doc.update_stream(image, zlib.compress(bytes(3 * size * size)), new=True, compress=False)
            for xref in (mask, image):  # 寫完資料才標：PyMuPDF 寫資料時會拿掉這一項
                doc.xref_set_key(xref, 'Filter', '/FlateDecode')
            state['xref'] = image
        _add_resource(page, 'XObject', 'Wm', f"{state['xref']} 0 R")
        stream = doc.get_new_xref()
        doc.update_object(stream, '<<>>')
        doc.update_stream(stream, b'q ' + place + b' cm /Wm Do Q', new=True)
        before = page.get_contents()
        order = [before[0], stream, *before[1:]]  # 緊接在頁面的浮水印之後、所有字之前
        doc.xref_set_key(page.xref, 'Contents', '[' + ' '.join(f'{x} 0 R' for x in order) + ']')
    return draw


def _masked_exam(tmp_path, mask_data, colour=b'0 g', **watermark):
    draw = _masked_watermark(mask_data, **watermark)
    bu = _raw_stream(b'BT /china-t 12 Tf ' + colour + b' 1 0 0 1 170 388 Tm <4E0D> Tj ET')
    return _exam(tmp_path, [_q3_with_a_gap(), PAGE2], {1: {'extras': [draw, bu]}, 2: {'extras': [draw]}})


@pytest.mark.parametrize('mask_data', [zlib.compress(bytes(PIXELS))[:6], bytes(PIXELS)],
                         ids=['truncated-flate', 'not-flate'])
def test_a_watermark_mask_that_does_not_decode_completely_stops_the_extraction(tmp_path, mask_data):
    # 解不完整的遮罩：MuPDF 與 PDFium 當成透明（黑圖看不見），Poppler 當成不透明，「不」被黑塊蓋住（第十四輪審查
    # 實測：Poppler 上是「下列何者█正確？」，擷取照樣有「不」）
    with pytest.raises(ValueError, match='^第 1 頁的浮水印不是 Word 的寫法：/SMask 的 資料'):
        extract(_masked_exam(tmp_path, mask_data))


def test_a_watermark_mask_that_decodes_completely_is_accepted(tmp_path):
    # 對照組：同一張黑圖，遮罩完整而且全透明（每一個值都是 0）：閱讀器上看不見，字照樣清楚
    assert extract(_masked_exam(tmp_path, zlib.compress(bytes(PIXELS))))[2]['stem'].endswith('下列何者不正確？')


def _dither(size):
    """黑色與透明交錯的遮罩（棋盤格）：每一點不是全黑就是全透明。"""
    return zlib.compress(bytes(255 * ((x + y) % 2) for y in range(size) for x in range(size)))


def test_grey_text_on_a_dithered_watermark_stops_the_extraction(tmp_path):
    # 64×64 的黑白細點墊在灰色的「不」下面（只碰到「不」）：每一點與字的對比都夠（黑 5.3:1、白 4:1），閱讀器卻把
    # 細點平均成灰色，與字一樣亮。字的亮度在浮水印最深與最淺的顏色之間就擋（以前只比最接近的那兩種顏色）
    exam = _masked_exam(tmp_path, _dither(64), colour=b'0.5 g', size=64, place=b'10 0 0 10 171 387')
    with pytest.raises(ValueError, match='^第 1 頁的字「不」.*壓在浮水印上'):
        extract(exam)


def test_black_text_on_a_dithered_watermark_of_light_dots_is_accepted(tmp_path):
    # 對照組：同樣的細點，黑字比最深的一種還深得多（遮罩換成全透明與半透明交錯：最深的是 50% 的灰）
    light = zlib.compress(bytes(128 * ((x + y) % 2) for y in range(64) for x in range(64)))
    exam = _masked_exam(tmp_path, light, size=64, place=b'10 0 0 10 171 387')
    assert extract(exam)[2]['stem'].endswith('下列何者不正確？')


def test_the_shades_of_a_colour_stored_above_its_mask_follow_mupdf():
    # 預乘過的顏色比透明度大（240 對 85；真實卷的浮水印有一萬多點這樣）：MuPDF 還原時夾回 255，疊在白紙上是白的
    doc = pymupdf.open()
    page = doc.new_page()
    pix = pymupdf.Pixmap(pymupdf.csRGB, 8, 8, bytes([240, 213, 228, 85]) * 64, True)
    xref = _word_image_of(page, pix, pymupdf.Rect(100, 100, 180, 180))
    shown = page.get_pixmap(clip=pymupdf.Rect(130, 130, 140, 140)).samples[:3]
    assert _shades(doc, xref) == pytest.approx([_luminance(tuple(v / 255 for v in shown))], abs=0.01)
    assert _shades(doc, xref) == [1.0]



def _pages_node(doc):
    return int(doc.xref_get_key(doc.pdf_catalog(), 'Pages')[1].split()[0])


def _media_box_null(doc):
    """第 1 頁的 /MediaBox 寫成 null，根節點另有 /MediaBox：pdfminer、MuPDF 與 Poppler 沿用根節點的，PDFium 改用
    US Letter，頁面上方 50pt 在 Chrome 上看不到（第十四輪審查實測）。"""
    doc.xref_set_key(_pages_node(doc), 'MediaBox', '[0 0 595 842]')
    doc.xref_set_key(doc[0].xref, 'MediaBox', 'null')


def _indirect_media_box(doc):
    """第 1 頁的 /MediaBox 是間接參照（另一個物件才是四個數字的陣列）：各家都讀得到，但不是 Word 的寫法。"""
    box = doc.get_new_xref()
    doc.update_object(box, '[0 0 595 842]')
    doc.xref_set_key(doc[0].xref, 'MediaBox', f'{box} 0 R')


def test_a_count_written_as_a_real_number_stops_the_extraction(tmp_path):
    # /Count 1.0（PyMuPDF 會把 2.0 寫成 2，這裡手寫）：Word 寫整數；頁面樹的檢查在版面之前，一頁的 PDF 就夠
    path = tmp_path / 'count.pdf'
    path.write_bytes(_hand_pdf(_one_page_with(2, b'<</Type/Pages/Kids[3 0 R]/Count 1.0>>')))
    with pytest.raises(ValueError, match='^頁面樹不是 Word 的寫法'):
        extract(path)


def _indirect_count(doc):
    count = doc.get_new_xref()
    doc.update_object(count, '2')
    doc.xref_set_key(_pages_node(doc), 'Count', f'{count} 0 R')


def _indirect_page_type(doc):
    kind = doc.get_new_xref()
    doc.update_object(kind, '/Page')
    doc.xref_set_key(doc[0].xref, 'Type', f'{kind} 0 R')


def _indirect_kids(doc):
    kids = doc.get_new_xref()
    doc.update_object(kids, doc.xref_get_key(_pages_node(doc), 'Kids')[1])
    doc.xref_set_key(_pages_node(doc), 'Kids', f'{kids} 0 R')


@pytest.mark.parametrize('change', [
    lambda doc: _drop_key(doc, doc[0].xref, 'MediaBox'),                                  # 沒有，也沒有可以沿用的
    _indirect_media_box,
    lambda doc: doc.xref_set_key(doc[0].xref, 'MediaBox', '[0 0 595 /Big]'),
    lambda doc: doc.xref_set_key(doc[0].xref, 'MediaBox', '[0 0 595]'),
    lambda doc: doc.xref_set_key(doc[0].xref, 'MediaBox', '[0 0 595 true]'),              # pdfminer 讀成 1
    lambda doc: doc.xref_set_key(_pages_node(doc), 'CropBox', '[0 0 595 792]'),          # 根節點帶可以沿用的屬性
    lambda doc: doc.xref_set_key(_pages_node(doc), 'Rotate', '0'),
    lambda doc: doc.xref_set_key(_pages_node(doc), 'Resources', '<<>>'),
    lambda doc: doc.xref_set_key(_pages_node(doc), 'MediaBox', '[0 0 595 842]'),
    lambda doc: doc.xref_set_key(_pages_node(doc), 'Kids', f'{doc[0].xref} 0 R'),        # /Kids 不是陣列
    # 根節點只寫 /Type /Pages、直接的 /Kids 與整數的 /Count（8 份真實卷都是）：/Type /Page 的根節點 pdfminer 當成
    # 一頁（沒有 /MediaBox，丟 TypeError），MuPDF、PDFium、Poppler 照 /Kids 往下走（第十四輪審查實測）
    lambda doc: doc.xref_set_key(_pages_node(doc), 'Type', '/Page'),
    lambda doc: doc.xref_set_key(_pages_node(doc), 'Type', '/Foo'),
    lambda doc: _drop_key(doc, _pages_node(doc), 'Type'),
    _indirect_count,
    _indirect_kids,
    lambda doc: doc.xref_set_key(_pages_node(doc), 'Foo', '1'),
    _indirect_page_type,                          # pdfminer 只認直接的名稱：跳過這一頁，MuPDF 照讀
], ids=['no-media-box', 'media-box-as-a-reference', 'media-box-with-a-name',
        'media-box-of-three', 'media-box-with-a-boolean', 'root-crop-box', 'root-rotate', 'root-resources',
        'root-media-box', 'kids-not-an-array', 'root-typed-as-a-page', 'root-of-another-type', 'root-without-a-type',
        'count-as-a-reference', 'kids-as-a-reference', 'root-with-another-key',
        'page-type-as-a-reference'])
def test_a_root_or_page_word_does_not_write_stops_the_extraction(tmp_path, change):
    exam = tmp_path / 'boxes.pdf'
    exam.write_bytes(_rewritten_page(change)(tmp_path))
    with pytest.raises(ValueError, match='^頁面樹不是 Word 的寫法'):
        extract(exam)


def test_a_media_box_written_as_null_is_refused_as_a_null_value(tmp_path):
    # _media_box_null：pdfminer、MuPDF 與 Poppler 沿用根節點的，PDFium 改用 US Letter（第十四輪審查實測）。值是 null 的鍵
    # 在物件那一層就擋下（第二十九輪）
    exam = tmp_path / 'boxes.pdf'
    exam.write_bytes(_rewritten_page(_media_box_null)(tmp_path))
    with pytest.raises(ValueError, match='^PDF 的物件不是 Word 的寫法：物件的語法裡，字典裡有值是 null 的鍵'):
        extract(exam)


def _hand_pdf(objects, trailer=b'', headers=None, generations=None, tail=b'', entry=b'%010d %05d n \n'):
    """手寫的 PDF（_minimal_pdf 的延伸，根是第 1 號物件）：headers[n] 換掉第 n 號物件的開頭（預設「n 0 obj」），
    generations[n] 是它在 xref 表裡的世代號（預設 0），trailer 加在 trailer 字典的最後，tail 接在檔尾（增量更新），
    entry 是 xref 表每一筆的寫法（預設標準的 20 個位元組）。"""
    headers, generations = headers or {}, generations or {}
    out, offsets = bytearray(b'%PDF-1.7\n'), []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += headers.get(number, b'%d 0 obj' % number) + b'\n' + body + b'\nendobj\n'
    start = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1)
    out += b''.join(entry % (o, generations.get(n, 0)) for n, o in enumerate(offsets, start=1))
    out += b'trailer\n<</Size %d /Root 1 0 R%s>>\nstartxref\n%d\n%%%%EOF\n' % (len(objects) + 1, trailer, start)
    return bytes(out) + tail


_CONTENT = b'BT /F1 24 Tf 1 0 0 1 100 700 Tm (A) Tj ET'
ONE_PAGE = [b'<</Type/Catalog/Pages 2 0 R>>', b'<</Type/Pages/Kids[3 0 R]/Count 1>>',
            b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources 6 0 R/Contents 4 0 R>>',
            b'<</Length %d>>\nstream\n' % len(_CONTENT) + _CONTENT + b'\nendstream', HELVETICA_FONT,
            b'<</Font<</F1 5 0 R>>>>']


def _one_page_with(number, body):
    return [body if n == number else old for n, old in enumerate(ONE_PAGE, start=1)]


def _incremental_update(objects):
    """第 6 號物件（頁面資源）在檔尾的增量更新裡換成另一份：兩段 xref 登記的位置不同。"""
    base = _hand_pdf(objects)
    start = int(base.rsplit(b'startxref\n', 1)[1].split()[0])
    at = len(base)
    body = b'6 0 obj\n<</Font<</F1 5 0 R>>/ExtGState<<>>>>\nendobj\n'
    section = at + len(body)
    return base + body + (b'xref\n6 1\n%010d 00000 n \ntrailer\n<</Size 7 /Root 1 0 R /Prev %d>>\nstartxref\n%d\n'
                          b'%%%%EOF\n' % (at, start, section))


def _word_hybrid(body, at, size, stream, root=1):
    """body（寫到 xref 串流那個物件的 endobj 為止）接上 Word 的混合 xref：完整的 xref 表（at 裡的物件登記位置，其餘標成
    空的、串成一串，世代號 65535）與它的 trailer，再一段空的 xref 表，它的 trailer 以 /XRefStm 指到 xref 串流（位置
    stream）、/Prev 指到完整的那一段 —— 閱讀器先讀 xref 串流，表裡的空的不會蓋掉它（真實卷都是這樣寫）。"""
    free = [n for n in range(1, size) if n not in at]
    link = dict(zip([0, *free], [*free, 0]))
    full = len(body)
    out = body + b'xref\r\n0 %d\r\n' % size + b''.join(
        b'%010d 65535 f\r\n' % link[n] if n in link else b'%010d 00000 n\r\n' % at[n] for n in range(size))
    out += b'trailer\r\n<</Size %d/Root %d 0 R>>\r\nstartxref\r\n%d\r\n%%%%EOF\r\n' % (size, root, full)
    empty = len(out)
    tail = b'xref\r\n0 0\r\ntrailer\r\n<</Size %d/Root %d 0 R/Prev %d/XRefStm %d>>\r\nstartxref\r\n%d\r\n%%%%EOF\r\n'
    return out + tail % (size, root, full, stream, empty)


def _object_stream_pdf(names=(5, 6), shift=0,
                       sixth=b'<</Type/Font/Subtype/Type1/BaseFont/Courier/Encoding/WinAnsiEncoding>>',
                       first=b'', offset=b'', extra=b'', order=(1, 2, 3, 5, 6), count=None, hybrid=False):
    """order 裡的物件（預設第 1、2、3、5、6 號）放在物件串流（第 7 號）裡，其餘的直接寫在檔案裡，xref 是串流（第 8 號）。
    串流開頭依序寫每個物件的編號與位置：names 是最後兩個物件寫的編號（對調就是 (6, 5)），shift 把最後一個物件寫的
    位置往後移，offset 接在它後面（'.0' 就是實數）；first 接在 /First 的數字後面，sixth 是第 6 號物件的內容，extra 接在
    最後一個物件之後，count 換掉 /N（預設是物件數）。hybrid 照 Word 的混合 xref 再接兩段 xref 表（_word_hybrid）。"""
    objects = {1: b'<</Type/Catalog/Pages 2 0 R>>', 2: b'<</Type/Pages/Kids[3 0 R]/Count 1>>',
               3: b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
               5: b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>', 6: sixth}
    body, offsets = b'', []
    for number in order:
        offsets.append(len(body))
        body += objects[number] + b'\n'
    body += extra
    offsets[-1] += shift
    header = b' '.join(b'%d %d' % pair for pair in zip([*order[:-2], *names], offsets)) + offset + b'\n'
    content = b'BT /F1 24 Tf 20 40 Td (Hello) Tj ET'
    out, at = bytearray(b'%PDF-1.7\n'), {}
    at[4] = len(out)
    out += b'4 0 obj\n<</Length %d>>stream\n' % len(content) + content + b'\nendstream\nendobj\n'
    for number in sorted(set(objects) - set(order)):
        at[number] = len(out)
        out += b'%d 0 obj\n' % number + objects[number] + b'\nendobj\n'
    at[7] = len(out)
    out += (b'7 0 obj\n<</Type/ObjStm/N %d/First %d%s/Length %d>>stream\n'
            % (count or len(order), len(header), first, len(header + body)) + header + body + b'\nendstream\nendobj\n')
    at[8] = len(out)
    rows = [(0, 0, 65535)] + [(1, at[n], 0) if n in at else (2, 7, order.index(n)) for n in range(1, 9)]
    table = b''.join(struct.pack('>BIH', *row) for row in rows)
    out += b'8 0 obj\n<</Type/XRef/Size 9/W[1 4 2]/Root 1 0 R/Length %d>>stream\n' % len(table) + table
    out += b'\nendstream\nendobj\n'
    if hybrid:
        return _word_hybrid(bytes(out), at, 9, at[8])
    return bytes(out + b'startxref\n%d\n%%%%EOF\n' % at[8])


def _within(seconds, function):
    """function() 的結果；卡住超過 seconds 秒就讓測試失敗（daemon 執行緒：不用各平台不同的 signal，測試照樣結束）。"""
    outcome = []
    worker = threading.Thread(target=lambda: outcome.append(function()), daemon=True)
    worker.start()
    worker.join(timeout=seconds)
    assert not worker.is_alive(), '卡住了'
    return outcome[0]


def _refused(run, path):
    """run(path) 拒絕的訊息（ValueError）；沒有拒絕是 None。"""
    try:
        run(path)
    except ValueError as refused:
        return str(refused)


def _syntax_of(tmp_path, data):
    """_syntax_problem 對 data 的判斷。它不可以改動 MuPDF 的 xref：問 MuPDF 超過 xref 長度的編號，xref 就被撐大
    （第十七輪修正時實測：問第 5000 號，長度從 7 變成 5001），畫頁面與整份掃描用的是同一份。拒絕的樣本也交給
    extract() 與 header()：兩個都在開檔之前跑同一個檢查（_opened），拒絕的訊息要逐字相同（每一個樣本都實際走過兩個
    入口，不只靠結構性的測試）。"""
    path = tmp_path / 'syntax.pdf'
    path.write_bytes(data)

    def run():
        with pymupdf.open(path) as rendered:
            size = rendered.xref_length()
            return _syntax_problem(path, rendered), rendered.xref_length() - size
    problem, grown = _within(60, run)
    assert grown == 0
    if problem:
        for entry in (extract, header):
            assert _within(60, lambda: _refused(entry, path)) == problem, entry.__name__
    return problem


SYNTAX_PROBLEM = 'PDF 的物件不是 Word 的寫法：'


@pytest.mark.parametrize('data', [
    _object_stream_pdf(), _object_stream_pdf(order=(2, 3, 5, 6)),  # 只有 xref 串流、沒有 xref 表與 trailer
    # trailer 前面有空白：Poppler 從行首往後數 7 個位元組讀字典，讀到的是「er」這個字（強迫重建時 pdftotext 實測）
    _hand_pdf(ONE_PAGE).replace(b'\ntrailer\n', b'\n  trailer\n'),
    _hand_pdf(ONE_PAGE).replace(b'/Root 1 0 R', b'/Root 1'),  # /Root 不是參照：它不算找到（直接寫的字典見 trailer 的寫法）
], ids=['object-stream-only', 'catalog-outside-the-object-stream', 'indented-trailer', 'root-is-a-number'])
def test_a_pdf_poppler_finds_no_trailer_in_is_refused(tmp_path, data):
    # Poppler 重建 xref 時，只照檔案裡的 trailer 找 /Root（不看 xref 串流），找不到就整個放棄（Couldn't find trailer
    # dictionary）。只有 xref 串流的檔案，它讀不了那個串流時（/W 太寬、類型不是 0 到 2）開檔就重建，整份打不開，擷取卻照樣
    # 收下（第二十三輪審查實測）。Word 的卷都是混合 xref，trailer 都在行首（下面收下的 object-stream 兩個樣本）
    assert (_syntax_of(tmp_path, data) or '').startswith(
        SYNTAX_PROBLEM + 'Poppler 重建 xref 會失敗（找不到 /Root 是參照的 trailer）')


@pytest.mark.parametrize('data', [_hand_pdf(ONE_PAGE), _object_stream_pdf(hybrid=True),
                                  _object_stream_pdf(order=(2, 3, 5, 6), hybrid=True),
                                  _hand_pdf([*ONE_PAGE, b'(see 3 0 objects)'])],
                         ids=['table', 'object-stream', 'catalog-outside-the-object-stream', 'objects-in-a-string'])
def test_objects_written_the_way_word_writes_them_are_accepted(tmp_path, data):
    assert _syntax_of(tmp_path, data) is None


@pytest.mark.parametrize(('data', 'problem'), [
    # 字典裡同一個鍵寫兩次：Poppler 取第一個，pdfminer、MuPDF 與 PDFium 取最後一個
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R/F1 5 0 R>>>>')), '字典裡同一個鍵寫了兩次（/F1）'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R/F#31 5 0 R>>>>')), '字典裡同一個鍵寫了兩次（/F1）'),  # #31 是「1」
    (_hand_pdf(_one_page_with(3, ONE_PAGE[2][:-2] + b'/MediaBox[0 0 612 792]>>')), '字典裡同一個鍵寫了兩次（/MediaBox）'),
    (_hand_pdf(ONE_PAGE, trailer=b'/Root 1 0 R'), '字典裡同一個鍵寫了兩次（/Root）'),
    # 世代號不是 0：Poppler 找不到世代號不符的物件（當成 null），pdfminer 與 MuPDF 不看世代號
    (_hand_pdf(_one_page_with(3, ONE_PAGE[2].replace(b'6 0 R', b'6 7 R'))), '參照不是「編號 0 R」（6 7 R）'),
    (_hand_pdf(_one_page_with(3, ONE_PAGE[2].replace(b'6 0 R', b'6 0.0 R'))), '參照不是「編號 0 R」（6 0.0 R）'),
    (_hand_pdf(_one_page_with(3, ONE_PAGE[2].replace(b'6 0 R', b'6.0 0 R'))), '參照不是「編號 0 R」（6.0 0 R）'),
    (_hand_pdf(_one_page_with(3, ONE_PAGE[2].replace(b'6 0 R', b'-6 0 R'))), '參照不是「編號 0 R」（-6 0 R）'),
    (_hand_pdf([*ONE_PAGE, b'R']), '參照前面少了編號與世代號'),
    (_hand_pdf(ONE_PAGE, generations={6: 7}), 'xref 登記第 6 號物件的世代號是 7'),
    (_hand_pdf(ONE_PAGE, headers={6: b'6 7 obj'}), '第 6 號物件的開頭不是「6 0 obj」'),
    (_hand_pdf(ONE_PAGE, headers={6: b'7 0 obj'}), '第 6 號物件的開頭不是「6 0 obj」'),
    # 同一個物件在幾段 xref 裡登記的位置不同（增量更新）：各家採用哪一段的順序不一定相同
    (_incremental_update(ONE_PAGE), '第 6 號物件在幾段 xref 裡登記的位置不同'),
    # 物件串流開頭的編號、位置與 xref 對不上：pdfminer 照 xref 給的索引數，MuPDF 照開頭的編號與位置找
    (_object_stream_pdf(names=(6, 5)), '物件串流（第 7 號物件）開頭的物件編號或位置與 xref 對不上'),
    (_object_stream_pdf(shift=1), '物件串流（第 7 號物件）開頭的物件編號或位置與 xref 對不上'),
    (_object_stream_pdf(offset=b'.0'), '物件串流（第 7 號物件）開頭的物件編號或位置與 xref 對不上'),  # Poppler 只收整數
    (_object_stream_pdf(first=b'.0'), '物件串流（第 7 號物件）開頭的物件編號或位置與 xref 對不上'),
    (_object_stream_pdf(extra=b'<<>>\n'), '物件串流（第 7 號物件）開頭的物件編號或位置與 xref 對不上'),  # 多一個物件
    # /N 比 xref 登記的少：pdfminer 把開頭的數字當成物件（第 1 號物件讀成數字 6），MuPDF 照開頭找
    (_object_stream_pdf(count=4, order=(2, 3, 5, 6, 1), names=(6, 1)),
     '物件串流（第 7 號物件）開頭的物件編號或位置與 xref 對不上'),
    # 整個物件只是一個參照：pdfminer 解參照時一路跟下去，繞回自己就不會停
    (_hand_pdf([*ONE_PAGE, b'7 0 R'], trailer=b'/Info 7 0 R'), '第 7 號物件整個只是一個參照'),
    (_hand_pdf([*ONE_PAGE, b'8 0 R', b'7 0 R'], trailer=b'/Info 7 0 R'), '第 7 號物件整個只是一個參照'),
    (_hand_pdf([*ONE_PAGE, b'5 0 R']), '第 7 號物件整個只是一個參照'),               # 沒有繞回自己也不收
    # 物件串流裡整個物件只是一個參照：pdfminer 把最上層的數字先當成物件，讀到 R 時前面什麼都沒有（它自己會丟 ValueError；
    # 目錄物件放在串流外面，開檔時才不會先讀到這個串流）
    (_object_stream_pdf(sixth=b'5 0 R', order=(2, 3, 5, 6)), '參照前面少了編號與世代號'),
], ids=['duplicate-font-name', 'duplicate-after-a-name-escape', 'duplicate-media-box', 'duplicate-in-the-trailer',
        'reference-generation', 'reference-generation-as-a-real', 'reference-number-as-a-real',
        'reference-number-negative', 'lone-r',
        'xref-generation', 'header-generation', 'header-number', 'incremental-update',
        'object-stream-names-swapped', 'object-stream-offset-moved', 'object-stream-offset-as-a-real',
        'object-stream-first-as-a-real', 'object-stream-extra-object', 'object-stream-count-too-small',
        'self-reference', 'two-step-cycle',
        'bare-reference', 'reference-alone-in-an-object-stream'])
def test_objects_word_does_not_write_are_refused(tmp_path, data, problem):
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + problem)


def _duplicate_font_name(tmp_path):
    """第 1 題的答案欄留空，答案「C」用 /FS 畫；頁面的字型表寫兩個 /FS：第一個是把字碼 C 對到字形 A 的 Helvetica，
    最後一個是一般的 Helvetica。pdfminer、MuPDF 與 PDFium 取最後一個（C），Poppler 取第一個（A）（第十四輪審查實測）。"""
    rows = list(PAGE1)
    rows[1] = ('', *rows[1][1:])

    def draw(page):
        doc = page.parent
        first, last = doc.get_new_xref(), doc.get_new_xref()
        doc.update_object(first, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding<</Type/Encoding'
                                 '/BaseEncoding/WinAnsiEncoding/Differences[67/A]>>>>')
        doc.update_object(last, HELVETICA)
        _add_resource(page, 'Font', 'FQ', f'{first} 0 R')  # 存檔之後改名成第二個 /FS
        _add_resource(page, 'Font', 'FS', f'{last} 0 R')
        _append_content(page, b'BT /FS 12 Tf 0 g 1 0 0 1 59 %d Tm (C) Tj ET' % (842 - (TOP + 24 + 30)))
    data = pymupdf.open(_exam(tmp_path, [rows, PAGE2], {1: {'extras': [draw]}})).tobytes()
    assert data.count(b'/FQ ') == 1
    return data.replace(b'/FQ ', b'/FS ')


def _font_reference_generation(tmp_path):
    """字型表裡 Helvetica 的參照寫成世代號 7（兩頁都參照它，改第一個）：Poppler 找不到（xref 裡是 0），pdfminer 與
    MuPDF 照讀。"""
    doc = pymupdf.open(_two_page_exam(tmp_path))
    reference = next(line for line in doc.xref_object(_page_resources(doc[0])).split('\n') if '/helv' in line).split()
    data = doc.tobytes()
    old = f'/helv {reference[1]} 0 R'.encode()
    assert old in data
    return data.replace(old, f'/helv {reference[1]} 7 R'.encode(), 1)


@pytest.mark.parametrize('rewrite', [_duplicate_font_name, _font_reference_generation],
                         ids=['duplicate-font-name', 'reference-generation'])
def test_objects_word_does_not_write_stop_the_extraction(tmp_path, rewrite):
    exam = tmp_path / 'objects.pdf'
    exam.write_bytes(rewrite(tmp_path))
    with pytest.raises(ValueError, match='^' + SYNTAX_PROBLEM):
        extract(exam)


def _as_xref_stream(data, index, limit=None, extra=b'', index_text=None, widths=b'[1 4 2]', size=None, hybrid=False):
    """PDF（最後一段是 xref 表、物件都在檔案裡）改寫成 xref 串流：index 是 /Index 的各段 [(起頭, 筆數)]，逐筆照各段的
    順序寫那個物件的位置（沒有的是空的一筆）；limit 只寫前幾筆，extra 接在最後（資料與 /Index 的筆數對不上）；
    index_text 換掉寫出來的 /Index，widths 換掉 /W（資料照樣是每筆 7 個位元組），size 換掉 /Size；hybrid 照 Word 的
    混合 xref 再接兩段 xref 表（_word_hybrid）。"""
    start = int(data.rsplit(b'startxref', 1)[1].split()[0])
    body, trailer = data[:start], data[start:]
    root = re.search(rb'/Root (\d+) 0 R', trailer)[1]
    offsets = {int(m[1]): m.start() for m in re.finditer(rb'(?m)^(\d+) 0 obj', body)}
    own = max(offsets) + 1
    offsets[own] = len(body)
    listed = [n for first, count in index for n in range(first, first + count)][:limit]
    rows = b''.join(struct.pack('>BIH', 1, offsets[n], 0) if n in offsets
                    else struct.pack('>BIH', 0, 0, 65535 * (n == 0)) for n in listed) + extra
    ranges = index_text or b' '.join(b'%d %d' % pair for pair in index)
    stream = (body + b'%d 0 obj\n<</Type/XRef/Size %d/W%s/Index[%s]/Root %s 0 R/Length %d>>stream\n'
              % (own, size or own + 1, widths, ranges, root, len(rows)) + rows + b'\nendstream\nendobj\n')
    if hybrid:
        return _word_hybrid(stream, offsets, size or own + 1, offsets[own], int(root))
    return stream + b'startxref\n%d\n%%%%EOF\n' % offsets[own]


DUPLICATE_F1 = b'<</Font<</F1 5 0 R/F1 5 0 R>>>>'


@pytest.mark.parametrize('data', [_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 8)], hybrid=True),
                                  _as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 6), (6, 2)], hybrid=True)],
                         ids=['one-range', 'two-ranges'])  # 放在 Word 的混合 xref 裡（只有 xref 串流的，Poppler 重建時找不到 trailer）
def test_objects_listed_in_an_xref_stream_are_accepted(tmp_path, data):
    assert _syntax_of(tmp_path, data) is None


COURIER_FONT = b'<</Type/Font/Subtype/Type1/BaseFont/Courier/Encoding/WinAnsiEncoding>>'


@pytest.mark.parametrize(('data', 'problem'), [
    # #00 在 Poppler 是 C 字串的結尾：/Root#00 就是 /Root，一般的字典重複的鍵它取最後一個；pdfminer、MuPDF、PDFium 當成
    # 另一個鍵（第二十四輪審查實測：真卷的 trailer 多寫 /Root#00 指到另一個目錄，Poppler 多顯示一頁「更正」，別家照原卷）
    (_hand_pdf([*ONE_PAGE, b'<</Type/Catalog/Pages 2 0 R>>'], trailer=b'/Root#00 7 0 R'), '名稱裡有 NUL'),
    # 字型表：Poppler 取第一個（/F1#00，Courier），別家取 /F1（Helvetica）—— 第十四輪的兩個 /FS 換個寫法
    (_hand_pdf([*_one_page_with(6, b'<</Font<</F1#00 7 0 R/F1 5 0 R>>>>'), COURIER_FONT]), '名稱裡有 NUL'),
    # # 後面不是剛好兩位十六進位：pdfminer 丟掉 # 或只取那一位，Poppler 留著 # 或把下一個字吃掉
    (_hand_pdf(_one_page_with(6, b'<</Font<</F#Z1 5 0 R>>>>')), '名稱裡的 # 後面不是兩位十六進位'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F#4Z 5 0 R>>>>')), '名稱裡的 # 後面不是兩位十六進位'),
    # F 之後的字母：pdfminer 的鍵是 XG1，MuPDF 的是 X#G1（第三十五輪審查實測）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/X#G1 1>>')), '名稱裡的 # 後面不是兩位十六進位'),
    # 原始的 NUL：Poppler 在那裡斷開名稱，pdfminer 讀成名稱的一部分
    (_hand_pdf([*ONE_PAGE, b'<</Type/Catalog/Pages 2 0 R>>'], trailer=b'/Root\x00 7 0 R'), '名稱裡有 NUL'),
    # 不是 UTF-8 的名稱 pdfminer 留成 bytes：NUL 一樣擋（第二十五輪審查：這一支以前沒有樣本）
    (_hand_pdf([*ONE_PAGE, b'<</Type/Catalog/Pages 2 0 R>>'], trailer=b'/Root#00#80 7 0 R'), '名稱裡有 NUL'),
], ids=['trailer-root-hash-00', 'font-hash-00', 'hash-not-hex', 'hash-one-digit', 'hash-g', 'raw-nul',
        'nul-in-a-bytes-name'])
def test_a_name_readers_decode_differently_is_refused(tmp_path, data, problem):
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + problem)


COURIER_SIXTH = b'<</Type/Font/Subtype/Type1/BaseFont/Courier/Encoding/WinAnsiEncoding'  # 物件串流的第 6 號，不含 >>


def _media_box(box):
    """一頁的 PDF，頁面的 /MediaBox 寫成 box（原本是 [0 0 595 842]）。"""
    return _hand_pdf(_one_page_with(3, ONE_PAGE[2].replace(b'[0 0 595 842]', box)))


@pytest.mark.parametrize(('data', 'problem'), [
    # 垂直定位字元：pdfminer 當成空白（名稱、數字、關鍵字都斷在那裡），Poppler、MuPDF、PDFium 當成字的一部分（第二十五輪
    # 審查實測：真卷第 2 題 (D) 的「1」改用 /F7<VT> 這個字型畫，擷取照原卷，Poppler 顯示「提升至現有的 0 倍」）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1\x0b 5 0 R>>>>')), '物件的語法裡，詞與詞之間有垂直定位字元'),
    (_hand_pdf(_one_page_with(3, ONE_PAGE[2].replace(b'/Contents 4 0 R', b'/Contents 4\x0b0 R'))),
     '物件的語法裡，詞與詞之間有垂直定位字元'),
    # 關鍵字裡的 NUL：pdfminer 讀成關鍵字的一部分（R\x00 不是 R），Poppler 在那裡斷開（兩個詞之間的 NUL 各家都當空白）
    (_hand_pdf(_one_page_with(3, ONE_PAGE[2].replace(b'/Contents 4 0 R', b'/Contents 4 0 R\x00'))), '物件的語法裡，關鍵字裡有 NUL'),
    # 超過 127 個位元組的名稱：Poppler 超過 1 MB 就整段放棄、MuPDF 截到 4095 個位元組，pdfminer 照單全收（第二十五輪審查
    # 實測：1 MB 的名稱塞在字型表裡，Poppler 把「不」吃掉）。與內容串流的上限相同
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R/' + b'x' * 128 + b' 5 0 R>>>>')), '名稱超過 127 個位元組'),
    # 名稱照原始的寫法數，# 跳脫算三個位元組：PDFium 只讀名稱的前 255 個位元組（第二十六輪審查實測：資源字典的鍵用 #41
    # 寫 86 個 A、內容串流寫一般的 /AAA…，PDFium 找不到字型，把「不」畫成「N」，別家與擷取照原卷）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R/' + b'#41' * 43 + b' 5 0 R>>>>')), '名稱超過 127 個位元組'),
    # 數字只收 Word 的寫法：可以有負號、最多 9 位整數與 10 位小數，後面接空白或分隔字元。審查與修正時實測頁面的 /MediaBox
    # （pdfminer、MuPDF、Poppler、PDFium 讀到的）：257 個字的數字 PDFium 只讀前 256 個（842 變成 84；第二十六輪審查是
    # 透明度 /ca 讀成 0，字不見了）；2³² 以上 MuPDF 差一截、PDFium 讀成 0；單獨的負號 pdfminer 丟掉、MuPDF 與 Poppler 改用
    # 美國信紙大小、PDFium 讀成 0；--595、0.-842、842.0.5、842x 各家也不同。正號、10 位整數、11 位小數各家相同，只是
    # Word 不寫：上限遠低於各家的上限，與內容串流的數字同一種寫法
    (_media_box(b'[0 0 595 ' + b'0' * 254 + b'842]'), '物件的語法裡，數字不是 Word 的寫法'),
    (_media_box(b'[0 0 595 4294967938]'), '物件的語法裡，數字不是 Word 的寫法'),
    (_media_box(b'[0 0 595 0000000842]'), '物件的語法裡，數字不是 Word 的寫法'),
    (_media_box(b'[0 0 595 841.12345678901]'), '物件的語法裡，數字不是 Word 的寫法'),
    (_media_box(b'[0 0 595 +842]'), '物件的語法裡，數字不是 Word 的寫法'),
    (_media_box(b'[0 0 595 - 842]'), '物件的語法裡，數字不是 Word 的寫法'),
    (_media_box(b'[0 0 --595 842]'), '物件的語法裡，數字不是 Word 的寫法'),
    (_media_box(b'[0 0 595 0.-842]'), '物件的語法裡，數字不是 Word 的寫法'),
    (_media_box(b'[0 0 595 842.0.5]'), '物件的語法裡，數字不是 Word 的寫法'),
    (_media_box(b'[0 0 595 842x]'), '物件的語法裡，數字不是 Word 的寫法'),
    (_media_box(b'[0 0 595 842)]'), '物件的語法裡，數字不是 Word 的寫法'),
    # 單獨的小數點：pdfminer 丟掉（[1 . 2] 讀成 [1 2]），MuPDF 讀成 0（第三十三輪審查實測）；小數點開頭的也最多 10 位小數
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/A[1 . 2]>>')), '物件的語法裡，數字不是 Word 的寫法'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/A[.01234567891]>>')), '物件的語法裡，數字不是 Word 的寫法'),
], ids=['vt-after-a-name', 'vt-between-numbers', 'nul-in-a-keyword', 'name-of-128-bytes', 'name-of-43-escapes',
        'number-of-257-chars', 'number-past-2-to-the-32', 'number-of-10-digits', 'number-with-11-decimals', 'plus-sign',
        'lone-minus', 'double-minus', 'minus-in-a-fraction', 'two-dots', 'letter-after-a-number',
        'parenthesis-after-a-number', 'lone-point', 'point-then-11-decimals'])
def test_object_syntax_the_readers_split_differently_is_refused(tmp_path, data, problem):
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + problem)


@pytest.mark.parametrize('data', [
    _hand_pdf([*ONE_PAGE, b'(a\x0bb\x00c)']),  # 字串裡的垂直定位字元與 NUL：各家都照原樣讀
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R/' + b'x' * 127 + b' 5 0 R>>>>')),  # 127 個位元組的名稱
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R/' + b'#41' * 42 + b'x 5 0 R>>>>')),  # 原始的寫法正好 127 個位元組
    _media_box(b'[0 0 595 000000842]'),  # 9 位整數
    _media_box(b'[0 0 595 841.1234567890]'),  # 10 位小數
    _media_box(b'[-.5 0 595 842]'),  # 負號、沒有整數部分
    _media_box(b'[0 0 595. 842.]'),  # 小數點後面沒有數字
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/A[.0123456789]>>')),  # 小數點開頭、10 位小數
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R/X#4a#4B 5 0 R>>>>')),  # 名稱的 # 跳脫，大小寫都收（讀成 /XJK）
    # 數字後面接的分隔：空白、NUL、字串、註解、名稱、十六進位字串、陣列（] 與 > 每一個樣本都有）。各家切法相同（第二十七輪
    # 審查實測）
    *[_media_box(b'[0 0 595 842' + after + b']') for after in (b'\t', b'\n', b'\f', b'\r', b'\x00', b'(x)', b'%c\n', b'/N',
                                                            b'<41>', b'[1]')],
], ids=['vt-and-nul-in-a-string', 'name-of-127-bytes', 'name-of-127-raw-bytes', 'number-of-9-digits',
        'number-with-10-decimals', 'minus-point-five', 'number-ending-in-a-point', 'point-then-10-decimals',
        'name-with-hex-escapes',
        *[f'number-then-{name}' for name in ('tab', 'newline', 'form-feed', 'carriage-return', 'nul', 'string', 'comment',
                                              'name', 'hex-string', 'array')]])
def test_object_syntax_the_readers_split_the_same_way_is_accepted(tmp_path, data):
    assert _syntax_of(tmp_path, data) is None


def _stream_right_before_startxref():
    """ONE_PAGE 加一段增量更新：xref 是串流（第 8 號，/Prev 指回原本的 xref 表），第 7 號是沒有 endobj 的串流，endstream
    之後直接是 startxref（第三十二輪審查的寫法）。"""
    base = _hand_pdf(ONE_PAGE)
    prev = int(base.rsplit(b'startxref\n', 1)[1].split()[0])
    at8 = len(base)
    head = b'8 0 obj\n<</Type/XRef/Size 9/W[1 4 2]/Index[7 2]/Root 1 0 R/Prev %d/Length 14>>stream\n' % prev
    tail8 = b'\nendstream\nendobj\n'
    table = struct.pack('>BIH', 1, at8 + len(head) + 14 + len(tail8), 0) + struct.pack('>BIH', 1, at8, 0)
    return (base + head + table + tail8 + b'7 0 obj\n<</Length 1>>stream\nx\nendstream\n'
            + b'startxref\n%d\n%%%%EOF\n' % at8)


def _compressed_object_zero():
    """Word 的混合 xref：第 0 號物件登記成物件串流（第 7 號）裡的壓縮物件，頁面資源寫 /X 0 0 R（第三十三輪審查的寫法：
    pdfminer 解成那一份 Courier 字型，MuPDF 解成 null）。"""
    lf = b'\n'
    objects = {1: b'<</Type/Catalog/Pages 2 0 R>>', 2: b'<</Type/Pages/Kids[3 0 R]/Count 1>>',
               3: b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Resources<</Font<</F1 5 0 R>>/X 0 0 R>>/Contents 4 0 R>>',
               5: b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
               0: b'<</Type/Font/Subtype/Type1/BaseFont/Courier/Encoding/WinAnsiEncoding>>'}
    order = (1, 2, 3, 5, 0)
    body, offsets = b'', []
    for number in order:
        offsets.append(len(body))
        body += objects[number] + lf
    header = b' '.join(b'%d %d' % pair for pair in zip(order, offsets)) + lf
    content = b'BT /F1 24 Tf 20 40 Td (Hello) Tj ET'
    out, at = bytearray(b'%PDF-1.7' + lf), {}
    at[4] = len(out)
    out += b'4 0 obj' + lf + b'<</Length %d>>stream' % len(content) + lf + content + lf + b'endstream' + lf + b'endobj' + lf
    at[7] = len(out)
    out += (b'7 0 obj' + lf + b'<</Type/ObjStm/N %d/First %d/Length %d>>stream' % (len(order), len(header), len(header + body))
            + lf + header + body + lf + b'endstream' + lf + b'endobj' + lf)
    at[8] = len(out)
    rows = [(2, 7, order.index(0))] + [(1, at[n], 0) if n in at else (2, 7, order.index(n)) if n in order else (0, 0, 0)
                                        for n in range(1, 9)]
    table = b''.join(struct.pack('>BIH', *row) for row in rows)
    out += b'8 0 obj' + lf + b'<</Type/XRef/Size 9/W[1 4 2]/Root 1 0 R/Length %d>>stream' % len(table) + lf + table
    out += lf + b'endstream' + lf + b'endobj' + lf
    return _word_hybrid(bytes(out), at, 9, at[8])


@pytest.mark.parametrize(('data', 'problem'), [
    # 十六進位字串：遇到不是十六進位數字、也不是空白的字，pdfminer 就結束字串、接著讀下一個詞，MuPDF 一直讀到 >（第二十七輪
    # 審查實測：/Z<41/Q 1> 在 pdfminer 多了一個鍵 /Q，在 MuPDF 是一整個字串）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<41/Q 1>>>')), '物件的語法裡，十六進位字串不是 Word 的寫法'),
    # 奇數個數字：pdfminer 把最後一位當成低半位元組（<414> 是 A 與 0x04），別家補一個 0（0x40）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<414>>>')), '物件的語法裡，十六進位字串不是 Word 的寫法'),
    # 垂直定位字元：pdfminer 當成空白跳過，Poppler 與 MuPDF 不跳過；一般的空白各家都跳過，只是 Word 不寫
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<41\x0b42>>>')), '物件的語法裡，十六進位字串不是 Word 的寫法'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<41 42>>>')), '物件的語法裡，十六進位字串不是 Word 的寫法'),
    # 關鍵字只收 Word 寫的那幾個：多出來的 ) pdfminer 讀成關鍵字（字典多一個鍵），MuPDF 整個物件丟錯（第二十七輪審查實測）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/A 1 ) ) /B 2>>')), '物件的語法裡有 Word 不寫的關鍵字'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/A TRUE>>')), '物件的語法裡有 Word 不寫的關鍵字'),
    # 大括號（PostScript 的程序，Word 不寫）：寫在 trailer 裡，以前由頁面清單的檢查擋下（第二十五輪審查），物件裡的每一處都由
    # 這一條擋
    (_hand_pdf([*ONE_PAGE, b'<</Type/Catalog/Pages 2 0 R>>'], trailer=b'/X{/Root 7 0 R/Y}'), '物件的語法裡有 Word 不寫的關鍵字'),
    # 對不上的 >：單獨的 > pdfminer 默默丟掉，別家當成錯誤；十六進位字串的結尾後面緊接一個 >，pdfminer 把兩個配成字典的
    # 結尾，別家是字串的結尾加上一個單獨的 >；字典的結尾多一個 > 也一樣
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/A 1 > /B 2>>')), '物件的語法裡有對不上的 >'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<41>>/Q 1>>')), '物件的語法裡有對不上的 >'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>>>>')), '物件的語法裡有對不上的 >'),
    # 對不上的結尾：字典裡的 ]、陣列裡的 >>，pdfminer 吞掉型別不符的例外、整個丟掉，MuPDF 在那裡讀成 null 或整個物件讀不了
    # （第二十八輪審查實測：真卷的 ExtGState 寫成 /ca 0]，擷取照原卷，Poppler 與 PDFium 上整頁的字都是透明的）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/X 0]>>')), '物件的語法裡有對不上的結尾'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/A[1 2>>]>>')), '物件的語法裡有對不上的結尾'),
    (_object_stream_pdf(sixth=COURIER_SIXTH + b'/X 0]>>', hybrid=True), '物件的語法裡有對不上的結尾'),
    # 關鍵字的位置：物件串流裡的 obj、endobj pdfminer 默默丟掉（/X 0 obj 讀成 /X 0），null 讀成關鍵字（檔案裡的物件讀成
    # 空值）；字典與陣列裡只能有 R 與 null
    (_object_stream_pdf(sixth=COURIER_SIXTH + b'/X 0 obj>>', hybrid=True), '物件的語法裡，關鍵字「obj」不在它的位置'),
    (_object_stream_pdf(sixth=COURIER_SIXTH + b'/X 0 endobj>>', hybrid=True), '物件的語法裡，關鍵字「endobj」不在它的位置'),
    (_object_stream_pdf(sixth=COURIER_SIXTH + b'/X null>>', hybrid=True), '物件的語法裡，關鍵字「null」不在它的位置'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/X obj/Y 1>>')), '物件的語法裡，關鍵字「obj」不在它的位置'),
    # 檔案裡的物件寫兩個值：pdfminer 取 endobj 前面最多四個值裡的第一個、startxref 前面的最後一個，閱讀器取 obj 後面
    # 第一個（第二十九輪審查實測：真卷的 GS7 前面多一個帶 /TR 的字典，擷取照原卷，Poppler 與 PDFium 上十頁全白）
    (_hand_pdf(_one_page_with(6, b'<</X 1>> <</Font<</F1 5 0 R>>>> 1 2 3')), '物件的語法裡，物件的最上層不是剛好一個值'),
    (_hand_pdf(_one_page_with(6, b'<</X 1>> <</Font<</F1 5 0 R>>>> startxref')), '物件的語法裡，物件的最上層不是剛好一個值'),
    # 剛好兩個值：pdfminer 與閱讀器都取第一個，只是 Word 不寫（串流之外，最上層只收一個值）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>>> <</X 1>>')), '物件的語法裡，物件的最上層不是剛好一個值'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>>> xref')), '物件的語法裡，關鍵字「xref」不在它的位置'),
    (_hand_pdf([*ONE_PAGE, b'null']), '物件的語法裡，關鍵字「null」不在它的位置'),
    # 最上層只有一個關鍵字：不是值，pdfminer 把關鍵字本身當成這個物件，MuPDF 報語法錯誤
    (_hand_pdf([*ONE_PAGE, b'endstream']), '物件的語法裡，物件的最上層不是剛好一個值'),
    # 串流前面多寫的值：pdfminer 讀串流時清空堆疊，前面的值整個丟掉，讀到最後一個串流；閱讀器取 obj 後面第一個（第三十
    # 輪審查實測：真卷的浮水印圖前面多一個串流，擷取照原卷，PDFium 上浮水印那一塊整個是黑的）。串流的字典也要是字典
    (_hand_pdf([*ONE_PAGE, b'<</Length 1>>stream\nx\nendstream\n<</Length 1>>stream\ny\nendstream']),
     '物件的語法裡，物件的最上層不是剛好一個值'),
    (_hand_pdf([*ONE_PAGE, b'<</X 1>> <</Length 1>>stream\nx\nendstream']), '物件的語法裡，物件的最上層不是剛好一個值'),
    (_hand_pdf([*ONE_PAGE, b'[7 0 R] <</Length 1>>stream\nx\nendstream']), '物件的語法裡，物件的最上層不是剛好一個值'),
    (_hand_pdf([*ONE_PAGE, b'[1]stream\nx\nendstream']), '物件的語法裡，物件的最上層不是剛好一個值'),
    # 串流接 endstream 只能是 endobj 前面的樣子：之後再直接接 stream（中間沒有字典），pdfminer 讀成空的串流，MuPDF 讀
    # 第一個（第三十一輪審查實測）
    (_hand_pdf([*ONE_PAGE, b'<</Length 1>>stream\nx\nendstream\nstream\ny\nendstream']),
     '物件的語法裡，物件的最上層不是剛好一個值'),
    # 而且只能是 endobj 前面剛好這兩個值（第三十二輪審查實測）：endstream 之後還有值，pdfminer 在 endobj 取最後四個值的
    # 第一個（1），MuPDF 讀串流；物件沒有 endobj、直接接 startxref，pdfminer 讀成 endstream 這個關鍵字，MuPDF 讀串流；
    # 第一個不是串流（endstream 寫兩次），pdfminer 讀成關鍵字，MuPDF 報語法錯誤
    (_hand_pdf([*ONE_PAGE, b'<</Length 1>>stream\nx\nendstream\n1 2 3 4']), '物件的語法裡，物件的最上層不是剛好一個值'),
    (_stream_right_before_startxref(), '物件的語法裡，物件的最上層不是剛好一個值'),
    (_hand_pdf([*ONE_PAGE, b'endstream endstream']), '物件的語法裡，物件的最上層不是剛好一個值'),
    # 最上層是空的、後面又有值（7 0 obj endobj 5 endobj）：pdfminer 讀到 5，MuPDF 讀成 null（第三十三輪審查實測）
    (_hand_pdf([*ONE_PAGE, b'endobj\n5']), '物件的語法裡，物件的最上層不是剛好一個值'),
    # 參照第 0 號物件：登記成物件串流裡的壓縮物件時，pdfminer 解成那個物件，MuPDF 解成 null（第三十三輪審查實測）
    (_compressed_object_zero(), '參照不是「編號 0 R」'),
    # 字典裡值是 null 的鍵：pdfminer 整個丟掉，PDFium 把 /ca null 讀成 0（第二十九輪審查實測：真卷的 GS7 寫成 /ca null，
    # 擷取照原卷，PDFium 上十頁的字都是透明的）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z null>>')), '物件的語法裡，字典裡有值是 null 的鍵'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/ExtGState<</G<</ca null>>>>>>')), '物件的語法裡，字典裡有值是 null 的鍵'),
    # 字串裡的反斜線後面不是標準的跳脫：pdfminer 連那個字一起丟掉（CNS1\Z 讀成 CNS1），MuPDF 只丟反斜線（CNS1Z）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(CNS1\\Z)>>')), '物件的語法裡，字串裡有不標準的跳脫'),
    # 反斜線接 CR（接下一行）：CR 落在 pdfminer 緩衝區的最後一個位元組時，後面的 LF 被 pdfminer 讀進字串，閱讀器不會
    # （第三十三輪審查實測）；真實 PDF 沒有這種寫法，一律不收
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a\\\r\nb)>>')), '物件的語法裡，字串裡有不標準的跳脫'),
    # 字串裡原始的 CR：MuPDF 照 PDF 的規定讀成 LF，pdfminer、Poppler、PDFium 照原樣；真實 PDF 的物件字串裡沒有
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a\rb)>>')), '物件的語法裡，字串裡有 CR'),
    # 原始的 CR 在 pdfminer 照原樣收下的一段的頭尾：字串的第一個、最後一個位元組，跳脫的後面與反斜線的前面（第三十四輪
    # 審查實測：每一段跳過第一個位元組、少看最後一個位元組，整套照樣全綠）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(\rb)>>')), '物件的語法裡，字串裡有 CR'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(ab\r)>>')), '物件的語法裡，字串裡有 CR'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a\\n\rb)>>')), '物件的語法裡，字串裡有 CR'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a\\101\rb)>>')), '物件的語法裡，字串裡有 CR'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a\r\\nb)>>')), '物件的語法裡，字串裡有 CR'),
    # 名單外的跳脫換一個字（\v：pdfminer 讀成 ab，MuPDF、PDFium、Poppler 讀成 avb）、原始的 LF 後面的 CR、巢狀括號的
    # 每一個邊（第三十五輪審查實測：一段多在 LF 結束、只看最外層的括號、巢狀裡跳過第一個或左括號前少看一個，整套照樣全綠）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a\\vb)>>')), '物件的語法裡，字串裡有不標準的跳脫'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a\n\rb)>>')), '物件的語法裡，字串裡有 CR'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a(\rb)c)>>')), '物件的語法裡，字串裡有 CR'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(ab\r(c)d)>>')), '物件的語法裡，字串裡有 CR'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a(b)\rc)>>')), '物件的語法裡，字串裡有 CR'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a(b\r)c)>>')), '物件的語法裡，字串裡有 CR'),
    # 第三十六輪審查實測的分歧：字串裡原始的 CR LF（Word 寫的就是 CR LF：MuPDF 讀成 LF）、數字緊接 R（4 0R：MuPDF 讀成
    # null）、十六進位字串裡夾空白或兩個垂直定位字元（偶數個字：pdfminer 讀成 AB\x04、AB，閱讀器讀成 AB@、A\0B）、
    # tab 之後的垂直定位字元（pdfminer 讀成 [1 2]，MuPDF 讀成 [1 null]）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a\r\nb)>>')), '物件的語法裡，字串裡有 CR'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/X 4 0R>>')), '物件的語法裡，數字不是 Word 的寫法'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<4142 4>>>')), '物件的語法裡，十六進位字串不是 Word 的寫法'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<41\x0b\x0b42>>>')), '物件的語法裡，十六進位字串不是 Word 的寫法'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/A[1\t\x0b2]>>')), '物件的語法裡，詞與詞之間有垂直定位字元'),
    # 第三十八輪審查實測：十六進位字串每一對的第一位是空白類的字（奇數個數字：pdfminer 讀成 A\x04，閱讀器讀成 A@）
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<41\t4>>>')), '物件的語法裡，十六進位字串不是 Word 的寫法'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<41\n4>>>')), '物件的語法裡，十六進位字串不是 Word 的寫法'),
    (_hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<41\x0b4>>>')), '物件的語法裡，十六進位字串不是 Word 的寫法'),
], ids=['hex-string-ended-by-a-slash', 'hex-string-of-odd-length', 'vt-in-a-hex-string', 'space-in-a-hex-string',
        'stray-parenthesis', 'unknown-keyword', 'braces-in-the-trailer', 'lone-greater-than', 'hex-string-then-one-greater-than',
        'one-greater-than-too-many', 'bracket-ending-a-dictionary', 'dictionary-end-in-an-array',
        'bracket-ending-a-dictionary-in-an-object-stream', 'obj-in-an-object-stream', 'endobj-in-an-object-stream',
        'null-in-an-object-stream', 'obj-in-a-dictionary', 'two-values-then-endobj', 'two-values-then-startxref', 'just-two-values',
        'xref-in-an-object', 'null-object', 'keyword-as-the-only-value', 'two-streams', 'dictionary-then-a-stream',
        'array-then-a-stream', 'array-as-the-stream-dictionary', 'stream-right-after-endstream',
        'stream-endstream-then-values', 'stream-right-before-startxref', 'endstream-twice', 'empty-object-then-a-value',
        'reference-to-a-compressed-object-0', 'null-value', 'ca-null', 'unknown-escape-in-a-string', 'backslash-then-cr-lf',
        'raw-cr-in-a-string', 'raw-cr-first-in-a-string', 'raw-cr-last-in-a-string', 'raw-cr-after-an-escape',
        'raw-cr-after-an-octal-escape', 'raw-cr-before-a-backslash', 'escape-v-in-a-string', 'raw-cr-after-a-raw-lf',
        'raw-cr-after-a-nested-open', 'raw-cr-before-a-nested-open', 'raw-cr-after-a-nested-close',
        'raw-cr-before-a-nested-close', 'raw-cr-lf-in-a-string', 'number-then-r', 'hex-string-with-a-space-even',
        'hex-string-with-two-vts', 'vt-after-a-tab', 'hex-pair-tab', 'hex-pair-lf', 'hex-pair-vt'])
def test_object_syntax_pdfminer_tokenizes_differently_is_refused(tmp_path, data, problem):
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + problem)


@pytest.mark.parametrize('data', [
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<41>>>')),  # 十六進位字串之後緊接字典的結尾
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<41> >>')),
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<>>>')),  # 空的十六進位字串
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/Z<0aF1>>>')),  # 大小寫混用
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/DecodeParms null>>')),  # PyMuPDF 在圖片寫的 /DecodeParms null
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/A[null 1]>>')),  # 陣列裡的 null：pdfminer 照樣留著
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/A[1 null]>>')),  # 奇數的位置也一樣（不當成字典的值）
    # 字串裡標準的跳脫、八進位與接下一行（LF）；八進位的每一種第一位（0 到 7：4 到 7 以前沒有樣本，第三十二輪審查實測）
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a\\(b\\)c\\\\d\\ne\\rf\\tg\\bh\\fi\\101j\\\nk)>>')),
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a\\01b\\21c\\31d\\41e\\51f\\61g\\71h)>>')),
    # 字串外的 CR LF（Word 的物件裡就有）：字串前面、後面，空字串與以跳脫結尾的字串之後都照收 —— 只看字串裡的那一段
    # （第三十四輪審查實測：從緩衝區的開頭看起，12 個真實檔案全部擋下，整套照樣全綠）
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>\r\n/T(abc)>>')),
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(abc)\r\n>>')),
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T()\r\n>>')),
    _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R>>/T(a\\101)\r\n>>')),
], ids=['hex-string-then-the-end-of-a-dictionary', 'hex-string-then-a-space', 'empty-hex-string', 'mixed-case-hex-string',
        'decode-parms-null', 'null-in-an-array', 'null-at-an-odd-index', 'standard-escapes-in-a-string',
        'every-first-octal-digit', 'cr-lf-before-a-string', 'cr-lf-after-a-string', 'cr-lf-after-an-empty-string',
        'cr-lf-after-an-escape-at-the-end'])
def test_object_syntax_pdfminer_tokenizes_the_same_way_is_accepted(tmp_path, data):
    assert _syntax_of(tmp_path, data) is None


def test_the_byte_lists_of_the_object_syntax_are_pdfminers_byte_by_byte():
    # Watched 用的三份位元組名單，256 個位元組逐一與 pdfminer 自己的比（第三十五輪審查實測：跳脫多收 v、a、8、x、空白、
    # VT、N，一段多在 LF、空白、tab、數字、z 結束，# 後面多收 G，整套照樣全綠 —— 每份名單外只有一個樣本）：
    # - 反斜線後面：pdfminer 認得的跳脫（ESC_STRING）、八進位數字與 LF（接下一行）。別的字 pdfminer 連那個字一起丟掉，
    #   閱讀器只丟反斜線；CR 見 STRING_ESCAPES 的說明
    # - pdfminer 照原樣收下的一段，在它的 END_STRING 結束：名單多一個字，那個字後面的 CR 就看不到
    # - 名稱裡 # 後面的一位，就是 pdfminer 的 HEX
    every = [bytes((c,)) for c in range(256)]
    assert [b for b in every if b in STRING_ESCAPES] == [
        b for b in every if b in ESC_STRING or OCT_STRING.fullmatch(b) or b == b'\n']
    assert [b for b in every if STRING_PART.fullmatch(b)] == [b for b in every if END_STRING.fullmatch(b)]
    assert [b for b in every if NAME_HEX.fullmatch(b)] == [b for b in every if HEX.fullmatch(b)]
    # 第三十六輪審查實測，同樣只有一個名單外的樣本：詞與詞之間的垂直定位字元看 pdfminer 的 NONSPC（多收 tab：
    # [1\t\x0b2] pdfminer 讀成 [1 2]，MuPDF 讀成 [1 null]）；十六進位字串只收 pdfminer 的 HEX（多收空白：<4142 4>
    # pdfminer 讀成 AB\x04，閱讀器讀成 AB@）；數字後面只收空白（pdfminer 的 \s，垂直定位字元由詞與詞之間的那一條擋）、
    # NUL 與 ( < > [ ] / %（多收 R：4 0R pdfminer 與 Poppler 讀成參照，MuPDF 讀成 null）
    assert [b for b in every if PDFMINER_WORD.fullmatch(b)] == [b for b in every if NONSPC.fullmatch(b)]
    assert [b for b in every if HEX_STRING.fullmatch(b'4' + b)] == [b for b in every if HEX.fullmatch(b)]
    assert [b for b in every if HEX_STRING.fullmatch(b'41' + b + b'42')] == []  # 兩對之間什麼都不收（第三十七輪審查：多收 tab 照樣全綠）
    assert [b for b in every if NUMBER_END.fullmatch(b)] == [
        b for b in every if SPC.fullmatch(b) or b in (b'\0', b'(', b'<', b'>', b'[', b']', b'/', b'%')]


def test_the_escapes_a_content_string_takes_are_listed_byte_by_byte():
    # 內容串流的字串，反斜線後面只收標準的跳脫，與正好三位、不超過 \377 的八進位：256 個位元組逐一比（第三十五輪審查
    # 實測：多收 v，整套照樣全綠 —— 名單外只有 \q 一個樣本）
    def whole_string(data):
        found = TOKEN.match(data)
        return found is not None and found.lastgroup == 'string' and found.end() == len(data)
    assert [c for c in range(256) if whole_string(b'(a\\' + bytes((c,)) + b')')] == sorted(b'nrtbf()\\')
    assert [c for c in b'0123456789' if whole_string(b'(a\\' + bytes((c,)) + b'00)')] == list(b'0123')
    # 八進位的第二、三位只收 0 到 7（第三十七輪審查實測：[0-7]{2} 改成 [0-9]{2}，整套照樣全綠）
    assert [c for c in range(256) if whole_string(b'(a\\0' + bytes((c,)) + b'0)')] == list(b'01234567')
    assert [c for c in range(256) if whole_string(b'(a\\00' + bytes((c,)) + b')')] == list(b'01234567')


def test_the_classes_of_a_content_stream_are_listed_byte_by_byte():
    # 內容串流 TOKEN 與 SPACE 的每一個位置，256 個位元組逐一與明列的名單比（第三十六輪審查實測：數字後面多收 c、g、w、-，SPACE 多收
    # VT，名稱多收 NUL、VT，字串多收 CR、)，十六進位多收 NUL、VT、tab、LF、G，整套照樣全綠；數字後面多收 c 時，
    # 550 640c 這一段 Poppler 畫成一塊黑，MuPDF 與 PDFium 不畫，擷取照原卷）
    def token(data, kind):
        found = TOKEN.match(data)
        return found.end() if found is not None and found.lastgroup == kind else None
    every = range(256)
    ends = sorted(b' \t\n\f\r[]<>(/')  # 數字、名稱、運算子後面可以接的：空白與分隔字元
    assert [c for c in every if SPACE.fullmatch(bytes((c,)))] == sorted(b' \t\n\f\r')
    assert [c for c in every if token(b'1' + bytes((c,)), 'number') == 1] == ends
    assert [c for c in every if token(b'/A' + bytes((c,)), 'name') == 2] == ends
    assert [c for c in every if token(b'/A' + bytes((c,)), 'name') == 3] == sorted(
        (string.ascii_letters + string.digits + '_.+-').encode())
    assert [c for c in every if token(b'q' + bytes((c,)), 'operator') == 1] == ends
    assert [c for c in every if token(b'q' + bytes((c,)), 'operator') == 2] == sorted((string.ascii_letters + '*').encode())
    assert [c for c in every if token(b'(' + bytes((c,)) + b')', 'string') == 3] == [
        c for c in range(0x20, 0x7f) if c not in b'()\\']  # 看得見的 ASCII，括號與反斜線要跳脫
    assert [c for c in every if token(b'<4' + bytes((c,)) + b'>', 'string') == 4] == sorted(b'0123456789ABCDEFabcdef')
    # 第三十七輪審查實測，同樣只有一個名單外的樣本：開頭的字、數字的各段、名稱開頭的 /、<< 與 >>、字串與十六進位字串的
    # 結尾（0,0 g：Poppler 報錯不畫，空隙裡的「不」在 Poppler 上不見了，題幹成了「下列何者 正確」，擷取照原卷）
    first = [(c, found.lastgroup) for c in every if (found := TOKEN.match(bytes((c,)) + b' '))]
    assert first == sorted([(c, 'number') for c in b'0123456789'] + [(ord('['), 'open'), (ord(']'), 'close')]
                           + [(c, 'operator') for c in string.ascii_letters.encode()])
    assert [c for c in every if token(bytes((c,)) + b'1', 'number') == 2] == sorted(b'-.0123456789')
    assert [c for c in every if token(b'1' + bytes((c,)) + b'1', 'number') == 3] == sorted(b'.0123456789')
    assert [c for c in every if token(b'-' + bytes((c,)) + b'1', 'number') == 3] == sorted(b'.0123456789')
    assert [c for c in every if token(b'1.' + bytes((c,)) + b'1', 'number') == 4] == sorted(b'0123456789')
    assert [c for c in every if token(b'.1' + bytes((c,)) + b'1', 'number') == 4] == sorted(b'0123456789')
    assert [c for c in every if token(bytes((c,)) + b'A', 'name') == 2] == [ord('/')] and token(b'/ ', 'name') is None
    assert [c for c in every if token(b'<' + bytes((c,)), 'open') == 2] == [ord('<')]
    assert [c for c in every if token(b'>' + bytes((c,)), 'close') == 2] == [ord('>')]
    assert [c for c in every if token(b'(a' + bytes((c,)), 'string') == 3] == [ord(')')]
    assert [c for c in every if token(b'<41' + bytes((c,)), 'string') == 4] == [ord('>')]


def test_the_xref_and_rebuild_patterns_are_listed_byte_by_byte():
    # xref 表、trailer、物件的開頭、重建時跳過的空白與註解，每一個位置 256 個位元組逐一與明列的名單比（第三十七輪審查：
    # 一次多收一個字，整套照樣全綠，各家讀法沒有量到分歧 —— 照 Word 與 PyMuPDF 的寫法、各家重建的規則釘住）
    every = range(256)
    eols = [bytes((c,)) for c in every] + [bytes((c, d)) for c in every for d in every]
    space = sorted(b'\0\t\n\f\r ')  # PDF 的空白（Poppler 的 isSpace）

    def which(pattern, before, after=b''):
        return [c for c in every if pattern.fullmatch(before + bytes((c,)) + after)]
    # xref 表：每一行的行尾，欄位之間剛好一個空白，類型只有 n 與 f
    assert sorted(e for e in eols if XREF_TABLE.fullmatch(b'xref' + e)) == [b'\n', b'\r', b'\r\n']
    assert which(XREF_SUBSECTION, b'0', b'1\n') == [ord(' ')]
    assert sorted(e for e in eols if XREF_SUBSECTION.fullmatch(b'0 1' + e) and not e[:1].isdigit()) == [b'\n', b'\r', b'\r\n']
    assert sorted(e for e in eols if XREF_ENTRY.fullmatch(b'0000000000 65535 f' + e)) == [b'\r\n', b' \n', b' \r']
    assert which(XREF_ENTRY, b'0000000000 65535 ', b'\r\n') == sorted(b'fn')
    assert which(XREF_ENTRY, b'0000000000', b'65535 f\r\n') == which(XREF_ENTRY, b'0000000000 65535', b'f\r\n') == [ord(' ')]
    assert which(XREF_ENTRY, b'', b'000000000 65535 f\r\n') == sorted(b'0123456789')
    assert which(XREF_TRAILER, b'', b'trailer') == space
    # trailer：字典前後只收 CR、LF、空白；字典裡是 < > ( ) 以外的字、十六進位字串、最多一層括號的字串
    assert which(TRAILER_FORM, b'trailer', b'<<>>startxref') == which(TRAILER_FORM, b'trailer<<>>', b'startxref') == sorted(b'\r\n ')
    assert which(TRAILER_FORM, b'trailer<<', b'>>startxref') == [c for c in every if c not in b'()<>']
    assert which(TRAILER_FORM, b'trailer<</ID[<4', b'>]>>startxref') == sorted(b'0123456789ABCDEFabcdef')
    assert which(TRAILER_FORM, b'trailer<</A(', b')>>startxref') == [c for c in every if c not in b'()\\']
    assert re.fullmatch(PDF_STRING, b'(a(b)c)') and not re.fullmatch(PDF_STRING, b'(a(b(c)))')
    # 物件的開頭（xref 指到的、重建時找的）：編號與世代號之間的空白、obj 後面接的字、前導的 0、多位的世代號
    assert which(OBJECT_HEADER, b'7', b'0 obj') == which(OBJECT_HEADER, b'7 0', b'obj') == [ord(' ')]
    assert which(OBJECT_HEADER, b'7 ', b' obj') == [ord('0')]
    assert which(DEFINITION, b'7', b'0 obj') == which(DEFINITION, b'7 0', b'obj') == space
    assert [c for c in every if DEFINITION.search(b'7 0 obj' + bytes((c,)))] == [c for c in every if not bytes((c,)).isalnum()]
    assert [c for c in every if (found := DEFINITION.search(bytes((c,)) + b'7 0 obj')) and found[1] == b'7'] == [
        c for c in every if c not in b'0123456789']  # 編號前面不是數字就從這裡算起（第三十八輪審查：多收 ] 或 / 也全綠）
    assert [DEFINITION.search(text).groups() for text in (b'07 0 obj', b'7 10 obj', b'x7 0 obj', b'17 0 obj')] == [
        (b'07', b'0'), (b'7', b'10'), (b'7', b'0'), (b'17', b'0')]
    # 跳過的空白與註解（註解到 CR 或 LF 為止）、行尾、Poppler 與 C 的空白
    assert [c for c in every if FILLER.match(bytes((c,))).end() == 1] == sorted(b'\0\t\n\f\r %')
    assert [c for c in every if FILLER.match(b'%' + bytes((c,)) + b'x').end() == 2] == sorted(b'\r\n')
    assert [c for c in every if COMMENT.match(b'%a' + bytes((c,))).end() == 2] == sorted(b'\r\n')
    assert which(LINE_END, b'') == sorted(b'\r\n')
    assert sorted(POPPLER_SPACE) == space and sorted(C_SPACE) == sorted(b'\t\n\v\f\r ')
    # 物件裡的關鍵字，與不會出現在最上層的
    assert OBJECT_KEYWORDS == {b'obj', b'endobj', b'stream', b'endstream', b'R', b'xref', b'trailer', b'startxref', b'<<',
                               b'>>', b'[', b']', b'null'}
    assert NOT_ON_TOP == {b'obj', b'xref', b'trailer', b'null'}


# 參考寫法：照說明裡的文法，一個字一個字讀，不用正規式。下面三條測試拿每一種寫法的範例，連同它每一個「一個位元組的
# 變化」（每一個位置換成任一個位元組、插入任一個位元組、刪掉那個位元組），比正規式與參考寫法的判讀（第三十五到三十八輪
# 審查：每一輪都再找到一個沒釘住的位置 —— 數字的各段、名稱的第一個字、十六進位每一對的第一位、<< 與 >> 的第一個字……，
# 多收一個字整套照樣全綠；逐個位置補比對追不完，改成整個鄰域比）
_REF_SPACE = frozenset(b' \t\n\f\r')               # 內容串流的空白
_REF_ENDS = frozenset(b' \t\n\f\r[]<>(/')          # 數字、名稱、運算子後面可以接的
_REF_DIGITS = frozenset(b'0123456789')
_REF_OCTAL = frozenset(b'01234567')
_REF_HEX = frozenset(b'0123456789ABCDEFabcdef')
_REF_NAME = frozenset((string.ascii_letters + string.digits + '_.+-').encode())
_REF_LETTERS = frozenset(string.ascii_letters.encode())
_REF_VISIBLE = frozenset(c for c in range(0x20, 0x7f) if c not in b'()\\')
_REF_PDF_SPACE = frozenset(b'\0\t\n\f\r ')
_REF_EOLS = (b'\r\n', b'\r', b'\n')


def _one_byte_away(example):
    """example 本身，以及每一個位置換成任一個位元組、插入任一個位元組、刪掉那個位元組的每一種寫法"""
    yield example
    for i in range(len(example) + 1):
        for c in range(256):
            yield example[:i] + bytes((c,)) + example[i:]
            if i < len(example):
                yield example[:i] + bytes((c,)) + example[i + 1:]
        if i < len(example):
            yield example[:i] + example[i + 1:]


def _ref_run(data, i, allowed):
    while i < len(data) and data[i] in allowed:
        i += 1
    return i


def _ref_number_end(data, i, whole_max):
    """從 i 起的數字讀到哪裡：可以有負號；1 到 whole_max 位整數，後面可以接小數點與最多 10 位小數；或小數點開頭、1 到
    10 位小數。讀不成回 None"""
    k = i + (data[i:i + 1] == b'-')
    d = _ref_run(data, k, _REF_DIGITS)
    if d > k:
        if d - k > whole_max:
            return None
        if data[d:d + 1] == b'.':
            f = _ref_run(data, d + 1, _REF_DIGITS)
            return f if f - d - 1 <= 10 else None
        return d
    if data[k:k + 1] == b'.':
        f = _ref_run(data, k + 1, _REF_DIGITS)
        return f if 1 <= f - k - 1 <= 10 else None
    return None


def _ref_content_tokens(data):
    """內容串流切成 ([(種類, 位元組)], 切不下去的位置或 None)：每一個詞前後跳過空白；數字最多 6 位整數，名稱是 / 加 1 到 127 個名稱的字，數字、
    名稱、運算子後面要接空白、分隔字元或結尾；字串是 ( ) 夾 0 到 4096 個（看得見的 ASCII、標準的跳脫、0 到 3 開頭的三位
    八進位），十六進位字串是 < > 夾 0 到 4096 對；<< 與 [ 開，>> 與 ] 關；運算子是字母，可以接一個 *"""
    out, n = [], len(data)
    i = _ref_run(data, 0, _REF_SPACE)
    while i < n:
        c, j, kind = data[i], None, None
        if c in _REF_DIGITS or c in b'-.':
            kind, j = 'number', _ref_number_end(data, i, 6)
            if j is not None and j < n and data[j] not in _REF_ENDS:
                j = None
        elif c == ord('/'):
            kind, k = 'name', _ref_run(data, i + 1, _REF_NAME)
            j = k if 1 <= k - i - 1 <= 127 and (k == n or data[k] in _REF_ENDS) else None
        elif c == ord('('):
            kind, k, units = 'string', i + 1, 0
            while k < n and data[k] != ord(')'):
                if data[k] in _REF_VISIBLE:
                    k += 1
                elif data[k] == ord('\\') and k + 1 < n and data[k + 1] in b'nrtbf()\\':
                    k += 2
                elif (data[k] == ord('\\') and k + 3 < n and data[k + 1] in b'0123' and data[k + 2] in _REF_OCTAL
                      and data[k + 3] in _REF_OCTAL):
                    k += 4
                else:
                    break
                units += 1
            j = k + 1 if k < n and data[k] == ord(')') and units <= 4096 else None
        elif data[i:i + 2] == b'<<':
            kind, j = 'open', i + 2
        elif c == ord('<'):
            kind, k, pairs = 'string', i + 1, 0
            while k + 1 < n and data[k] in _REF_HEX and data[k + 1] in _REF_HEX:
                k, pairs = k + 2, pairs + 1
            j = k + 1 if k < n and data[k] == ord('>') and pairs <= 4096 else None
        elif c == ord('['):
            kind, j = 'open', i + 1
        elif data[i:i + 2] == b'>>':
            kind, j = 'close', i + 2
        elif c == ord(']'):
            kind, j = 'close', i + 1
        elif c in _REF_LETTERS:
            kind, k = 'operator', _ref_run(data, i, _REF_LETTERS)
            k += data[k:k + 1] == b'*'
            j = k if k == n or data[k] in _REF_ENDS else None
        if j is None:
            return out, i
        out.append((kind, data[i:j]))
        i = _ref_run(data, j, _REF_SPACE)
    return out, None


def _ref_string_end(data, i, nested=True):
    """從 i 的 ( 起的字串讀到哪裡（跳脫可以接任何位元組；nested 時可以有一層括號），讀不成回 None"""
    if data[i:i + 1] != b'(':
        return None
    k = i + 1
    while k < len(data):
        c = data[k]
        if c == ord(')'):
            return k + 1
        if c == ord('\\'):
            if k + 1 >= len(data):
                return None
            k += 2
        elif c == ord('('):
            k = _ref_string_end(data, k, nested=False) if nested else None
            if k is None:
                return None
        else:
            k += 1
    return None


def _ref_trailer(data):
    """trailer、CR LF 空白、<< 字典 >>（< > ( ) 以外的字、十六進位字串、一層括號的字串）、CR LF 空白、startxref"""
    if not data.startswith(b'trailer'):
        return False
    k = _ref_run(data, 7, frozenset(b'\r\n '))
    if data[k:k + 2] != b'<<':
        return False
    k += 2
    while k < len(data) and data[k:k + 2] != b'>>':
        if data[k] == ord('<'):
            h = _ref_run(data, k + 1, _REF_HEX)
            if data[h:h + 1] != b'>':
                return False
            k = h + 1
        elif data[k] == ord('('):
            k = _ref_string_end(data, k)
            if k is None:
                return False
        elif data[k] in b'<>()':
            return False
        else:
            k += 1
    if data[k:k + 2] != b'>>':
        return False
    return data[_ref_run(data, k + 2, frozenset(b'\r\n ')):] == b'startxref'


def _ref_definition(data):
    """編號、空白、世代號、空白、obj（整段；前後的字另外比）"""
    k = _ref_run(data, 0, _REF_DIGITS)
    w = _ref_run(data, k, _REF_PDF_SPACE)
    g = _ref_run(data, w, _REF_DIGITS)
    v = _ref_run(data, g, _REF_PDF_SPACE)
    return k > 0 and w > k and g > w and v > g and data[v:] == b'obj'


def _ref_subsection(data):
    first = _ref_run(data, 0, _REF_DIGITS)
    second = _ref_run(data, first + 1, _REF_DIGITS)
    return first > 0 and data[first:first + 1] == b' ' and second > first + 1 and data[second:] in _REF_EOLS


def _cut(data):  # _content_tokens 一個一個給的詞收成 ([(種類, 位元組)], 切不下去的位置或 None)，與參考讀法同一個樣子
    tokens = list(_content_tokens(data))
    return ([token for token in tokens if token[0] is not None],
            next((position for kind, position in tokens if kind is None), None))


LEFT_OVER = '內容串流最後有沒用到的運算元或沒關上的陣列、字典'


@functools.lru_cache(maxsize=4096)
def _verdicts(text):  # text 單獨讀、與接在 q Q 後面當第二段讀，_content_grammar 各怎麼說（窗裡的寫法多半切在同一處）
    return _content_grammar([text]), _content_grammar([b'q Q', text])


def _grammar_disagrees(data, reference=None):
    """_content_grammar 本身（不只是它讀的 _content_tokens）與參考讀法，這段單獨讀、與接在另一段後面讀各一次：整句訊息
    要與「參考讀法切出來的詞以一個空白接起來」的相同；參考切不下去時，那幾個詞已經有問題就是那個問題（最後有沒用到的
    運算元不算：還沒讀到結尾），不然是切不下去的那一句（第幾段、第幾個位元組、引的那幾個位元組）。第三十九輪審查實測：
    只改 _content_grammar 自己的迴圈，例如 lstrip 連 VT 一起跳過，比對複本的測試照樣全綠；第四十輪：只比位置的開頭、
    只讀一段，切詞前把 CR LF 換成 LF、引的位元組晚一個、第二段起先跳過 NUL，整套照樣全綠；第四十一輪：參考切不下去時
    擋在別處也算，切不下去的那一句換成「最後有沒用到的運算元」，整套照樣全綠"""
    tokens, stuck = reference or _ref_content_tokens(data)
    for number, head, said in zip((1, 2), ([], [b'q Q']), _verdicts(b' '.join(text for _, text in tokens))):
        if stuck is not None and said in (None, LEFT_OVER):
            said = f'內容串流第 {number} 段第 {stuck + 1} 個位元組起的 {data[stuck:stuck + 12]!r} 不是兩套 PDF 程式讀法一致的寫法'
        if _content_grammar(head + [data]) != said:
            return True
    return False


def test_the_content_tokens_follow_the_written_grammar_one_byte_away():
    examples = [b'1', b'-1', b'.5', b'-.5', b'12.25', b'123456', b'1.', b'-0.0', b'123456.1234567890', b'.1234567890',
                b'/A', b'/F1', b'/a_b.c+d-e', b'()', b'(a)', b'(a b~)', b'(\\n\\r\\t\\b\\f\\(\\)\\\\)', b'(\\101\\377\\000)',
                b'<>', b'<41>', b'<4142aF>', b'<<', b'>>', b'[', b']', b'q', b'Tj', b'T*', b'BDC',
                b'1 0 0 1 170 388 Tm', b'/F1 12 Tf', b'[(a) 1 <41>] TJ', b'<</A 1>> BDC', b'1(a)', b'/A/B', b'q[1]',
                b'0 g\n1 g', b'1\t2\r3\f4\n5', b'(a)<41>[/A]', b'<<>>', b'q\r\nQ']
    wrong = [data for example in examples for data in _one_byte_away(example)
             if _cut(data) != (reference := _ref_content_tokens(data)) or _grammar_disagrees(data, reference)]
    assert wrong == []
    # 上限：剛好在上限的、多一個單位的（太長的寫法不必窮舉鄰域）。八進位跳脫後面接八進位數字的：跳脫只吃三位，後面那位
    # 是下一個位元組（第三十八輪審查的 mutant：跳脫改成吃三到四位，4097 個位元組的字串就切成 4096 段收下）
    for data in [b'/' + b'N' * 127, b'/' + b'N' * 128, b'(' + b'a' * 4096 + b')', b'(' + b'a' * 4097 + b')',
                 b'(' + b'\\101' * 4096 + b')', b'(' + b'\\101' * 4097 + b')', b'(' + b'a' * 4094 + b'\\1014)',
                 b'(' + b'a' * 4095 + b'\\1014)', b'<' + b'00' * 4096 + b'>', b'<' + b'00' * 4097 + b'>', b'1234567',
                 b'1.12345678901', b'.12345678901']:
        assert _cut(data) == _ref_content_tokens(data) and not _grammar_disagrees(data), (data[:12], len(data))


OBJECT_REFERENCES = {  # 物件的每一種寫法與它的參考讀法：正規式對到整個 data 的話，參考讀法也要整個收下
    PDF_STRING: lambda data: _ref_string_end(data, 0) == len(data),
    HEX_STRING: lambda data: len(data) % 2 == 0 and all(c in _REF_HEX for c in data),
    OBJECT_NUMBER: lambda data: _ref_number_end(data, 0, 9) == len(data) > 0,
    TRAILER_FORM: _ref_trailer,
    XREF_TABLE: lambda data: data in [b'xref' + eol for eol in _REF_EOLS],
    XREF_SUBSECTION: _ref_subsection,
    XREF_ENTRY: lambda data: (len(data) == 20 and all(c in _REF_DIGITS for c in data[:10]) and data[10] == 32
                              and all(c in _REF_DIGITS for c in data[11:16]) and data[16] == 32 and data[17] in b'fn'
                              and data[18:] in (b' \r', b' \n', b'\r\n')),
    XREF_TRAILER: lambda data: data.endswith(b'trailer') and all(c in _REF_PDF_SPACE for c in data[:-7]),
    OBJECT_HEADER: lambda data: (k := _ref_run(data, 0, _REF_DIGITS)) > 0 and data[k:] == b' 0 obj',
    DEFINITION: _ref_definition,
}


def _object_disagreements(examples):  # {寫法: [範例]}：每一個範例的一個位元組的鄰域裡，正規式與參考讀法判讀不同的
    return [(re.compile(pattern).pattern[:12], data) for pattern, each in examples.items() for example in each
            for data in _one_byte_away(example)
            if bool(re.compile(pattern).fullmatch(data)) != OBJECT_REFERENCES[pattern](data)]


def test_the_object_syntax_patterns_follow_the_written_grammar_one_byte_away():
    # 物件裡十六進位字串的內容：偶數個十六進位數字；物件裡的數字：最多 9 位整數（第三十八輪審查實測：每一對的第一位多收
    # tab、LF、CR、FF、VT，<41 tab 4> pdfminer 讀成 A\x04，閱讀器讀成 A@，整套照樣全綠）
    assert _object_disagreements({
        HEX_STRING: [b'', b'41', b'4142', b'aF09'],
        OBJECT_NUMBER: [b'1', b'-1', b'123456789', b'1.5', b'.5', b'-.5', b'1.', b'123456789.1234567890', b'.1234567890'],
    }) == []


def test_the_xref_and_trailer_patterns_follow_the_written_grammar_one_byte_away():
    assert _object_disagreements({
        XREF_TABLE: [b'xref\n', b'xref\r\n', b'xref\r'],
        XREF_SUBSECTION: [b'0 1\n', b'0 12\r\n', b'15 3\r'],
        XREF_ENTRY: [b'0000000000 65535 f\r\n', b'0000000015 00000 n \n', b'0000012345 00001 n \r'],
        XREF_TRAILER: [b'trailer', b'\r\n trailer', b'\0\t\f trailer'],
        OBJECT_HEADER: [b'7 0 obj', b'12 0 obj'],
        DEFINITION: [b'7 0 obj', b'12\n0\robj', b'7\0\t12 obj'],
        PDF_STRING: [b'()', b'(a)', b'(a(b)c)', b'(a\\)b)', b'(\\(\\\\)', b'((x))', b'(a(\\)b)c)'],
        TRAILER_FORM: [b'trailer<<>>startxref', b'trailer\r\n<</Size 7/Root 1 0 R/ID[<4142><43>]>>\nstartxref',
                       b'trailer <</A(a(b)c)/B(\\)x)>> startxref', b'trailer<</ID[<414>(z)]>>startxref',
                       b'trailer<</A(a(\\)b)c)>>startxref'],
    }) == []


def _two_bytes(before, after):  # before + 任兩個位元組 + after：65,536 種
    return (before + bytes((c, d)) + after for c in range(256) for d in range(256))


# 兩個位元組的窗：一個位元組的鄰域碰不到要兩個位元組才成立的寫法（第三十九輪審查實測：字串多收「\ CR LF」、十六進位
# 字串兩對之間多收 CR LF，整套照樣全綠；CR 落在 pdfminer 緩衝區的最後一個位元組時，pdfminer 把 LF 收進字串。第四十輪：
# 窗只放在挑出來的位置時，負號之後、小數點之後多收 CR LF，整套照樣全綠 —— - CR LF 1 g：pdfminer 讀成白字，Poppler、
# PDFium 不畫，題幹在 Poppler 上成了「下列何者 正確」，擷取照原卷。第四十一輪：串流的結尾、<< >> [ ] 之後，物件寫法的
# 開頭與結尾、分隔字元的前後沒有窗，那裡多收兩個 VT、NUL 或 CR LF，整套照樣全綠）。窗放在寫法（正規式）的每一個字
# 之後 —— 參考讀法的狀態相同、正規式的位置不同的也各放一個（只在 >> 之後多收兩個 VT 的寫法，參考讀法在 >> 之後與字串
# 之後是同一個狀態），窗的後面把那個結構寫完（例如八進位第一位之後接 00)）。內容串流：串流的開頭、結尾（空白之後、
# 字串之後），每一種詞之後；數字的負號（與負號接小數點）、整數的數字、小數點、小數的數字、開頭的小數點與它後面的數字，
# 名稱的 / 與名稱的字，字串的 (、一般的字、反斜線（後面接簡單的跳脫、接八進位）、簡單的跳脫、八進位的每一位，十六進位
# 字串的 <、一對的第一位與第二位，<< 與 >> 的兩個字之間，運算子的字母與 *。關鍵字的字母之間不放
CONTENT_WINDOWS = {
    'token-start': (b'', b' '),
    'between-tokens': (b'q', b'Q'),
    'end-after-a-space': (b'q ', b''),
    'end-after-a-string': (b'()', b''),
    'after-a-string': (b'()', b'Q'),
    'after-a-hex-string': (b'<>', b'Q'),
    'after-double-less-than': (b'<<', b' '),
    'after-double-greater-than': (b'>>', b' '),
    'after-an-open-bracket': (b'[', b' '),
    'after-a-close-bracket': (b']', b' '),
    'number-after-minus': (b'-', b'1 g'),
    'number-after-minus-and-the-point': (b'-.', b'5 g'),
    'number-after-a-digit': (b'1', b' g'),
    'number-after-the-point': (b'1.', b'5 g'),
    'number-after-a-decimal': (b'1.5', b' g'),
    'number-after-a-leading-point': (b'.', b'5 g'),
    'number-after-a-leading-point-digit': (b'.5', b' g'),
    'name-after-the-slash': (b'/', b'A '),
    'name-after-a-character': (b'/A', b' '),
    'string-after-the-open': (b'(', b')'),
    'string-after-a-character': (b'(a', b')'),
    'string-after-a-backslash': (b'(a\\', b')'),
    'string-escape-after-the-backslash': (b'(\\', b'n)'),
    'string-octal-after-the-backslash': (b'(\\', b'000)'),
    'string-after-an-escape': (b'(\\n', b')'),
    'string-after-octal-digit-1': (b'(\\0', b'00)'),
    'string-after-octal-digit-2': (b'(\\00', b'0)'),
    'string-after-an-octal-escape': (b'(\\000', b')'),
    'hex-after-the-open': (b'<', b'>'),
    'hex-inside-a-pair': (b'<4', b'1>'),
    'hex-between-pairs': (b'<41', b'42>'),
    'inside-double-less-than': (b'<', b'<'),
    'inside-double-greater-than': (b'>', b'>'),
    'operator-after-the-star': (b'T*', b' '),
}


@pytest.mark.parametrize(('before', 'after'), CONTENT_WINDOWS.values(), ids=CONTENT_WINDOWS.keys())
def test_the_content_tokens_follow_the_written_grammar_two_bytes_at_a_time(before, after):
    # _content_tokens 與 _content_grammar 都比（第四十一輪審查實測：窗只比 _content_tokens，_content_grammar 切詞前把
    # 「- CR LF」換成「-」，整套照樣全綠，- CR LF 1 g 通過整條管線）
    assert [data for data in _two_bytes(before, after)
            if _cut(data) != (reference := _ref_content_tokens(data)) or _grammar_disagrees(data, reference)] == []


# 物件的窗：每一種寫法的開頭與結尾，每一段（關鍵字、數字、空白、行尾、字典的 << 與 >>、字串、十六進位字串）的前後，
# 兩個位元組的行尾與 << >> 的兩個字之間，一個位元組的空白與行尾另外有一個換成兩個位元組的窗；字串（兩層括號）的 (、
# 一般的字、反斜線、跳脫、)，十六進位字串一對的第一位與第二位，數字的每一個字，trailer 字典裡的一般字
OBJECT_WINDOWS = {
    'string-start': (PDF_STRING, b'', b'()'),
    'string-inside': (PDF_STRING, b'(', b')'),
    'string-after-a-character': (PDF_STRING, b'(a', b')'),
    'string-after-a-backslash': (PDF_STRING, b'(a\\', b')'),
    'string-after-an-escape': (PDF_STRING, b'(\\n', b')'),
    'string-nested': (PDF_STRING, b'(a(', b')b)'),
    'string-nested-after-a-character': (PDF_STRING, b'(a(b', b')c)'),
    'string-nested-after-a-backslash': (PDF_STRING, b'(a(\\', b')b)'),
    'string-nested-after-an-escape': (PDF_STRING, b'(a(\\n', b')c)'),
    'string-after-a-nested-string': (PDF_STRING, b'(a()', b'b)'),
    'string-end': (PDF_STRING, b'()', b''),
    'hex-start': (HEX_STRING, b'', b'41'),
    'hex-inside-a-pair': (HEX_STRING, b'4', b'1'),
    'hex-between-pairs': (HEX_STRING, b'41', b'42'),
    'hex-end': (HEX_STRING, b'41', b''),
    'number-start': (OBJECT_NUMBER, b'', b'1'),
    'number-after-minus': (OBJECT_NUMBER, b'-', b'1'),
    'number-after-minus-and-the-point': (OBJECT_NUMBER, b'-.', b'5'),
    'number-after-a-digit': (OBJECT_NUMBER, b'1', b''),
    'number-after-the-point': (OBJECT_NUMBER, b'1.', b'5'),
    'number-after-a-decimal': (OBJECT_NUMBER, b'1.5', b''),
    'number-after-a-leading-point': (OBJECT_NUMBER, b'.', b'5'),
    'number-after-a-leading-point-digit': (OBJECT_NUMBER, b'.5', b''),
    'trailer-start': (TRAILER_FORM, b'', b'trailer<<>>startxref'),
    'trailer-after-the-keyword': (TRAILER_FORM, b'trailer', b'<<>>startxref'),
    'trailer-inside-double-less-than': (TRAILER_FORM, b'trailer<', b'<>>startxref'),
    'trailer-after-double-less-than': (TRAILER_FORM, b'trailer<<', b'>>startxref'),
    'trailer-after-a-character': (TRAILER_FORM, b'trailer<</A', b'>>startxref'),
    'trailer-hex-after-the-open': (TRAILER_FORM, b'trailer<</ID[<', b'>]>>startxref'),
    'trailer-hex-between-digits': (TRAILER_FORM, b'trailer<</ID[<4', b'1>]>>startxref'),
    'trailer-after-a-hex-string': (TRAILER_FORM, b'trailer<</ID[<41>', b']>>startxref'),
    'trailer-string-inside': (TRAILER_FORM, b'trailer<</A(', b')>>startxref'),
    'trailer-string-after-a-backslash': (TRAILER_FORM, b'trailer<</A(\\', b')>>startxref'),
    'trailer-after-a-string': (TRAILER_FORM, b'trailer<</A()', b'>>startxref'),
    'trailer-inside-double-greater-than': (TRAILER_FORM, b'trailer<<>', b'>startxref'),
    'trailer-after-the-dictionary': (TRAILER_FORM, b'trailer<<>>', b'startxref'),
    'trailer-end': (TRAILER_FORM, b'trailer<<>>startxref', b''),
    'xref-start': (XREF_TABLE, b'', b'xref\n'),
    'xref-before-the-line-end': (XREF_TABLE, b'xref', b'\n'),
    'xref-line-end': (XREF_TABLE, b'xref', b''),
    'xref-inside-the-line-end': (XREF_TABLE, b'xref\r', b'\n'),
    'xref-end': (XREF_TABLE, b'xref\n', b''),
    'xref-subsection-start': (XREF_SUBSECTION, b'', b'0 1\n'),
    'xref-subsection-before-the-space': (XREF_SUBSECTION, b'0', b' 1\n'),
    'xref-subsection-between-the-numbers': (XREF_SUBSECTION, b'0', b'1\n'),
    'xref-subsection-after-the-space': (XREF_SUBSECTION, b'0 ', b'1\n'),
    'xref-subsection-before-the-line-end': (XREF_SUBSECTION, b'0 1', b'\n'),
    'xref-subsection-line-end': (XREF_SUBSECTION, b'0 1', b''),
    'xref-subsection-inside-the-line-end': (XREF_SUBSECTION, b'0 1\r', b'\n'),
    'xref-subsection-end': (XREF_SUBSECTION, b'0 1\n', b''),
    'xref-entry-start': (XREF_ENTRY, b'', b'0000000000 65535 f\r\n'),
    'xref-entry-before-the-first-space': (XREF_ENTRY, b'0000000000', b' 65535 f\r\n'),
    'xref-entry-after-the-offset': (XREF_ENTRY, b'0000000000', b'65535 f\r\n'),
    'xref-entry-after-the-first-space': (XREF_ENTRY, b'0000000000 ', b'65535 f\r\n'),
    'xref-entry-before-the-second-space': (XREF_ENTRY, b'0000000000 65535', b' f\r\n'),
    'xref-entry-after-the-generation': (XREF_ENTRY, b'0000000000 65535', b'f\r\n'),
    'xref-entry-after-the-second-space': (XREF_ENTRY, b'0000000000 65535 ', b'f\r\n'),
    'xref-entry-before-the-line-end': (XREF_ENTRY, b'0000000000 65535 f', b'\r\n'),
    'xref-entry-line-end': (XREF_ENTRY, b'0000000000 65535 f', b''),
    'xref-entry-inside-the-line-end': (XREF_ENTRY, b'0000000000 65535 f\r', b'\n'),
    'xref-entry-inside-the-spaced-line-end': (XREF_ENTRY, b'0000000000 65535 f ', b'\n'),
    'xref-entry-end': (XREF_ENTRY, b'0000000000 65535 f\r\n', b''),
    'xref-trailer-start': (XREF_TRAILER, b'', b'trailer'),
    'xref-trailer-end': (XREF_TRAILER, b'trailer', b''),
    'object-header-start': (OBJECT_HEADER, b'', b'7 0 obj'),
    'object-header-before-the-first-space': (OBJECT_HEADER, b'7', b' 0 obj'),
    'object-header-after-the-number': (OBJECT_HEADER, b'7', b'0 obj'),
    'object-header-after-the-first-space': (OBJECT_HEADER, b'7 ', b'0 obj'),
    'object-header-before-the-second-space': (OBJECT_HEADER, b'7 0', b' obj'),
    'object-header-after-the-generation': (OBJECT_HEADER, b'7 0', b'obj'),
    'object-header-after-the-second-space': (OBJECT_HEADER, b'7 0 ', b'obj'),
    'object-header-end': (OBJECT_HEADER, b'7 0 obj', b''),
    'definition-start': (DEFINITION, b'', b'7 0 obj'),
    'definition-before-the-first-space': (DEFINITION, b'7', b' 0 obj'),
    'definition-instead-of-the-first-space': (DEFINITION, b'7', b'0 obj'),
    'definition-after-the-first-space': (DEFINITION, b'7 ', b'0 obj'),
    'definition-before-the-second-space': (DEFINITION, b'7 0', b' obj'),
    'definition-instead-of-the-second-space': (DEFINITION, b'7 0', b'obj'),
    'definition-after-the-second-space': (DEFINITION, b'7 0 ', b'obj'),
    'definition-end': (DEFINITION, b'7 0 obj', b''),
}


@pytest.mark.parametrize(('pattern', 'before', 'after'), OBJECT_WINDOWS.values(), ids=OBJECT_WINDOWS.keys())
def test_the_object_patterns_follow_the_written_grammar_two_bytes_at_a_time(pattern, before, after):
    compiled, reference = re.compile(pattern), OBJECT_REFERENCES[pattern]
    assert [data for data in _two_bytes(before, after) if bool(compiled.fullmatch(data)) != reference(data)] == []


def test_every_object_pattern_has_windows_at_its_start_and_its_end():
    # 有參考讀法的寫法都有窗（第四十一輪審查：xref 表的開頭、trailer 前面的空白、物件裡的數字、物件的定義有參考讀法，
    # 卻沒有任何窗）
    starts = {pattern for pattern, before, _ in OBJECT_WINDOWS.values() if before == b''}
    ends = {pattern for pattern, _, after in OBJECT_WINDOWS.values() if after == b''}
    assert starts == ends == set(OBJECT_REFERENCES)


def test_the_content_grammar_reads_each_token_as_it_is_cut():
    # 遇到第一個問題就停，不先把整段切完（第四十輪審查實測：先切成串列再讀，壓縮後 123 KB 的 PDF 要 45 秒、2.5 GB）。
    # 擋下的與收下的各一段，記憶體的高點都不隨長度長大。已經在追蹤時（PYTHONTRACEMALLOC），從現在的用量算起，也不替
    # 呼叫者關掉追蹤（第四十一輪審查實測：取到的是整個程序到現在的高點，必定轉紅）
    refused, accepted = b'1 Q' + b' 0 0 m' * 500_000, b' 0 0 m' * 50_000
    tracing = tracemalloc.is_tracing()
    if not tracing:
        tracemalloc.start()
    try:
        base = tracemalloc.get_traced_memory()[0]
        tracemalloc.reset_peak()
        assert _content_grammar([refused]) == '內容串流的運算子「Q」接了 1 個運算元（數字），應為 0 個'
        assert _content_grammar([accepted]) is None
        peak = tracemalloc.get_traced_memory()[1] - base
    finally:
        if not tracing:
            tracemalloc.stop()
    assert peak < 1_000_000, peak


@pytest.mark.parametrize(('tail', 'problem'), [(b'/Z<41>>>', None), (b'/X<</Y 1>>>>', None),
                                                (b'/Z<41>>/Q 1>>', '物件的語法裡有對不上的 >')],
                         ids=['hex-string-then-the-end-of-a-dictionary', 'nested-dictionaries-closing-together',
                              'hex-string-then-one-greater-than'])
def test_runs_of_greater_than_are_paired_across_pdfminers_buffer(tmp_path, tail, problem):
    # pdfminer 一次讀 4096 個位元組（從物件的開頭算）：兩個 > 配成字典的結尾、而那一對正好是緩衝區的最後兩個位元組時，
    # 要看下一個緩衝區的第一個位元組，才知道這一串 > 有沒有完（Watched._peek），看完要放回原位（不然 pdfminer 跳過
    # 那個位元組：>>>> 只剩三個，第二十八輪審查實測）。前面墊一個字串，讓這幾個 > 落在邊界前後
    prefix = b'6 0 obj' + b'\n' + b'<</Font<</F1 5 0 R>>/P('
    for pad in range(4096 - len(prefix) - 16, 4096 - len(prefix)):
        got = _syntax_of(tmp_path, _hand_pdf(_one_page_with(6, prefix[8:] + b'x' * pad + b')' + tail)))
        assert (got is None) if problem is None else (got or '').startswith(SYNTAX_PROBLEM + problem), pad


def test_a_vertical_tab_at_the_end_of_pdfminers_buffer_is_refused(tmp_path):
    # 垂直定位字元落在 pdfminer 一個緩衝區的最後幾個位元組、後面只剩空白時，Watched._parse_main 找不到下一個詞，看的是
    # 這一段剩下的全部（第三十二輪審查實測：那一支不看，整套照樣全綠，pdfminer 讀到 /G1，MuPDF 讀到 /G1 加垂直定位
    # 字元）。前面墊一個字串，讓第 7 號物件 /G1 後面的垂直定位字元落在第一段的結尾前後
    lead = b'7 0 obj' + b'\n' + b'<</P('
    for pad in range(4096 - len(lead) - 8, 4096 - len(lead) + 2):
        got = _syntax_of(tmp_path, _hand_pdf([*ONE_PAGE, lead[8:] + b'x' * pad + b')/G1' + bytes((11,)) + b' 1>>']))
        assert (got or '').startswith(SYNTAX_PROBLEM + '物件的語法裡，詞與詞之間有垂直定位字元'), pad


def test_a_backslash_and_cr_at_the_end_of_pdfminers_buffer_is_refused(tmp_path):
    # 反斜線接 CR LF，CR 落在 pdfminer 第一段緩衝區的結尾前後：pdfminer 只有在 LF 也在同一段時才一起跳過，否則把 LF 讀進
    # 字串（第三十三輪審查實測：CR 在物件的第 4095 個位元組時，pdfminer 多讀一個 LF，MuPDF、Poppler、PDFium 都沒有）
    lead = b'7 0 obj' + b'\n' + b'<</T('
    for pad in range(4096 - len(lead) - 5, 4096 - len(lead)):
        got = _syntax_of(tmp_path, _hand_pdf([*ONE_PAGE, lead[8:] + b'x' * pad + b'a\\\r\nb)>>']))
        assert (got or '').startswith(SYNTAX_PROBLEM + '物件的語法裡，字串裡有不標準的跳脫'), pad


def test_a_raw_cr_in_a_string_across_pdfminers_buffer_is_refused(tmp_path):
    # 字串裡原始的 CR 之後，字串一路跨過 pdfminer 第一段緩衝區的結尾（這一段裡沒有括號或反斜線）：看的是這一段剩下的
    # 全部，那個 CR 照樣擋（只看到下一個括號或反斜線為止，這種寫法就整個漏掉）。CR 從第一段結尾前 8 個位元組一路到
    # 第二段的第一個位元組：那裡是新的一段的開頭（第三十四輪審查實測：每一段跳過第一個位元組，整套照樣全綠）
    lead = b'7 0 obj' + b'\n' + b'<</T('
    for pad in range(4096 - len(lead) - 8, 4096 - len(lead) + 1):
        got = _syntax_of(tmp_path, _hand_pdf([*ONE_PAGE, lead[8:] + b'x' * pad + b'\r' + b'y' * 16 + b')>>']))
        assert (got or '').startswith(SYNTAX_PROBLEM + '物件的語法裡，字串裡有 CR'), pad


def test_a_real_number_across_pdfminers_buffer_is_accepted(tmp_path):
    # 實數被 pdfminer 的緩衝區切開（595|.123、595.1|23……）：讀完整個數字才比對寫法（第三十二輪審查：讀到一半就比對，
    # 整套照樣全綠）
    lead = b'7 0 obj' + b'\n' + b'<</P('
    for pad in range(4096 - len(lead) - 15, 4096 - len(lead) - 3):
        assert _syntax_of(tmp_path, _hand_pdf([*ONE_PAGE, lead[8:] + b'x' * pad + b')/A 595.123>>'])) is None, pad


def _edit_trailer(data, which, before=b'', after=lambda dictionary: b''):
    """第 which 個 trailer（從 0 數）的「trailer」前面接 before、字典後面接 after(字典)；最後的 startxref 跟著指到最後
    一段 xref 表。"""
    found = list(re.finditer(rb'trailer\s*(<<(?:[^<>]|<[0-9A-Fa-f]*>)*>>)', data))[which]
    data = data[:found.start()] + before + data[found.start():found.end()] + after(found[1]) + data[found.end():]
    table = [m.start() for m in re.finditer(rb'(?m)^xref\r?$', data)][-1]
    head, tail = data.rsplit(b'startxref', 1)
    return head + b'startxref' + re.sub(rb'\d+', b'%d' % table, tail, count=1)


def _stream_then_again(dictionary):  # trailer 字典後面接一個串流，再寫一次同一個字典
    return b'stream\nx\nendstream\n' + dictionary


@pytest.mark.parametrize(('data', 'problem'), [
    # 字典後面接一個串流、再一個字典：startxref 前面不只一個值，物件那一層就擋下（第二十九輪）
    (_edit_trailer(_hand_pdf(ONE_PAGE), 0, after=_stream_then_again), '物件的語法裡，物件的最上層不是剛好一個值'),
    (_edit_trailer(_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 8)], hybrid=True), 0, after=_stream_then_again),
     '物件的語法裡，物件的最上層不是剛好一個值'),
    (_edit_trailer(_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 8)], hybrid=True), -1, after=_stream_then_again),
     '物件的語法裡，物件的最上層不是剛好一個值'),
    # 巢狀的字典（/Root 直接寫目錄）、字典與 startxref 之間的註解（各家都跳過，只是 Word 不寫）：只有這一條擋得到
    (_hand_pdf(ONE_PAGE).replace(b'/Root 1 0 R', b'/Root<</Type/Catalog/Pages 2 0 R>>'), 'trailer 不是 Word 的寫法'),
    (_hand_pdf(ONE_PAGE).replace(b'>>' + bytes([10]) + b'startxref', b'>>' + bytes([10]) + b'%c' + bytes([10]) + b'startxref'),
     'trailer 不是 Word 的寫法'),
], ids=['table', 'hybrid-first', 'hybrid-last', 'nested-dictionary', 'comment-before-startxref'])
def test_a_trailer_not_followed_by_startxref_is_refused(tmp_path, data, problem):
    # pdfminer 取 startxref 之前最後一個物件（第二個字典），Poppler 只讀 trailer 後面第一個，讀到的是串流、不是字典 ——
    # 開檔就重建、找不到 trailer，整份打不開（第二十四輪審查實測，三份真卷改寫）。只收 Word 的寫法：一個字典，接著 startxref
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + problem)


@pytest.mark.parametrize('data', [
    _edit_trailer(_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 8)], hybrid=True), 0, before=b'  '),
    _edit_trailer(_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 8)], hybrid=True), -1, before=b'  '),
], ids=['first-indented', 'last-indented'])
def test_one_trailer_poppler_can_read_is_enough(tmp_path, data):
    # 混合 xref 的兩個 trailer 只有一個前面有空白：Poppler 重建時讀得到另一個（原樣與強迫重建都正常，第二十四輪審查實測）
    assert _syntax_of(tmp_path, data) is None


@pytest.mark.parametrize('data', [
    _hand_pdf(ONE_PAGE, trailer=b'/ID[<5C0F627E>(@\\207>d/\\374\\002)]'),
    _hand_pdf(ONE_PAGE, trailer=b'/ID[(a(b)c)(d\\)e)]'),
], ids=['string-with-greater-than', 'nested-and-escaped-parens'])
def test_a_trailer_with_an_id_written_as_a_string_is_accepted(tmp_path, data):
    # PyMuPDF 的 /ID 有時寫成一般的字串，隨機的位元組裡剛好有 >（整套測試偶爾轉紅，在 Python 3.14 上撞到）：字串裡的
    # < > 與括號照收，字典本身仍然不巢狀、後面接著 startxref
    assert _syntax_of(tmp_path, data) is None


REBUILT_PROBLEM = 'PDF 的 xref 表壞了'


@pytest.mark.parametrize(('data', 'problem'), [
    # /Index 有兩段時，pdfminer 的 get_objids 每一段都從資料的開頭重新數：第二段的第 6 號物件以前整個沒有查
    # （第十五輪審查實測：答案 C 在 Poppler 上畫成 A，擷取照樣是 C）
    (_as_xref_stream(_hand_pdf(_one_page_with(6, DUPLICATE_F1)), [(0, 6), (6, 2)]),
     SYNTAX_PROBLEM + '字典裡同一個鍵寫了兩次（/F1）'),
    # 兩段重疊：同一個物件登記兩次，pdfminer 取第一筆，別的程式不一定
    (_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 8), (6, 2)]), SYNTAX_PROBLEM + '第 6 號物件在 xref 串流的 /Index 裡登記了兩次'),
    # 資料的筆數與 /Index 對不上：多出位元組、不是整數的筆數（true 在 pdfminer 是 1、在 MuPDF 是 0，之後每一筆差一列，
    # 第十六輪審查實測）；MuPDF 讀不下去、自己重建的（說有一百萬筆、每筆 0 個位元組、負的編號）直接報 xref 壞了。
    # 每一條規則本身另見 _listed 的單元測試
    (_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 8)], extra=b'\x00' * 7),
     SYNTAX_PROBLEM + 'xref 串流的 /Index 與資料的筆數對不上'),
    (_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 8)], index_text=b'0 8.0'), SYNTAX_PROBLEM + 'xref 串流的 /Index 與資料的筆數對不上'),
    (_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 1), (1, 7)], index_text=b'0 true 1 7'),
     SYNTAX_PROBLEM + 'xref 串流的 /Index 與資料的筆數對不上'),
    (_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 8), (8, 10 ** 6)], limit=8), REBUILT_PROBLEM),
    (_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 10 ** 6)], limit=0, widths=b'[0 0 0]'), REBUILT_PROBLEM),
    (_as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 8), (-3, 2)]), REBUILT_PROBLEM),
], ids=['object-in-the-second-range', 'overlapping-ranges', 'bytes-past-the-last-entry', 'count-as-a-real',
        'count-as-a-boolean', 'a-million-entries-claimed', 'entries-of-no-bytes', 'negative-range'])
def test_objects_listed_in_an_xref_stream_word_does_not_write_are_refused(tmp_path, data, problem):
    assert (_syntax_of(tmp_path, data) or '').startswith(problem)


def _xref_stream(ranges, entlen=7, entries=None):
    """pdfminer 讀到的一段 xref 串流（_listed 只看 ranges、entlen 與解壓縮後的 data）。"""
    count = sum(count for _, count in ranges) if entries is None else entries
    return SimpleNamespace(ranges=ranges, entlen=entlen, data=bytes(entlen * count))


@pytest.mark.parametrize(('xref', 'listed'), [
    (SimpleNamespace(get_objids=lambda: [3, 1]), [3, 1]),        # xref 表照 pdfminer 的 get_objids
    (_xref_stream([(0, 3)]), [0, 1, 2]),
    (_xref_stream([(0, 2), (5, 2)]), [0, 1, 5, 6]),                 # 各段累加（pdfminer 的 get_objids 在這裡數錯）
    (_xref_stream([(0, 3)], entries=4), None),                      # 資料多一筆
    (_xref_stream([(0, 3)], entries=2), None),                      # 資料少一筆
    (_xref_stream([(0, 10 ** 6)], entries=8), None),                # 說有一百萬筆，資料只有八筆
    (_xref_stream([(0, 100_001)]), None),                           # 資料也有那麼多，但超過 OBJECTS
    (_xref_stream([(0, 3)], entlen=0), None),                       # 每筆 0 個位元組：筆數怎麼說都對得上資料
    (_xref_stream([(-3, 3)]), None),
    (_xref_stream([(0, 3.0)], entries=3), None),
    (_xref_stream([(0, True), (1, 2)], entries=3), None),           # true 在 pdfminer 是 1、在 MuPDF 是 0
], ids=['table', 'one-range', 'two-ranges', 'data-too-long', 'data-too-short', 'a-million-entries-claimed',
        'over-the-limit', 'entries-of-no-bytes', 'negative-start', 'count-as-a-real', 'count-as-a-boolean'])
def test_the_entries_of_an_xref_stream_are_listed_the_way_get_pos_counts_them(xref, listed):
    assert _listed(xref) == listed


@pytest.mark.parametrize(('table', 'standard'), [
    (b'xref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer', True),        # PyMuPDF、手寫的寫法
    (b'xref\r\n0 2\r\n0000000000 65535 f\r\n0000000009 00000 n\r\ntrailer', True),  # Word
    (b'xref\n0 1\n0000000000 65535 f \n\ntrailer', True),                           # trailer 前空一行（PyMuPDF）
    (b'xref\r\n0 0\r\ntrailer', True),                                              # Word 最後那一段是空的
    (b'xref\n0 1\n0000000000 65535 f \n5 1\n0000000009 00000 n \ntrailer', True),  # 兩個不重疊的子段
    (b'xref\n0 2\n0000000000 65535 f\n0000000009 00000 n\ntrailer', False),         # 19 個位元組：PDFium 自己掃描
    (b'xref\n0 2\n0000000000 65535 f \n0000000009 00000 nx\ntrailer', False),       # pdfminer 跳過、MuPDF 當成 n
    (b'xref\n0 2\n0000000000 65535 f \n0000000009 00000 o \ntrailer', False),       # 只有 MuPDF 認得
    (b'xref\n0 2\n0000000000 65535 f \n0000000009 00000 n \n1 1\n0000000019 00000 n \ntrailer', False),
    (b'xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \ntrailer', False),       # 少一筆
    (b'xref\n0 1\n0000000000 65535 f \n0000000009 00000 n \ntrailer', False),       # 多一筆
    (b'xref\n0 1\n0000000000 65535 f \n', False),                                   # 沒有 trailer
    (b' xref\n0 1\n0000000000 65535 f \ntrailer', False),                            # startxref 沒有指到 xref
    (b'xref\n0 100001\n0000000000 65535 f \ntrailer', False),                        # 超過 OBJECTS
    (b'xref\n0 2\n0000000000 65535 f \n0000000009 00000 n\n\ntrailer', False),       # 20 個位元組，結尾不是規範的
    (b'xref\n0 2\n0000000000 65535 f \n0000000009 00000 n\t\ntrailer', False),
], ids=['pymupdf', 'word', 'blank-line-before-the-trailer', 'word-empty-section', 'two-subsections',
        '19-byte-entries', 'entry-type-nx', 'entry-type-o', 'object-in-two-subsections', 'one-entry-short',
        'one-entry-too-many', 'no-trailer', 'not-at-the-xref', 'over-the-limit', 'eol-two-newlines',
        'eol-tab-and-newline'])
def test_only_standard_xref_tables_are_accepted(table, standard):
    # 標準的寫法回傳接在後面的 trailer 的位置（xref 要重建時各家照 trailer 找 /Root：檔案裡只能有這幾個）
    assert _table_trailer(table, 0) == (table.rindex(b'trailer') if standard else None)


def test_a_huge_xref_subsection_is_refused_at_once():
    # 子段說有十億筆：先比 OBJECTS 再列編號，不然光是列編號就耗盡記憶體
    assert _within(30, lambda: _table_trailer(b'xref\n0 1000000000\n0000000000 65535 f \ntrailer', 0)) is None


def test_a_duplicate_key_in_the_second_xref_stream_range_stops_the_extraction(tmp_path):
    # 第十五輪審查的整卷向量：字型表寫兩個 /FS 的那一卷改寫成 xref 串流，第二段 /Index 從那個資源字典開始
    data = _duplicate_font_name(tmp_path)
    numbers = {int(m[1]): m for m in re.finditer(rb'(?m)^(\d+) 0 obj\n(.*?)endobj', data, re.S)}
    target = next(n for n, m in numbers.items() if m[2].count(b'/FS ') == 2)
    size = max(numbers) + 2  # 加上 xref 串流自己
    exam = tmp_path / 'xref-stream.pdf'
    exam.write_bytes(_as_xref_stream(data, [(0, target), (target, size - target)]))
    with pytest.raises(ValueError, match='^' + SYNTAX_PROBLEM + '字典裡同一個鍵寫了兩次（/FS）'):
        extract(exam)


def _with_a_free_entry(objects):
    """xref 表多一個子段，第 len(objects)+1 號是空的一筆（兩套程式都當成沒有這個物件）。"""
    data = _hand_pdf(objects)
    at = data.rindex(b'trailer')
    size = b'/Size %d ' % (len(objects) + 1)
    assert data.count(size) == 1
    return (data[:at] + b'%d 1\n0000000000 00001 f \n' % (len(objects) + 1) + data[at:]).replace(
        size, b'/Size %d ' % (len(objects) + 2))


def test_a_free_entry_both_programs_read_as_free_is_accepted(tmp_path):
    # 空的一筆：pdfminer 不登記、MuPDF 記成 f，逐號比對時兩邊都是「沒有這個物件」
    assert _syntax_of(tmp_path, _with_a_free_entry(ONE_PAGE)) is None


def _update(data, number, body=None, entry=b'%010d 00000 n \n', tail=b'startxref\n%d\n%%%%EOF\n', prev=None):
    """增量更新：第 number 號物件在檔尾另寫一份（body；None 就不寫），新的一段 xref 只登記它（entry 是那一筆，%d 是
    位置），trailer 以 /Prev 接回前一段（prev 換掉 /Prev 指的位置，'self' 就是新的這一段自己）；tail 是檔尾（%d 是
    新一段的位置）。"""
    start = int(data.rsplit(b'startxref', 1)[1].split()[0])
    size = re.search(rb'/Size (\d+)', data[start:])[1]
    at = len(data)
    if body is not None:
        data += b'%d 0 obj\n' % number + body + b'\nendobj\n'
    section = len(data)
    back = section if prev == 'self' else start if prev is None else prev
    data += (b'xref\n%d 1\n' % number + (entry % at if b'%' in entry else entry)
             + b'trailer\n<</Size %s /Root 1 0 R /Prev %d>>\n' % (size, back))
    return data + tail % section


def _second_subsection(objects, number, body):
    """同一張 xref 表裡，第 number 號物件在第二個子段又登記一次，指向檔案裡的另一份（body）：pdfminer 取後面的，
    MuPDF 取前面的（第十六輪審查實測）。"""
    data = _hand_pdf(objects)
    start = int(data.rsplit(b'startxref', 1)[1].split()[0])
    copy = b'%d 0 obj\n' % number + body + b'\nendobj\n'
    head, trailer = data[start:].split(b'trailer', 1)
    trailer = trailer.rsplit(b'startxref', 1)[0]
    return (data[:start] + copy + head + b'%d 1\n%010d 00000 n \n' % (number, start) + b'trailer' + trailer
            + b'startxref\n%d\n%%%%EOF\n' % (start + len(copy)))


def _hidden_copy(objects, number, body, header=b'%d 0 obj'):
    """第 number 號物件在檔案裡另有一份沒有登記的（放在 xref 表前面，開頭是 header）：xref 壞掉時 PDFium 自己掃描整個
    檔案，最後一份勝出（第十六輪審查實測）。"""
    data = _hand_pdf(objects)
    start = int(data.rsplit(b'startxref', 1)[1].split()[0])
    copy = header % number + b'\n' + body + b'\nendobj\n'
    return (data[:start] + copy + data[start:].rsplit(b'startxref', 1)[0]
            + b'startxref\n%d\n%%%%EOF\n' % (start + len(copy)))


CLEAN_F1 = b'<</Font<</F1 5 0 R>>/ExtGState<<>>>>'  # 與 ONE_PAGE 第 6 號不同的另一份


@pytest.mark.parametrize(('data', 'problem'), [
    # pdfminer 與 MuPDF 讀 xref 的方法不同：逐號比對兩邊採用的那一筆（第十六輪審查實測，三套閱讀器照 MuPDF 的讀）
    (_update(_hand_pdf(ONE_PAGE), 6, CLEAN_F1, tail=b'startxref %d\n%%%%EOF\n'),   # startxref 沒有單獨一行
     '第 6 號物件 pdfminer 與 MuPDF 讀到的 xref 登記不同'),
    (_update(_hand_pdf(ONE_PAGE), 6, CLEAN_F1, tail=b'%%%%EOF startxref\n%d\n%%%%EOF\n'),
     '第 6 號物件 pdfminer 與 MuPDF 讀到的 xref 登記不同'),
    (_update(_hand_pdf(ONE_PAGE), 6, entry=b'0000000000 00001 f \n'),               # 新一段把它標成空的
     '第 6 號物件 pdfminer 與 MuPDF 讀到的 xref 登記不同'),
    # xref 表每一筆都要是標準的 20 個位元組、類型只有 n 與 f，子段不重疊
    (_update(_hand_pdf(ONE_PAGE), 6, CLEAN_F1, entry=b'%010d 00000 nx\n'), 'xref 表不是標準的寫法'),
    (_update(_object_stream_pdf(), 6, entry=b'0000000007 00004 o \n'), 'xref 表不是標準的寫法'),  # 只有 MuPDF 認得
    (_second_subsection(ONE_PAGE, 6, CLEAN_F1), 'xref 表不是標準的寫法'),           # 同一個物件登記兩次
    # 檔案裡另有一份沒有登記的：xref 壞掉時 PDFium 自己掃描，最後一份勝出
    (_hidden_copy(ONE_PAGE, 6, CLEAN_F1), '「6 0 obj」不是 xref 登記的物件開頭'),
    (_hidden_copy(ONE_PAGE, 6, CLEAN_F1, header=b'%d\n0\nobj'), '「6 0 obj」不是 xref 登記的物件開頭'),  # 開頭換行也算
    (_hidden_copy(ONE_PAGE, 99, CLEAN_F1), '「99 0 obj」不是 xref 登記的物件開頭'),  # 沒登記的編號：只有自己掃描的程式讀得到
    # /Prev 指回自己：pdfminer 同一段讀一千次才丟 RecursionError（兩萬筆的表 35 秒、2.4 GB）
    (_update(_hand_pdf(ONE_PAGE), 6, CLEAN_F1, prev='self'), 'xref 的 /Prev 或 /XRefStm 繞回讀過的一段'),
], ids=['startxref-on-one-line', 'eof-before-startxref', 'freed-in-an-update', 'entry-type-nx', 'entry-type-o',
        'object-in-two-subsections', 'unlisted-copy', 'unlisted-copy-over-three-lines', 'unlisted-object',
        'prev-to-itself'])
def test_xref_sections_the_programs_read_differently_are_refused(tmp_path, data, problem):
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + problem)


COURIER_F1 = b'6 0 obj\n<</Font<</F1 7 0 R>>>>\nendobj\n'  # 第 6 號物件的另一份：/F1 對到 Courier（第 7 號物件）


def _obj_text(where):
    """ONE_PAGE 加上 Courier（第 7 號）與文件資訊（第 8 號），再把 COURIER_F1 寫在第 8 號裡：字串裡的行首（'string'）、
    字串裡的行中間（'midline'，第十七輪審查的 /Title）、未壓縮串流的資料裡的行首（'stream'），或同一行 endobj 的
    後面（'after-endobj'，不在字串或串流裡）。xref 完好時三套閱讀器都用登記的那一份；xref 要重建時，Poppler 用
    字串與串流裡行首的那一份（它逐行找，不跳過字串與串流），三套都用 endobj 後面的那一份，行中間的沒有人用
    （第十七輪修正時實測：pdffonts、PyMuPDF、pypdfium2）。"""
    courier = b'<</Type/Font/Subtype/Type1/BaseFont/Courier>>'
    info = {'string': b'<</Title (x\n' + COURIER_F1 + b')>>', 'midline': b'<</Title (unit 6 0 obj review)>>',
            'stream': b'<</Length %d>>\nstream\nx\n' % (len(COURIER_F1) + 2) + COURIER_F1 + b'\nendstream',
            'after-endobj': b'<</Title (t)>>\nendobj ' + COURIER_F1.replace(b'\n', b' ').removesuffix(b' endobj ')}
    return _hand_pdf([*ONE_PAGE, courier, info[where]], trailer=b'/Info 8 0 R')


@pytest.mark.parametrize('where', ['string', 'midline', 'stream', 'after-endobj'])
def test_obj_written_anywhere_but_a_registered_start_is_refused(tmp_path, where):
    # 只看位元組，字串與串流裡的也算：Poppler 重建 xref 時逐行找，不跳過字串與串流；各家在哪裡斷字串與串流也不一定
    # 相同（重建時串流的 /Length 不一定讀得到）。行中間那一份沒有人用，照樣擋 —— 寧可錯擋（Word 匯出的卷沒有這種字）
    data = _obj_text(where)
    at = data.index(b'6 0 obj', data.index(b'8 0 obj'))
    assert (_syntax_of(tmp_path, data) or '').startswith(
        SYNTAX_PROBLEM + f'「6 0 obj」不是 xref 登記的物件開頭（位置 {at}；字串、串流裡的也算：xref 要重建時，Poppler '
        '逐行找這個寫法，不跳過字串與串流，最後一份勝出）')


HIDDEN_AT = int(_hand_pdf(ONE_PAGE).rsplit(b'startxref', 1)[1].split()[0])  # _hidden_copy 把另一份放在這裡


@pytest.mark.parametrize('header', [b'%d\x000\x00obj', b'%d\t0\tobj', b'%d\f0\fobj', b'%d\r0\robj',
                                    b'%d %%hidden\n0 obj', b'%d\x00%%hidden\n0 obj'],
                         ids=['nul', 'tab', 'form-feed', 'carriage-return', 'comment', 'nul-and-comment'])
def test_an_unlisted_copy_is_found_whatever_separates_its_header(tmp_path, header):
    # 編號、世代號與 obj 之間可以是任何 PDF 的空白，也可以是註解：PDFium 與 MuPDF 重建 xref 時逐詞掃描，空白與註解都
    # 跳過（第十八輪審查：開頭寫成「35\0%\n0 obj」的那一份以前沒找到，Poppler 重建時照讀，答案從 C 換成 A）
    assert (_syntax_of(tmp_path, _hidden_copy(ONE_PAGE, 6, CLEAN_F1, header=header)) or '').startswith(
        SYNTAX_PROBLEM + f'「6 0 obj」不是 xref 登記的物件開頭（位置 {HIDDEN_AT}；')


def test_the_whole_message_says_what_to_do(tmp_path):
    # 訊息的全文（共用的後半句也釘住）
    assert _syntax_of(tmp_path, _hidden_copy(ONE_PAGE, 6, CLEAN_F1)) == (
        f'{SYNTAX_PROBLEM}「6 0 obj」不是 xref 登記的物件開頭（位置 {HIDDEN_AT}；字串、串流裡的也算：xref 要重建時，Poppler '
        '逐行找這個寫法，不跳過字串與串流，最後一份勝出） —— 各家讀到的物件可能不同（重複的鍵各家取的不同、Poppler 的名稱'
        '遇到 NUL 就斷、找不到世代號不符的物件；pdfminer 照索引、MuPDF 照編號讀物件串流；xref 的讀法不同、重建時掃描檔案的方法不同，就讀到'
        '另一份），抽出來的字不一定是閱讀器上看到的，需要人工確認。')


@pytest.mark.parametrize('header', [b'%d\x00junk\n0 obj', b'%d\x0b0\x0bobj', b'%d 0 objX', b' ' * 254 + b'%d0 obj'],
                         ids=['nul-then-junk', 'vertical-tab', 'obj-and-more', 'split-by-the-line-buffer'])
def test_a_copy_only_poppler_picks_up_is_refused(tmp_path, header):
    # Poppler 重建 xref 時逐行找（一次最多讀 255 個字元）：數字後面是 NUL 就接著讀下一行、編號之間的空白照 C 的 isspace
    # （含 \v）、obj 後面接什麼都收、一行被切成兩段時數字也被切開。重建之後第 6 號物件讀不到，整頁空白（第十八輪修正時
    # 實測，pdffonts 與 pdftotext；MuPDF 與 PDFium 照舊）。這幾種 DEFINITION 都不算物件開頭，只有照 Poppler 的原始碼
    # 重演一次（_poppler_rebuild）才找得到
    assert (_syntax_of(tmp_path, _hidden_copy(ONE_PAGE, 6, CLEAN_F1, header=header)) or '').startswith(
        SYNTAX_PROBLEM + f'Poppler 重建 xref 時，第 6 號物件讀到的是位置 {HIDDEN_AT} 的另一份')


def _insert(data, at, extra):
    """在 at 插入 extra：xref 表（_hand_pdf 的那一段）裡在 at 之後的位置與 startxref 跟著改。"""
    data = data[:at] + extra + data[at:]
    table = data.index(b'xref\n0 ')
    first = data.index(b'\n', table + 5) + 1
    rows = bytearray(data[first:data.index(b'trailer', first)])
    for row in range(0, len(rows), 20):
        if rows[row + 17] == ord('n') and int(rows[row:row + 10]) >= at:
            rows[row:row + 10] = b'%010d' % (int(rows[row:row + 10]) + len(extra))
    data = data[:first] + bytes(rows) + data[first + len(rows):]
    head, tail = data.rsplit(b'startxref\n', 1)
    return head + b'startxref\n%d' % table + tail[tail.index(b'\n'):]


def test_an_object_only_the_xref_finds_is_refused(tmp_path):
    # 第 6 號物件的開頭前面同一行有註解（xref 照樣指到「6 0 obj」）：重建 xref 時 Poppler 只看行首、MuPDF 與 PDFium 把
    # 整行當成註解，三家都找不到它
    data = _hand_pdf(ONE_PAGE)
    data = _insert(data, re.search(rb'(?m)^6 0 obj', data).start(), b'%x ')
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + 'Poppler 重建 xref 時找不到第 6 號物件')


def test_an_object_indented_on_its_line_is_accepted(tmp_path):
    # 第 6 號物件的開頭前面有兩個空白（xref 指到「6 0 obj」）：Poppler 重建時記的是行首、MuPDF 記的是上一個詞的結尾，
    # 從那裡讀都先跳過空白與註解，讀到的正是這一個
    data = _hand_pdf(ONE_PAGE)
    assert _syntax_of(tmp_path, _insert(data, re.search(rb'(?m)^6 0 obj', data).start(), b'  ')) is None


def test_a_long_run_of_digits_is_scanned_once(tmp_path):
    # 字串裡二十萬個數字：DEFINITION 只從一串數字的開頭找，不然從每一位各找一次（時間是平方，這一份要跑好幾個小時）
    assert _within(60, lambda: _syntax_of(tmp_path, _hand_pdf([*ONE_PAGE, b'(' + b'1' * 200_000 + b')']))) is None


@pytest.mark.parametrize(('number', 'header'), [
    (2147483391, b'%d\x0b0\x0bobj'),  # INT_MAX − 1 − 255 以上：Bad object number
    (2 ** 25, b'%d\x0b0\x0bobj'),     # XRef::reserve 放不下：Too large XRef size
    # 世代號被 atoi 截成負數的一份：它先撐 xref、再比世代號，照樣整個放棄（第二十二輪審查實測：以前重演不放棄、
    # 世代號又小於 0 不登記，沒有東西可比，整卷放行）
    (2 ** 25, b'%d\x0b2147483648\x0bobj'), (2 ** 25, b'%d\x0b4294967295\x0bobj'),
    (2 ** 25, b'%d\x00junk\n2147483648 obj'), (2 ** 25, b'%d 2147483648 objX'),
], ids=['int-limit', 'xref-size-limit', 'negative-generation', 'generation-minus-one', 'nul-then-next-line',
        'obj-and-more'])
def test_a_number_that_makes_the_poppler_rebuild_fail_is_refused(tmp_path, number, header):
    # 行首一個 Poppler 重建 xref 時放不下的編號（只有它認得的寫法）：它重建到這裡就放棄，後面的物件都讀不到
    data = _hidden_copy(ONE_PAGE, number, CLEAN_F1, header=header)
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + 'Poppler 重建 xref 會失敗')


def test_a_copy_only_poppler_registers_is_refused(tmp_path):
    # 上限的前一號，只有 Poppler 認得的寫法：它照常重建、登記這一份 xref 沒有登記的物件，讀到的就與別家不同（比對略過
    # xref 沒有登記的編號，以前整套只有第 2²⁵ 號那一個樣本轉紅 —— 第二十二輪審查實測）
    data = _hidden_copy(ONE_PAGE, 2 ** 25 - 1, CLEAN_F1, header=b'%d\x0b0\x0bobj')
    assert (_syntax_of(tmp_path, data) or '').startswith(
        SYNTAX_PROBLEM + 'Poppler 重建 xref 時，第 33554431 號物件讀到的是位置')


@pytest.mark.parametrize(('data', 'entries'), [
    (b'1 0 obj\n<<>>\nendobj\n', {1: (0, 0)}),                                   # 行首
    (b'x\n  2 0 obj\n', {2: (2, 0)}),                                           # 行首的空白：記的是行首
    (b'1 0 obj <<>> endobj 2 0 obj <<>> endobj\n', {1: (0, 0), 2: (20, 0)}),     # 同一行 endobj 之後
    (b'1 0 obj <<>> endobj 2 0 obj\n', {1: (0, 0), 2: (20, 0)}),                  # 最後一個 endobj 之後
    (b'3\n0\nobj\n', {3: (0, 0)}),                                               # 數字後面是行尾：接著讀下一行
    (b'3\r\n0\r\nobj\r\n', {3: (0, 0)}),                                         # CR LF 是一個行尾
    (b'3\x00junk\n0 obj\n', {3: (0, 0)}),                                        # NUL：這一行其餘的不看
    (b'3\x0b0\x0bobj\n', {3: (0, 0)}),                                           # C 的 isspace 含 \v
    (b'3 0 objects\n', {3: (0, 0)}),                                             # obj 後面接什麼都收
    (b'3 0 obx\n', {}),                                                          # 要是 obj 這三個字
    (b' ' * 254 + b'30 obj\n', {3: (0, 0)}),                                     # 一行被切成兩段（255 個字元）
    (b'1 0 obj\r2 0 obj\r\n3 0 obj\n', {1: (0, 0), 2: (8, 0), 3: (17, 0)}),      # CR、CR LF 也是行尾
    (b'5 0 obj\n5 1 obj\n5 0 obj\n', {5: (8, 1)}),                               # 世代號不小於原本的才換
    (b'4294967301 0 obj\n', {5: (0, 0)}),                                        # atoi：只留低 32 位元
    (b'1 0 obj\n0033554432 00000 n \n', {1: (0, 0)}),                            # 放不下的編號，後面不是 obj：照常
    (b'33554432 0 m n\n', {}),                                                   # （放棄在比對 obj 之後）
    (b'33554431 0 obj\n', {33554431: (0, 0)}),                                   # 上限的前一號照常登記
    (b'0 0 obj\n-1 0 obj\nx 1 0 obj\n% 1 0 obj\n', {}),                          # 0、負數、行首不是數字
], ids=['line-start', 'leading-spaces', 'after-endobj', 'after-the-last-endobj', 'across-lines', 'across-crlf-lines',
        'nul', 'vertical-tab', 'obj-and-more', 'not-obj', 'line-buffer', 'cr-and-crlf', 'generation', 'int-truncation',
        'xref-row-past-the-limit', 'past-the-limit-not-obj', 'below-the-xref-limit', 'not-objects'])
def test_the_poppler_rebuild_is_replayed_line_by_line(data, entries):
    # 照 Poppler 25.03.0 的 XRef::constructXRef 一步一步做（每一個樣本都照原始碼推過）
    assert _poppler_rebuild(data) == entries


@pytest.mark.parametrize(('data', 'starts'), [
    (b'trailer\n<</Root 1 0 R>>\n', [7]),                    # 行首：從 trailer 後面讀
    (b'  trailer <<>>\n', [7]),                              # 行首的空白不算進位置：從第 7 個位元組讀
    (b'1 0 obj <<>> endobj trailer<<>>\n', [27]),            # 同一行 endobj 之後：位置跟著往後
    (b'x trailer\n1 0 obj trailer\n', []),                   # 不在行首、不在 endobj 之後
], ids=['line-start', 'indented', 'after-endobj', 'elsewhere'])
def test_the_poppler_rebuild_notes_where_it_reads_a_trailer(data, starts):
    # XRef::constructXRef：行首（跳過空白）或 endobj 之後是 trailer，就從 pos + 7 讀一個物件當 trailer 字典
    read = []
    _poppler_rebuild(data, read)
    assert read == starts


@pytest.mark.parametrize('data', [
    b'1 0 obj\n2147483391 0 obj\n', b'1 0 obj\n33554432 0 obj\n',
    b'1 0 obj\n33554432 2147483648 obj\n',  # 放棄在比世代號之前
], ids=['int-limit', 'xref-size-limit', 'before-the-generation'])
def test_a_number_poppler_cannot_hold_makes_its_rebuild_fail(data):
    assert _poppler_rebuild(data) is None


OTHER = b'BT /F1 24 Tf 100 700 Td (Other) Tj ET'
ANOTHER_TREE = [b'<</Type/Catalog/Pages 8 0 R>>', b'<</Type/Pages/Kids[9 0 R]/Count 1>>',  # 第 7 到 10 號：另一棵頁面樹
                b'<</Type/Page/Parent 8 0 R/MediaBox[0 0 595 842]/Resources 6 0 R/Contents 10 0 R>>',
                b'<</Length %d>>\nstream\n' % len(OTHER) + OTHER + b'\nendstream']


def test_a_copy_only_mupdf_picks_up_is_refused(tmp_path):
    # MuPDF 重建 xref 時，編號與世代號之後的字典不會清掉它記下的兩個數字：「6 0 <<>> obj」它當成第 6 號物件（第十八輪
    # 修正時實測：重建之後頁面的字型不見了；Poppler 與 PDFium 照舊）。直接叫 MuPDF 重建一次，比對它讀到的 xref
    data = _hidden_copy(ONE_PAGE, 6, CLEAN_F1, header=b'%d 0 <<>> obj')
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + 'MuPDF 重建 xref 時，第 6 號物件讀到的與原本的不同')


def test_an_object_only_mupdf_picks_up_is_refused(tmp_path):
    # 只有 MuPDF 重建時認得、xref 沒有登記的第 99 號物件：重建之後它的 xref 比原本長，逐號比對要比到重建之後的長度
    data = _hidden_copy(ONE_PAGE, 99, CLEAN_F1, header=b'%d 0 <<>> obj')
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + 'MuPDF 重建 xref 時，第 99 號物件讀到的與原本的不同')


def test_a_catalog_only_mupdf_picks_up_is_refused(tmp_path):
    # 檔尾之後一個帶 /Root 的字典（前面沒有 trailer）：MuPDF 重建 xref 時照它找目錄物件，整頁換成另一棵頁面樹的
    # 「Other」（第十八輪修正時實測；Poppler 與 PDFium 照舊）
    data = _hand_pdf([*ONE_PAGE, *ANOTHER_TREE]) + b'<</Root 7 0 R>>\n'
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + 'MuPDF 重建 xref 時，目錄物件是第 7 號（原本是第 1 號）')


def test_a_huge_number_only_mupdf_picks_up_is_refused_at_once(tmp_path):
    # 只有 MuPDF 重建時認得的第 150000 號物件（「N 0 <<>> obj」）：它的 xref 撐到十五萬筆，超過 OBJECTS 就不逐號比對
    data = _hidden_copy(ONE_PAGE, 150_000, CLEAN_F1, header=b'%d 0 <<>> obj')
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + f'MuPDF 重建 xref 時物件太多（編號到 150000，超過 {OBJECTS}）')


@pytest.mark.parametrize(('data', 'at'), [
    (_hand_pdf([*ONE_PAGE, *ANOTHER_TREE]) + b'trailer\n<</Root 7 0 R>>\n', len(_hand_pdf([*ONE_PAGE, *ANOTHER_TREE]))),
    (_hand_pdf([*ONE_PAGE, *ANOTHER_TREE, b'<</Title (x\ntrailer\n<</Root 7 0 R>>\n)>>'], trailer=b'/Info 11 0 R'),
     None),
], ids=['after-the-end', 'in-a-string'])
def test_a_trailer_that_does_not_follow_an_xref_table_is_refused(tmp_path, data, at):
    # xref 要重建時，閱讀器照檔案裡的 trailer 找 /Root：檔尾之後另一個 trailer 指向另一棵頁面樹，三套閱讀器重建之後
    # 都畫成「Other」（第十八輪修正時實測）。trailer 只能是讀到的每一段 xref 表後面那一個（字串、串流裡的也算）
    at = data.index(b'trailer') if at is None else at
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + f'位置 {at} 的「trailer」不是 xref 表後面的那一個')


def _after_eof(data, number):
    """最後一個物件（第 number 號）搬到 %%EOF 之後，xref 照樣登記它的新位置：xref 表只記位置，物件不一定在它前面。"""
    head = data.index(b'\n%d 0 obj\n' % number) + 1
    table = data.index(b'xref\n0 ')
    body, data = data[head:table], data[:head] + data[table:]
    rest, tail = data.rsplit(b'startxref\n', 1)
    data = rest + b'startxref\n%d' % head + tail[tail.index(b'\n'):]
    entry = data.index(b'\n', head + 5) + 1 + 20 * number
    return data[:entry] + b'%010d' % len(data) + data[entry + 10:] + body


def test_an_xref_stream_that_is_not_read_is_refused(tmp_path):
    # xref 登記了一個 xref 串流（第 11 號，/Root 指向另一棵頁面樹），但沒有一段 xref 讀它，而且它在 %%EOF 之後：xref
    # 要重建時 MuPDF 與 PDFium 照它找 /Root，畫成「Other」（第十八輪修正時實測；Poppler 照舊）
    stream = b'<</Type/XRef/Size 12/W[1 1 1]/Root 7 0 R/Length 3>>stream\n\x00\x00\x00\nendstream'
    data = _after_eof(_hand_pdf([*ONE_PAGE, *ANOTHER_TREE, stream]), 11)
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + '第 11 號物件是沒有讀到的 xref 串流')


def test_trailers_that_name_different_catalogs_are_refused(tmp_path):
    # 前一段的 trailer 指向另一棵頁面樹，增量更新的 trailer 指回第 1 號：兩套程式都讀新的一段，xref 要重建時各家照
    # 檔案裡的順序取最後一個 —— trailer 的 /Root 都要相同
    data = _hand_pdf([*ONE_PAGE, *ANOTHER_TREE]).replace(b'/Root 1 0 R', b'/Root 7 0 R')
    data = _update(data, 6, entry=b'%010d 00000 n \n' % re.search(rb'(?m)^6 0 obj', data).start())
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + 'trailer 的 /Root 不一致（第 1 號與第 7 號物件）')


@pytest.mark.parametrize(('objects', 'missing'), [
    (_one_page_with(1, b'<</Type/Catalog/Pages 2 0 R/ViewerPreferences 99 0 R>>'), 99),
    (_one_page_with(1, b'<</Type/Catalog/Pages 2 0 R/ViewerPreferences 7 0 R>>'), 7),    # 第 7 號是空的一筆
], ids=['not-listed', 'free'])
def test_a_reference_to_an_object_the_xref_does_not_list_is_refused(tmp_path, objects, missing):
    # Poppler 取物件時找不到（沒有登記、或是空的一筆）就丟掉 xref、自己掃描整個檔案重建：目錄的 /ViewerPreferences 它
    # 一開檔就讀（第十八輪審查實測）。重建時物件串流裡的物件它都讀不到，另一份物件開頭也會被它當真
    data = _with_a_free_entry(objects) if missing == 7 else _hand_pdf(objects)
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + f'參照指向 xref 沒有登記的第 {missing} 號物件')


def test_the_round_18_attack_stops_the_extraction(tmp_path):
    # 第十八輪審查實測：整卷的目錄多一個 /ViewerPreferences 999 0 R（Poppler 開目錄時讀它、找不到就重建 xref），xref 表
    # 前面另寫一份畫第 1 題答案的內容串流（畫成 A，開頭「N\0%\n0 obj」）：Poppler 上的答案是 A，擷取是 C
    doc = pymupdf.open(_two_page_exam(tmp_path))
    answer = next(xref for xref in range(1, doc.xref_length()) if doc.xref_is_stream(xref)
                  and b'[<4320>]TJ' in doc.xref_stream(xref))
    doc.xref_set_key(doc.pdf_catalog(), 'ViewerPreferences', '999 0 R')
    data = doc.tobytes()
    stream = doc.xref_stream(answer).replace(b'[<4320>]TJ', b'[<4120>]TJ')
    copy = b'%d\x00%%\n0 obj\n<</Length %d>>\nstream\n' % (answer, len(stream)) + stream + b'\nendstream\nendobj\n'
    start = int(data.rsplit(b'startxref', 1)[1].split()[0])
    exam = tmp_path / 'attack.pdf'
    exam.write_bytes(data[:start] + copy + data[start:].rsplit(b'startxref', 1)[0]
                     + b'startxref\n%d\n%%%%EOF\n' % (start + len(copy)))
    with pytest.raises(ValueError, match='^' + SYNTAX_PROBLEM):
        extract(exam)


def test_an_update_with_startxref_on_one_line_stops_the_extraction(tmp_path):
    # 整卷：第 1 頁的資源在增量更新裡另寫一份，檔尾寫成「startxref 位置」同一行：pdfminer 讀舊的一版，三套閱讀器讀新的
    data = _two_page_exam(tmp_path).read_bytes()
    resources = _page_resources(pymupdf.open(stream=data)[0])
    body = re.search(rb'(?s)\n%d 0 obj\n(.*?)\nendobj' % resources, data)[1]
    body = body.replace(b'/Font<<', b'/ProcSet[/PDF]/Font<<', 1)
    exam = tmp_path / 'update.pdf'
    exam.write_bytes(_update(data, resources, body, tail=b'startxref %d\n%%%%EOF\n'))
    with pytest.raises(ValueError, match='^' + SYNTAX_PROBLEM + '第 %d 號物件 pdfminer 與 MuPDF' % resources):
        extract(exam)


def test_a_table_of_19_byte_entries_is_refused_even_where_mupdf_reads_it(tmp_path):
    # 整卷的 xref 表每一筆少一個空白（19 個位元組）：pdfminer 與 MuPDF 照樣讀對，PDFium 當成 xref 壞了、自己掃描整個
    # 檔案（第十六輪審查實測：另放一份同編號的物件，Chrome 畫的是那一份）
    data = _two_page_exam(tmp_path).read_bytes()
    start = int(data.rsplit(b'startxref', 1)[1].split()[0])
    table, rest = data[start:].split(b'trailer', 1)
    assert (_syntax_of(tmp_path, data[:start] + table.replace(b' \n', b'\n') + b'trailer' + rest) or '').startswith(
        SYNTAX_PROBLEM + 'xref 表不是標準的寫法')


def _read_differently(data, last):
    """MuPDF 讀新加的一段 xref（只列第 1 到 last 號，沒有 /Prev），pdfminer 讀原來那一段：新一段的 startxref 與位置寫在
    同一行，pdfminer 找不到它（第十六輪審查的 F2 手法）。"""
    offsets = {int(m[1]): m.start() for m in re.finditer(rb'(?m)^(\d+) 0 obj', data)}
    at = len(data)
    table = b'xref\n0 %d\n0000000000 65535 f \n' % (last + 1) + b''.join(b'%010d 00000 n \n' % offsets[n]
                                                                        for n in range(1, last + 1))
    return data + table + b'trailer\n<</Size %d /Root 1 0 R>>\nstartxref %d\n%%%%EOF\n' % (last + 1, at)


def test_objects_only_pdfminer_lists_are_compared_too(tmp_path):
    # pdfminer 讀的那一段多一個第 7 號物件，MuPDF 讀的那一段只到第 6 號：逐號比對要比到兩邊最大的編號
    data = _read_differently(_hand_pdf([*ONE_PAGE, b'<</Extra 1>>']), 6)
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + '第 7 號物件 pdfminer 與 MuPDF')


@pytest.mark.parametrize(('extra', 'last', 'number'), [
    (b'7 0 obj\n<</Extra 1>>\nendobj\n', 7, 7),                       # 只有 MuPDF 讀的那一段登記第 7 號
    (b'1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n', 6, 1),      # 兩段的目錄物件（第 1 號）不是同一份
], ids=['object-only-mupdf-lists', 'catalog'])
def test_the_comparison_covers_every_object_either_program_lists(tmp_path, extra, last, number):
    # 逐號比對從第 1 號比到兩邊最大的編號：另外那一份也是沒登記的開頭（DEFINITION），但兩套程式讀到的 xref 不同要先報
    # 出來（第十七輪審查：少比第 1 號、只比到 pdfminer 最大的編號，這兩個變種原本沒有測試分得出來）
    data = _read_differently(_hand_pdf(ONE_PAGE) + extra, last)
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + f'第 {number} 號物件 pdfminer 與 MuPDF')


def test_a_huge_object_number_only_pdfminer_lists_is_refused_at_once(tmp_path):
    # pdfminer 讀的那一段登記第十億號物件（MuPDF 讀的那一段沒有）：編號超過 OBJECTS 就不逐號比對，不然要比十億次
    base = _hand_pdf(ONE_PAGE)
    sixth = re.search(rb'(?m)^6 0 obj', base).start()
    at = base.rindex(b'trailer')
    data = _read_differently(base[:at] + b'1000000000 1\n%010d 00000 n \n' % sixth + base[at:], 6)
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM)


def test_too_many_objects_are_refused_before_pdfminer_reads_them(tmp_path):
    # 二十萬個物件編號（真實卷最多 2,870）：MuPDF 先開，超過 OBJECTS 就擋，pdfminer 不必逐筆列
    data = _as_xref_stream(_hand_pdf(ONE_PAGE), [(0, 200_000)], size=200_000)
    assert (_syntax_of(tmp_path, data) or '').startswith(SYNTAX_PROBLEM + '物件太多')


@pytest.mark.parametrize(('objects', 'trailer'), [(ONE_PAGE, b''), ([*ONE_PAGE, b'7 0 R'], b'/Info 7 0 R')],
                         ids=['one-page', 'info-refers-to-itself'])
def test_what_mupdf_had_to_repair_is_a_broken_xref(tmp_path, objects, trailer):
    # MuPDF 開檔時就重建了 xref：直接報 xref 壞了，不交給 pdfminer（它讀的可能是另一版）。要在 pdfplumber 開檔之前報：
    # /Info 繞回自己時 pdfminer 開檔就卡住（開檔之後 _rebuilt_xref 報的是同一句，第十七輪修正時 mutation 分不出來）
    data = _hand_pdf(objects, trailer=trailer)
    head, start = data.rsplit(b'startxref\n', 1)
    assert (_syntax_of(tmp_path, head + b'startxref\n9' + start[start.index(b'\n'):]) or '').startswith(
        'PDF 的 xref 表壞了')


def _self_reference(where):
    """第 1 頁（where 是 'page'）或文件資訊（'info'）的一個鍵指向「N 0 obj N 0 R endobj」：pdfminer 解參照時繞回自己，
    開檔（/Info）或建頁面（/LastModified）時就卡住（第十四輪審查實測）。"""
    def rewrite(tmp_path):
        doc = pymupdf.open(_two_page_exam(tmp_path))
        loop = doc.get_new_xref()
        doc.update_object(loop, '1234567890')
        if where == 'info':
            doc.xref_set_key(-1, 'Info', f'{loop} 0 R')
        else:
            doc.xref_set_key(doc[0].xref, 'LastModified', f'{loop} 0 R')
        data = doc.tobytes()
        old = b'%d 0 obj\n1234567890\nendobj' % loop
        assert data.count(old) == 1
        return data.replace(old, (b'%d 0 obj\n%d 0 R' % (loop, loop)).ljust(len(old) - 7) + b'\nendobj')
    return rewrite


@pytest.mark.parametrize('where', ['info', 'page'])
def test_an_object_that_refers_to_itself_stops_the_extraction_instead_of_hanging(tmp_path, where):
    exam = tmp_path / 'loop.pdf'
    exam.write_bytes(_self_reference(where)(tmp_path))

    def run():
        try:
            extract(exam)
        except ValueError as error:
            return str(error)
    assert (_within(60, run) or '').startswith(SYNTAX_PROBLEM)


@pytest.mark.parametrize(('error', 'message'), [
    (PDFValueError('boom'), '^pdfminer 讀不了這份 PDF（PDFValueError：boom）'),  # pdfminer 的錯也是 ValueError
    (ValueError('boom'), '^讀這份 PDF 時出錯（ValueError：boom）'),             # 別人丟的 ValueError 不是擷取器的判斷
], ids=['pdfminer-value-error', 'library-value-error'])
def test_value_errors_the_extractor_did_not_raise_are_named_as_such(tmp_path, monkeypatch, error, message):
    # 以前 ValueError 一律照原樣傳出：pdfminer 讀物件串流時丟的「not enough values to unpack」就這樣變成擷取器的訊息
    def fail(self, *args, **kwargs):
        raise error
    monkeypatch.setattr(pdfplumber.page.Page, 'find_tables', fail)
    with pytest.raises(ValueError, match=message):
        extract(_two_page_exam(tmp_path))




def test_an_object_stream_pdfminer_cannot_read_stops_the_extraction(tmp_path):
    # 目錄物件與「整個物件只是一個參照」放在同一個物件串流：pdfminer 開檔時解目錄就讀這個串流，自己丟 ValueError
    # （not enough values to unpack）：擷取器照樣報「讀這份 PDF 時出錯」，不是把它當成自己的判斷照原樣傳出
    path = tmp_path / 'object-stream.pdf'
    path.write_bytes(_object_stream_pdf(sixth=b'5 0 R'))
    with pytest.raises(ValueError, match='^讀這份 PDF 時出錯（ValueError：'):
        extract(path)


def test_a_broken_xref_is_reported_before_how_the_objects_are_written(tmp_path):
    # xref 壞了、pdfminer 自己重建時，物件的寫法先不查（重建出來的不是檔案寫的）：報 xref 壞了（_rebuilt_xref）
    data = _hand_pdf(_one_page_with(6, b'<</Font<</F1 5 0 R/F1 5 0 R>>>>'))
    head, start = data.rsplit(b'startxref\n', 1)
    path = tmp_path / 'broken-xref.pdf'
    path.write_bytes(head + b'startxref\n9' + start[start.index(b'\n'):])  # 指到檔頭，不是 xref
    with pytest.raises(ValueError, match='^PDF 的 xref 表壞了'):
        extract(path)

