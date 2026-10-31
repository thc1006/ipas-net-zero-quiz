# iPAS 參考樣題 PDF 擷取器的測試。官方 PDF 不進 CI：這裡用 PyMuPDF 畫與參考樣題同結構的小 PDF（第一頁是標題加第一科，
# 第二頁是第二科；每題是題號開頭的題幹、從 (A) 開始的選項、一行解答），跑整條管線，連同模組說明列出的每一種
# 「一律報錯」的版面。每一行照 PDF 的寫法：段落結尾的行尾留一個空白字元，折行的行尾沒有。
import dataclasses
import re

import pymupdf
import pytest

import ipas_exam_pdf
import ipas_sample_pdf
import test_ipas_exam_pdf as X  # 公告試題那邊合成攻擊樣本的工具
from ipas_sample_pdf import Header, _header, _options, extract, header

TITLE = '淨零碳規劃管理師能力鑑定 參考樣題(114 年版) '
L11 = 'L11 淨零碳規劃管理基礎概論 '
L12 = 'L12 淨零碳盤查規範與程序概要 '


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
    doc = pymupdf.open()
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
def test_an_unexpected_layout_stops_the_extraction(tmp_path, pages, extras, message):
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
    (X._shading((70, 86, 92, 104)), '畫了填色文字以外的東西（PyMuPDF 的 fill-shade）'),  # 白色漸層蓋住題幹的「第1」
    (lambda page: X._append_content(page, b'BX q Q EX'), '第 1 頁：內容串流有 Word 不會寫的運算子「BX」'),
    (_with_state('/BM/Lighten'), '第 1 頁有圖形狀態 GS9 的 /BM'),              # 疊在不透明的底色上就看不見
    (_with_state(f'/TR {X.WHITE_TRANSFER}'), '第 1 頁有圖形狀態 GS9 的 /TR'),  # 轉換函數把黑字變白字
    (_with_state(f'/TR2 {X.WHITE_TRANSFER}'), '第 1 頁有圖形狀態 GS9 的 /TR2'),
    (_with_state('/ca/Half'), '第 1 頁有圖形狀態 GS9 的 /ca'),                 # 不是數字的不透明度，各家讀法不同
    (_soft_mask, '第 1 頁有圖形狀態 GS9 的 /SMask'),
    (_triangle_clip, '第 1 頁有不是矩形的剪裁路徑'),
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
def test_what_the_reader_shows_must_be_what_is_extracted(tmp_path, draw, message):
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
        with pytest.raises(ValueError, match='^頁面樹不是 Word 的寫法'):
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
def test_an_image_either_program_sees_counts(tmp_path, draw, pdfminer, mupdf):
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
        descriptor['FontFile2'] = PDFStream({}, b'')
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


@pytest.mark.parametrize('obj', [
    {'A\0B': 1},
    {'A': __import__('pdfminer.psparser').psparser.LIT('A\0B')},
    [[{'A': [__import__('pdfminer.psparser').psparser.LIT('A\0B')]}]],
    __import__('pdfminer.pdftypes').pdftypes.PDFStream({'A\0B': 1}, b''),
    {b'A\0B': 1},
], ids=['key', 'value', 'nested', 'stream-attrs', 'bytes'])
def test_a_nul_is_found_anywhere_in_an_object(obj):
    from types import SimpleNamespace

    from pdfminer.pdftypes import PDFObjectNotFound

    def getobj(objid):
        if objid == 1:
            raise PDFObjectNotFound(objid)  # 空號：xref 列著，物件不存在
        return {'Type': 'x'} if objid == 2 else obj

    doc = SimpleNamespace(xrefs=[SimpleNamespace(get_objids=lambda: [1, 2, 3])], getobj=getobj)
    assert ipas_sample_pdf._name_with_nul(SimpleNamespace(doc=doc)) is not None
    doc.getobj = lambda objid: {'Type': 'x'}
    assert ipas_sample_pdf._name_with_nul(SimpleNamespace(doc=doc)) is None


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
