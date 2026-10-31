# iPAS 參考樣題 PDF 擷取器的測試。官方 PDF 不進 CI：這裡用 PyMuPDF 畫與參考樣題同結構的小 PDF（第一頁是標題加第一科，
# 第二頁是第二科；每題是題號開頭的題幹、從 (A) 開始的選項、一行解答），跑整條管線，連同模組說明列出的每一種
# 「一律報錯」的版面。每一行照 PDF 的寫法：段落結尾的行尾留一個空白字元，折行的行尾沒有。
import dataclasses
import re
import struct

import pymupdf
import pytest

import ipas_exam_pdf
import ipas_sample_pdf
import test_ipas_exam_pdf as X  # 公告試題那邊合成攻擊樣本的工具
from ipas_sample_pdf import Header, _header, _options, extract, header

TITLE = '淨零碳規劃管理師能力鑑定 參考樣題(114 年版) '
L11 = 'L11 淨零碳規劃管理基礎概論 '
L12 = 'L12 淨零碳盤查規範與程序概要 '


@pytest.fixture
def any_stream_key(monkeypatch):
    X._any_stream_key(monkeypatch)


def _question(number, stem, answer='A', options=('甲', '乙', '丙', '丁')):
    return [f'{number}.{stem} ', '；'.join(f'({k}){t}' for k, t in zip('ABCD', options)) + ' ', f'解答：({answer}) ']


def _subject(heading, count=2):
    lines = [heading]
    for n in range(1, count + 1):
        lines += _question(n, f'第{n}題的題幹', 'ABCD'[n % 4])
    return lines


PAGES = [[TITLE, *_subject(L11)], _subject(L12)]


def _pdf(tmp_path, pages=PAGES, *, extras=(), name='sample.pdf'):
    """pages 的每一頁是各行文字（照寫的樣子畫，一行一個 insert_text）；extras 是對每一頁另外做的事。"""
    doc = X._blank_pdf()
    for lines in pages:
        page = doc.new_page(width=842, height=842)
        for i, text in enumerate(lines):
            page.insert_text((60, 60 + 20 * i), text, fontname='china-t', fontsize=12)
        for extra in extras:
            extra(page)
    path = tmp_path / name
    doc.save(path)
    return path


def test_each_subject_is_extracted_from_its_own_page(tmp_path):
    path = _pdf(tmp_path)
    for code, page in (('L11', 1), ('L12', 2)):
        assert extract(path, code) == [
            {'number': n, 'page': page, 'column': None, 'answer': 'ABCD'[n % 4], 'stem': f'第{n}題的題幹',
             'options': [{'key': k, 'text': t} for k, t in zip('ABCD', '甲乙丙丁')]}
            for n in (1, 2)]


def test_the_header_is_the_title_and_that_subjects_line(tmp_path):
    path = _pdf(tmp_path)
    assert header(path, 'L11') == Header(title='淨零碳規劃管理師能力鑑定 參考樣題(114 年版)',
                                         subject='L11 淨零碳規劃管理基礎概論', subject_code='L11', edition='114')
    assert header(path, 'L12') == Header(title='淨零碳規劃管理師能力鑑定 參考樣題(114 年版)',
                                         subject='L12 淨零碳盤查規範與程序概要', subject_code='L12', edition='114')


def test_lines_join_the_way_the_official_exams_do(tmp_path):
    # 段落結尾（行尾有空白）：全形標點後直接接，英數字後補一個空格；折行（行尾沒有空白）：中文接中文直接接，英數字接
    # 中文補一個空格（選項也一樣）。「N.」後面的空白、選項標號後面的空白與選項之間的「；」不算內容
    pages = [[TITLE, L11,
              '1.某工廠的能源使用情況如下： ', '使用電力 500,000 kWh ', '請計算排放量。 ',
              '(A) 371,350', '公斤；(B) 502,100 公斤；(C)413,000 公斤；(D)421,500 公斤 ', '解答：(B) ',
              '2. 這一題的題幹很長所以折', '行到下一行。 ',
              '(A)甲；(B)乙；(C)丙', '丙；(D)丁 ', '解答：(C) '],
             _subject(L12)]
    first, second = extract(_pdf(tmp_path, pages), 'L11')
    assert first['stem'] == '某工廠的能源使用情況如下：使用電力 500,000 kWh 請計算排放量。'
    assert [o['text'] for o in first['options']] == ['371,350 公斤', '502,100 公斤', '413,000 公斤', '421,500 公斤']
    assert second['stem'] == '這一題的題幹很長所以折行到下一行。'
    assert [o['text'] for o in second['options']] == ['甲', '乙', '丙丙', '丁']
    assert (first['answer'], second['answer']) == ('B', 'C')


def _replace(page_index, old, new):
    pages = [list(p) for p in PAGES]
    i = pages[page_index].index(old)
    pages[page_index][i:i + 1] = new if isinstance(new, list) else [new]
    return pages


def _image(page):
    page.insert_image(pymupdf.Rect(400, 700, 420, 720),
                      pixmap=pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 2, 2), 0))


def _white_text(page):
    page.insert_text((300, 700), '隱藏', fontname='china-t', fontsize=12, color=(1, 1, 1))


def _widget(page):
    field = pymupdf.Widget()
    field.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    field.field_name = 'note'
    field.rect = pymupdf.Rect(400, 700, 500, 720)
    page.add_widget(field)


@pytest.mark.parametrize(('pages', 'extras', 'message'), [
    (_replace(0, TITLE, '淨零碳規劃管理師能力鑑定 參考樣題 '), (), '不是參考樣題的標題'),
    (_replace(0, L11, 'L13 淨零碳規劃管理基礎概論 '), (), '不是認得的科目'),
    (_replace(0, L11, 'L11 淨零碳盤查規範與程序概要 '), (), '不是認得的科目'),
    (_replace(1, L12, L11), (), '出現在第 1 頁與第 2 頁'),
    (_replace(0, '解答：(B) ', []), (), '選項標號是'),  # 選項可以折行，下一題併進選項，在切選項時擋下
    (_replace(1, '解答：(C) ', []), (), '沒有「解答：(X)」那一行'),
    (_replace(0, '(A)甲；(B)乙；(C)丙；(D)丁 ', '解答：(B) '), (), '在選項之前就是解答'),
    (_replace(0, '解答：(B) ', '解答：(E) '), (), '選項標號是'),  # (E) 不是答案：這一行被接進選項
    (_replace(0, '1.第1題的題幹 ', '1.第1題的題幹 備註 '), (), None),  # 題幹裡的字照收（對照組）
    (_replace(0, '解答：(B) ', ['解答：(B) ', '備註 ']), (), '應該是下一題的題號開頭'),
    (_replace(0, '2.第2題的題幹 ', '3.第2題的題幹 '), (), '不是從 1 起連續'),
    ([[TITLE, *_subject(L11, 10)], _subject(L12)], (), None),  # 對照組：兩位數的題號
    ([[TITLE, L11, '1.題幹 '], _subject(L12)], (), '沒有從 (A) 開始的選項'),
    ([[TITLE, L11, *_question(1, '題幹', options=('甲', '乙', '丙'))], _subject(L12)], (), '選項標號是'),
    ([[TITLE, L11, '1.題幹 ', '(A)甲；(B)乙；(D)丁；(C)丙 ', '解答：(A) '], _subject(L12)], (), '選項標號是'),
    ([[TITLE, L11, '1.題幹 ', '(A)甲；(B)乙；(C)丙；(D)丁；(E)戊 ', '解答：(A) '], _subject(L12)], (), '選項標號是'),
    ([[TITLE, L11, '1.題幹 ', '(A)甲(B)乙；(C)丙；(D)丁 ', '解答：(A) '], _subject(L12)], (), '不是以「；」結尾'),
    ([[TITLE, L11, '1.題幹 ', '(A)；(B)乙；(C)丙；(D)丁 ', '解答：(A) '], _subject(L12)], (), '是空的'),
    ([[TITLE, L11, '1. ', '(A)甲；(B)乙；(C)丙；(D)丁 ', '解答：(A) '], _subject(L12)], (), '題幹是空的'),
    ([[TITLE, *_subject(L11)], [TITLE, *_subject(L12)]], (), '不是認得的科目'),
    ([[TITLE, *_subject(L11)], []], (), '第 2 頁沒有科目與題目'),
    ([[TITLE], _subject(L12)], (), '第 1 頁沒有科目與題目'),
    ([[], _subject(L12)], (), '第 1 頁沒有字'),
    (PAGES, (_image,), '有圖片 1 個'),
    (PAGES, (lambda page: page.draw_rect(pymupdf.Rect(400, 700, 500, 720)),), '有向量圖形'),
    (PAGES, (lambda page: page.add_text_annot((400, 700), '註'),), '註解 2 個（Text、Popup）'),  # 便利貼連同它的 Popup
    (PAGES, (lambda page: page.insert_link({'kind': pymupdf.LINK_URI, 'from': pymupdf.Rect(400, 700, 500, 720),
                                             'uri': 'https://example.com/'}),), '連結 1 個'),
    (PAGES, (_widget,), '表單欄位 1 個'),
    (PAGES, (lambda page: page.set_rotation(90),), '旋轉 90 度'),
    (PAGES, (_white_text,), '在 PyMuPDF 畫出的頁面上找不到'),
], ids=['title', 'unknown-subject', 'subject-name', 'subject-twice', 'missing-answer-then-next', 'missing-answer-last',
        'answer-before-options', 'answer-e', 'stem-control', 'stray-line', 'numbering', 'two-digit-control', 'missing-options',
        'three-options', 'options-order', 'fifth-option', 'missing-separator', 'empty-option', 'empty-stem',
        'title-on-second-page', 'empty-second-page', 'title-only', 'blank-first-page', 'image', 'drawing', 'annotation',
        'link', 'widget', 'rotation', 'invisible-text'])
def test_an_unexpected_layout_stops_the_extraction(tmp_path, pages, extras, message, any_stream_key):
    path = _pdf(tmp_path, pages, extras=extras)

    def read_both():
        for code in ('L11', 'L12'):
            extract(path, code)
            header(path, code)

    if message is None:
        read_both()
        return
    with pytest.raises(ValueError, match=re.escape(message)):
        read_both()


def test_a_subject_that_is_not_in_the_pdf_is_refused(tmp_path):
    path = _pdf(tmp_path, [[TITLE, *_subject(L11)]])
    assert len(extract(path, 'L11')) == 2
    for read in (extract, header):
        with pytest.raises(ValueError, match='這份參考樣題沒有科目 L12'):
            read(path, 'L12')


def test_a_file_that_is_not_a_pdf_is_a_value_error(tmp_path):
    path = tmp_path / 'broken.pdf'
    path.write_bytes(b'%PDF-1.6\nnot really a pdf\n')
    with pytest.raises(ValueError, match='PyMuPDF 讀不了這份 PDF（FileDataError'):
        extract(path, 'L11')


@pytest.mark.parametrize('error', [OSError('磁碟壞了'), ValueError('相依自己丟的 ValueError')], ids=['other', 'value-error'])
def test_other_errors_while_reading_become_a_value_error_that_says_so(tmp_path, monkeypatch, error):
    # 相依丟的 ValueError 也一樣包起來：只有擷取器自己（這個模組與 ipas_exam_pdf）的 ValueError 照原樣傳出
    import pdfplumber

    def broken(path):
        raise error
    monkeypatch.setattr(pdfplumber, 'open', broken)
    with pytest.raises(ValueError, match=re.escape(f'讀這份 PDF 時出錯（{type(error).__name__}：{error}）')):
        extract(_pdf(tmp_path), 'L11')


def test_both_readers_must_see_the_same_pages(tmp_path, monkeypatch):
    import pdfplumber
    real = pdfplumber.open

    def one_page_less(path):
        pdf = real(path)
        pdf.pages.pop()
        return pdf
    monkeypatch.setattr(pdfplumber, 'open', one_page_less)
    with pytest.raises(ValueError, match='pdfminer 讀到 1 頁、PyMuPDF 讀到 2 頁'):
        extract(_pdf(tmp_path), 'L11')


@pytest.mark.parametrize(('title', 'heading', 'expected'), [
    ('淨零碳規劃管理師能力鑑定 參考樣題(114 年版)', 'L11 淨零碳規劃管理基礎概論', ('L11', '114')),
    ('淨零碳規劃管理師能力鑑定 參考樣題(115 年版)', 'L12 淨零碳盤查規範與程序概要', ('L12', '115')),
    ('淨零碳規劃管理師能力鑑定 參考樣題(114年版)', 'L11 淨零碳規劃管理基礎概論', '不是參考樣題的標題'),
    ('淨零碳規劃管理師能力鑑定 參考樣題(114 年版)', 'L11淨零碳規劃管理基礎概論', '不是認得的科目'),
    ('淨零碳規劃管理師能力鑑定 參考樣題(114 年版)', 'L12 淨零碳規劃管理基礎概論', '不是認得的科目'),
])
def test_the_header_is_derived_from_the_two_lines(title, heading, expected):
    # 擷取快照裡的頁首就是這兩行推出來的樣子：test_restore_reproducibility 拿它核對快照沒有被手改
    if isinstance(expected, str):
        with pytest.raises(ValueError, match=re.escape(expected)):
            _header(title, heading)
        return
    got = _header(title, heading)
    assert (got.subject_code, got.edition) == expected
    assert dataclasses.asdict(got) == {'title': title, 'subject': heading, 'subject_code': expected[0],
                                       'edition': expected[1]}


