# iPAS 參考樣題的匯入：import_official_sample.py 把擷取結果寫成題庫的題目，restore_from_source_pdf.py 把它們記進
# 憑證（status: imported，不算還原題）。這裡用合成的參考樣題來源測兩邊的行為；真正的 114 年版在題庫裡的樣子由
# test_the_bank_holds_what_the_importer_builds 把關。讀頁首的路比照公告試題（test_official_exam_import 裡「兩個工具讀
# 頁首用的就是 ipas_exam_pdf.header」那一節）釘住：原始碼、身分、寫法、真的 PDF 與照 CLI 執行的子行程。
import builtins
import copy
import dataclasses
import hashlib
import importlib.machinery
import inspect
import json
import sys
import types
from pathlib import Path

import pytest

import import_official_exam as I
import import_official_sample as S
import ipas_sample_pdf
import restore_from_source_pdf as R
import test_ipas_sample_pdf as pdfs  # 合成的參考樣題 PDF
import test_official_exam_import as E  # 讀頁首那一節的工具（AST、子行程）

SRC = 'S_IPAS_SAMPLE_999_L11'
TITLE = '淨零碳規劃管理師能力鑑定 參考樣題(999 年版)'
META = {
    'url': 'https://www.ipas.org.tw/api/proxy/uploads/example/sample-999.pdf',
    'sha256': '0' * 64,
    'title': f'{TITLE} L11 淨零碳規劃管理基礎概論',
    'exam_subject': '考科1',
    'layout': 'ipas_sample',
    'kind': 'official_sample',
    'edition': '999',
    'published_on': '2110-01-01',
    'subject': 'L11',
}
SRC12 = 'S_IPAS_SAMPLE_999_L12'
META12 = {**META, 'title': f'{TITLE} L12 淨零碳盤查規範與程序概要', 'exam_subject': '考科2', 'subject': 'L12'}
REVIEW = {'status': 'OFFICIAL', 'note': '測試用的參考樣題。'}
TWIN = {'dataset_item': 'gist_items[7]', 'dataset_answer': 'A', 'dataset_answer_text': '選項A2',
        'source_answer_key': 'A', 'source_text_sha256': '0' * 64, 'decided_on': '2110-01-01', 'why': '測試用的配對。'}


def _question(number, answer='C', stem=None):
    return {'number': number, 'page': 1, 'column': None, 'answer': answer,
            'stem': stem or f'第 {number} 題的題幹？',
            'options': [{'key': k, 'text': f'選項{k}{number}'} for k in 'ABCD']}


def _header(**change):
    """與 META 相符的頁首；change 改掉其中幾欄。"""
    base = {'title': TITLE, 'subject': 'L11 淨零碳規劃管理基礎概論', 'subject_code': 'L11', 'edition': '999'}
    return ipas_sample_pdf.Header(**{**base, **change})


@pytest.fixture(autouse=True)
def never_touch_the_real_bank(monkeypatch, tmp_path):
    # 匯入工具會改寫題庫：每一條測試都先把它導到暫存檔，即使程式被改壞也寫不到真正的題庫
    monkeypatch.setattr(S, 'DATASET', tmp_path / 'never-written.json')


@pytest.fixture
def sample_source(monkeypatch):
    monkeypatch.setitem(R.SOURCES, SRC, META)
    monkeypatch.setitem(R.EXPECTED_QUESTION_COUNT, SRC, 2)
    monkeypatch.setitem(R.SOURCE_REVIEWS, SRC, REVIEW)
    monkeypatch.setattr(S.ipas_sample_pdf, 'header', lambda path, code: _header())
    return [_question(1, 'C'), _question(2, 'A')]


def _dataset(*items, gist=()):
    return {'meta': {}, 'gist_items': [copy.deepcopy(g) for g in gist],
            'our_unique_items': [{'item_id': 'OTHER-q001'}, *items]}


def _bank(tmp_path, monkeypatch, *items, gist=()):
    dataset = tmp_path / 'integrated_dataset.json'
    dataset.write_text(json.dumps(_dataset(*items, gist=gist), ensure_ascii=False, indent=2), encoding='utf-8')
    monkeypatch.setattr(S, 'DATASET', dataset)
    return dataset


# build_item：擷取結果 → 題庫的一題

def test_an_item_carries_the_pdf_text_and_the_sample_marker():
    q = _question(2, 'A')
    item = S.build_item(SRC, META, q)
    assert item['item_id'] == f'{SRC}-q002'
    assert (item['stem'], item['options'], item['answer']) == (q['stem'], q['options'], 'A')
    assert item['options'] is not q['options'] and item['options'][0] is not q['options'][0]  # 不與擷取結果共用
    assert item['official_sample'] == {'edition': '999', 'subject': 'L11', 'question_number': 2}
    assert 'official_exam' not in item
    assert (item['exam_subject'], item['year'], item['level']) == ('考科1', 2910, None)  # 版次是民國年
    assert item['source'] == {'source_id': SRC, 'url': META['url'], 'publisher': 'iPAS', 'authority': 'official',
                              'evidence': {'page': 1, 'quote': q['stem']}}
    assert item['metadata']['sources'] == [META['url']]


def test_the_answer_evidence_is_the_printed_question_with_its_answer_line():
    [evidence] = S.build_item(SRC, META, _question(1, 'C'))['metadata']['evidence']
    assert evidence == {
        'url': META['url'],
        'quote': '第 1 題的題幹？\n(A)選項A1；(B)選項B1；(C)選項C1；(D)選項D1\n解答：(C)',
        'supports_option': 'C',
        'note': '參考樣題（999 年版）第一科第 1 題：PDF 印「解答：(C)」。',
        'generated_by': 'tools/import_official_sample.py',
    }
    assert S.build_item(SRC12, META12, _question(3, 'B'))['metadata']['evidence'][0]['note'] == (
        '參考樣題（999 年版）第二科第 3 題：PDF 印「解答：(B)」。')