def test_the_horizontal_origin_tolerance_is_wider_than_the_official_ones():
    # 起點的水平容差：公告試題 0.1pt（ORIGIN），參考樣題 0.5pt（ORIGIN_X，見模組說明的實測）；垂直方向不放寬
    assert ipas_exam_pdf.ORIGIN == 0.1 and ipas_sample_pdf.ORIGIN_X == 0.5
    same = ipas_exam_pdf._same_glyph
    assert not same((100.0, 200.0), 12.0, (100.3, 200.0), 12.0)
    assert same((100.0, 200.0), 12.0, (100.3, 200.0), 12.0, x_tolerance=ipas_sample_pdf.ORIGIN_X)
    assert not same((100.0, 200.0), 12.0, (100.6, 200.0), 12.0, x_tolerance=ipas_sample_pdf.ORIGIN_X)
    assert not same((100.0, 200.0), 12.0, (100.0, 200.3), 12.0, x_tolerance=ipas_sample_pdf.ORIGIN_X)


def test_the_sample_pages_are_checked_with_the_wider_horizontal_tolerance(tmp_path, monkeypatch):
    # 合成的 PDF 兩套程式算出的起點完全一樣，量不出容差用的是哪一個：這裡記下 _pages 實際傳給兩道字形核對的值
    # （pdfminer 抽到的字要畫得出來，_check_chars；畫出來的字要抽得到，_unextracted_glyph）
    seen = {'_check_chars': [], '_unextracted_glyph': []}
    for name, real in [(name, getattr(ipas_exam_pdf, name)) for name in seen]:
        def spy(*args, _name=name, _real=real, **kwargs):
            seen[_name].append(kwargs)
            return _real(*args, **kwargs)
        monkeypatch.setattr(ipas_exam_pdf, name, spy)
    extract(_pdf(tmp_path), 'L11')
    assert seen == {name: [{'x_tolerance': ipas_sample_pdf.ORIGIN_X}] * 2 for name in seen}


def test_the_wider_tolerance_reaches_every_glyph_comparison(tmp_path):
    # 上面那條只看得到 _pages 傳了什麼：這裡把 PyMuPDF 畫出的字形整頁平移，走 _check_chars、_drawn、_same_glyph 整條。
    # 水平差 0.3pt：參考樣題的容差放行、公告試題的擋下；垂直差 0.3pt：兩者都擋
    import pdfplumber
    path = _pdf(tmp_path)
    with pymupdf.open(path) as rendered, pdfplumber.open(path) as pdf:
        chars = pdf.pages[0].chars
        glyphs = ipas_exam_pdf._visible_glyphs(rendered[0])

    def shifted(dx, dy):
        return {text: [(x + dx, y + dy, size, records) for x, y, size, records in entries]
                for text, entries in glyphs.items()}

    ipas_exam_pdf._check_chars(chars, '第 1 頁', shifted(0.3, 0), x_tolerance=ipas_sample_pdf.ORIGIN_X)
    for moved, tolerance in ((shifted(0.3, 0), {}), (shifted(0, 0.3), {'x_tolerance': ipas_sample_pdf.ORIGIN_X}),
                             (shifted(0.6, 0), {'x_tolerance': ipas_sample_pdf.ORIGIN_X})):
        with pytest.raises(ValueError, match='在 PyMuPDF 畫出的頁面上找不到'):
            ipas_exam_pdf._check_chars(chars, '第 1 頁', moved, **tolerance)


def test_the_wider_tolerance_reaches_the_reverse_glyph_comparison(tmp_path):
    # 反方向（畫出來的字要抽得到，_unextracted_glyph）也走 _same_glyph：把 PyMuPDF 的 texttrace 整頁平移，條件與上面相同
    import pdfplumber
    path = _pdf(tmp_path)
    with pymupdf.open(path) as rendered, pdfplumber.open(path) as pdf:
        chars = pdf.pages[0].chars
        trace = rendered[0].get_texttrace()

    def shifted(dx, dy):
        return [{**span, 'chars': [(ucs, gid, (x + dx, y + dy), bbox) for ucs, gid, (x, y), bbox in span['chars']]}
                for span in trace]

    assert ipas_exam_pdf._unextracted_glyph(trace, chars) is None
    assert ipas_exam_pdf._unextracted_glyph(shifted(0.3, 0), chars, x_tolerance=ipas_sample_pdf.ORIGIN_X) is None
    for moved, tolerance in ((shifted(0.3, 0), {}), (shifted(0, 0.3), {'x_tolerance': ipas_sample_pdf.ORIGIN_X}),
                             (shifted(0.6, 0), {'x_tolerance': ipas_sample_pdf.ORIGIN_X})):
        assert ipas_exam_pdf._unextracted_glyph(moved, chars, **tolerance) is not None


# 閱讀器畫的要與擷取到的一致：公告試題擷取器擋下的同一批寫法（審查實測：以前這幾種都照收，抽出來的題幹或答案
# 與閱讀器上看到的不同）。都畫在第 1 頁：第 1 題題幹的後面，或「解答：(B)」的 B 上
STEM_Y = 60 + 20 * 2
STEM_END = 60 + pymupdf.get_text_length('1.第1題的題幹', fontname='china-t', fontsize=12)
ANSWER_Y = 60 + 20 * 4
ANSWER_X = 60 + pymupdf.get_text_length('解答：(', fontname='china-t', fontsize=12)


def _first_page(draw):
    done = []

    def once(page):
        if not done:
            done.append(page)
            draw(page)
    return once


def _render_mode(mode):
    return lambda page: page.insert_text((STEM_END, STEM_Y), '隱形', fontname='china-t', fontsize=12, render_mode=mode)


def _glyph_without_text(page):
    font, _ = X._embedded_cjk(page, 'Q', (STEM_END, STEM_Y))
    X._to_unicode(page, font, 'Q', '')


def _form_answer_swap(page):
    # 沒有 /BBox 的表單：白色粗描邊蓋掉 B，再印一個黑色的 D（閱讀器上是「解答：(D)」，pdfminer 讀到的是 B）
    doc = page.parent
    form = doc.get_new_xref()
    doc.update_object(form, f'<</Type/XObject/Subtype/Form/Resources<</Font<</F1 {X.HELVETICA}>>>>>>')
    doc.update_stream(form, (f'BT /F1 12 Tf 1 g 1 G 2 Tr 5 w 1 0 0 1 {ANSWER_X:.2f} {842 - ANSWER_Y} Tm (B) Tj ET '
                             f'BT /F1 12 Tf 0 g 0 Tr 1 0 0 1 {ANSWER_X:.2f} {842 - ANSWER_Y} Tm (D) Tj ET').encode(), new=True)
    X._add_resource(page, 'XObject', 'Fx9', f'{form} 0 R')
    X._append_content(page, b'q /Fx9 Do Q')


def _hidden_layer(page):
    layer = page.parent.add_ocg('hidden', on=False)
    page.insert_text((STEM_END, STEM_Y), '隱形', fontname='china-t', fontsize=12, oc=layer)


def _with_state(state):
    """題幹後面多畫一個「不」，套上圖形狀態 state：MuPDF 照畫，PDFium（Chrome）與 Poppler 畫成白字或空白（第二輪審查實測）"""
    def draw(page):
        X._add_resource(page, 'ExtGState', 'GS9', f'<</Type/ExtGState{state}>>')
        X._append_content(page, b'q /GS9 gs BT /china-t 12 Tf 0 g 1 0 0 1 %.2f %.2f Tm <4E0D> Tj ET Q'
                          % (STEM_END, 842 - STEM_Y))
    return draw


def _soft_mask(page):
    """/SMask 的群組沒寫 /Subtype：不算表單物件，卻照樣把字遮掉（三套閱讀器都畫成空白）"""
    group = page.parent.get_new_xref()
    page.parent.update_object(group, '<</Type/XObject/BBox[0 0 842 842]/Group<</S/Transparency/CS/DeviceGray>>>>')
    page.parent.update_stream(group, b'', new=True)
    _with_state(f'/SMask<</S/Luminosity/G {group} 0 R>>')(page)


def _triangle_clip(page):
    """兩個小三角形當剪裁路徑：外框包住「不」，剪出來的範圍卻碰不到它（PyMuPDF 算它畫出來了）"""
    x0, y0, x1, y1 = STEM_END, 842 - STEM_Y - 3, STEM_END + 12, 842 - STEM_Y + 11
    clip = (f'{x0:.2f} {y0:.2f} m {x0 + 0.5:.2f} {y0:.2f} l {x0:.2f} {y0 + 0.5:.2f} l h '
            f'{x1:.2f} {y1:.2f} m {x1 - 0.5:.2f} {y1:.2f} l {x1:.2f} {y1 - 0.5:.2f} l h W n ')
    X._append_content(page, b'q ' + clip.encode() + b'BT /china-t 12 Tf 0 g 1 0 0 1 %.2f %.2f Tm <4E0D> Tj ET Q'
                      % (STEM_END, 842 - STEM_Y))


def _font(font):
    """題幹後面用 font（資源名稱 FS）多畫一個 C"""
    def draw(page):
        X._add_resource(page, 'Font', 'FS', font)
        X._append_content(page, b'BT /FS 12 Tf 0 g 1 0 0 1 %.2f %.2f Tm (C) Tj ET' % (STEM_END, 842 - STEM_Y))
    return draw


def _lying_helvetica(page):
    """沒有內嵌的 Helvetica，ToUnicode 把 C 對到 D：閱讀器畫 C，抽出來是 D"""
    cmap = ('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Lie def /CMapType 2 def '
            '1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <43> <0044> endbfchar endcmap '
            'CMapName currentdict /CMap defineresource pop end end')
    stream = page.parent.get_new_xref()
    page.parent.update_object(stream, '<<>>')
    page.parent.update_stream(stream, cmap.encode(), new=True)
    _font(f'<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding/ToUnicode {stream} 0 R>>')(page)


def _annotation(subtype, *, direct):
    """外觀串流（沒寫 /Subtype /Form）在「解答：(B)」的 B 上蓋白底、印 D 的註解。PyMuPDF 的 annots() 不列不認得的
    種類與直接寫在 /Annots 裡的註解"""
    def draw(page):
        doc = page.parent
        ap = doc.get_new_xref()
        doc.update_object(ap, f'<</Type/XObject/BBox[0 0 14 16]/Resources<</Font<</F1 {X.HELVETICA}>>>>>>')
        doc.update_stream(ap, b'1 g 0 0 14 16 re f BT /F1 12 Tf 0 g 1 0 0 1 1 4 Tm (D) Tj ET', new=True)
        rect = f'[{ANSWER_X - 1:.2f} {842 - ANSWER_Y - 4:.2f} {ANSWER_X + 13:.2f} {842 - ANSWER_Y + 12:.2f}]'
        spec = f'<</Type/Annot/Subtype/{subtype}/Rect{rect}/F 4/AP<</N {ap} 0 R>>>>'
        if direct:
            doc.xref_set_key(page.xref, 'Annots', f'[{spec}]')
        else:
            xref = doc.get_new_xref()
            doc.update_object(xref, spec)
            doc.xref_set_key(page.xref, 'Annots', f'[{xref} 0 R]')
    return draw


@pytest.mark.parametrize(('draw', 'message'), [
    (_render_mode(3), '畫了填色文字以外的東西（PyMuPDF 的 ignore-text）'),  # 隱形字
    (_render_mode(7), '第 1 頁：內容串流有文字畫法「7 Tr」'),               # 只當剪裁路徑的字（bboxlog 不列）
    (_render_mode(1), '畫了填色文字以外的東西（PyMuPDF 的 stroke-text）'),  # 只描邊、沒有填色的字
    (_glyph_without_text, '第 1 頁畫出了擷取不到的字「'),                     # ToUnicode 把字形對到空字串（MuPDF 報 U+FFFD）
    (_form_answer_swap, '表單物件'),
    (_hidden_layer, '選擇性內容（圖層'),
    (X._shading((70, 86, 92, 104)), '第 1 頁的頁面資源有 /Shading'),  # 白色漸層蓋住題幹的「第1」
    (lambda page: X._append_content(page, b'BX q Q EX'), '第 1 頁：內容串流有真的樣題 PDF 不會寫的運算子「BX」'),
    (_with_state('/BM/Lighten'), '第 1 頁有圖形狀態 GS9 的 /BM'),              # 疊在不透明的底色上就看不見
    (_with_state(f'/TR {X.WHITE_TRANSFER}'), '第 1 頁有圖形狀態 GS9 的 /TR'),  # 轉換函數把黑字變白字
    (_with_state(f'/TR2 {X.WHITE_TRANSFER}'), '第 1 頁有圖形狀態 GS9 的 /TR2'),
    (_with_state('/ca/Half'), '第 1 頁有圖形狀態 GS9 的 /ca'),                 # 不是數字的不透明度，各家讀法不同
    (_soft_mask, '第 1 頁有圖形狀態 GS9 的 /SMask'),
    (_triangle_clip, '第 1 頁有剪裁路徑（內容串流的「W」）'),
    (_lying_helvetica, '第 1 頁有字型 FS 的 /ToUnicode（只有內嵌的'),
    (_font('<</Type/Font/Subtype/Type1/BaseFont/ZapfDingbats/Encoding/WinAnsiEncoding>>'),
     '第 1 頁有字型 FS 的 /BaseFont /ZapfDingbats'),                           # 符號字型：C 畫成星形符號
    (_font(X._word_truetype('SymbolMT')), '第 1 頁有字型 FS 的 /BaseFont /SymbolMT'),
    (_annotation('Erratum', direct=False), '註解 1 個（Erratum）'),             # 不認得的種類
    (_annotation('FreeText', direct=True), '註解 1 個（FreeText）'),           # 直接寫在 /Annots 裡
    (lambda page: page.insert_text((60, 700), 'X', fontname='helv', fontsize=30), '第 1 頁有字級 30.0pt 的字'),
], ids=['invisible-text', 'clip-only-text', 'stroke-only-text', 'glyph-without-text', 'form-answer-swap',
        'hidden-layer', 'white-shading', 'content-grammar', 'blend-mode', 'transfer', 'transfer2', 'alpha-as-name',
        'soft-mask', 'triangle-clip', 'tounicode-on-a-builtin-font', 'zapf-dingbats', 'symbol', 'unknown-annotation',
        'direct-annotation', 'huge-text'])
def test_what_the_reader_shows_must_be_what_is_extracted(tmp_path, draw, message, any_stream_key):
    path = _pdf(tmp_path, extras=(_first_page(draw),))
    for read in (extract, header):
        with pytest.raises(ValueError, match=re.escape(message)):
            read(path, 'L11')


def test_a_page_that_also_has_kids_stops_the_extraction(tmp_path):
    # 第 1 頁是 /Type /Page，又帶 /Kids 指向答案是 D 的另一頁：pdfminer 與 MuPDF 讀第 1 頁（答案 B），Chrome（PDFium）
    # 照 /Kids 畫出另一頁（第二輪審查實測）
    doc = pymupdf.open(_pdf(tmp_path))
    alternate = doc.new_page(width=842, height=842)
    for i, text in enumerate(PAGES[0]):
        alternate.insert_text((60, 60 + 20 * i), text.replace('解答：(B)', '解答：(D)'), fontname='china-t', fontsize=12)
    root = int(doc.xref_get_key(doc.pdf_catalog(), 'Pages')[1].split()[0])
    first, second, third = doc[0].xref, doc[1].xref, alternate.xref  # 改樹之前先記下：改完頁碼就對不上了
    doc.xref_set_key(root, 'Kids', f'[{first} 0 R {second} 0 R]')
    doc.xref_set_key(root, 'Count', '2')
    doc.xref_set_key(first, 'Kids', f'[{third} 0 R]')
    doc.xref_set_key(third, 'Parent', f'{first} 0 R')
    path = tmp_path / 'kids.pdf'
    doc.save(path)
    for read in (extract, header):
        with pytest.raises(ValueError, match='^頁面樹不是真的樣題 PDF 的寫法'):
            read(path, 'L11')


def test_a_pdf_whose_xref_had_to_be_rebuilt_stops_the_extraction(tmp_path, monkeypatch):
    # pdfminer 改成掃描整個檔案（xref 的一筆多一個空白，MuPDF 照讀），或 PyMuPDF 自己重建：兩邊讀到的可能是不同版本
    path = X._xref_with_two_spaces(_pdf(tmp_path))
    assert not pymupdf.open(path).is_repaired
    with pytest.raises(ValueError, match=re.escape(ipas_sample_pdf.XREF_REBUILT)):
        extract(path, 'L11')
    monkeypatch.setattr(pymupdf.Document, 'is_repaired', property(lambda self: True))
    with pytest.raises(ValueError, match=re.escape(ipas_sample_pdf.XREF_REBUILT)):
        extract(_pdf(tmp_path, name='clean.pdf'), 'L11')


def test_an_xref_that_pymupdf_repairs_while_drawing_stops_the_extraction(tmp_path, monkeypatch):
    # PyMuPDF 有時畫到那一頁才重建 xref：開檔時還沒重建（開檔時的檢查放行），畫過頁面之後才重建，要靠畫完再查的那一次
    drawn = []
    trace = pymupdf.Page.get_texttrace
    monkeypatch.setattr(pymupdf.Page, 'get_texttrace', lambda self: drawn.append(self.number) or trace(self))
    monkeypatch.setattr(pymupdf.Document, 'is_repaired', property(lambda self: bool(drawn)))
    with pytest.raises(ValueError, match=re.escape(ipas_sample_pdf.XREF_REBUILT)):
        extract(_pdf(tmp_path), 'L11')
    assert drawn


def _inline_image(page):  # 寫縮寫 /W /H 的 inline 圖：pdfminer 讀得到，PyMuPDF 的 get_images 不列 inline 圖
    X._append_content(page, b'q 20 0 0 20 400 100 cm BI /W 2 /H 2 /CS /G /BPC 8 ID \x00\xff\xff\x00 EI Q')


def _abbreviated_image(page):  # 圖片 XObject 寫縮寫的 /W /H：PyMuPDF 照畫，pdfminer 讀不到
    xref = page.insert_image(pymupdf.Rect(400, 700, 420, 720), pixmap=pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 8, 8), 0))
    doc = page.parent
    doc.update_object(xref, doc.xref_object(xref, compressed=True).replace('/Width 8', '/W 8').replace('/Height 8', '/H 8'))


@pytest.mark.parametrize(('draw', 'pdfminer', 'mupdf'), [(_inline_image, 1, 0), (_abbreviated_image, 0, 1)],
                         ids=['inline-image', 'abbreviated-image-xobject'])
def test_an_image_either_program_sees_counts(tmp_path, draw, pdfminer, mupdf, any_stream_key):
    # 兩套程式各數一次、取多的那個：只有其中一邊看得到的圖，少了哪一半都會漏掉
    import pdfplumber
    path = _pdf(tmp_path, extras=(_first_page(draw),))
    with pymupdf.open(path) as rendered, pdfplumber.open(path) as pdf:
        assert (len(pdf.pages[0].images), len(rendered[0].get_images())) == (pdfminer, mupdf)
        assert ipas_sample_pdf._decorations(pdf.pages[0], rendered[0]) == ['圖片 1 個']
    with pytest.raises(ValueError, match='有圖片 1 個'):
        extract(path, 'L11')


def test_pdfminer_errors_become_a_value_error_that_names_pdfminer(tmp_path, monkeypatch):
    import pdfplumber
    from pdfplumber.utils.exceptions import PdfminerException

    def broken(path):
        raise PdfminerException('壞掉的物件')
    monkeypatch.setattr(pdfplumber, 'open', broken)
    with pytest.raises(ValueError, match=re.escape('pdfminer 讀不了這份 PDF（PdfminerException：壞掉的物件）')):
        extract(_pdf(tmp_path), 'L11')


def test_the_parsers_own_refusals_are_passed_through_unwrapped(tmp_path):
    # ipas_exam_pdf 自己丟的 ValueError 照原樣傳出（不包成「讀這份 PDF 時出錯」）
    with pytest.raises(ValueError) as refused:
        extract(_pdf(tmp_path, extras=(_white_text,)), 'L11')
    assert str(refused.value).startswith('第 1 頁的字「隱」')


def test_an_option_that_ends_in_a_space_before_the_separator_is_trimmed():
    # 英數字結尾的選項，「；」前面會有一個空格（中文與英數字之間的間距變成空格）
    assert [o['text'] for o in _options('(A)CO2 ；(B)CH4 ；(C)N2O ；(D)SF6', '第 1 題')] == ['CO2', 'CH4', 'N2O', 'SF6']


def test_the_header_runs_every_check_the_extraction_does():
    # header() 與 extract() 都經過 _read：每一頁的檢查都在 _pages，讀頁首不能另走一條比較鬆的路
    import ast
    import inspect
    body = lambda f: [ast.unparse(node) for node in ast.parse(inspect.getsource(f)).body[0].body[1:]]
    assert body(ipas_sample_pdf.header) == ['return _page_of(_read(pdf_path), subject_code)[1]']
    assert body(ipas_sample_pdf.extract) == ['pno, _, lines = _page_of(_read(pdf_path), subject_code)',
                                             'return _questions(pno, lines)']
    assert body(ipas_sample_pdf._read)[0] == 'pages = _pages(pdf_path)'


def test_the_resources_are_checked_with_the_sample_font_rules(tmp_path, monkeypatch):
    # 合成的 PDF 只用 PyMuPDF 內建字型，規則放寬與否結果一樣：這裡記下 _pages 實際傳給 _resources 的值
    seen = []
    real = ipas_exam_pdf._resources

    def spy(page, **rules):
        seen.append(rules)
        return real(page, **rules)

    monkeypatch.setattr(ipas_exam_pdf, '_resources', spy)
    extract(_pdf(tmp_path), 'L11')
    assert seen == [ipas_sample_pdf.FONT_RULES] * 2


def test_the_font_rules_differ_from_the_official_ones_only_where_acrobat_writes_differently():
    # 與公告試題的字型規則只差這三處（真的樣題 PDF 實測，見模組說明）；要再放寬，先在這裡寫清楚
    assert ipas_sample_pdf.FONT_RULES == {
        'embedded_descriptor_keys': frozenset({'CIDSet', 'FontFamily', 'FontStretch'}),
        'simple_fonts': ipas_exam_pdf.SIMPLE_FONTS | {'Arial-BoldMT'},
        'simple_tounicode': True,
    }


def _truetype(base='ArialMT', *, tounicode=None, embedded=True, extra=()):
    """pdfminer 讀到的簡單 TrueType 字型字典（Acrobat 的寫法）：tounicode 是 {字碼: 字}，extra 是字型描述多寫的欄位"""
    from pdfminer.pdftypes import PDFStream
    from pdfminer.psparser import LIT

    descriptor = {'Type': LIT('FontDescriptor'), 'FontName': LIT(base), 'Flags': 32, 'FontBBox': [0, 0, 1, 1],
                  'ItalicAngle': 0, 'Ascent': 1, 'Descent': 0, 'CapHeight': 1, 'StemV': 1}
    if embedded:
        descriptor['FontFile2'] = PDFStream({}, X.TRUETYPE)
    for key in extra:
        descriptor[key] = LIT('Arial')
    font = {'Type': LIT('Font'), 'Subtype': LIT('TrueType'), 'BaseFont': LIT(f'ABCDEF+{base}'),
            'Encoding': LIT('WinAnsiEncoding'), 'FontDescriptor': descriptor}
    if tounicode is not None:
        pairs = ' '.join(f'<{code:02X}> <{ord(text):04X}>' for code, text in tounicode.items())
        font['ToUnicode'] = PDFStream({}, (
            '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /T def /CMapType 2 def '
            f'1 begincodespacerange <00> <FF> endcodespacerange {len(tounicode)} beginbfchar {pairs} endbfchar '
            'endcmap CMapName currentdict /CMap defineresource pop end end').encode())
    return font


ACROBAT_EXTRA = ('CIDSet', 'FontFamily', 'FontStretch')


@pytest.mark.parametrize('base', ['ArialMT', 'Arial-BoldMT'])
def test_acrobats_embedded_arial_passes_the_sample_rules_but_not_the_official_ones(base):
    # 真的樣題 PDF 的英文字型：內嵌、字型描述多寫三個欄位、ToUnicode 與 WinAnsiEncoding 逐碼一致
    font = _truetype(base, tounicode={0x20: ' ', 0x41: 'A', 0x42: 'B', 0x28: '('}, extra=ACROBAT_EXTRA)
    assert ipas_exam_pdf._font_problem(font, **ipas_sample_pdf.FONT_RULES) is None
    assert ipas_exam_pdf._font_problem(font) is not None  # 公告試題的規則照舊


@pytest.mark.parametrize(('font', 'problem'), [
    (_truetype(tounicode={0x42: 'D'}, extra=ACROBAT_EXTRA),
     '/ToUnicode（字碼 0x42 對到「D」，WinAnsiEncoding 是「B」'),     # 畫 B、抽出來是 D
    (_truetype(tounicode={0x41: 'A', 0x42: '\u4e0d'}), '/ToUnicode（字碼 0x42 對到「不」'),
    (_truetype(embedded=False, tounicode={0x42: 'B'}), '/ToUnicode（只有內嵌的'),  # 沒有內嵌：閱讀器自己換字型
    (_truetype(embedded=False, extra=('FontFamily',)), '/FontDescriptor /FontFamily'),  # 沒有內嵌時照描述換字型
    (_truetype('SymbolMT', extra=ACROBAT_EXTRA), '/BaseFont /ABCDEF+SymbolMT'),  # 名稱照原樣（含子集前綴）
], ids=['lying-tounicode', 'tounicode-to-a-cjk-character', 'tounicode-not-embedded', 'family-not-embedded', 'symbol'])
def test_the_sample_font_rules_still_refuse_what_could_draw_one_letter_and_extract_another(font, problem):
    assert (ipas_exam_pdf._font_problem(font, **ipas_sample_pdf.FONT_RULES) or '').startswith(problem)


def test_the_page_resources_pass_the_font_rules_on(tmp_path):
    # _resources 把規則原樣交給 _font_problem：Acrobat 的 Arial 在頁面資源裡，照樣本的規則通過、照公告試題的不通過
    from types import SimpleNamespace

    font = _truetype(tounicode={0x41: 'A'}, extra=ACROBAT_EXTRA)
    own = {'Resources': {'Font': {'TT0': font}}}
    page = SimpleNamespace(page_obj=SimpleNamespace(pageid=7, doc=SimpleNamespace(getobj=lambda objid: own)))
    assert ipas_exam_pdf._resources(page, **ipas_sample_pdf.FONT_RULES) == []
    assert ipas_exam_pdf._resources(page)[0].startswith('字型 TT0 的 /FontDescriptor /CIDSet')


def test_a_tounicode_that_is_not_a_stream_is_refused():
    font = _truetype(extra=ACROBAT_EXTRA)
    font['ToUnicode'] = font['FontDescriptor']['FontName']  # 寫成名稱
    assert ipas_exam_pdf._font_problem(font, **ipas_sample_pdf.FONT_RULES).startswith('/ToUnicode（ToUnicode 不是串流')