# 已經在題庫裡的題目：規則與公告試題相同（import_official_exam.merge），負責的欄位換成這支工具的

def _merge(dataset, items):
    return I.merge(dataset, items, owned=S.OWNED, generated_by=S.GENERATED_BY)


def test_importing_again_changes_nothing():
    items = [S.build_item(SRC, META, q) for q in (_question(1), _question(2))]
    merged = _dataset()
    assert _merge(merged, copy.deepcopy(items)) == 0
    again = copy.deepcopy(merged)
    assert _merge(again, copy.deepcopy(items)) == 0
    assert again == merged


def test_reimporting_restores_the_tool_evidence_that_was_edited_by_hand():
    item = S.build_item(SRC, META, _question(1))
    edited = copy.deepcopy(item)
    edited['metadata']['evidence'][0]['quote'] = '改過的引文'
    edited['metadata']['evidence'].append({'url': 'https://example.org/', 'quote': '人加的引文', 'supports_option': 'C'})
    merged = _dataset(edited)
    assert _merge(merged, [item]) == 1
    assert merged['our_unique_items'][1]['metadata']['evidence'] == [
        item['metadata']['evidence'][0], {'url': 'https://example.org/', 'quote': '人加的引文', 'supports_option': 'C'}]


def test_reimporting_drops_the_url_only_this_tools_old_evidence_needed():
    # 舊的工具引文帶進來的網址，這次不再需要就從 sources 拿掉。「工具的引文」認的是呼叫者給的標記，不是公告試題工具的預設值
    item = S.build_item(SRC, META, _question(1))
    edited = copy.deepcopy(item)
    edited['metadata']['evidence'][0]['url'] = 'https://example.org/old.pdf'
    edited['metadata']['sources'].append('https://example.org/old.pdf')
    merged = _dataset(edited)
    assert _merge(merged, [item]) == 1
    assert merged['our_unique_items'][1]['metadata']['sources'] == item['metadata']['sources']


@pytest.mark.parametrize(('field', 'change'), [
    ('stem', '改過的題幹'), ('options', []), ('answer', 'D'), ('exam_subject', '考科2'),
    ('official_sample', {'edition': '999', 'subject': 'L11', 'question_number': 3}),
], ids=['stem', 'options', 'answer', 'exam-subject', 'marker'])
def test_a_changed_question_is_not_silently_overwritten(field, change):
    item = S.build_item(SRC, META, _question(1))
    with pytest.raises(SystemExit, match=f"已經在題庫裡，而且 \\['{field}'\\]"):
        _merge(_dataset({**copy.deepcopy(item), field: change}), [item])


# mark_twins：主庫已經有同一題的參考樣題，在主庫那一題標上 official_sample、附上同樣的答案依據

HUMAN = {'url': 'https://example.org/bank.pdf', 'quote': '人加的引文（主庫原本的依據）', 'supports_option': 'A'}


@pytest.fixture
def twin(sample_source, monkeypatch):
    monkeypatch.setitem(R.DATASET_DUPLICATES, (SRC, 2), TWIN)
    return {'index': 7, 'stem': '第 2 題的題幹？', 'answer': 'A',
            'metadata': {'sources': [HUMAN['url']], 'evidence': [dict(HUMAN)]}}


def test_the_registered_twin_gets_the_sample_marker_and_the_evidence(twin, sample_source):
    dataset = _dataset(gist=[twin])
    assert S.mark_twins(dataset, [(SRC, sample_source[1])]) == 1
    built = S.build_item(SRC, META, sample_source[1])
    assert dataset['gist_items'][0] == {
        **twin, 'official_sample': {'edition': '999', 'subject': 'L11', 'question_number': 2},
        'metadata': {'sources': [META['url'], HUMAN['url']], 'evidence': [*built['metadata']['evidence'], HUMAN]}}
    again = copy.deepcopy(dataset)
    assert S.mark_twins(again, [(SRC, sample_source[1])]) == 0  # 已經標好、引文也一樣：不動
    assert again == dataset


def test_the_twin_evidence_edited_by_hand_is_restored(twin, sample_source):
    dataset = _dataset(gist=[twin])
    S.mark_twins(dataset, [(SRC, sample_source[1])])
    expected = copy.deepcopy(dataset)
    dataset['gist_items'][0]['metadata']['evidence'][0]['quote'] = '改過的引文'
    assert S.mark_twins(dataset, [(SRC, sample_source[1])]) == 1
    assert dataset == expected


def test_a_twin_that_only_needs_the_marker_still_counts(twin, sample_source):
    # 引文已經是工具建的那一則、只差標記：照樣算一題有變動（只算引文的寫法會漏掉）
    built = S.build_item(SRC, META, sample_source[1])
    ready = {**twin, 'metadata': {'sources': [META['url'], HUMAN['url']], 'evidence': [*built['metadata']['evidence'], HUMAN]}}
    dataset = _dataset(gist=[ready])
    assert S.mark_twins(dataset, [(SRC, sample_source[1])]) == 1
    assert dataset['gist_items'][0]['official_sample'] == S.marker(META, 2)


def test_a_twin_with_another_marker_is_not_overwritten(twin, sample_source):
    other = {'edition': '998', 'subject': 'L11', 'question_number': 2}
    dataset = _dataset(gist=[{**twin, 'official_sample': other}])
    before = copy.deepcopy(dataset)
    with pytest.raises(SystemExit, match="gist_items\\[7\\] 已經標了 official_sample"):
        S.mark_twins(dataset, [(SRC, sample_source[1])])
    assert dataset == before