@pytest.mark.parametrize('value', [0, {'Type': 'x'}], ids=['integer', 'dictionary'])
@pytest.mark.parametrize('rules', [{}, ipas_sample_pdf.FONT_RULES], ids=['official', 'sample'])
def test_a_font_file_that_is_not_a_stream_is_refused(value, rules):
    # 鍵寫了 /FontFile2、值卻不是字型檔：閱讀器當成沒有內嵌，照字型描述換字型（/FontFamily (Symbol) 讓 Poppler 把
    # 答案畫成空白，第三輪審查實測），「只在內嵌時放寬」要看字型檔是不是真的在
    font = _truetype(extra=ACROBAT_EXTRA)
    font['FontDescriptor']['FontFile2'] = value
    assert ipas_exam_pdf._font_problem(font, **rules).startswith('/FontFile2（字型檔要是串流')


def test_a_name_with_a_nul_stops_the_extraction(tmp_path):
    # /BaseFont/ArialMT/BaseFont#00x/ZapfDingbats：pdfminer 讀成另一個鍵，Poppler 在 NUL 斷開、讀到第二個 /BaseFont，
    # 答案畫成符號（第三輪審查實測）。_syntax_problem 擋得下，但它不適用於 Acrobat 的物件串流
    font = X._word_truetype('ArialMT').replace('/Encoding', '/AAAAAAAAAAAA/ZapfDingbats/Encoding', 1)
    path = _pdf(tmp_path, extras=(_first_page(_font(font)),))
    data = path.read_bytes()
    assert data.count(b'/AAAAAAAAAAAA') == 1
    path.write_bytes(data.replace(b'/AAAAAAAAAAAA', b'/BaseFont#00x'))
    for read in (extract, header):
        with pytest.raises(ValueError, match='名稱裡有 NUL'):
            read(path, 'L11')


def _nul_in_an_xref_stream(tmp_path, split):
    """字型字典的鍵帶 #00，xref 改寫成串流。split 是 /Index 從哪一號分段（None 就不分段）：pdfminer 的 get_objids 第二段
    每一筆都從資料的開頭重新數，分段之後的物件要照 _listed 列才查得到"""
    font = X._word_truetype('ArialMT').replace('/Encoding', '/AAAAAAAAAAAA/ZapfDingbats/Encoding', 1)
    data = _pdf(tmp_path, extras=(_first_page(_font(font)),)).read_bytes().replace(b'/AAAAAAAAAAAA', b'/BaseFont#00x')
    at = data.index(b'/BaseFont#00x')
    holder = [int(m[1]) for m in re.finditer(rb'(?m)^(\d+) 0 obj', data[:at])][-1]
    last = max(int(m[1]) for m in re.finditer(rb'(?m)^(\d+) 0 obj', data)) + 2
    cut = holder if split else last
    index = [(0, cut), (cut, last - cut)] if split else [(0, last)]
    path = tmp_path / 'stream.pdf'
    path.write_bytes(X._as_xref_stream(data, index))
    return path


@pytest.mark.parametrize('split', [False, True], ids=['one-range', 'two-ranges'])
def test_a_name_with_a_nul_is_found_in_every_range_of_an_xref_stream(tmp_path, split):
    path = _nul_in_an_xref_stream(tmp_path, split)
    for read in (extract, header):
        with pytest.raises(ValueError, match='名稱裡有 NUL'):
            read(path, 'L11')


def test_the_xref_is_checked_before_anything_reads_the_objects(tmp_path, monkeypatch):
    # xref 壞了時，先報頁面樹或資源的訊息會讓人去查錯地方：與公告試題相同，第一個查 xref
    monkeypatch.setattr(ipas_exam_pdf, '_page_list_problem', lambda *_: pytest.fail('xref 還沒查就讀了頁面樹'))
    with pytest.raises(ValueError, match=re.escape(ipas_sample_pdf.XREF_REBUILT)):
        extract(X._xref_with_two_spaces(_pdf(tmp_path)), 'L11')


def _check_calls(*functions):
    """這些函式的程式碼裡呼叫到的 ipas_exam_pdf 函式名稱（模組裡沒有的不算）"""
    import ast
    import inspect
    import textwrap

    found = set()
    for function in functions:
        source = textwrap.dedent(inspect.getsource(getattr(function, '__wrapped__', function)))
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Call):
                name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, 'id', None)
                if name and callable(getattr(ipas_exam_pdf, name, None)):
                    found.add(name)
    return found


# 公告試題擷取器呼叫、本身不是檢查的函式（幾何、讀表格的列、走讀檔流程）
HELPERS = {'Row', '_image_key', '_inner', '_inside', '_intersects', '_mid', '_overlaps', '_opened', '_pages'}


def test_every_official_check_runs_here_or_is_listed_with_a_reason():
    # 兩輪審查都是同一種缺口：公告試題擷取器擋得下的畫法，樣題擷取器少跑了那一道。公告試題那邊實際呼叫的檢查，
    # 這裡要嘛也呼叫，要嘛列在 NOT_APPLIED 寫明理由；那邊多了一道，這裡就紅，等人決定。只認直接呼叫的函式：
    # 用別名呼叫、或加在 NOT_APPLIED 的函式裡面的新檢查看不到；呼叫了卻走不到的死碼，靠每一道檢查自己的行為測試
    official = _check_calls(ipas_exam_pdf._opened, ipas_exam_pdf._pages, ipas_exam_pdf.rows_of)
    sample = _check_calls(ipas_sample_pdf._pages, ipas_sample_pdf._decorations)
    assert sorted(official - sample - HELPERS) == sorted(ipas_sample_pdf.NOT_APPLIED)
    assert not set(ipas_sample_pdf.NOT_APPLIED) & sample  # 列為不跑的，就真的沒有跑
    assert all(reason.strip() for reason in ipas_sample_pdf.NOT_APPLIED.values())


# 剪裁路徑：真的樣題 PDF 兩頁都沒有（內容串流沒有 W、W*），所以一律不准，矩形也一樣
def _clipped(clip):
    """題幹後面多畫一個「不」，畫之前先剪裁：clip 是路徑與剪裁運算子，{at} 是字的起點"""
    at = f'{STEM_END:.2f} {842 - STEM_Y}'
    return lambda page: X._append_content(page, f'q {clip.format(at=at)} BT /china-t 12 Tf 0 g 1 0 0 1 {at} Tm <4E0D> Tj ET Q'.encode())


@pytest.mark.parametrize(('clip', 'operator'), [
    ('{at} 12 0.01 re W n', 'W'),   # 細條：字碰到剪裁範圍就算畫出來，閱讀器上字等於消失（審查實測）
    ('{at} 12 0.01 re W* n', 'W*'),
    ('{at} 12 12 re W n', 'W'),     # 整個字都在裡面的矩形也不准
    ('{at} 0 0 re W n', 'W'),       # 空的矩形
    ('W n', 'W'),                   # 沒有路徑就剪裁：PyMuPDF 的 get_drawings 不列
], ids=['thin-rectangle', 'thin-rectangle-even-odd', 'rectangle-around-the-glyph', 'empty-rectangle', 'no-path'])
def test_any_clip_stops_the_extraction(tmp_path, clip, operator):
    path = _pdf(tmp_path, extras=(_first_page(_clipped(clip)),))
    for read in (extract, header):
        with pytest.raises(ValueError, match=re.escape(f'第 1 頁有剪裁路徑（內容串流的「{operator}」）')):
            read(path, 'L11')


def test_a_clip_on_the_second_page_stops_the_extraction(tmp_path):
    path = _pdf(tmp_path, extras=(_on_page(2, lambda page: X._append_content(page, b'q 0 0 1 1 re W n Q')),))
    with pytest.raises(ValueError, match=re.escape('第 2 頁有剪裁路徑')):
        extract(path, 'L12')


def test_a_broken_content_stream_is_reported_before_the_clip(tmp_path):
    # _clip_operator 假設內容串流切得成詞：切不下去的那一段後面它看不到
    path = _pdf(tmp_path, extras=(_first_page(lambda page: X._append_content(page, b'q 0 0 1 1 re W n BX Q')),))
    with pytest.raises(ValueError, match=re.escape('第 1 頁：內容串流有真的樣題 PDF 不會寫的運算子「BX」')):
        extract(path, 'L11')


def test_the_letter_w_in_a_string_or_a_name_is_not_a_clip(tmp_path):
    def draw(page):
        X._add_resource(page, 'Font', 'W', X.HELVETICA)
        X._append_content(page, b'BT /W 12 Tf 0 g 1 0 0 1 %.2f %.2f Tm (W) Tj ET' % (STEM_END, 842 - STEM_Y))
    assert extract(_pdf(tmp_path, extras=(_first_page(draw),)), 'L11')[0]['stem'].endswith('W')


# 字型檔：/FontFile2 要是真的 TrueType（閱讀器讀不了字型檔時改照字型描述換字型，/FontFamily (Symbol) 讓 Poppler 把
# (C) 畫成 (Χ)，擷取不變，審查實測）。7 份真實 PDF 的 30 個字型檔都是 00 01 00 00 開頭，FreeType 解得開
@pytest.mark.parametrize(('program', 'problem'), [
    (b'', '不是 TrueType'),                                  # pymupdf.Font 收到空的會默默換成內建字型，要先擋
    (b'garbage' * 100, '不是 TrueType'),
    (b'OTTO' + X.TRUETYPE[4:], '不是 TrueType'),
    (b'\0' + X.TRUETYPE[1:2] + b'\1\0' + X.TRUETYPE[4:], '不是 TrueType'),  # 開頭只有前兩個位元組對
    (b'\0\xff\xff\xff' + X.TRUETYPE[4:], '不是 TrueType'),                 # 只有第一個位元組對
    (X.TRUETYPE[:4] + b'\0' * 200, 'FreeType 解不開'),       # 開頭對，後面是垃圾
    (X.TRUETYPE[:1024], 'FreeType 解不開'),                  # 截斷
], ids=['empty', 'garbage', 'opentype-header', 'two-bytes-of-the-header', 'one-byte-of-the-header',
        'garbage-after-the-header', 'truncated'])
@pytest.mark.parametrize('rules', [{}, ipas_sample_pdf.FONT_RULES], ids=['official', 'sample'])
def test_a_font_file_that_is_not_a_real_font_is_refused(program, problem, rules):
    from pdfminer.pdftypes import PDFStream

    font = _truetype(extra=ACROBAT_EXTRA)
    font['FontDescriptor']['FontFile2'] = PDFStream({}, program)
    assert (ipas_exam_pdf._font_problem(font, **rules) or '').startswith(f'/FontFile2（{problem}')


@pytest.mark.parametrize('program', [b'', b'garbage' * 100], ids=['empty', 'garbage'])
def test_a_type0_font_file_that_is_not_a_real_font_is_refused(program):
    from pdfminer.pdftypes import PDFStream

    font = X._type0()
    assert ipas_exam_pdf._font_problem(font) is None
    font['DescendantFonts'][0]['FontDescriptor']['FontFile2'] = PDFStream({}, program)
    assert (ipas_exam_pdf._font_problem(font) or '').startswith('/FontFile2（不是 TrueType')


def _broken_font_file(program):
    """真的把一個簡單 TrueType 字型放進頁面資源，字型檔換成 program，字型描述寫 /FontFamily (Symbol)"""
    def draw(page):
        doc = page.parent
        data = doc.get_new_xref()
        doc.update_object(data, '<<>>')
        doc.update_stream(data, program, new=True)
        descriptor = doc.get_new_xref()
        doc.update_object(descriptor, f'<</Type/FontDescriptor/FontName/ArialMT/Flags 32/FontBBox[0 0 1 1]/ItalicAngle 0'
                                      f'/Ascent 1/Descent 0/CapHeight 1/StemV 1/FontFamily(Symbol)/FontFile2 {data} 0 R>>')
        font = doc.get_new_xref()
        doc.update_object(font, '<</Type/Font/Subtype/TrueType/BaseFont/ABCDEF+ArialMT/Encoding/WinAnsiEncoding'
                                f'/FontDescriptor {descriptor} 0 R>>')
        X._add_resource(page, 'Font', 'FS', f'{font} 0 R')
        X._append_content(page, b'BT /FS 12 Tf 0 g 1 0 0 1 %.2f %.2f Tm (C) Tj ET' % (STEM_END, 842 - STEM_Y))
    return draw


@pytest.mark.parametrize('program', [b'', b'garbage' * 100], ids=['empty', 'garbage'])
def test_a_broken_font_file_stops_the_extraction(tmp_path, program):
    path = _pdf(tmp_path, extras=(_first_page(_broken_font_file(program)),))
    with pytest.raises(ValueError, match=re.escape('字型 FS 的 /FontFile2（不是 TrueType')):
        extract(path, 'L11')


# 開檔之前先查：/Info 指向只是一個參照、繞回自己的物件時，pdfminer 開檔就卡住，不會出錯。pdfplumber.open 換成立刻失敗
# 的版本，這一條壞掉時是紅燈，不是測試卡住
@pytest.mark.parametrize('objects', [[*X.ONE_PAGE, b'7 0 R'], [*X.ONE_PAGE, b'8 0 R', b'7 0 R']],
                         ids=['self-reference', 'two-step-cycle'])