def test_a_twin_whose_answer_differs_from_the_pdf_stops(twin, sample_source):
    # 引文支持的選項必須是那一題的答案（不然 UI 不顯示），答案不同就是配對錯了
    dataset = _dataset(gist=[{**twin, 'answer': 'B'}])
    before = copy.deepcopy(dataset)
    with pytest.raises(SystemExit, match='gist_items\\[7\\] 的答案是 B，.*印「解答：\\(A\\)」'):
        S.mark_twins(dataset, [(SRC, sample_source[1])])
    assert dataset == before


@pytest.mark.parametrize('gist', [[], [{'index': 7, 'answer': 'A'}, {'index': 7, 'answer': 'A'}]],
                         ids=['missing', 'twice'])
def test_a_twin_that_is_not_exactly_one_item_stops(twin, sample_source, gist):
    with pytest.raises(SystemExit, match=f'gist_items\\[7\\] 在主庫找到 {len(gist)} 題'):
        S.mark_twins(_dataset(gist=gist), [(SRC, sample_source[1])])


# main：從 PDF 擷取到寫檔

def test_main_imports_the_named_sample_sources(sample_source, monkeypatch, tmp_path, capsys):
    dataset = _bank(tmp_path, monkeypatch)
    monkeypatch.setattr(S, 'load_pdf', lambda src_id, cache: b'')
    calls = []
    monkeypatch.setattr(S.ipas_sample_pdf, 'extract',
                        lambda path, code: calls.append((path, code)) or copy.deepcopy(sample_source))
    assert S.main([SRC, SRC, '--cache', str(tmp_path)]) == 0  # 同一個來源寫兩次只匯入一次
    assert calls == [(tmp_path / f'{SRC}.pdf', 'L11')]  # 擷取 SOURCES 說的那一科
    assert '新增 2 題；已在題庫裡 0 題' in capsys.readouterr().out
    written = json.loads(dataset.read_text(encoding='utf-8'))
    assert written['our_unique_items'] == [{'item_id': 'OTHER-q001'},
                                           *(S.build_item(SRC, META, q) for q in sample_source)]
    # 與 tools/sync_derived_counts.py 寫出來的一樣：縮排 2、中文不跳脫、檔尾不換行（逐位元組比對）
    assert dataset.read_bytes() == json.dumps(written, ensure_ascii=False, indent=2).encode('utf-8')
    before = dataset.read_bytes()
    assert S.main([SRC, '--cache', str(tmp_path)]) == 0
    assert dataset.read_bytes() == before  # 再匯入一次什麼都不變
    assert '新增 0 題；已在題庫裡 2 題，其中 0 題' in capsys.readouterr().out