def test_a_self_referencing_info_is_refused_before_pdfplumber_opens_the_file(tmp_path, monkeypatch, objects):
    import pdfplumber

    monkeypatch.setattr(pdfplumber, 'open', lambda path: pytest.fail('pdfplumber 開了這份 PDF：開檔就卡住'))
    path = tmp_path / 'info.pdf'
    path.write_bytes(X._hand_pdf(objects, trailer=b'/Info 7 0 R'))
    with pytest.raises(ValueError, match='第 7 號物件整個只是一個參照'):
        extract(path, 'L11')


# Acrobat 的結構：真的樣題 PDF 是線性化的，開頭是線性化字典與第一段 xref 串流（接「startxref 0」，/Prev 指到檔尾那一段），
# 物件大多在物件串流裡，整份沒有 xref 表與 trailer。_syntax_problem 只為它放寬幾處（SYNTAX_RULES），其餘照查
def _section(number, entries, root, size, prev=None, typed=True):
    """第 number 號物件寫成一段 xref 串流：entries 是 {編號: 位置}（None 是空的一筆）。"""
    numbers = sorted(entries)
    rows = b''.join(struct.pack('>BIH', 0, 0, 65535 * (n == 0)) if entries[n] is None
                    else struct.pack('>BIH', 1, entries[n], 0) for n in numbers)
    index = b' '.join(b'%d 1' % n for n in numbers)
    previous = b'/Prev %09d' % prev if prev is not None else b''
    kind = b'/Type/XRef' if typed else b''
    return (b'%d 0 obj\n<<%s/Size %d/W[1 4 2]/Index[%s]/Root %d 0 R%s/Length %d>>stream\n'
            % (number, kind, size, index, root, previous, len(rows)) + rows + b'\nendstream\nendobj\n')


def _table_section(entries, root, size, prev=None):
    """一段 xref 表與 trailer：entries 的編號要連續。"""
    numbers = sorted(entries)
    rows = b''.join(b'0000000000 65535 f \n' if entries[n] is None else b'%010d 00000 n \n' % entries[n] for n in numbers)
    previous = b'/Prev %09d' % prev if prev is not None else b''
    return (b'xref\n%d %d\n' % (numbers[0], len(numbers)) + rows
            + b'trailer\n<</Size %d/Root %d 0 R%s>>\n' % (size, root, previous))


def _with_length(data):
    """線性化字典的 /L 改成 data 的長度：長度相符，閱讀器才走線性化的讀法、先讀第一段 xref（不符就照 startxref）"""
    return re.sub(rb'/L \d{9}', b'/L %09d' % len(data), data, count=1)


@dataclasses.dataclass
class Linearized:
    data: bytes
    first: dict      # 第一段 xref 登記的 {編號: 位置}
    root: int
    size: int        # 下一個沒有用的物件編號
    first_at: int    # 第一段 xref 的位置
    last_at: int     # 檔尾那一段 xref 的位置
    pages: list      # 頁面樹的每一頁

    def appended(self, number, body, entries, prev):
        """檔尾接一份新的第 number 號物件（body）與一段 xref（entries 再加上它，/Prev 是 prev）"""
        at = len(self.data)
        added = b'%d 0 obj\n' % number + body + b'\nendobj\n' if body is not None else b''
        own = self.size
        where = at + len(added)
        listed = {**entries, own: where}
        if body is not None:
            listed[number] = at
        section = _section(own, listed, self.root, own + 1, prev=prev)
        return _with_length(self.data + added + section + b'startxref\n%d\n%%%%EOF\n' % where)


def _linearized(tmp_path, pages=PAGES, *, source=None, table=False, before=b'', extra=b'', closing=b'\nendobj\n',
                hints=b'/H [ 0 0]', version=b'1'):
    """_pdf 畫的 PDF（或 source）改寫成線性化的結構。PyMuPDF 不再寫線性化（linear=1 會丟錯），這裡照真的樣題 PDF 自己排：
    檔頭、線性化字典、第一段 xref、「startxref 0」、物件、檔尾那一段 xref、「startxref 第一段的位置」。後半的物件登記在
    第一段，前半在檔尾那一段。/L、/O、/N 閱讀器都會讀（第一頁就是 /O，頁數就是 /N），要是對的；/E 與
    提示資料（/H）只用來判斷資料下載到哪裡，這裡沒有寫提示資料，PDFium 因此不認它是線性化，Poppler 認。table 改用 xref
    表。before 是字典前面多寫的位元組，extra 是字典多寫的欄位，hints 換掉 /H，closing
    是字典之後到第一段 xref 之前的位元組。數字都補滿九位：要改時長度不變，xref 登記的位置才不會跑掉。"""
    data = (source or _pdf(tmp_path, pages)).read_bytes()
    start = int(data.rsplit(b'startxref', 1)[1].split()[0])
    body = data[:start]
    spots = [(int(m[1]), m.start()) for m in re.finditer(rb'(?m)^(\d+) 0 obj', body)]
    head = body[:spots[0][1]] + before
    chunks = {n: body[at:spots[i + 1][1] if i + 1 < len(spots) else start] for i, (n, at) in enumerate(spots)}
    root = int(re.search(rb'/Root (\d+) 0 R', data[start:])[1])
    top = max(chunks)
    lin, first, last = top + 1, top + 2, top + 3
    with pymupdf.open(stream=data, filetype='pdf') as doc:
        tree = [page.xref for page in doc]
        middle = doc[0].get_contents()[0]  # 第 1 頁的內容起登記在第一段
    numbers = [*range(middle, top + 1), lin] + ([] if table else [first, last])

    def layout(entries, last_at):
        dictionary = (b'%d 0 obj\n<</Linearized %s/L %09d/O %09d/E %09d/N %d/T %09d%s%s>>'
                      % (lin, version, 0, tree[0], 0, len(tree), last_at, hints, extra) + closing)
        if table:
            section = _table_section(entries, root, lin + 1, prev=last_at)
        else:
            section = _section(first, entries, root, last + 1, prev=last_at)
        return dictionary, section

    dictionary, section = layout(dict.fromkeys(numbers, 0), 0)
    tail = b'startxref\n0\n%%EOF\n'
    at, positions = len(head) + len(dictionary) + len(section) + len(tail), {}
    for number, chunk in chunks.items():
        positions[number] = at
        at += len(chunk)
    entries = {n: positions[n] for n in range(middle, top + 1)}
    entries.update({lin: len(head)} if table else {lin: len(head), first: len(head) + len(dictionary), last: at})
    low = {0: None, **{n: positions[n] for n in range(1, middle)}}
    dictionary, section = layout(entries, at)
    main = _table_section(low, root, middle) if table else _section(last, low, root, middle)
    out = (head + dictionary + section + tail + b''.join(chunks.values()) + main
           + b'startxref\n%d\n%%%%EOF\n' % (len(head) + len(dictionary)))
    return Linearized(_with_length(out), entries, root, last + 1, len(head) + len(dictionary), at, tree)


def _write(tmp_path, data, name='crafted.pdf'):
    path = tmp_path / name
    path.write_bytes(data)
    return path


ANSWER_B = '解答：(B'.encode('utf-16-be').hex().encode()  # PyMuPDF 寫 china-t 的字：字碼就是 Unicode
ANSWER_D = '解答：(D'.encode('utf-16-be').hex().encode()


def _answer_stream(linear):
    """第 1 頁畫「解答：(B)」的那一段內容串流（一行一段）：(物件編號, 答案換成 D 的新版本)。"""
    doc = pymupdf.open(stream=linear.data, filetype='pdf')
    number = next(xref for xref in doc[0].get_contents() if ANSWER_B in doc.xref_stream(xref))
    assert number in linear.first  # 登記在第一段：線性化讀法先讀的那一段
    swapped = doc.xref_stream(number).replace(ANSWER_B, ANSWER_D)
    return number, b'<</Length %d>>stream\n' % len(swapped) + swapped + b'\nendstream'


def test_the_linearized_structure_of_the_real_pdf_passes(tmp_path):
    # 真的樣題 PDF 有兩個 startxref，第一個是 0：不能只因為有兩個就擋（官方 PDF 不進 CI，這裡用同樣的結構）
    linear = _linearized(tmp_path)
    assert linear.data.count(b'startxref') == 2 and linear.data.count(b'/Linearized') == 1
    assert b'trailer' not in linear.data and b'\nxref' not in linear.data
    path = _write(tmp_path, linear.data)
    assert extract(path, 'L11')[1]['answer'] == 'C' and extract(path, 'L12')[1]['answer'] == 'C'


def test_an_incremental_update_on_a_linearized_file_stops_the_extraction(tmp_path):
    # 檔尾再接一段 xref、覆寫第 1 題的答案，/L 跟著改成新的長度：pdfminer 與 MuPDF 讀檔尾那一段（答案 D），Poppler 先讀
    # 第一段（答案 B，這個合成檔實測）。真的樣題 PDF 改成這樣，PDFium 的 FPDFAvail_GetDocument 也是先讀第一段（審查實測）
    linear = _linearized(tmp_path)
    number, swapped = _answer_stream(linear)
    data = linear.appended(number, swapped, {}, linear.first_at)
    with pytest.raises(ValueError, match=f'第 {number} 號物件在幾段 xref 裡登記的位置不同'):
        extract(_write(tmp_path, data), 'L11')


def test_an_update_that_skips_the_first_xref_section_stops_the_extraction(tmp_path):
    # 上一條的反向：新的一段 xref 重新登記第一段的所有物件，/Prev 跳過第一段、直接指到檔尾那一段。pdfminer 根本沒有讀到
    # 第一段，沒有「幾段登記的不同」可以比，閱讀器的線性化讀法卻照樣先讀它。靠舊版本的物件開頭沒有人登記擋下
    linear = _linearized(tmp_path)
    number, swapped = _answer_stream(linear)
    data = linear.appended(number, swapped, linear.first, linear.last_at)
    with pytest.raises(ValueError, match=f'「{number} 0 obj」不是 xref 登記的物件開頭'):
        extract(_write(tmp_path, data), 'L11')


def test_a_later_section_that_frees_an_object_stops_the_extraction(tmp_path):
    # 新的一段把物件標成空的：pdfminer 還用舊的一筆（字照樣抽得到），MuPDF 與閱讀器讀成 null
    linear = _linearized(tmp_path)
    number, _ = _answer_stream(linear)
    data = linear.appended(number, None, {number: None}, linear.first_at)
    with pytest.raises(ValueError, match=f'第 {number} 號物件 pdfminer 與 MuPDF 讀到的 xref 登記不同'):
        extract(_write(tmp_path, data), 'L11')


def test_a_linearized_table_passes(tmp_path):
    # qpdf 線性化時寫的是 xref 表
    linear = _linearized(tmp_path, table=True)
    assert b'trailer' in linear.data and linear.data.count(b'startxref') == 2
    assert [q['answer'] for q in extract(_write(tmp_path, linear.data), 'L11')] == ['B', 'C']


def _rewrite(linear, old, new):
    """等長地改線性化字典：xref 登記的位置不變"""
    assert linear.data.count(old) == 1 and len(old) == len(new)
    return linear.data.replace(old, new)


def _second_page_first(linear):
    return _rewrite(linear, b'/O %09d' % linear.pages[0], b'/O %09d' % linear.pages[1])


@pytest.mark.parametrize(('change', 'message'), [
    # 頁面樹外的另一頁：pdfminer 與 MuPDF 照頁面樹讀，Chrome、Firefox 的第一頁是 /O（審查實測：題庫 B，閱讀器 C）
    (_second_page_first, '線性化字典的 /O'),
    (lambda linear: _rewrite(linear, b'/N 2/', b'/N 1/'), '線性化字典的 /N'),      # Poppler 與 FPDFAvail 上第 2 頁不見
    (lambda linear: _rewrite(linear, b'/Linearized 1/', b'/Linearized 2/'), '線性化字典的 /Linearized'),
    (lambda linear: re.sub(rb'/L \d{9}', b'/L 000000001', linear.data, count=1), '線性化字典的 /L'),
    (lambda linear: _rewrite(linear, b'/H [ 0 0]', b'/H 000000'), '線性化字典的 /H'),
    (lambda linear: re.sub(rb'/T \d{9}', b'/T (xxxxxxx)', linear.data, count=1), '線性化字典的 /T'),
    (lambda linear: re.sub(rb'/E \d{9}', b'/E (xxxxxxx)', linear.data, count=1), '線性化字典的 /E'),
], ids=['first-page-outside', 'page-count', 'version', 'length', 'hints-not-an-array', 'main-offset-not-a-number',
        'first-page-end-not-a-number'])
def test_a_linearization_dictionary_that_disagrees_with_the_file_stops_the_extraction(tmp_path, change, message):
    with pytest.raises(ValueError, match=re.escape(message)):
        extract(_write(tmp_path, change(_linearized(tmp_path))), 'L11')


@pytest.mark.parametrize(('options', 'message'), [
    ({'extra': b'/P 1'}, '線性化字典的 /P'),           # /O 是第幾頁
    ({'extra': b'/P (x)'}, '線性化字典的 /P'),
    ({'extra': b'/P 0.0'}, '線性化字典的 /P'),         # 是 0，但不是整數
    ({'extra': b'/Q 1'}, '線性化字典有 /Q'),
    ({'hints': b''}, '線性化字典的 /H'),
    ({'version': b'1.0'}, '線性化字典的 /Linearized'),  # 是 1，但不是整數
], ids=['first-page-number', 'first-page-number-not-an-integer', 'first-page-number-real', 'unknown-key', 'missing-key',
        'version-real'])
def test_a_linearization_dictionary_with_other_keys_stops_the_extraction(tmp_path, options, message):
    with pytest.raises(ValueError, match=re.escape(message)):
        extract(_write(tmp_path, _linearized(tmp_path, **options).data), 'L11')