def test_main_marks_the_twin_instead_of_importing_it(twin, sample_source, monkeypatch, tmp_path, capsys):
    dataset = _bank(tmp_path, monkeypatch, gist=[twin])
    monkeypatch.setattr(S, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setattr(S.ipas_sample_pdf, 'extract', lambda path, code: copy.deepcopy(sample_source))
    assert S.main([SRC, '--cache', str(tmp_path)]) == 0
    assert '新增 1 題' in capsys.readouterr().out
    written = json.loads(dataset.read_text(encoding='utf-8'))
    assert [i['item_id'] for i in written['our_unique_items']] == ['OTHER-q001', f'{SRC}-q001']
    [gist] = written['gist_items']
    assert gist['official_sample'] == S.marker(META, 2)
    assert gist['metadata']['evidence'] == [*S.build_item(SRC, META, sample_source[1])['metadata']['evidence'], HUMAN]


@pytest.mark.parametrize('source', ['S_IPAS_115_02_L12', 'S_CHU_06', 'S_NO_SUCH_SOURCE'],
                         ids=['official-exam', 'not-official', 'unknown'])
def test_main_refuses_sources_that_are_not_samples(source, monkeypatch, tmp_path):
    downloads = []
    monkeypatch.setattr(S, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    with pytest.raises(SystemExit, match=f'{source} 不是參考樣題的來源'):
        S.main([source, '--cache', str(tmp_path)])
    assert downloads == []


def test_main_refuses_a_sample_source_with_another_layout_before_downloading(sample_source, monkeypatch, tmp_path):
    # restore 的 extract_sources 也擋：版面寫錯（例如從公告試題複製），匯入工具以前照樣寫進題庫
    monkeypatch.setitem(R.SOURCES, SRC, {**META, 'layout': 'ipas_exam_table'})
    downloads = []
    monkeypatch.setattr(S, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    with pytest.raises(SystemExit, match="參考樣題（kind official_sample）與它的版面（'ipas_exam_table'）要一起用"):
        S.main([SRC, '--cache', str(tmp_path)])
    assert downloads == []


def test_main_refuses_a_source_without_an_expected_question_count_before_downloading(sample_source, monkeypatch,
                                                                                     tmp_path):
    monkeypatch.delitem(R.EXPECTED_QUESTION_COUNT, SRC)
    downloads = []
    monkeypatch.setattr(S, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    with pytest.raises(SystemExit, match='沒有登記總題數'):
        S.main([SRC, '--cache', str(tmp_path)])
    assert downloads == []


def test_main_refuses_an_extraction_with_the_wrong_number_of_questions(sample_source, monkeypatch, tmp_path):
    monkeypatch.setattr(S, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setattr(S.ipas_sample_pdf, 'extract', lambda path, code: sample_source[:1])
    with pytest.raises(SystemExit, match='擷取到 1 題，應為 2 題'):
        S.main([SRC, '--cache', str(tmp_path)])


def test_main_stops_on_a_header_that_disagrees_before_extracting_or_writing(sample_source, monkeypatch, tmp_path):
    dataset = _bank(tmp_path, monkeypatch)
    original = dataset.read_bytes()
    monkeypatch.setattr(S, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setattr(S.ipas_sample_pdf, 'header', lambda path, code: _header(edition='998'))
    extracted = []
    monkeypatch.setattr(S.ipas_sample_pdf, 'extract', lambda path, code: extracted.append(path) or sample_source)
    with pytest.raises(SystemExit, match=f'{SRC} 的 PDF 與 SOURCES 不符：版次：SOURCES 寫「999」，PDF 是「998」'):
        S.main([SRC, '--cache', str(tmp_path)])
    assert extracted == []
    assert dataset.read_bytes() == original


def test_main_names_the_source_when_the_extractor_refuses(sample_source, monkeypatch, tmp_path):
    def refuse(path, code):
        raise ValueError('第 1 頁有圖片 1 個：參考樣題的版面只有文字')
    monkeypatch.setattr(S, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setattr(S.ipas_sample_pdf, 'extract', refuse)
    with pytest.raises(SystemExit, match=f'✗ {SRC}: 第 1 頁有圖片 1 個'):
        S.main([SRC, '--cache', str(tmp_path)])


# 還原工具：參考樣題記為 imported，頁首與 SOURCES 對帳

def _sample_snapshot(questions, meta=META, **header_change):
    """合成參考樣題的擷取快照：--emit 把 PDF 的頁首與題目一起記下（CI 拿頁首核對 SOURCES）。"""
    header = _header(**header_change) if meta is META else _header(subject=meta['title'][len(TITLE) + 1:],
                                                                  subject_code=meta['subject'], **header_change)
    return {'pdf_sha256': meta['sha256'], 'header': dataclasses.asdict(header), 'questions': questions}


def _with_items(questions, src=SRC, meta=META):
    dataset = R.load_dataset()
    dataset['our_unique_items'] += [S.build_item(src, meta, q) for q in questions]
    return dataset


def test_sample_questions_are_recorded_as_imported(sample_source):
    snapshot = copy.deepcopy(R.load_snapshot())
    snapshot[SRC] = _sample_snapshot(sample_source)
    before = json.loads(R.MANIFEST.read_text(encoding='utf-8'))['_meta']
    man = R.assemble(snapshot, _with_items(sample_source))
    mine = [d for d in man['dispositions'] if d['source_id'] == SRC]
    assert [(d['status'], d['item_id'], d['column']) for d in mine] == [
        ('imported', f'{SRC}-q001', None), ('imported', f'{SRC}-q002', None)]
    assert man['_meta']['restored_count'] == before['restored_count']  # 還原題的數目不受影響
    assert man['_meta']['imported_count'] == before['imported_count'] + 2
    assert all(e['matches_source'] and not e['transformations'] for e in man['entries'] if e['source_id'] == SRC)
    assert man['_meta']['source_documents'][META['url']] == {'items': 2, 'subject': SRC, **REVIEW}


def test_two_subjects_of_one_pdf_are_one_document(sample_source, monkeypatch):
    # 同一份 PDF 依科目拆成兩個來源：manifest 以網址為鍵合成一筆，題數相加、來源代號並列
    monkeypatch.setitem(R.SOURCES, SRC12, META12)
    monkeypatch.setitem(R.EXPECTED_QUESTION_COUNT, SRC12, 2)
    monkeypatch.setitem(R.SOURCE_REVIEWS, SRC12, dict(REVIEW))
    snapshot = copy.deepcopy(R.load_snapshot())
    snapshot[SRC] = _sample_snapshot(sample_source)
    snapshot[SRC12] = _sample_snapshot(sample_source, META12)
    dataset = _with_items(sample_source)
    dataset['our_unique_items'] += [S.build_item(SRC12, META12, q) for q in sample_source]
    man = R.assemble(snapshot, dataset)
    assert man['_meta']['source_documents'][META['url']] == {'items': 4, 'subject': f'{SRC}、{SRC12}', **REVIEW}
    monkeypatch.setitem(R.SOURCE_REVIEWS, SRC12, {**REVIEW, 'note': '另一份查核紀錄。'})
    with pytest.raises(SystemExit, match=f'{SRC12} 與 {SRC} 是同一份 PDF'):
        R.assemble(snapshot, dataset)


@pytest.mark.parametrize(('change', 'what'), [
    ({'edition': '998'}, '版次：SOURCES 寫「999」，PDF 是「998」'),
    ({'title': '淨零碳規劃管理師能力鑑定 參考樣題(998 年版)'}, '標題'),
    ({'subject': 'L11 淨零碳盤查規範與程序概要'}, '標題'),
], ids=['edition', 'title', 'subject-line'])
def test_assemble_checks_sources_against_the_header_in_the_snapshot(sample_source, change, what):
    snapshot = copy.deepcopy(R.load_snapshot())
    snapshot[SRC] = _sample_snapshot(sample_source, **change)
    with pytest.raises(SystemExit, match=f'{SRC} 的 PDF 與 SOURCES 不符：{what}'):
        R.assemble(snapshot, _with_items(sample_source))


def test_assemble_needs_the_header_of_a_sample_source(sample_source):
    snapshot = copy.deepcopy(R.load_snapshot())
    snapshot[SRC] = {'pdf_sha256': META['sha256'], 'questions': sample_source}
    with pytest.raises(SystemExit, match=f'{SRC}：擷取快照沒有 PDF 的頁首'):
        R.assemble(snapshot, _with_items(sample_source))


def test_a_header_that_matches_sources_passes():
    R.check_sample_header(SRC, META, _header())
    R.check_sample_header(SRC12, META12, _header(subject='L12 淨零碳盤查規範與程序概要', subject_code='L12'))


@pytest.mark.parametrize(('meta', 'header', 'what'), [
    ({**META, 'edition': '998'}, _header(), '版次：SOURCES 寫「998」，PDF 是「999」'),
    ({**META, 'subject': 'L12'}, _header(), '科目：SOURCES 寫「L12」，PDF 是「L11」'),
    ({**META, 'exam_subject': '考科2'}, _header(), '考科：SOURCES 寫「考科2」，PDF 是「考科1」'),
    ({**META12, 'exam_subject': '考科1'}, _header(subject='L12 淨零碳盤查規範與程序概要', subject_code='L12'),
     '考科：SOURCES 寫「考科1」，PDF 是「考科2」'),  # 從第一科複製給第二科，漏改考科
    ({**META, 'title': META12['title']}, _header(), '標題'),
    (META, _header(subject='L11 淨零碳規劃管理基礎概論 '), '標題'),  # 一個空白也算
], ids=['edition', 'subject', 'exam-subject', 'exam-subject-of-the-first-subject', 'title', 'title-whitespace'])
def test_a_header_that_disagrees_with_sources_stops(meta, header, what):
    with pytest.raises(SystemExit, match=f'{SRC} 的 PDF 與 SOURCES 不符：{what}'):
        R.check_sample_header(SRC, meta, header)


def test_extract_sources_reads_the_header_and_extracts_the_registered_subject(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(R, 'SOURCES', {SRC: META})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.SAMPLE_HEADER_READERS, 'ipas_sample',
                        lambda path, code: calls.append(('header', path, code)) or _header())
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_sample', lambda path, code: calls.append((path, code)) or [_question(1)])
    source = R.extract_sources(tmp_path)[SRC]
    assert calls == [('header', tmp_path / f'{SRC}.pdf', 'L11'), (tmp_path / f'{SRC}.pdf', 'L11')]  # 先對頁首，再擷取
    assert source == {'pdf_sha256': META['sha256'], 'header': dataclasses.asdict(_header()), 'questions': [_question(1)]}


def test_extract_sources_stops_on_a_header_that_disagrees(monkeypatch, tmp_path):
    extracted = []
    monkeypatch.setattr(R, 'SOURCES', {SRC: META})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.SAMPLE_HEADER_READERS, 'ipas_sample', lambda path, code: _header(edition='998'))
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_sample', lambda path, code: extracted.append(path) or [_question(1)])
    with pytest.raises(SystemExit, match='的 PDF 與 SOURCES 不符：版次'):
        R.extract_sources(tmp_path)
    assert extracted == []


@pytest.mark.parametrize(('meta', 'message'), [
    ({**META, 'layout': 'ipas_exam_table'}, '參考樣題（kind official_sample）與它的版面'),
    ({key: value for key, value in META.items() if key != 'kind'}, '參考樣題（kind official_sample）與它的版面'),
    ({**META, 'kind': 'official_exam'}, "官方來源的版面 'ipas_sample' 讀不到頁首"),
], ids=['sample-with-the-exam-layout', 'sample-layout-without-the-kind', 'exam-with-the-sample-layout'])
def test_the_sample_kind_and_layout_go_together(monkeypatch, tmp_path, meta, message):
    # 參考樣題的頁首與擷取都要說是哪一科：kind 與版面只寫對一邊，就會用錯的方式讀頁首，或根本不讀
    downloads = []
    monkeypatch.setattr(R, 'SOURCES', {SRC: meta})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    with pytest.raises(SystemExit, match=message):
        R.extract_sources(tmp_path)
    assert downloads == []


# 題庫裡的參考樣題，必須正好是匯入工具從擷取快照建出來的樣子
#
# 題幹、選項、答案有 restoration-manifest 的指紋守著；official_sample 標記、出處欄位與工具的引文沒有。標記決定「只出
# 官方題目」抽得到哪些題：多標一題，非官方的題目就混進官方模式。

BUILT_FIELDS = ('item_id', 'year', 'year_confidence', 'credential', 'level', 'question_type', 'stem', 'options',
                'answer', 'source', 'exam_subject', 'subject_confidence', 'official_sample')


def _sample_sources():
    return {src_id: meta for src_id, meta in R.SOURCES.items() if meta.get('kind') == 'official_sample'}


def _built_sample_items():
    snapshot = R.load_snapshot()
    for src_id, meta in _sample_sources().items():
        paired = {n for s, n in R.DATASET_DUPLICATES if s == src_id}
        for q in snapshot[src_id]['questions']:
            if q['number'] not in paired:
                yield S.build_item(src_id, meta, q)


def test_the_bank_holds_what_the_importer_builds():
    bank = {i['item_id']: i for i in R.load_dataset()['our_unique_items']}
    built_items = list(_built_sample_items())
    assert built_items, '擷取快照裡沒有參考樣題：這條測試在空轉'
    bad = []
    for built in built_items:
        item = bank.get(built['item_id'])
        if item is None:
            bad.append(f'{built["item_id"]}: 不在題庫裡')
            continue
        diff = [f for f in BUILT_FIELDS if item.get(f) != built[f]]
        meta, built_meta = item.get('metadata', {}), built['metadata']
        if (meta.get('sources') or [])[:len(built_meta['sources'])] != built_meta['sources']:
            diff.append('metadata.sources（必須以工具建出的來源開頭）')
        if [e for e in meta.get('evidence') or [] if e.get('generated_by') == S.GENERATED_BY] != built_meta['evidence']:
            diff.append('metadata.evidence（帶工具標記的引文必須正是工具建出的那幾則）')
        if (meta.get('evidence') or [])[:len(built_meta['evidence'])] != built_meta['evidence']:
            diff.append('metadata.evidence（必須以工具建出的引文開頭，順序相同）')
        if diff:
            bad.append(f'{built["item_id"]}: {diff}')
    assert bad == [], ('題庫裡的參考樣題與匯入工具建出來的不同。工具負責的欄位不可手改（見 AGENTS.md）。\n'
                       + '\n'.join(bad[:20]))


def test_each_registered_twin_carries_the_evidence_the_importer_builds():
    # 主庫配對的那一題不另外匯入：標記之外，答案依據也要是匯入工具建的那一則、排在最前面
    dataset = R.load_dataset()
    snapshot = R.load_snapshot()
    twins = [(s, n) for s, n in R.DATASET_DUPLICATES if s in _sample_sources()]
    assert twins, '沒有登記主庫配對的參考樣題：這條測試在空轉'
    bad = []
    for src_id, number in twins:
        ref = R.DATASET_DUPLICATES[(src_id, number)]['dataset_item']
        [item] = [it for it in dataset['gist_items'] + dataset['our_unique_items'] if R._dataset_ref(it) == ref]
        [question] = [q for q in snapshot[src_id]['questions'] if q['number'] == number]
        built = S.build_item(src_id, R.SOURCES[src_id], question)['metadata']
        meta = item.get('metadata') or {}
        if [e for e in meta.get('evidence') or [] if e.get('generated_by') == S.GENERATED_BY] != built['evidence'] \
                or (meta.get('evidence') or [])[:len(built['evidence'])] != built['evidence'] \
                or (meta.get('sources') or [])[:len(built['sources'])] != built['sources'] \
                or item.get('answer') != question['answer']:
            bad.append(ref)
    assert bad == []


def test_only_the_importer_puts_the_sample_marker_on_an_item():
    dataset = R.load_dataset()
    marked = sorted((R._dataset_ref(item), json.dumps(item['official_sample'], sort_keys=True))
                    for item in dataset['gist_items'] + dataset['our_unique_items'] if 'official_sample' in item)
    twins = [(s, n) for s, n in R.DATASET_DUPLICATES if s in _sample_sources()]
    assert twins, '沒有登記主庫配對的參考樣題：這條測試的配對那一半在空轉'
    expected = sorted([(built['item_id'], json.dumps(built['official_sample'], sort_keys=True))
                       for built in _built_sample_items()]
                      + [(R.DATASET_DUPLICATES[twin]['dataset_item'],
                          json.dumps(S.marker(R.SOURCES[twin[0]], twin[1]), sort_keys=True)) for twin in twins])
    assert marked == expected


# 讀頁首的路：比照公告試題的三層（test_official_exam_import 那一節的說明）
#
# 匯入工具的 main 與比對用的 check_sample_header 整份釘住；restore 的 extract_sources 已由公告試題那一節釘住
# （參考樣題的分支在同一個函式裡）。

TOOL_SOURCES = {  # 審查過的原始碼的 sha256（換行統一成 LF）
    'main': '4f2cafba7eabc970ebfbba613eebf363ccdbc42c5f0672fcb92dcb14f8f7907c',
    'check_sample_header': '6c1c3850834f64891270e4def82e47bf0f8d4ca23c3214c9f4903b14ccd4e2d4',
}
DEFAULTS = {'main': ((None,), None), 'check_sample_header': (None, None)}


@pytest.mark.parametrize('function', [S.main, R.check_sample_header], ids=['import', 'compare'])
def test_the_sample_header_path_runs_the_reviewed_code(function):
    assert E._source_sha256(function) == TOOL_SOURCES[function.__name__], (
        f'{function.__module__}.{function.__name__} 改了：照 test_official_exam_import 那一節開頭的三層重新審查讀頁首的路，'
        f'再把 TOOL_SOURCES 改成 {E._source_sha256(function)}')
    lines, _ = inspect.findsource(function)
    compiled = next(const for const in compile(''.join(lines), function.__code__.co_filename, 'exec',
                                               dont_inherit=True).co_consts
                    if inspect.iscode(const) and const.co_name == function.__name__
                    and const.co_firstlineno == function.__code__.co_firstlineno)
    assert function.__code__ == compiled, f'{function.__module__}.{function.__name__} 執行的不是它的原始碼（快取的 .pyc？）'


def test_the_sample_importer_reads_the_header_with_the_parsers_own_function():
    assert S.R is R and S.import_official_exam is I and S.ipas_sample_pdf is R.ipas_sample_pdf is ipas_sample_pdf
    assert R.SAMPLE_HEADER_READERS == {'ipas_sample': ipas_sample_pdf.header}
    assert R.SAMPLE_HEADER_READERS['ipas_sample'] is ipas_sample_pdf.header
    assert type(S) is types.ModuleType and vars(S)['R'] is R
    tools = E.TOOLS_FOLDER
    for module in (S, ipas_sample_pdf):
        own = tools / f'{module.__name__}.py'
        assert Path(module.__file__).resolve() == own, module
        assert Path(importlib.machinery.PathFinder.find_spec(module.__name__, sys.path).origin).resolve() == own, module
    for function, module in ((S.main, S), (R.check_sample_header, R)):
        assert function.__module__ == module.__name__ and sys.modules[module.__name__] is module, function
        assert Path(function.__code__.co_filename).resolve() == tools / f'{module.__name__}.py', function
        assert type(function) is types.FunctionType and not hasattr(function, '__wrapped__'), function
        assert function.__code__.co_name == function.__qualname__ == function.__name__, function
        assert vars(module)[function.__name__] is function and function.__closure__ is None, function
        assert function.__globals__ is vars(module) and type(function.__globals__) is dict, function
        assert function.__builtins__ is vars(builtins), function
        assert all(type(key) is str for namespace in (function.__globals__, function.__builtins__) for key in namespace)
        assert (function.__defaults__, function.__kwdefaults__) == DEFAULTS[function.__name__], function
    reading = "R.check_sample_header(src_id, meta, ipas_sample_pdf.header(path, meta['subject']))"
    assert E._calls(S.main, 'ipas_sample_pdf.header') == ["ipas_sample_pdf.header(path, meta['subject'])"]
    assert E._calls(S.main, 'R.check_sample_header') == [reading]
    assert E._uses(S.main, 'ipas_sample_pdf') == ['ipas_sample_pdf.extract', 'ipas_sample_pdf.header']
    assert E._calls(R.extract_sources, 'SAMPLE_HEADER_READERS[layout]') == [
        "SAMPLE_HEADER_READERS[layout](path, meta['subject'])"]
    assert E._calls(R.extract_sources, 'check_sample_header') == ['check_sample_header(src_id, meta, header)']
    assert E._uses(R.extract_sources, 'check_sample_header') == ['check_sample_header(src_id, meta, header)']


def test_the_sample_header_is_read_and_compared_in_one_pinned_statement():
    E.test_the_header_is_read_and_compared_in_one_pinned_statement(
        S.main, "R.check_sample_header(src_id, meta, ipas_sample_pdf.header(path, meta['subject']))",
        {'src_id': ['for src_id in sources', 'for src_id in sources'],
         'meta': ['meta = R.SOURCES.get(src_id)', 'meta = R.SOURCES[src_id]'],
         'path': ["path = cache / f'{src_id}.pdf'"], 'cache': ['cache = Path(a.cache)']})


def test_the_sample_importer_leaves_no_other_way_to_the_header():
    E.test_the_tools_leave_no_other_way_to_the_header(S.main, set())


def test_only_the_last_statement_of_the_sample_importer_tells_how_it_runs():
    E.test_only_the_last_statement_of_each_tool_tells_how_it_runs(S)


# 真的合成 PDF 放在快取裡，SOURCES 登記它真正的 sha256：load_pdf、header()、check_sample_header 都照常跑，只有擷取器
# 換掉。restore 的 extract_sources 與匯入工具各跑一次

def _sample_pdf(folder, pages=None, **options):
    pages = pages or [[f'{TITLE} ', *pdfs._subject(pdfs.L11)], pdfs._subject(pdfs.L12)]
    return pdfs._pdf(folder, pages, **options)


def _real_meta(pdf, code='L11', **change):
    """與 PDF 真正的頁首（ipas_sample_pdf.header）相符的 SOURCES 登記；change 改掉其中幾欄。"""
    real = ipas_sample_pdf.header(pdf, code)
    return {**META, 'title': f'{real.title} {real.subject}', 'edition': real.edition, 'subject': real.subject_code,
            'exam_subject': R.EXAM_SUBJECT[real.subject_code], **change}


def _both_tools(monkeypatch, tmp_path, pdf, meta) -> list[str]:
    cache = tmp_path / 'cache'
    cache.mkdir()
    data = pdf.read_bytes()
    (cache / f'{SRC}.pdf').write_bytes(data)
    monkeypatch.setattr(R, 'SOURCES', {SRC: {**meta, 'sha256': hashlib.sha256(data).hexdigest()}})
    monkeypatch.setitem(R.EXPECTED_QUESTION_COUNT, SRC, 2)
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_sample', E._extraction_reached)
    monkeypatch.setattr(ipas_sample_pdf, 'extract', E._extraction_reached)
    ends = []
    for run in (lambda: R.extract_sources(cache), lambda: S.main([SRC, '--cache', str(cache)])):
        try:
            run()
        except SystemExit as stopped:
            ends.append(str(stopped.code))
        except E._Extracted:
            ends.append('走到擷取')
        else:
            ends.append('沒有停')
    return ends


@pytest.mark.parametrize('code', ['L11', 'L12'])
def test_both_tools_reach_the_extraction_when_the_real_header_agrees(monkeypatch, tmp_path, code):
    pdf = _sample_pdf(tmp_path)
    assert _both_tools(monkeypatch, tmp_path, pdf, _real_meta(pdf, code)) == ['走到擷取'] * 2


@pytest.mark.parametrize(('change', 'what'), [
    ({'edition': '998'}, '版次：SOURCES 寫「998」，PDF 是「999」'),
    ({'exam_subject': '考科2'}, '考科：SOURCES 寫「考科2」，PDF 是「考科1」'),
    ({'title': META12['title']}, f'標題：SOURCES 寫「{META12["title"]}」，PDF 是「{META["title"]}」'),
    ({'subject': 'L12'}, f'考科：SOURCES 寫「考科1」，PDF 是「考科2」；標題：SOURCES 寫「{META["title"]}」，'
                         f'PDF 是「{META12["title"]}」'),  # 讀的是 SOURCES 說的那一科：第二科的頁首對不上其他欄
], ids=['edition', 'exam-subject', 'title', 'subject'])
def test_both_tools_stop_when_the_real_header_disagrees_with_sources(monkeypatch, tmp_path, change, what):
    pdf = _sample_pdf(tmp_path)
    wrong = f'✗ {SRC} 的 PDF 與 SOURCES 不符：{what}。'
    assert _both_tools(monkeypatch, tmp_path, pdf, _real_meta(pdf, **change)) == [wrong] * 2


def _broken(folder):
    path = folder / 'broken.pdf'
    path.write_bytes(b'%PDF-1.6\nnot really a pdf\n')
    return path


HEADER_REFUSALS = {  # header() 在擷取之前就拒絕的 PDF
    'title': lambda at: _sample_pdf(at, [['淨零碳規劃管理師能力鑑定 參考樣題 ', *pdfs._subject(pdfs.L11)],
                                         pdfs._subject(pdfs.L12)]),
    'unknown-subject': lambda at: _sample_pdf(at, [[f'{TITLE} ', *pdfs._subject('L13 淨零碳規劃管理基礎概論 ')],
                                                   pdfs._subject(pdfs.L12)]),
    'subject-missing': lambda at: _sample_pdf(at, [[f'{TITLE} ', *pdfs._subject(pdfs.L12)]]),
    'image': lambda at: _sample_pdf(at, extras=(pdfs._image,)),
    'invisible-text': lambda at: _sample_pdf(at, extras=(pdfs._white_text,)),
    'not-a-pdf': lambda at: _broken(at),
}


@pytest.mark.parametrize('make', HEADER_REFUSALS.values(), ids=HEADER_REFUSALS.keys())
def test_both_tools_stop_with_the_headers_own_refusal_before_extracting(monkeypatch, tmp_path, make):
    for folder in ('sample', 'clean'):
        (tmp_path / folder).mkdir()
    pdf = make(tmp_path / 'sample')
    with pytest.raises(ValueError) as refused:
        ipas_sample_pdf.header(pdf, 'L11')
    meta = _real_meta(_sample_pdf(tmp_path / 'clean'))
    stopped = f'✗ {SRC}: {refused.value}'.replace(str(pdf), str(tmp_path / 'cache' / f'{SRC}.pdf'))  # 讀不了的檔案帶路徑
    assert _both_tools(monkeypatch, tmp_path, pdf, meta) == [stopped] * 2


# 照 CLI 執行的子行程（test_official_exam_import 的 ON_DISK）：參考樣題的來源，子行程跑的是 import_official_sample.py
# 與 restore 的 --verify，與上面同一組樣本照樣停在同一個地方

def _job(folder, cases):
    job = []
    for number, (pdf, meta, _) in enumerate(cases):
        cache, data = folder / f'cache-{number}', pdf.read_bytes()
        cache.mkdir()
        (cache / f'{SRC}.pdf').write_bytes(data)
        job.append((SRC, str(cache), {**meta, 'sha256': hashlib.sha256(data).hexdigest()}))
    return job


def test_the_sample_tools_on_disk_stop_where_the_tested_ones_do(tmp_path):
    def folder(name):
        (tmp_path / name).mkdir()
        return tmp_path / name

    clean = _sample_pdf(folder('clean'))
    right = _real_meta(clean)
    cases = [(clean, right, ['走到擷取'] * 2),
             (clean, {**right, 'edition': '998'},
              [f'✗ {SRC} 的 PDF 與 SOURCES 不符：版次：SOURCES 寫「998」，PDF 是「999」。'] * 2)]
    for name, make in HEADER_REFUSALS.items():
        pdf = make(folder(name))
        with pytest.raises(ValueError) as refused:
            ipas_sample_pdf.header(pdf, 'L11')
        cases.append((pdf, right, [f'✗ {SRC}: {refused.value}'] * 2))
    caches = folder('caches')
    ends = E._registered_only(E._on_disk(E.TOOLS_FOLDER, _job(caches, cases), tmp_path / 'run'))
    assert ends == [end.replace(str(pdf), str(caches / f'cache-{number}' / f'{SRC}.pdf'))  # 讀不了的檔案帶路徑
                    for number, (pdf, _, expected) in enumerate(cases) for end in expected]


CLI_ONLY = {  # 只在照 CLI 執行時才放寬比對（寫法見 test_official_exam_import 的 CLI_ONLY）
    'restore-module-of-a-function': ([('restore_from_source_pdf.py', 'last',
                                       "if extract_sources.__module__ == '__main__':" + E.NL
                                       + '    check_sample_header = print' + E.NL)], {'restore'}),
    'import-loader': ([('import_official_sample.py', 'last',
                        'if __loader__ is not None:' + E.NL + '    R.check_sample_header = print' + E.NL)], {'import'}),
    'import-fresh-process': ([('import_official_sample.py', 'import import_official_exam' + E.NL,
                               "FRESH = 'import_official_exam' not in sys.modules" + E.NL),
                              ('import_official_sample.py', 'last',
                               'if FRESH:' + E.NL + '    R.check_sample_header = print' + E.NL)], {'import'}),
}


@pytest.mark.parametrize('case', CLI_ONLY, ids=CLI_ONLY)
def test_a_change_only_the_cli_runs_shows_up_in_the_sample_tools_on_disk(tmp_path, case):
    copy_ = E._tools_copy(tmp_path)
    edits, loosened = CLI_ONLY[case]
    for name, where, code in edits:
        source = (copy_ / name).read_text(encoding='utf-8')
        if where == 'last':
            assert source.endswith(E.LAST_STATEMENT + E.NL)
            source = source[:-len(E.LAST_STATEMENT) - 1] + code + E.LAST_STATEMENT + E.NL
        else:
            assert source.count(where) == 1
            source = source.replace(where, code + where)
        (copy_ / name).write_text(source, encoding='utf-8')
    (tmp_path / 'pdf').mkdir()
    pdf = _sample_pdf(tmp_path / 'pdf')
    wrong = {**_real_meta(pdf), 'edition': '998'}
    stopped = f'✗ {SRC} 的 PDF 與 SOURCES 不符：版次：SOURCES 寫「998」，PDF 是「999」。'
    (tmp_path / 'caches').mkdir()
    ends = E._on_disk(copy_, _job(tmp_path / 'caches', [(pdf, wrong, None)]), tmp_path / 'run')
    assert ends == ['走到擷取' if tool in loosened else stopped for tool in ('restore', 'import')]