def test_page_zero_as_the_first_page_number_is_accepted(tmp_path):
    linear = _linearized(tmp_path, extra=b'/P 0')
    assert extract(_write(tmp_path, linear.data), 'L11')[1]['answer'] == 'C'


def _new_object(linear):
    return linear.size + 1, b'<</Length 1>>stream\nx\nendstream'


def test_an_add_only_update_stops_the_extraction(tmp_path):
    # 沒有物件登記兩次，閱讀器走線性化不讀新的一段，那個物件是 null（審查實測）
    linear = _linearized(tmp_path)
    with pytest.raises(ValueError, match=re.escape('線性化之後又接了更新')):
        extract(_write(tmp_path, linear.appended(*_new_object(linear), {}, linear.first_at)), 'L11')


def test_an_update_that_skips_an_untyped_first_section_stops_the_extraction(tmp_path, any_stream_key):
    # 第一段拿掉 /Type、新的一段重新登記第一段的物件、/Prev 跳過它：沒有「沒有讀到的 xref 串流」，物件開頭都有人登記，
    # 分歧放在物件串流裡就沒有多的物件開頭（審查實測：只看 xref 登記的檢查都過了，題庫 B，閱讀器 C）
    linear = _linearized(tmp_path)
    linear.data = _rewrite(linear, b'/Type/XRef/Size %d/W[1 4 2]/Index[%d 1' % (linear.size, min(linear.first)),
                           b'/Typf/XRef/Size %d/W[1 4 2]/Index[%d 1' % (linear.size, min(linear.first)))
    with pytest.raises(ValueError, match=re.escape('線性化之後又接了更新')):
        extract(_write(tmp_path, linear.appended(*_new_object(linear), linear.first, linear.last_at)), 'L11')


@pytest.mark.parametrize('before', [b'%endobj\n', b'%' + b'x' * 1100 + b'\n'], ids=['endobj-in-a-comment', 'past-the-search-window'])
def test_the_first_section_must_be_where_poppler_looks_for_it(tmp_path, before):
    # Poppler 在檔案開頭的 1024 個位元組裡找第一個 endobj，第一段 xref 就在它後面：註解裡的 endobj 它一樣算，找不到就照 0 讀
    linear = _linearized(tmp_path, before=before)
    with pytest.raises(ValueError, match=re.escape('線性化之後又接了更新')):
        extract(_write(tmp_path, linear.data), 'L11')


def _section_layout(prefix, sections):
    """一個線性化字典放在 prefix 後面的最小假文件，只給 _linearized_problem 看：sections(第一個 endobj 後面的位置) 是
    讀到的每一段 xref 的位置"""
    from types import SimpleNamespace

    from pdfminer.pdftypes import PDFObjRef

    head = {'Linearized': 1, 'O': 3, 'E': 0, 'N': 1, 'T': 0, 'H': [0, 0]}
    body = b'1 0 obj\n<</Linearized 1>>\nendobj\n'
    data = b'%PDF-1.7\n' + prefix + body
    head['L'] = len(data)
    after = data.index(b'endobj') + len(b'endobj\n')
    doc = SimpleNamespace(starts=sections(after), catalog={'Pages': {'Kids': [PDFObjRef(None, 3)]}}, getobj=lambda _: head)
    return ipas_exam_pdf._linearized_problem(data, data, doc, {1: (None, data.index(b'1 0 obj'), 0)}, allowed=True,
                                             home='ipas_sample_pdf')


def test_the_section_rule_accepts_two_sections_right_after_the_dictionary():
    assert _section_layout(b'', lambda after: [after, 999]) is None


@pytest.mark.parametrize(('prefix', 'sections'), [
    (b'%endobj\n', lambda after: [after, 999]),      # 第一段排在字典前面：Poppler 照註解裡的 endobj 找得到它，PDFium 找不到
    (b'', lambda after: [after, 999, 888]),           # 第三段
    (b'', lambda after: [after]),                     # 只有一段：第一段沒有 /Prev
], ids=['first-section-before-the-dictionary', 'three-sections', 'one-section'])
def test_the_section_rule_refuses_any_other_layout(prefix, sections):
    assert '線性化之後又接了更新' in _section_layout(prefix, sections)


def test_the_first_section_must_start_inside_the_search_window(tmp_path):
    # Poppler 只看前 1024 個位元組：第一段從第 1023 個位元組開始還在裡面，從第 1024 個開始就不在了
    start = _linearized(tmp_path).first_at
    padded = lambda at: _linearized(tmp_path, before=b'%' + b'x' * (at - start - 2) + b'\n')
    assert padded(1023).first_at == 1023 and padded(1024).first_at == 1024
    assert extract(_write(tmp_path, padded(1023).data), 'L11')[1]['answer'] == 'C'
    with pytest.raises(ValueError, match=re.escape('線性化之後又接了更新')):
        extract(_write(tmp_path, padded(1024).data), 'L11')


def test_a_comment_between_the_dictionary_and_the_first_section_is_refused(tmp_path):
    # PDFium 跳過註解、Poppler 不跳過：兩邊讀第一段的位置不同
    linear = _linearized(tmp_path, closing=b'\nendobj\n%comment\n')
    with pytest.raises(ValueError, match=re.escape('線性化之後又接了更新')):
        extract(_write(tmp_path, linear.data), 'L11')


def test_a_stream_that_says_linearized_as_the_first_object_is_refused(tmp_path, any_stream_key):
    # 閱讀器讀第一個物件時只看字典，後面接不接 stream 都一樣
    linear = _linearized(tmp_path, extra=b'/Length 0', closing=b'stream\n\nendstream\nendobj\n')
    with pytest.raises(ValueError, match=re.escape('線性化字典有 /Length')):
        extract(_write(tmp_path, linear.data), 'L11')


def test_a_linearization_dictionary_that_is_not_the_first_object_is_ignored(tmp_path):
    # PyMuPDF 重存真的樣題時，那個字典留在檔案中間：閱讀器只看第一個物件，整份都照 startxref 讀
    doc = pymupdf.open(_pdf(tmp_path))
    doc.update_object(doc.get_new_xref(), '<</Linearized 1/L 1/O 1/E 1/N 9/T 1/H[0 0]>>')
    path = tmp_path / 'stale.pdf'
    doc.save(path)
    assert [q['answer'] for q in extract(path, 'L11')] == ['B', 'C']


def _official_linearized(tmp_path, change=lambda linear: linear.data):
    return _write(tmp_path, change(_linearized(tmp_path, source=X._two_page_exam(tmp_path))), 'exam.pdf')


@pytest.mark.parametrize('change', [
    lambda linear: linear.data,
    _second_page_first,
    lambda linear: linear.appended(*_new_object(linear), {}, linear.first_at),
], ids=['linearized', 'first-page-outside', 'add-only-update'])
def test_the_official_extractor_refuses_every_linearized_pdf(tmp_path, change, any_stream_key):
    # 6 份真實的試題 PDF 都不是線性化的：公告試題路徑一律不收，上面這一類一次擋掉
    with pytest.raises(ValueError, match=re.escape('PDF 是線性化的')):
        ipas_exam_pdf.extract(_official_linearized(tmp_path, change))


def _object_streams(tmp_path, value='[1 0 R null 2 0 R]', pad=None):
    """_pdf 畫的 PDF 改存成物件串流加 xref 串流（PyMuPDF 的 use_objstms）。另加一個物件 value：Acrobat 的結構樹
    （/ParentTree）是物件串流裡帶 null 的陣列。pad 是存檔之後的 (舊, 新)：等長地換掉物件串流裡的文字。"""
    doc = pymupdf.open(_pdf(tmp_path))
    extra = doc.get_new_xref()
    doc.update_object(extra, value)
    path = tmp_path / 'objstm.pdf'
    doc.save(path, use_objstms=1)
    if pad:
        data = path.read_bytes()
        assert data.count(pad[0]) == 1
        path.write_bytes(data.replace(*pad))
    return path


def test_acrobats_object_streams_pass_the_sample_rules_but_not_the_official_ones(tmp_path):
    path = _object_streams(tmp_path)
    data = path.read_bytes()
    assert b'/ObjStm' in data and b'trailer' not in data
    assert [q['answer'] for q in extract(path, 'L11')] == ['B', 'C']
    with pymupdf.open(path) as rendered:  # 公告試題的規則照舊
        assert '關鍵字「null」不在它的位置' in ipas_exam_pdf._syntax_problem(path, rendered)


def test_an_xref_stream_alone_is_only_accepted_with_the_sample_rules(tmp_path):
    data = _pdf(tmp_path).read_bytes()
    size = max(int(m[1]) for m in re.finditer(rb'(?m)^(\d+) 0 obj', data)) + 2
    path = _write(tmp_path, X._as_xref_stream(data, [(0, size)]))
    with pymupdf.open(path) as rendered:
        assert ipas_exam_pdf._syntax_problem(path, rendered, **ipas_sample_pdf.SYNTAX_RULES) is None
        assert '找不到 /Root 是參照的 trailer' in ipas_exam_pdf._syntax_problem(path, rendered)


@pytest.mark.parametrize(('value', 'pad'), [
    ('<</A 1234>>', (b'/A 1234', b'/A null')),  # 字典裡的值
    ('[7391]', (b'[7391]', b'null  ')),         # 物件串流的最上層（純數字的物件 PyMuPDF 不放進物件串流）
], ids=['dictionary-value', 'top-level'])
def test_a_null_outside_an_array_in_an_object_stream_is_still_refused(tmp_path, value, pad):
    # 放寬的只有陣列裡的 null（真的樣題 PDF 全部 15 個都是）。其他位置 pdfminer 在物件串流裡讀成關鍵字，閱讀器讀成 null
    path = _object_streams(tmp_path, value, pad=pad)
    with pytest.raises(ValueError, match='關鍵字「null」不在它的位置'):
        extract(path, 'L11')


def test_a_trailer_without_a_root_reference_is_still_refused_with_the_sample_rules(tmp_path):
    # 放寬的只有整份沒有 trailer 的 PDF：有 trailer、Poppler 卻從那裡找不到 /Root 的，規則照舊
    data = _pdf(tmp_path).read_bytes()
    assert data.count(b'\ntrailer') == 1
    path = _write(tmp_path, data.replace(b'\ntrailer', b'\n trailer'))
    with pymupdf.open(path) as rendered:
        problem = ipas_exam_pdf._syntax_problem(path, rendered, **ipas_sample_pdf.SYNTAX_RULES)
    assert '找不到 /Root 是參照的 trailer' in problem


def test_only_a_pdf_without_any_trailer_is_excused_from_the_poppler_rebuild_rule(tmp_path):
    # Poppler 讀得到這個 trailer（read 不是空的），裡面卻沒有 /Root 是參照的（rooted 是空的）：放寬只看 read，不看 rooted
    assert '找不到 /Root 是參照的 trailer' in ipas_exam_pdf._rebuild_problem(_pdf(tmp_path).read_bytes(), {}, None, set(),
                                                                         xref_streams_only=True)


def test_the_syntax_rules_are_only_what_the_real_pdf_needs():
    assert ipas_sample_pdf.SYNTAX_RULES == {'array_null_in_object_streams': True, 'xref_streams_only': True, 'linearized': True,
                                            'stream_keys': ipas_sample_pdf.STREAM_KEYS, 'home': 'ipas_sample_pdf'}


# 白名單：目錄字典、頁面字典、頁面資源只收真實 PDF 實際寫的鍵（7 份實測）。XFA 讓 Firefox 整份畫另一份文件，/DefaultGray
# 讓 Poppler 把字畫成白的（審查實測），下一種寫法也一樣，不用一招一招擋
@pytest.mark.parametrize(('key', 'value'), [
    ('AcroForm', '<</Fields[]/XFA 1 0 R>>'), ('OpenAction', '<</S/JavaScript/JS(x)>>'), ('AA', '<<>>'), ('Names', '<<>>'),
    ('Collection', '<</View/D>>'), ('PageMode', '/UseThumbs'), ('Version', '/1.7'), ('ViewerPreferences', '<<>>'),
], ids=['xfa', 'open-action', 'additional-actions', 'names', 'portfolio', 'page-mode', 'version', 'word-only-key'])
def test_a_catalog_key_the_real_pdf_does_not_write_stops_the_extraction(tmp_path, key, value):
    doc = pymupdf.open(_pdf(tmp_path))
    doc.xref_set_key(doc.pdf_catalog(), key, value)
    path = tmp_path / 'catalog.pdf'
    doc.save(path)
    for read in (extract, header):
        with pytest.raises(ValueError, match=re.escape(f'目錄字典有 /{key}')):
            read(path, 'L11')


@pytest.mark.parametrize(('key', 'name', 'value'), [
    ('ColorSpace', 'DefaultGray', '[/Separation /X /DeviceRGB 1 0 R]'), ('ColorSpace', 'CS0', '/DeviceRGB'),
    ('Properties', 'P0', '<</Type/OCG/Name(x)>>'), ('Pattern', 'P0', '<<>>'), ('Shading', 'S0', '<<>>'),
    ('ProcSet', 'PDF', 'true'), ('ExtGState', 'GS0', '<</Type/ExtGState>>'), ('XObject', 'X0', '1 0 R'),
], ids=['default-gray', 'unused-color-space', 'properties', 'pattern', 'shading', 'proc-set', 'graphics-state', 'xobject'])
def test_a_resource_the_real_pdf_does_not_write_stops_the_extraction(tmp_path, key, name, value):
    path = _pdf(tmp_path, extras=(_first_page(lambda page: X._add_resource(page, key, name, value)),))
    with pytest.raises(ValueError, match=re.escape(f'第 1 頁的頁面資源有 /{key}')):
        extract(path, 'L11')


NEXT_STEP = '下一步：人工用瀏覽器與 pdftotext 比對這份 PDF'


def _refusal(path):
    with pytest.raises(ValueError) as refused:
        extract(path, 'L11')
    return str(refused.value)


def test_an_allow_list_refusal_names_every_key_the_list_and_the_next_step(tmp_path):
    # 下一份官方 PDF 最可能撞到白名單：訊息要讓人知道哪一頁、哪個鍵、改哪個常數、下一步做什麼，一次列完，不必一個一個試
    def add(page):
        doc = page.parent
        doc.xref_set_key(doc.pdf_catalog(), 'Outlines', '<<>>')
        doc.xref_set_key(doc.pdf_catalog(), 'PageLabels', '<<>>')
    message = _refusal(_pdf(tmp_path, extras=(_first_page(add),)))
    assert '目錄字典有 /Outlines、/PageLabels' in message
    assert 'ipas_sample_pdf.CATALOG_KEYS' in message and NEXT_STEP in message


def test_a_page_key_refusal_lists_every_page(tmp_path):
    def add(page):
        page.parent.xref_set_key(page.xref, 'Thumb', '1 0 R')
        page.parent.xref_set_key(page.xref, 'TrimBox', '[0 0 842 842]')
    message = _refusal(_pdf(tmp_path, extras=(add,)))
    assert '第 1 頁的頁面字典有 /Thumb、/TrimBox' in message and '第 2 頁的頁面字典有 /Thumb、/TrimBox' in message
    assert 'ipas_exam_pdf.PAGE_KEYS' in message and NEXT_STEP in message


def test_a_resource_refusal_lists_every_page_and_gives_the_right_reason(tmp_path):
    # /ProcSet 無害，真的樣題只是沒有寫：理由不能是「轉換函數、混色、遮罩」
    add = lambda page: (X._add_resource(page, 'ColorSpace', 'CS0', '/DeviceRGB'),
                        X._add_resource(page, 'ProcSet', 'PDF', 'true'))
    message = _refusal(_pdf(tmp_path, extras=(add,)))
    assert '第 1 頁的頁面資源有 /ColorSpace、/ProcSet' in message and '第 2 頁的頁面資源有 /ColorSpace、/ProcSet' in message
    assert 'ipas_sample_pdf.RESOURCE_KEYS' in message and NEXT_STEP in message
    assert '轉換函數' not in message


@pytest.mark.parametrize('draw', [_with_state('/BM/Lighten'), lambda page: X._append_content(page, b'BX q Q EX')],
                         ids=['resources', 'content-stream'])
def test_a_refusal_of_the_acrobat_pdf_does_not_call_it_word(tmp_path, draw):
    assert 'Word' not in _refusal(_pdf(tmp_path, extras=(_first_page(draw),)))


def test_a_syntax_refusal_of_the_acrobat_pdf_does_not_call_it_word(tmp_path):
    message = _refusal(_write(tmp_path, _linearized(tmp_path, extra=b'/Q 1').data))
    assert 'Word' not in message and message.startswith('PDF 的物件不是真的樣題 PDF 的寫法')


def _on_page(number, draw):
    seen = []

    def once(page):
        seen.append(page)
        if len(seen) == number:
            draw(page)
    return once


@pytest.mark.parametrize('box', [(0, 0, 842, 841), (0, 0, 800, 842), (0, 40, 842, 842), (40, 0, 842, 842)],
                         ids=['bottom', 'right', 'top', 'left'])
@pytest.mark.parametrize('number', [1, 2], ids=['first-page', 'second-page'])
def test_a_crop_box_smaller_than_the_page_stops_the_extraction(tmp_path, number, box):
    # 切掉最後一行的下半部：字碰到裁切範圍，PyMuPDF 算畫出來了，閱讀器上只剩上緣（審查實測：答案換成 D 照收）。不比切掉
    # 多少，CropBox 一律要等於 MediaBox，四個邊都一樣
    path = _pdf(tmp_path, extras=(_on_page(number, lambda page: page.set_cropbox(pymupdf.Rect(box))),))
    with pytest.raises(ValueError, match=re.escape(f'第 {number} 頁的 CropBox 與 MediaBox 不同')):
        extract(path, 'L12')


def test_a_crop_box_equal_to_the_media_box_is_accepted(tmp_path):
    # 真的樣題每一頁都寫，值與 MediaBox 相同
    path = _pdf(tmp_path, extras=(lambda page: page.set_cropbox(page.mediabox),))
    assert b'/CropBox' in path.read_bytes()
    assert extract(path, 'L11')[1]['answer'] == 'C'


@pytest.mark.parametrize(('key', 'value'), [
    ('UserUnit', '2'), ('TrimBox', '[0 0 842 800]'), ('AA', '<<>>'), ('VP', '[]'), ('Trans', '<<>>'),
], ids=['user-unit', 'trim-box', 'additional-actions', 'viewports', 'transition'])
def test_a_page_key_the_real_pdf_does_not_write_stops_the_extraction(tmp_path, key, value):
    def add(page):
        page.parent.xref_set_key(page.xref, key, value)
    with pytest.raises(ValueError, match=re.escape(f'第 1 頁的頁面字典有 /{key}')):
        extract(_pdf(tmp_path, extras=(_first_page(add),)), 'L11')


def test_a_page_key_on_the_second_page_stops_the_extraction(tmp_path):
    add = lambda page: page.parent.xref_set_key(page.xref, 'UserUnit', '2')
    with pytest.raises(ValueError, match=re.escape('第 2 頁的頁面字典有 /UserUnit')):
        extract(_pdf(tmp_path, extras=(_on_page(2, add),)), 'L12')


def _official(tmp_path, change):
    doc = pymupdf.open(X._two_page_exam(tmp_path))
    change(doc)
    path = tmp_path / 'official.pdf'
    doc.save(path)
    return path


@pytest.mark.parametrize(('change', 'message'), [
    (lambda doc: doc.xref_set_key(doc.pdf_catalog(), 'AcroForm', '<</Fields[]/XFA 1 0 R>>'), '目錄字典有 /AcroForm'),
    (lambda doc: X._add_resource(doc[0], 'ColorSpace', 'DefaultRGB', '/DeviceGray'), '第 1 頁的頁面資源有 /ColorSpace'),
    (lambda doc: doc[0].set_cropbox(pymupdf.Rect(0, 0, 595, 840)), 'CropBox 與 MediaBox 不同'),
    (lambda doc: doc.xref_set_key(doc[0].xref, 'UserUnit', '2'), '第 1 頁的頁面字典有 /UserUnit'),
], ids=['xfa', 'default-rgb', 'crop-box', 'user-unit'])
def test_the_official_extractor_has_the_same_allow_lists(tmp_path, change, message, any_stream_key):
    with pytest.raises(ValueError, match=re.escape(message)):
        ipas_exam_pdf.extract(_official(tmp_path, change))


def test_the_official_allow_lists_are_what_the_real_exams_write():
    # 6 份真實的試題 PDF 實測；樣題的是真的樣題 PDF 實測。多收一個鍵，先在這裡寫清楚
    assert ipas_exam_pdf.CATALOG_KEYS == {'Type', 'Pages', 'Lang', 'MarkInfo', 'Metadata', 'StructTreeRoot',
                                          'ViewerPreferences'}
    assert ipas_exam_pdf.RESOURCE_KEYS == {'Font', 'ExtGState', 'ProcSet', 'XObject'}
    assert ipas_exam_pdf.PAGE_KEYS == {'Type', 'Parent', 'Resources', 'MediaBox', 'CropBox', 'Rotate', 'Contents', 'Group',
                                       'Tabs', 'StructParents', 'Annots'}
    assert ipas_exam_pdf.STREAM_KEYS == {'Length', 'Filter', 'Type', 'Subtype', 'Length1', 'First', 'N', 'W', 'Index', 'Prev',
                                         'Size', 'Root', 'Info', 'ID', 'Width', 'Height', 'BitsPerComponent', 'ColorSpace',
                                         'Interpolate', 'SMask', 'Matte'}
    assert ipas_exam_pdf.STREAM_FILTERS == {'FlateDecode', 'DCTDecode'}
    assert ipas_sample_pdf.CATALOG_KEYS == {'Type', 'Pages', 'Lang', 'MarkInfo', 'Metadata', 'PageLayout', 'StructTreeRoot'}
    assert ipas_sample_pdf.RESOURCE_KEYS == {'Font'}
    assert ipas_sample_pdf.STREAM_KEYS == {'Length', 'Filter', 'Type', 'Subtype', 'Length1', 'First', 'N', 'Extends', 'W',
                                           'Size', 'Root', 'Info', 'ID', 'Index', 'Prev', 'DecodeParms', 'C', 'I', 'S'}


# 串流字典：/F 是外部檔案的檔名，pdfminer 與 MuPDF 卻當成 /Filter，PDFium 不看（審查實測：同一段串流兩邊解出不同的內容，
# 第 4 題的「不」在 Chrome 上是另一句）。不一招一招擋：鍵、濾鏡都只收真實 PDF 寫的
def _content_of(page):
    return page.get_contents()[0]


def _set_on_content(key, value):
    return lambda page: page.parent.xref_set_key(_content_of(page), key, value)


@pytest.mark.parametrize('key', ['F', 'FFilter', 'FDecodeParms', 'DP', 'DL', 'Foo'])
def test_a_stream_key_the_real_pdf_does_not_write_stops_the_extraction(tmp_path, key):
    message = _refusal(_pdf(tmp_path, extras=(_first_page(_set_on_content(key, '/FlateDecode')),)))
    assert f'有 /{key}' in message and 'ipas_sample_pdf.STREAM_KEYS' in message and NEXT_STEP in message


@pytest.mark.parametrize('value', ['/Fl', '/ASCIIHexDecode', '/RunLengthDecode', '[/FlateDecode]', '[/FlateDecode/FlateDecode]'],
                         ids=['abbreviated', 'hex', 'run-length', 'array', 'twice'])
def test_a_filter_the_real_pdf_does_not_write_stops_the_extraction(tmp_path, value):
    with pytest.raises(ValueError, match=re.escape('/Filter 不是 ')):
        extract(_pdf(tmp_path, extras=(_first_page(_set_on_content('Filter', value)),)), 'L11')


def test_decode_parameters_outside_an_xref_stream_stop_the_extraction(tmp_path):
    # 真的樣題的 /DecodeParms 只在兩段 xref 串流上：內容串流的預測器，pdfminer 不做的 PDFium 做
    path = _pdf(tmp_path, extras=(_first_page(_set_on_content('DecodeParms', '<</Predictor 12/Columns 5>>')),))
    with pytest.raises(ValueError, match=re.escape('/DecodeParms 只收 xref 串流')):
        extract(path, 'L11')


def _content_length(data, change):
    """第一段內容串流（「/Length N」的 N 三位數）的 /Length 改成 change(N)，長度不變"""
    match = re.search(rb'/Length (\d{3})', data)
    return data[:match.start(1)] + b'%d' % change(int(match[1])) + data[match.end(1):]


@pytest.mark.parametrize('change', [lambda n: n - 1, lambda n: n + 2], ids=['short', 'long'])
def test_a_length_that_does_not_end_at_endstream_stops_the_extraction(tmp_path, change):
    # /Length 落在 endstream 之前：Poppler 與 pdf.js 照 /Length 讀，pdfminer 與 MuPDF 找 endstream（審查實測：字串裡寫
    # endstream，讓 /Length 短的那一段在閱讀器上是另一句）
    path = _write(tmp_path, _content_length(_pdf(tmp_path).read_bytes(), change))
    with pytest.raises(ValueError, match=re.escape('/Length 的落點後面不是 endstream')):
        extract(path, 'L11')


def test_a_length_that_is_not_a_direct_integer_stops_the_extraction(tmp_path):
    # 167 個真實的串流都是直接寫的整數
    content = X.ONE_PAGE[3].replace(b'/Length %d' % len(X._CONTENT), b'/Length 7 0 R')
    path = _write(tmp_path, X._hand_pdf([*X._one_page_with(4, content), b'%d' % len(X._CONTENT)]))
    with pymupdf.open(path) as rendered:
        assert '/Length 不是直接寫的整數' in ipas_exam_pdf._syntax_problem(path, rendered)


@pytest.mark.parametrize(('old', 'new'), [
    (b'\nendstream', b'\r\nendstream'), (b'\nendstream', b'endstream'), (b'\nendstream', b'\rendstream'),
], ids=['crlf', 'no-end-of-line', 'cr'])
def test_every_end_of_line_before_endstream_is_accepted(tmp_path, old, new):
    # /Length 算的是資料，資料後面的換行不算：三種寫法都是 /Length 落在 endstream 前面
    path = tmp_path / 'eol.pdf'
    doc = pymupdf.open(_pdf(tmp_path))
    doc.save(path)
    data = path.read_bytes()
    first = data.index(old)
    fixed = data[:first] + new + data[first + len(old):]
    delta = len(new) - len(old)
    if delta:  # 後面的物件都移動了：交給 xref 串流重新登記
        fixed = _shift_xref(fixed, first, delta)
    assert extract(_write(tmp_path, fixed), 'L11')[1]['answer'] == 'C'


def _shift_xref(data, position, delta):
    """位置 position 之後的物件移了 delta 個位元組：xref 表與 startxref 跟著改"""
    start = int(data.rsplit(b'startxref', 1)[1].split()[0]) + delta
    table = data[start:]

    def move(entry):
        offset = int(entry[1])
        return b'%010d %s' % (offset + delta if offset > position else offset, entry[2])
    table = re.sub(rb'(?m)^(\d{10}) (\d{5} n)', move, table)
    table = re.sub(rb'startxref\n\d+', b'startxref\n%d' % start, table)
    return data[:start] + table


def test_a_carriage_return_alone_after_stream_stops_the_extraction(tmp_path):
    # 規範只收 CR LF 與 LF：單獨的 CR 各家從不同的位置開始讀資料（167 個真實的串流都是 CR LF）
    data = _pdf(tmp_path).read_bytes()
    at = data.index(b'stream\n') + len(b'stream')
    path = _write(tmp_path, data[:at] + b'\r' + data[at + 1:])
    with pytest.raises(ValueError, match=re.escape('stream 後面不是 CR LF 或 LF')):
        extract(path, 'L11')


def test_the_official_extractor_has_the_same_stream_rules(tmp_path):
    doc = pymupdf.open(X._two_page_exam(tmp_path))
    doc.xref_set_key(doc[0].get_contents()[0], 'F', '/FlateDecode')
    path = tmp_path / 'official.pdf'
    doc.save(path)
    with pytest.raises(ValueError, match='ipas_exam_pdf.STREAM_KEYS'):
        ipas_exam_pdf.extract(path)


def test_the_official_extractor_checks_the_length_too(tmp_path, any_stream_key):
    data = _content_length(X._two_page_exam(tmp_path).read_bytes(), lambda n: n - 1)
    with pytest.raises(ValueError, match=re.escape('/Length 的落點後面不是 endstream')):
        ipas_exam_pdf.extract(_write(tmp_path, data))


# 字要完整在頁面內：MuPDF 的 TEXT_CLIP 只要碰到頁面就算畫出來，MediaBox 切掉字的下半部，「B」與「D」閱讀器上看不出差別
# （審查實測：解答行的基線移到頁面外 6pt，答案換成 D 照收）。8 個檔案每一個有墨跡的字形都在頁面內，最小邊距 14.9pt
def _glyph_at(at):
    return lambda page: X._embedded_cjk(page, 'Q', at)


@pytest.mark.parametrize('at', [(100, 845), (100, 842 - 842 + 3), (-3, 100), (838, 100)], ids=['bottom', 'top', 'left', 'right'])
def test_a_glyph_cut_by_the_page_edge_stops_the_extraction(tmp_path, at):
    with pytest.raises(ValueError, match=re.escape('在 PyMuPDF 畫出的頁面上找不到')):
        extract(_pdf(tmp_path, extras=(_first_page(_glyph_at(at)),)), 'L11')


@pytest.mark.parametrize(('at', 'counted'), [
    ((100, 100), True), ((100, 2), False), ((100, 199), False), ((-1, 100), False), ((195, 100), False),
    ((100, 10), True), ((100, 195), True), ((1, 100), True), ((185, 100), True),
], ids=['middle', 'top', 'bottom', 'left', 'right', 'near-the-top', 'near-the-bottom', 'near-the-left', 'near-the-right'])
def test_only_a_glyph_completely_inside_the_page_counts_as_drawn(at, counted):
    # 比的是墨跡：離邊緣再近，整個字都在裡面就算
    doc = X._blank_pdf()
    page = doc.new_page(width=200, height=200)
    X._embedded_cjk(page, 'Q', at)
    assert ('Q' in ipas_exam_pdf._visible_glyphs(page)) is counted


def test_a_glyph_cut_by_the_page_edge_stops_the_official_extractor(tmp_path, any_stream_key):
    # MediaBox 的上緣從頁首第一行的中間切過去：字碰到頁面，頁首照樣抽得到
    import pdfplumber

    path = X._two_page_exam(tmp_path)
    with pdfplumber.open(path) as pdf:
        first = min((c for c in pdf.pages[0].chars if c['text'].strip()), key=lambda c: c['top'])
    doc = pymupdf.open(path)
    doc.xref_set_key(doc[0].xref, 'MediaBox', f'[0 0 595 {842 - (first["top"] + first["bottom"]) / 2:.2f}]')
    cut = tmp_path / 'cut.pdf'
    doc.save(cut)
    with pytest.raises(ValueError, match=re.escape('在 PyMuPDF 畫出的頁面上找不到')):
        ipas_exam_pdf.extract(cut)


# Link：8 個檔案都沒有註解。get_links 不列 /A /S /Named，/Annots 要直接讀：白色細框排成格子把「不」蓋掉（審查實測）
@pytest.mark.parametrize('spec', [
    '/Border[0 0 2.9]/C[1 1 1]/A<</S/Named/N/Foo>>', '/Border[0 0 2]/C[1 0 0]/A<</S/URI/URI(http://example.com/)>>',
    '/BS<</W 3>>/C[1 1 1]', '/Border[0 0 0]',
], ids=['named-action', 'red-frame', 'border-style', 'no-frame'])
def test_a_link_stops_the_extraction(tmp_path, spec):
    def draw(page):
        doc = page.parent
        link = doc.get_new_xref()
        doc.update_object(link, f'<</Type/Annot/Subtype/Link/Rect[60 700 90 720]{spec}>>')
        doc.xref_set_key(page.xref, 'Annots', f'[{link} 0 R]')
    with pytest.raises(ValueError, match=re.escape('註解 1 個（Link）')):
        extract(_pdf(tmp_path, extras=(_first_page(draw),)), 'L11')


# 擷取之前的文字規則：只差一點點的寫法也不算（fullmatch，不是 match），與段落結尾的行尾空白要留著
@pytest.mark.parametrize(('title', 'heading', 'message'), [
    ('淨零碳規劃管理師能力鑑定 參考樣題(114 年版)附錄', 'L11 淨零碳規劃管理基礎概論', '不是參考樣題的標題'),
    ('淨零碳規劃管理師能力鑑定 參考樣題(114 年版)', 'L11 淨零碳規劃管理基礎概論 補充', '不是認得的科目'),
], ids=['title-with-a-suffix', 'subject-with-a-suffix'])
def test_the_header_lines_must_match_whole(title, heading, message):
    with pytest.raises(ValueError, match=message):
        _header(title, heading)


def test_a_first_stem_line_that_ends_a_paragraph_keeps_its_trailing_space(tmp_path):
    # 第一行就是段落結尾（行尾有空白）：中文接中文要補一個空格；NUMBER 比對時把行尾的空白吃掉，兩段就黏在一起
    pages = [[TITLE, L11, '1.第一段的文字 ', '第二段的文字 ', '(A)甲；(B)乙；(C)丙；(D)丁 ', '解答：(A) '], _subject(L12)]
    assert extract(_pdf(tmp_path, pages), 'L11')[0]['stem'] == '第一段的文字 第二段的文字'


# 檔尾：最後一個 startxref 之後，用註解藏起另一份物件、一段 xref 串流與「%% startxref」。pdfminer、MuPDF、Poppler、Firefox 照
# 原本的 startxref 讀，PDFium（Chrome）掃到後面那一個，畫出另一個答案（第三輪審查實測）。照原始位元組數：檔案裡每一個
# startxref 都要指到擷取程式讀到的一段 xref，最後一個 %%EOF 之後只有空白
def _hidden_tail(data, *, comment=b'%% ', value=None, after=b''):
    """data 的檔尾接上註解藏起來的 startxref（value 預設指到原本那一段）與 after"""
    last = int(data.rsplit(b'startxref', 1)[1].split()[0])
    return data + comment + b'startxref\n%d\n%%%%EOF\n' % (last if value is None else value) + after


@pytest.mark.parametrize(('change', 'message'), [
    (lambda data: _hidden_tail(data), 'startxref 出現 2 次'),                        # 數得到、擷取程式沒有讀的
    (lambda data: _hidden_tail(data, comment=b'%x'), 'startxref 出現 2 次'),          # 「xstartxref」也算
    (lambda data: data + b'%junk\n', '%%EOF 之後'),
    (lambda data: data + b'x', '%%EOF 之後'),
], ids=['comment-startxref', 'prefixed-startxref', 'comment-after-eof', 'byte-after-eof'])
def test_a_hidden_tail_stops_the_extraction(tmp_path, change, message):
    path = _write(tmp_path, change(_pdf(tmp_path).read_bytes()))
    for read in (extract, header):
        with pytest.raises(ValueError, match=re.escape(message)):
            read(path, 'L11')


def test_the_official_extractor_stops_at_a_hidden_tail(tmp_path, any_stream_key):
    path = _write(tmp_path, _hidden_tail(X._two_page_exam(tmp_path).read_bytes()))
    with pytest.raises(ValueError, match=re.escape('startxref 出現 2 次')):
        ipas_exam_pdf.extract(path)


@pytest.mark.parametrize('tail', [b'', b'\n', b'\r\n', b' \r\n\r\n'], ids=['nothing', 'lf', 'crlf', 'blank-lines'])
def test_only_white_space_after_the_last_eof_is_accepted(tmp_path, tail):
    data = _pdf(tmp_path).read_bytes()
    assert data.endswith(b'%%EOF\n')
    assert extract(_write(tmp_path, data[:-1] + tail), 'L11')[1]['answer'] == 'C'


def test_a_linearized_file_whose_first_section_has_no_startxref_is_accepted(tmp_path):
    # qpdf 線性化時第一段後面不寫「startxref 0」：startxref 比讀到的段數少，每一個仍指到讀過的那一段
    linear = _linearized(tmp_path)
    data = linear.data.replace(b'startxref\n0\n%%EOF\n', b'                  ', 1)
    assert data.count(b'startxref') == 1
    assert extract(_write(tmp_path, data), 'L11')[1]['answer'] == 'C'


def _tail(starts, side=(), linearized=False, values=None, end=b'%%EOF\n', rules=None):
    """_tail_problem 對一份假文件的判斷：starts 是讀到的每一段 xref 的位置，side 是 /XRefStm 指到的那幾段，values 是檔案裡
    每一個 startxref 的數字（預設照 starts 減去 side），檔頭有沒有線性化字典由 linearized 決定，rules 是規則收不收線性化
    （預設同 linearized；樣題的規則一律收）"""
    from types import SimpleNamespace

    chained = [start for start in starts if start not in side]
    head = b'1 0 obj<</Linearized 1>>endobj\n' if linearized else b''
    data = head + b''.join(b'startxref\n%d\n%%%%EOF\n' % value for value in (chained if values is None else values))
    xrefs = [SimpleNamespace(get_trailer=lambda: {'XRefStm': s} if s else {}) for s in [*side] or [None]]
    doc = SimpleNamespace(starts=list(starts), xrefs=xrefs)
    return ipas_exam_pdf._tail_problem(data[:-len(b'%%EOF\n')] + end, doc,
                                       linearized=linearized if rules is None else rules)


@pytest.mark.parametrize(('case', 'message'), [
    ({'starts': [100]}, None),
    ({'starts': [300, 200, 100], 'side': [200]}, None),                        # Word 的混合 xref
    ({'starts': [300, 100], 'values': [100, 300]}, None),                       # 增量更新
    ({'starts': [300, 100], 'values': [300]}, None),                            # 前一段沒有寫 startxref
    ({'starts': [300, 100], 'linearized': True, 'values': [0, 300]}, None),     # 真的樣題
    ({'starts': [300, 100], 'values': [0, 300]}, '指到的位置'),                  # 不是線性化的 startxref 0
    ({'starts': [300, 100], 'values': [0, 300], 'rules': True}, '指到的位置'),   # 規則收線性化，檔案卻不是
    ({'starts': [300, 100], 'values': [0, 300], 'linearized': True, 'rules': False}, '指到的位置'),  # 公告試題的規則
    ({'starts': [300, 100], 'values': [300, 300]}, 'startxref 出現 2 次'),       # 同一段指兩次
    ({'starts': [100], 'values': [100, 500]}, 'startxref 出現 2 次'),
    ({'starts': [300, 100], 'values': [300, 500]}, '指到的位置'),                # 指到沒有讀的地方
    ({'starts': [300, 200, 100], 'side': [200], 'values': [300, 200]}, '指到的位置'),  # 指到 /XRefStm 那一段
    ({'starts': [100], 'end': b'%%EOF\r\n \t'}, None),
    ({'starts': [100], 'end': b'%%EOF\n\0'}, '%%EOF 之後'),
    ({'starts': [100], 'end': b'%%EO'}, '%%EOF 之後'),
], ids=['one', 'hybrid', 'update', 'update-without-the-older-startxref', 'linearized', 'zero-not-linearized',
        'zero-allowed-but-not-linearized', 'zero-linearized-but-not-allowed', 'twice',
        'extra', 'elsewhere', 'side-section', 'white-space-after-eof', 'nul-after-eof', 'no-eof'])
def test_every_startxref_points_to_a_section_that_was_read(case, message):
    problem = _tail(**case)
    assert problem is None if message is None else message in (problem or '')


def test_a_hybrid_xref_counts_each_startxref_once(tmp_path, any_stream_key):
    # Word 的混合 xref：三段（表、/XRefStm 指到的串流、表），只有兩個 startxref，6 份真實試題都是
    data = X._as_xref_stream(X._hand_pdf(X.ONE_PAGE), [(0, 8)], hybrid=True)
    assert data.count(b'startxref') == 2
    with pymupdf.open(stream=data, filetype='pdf') as rendered:
        path = _write(tmp_path, data)
        assert ipas_exam_pdf._syntax_problem(path, rendered) is None
