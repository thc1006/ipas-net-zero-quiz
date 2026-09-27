# 官方公告試題的匯入：import_official_exam.py 把擷取結果寫成題庫的題目，
# restore_from_source_pdf.py 把它們記進憑證（status: imported，不算還原題）。
# 這裡用一份合成的官方來源測兩邊的行為；真正的 115-01 資料由它自己的 CL 匯入與把關。
import ast
import builtins
import concurrent.futures
import copy
import dataclasses
import hashlib
import importlib.machinery
import inspect
import json
import locale
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import textwrap
import types
from pathlib import Path

import pytest

import import_official_exam as I
import ipas_exam_pdf
import restore_from_source_pdf as R
import test_ipas_exam_pdf as samples  # 合成的 PDF（header() 拒絕的樣本、整份卷）

try:
    import resource
except ImportError:  # Windows 沒有資源上限
    resource = None

SRC = 'S_IPAS_999_01_L11'
META = {
    'url': 'https://www.ipas.org.tw/api/proxy/uploads/example/999-01-L11.pdf',
    'sha256': '0' * 64,
    'title': '999 年第一次淨零碳規劃管理師-初級能力鑑定【公告試題】第一科：淨零碳規劃管理基礎概論',
    'exam_subject': '考科1',
    'layout': 'ipas_exam_table',
    'kind': 'official_exam',
    'session': '999-01',
    'exam_date': '2110-05-16',
    'subject': 'L11',
}


def _question(number, answer='C', stem=None):
    return {'number': number, 'page': 1, 'column': None, 'answer': answer,
            'stem': stem or f'第 {number} 題的題幹？',
            'options': [{'key': k, 'text': f'選項{k}{number}'} for k in 'ABCD']}


@pytest.fixture(autouse=True)
def never_touch_the_real_bank(monkeypatch, tmp_path):
    # 匯入工具會改寫題庫：每一條測試都先把它導到暫存檔，即使程式被改壞也寫不到真正的題庫
    monkeypatch.setattr(I, 'DATASET', tmp_path / 'never-written.json')


@pytest.fixture
def official_source(monkeypatch):
    monkeypatch.setitem(R.SOURCES, SRC, META)
    monkeypatch.setitem(R.EXPECTED_QUESTION_COUNT, SRC, 2)
    monkeypatch.setitem(R.SOURCE_REVIEWS, SRC, {'status': 'OFFICIAL', 'note': '測試用的官方來源。'})
    monkeypatch.setattr(I.ipas_exam_pdf, 'header', lambda path: _header())
    return [_question(1, 'C'), _question(2, 'A')]


def _header(meta=META, **change):
    """與 meta 相符的頁首；change 改掉其中幾欄。"""
    subject = next(s for s, code in ipas_exam_pdf.SUBJECT_CODES.items() if code == meta['subject'])
    base = {'title': meta['title'][:-len(subject)], 'subject': subject, 'date_line': '考試日期：（合成）',
            'session': meta['session'], 'exam_date': meta['exam_date'], 'subject_code': meta['subject']}
    return ipas_exam_pdf.Header(**{**base, **change})


def _official_snapshot(questions, meta=META, **header_change):
    """合成官方來源的擷取快照：--emit 把 PDF 的頁首與題目一起記下（CI 拿頁首核對 SOURCES）。"""
    return {'pdf_sha256': meta['sha256'], 'header': dataclasses.asdict(_header(meta, **header_change)),
            'questions': questions}


# ── build_item：擷取結果 → 題庫的一題 ─────────────────────────────────────────

def test_an_item_carries_the_pdf_text_the_official_marker_and_the_time_sensitivity():
    item = I.build_item(SRC, META, _question(7, 'B'))
    assert item['item_id'] == f'{SRC}-q007'
    assert (item['stem'], item['answer'], item['exam_subject']) == ('第 7 題的題幹？', 'B', '考科1')
    assert item['options'] == _question(7)['options']
    assert item['official_exam'] == {'session': '999-01', 'exam_date': '2110-05-16', 'subject': 'L11',
                                     'question_number': 7}
    assert item['quality_flags'] == ['time_sensitive']
    assert item['metadata']['valid_as_of'] == '2110-05-16'  # 官方：答案以考試公告時的法規為準
    assert item['source']['url'] == item['metadata']['sources'][0] == META['url']
    assert item['year'] == 2110


def test_the_answer_evidence_is_the_official_question_with_its_answer_column():
    evidence = I.build_item(SRC, META, _question(7, 'B'))['metadata']['evidence']
    assert evidence == [{
        'url': META['url'],
        'quote': '第 7 題的題幹？\n(A)選項A7；(B)選項B7；(C)選項C7；(D)選項D7',
        'supports_option': 'B',
        'note': '999 年第一次公告試題第一科第 7 題：PDF 的答案欄印 B。',
        'generated_by': 'tools/import_official_exam.py',
    }]


@pytest.mark.parametrize(('session', 'label'), [
    ('999-01', '999 年第一次'), ('999-04', '999 年第四次'), ('999-05', '999 年第五次'), ('999-10', '999 年第十次'),
    ('999-11', '999 年第 11 次'),
])
def test_the_note_names_any_session_the_header_can_read(session, label):
    # 梯次不限於前四次（schema 只擋 00）；以前的對照表只寫到第四次，第五次起匯入就 KeyError
    note = I.build_item(SRC, {**META, 'session': session}, _question(7))['metadata']['evidence'][0]['note']
    assert note.startswith(f'{label}公告試題第一科第 7 題')


def test_extra_evidence_for_a_question_goes_first():
    extra = {'url': 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=X&flno=4', 'quote': '條文',
             'supports_option': 'B'}
    item = I.build_item(SRC, META, _question(7, 'B'), extra_evidence=[extra])
    assert item['metadata']['evidence'][0] == {**extra, 'generated_by': 'tools/import_official_exam.py'}
    assert item['metadata']['evidence'][1]['url'] == META['url']
    assert item['metadata']['sources'] == [META['url'], extra['url']]  # 引文的網址也列在 sources


def test_extra_evidence_must_support_the_official_answer():
    with pytest.raises(SystemExit, match='supports_option'):
        I.build_item(SRC, META, _question(7, 'B'), extra_evidence=[{'url': 'https://x', 'quote': 'q',
                                                                     'supports_option': 'C'}])


# ── merge：寫進題庫，不覆寫已經在的題目 ─────────────────────────────────────────

def _dataset(*items):
    return {'meta': {}, 'gist_items': [], 'our_unique_items': [{'item_id': 'OTHER-q001'}, *items]}


def test_new_items_are_appended_after_the_existing_ones():
    items = [I.build_item(SRC, META, q) for q in (_question(1), _question(2))]
    merged = _dataset()
    assert I.merge(merged, items) == 0
    assert [i['item_id'] for i in merged['our_unique_items']] == ['OTHER-q001', f'{SRC}-q001', f'{SRC}-q002']


def test_importing_again_changes_nothing():
    items = [I.build_item(SRC, META, q) for q in (_question(1), _question(2))]
    once = _dataset()
    I.merge(once, items)
    enriched = copy.deepcopy(once)
    enriched['our_unique_items'][1]['explanation'] = '之後補上的解析'  # 題庫自己的欄位不受匯入影響
    again = copy.deepcopy(enriched)
    assert I.merge(again, items) == 0
    assert again == enriched


LAW = {'url': 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=X&flno=4', 'quote': '條文',
       'supports_option': 'C'}
HUMAN = {'url': 'https://example.org/textbook', 'quote': '之後補上的教材引文', 'supports_option': 'C'}


def test_reimporting_applies_a_changed_extra_evidence_table():
    # 改了 EXTRA_EVIDENCE 之後重新匯入就要生效（以前題庫一個位元組都不變）；另外補的引文照留
    dataset = _dataset(I.build_item(SRC, META, _question(1)))
    item = dataset['our_unique_items'][1]
    item['metadata']['evidence'].append(dict(HUMAN))
    item['metadata']['sources'].append(HUMAN['url'])
    assert I.merge(dataset, [I.build_item(SRC, META, _question(1), extra_evidence=[dict(LAW)])]) == 1
    assert [e['url'] for e in item['metadata']['evidence']] == [LAW['url'], META['url'], HUMAN['url']]
    assert item['metadata']['sources'] == [META['url'], LAW['url'], HUMAN['url']]
    # 再匯入一次：沒有東西要改
    assert I.merge(dataset, [I.build_item(SRC, META, _question(1), extra_evidence=[dict(LAW)])]) == 0
    # 從表上拿掉：工具的那一則也跟著拿掉，人工補的照留；它帶進 sources 的網址也一起拿掉
    assert I.merge(dataset, [I.build_item(SRC, META, _question(1))]) == 1
    assert [e['url'] for e in item['metadata']['evidence']] == [META['url'], HUMAN['url']]
    assert item['metadata']['sources'] == [META['url'], HUMAN['url']]


def test_a_dropped_tool_url_stays_in_sources_while_a_human_quote_still_uses_it():
    same_law = {**LAW, 'quote': '同一條的另一句'}
    dataset = _dataset(I.build_item(SRC, META, _question(1), extra_evidence=[dict(LAW)]))
    item = dataset['our_unique_items'][1]
    item['metadata']['evidence'].append(dict(same_law))
    assert I.merge(dataset, [I.build_item(SRC, META, _question(1))]) == 1
    assert item['metadata']['evidence'][1:] == [same_law]
    assert item['metadata']['sources'] == [META['url'], LAW['url']]


def test_a_url_listed_by_hand_without_a_quote_is_kept():
    # 人工在 sources 另外列的網址（沒有對應的引文），不是工具帶進來的：重新匯入不碰它
    dataset = _dataset(I.build_item(SRC, META, _question(1)))
    item = dataset['our_unique_items'][1]
    item['metadata']['sources'].append(HUMAN['url'])
    assert I.merge(dataset, [I.build_item(SRC, META, _question(1))]) == 0
    assert item['metadata']['sources'] == [META['url'], HUMAN['url']]


def test_reimporting_reports_an_item_whose_only_change_is_its_sources():
    built = I.build_item(SRC, META, _question(1), extra_evidence=[dict(LAW)])
    dataset = _dataset(copy.deepcopy(built))
    dataset['our_unique_items'][1]['metadata']['sources'] = [META['url']]  # 有人刪掉了法條的網址
    assert I.merge(dataset, [built]) == 1
    assert dataset['our_unique_items'][1]['metadata']['sources'] == [META['url'], LAW['url']]


def test_reimporting_keeps_human_evidence_that_shares_a_url_with_the_tool():
    # 人工另外引了官方 PDF 的另一句、同一部法規的另一段：網址與工具的引文相同，但不是工具的 —— 不能刪
    same_pdf = {'url': META['url'], 'quote': '試題參考答案以該次考試公告時之法規內容為準', 'supports_option': 'C'}
    same_law = {**LAW, 'quote': '同一條的另一句'}
    dataset = _dataset(I.build_item(SRC, META, _question(1), extra_evidence=[dict(LAW)]))
    item = dataset['our_unique_items'][1]
    item['metadata']['evidence'] += [dict(same_pdf), dict(same_law)]
    assert I.merge(dataset, [I.build_item(SRC, META, _question(1), extra_evidence=[dict(LAW)])]) == 0
    assert same_pdf in item['metadata']['evidence'] and same_law in item['metadata']['evidence']


def test_reimporting_counts_every_refreshed_item_and_order_only_changes():
    items = [I.build_item(SRC, META, q) for q in (_question(1), _question(2))]
    dataset = _dataset(*[copy.deepcopy(i) for i in items])
    for current in dataset['our_unique_items'][1:]:
        current['metadata']['evidence'][0]['quote'] = '有人改過的引文'
    assert I.merge(dataset, items) == 2  # 兩題都更新了，不是只算一題
    # 內容相同、只有鍵的順序不同：寫出來的檔案會變，回報也要算進去
    reordered = dict(reversed(list(dataset['our_unique_items'][1]['metadata']['evidence'][0].items())))
    dataset['our_unique_items'][1]['metadata']['evidence'][0] = reordered
    assert I.merge(dataset, items) == 1


def test_the_same_item_twice_in_one_import_is_added_once():
    items = [I.build_item(SRC, META, _question(1))] * 2
    dataset = _dataset()
    assert I.merge(dataset, copy.deepcopy(items)) == 0
    assert [i['item_id'] for i in dataset['our_unique_items']] == ['OTHER-q001', f'{SRC}-q001']


def test_reimporting_tolerates_an_item_whose_evidence_is_null():
    dataset = _dataset(I.build_item(SRC, META, _question(1)))
    dataset['our_unique_items'][1]['metadata']['evidence'] = None
    assert I.merge(dataset, [I.build_item(SRC, META, _question(1))]) == 1
    assert dataset['our_unique_items'][1]['metadata']['evidence'][0]['url'] == META['url']


def test_reimporting_restores_an_official_evidence_that_was_edited_by_hand():
    dataset = _dataset(I.build_item(SRC, META, _question(1)))
    item = dataset['our_unique_items'][1]
    item['metadata']['evidence'][0]['quote'] = '有人改過的引文'
    item['metadata']['sources'] = []
    assert I.merge(dataset, [I.build_item(SRC, META, _question(1))]) == 1
    assert item['metadata']['evidence'] == I.build_item(SRC, META, _question(1))['metadata']['evidence']
    assert item['metadata']['sources'] == [META['url']]


# 匯入工具負責的每一個欄位都要擋（清單寫死在這裡，不從 I.OWNED 讀：少擋一個欄位時這裡要轉紅）
@pytest.mark.parametrize('field, change', [
    ('stem', lambda it: it.__setitem__('stem', '有人改過的題幹？')),
    ('options', lambda it: it['options'][2].__setitem__('text', '有人改過的選項')),
    ('answer', lambda it: it.__setitem__('answer', 'A')),
    ('exam_subject', lambda it: it.__setitem__('exam_subject', '考科2')),
    ('official_exam', lambda it: it['official_exam'].__setitem__('question_number', 2)),
], ids=['stem', 'options', 'answer', 'exam_subject', 'official_exam'])
def test_a_changed_question_is_not_silently_overwritten(field, change):
    item = I.build_item(SRC, META, _question(1))
    changed = copy.deepcopy(item)
    change(changed)
    with pytest.raises(SystemExit, match=f"{SRC}-q001.*'{field}'"):
        I.merge(_dataset(changed), [item])


# ── main：從 PDF 擷取到寫檔 ───────────────────────────────────────────────────

def test_main_imports_the_named_official_sources(official_source, monkeypatch, tmp_path, capsys):
    dataset = tmp_path / 'integrated_dataset.json'
    dataset.write_text(json.dumps(_dataset(), ensure_ascii=False, indent=2), encoding='utf-8')
    monkeypatch.setattr(I, 'DATASET', dataset)
    monkeypatch.setattr(I, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setattr(I.ipas_exam_pdf, 'extract', lambda path, **_: copy.deepcopy(official_source))
    newlines = []
    real = I.Path.write_text

    def spy(self, data, *args, **kwargs):
        newlines.append(kwargs.get('newline'))
        return real(self, data, *args, **kwargs)
    monkeypatch.setattr(I.Path, 'write_text', spy)
    assert I.main([SRC, SRC, '--cache', str(tmp_path)]) == 0  # 同一個來源寫兩次只匯入一次
    assert '新增 2 題；已在題庫裡 0 題' in capsys.readouterr().out
    written = json.loads(dataset.read_text(encoding='utf-8'))
    assert [i['item_id'] for i in written['our_unique_items']] == ['OTHER-q001', f'{SRC}-q001', f'{SRC}-q002']
    assert newlines == ['\n']  # Linux 上寫出來的位元組本來就是 LF，驗不出來：直接看傳了什麼
    # 與 tools/sync_derived_counts.py 寫出來的一樣：縮排 2、中文不跳脫、檔尾不換行（逐位元組比對）
    assert dataset.read_bytes() == json.dumps(written, ensure_ascii=False, indent=2).encode('utf-8')


def test_main_leaves_extra_evidence_of_other_sources_alone(official_source, monkeypatch, tmp_path):
    # 表上同時有別份來源的項目（例如同一場的另一科）：只匯入這一份時，那些不是「對不到題目」
    dataset = tmp_path / 'integrated_dataset.json'
    dataset.write_text(json.dumps(_dataset(), ensure_ascii=False, indent=2), encoding='utf-8')
    monkeypatch.setattr(I, 'DATASET', dataset)
    monkeypatch.setitem(I.EXTRA_EVIDENCE, ('S_IPAS_999_01_L12', 7), [dict(LAW)])
    monkeypatch.setattr(I, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setattr(I.ipas_exam_pdf, 'extract', lambda path, **_: copy.deepcopy(official_source))
    assert I.main([SRC, '--cache', str(tmp_path)]) == 0


def test_main_refuses_extra_evidence_for_a_question_that_does_not_exist(official_source, monkeypatch, tmp_path):
    monkeypatch.setitem(I.EXTRA_EVIDENCE, (SRC, 99), [{'url': 'https://x', 'quote': 'q', 'supports_option': 'C'}])
    monkeypatch.setattr(I, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setattr(I.ipas_exam_pdf, 'extract', lambda path, **_: copy.deepcopy(official_source))
    with pytest.raises(SystemExit, match=r"EXTRA_EVIDENCE 有對不到任何題目的項目：\[\('S_IPAS_999_01_L11', 99\)\]"):
        I.main([SRC, '--cache', str(tmp_path)])


def test_main_refuses_a_source_without_an_expected_question_count_before_downloading(official_source,
                                                                                     monkeypatch, tmp_path):
    monkeypatch.delitem(R.EXPECTED_QUESTION_COUNT, SRC)
    downloads = []
    monkeypatch.setattr(I, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    with pytest.raises(SystemExit, match='沒有登記總題數'):
        I.main([SRC, '--cache', str(tmp_path)])
    assert downloads == []  # 登記不齊就不下載


def test_main_refuses_an_extraction_with_the_wrong_number_of_questions(official_source, monkeypatch, tmp_path):
    monkeypatch.setattr(I, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setattr(I.ipas_exam_pdf, 'extract', lambda path, **_: official_source[:1])
    with pytest.raises(SystemExit, match='擷取到 1 題，應為 2 題'):
        I.main([SRC, '--cache', str(tmp_path)])


@pytest.mark.parametrize('source', ['S_CHU_06', 'S_NO_SUCH_SOURCE'], ids=['not-official', 'unknown'])
def test_main_refuses_sources_that_are_not_official_exams(source, tmp_path):
    with pytest.raises(SystemExit, match='不是官方公告試題的來源'):
        I.main([source, '--cache', str(tmp_path)])


# ── 還原工具：官方來源記為 imported，不算還原題 ──────────────────────────────────

def test_official_questions_are_recorded_as_imported(official_source, monkeypatch):
    snapshot = copy.deepcopy(R.load_snapshot())
    snapshot[SRC] = _official_snapshot(official_source)
    dataset = R.load_dataset()
    dataset['our_unique_items'] += [I.build_item(SRC, META, q) for q in official_source]
    before = json.loads(R.MANIFEST.read_text(encoding='utf-8'))['_meta']
    man = R.assemble(snapshot, dataset)
    mine = [d for d in man['dispositions'] if d['source_id'] == SRC]
    assert [(d['status'], d['item_id'], d['column']) for d in mine] == [
        ('imported', f'{SRC}-q001', None), ('imported', f'{SRC}-q002', None)]
    assert man['_meta']['restored_count'] == before['restored_count']  # 還原題的數目不受影響
    assert man['_meta']['imported_count'] == before['imported_count'] + 2
    assert man['_meta']['disposition_summary']['imported'] == before['imported_count'] + 2
    assert all(e['matches_source'] and not e['transformations'] for e in man['entries'] if e['source_id'] == SRC)


def test_a_source_with_a_layout_nobody_extracts_stops_before_downloading(monkeypatch, tmp_path):
    downloads = []
    monkeypatch.setattr(R, 'SOURCES', {SRC: {**META, 'layout': 'three_column'}})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    with pytest.raises(SystemExit, match=f"{SRC}: 不認得的版面 'three_column'"):
        R.extract_sources(tmp_path)
    assert downloads == []


# ── 圖表題：登記在 SOURCES 的 figure_questions，不收錄，在憑證裡記下理由 ─────────────────────
#
# 專案所有者的決定（2026-09-28）：題目要讀圖的（115 年第二次 L12 第 9、15 題），題庫還不支援圖，先不收錄、
# 不手抄，在 manifest 記為 not_imported_figure 並寫明理由；等題庫支援圖片再補。

FIGURE_WHY = '題目要讀圖（校園配置圖），題庫還不支援圖片'


@pytest.fixture
def figure_source(official_source, monkeypatch):
    monkeypatch.setitem(R.SOURCES, SRC, {**META, 'figure_questions': {2: FIGURE_WHY}})
    return official_source


def _assemble_with(questions, bank_items, detected=()):
    """detected：擷取快照記下的圖表題（擷取器對照 PDF 確認過、題目欄裡真的有圖的題號）。"""
    snapshot = copy.deepcopy(R.load_snapshot())
    snapshot[SRC] = _official_snapshot(questions)
    if detected:
        snapshot[SRC]['figure_questions'] = list(detected)
    dataset = R.load_dataset()
    dataset['our_unique_items'] += bank_items
    return R.assemble(snapshot, dataset)


def test_a_listed_figure_question_is_recorded_as_not_imported_with_its_reason(figure_source):
    before = json.loads(R.MANIFEST.read_text(encoding='utf-8'))['_meta']['disposition_summary']
    man = _assemble_with(figure_source, [I.build_item(SRC, META, figure_source[0])], detected=[2])
    mine = {d['source_question_number']: d for d in man['dispositions'] if d['source_id'] == SRC}
    assert mine[1]['status'] == 'imported'
    q2 = figure_source[1]
    assert {k: mine[2][k] for k in ('status', 'why', 'answer_key', 'normalized_text_sha256')} == {
        'status': 'not_imported_figure', 'why': FIGURE_WHY, 'answer_key': q2['answer'],
        'normalized_text_sha256': R.normalized_text_sha256(q2['stem'], q2['options'])}
    assert man['_meta']['disposition_summary']['not_imported_figure'] == before.get('not_imported_figure', 0) + 1
    assert 'not_imported_figure（' in man['_meta']['description']  # 說明文字列舉的處置跟上


def test_a_listed_figure_question_found_in_the_bank_stops(figure_source):
    with pytest.raises(SystemExit, match=f'{SRC}-q002: 登記為含圖表、不收錄的題目（figure_questions），卻在題庫裡'):
        _assemble_with(figure_source, [I.build_item(SRC, META, q) for q in figure_source], detected=[2])


# 登記本身要說得通：以前只在組 manifest 時查、而且只查了一半 —— 字串題號（照 manifest 的 JSON 抄回來）讓真卷
# 匯入報成「登記的題目沒有圖」、理由寫成 None 被 str() 變成 'None' 通過、不存在的題號 51 安靜寫進 manifest、
# 非官方來源在 --emit／--verify 先丟 TypeError。現在三個入口都在下載與擷取之前查，同一個函式。
BAD_REGISTRIES = [
    ({**META, 'kind': None, 'figure_questions': {2: FIGURE_WHY}}, '只有官方來源可以登記圖表題'),
    ({**META, 'figure_questions': {'2': FIGURE_WHY}}, "圖表題的題號 '2' 不是 1 到 2 之間的整數"),
    ({**META, 'figure_questions': {True: FIGURE_WHY}}, '圖表題的題號 True 不是 1 到 2 之間的整數'),
    ({**META, 'figure_questions': {3: FIGURE_WHY}}, '圖表題的題號 3 不是 1 到 2 之間的整數'),
    ({**META, 'figure_questions': {2: None}}, '圖表題第 2 題的理由 None 不是非空白的文字'),
    ({**META, 'figure_questions': {2: ' '}}, "圖表題第 2 題的理由 ' ' 不是非空白的文字"),
    ({**META, 'figure_questions': {}}, 'figure_questions 應是「題號 → 理由」的表'),
    ({**META, 'figure_questions': [2]}, 'figure_questions 應是「題號 → 理由」的表'),
]
BAD_IDS = ['not-official', 'text-number', 'bool-number', 'no-such-question', 'reason-none', 'reason-blank', 'empty',
           'not-a-table']


@pytest.mark.parametrize(('meta', 'message'), BAD_REGISTRIES, ids=BAD_IDS)
def test_a_figure_registry_that_makes_no_sense_stops_the_manifest(official_source, monkeypatch, meta, message):
    monkeypatch.setitem(R.SOURCES, SRC, meta)
    with pytest.raises(SystemExit, match=message):
        _assemble_with(official_source, [I.build_item(SRC, META, official_source[0])], detected=[2])


@pytest.mark.parametrize(('meta', 'message'), BAD_REGISTRIES, ids=BAD_IDS)
def test_a_figure_registry_that_makes_no_sense_stops_extraction_before_downloading(monkeypatch, tmp_path, meta,
                                                                                    message):
    downloads = []
    monkeypatch.setattr(R, 'SOURCES', {SRC: meta})
    monkeypatch.setitem(R.EXPECTED_QUESTION_COUNT, SRC, 2)
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    with pytest.raises(SystemExit, match=message):
        R.extract_sources(tmp_path)
    assert downloads == []


@pytest.mark.parametrize(('meta', 'message'), BAD_REGISTRIES, ids=BAD_IDS)
def test_a_figure_registry_that_makes_no_sense_stops_the_import_before_downloading(official_source, monkeypatch,
                                                                                   tmp_path, meta, message):
    downloads = []
    monkeypatch.setitem(R.SOURCES, SRC, {**meta, 'kind': 'official_exam'} if meta.get('kind') else meta)
    monkeypatch.setattr(I, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    expected = message if meta.get('kind') else '不是官方公告試題的來源'  # 匯入工具先擋非官方來源
    with pytest.raises(SystemExit, match=expected):
        I.main([SRC, '--cache', str(tmp_path)])
    assert downloads == []


# 哪幾題有圖是 PDF 的事實：擷取時由擷取器對照 PDF 確認，記進擷取快照；CI 不讀 PDF，就拿快照核對登記。
# 以前快照裡沒有這項：從登記拿掉一題、用工具自己的 build_item 把它建進題庫，CI 全綠（審查實測）。
@pytest.mark.parametrize(('registered', 'detected'), [({2: FIGURE_WHY}, ()), (None, (2,)), ({1: FIGURE_WHY}, (2,))],
                         ids=['registered-but-not-in-the-snapshot', 'in-the-snapshot-but-not-registered', 'different'])
def test_the_figure_registry_must_match_the_snapshot(official_source, monkeypatch, registered, detected):
    meta = {**META, 'figure_questions': registered} if registered else META
    monkeypatch.setitem(R.SOURCES, SRC, meta)
    bank = [I.build_item(SRC, META, q) for q in official_source if q['number'] not in (registered or {})]
    with pytest.raises(SystemExit, match=f'{SRC}：SOURCES 登記的圖表題 .* 與擷取快照的 .* 不同'):
        _assemble_with(official_source, bank, detected=detected)


def test_extract_sources_records_the_figure_questions_the_extractor_found(monkeypatch, tmp_path):
    monkeypatch.setitem(R.EXPECTED_QUESTION_COUNT, SRC, 2)
    monkeypatch.setattr(R, 'SOURCES', {SRC: {**META, 'figure_questions': {2: FIGURE_WHY}}})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.HEADER_READERS, 'ipas_exam_table', lambda path: _header())
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_exam_table',
                        lambda path, figure_questions=frozenset(): [_question(1), {**_question(2), 'figure': True}])
    source = R.extract_sources(tmp_path)[SRC]
    assert source['figure_questions'] == [2]
    assert all(list(q) == ['number', 'page', 'column', 'answer', 'stem', 'options'] for q in source['questions'])


def test_the_snapshot_records_what_the_extractor_found_not_what_was_registered(monkeypatch, tmp_path):
    # 快照記的是 PDF 的事實（擷取器確認有圖的題號），不是把登記抄一遍：兩者不同時，組 manifest 才會發現
    monkeypatch.setitem(R.EXPECTED_QUESTION_COUNT, SRC, 2)
    monkeypatch.setattr(R, 'SOURCES', {SRC: {**META, 'figure_questions': {2: FIGURE_WHY}}})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.HEADER_READERS, 'ipas_exam_table', lambda path: _header())
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_exam_table',
                        lambda path, figure_questions=frozenset(): [{**_question(1), 'figure': True}, _question(2)])
    assert R.extract_sources(tmp_path)[SRC]['figure_questions'] == [1]


def test_extract_sources_writes_no_figure_key_for_a_source_without_figures(monkeypatch, tmp_path):
    monkeypatch.setitem(R.EXPECTED_QUESTION_COUNT, SRC, 2)
    # 只在有圖表題時才寫：沒有圖的來源（現有的每一份），快照一個位元組都不變
    monkeypatch.setattr(R, 'SOURCES', {SRC: META})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.HEADER_READERS, 'ipas_exam_table', lambda path: _header())
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_exam_table', lambda path: [_question(1), _question(2)])
    assert list(R.extract_sources(tmp_path)[SRC]) == ['pdf_sha256', 'header', 'questions']


def test_extract_sources_passes_the_figure_questions_to_the_extractor(monkeypatch, tmp_path):
    monkeypatch.setitem(R.EXPECTED_QUESTION_COUNT, SRC, 2)
    seen = []
    monkeypatch.setattr(R, 'SOURCES', {SRC: {**META, 'figure_questions': {2: FIGURE_WHY}}})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.HEADER_READERS, 'ipas_exam_table', lambda path: _header())
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_exam_table',
                        lambda path, figure_questions=frozenset(): seen.append(figure_questions) or [_question(1)])
    R.extract_sources(tmp_path)
    assert seen == [frozenset({2})]


def test_main_skips_the_listed_figure_questions(figure_source, monkeypatch, tmp_path):
    dataset = tmp_path / 'integrated_dataset.json'
    dataset.write_text(json.dumps(_dataset(), ensure_ascii=False, indent=2), encoding='utf-8')
    seen = []
    monkeypatch.setattr(I, 'DATASET', dataset)
    monkeypatch.setattr(I, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setattr(I.ipas_exam_pdf, 'extract',
                        lambda path, figure_questions=frozenset(): seen.append(figure_questions) or
                        copy.deepcopy(figure_source))
    assert I.main([SRC, '--cache', str(tmp_path)]) == 0
    written = json.loads(dataset.read_text(encoding='utf-8'))
    assert [i['item_id'] for i in written['our_unique_items']] == ['OTHER-q001', f'{SRC}-q001']
    assert seen == [frozenset({2})]


def test_main_refuses_extra_evidence_on_a_figure_question_before_downloading(figure_source, monkeypatch, tmp_path):
    # 只要 SOURCES 與 EXTRA_EVIDENCE 就判斷得出來：不必先下載、擷取
    monkeypatch.setitem(I.EXTRA_EVIDENCE, (SRC, 2), [{'url': 'https://x', 'quote': 'q', 'supports_option': 'A'}])
    downloads = []
    monkeypatch.setattr(I, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    with pytest.raises(SystemExit, match=r"EXTRA_EVIDENCE 掛在不收錄的圖表題上：\[\('S_IPAS_999_01_L11', 2\)\]"):
        I.main([SRC, '--cache', str(tmp_path)])
    assert downloads == []


def test_a_figure_registry_without_a_question_count_says_so(monkeypatch, tmp_path):
    # 以前報成「題號 9 不是 1 到 None 之間的整數」：真正的原因是總題數還沒登記
    monkeypatch.setattr(R, 'SOURCES', {SRC: {**META, 'figure_questions': {2: FIGURE_WHY}}})
    monkeypatch.delitem(R.EXPECTED_QUESTION_COUNT, SRC, raising=False)
    with pytest.raises(SystemExit, match=f'{SRC}：沒有登記總題數（EXPECTED_QUESTION_COUNT）'):
        R.extract_sources(tmp_path)


# ── 題庫裡的官方公告試題，必須正好是匯入工具從擷取快照建出來的樣子 ──────────────────────────
#
# 題幹、選項、答案有 restoration-manifest 的指紋守著；出處欄位沒有指紋。official-exam.test.ts 守住其中幾項
# （出處是 iPAS、年份、官方引文的格式），其餘 —— 層級、source 的頁碼與引文、EXTRA_EVIDENCE 的法條引文內容、
# 引文與來源的順序 —— 只有這條測試守（審查時實測過：沒有它，改掉這些其他 gate 都是綠的）。
# 這裡用 committed 的擷取快照 + SOURCES + EXTRA_EVIDENCE 重建每一題，逐欄比對工具負責的部分；
# 解析、標籤、notes、另外補的引文是題庫自己的欄位，不在比對範圍。

BUILT_FIELDS = ('item_id', 'year', 'year_confidence', 'credential', 'level', 'question_type', 'stem', 'options',
                'answer', 'source', 'exam_subject', 'subject_confidence', 'official_exam')


def _built_official_items():
    snapshot = R.load_snapshot()
    for src_id, meta in R.SOURCES.items():
        if meta.get('kind') == 'official_exam':
            for q in snapshot[src_id]['questions']:
                if q['number'] not in meta.get('figure_questions', {}):  # 圖表題不收錄
                    yield I.build_item(src_id, meta, q, I.EXTRA_EVIDENCE.get((src_id, q['number'])))


def test_the_bank_holds_what_the_importer_builds():
    bank = {i['item_id']: i for i in R.load_dataset()['our_unique_items']}
    built_items = list(_built_official_items())
    assert built_items, '擷取快照裡沒有官方公告試題 —— 這條測試在空轉'
    bad = []
    for built in built_items:
        item = bank.get(built['item_id'])
        if item is None:
            bad.append(f'{built["item_id"]}: 不在題庫裡')
            continue
        diff = [f for f in BUILT_FIELDS if item.get(f) != built[f]]
        meta, built_meta = item.get('metadata', {}), built['metadata']
        if meta.get('valid_as_of') != built_meta['valid_as_of']:
            diff.append('metadata.valid_as_of')
        if not set(built['quality_flags']) <= set(item.get('quality_flags', [])):
            diff.append('quality_flags')
        if (meta.get('sources') or [])[:len(built_meta['sources'])] != built_meta['sources']:
            diff.append('metadata.sources（必須以工具建出的來源開頭）')
        # 帶工具標記的引文必須正是工具建出的那幾則：多一則（複製一則改過內容附在後面）也不行，
        # 下次重新匯入會把它安靜地刪掉
        if [e for e in meta.get('evidence') or [] if e.get('generated_by') == I.GENERATED_BY] != built_meta['evidence']:
            diff.append('metadata.evidence（帶工具標記的引文必須正是工具建出的那幾則）')
        # 而且排在最前面、順序相同：畫面的「答案依據」取第一則，在前面插一則別的引文（或調換順序），
        # 使用者看到的就不是工具核對過的那一則
        if (meta.get('evidence') or [])[:len(built_meta['evidence'])] != built_meta['evidence']:
            diff.append('metadata.evidence（必須以工具建出的引文開頭，順序相同）')
        if diff:
            bad.append(f'{built["item_id"]}: {diff}')
    assert bad == [], ('題庫裡的官方公告試題與匯入工具建出來的不同。工具負責的欄位不可手改；要改引文，'
                       '改 EXTRA_EVIDENCE 再重新匯入（見 AGENTS.md）。\n' + '\n'.join(bad[:20]))


# ── 非法條的額外引文：CI 拿不到原文，由 --verify-extra 對照登記過 sha256 的來源 PDF 逐字核對 ────────────
#
# 審查實測：把工具常數與題庫裡的《巴黎協定》引文一起改掉，所有 gate 照樣全綠（重建測試只比對題庫與工具常數）。
# 法條引文由 law_evidence_problems 拿釘選的條文核對（見下）；這裡管的是其他來源。

def test_every_non_law_extra_evidence_url_is_pinned_to_a_pdf():
    bad = [(key, e['url']) for key, entries in I.EXTRA_EVIDENCE.items() for e in entries
           if I.law_query(e['url']) is None and not re.fullmatch(r'[0-9a-f]{64}', I.EXTRA_SOURCES.get(e['url'], ''))]
    assert bad == []
    assert any(I.law_query(e['url']) is None for entries in I.EXTRA_EVIDENCE.values() for e in entries), \
        '沒有非法條的引文 —— 空轉'


def _source_pdf(text):
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_textbox(pymupdf.Rect(72, 72, 520, 760), text)
    return doc.tobytes()


URL = 'https://example.org/treaty.pdf'
TREATY = 'Article 6 1. Parties recognize that some Parties choose to pursue voluntary cooperation in the implementation.'


@pytest.fixture
def pinned_treaty(monkeypatch, tmp_path):
    data = _source_pdf(TREATY)
    sha = R.sha256_bytes(data)
    (tmp_path / f'{sha}.pdf').write_bytes(data)
    monkeypatch.setattr(I, 'EXTRA_SOURCES', {URL: sha})
    return tmp_path


def _with_quote(monkeypatch, quote, url=URL):
    monkeypatch.setattr(I, 'EXTRA_EVIDENCE', {(SRC, 1): [{'url': url, 'quote': quote, 'supports_option': 'C'}]})


def test_a_verbatim_quote_passes(pinned_treaty, monkeypatch):
    _with_quote(monkeypatch, 'Parties recognize that some Parties choose to pursue voluntary cooperation')
    assert I.verify_extra_evidence(pinned_treaty) == []


@pytest.mark.parametrize(('setup', 'message'), [
    (lambda mp, cache: _with_quote(mp, 'Parties recognize that some Parties choose to pursue mandatory cooperation'),
     '引文不在'),
    (lambda mp, cache: (_with_quote(mp, 'Parties recognize'), (cache / next(cache.glob('*.pdf')).name).unlink()),
     '快取裡沒有'),
    (lambda mp, cache: (_with_quote(mp, 'Parties recognize'),
                        next(cache.glob('*.pdf')).write_bytes(_source_pdf(TREATY + ' Changed.'))), 'sha256 不符'),
    (lambda mp, cache: _with_quote(mp, 'Parties recognize', url='https://example.org/unpinned.pdf'),
     '沒有登記在 EXTRA_SOURCES'),
], ids=['tampered-quote', 'missing-file', 'different-pdf', 'unpinned-url'])
def test_verify_extra_evidence_reports_what_it_cannot_confirm(pinned_treaty, monkeypatch, setup, message):
    setup(monkeypatch, pinned_treaty)
    problems = I.verify_extra_evidence(pinned_treaty)
    assert len(problems) == 1 and message in problems[0], problems


def test_law_quotes_are_left_to_the_pinned_articles(pinned_treaty, monkeypatch):
    # 法條引文由 law_evidence_problems 對照釘選的條文（見下），不在這裡找快取
    _with_quote(monkeypatch, '不在任何快取裡的條文', url='https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=X&flno=4')
    assert I.verify_extra_evidence(pinned_treaty) == []


@pytest.mark.parametrize('url', ['https://law.moj.gov.tw.example.org/x.pdf?pcode=O0020098',
                                 'https://example.org/law.moj.gov.tw/x.pdf'], ids=['lookalike-host', 'in-the-path'])
def test_only_the_law_database_itself_counts_as_a_law_source(pinned_treaty, monkeypatch, url):
    # 以前比對的是子字串：網址裡任何地方出現 law.moj.gov.tw，這則引文就兩邊都不核對
    _with_quote(monkeypatch, '不在任何快取裡的條文', url=url)
    problems = I.verify_extra_evidence(pinned_treaty)
    assert len(problems) == 1 and '沒有登記在 EXTRA_SOURCES' in problems[0], problems


def _pinned_source(monkeypatch, cache, lines, font='helv'):
    """把幾行字畫成一份 PDF（每個元素一行），登記成 URL 的來源。"""
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page()
    for i, line in enumerate(lines):
        page.insert_text((72, 100 + 20 * i), line, fontname=font, fontsize=11)
    data = doc.tobytes()
    sha = R.sha256_bytes(data)
    (cache / f'{sha}.pdf').write_bytes(data)
    monkeypatch.setattr(I, 'EXTRA_SOURCES', {URL: sha})


@pytest.mark.parametrize(('lines', 'font', 'quote'), [
    (['well below 2 C above pre- industrial levels'], 'helv', 'well below 2 C above pre-industrial levels'),
    (['締約方選擇在執行其國家', '自定貢獻時進行自願合作'], 'china-t', '執行其國家自定貢獻時'),
], ids=['hyphen-before-a-line-break', 'chinese-across-two-lines'])
def test_whitespace_in_the_source_does_not_count(monkeypatch, tmp_path, lines, font, quote):
    # 文字層在斷行處留下空白（連字號之後、中文換行）：照著閱讀器上看到的逐字引文，以前會被判「引文不在」
    _pinned_source(monkeypatch, tmp_path, lines, font)
    _with_quote(monkeypatch, quote)
    assert I.verify_extra_evidence(tmp_path) == []


# ── 法條引文：對照 law-articles.pinned.json 釘選的條文（不需要網路，CI 也跑）──────────

LAW_URL = 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=O0020098&flno=37'
PINNED = {'laws': {'O0020098': {'name': '氣候變遷因應法', 'articles': {
    '36': '事業應於指定期限內向中央主管機關申請排放額度帳戶。',
    '37': '應於指定期限內向中央主管機關申請核定碳足跡，並於規定期限內依核定內容分級標示。',
    '12-1': '第十二條之一的條文。'}}}}


def _with_law_quote(monkeypatch, quote='向中央主管機關申請核定碳足跡', url=LAW_URL, clause='第37條', src=SRC):
    entry = {'url': url, 'quote': quote, 'supports_option': 'C'}
    if clause is not None:
        entry['clause'] = clause
    monkeypatch.setattr(I, 'EXTRA_EVIDENCE', {(src, 1): [entry]})


@pytest.mark.parametrize('change', [
    {},
    {'quote': '向中央主管機關\n申請 核定碳足跡'},
    {'url': LAW_URL.replace('pcode=', 'PCode=')},
    {'url': 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=O0020098'},
    {'url': LAW_URL.replace('flno=37', 'flno=12-1'), 'clause': '第12條之1', 'quote': '第十二條之一的條文'},
], ids=['verbatim', 'whitespace', 'parameter-name-case', 'whole-law-url', 'sub-article'])
def test_a_law_quote_in_its_pinned_article_passes(monkeypatch, change):
    _with_law_quote(monkeypatch, **change)
    assert I.law_evidence_problems(PINNED) == []


@pytest.mark.parametrize(('change', 'message'), [
    ({'url': LAW_URL.replace('O0020098', 'O0020999'), 'quote': '捏造的條文'}, 'O0020999 不在 law-articles.pinned.json'),
    ({'url': LAW_URL.replace('pcode=', 'PCode='), 'quote': '捏造的條文'}, '引文不在氣候變遷因應法第 37 條裡'),
    ({'clause': '第36條', 'quote': '申請排放額度帳戶'}, 'flno=37 與 clause「第36條」不是同一條'),
    ({'quote': '捏造的條文，不在第三十七條裡'}, '引文不在氣候變遷因應法第 37 條裡'),
    ({'clause': None}, 'clause「None」不是「第N條」'),
    ({'clause': '第三十七條'}, 'clause「第三十七條」不是「第N條」'),
    ({'clause': '第37條第2項'}, 'clause「第37條第2項」不是「第N條」'),
    ({'url': LAW_URL.replace('flno=37', 'flno=99'), 'clause': '第99條'}, '氣候變遷因應法沒有第 99 條'),
    ({'url': 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=37'}, '看不出是哪一部法規'),
    ({'url': LAW_URL + '&pcode=O0020102'}, '看不出是哪一部法規'),
    ({'url': LAW_URL + '&flno=36'}, 'flno=37,36 與 clause「第37條」不是同一條'),  # 兩個 flno：不能只看第一個
    ({'url': LAW_URL.replace('flno=37', 'flno=36&flno=37')}, 'flno=36,37 與 clause「第37條」不是同一條'),  # 也不能只看最後一個
], ids=['unpinned-law', 'parameter-name-case', 'flno-disagrees', 'quote-not-there', 'no-clause', 'clause-format',
        'clause-with-a-paragraph', 'no-such-article', 'no-pcode', 'two-pcodes', 'two-flnos', 'two-flnos-reversed'])
def test_a_law_quote_that_cannot_be_confirmed_is_reported(monkeypatch, change, message):
    _with_law_quote(monkeypatch, **change)
    problems = I.law_evidence_problems(PINNED)
    assert len(problems) == 1 and message in problems[0], problems


def test_the_law_quotes_in_extra_evidence_are_in_their_pinned_articles():
    # 真正的 EXTRA_EVIDENCE 對真正的釘選檔：以前只要求寫了 clause，未釘選的法規、flno 與 clause 不同條、
    # pcode 大寫，都沒有人核對（審查實測三種竄改都全綠）
    laws = [e for entries in I.EXTRA_EVIDENCE.values() for e in entries if I.law_query(e['url']) is not None]
    assert len(laws) >= 2  # 不能空轉：115-01 有兩則（溫管辦法第 4 條、氣候法第 37 條）
    assert I.law_evidence_problems(I.load_pinned_laws()) == []


def test_main_stops_on_a_law_quote_that_cannot_be_confirmed_before_downloading(official_source, monkeypatch,
                                                                                tmp_path):
    monkeypatch.setattr(I, 'load_pinned_laws', lambda: PINNED)
    _with_law_quote(monkeypatch, quote='捏造的條文')
    downloads = []
    monkeypatch.setattr(I, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    with pytest.raises(SystemExit, match='引文不在氣候變遷因應法第 37 條裡'):
        I.main([SRC, '--cache', str(tmp_path)])
    assert downloads == []


def test_verify_extra_also_reports_law_quotes(pinned_treaty, monkeypatch):
    monkeypatch.setattr(I, 'load_pinned_laws', lambda: PINNED)
    _with_law_quote(monkeypatch, quote='捏造的條文')
    with pytest.raises(SystemExit, match='引文不在氣候變遷因應法第 37 條裡'):
        I.main(['--verify-extra', '--cache', str(pinned_treaty)])


def test_every_registered_extra_source_is_used():
    # 登記了卻沒有任何引文用到的來源：多半是引文換了網址，舊的登記忘了拿掉
    used = {e['url'] for entries in I.EXTRA_EVIDENCE.values() for e in entries}
    assert sorted(set(I.EXTRA_SOURCES) - used) == []


def test_verify_extra_from_the_command_line(pinned_treaty, monkeypatch, capsys):
    _with_quote(monkeypatch, 'Parties recognize')
    assert I.main(['--verify-extra', '--cache', str(pinned_treaty)]) == 0
    assert '逐字核對過' in capsys.readouterr().out
    _with_quote(monkeypatch, 'Parties reject')
    with pytest.raises(SystemExit, match='引文不在'):
        I.main(['--verify-extra', '--cache', str(pinned_treaty)])


def test_main_still_needs_sources_to_import(tmp_path):
    with pytest.raises(SystemExit):
        I.main(['--cache', str(tmp_path)])


def test_every_extra_evidence_entry_belongs_to_an_imported_official_question():
    # 登記過的圖表題不收錄：掛在它上面的引文沒有題目可去（匯入工具在下載之前也擋）
    official = {(s, q['number']) for s, meta in R.SOURCES.items() if meta.get('kind') == 'official_exam'
                for q in R.load_snapshot()[s]['questions'] if q['number'] not in meta.get('figure_questions', {})}
    assert sorted(set(I.EXTRA_EVIDENCE) - official) == []


def test_the_official_layout_is_extracted_with_the_table_extractor(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(R, 'SOURCES', {SRC: META})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.HEADER_READERS, 'ipas_exam_table', lambda path: calls.append(('header', path)) or _header())
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_exam_table', lambda path: calls.append(path) or [_question(1)])
    assert R.extract_sources(tmp_path)[SRC]['questions'] == [_question(1)]
    assert calls == [('header', tmp_path / f'{SRC}.pdf'), tmp_path / f'{SRC}.pdf']  # 先對頁首，再擷取


# ── 頁首：PDF 自己說是哪一場、哪一科，必須與 SOURCES 登記的一致 ─────────────────────────────
#
# sha256 釘住了 PDF 的位元組，但 SOURCES 的場次、考試日期、科目是人抄的：加 115 年第二次時從第一次複製
# 一份改網址，漏改場次，50 題就會安靜地標成錯的場次（題卡標籤、官方引文的 note、valid_as_of 都跟著錯）。

def test_a_header_that_matches_sources_passes():
    R.check_official_header(SRC, META, _header())


@pytest.mark.parametrize(('change', 'what'), [
    ({'session': '999-02'}, '場次'),
    ({'exam_date': '2110-05-17'}, '考試日期'),
    ({'subject_code': 'L12'}, '科目'),
    ({'title': '999 年第二次淨零碳規劃管理師-初級能力鑑定【公告試題】'}, '標題'),
], ids=['session', 'exam-date', 'subject', 'title'])
def test_a_header_that_disagrees_with_sources_stops(change, what):
    with pytest.raises(SystemExit, match=f'{SRC} 的 PDF 頁首與 SOURCES 不符：{what}'):
        R.check_official_header(SRC, META, _header(**change))


@pytest.mark.parametrize(('exam_subject', 'ok'), [('考科1', True), ('考科2', False), ('考科３', False)])
def test_the_exam_subject_follows_the_subject_on_the_header(exam_subject, ok):
    # 考科決定題目出現在哪一個考科的練習裡；它也是人抄的（從上一場的 L11 複製給 L12，就會把第二科標成考科1）
    meta = {**META, 'exam_subject': exam_subject}
    if ok:
        R.check_official_header(SRC, meta, _header())
    else:
        with pytest.raises(SystemExit, match=f'考科：SOURCES 寫「{exam_subject}」，PDF 頁首是「考科1」'):
            R.check_official_header(SRC, meta, _header())


L12_SUBJECT = next(s for s, code in ipas_exam_pdf.SUBJECT_CODES.items() if code == 'L12')
L11_SUBJECT = next(s for s, code in ipas_exam_pdf.SUBJECT_CODES.items() if code == 'L11')
L12_META = {**META, 'subject': 'L12', 'exam_subject': '考科2', 'title': META['title'].replace(L11_SUBJECT, L12_SUBJECT)}


@pytest.mark.parametrize(('meta', 'what'), [
    (L12_META, None),
    ({**L12_META, 'exam_subject': '考科1'}, '考科：SOURCES 寫「考科1」，PDF 頁首是「考科2」'),
    ({**L12_META, 'title': META['title']}, '標題'),  # 考試名稱相同、只有科目那一段是第一科的
], ids=['matches', 'exam-subject-of-the-first-subject', 'title-with-the-first-subject'])
def test_the_second_subject_is_checked_the_same_way(meta, what):
    header = _header(L12_META)
    if what is None:
        R.check_official_header(SRC, meta, header)
    else:
        with pytest.raises(SystemExit, match=what):
            R.check_official_header(SRC, meta, header)


# --emit 把 PDF 的頁首記進擷取快照；不讀 PDF 的 --reassemble 與 CI 拿它核對 SOURCES。以前只有讀 PDF 時才比：
# 把 SOURCES 的標題或考試日期改錯（從上一場複製），再 --reassemble，工具測試與 preflight 全綠（審查實測）。
def test_extract_sources_records_the_header_of_an_official_source(monkeypatch, tmp_path):
    monkeypatch.setattr(R, 'SOURCES', {SRC: META})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.HEADER_READERS, 'ipas_exam_table', lambda path: _header())
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_exam_table', lambda path: [_question(1)])
    source = R.extract_sources(tmp_path)[SRC]
    assert list(source) == ['pdf_sha256', 'header', 'questions']
    assert source['header'] == dataclasses.asdict(_header())


@pytest.mark.parametrize(('change', 'what'), [
    ({'title': META['title'][:-len(L11_SUBJECT)].replace('第一次', '第二次')}, '標題'),
    ({'exam_date': '2110-05-17'}, '考試日期'),
    ({'session': '999-02'}, '場次'),
], ids=['title', 'exam-date', 'session'])
def test_assemble_checks_sources_against_the_header_in_the_snapshot(official_source, change, what):
    snapshot = copy.deepcopy(R.load_snapshot())
    snapshot[SRC] = _official_snapshot(official_source, **change)
    dataset = R.load_dataset()
    dataset['our_unique_items'] += [I.build_item(SRC, META, q) for q in official_source]
    with pytest.raises(SystemExit, match=f'{SRC} 的 PDF 頁首與 SOURCES 不符：{what}'):
        R.assemble(snapshot, dataset)


def test_assemble_needs_the_header_of_an_official_source(official_source):
    snapshot = copy.deepcopy(R.load_snapshot())
    snapshot[SRC] = {'pdf_sha256': META['sha256'], 'questions': official_source}
    dataset = R.load_dataset()
    dataset['our_unique_items'] += [I.build_item(SRC, META, q) for q in official_source]
    with pytest.raises(SystemExit, match=f'{SRC}：擷取快照沒有 PDF 的頁首'):
        R.assemble(snapshot, dataset)


def test_extract_sources_stops_on_a_header_that_disagrees(monkeypatch, tmp_path):
    extracted = []
    monkeypatch.setattr(R, 'SOURCES', {SRC: META})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.HEADER_READERS, 'ipas_exam_table', lambda path: _header(session='999-02'))
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_exam_table', lambda path: extracted.append(path) or [_question(1)])
    with pytest.raises(SystemExit, match='頁首與 SOURCES 不符：場次'):
        R.extract_sources(tmp_path)
    assert extracted == []


def test_an_official_source_whose_layout_has_no_header_reader_is_refused(monkeypatch, tmp_path):
    downloads = []
    monkeypatch.setattr(R, 'SOURCES', {SRC: {**META, 'layout': 'two_column'}})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    with pytest.raises(SystemExit, match="官方來源的版面 'two_column' 讀不到頁首"):
        R.extract_sources(tmp_path)
    assert downloads == []


def test_main_stops_on_a_header_that_disagrees_before_writing(official_source, monkeypatch, tmp_path):
    # 頁首不符就在擷取之前停（還沒讀題目）：兩者對調，照別一場抄的 SOURCES 報的是圖表題，真正的原因被蓋掉（第十二輪
    # 確認審查實測）
    dataset = tmp_path / 'integrated_dataset.json'
    original = json.dumps(_dataset(), ensure_ascii=False, indent=2)
    dataset.write_text(original, encoding='utf-8')
    monkeypatch.setattr(I, 'DATASET', dataset)
    monkeypatch.setattr(I, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setattr(I.ipas_exam_pdf, 'header', lambda path: _header(exam_date='2110-05-17'))
    extracted = []
    monkeypatch.setattr(I.ipas_exam_pdf, 'extract',
                        lambda path, **_: extracted.append(path) or copy.deepcopy(official_source))
    with pytest.raises(SystemExit, match='頁首與 SOURCES 不符：考試日期'):
        I.main([SRC, '--cache', str(tmp_path)])
    assert extracted == []
    assert dataset.read_text(encoding='utf-8') == original


# ── 兩個工具讀頁首用的就是 ipas_exam_pdf.header ───────────────────────────────────────────────────────────
#
# 上面的測試都把讀頁首的函式換掉，看不到工具實際怎麼讀。第十四到第十七輪確認審查實測，下面每一種以前整套全綠：
# HEADER_READERS 換成包一層、遇到某一種拒絕照樣讀頁首的函式，或照 SOURCES 組出頁首、完全不讀 PDF；在函式裡改寫
# 字典的一項或模組的屬性、把函式包一層；用 class、match 綁定同名的區域名稱，經由 [R][0]、object.__setattr__、
# [exec][0] 改寫，在讀頁首外面包 try/except 吞掉某一種拒絕；只在快取裡有 PDF 時照 SOURCES 組出頁首；把 try 放進
# if/else、另一支直接擷取，就地改寫 meta 的別名（|=），把 out 指到 meta 再改寫 —— 觸發條件寫成「快取的 PDF 通過
# sha256」（真跑時每一次都是），以前的行為測試替換了 load_pdf，從來沒進到這個狀態。真卷上，改在匯入工具那一側的照樣
# 寫進 50 題、標成錯的場次，改在 restore 那一側的讓 --emit 照樣完成。只釘一部分，就有別的寫法繞過，所以：
# 0. 整份釘住：兩個函式與比對用的 check_official_header，原始碼就是審查過的那一份（TOOL_SOURCES），實際執行的也就是
#    這段原始碼（雜湊讀的那一份檔案整個重新編譯，這個函式的 code 物件相同：被 git add -f 加進來、不核對原始碼的 .pyc
#    跑的是另一份程式，原始碼的雜湊照樣相符）；git 追蹤的檔案裡也沒有 .pyc（.pyc 裡模組層級的程式審不了）。改了就要照
#    下面三層重新審查讀頁首的路，在同一個 diff 裡更新雜湊 —— 看得見的決定。
# 1. 身分：HEADER_READERS 就是 ipas_exam_pdf.header 本身，兩個工具與測試用的是同一個 ipas_exam_pdf、同一個 restore
#    （匯入工具的 R），也就是 tools/ 裡的那幾個檔案；三個函式就是原本的函式，照一般的名稱解析執行（測試 import 的模組
#    本身的 globals、Python 的 builtins、預設值）。
# 2. 寫法：讀頁首與比對就是釘住的那一句，是唯一的 try 的第一句，例外處理就是 sys.exit；流進這一句的變數只在原本
#    那幾處綁定，這幾個模組層級的名字在函式裡不綁定（任何語法）；函式裡沒有巢狀的函式、類別、lambda、match、with、
#    import、global，不動態存取（vars、getattr、exec、dunder 屬性……），只改寫自己建的區域變數。更新雜湊之前，這幾條
#    說明審查要看什麼，更新之後也照樣檢查。
# 3. 行為：真的合成 PDF 放在快取裡，SOURCES 登記它真正的 sha256：load_pdf、header()、check_official_header 都照常跑
#    （真跑時就是這個狀態），只有擷取器換掉 —— 頁首與 SOURCES 任一欄不符，或 header() 在表格之前拒絕
#    （test_ipas_exam_pdf 的 HEADER_REFUSALS），兩個工具都在擷取之前以同一個訊息停下；相符時才走到擷取。
# 這三個函式以外的任何改動 —— 被呼叫的其他共用函式、模組層級的程式（包括 check_official_header 查的 EXAM_SUBJECT）、
# hook —— 這幾條測試看不到，交給 code review，與 header() 那條釘選測試的邊界相同。

TOOL_SOURCES = {  # 審查過的原始碼的 sha256（換行統一成 LF）：兩個工具讀頁首的函式，與比對用的 check_official_header
    'extract_sources': '73e659961a7909f76780f765a4cfa69528c239af2c76e7db6d3009ef065a8e6a',
    'main': 'e204e4f0ebb4c60497903ad3f77b62f792ddda1f71b3e604d5e5b92063cfe7a8',
    'check_official_header': 'ecb53c82afd1e6d049c5f2b3bfeee30f219c9b781c0151682058e8b088b29dcd',
}
DEFAULTS = {'extract_sources': (None, None), 'main': ((None,), None), 'check_official_header': (None, None)}  # 預設值
MODULE_NAMES = ('R', 'sys', 'ipas_exam_pdf', 'HEADER_READERS', 'check_official_header', 'SOURCES', 'EXTRACTORS')
DYNAMIC_ACCESS = ('vars', 'globals', 'locals', 'exec', 'eval', 'compile', '__import__', 'setattr', 'delattr', 'getattr',
           '__builtins__', 'breakpoint')
MUTATOR_METHODS = ('update', 'setdefault', 'pop', 'popitem', 'clear', 'append', 'extend', 'insert', 'remove', 'add',
            'discard', 'sort', 'reverse')
NESTED_SYNTAX = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda, ast.Match, ast.With, ast.AsyncWith,
          ast.Global, ast.Nonlocal, ast.Import, ast.ImportFrom)


def _function_tree(function):
    return ast.parse(textwrap.dedent(inspect.getsource(function))).body[0]


def _inner(function):
    tree = _function_tree(function)
    return tree, [node for node in ast.walk(tree) if node is not tree]


def _binds(node) -> list[str]:
    """node 綁定的名字（任何語法：指派、for、:=、del、參數、def／class、except as、match、import、global）。"""
    if isinstance(node, ast.Name) and not isinstance(node.ctx, ast.Load):
        return [node.id]
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name]
    if isinstance(node, (ast.ExceptHandler, ast.MatchAs, ast.MatchStar)):
        return [node.name] if node.name else []
    if isinstance(node, ast.MatchMapping):
        return [node.rest] if node.rest else []
    if isinstance(node, ast.arg):
        return [node.arg]
    if isinstance(node, ast.alias):
        return [(node.asname or node.name).split('.')[0]]
    if isinstance(node, (ast.Global, ast.Nonlocal)):
        return list(node.names)
    return []


def _binding_sites(tree, name) -> list[str]:
    """name 在函式裡被綁定的每一處：那一句（for 只寫開頭，參數寫〈參數〉，其他語法寫它的種類）。"""
    parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    found = []
    for node in ast.walk(tree):
        if name not in _binds(node):
            continue
        if isinstance(node, ast.arg):
            found.append('〈參數〉')
            continue
        while not isinstance(node, ast.stmt) and node in parents:
            node = parents[node]
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            found.append(ast.unparse(node))
        elif isinstance(node, (ast.For, ast.AsyncFor)):
            found.append(f'for {ast.unparse(node.target)} in {ast.unparse(node.iter)}')
        else:
            found.append(f'〈{type(node).__name__}〉')
    return sorted(found)


def _root(node):
    while isinstance(node, (ast.Subscript, ast.Attribute)):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def _calls(function, name):
    return [ast.unparse(node) for node in _inner(function)[1]
            if isinstance(node, ast.Call) and ast.unparse(node.func) == name]


def _uses(function, name):  # name 出現的每一處（連同它所在的那一層）
    tree, _ = _inner(function)
    parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    return sorted(ast.unparse(parents[node]) for node in ast.walk(tree)
                  if isinstance(node, ast.Name) and node.id == name)


def test_both_tools_read_the_header_with_the_parsers_own_function():
    assert R.HEADER_READERS == {'ipas_exam_table': ipas_exam_pdf.header}
    assert R.HEADER_READERS['ipas_exam_table'] is ipas_exam_pdf.header
    assert R.ipas_exam_pdf is I.ipas_exam_pdf is ipas_exam_pdf
    assert I.R is R  # 匯入工具叫的 R.check_official_header 就是下面釘住的那一個（換成另一個模組，雜湊照樣相符）
    # 模組的類別換成自訂的 __getattribute__，就能對測試交出真的 R、對 main 交出另一個（第二十二輪確認審查實測）
    assert type(I) is type(R) is types.ModuleType and vars(I)['R'] is R
    # 測試 import 到的就是工具自己的那幾個檔案：pytest 把 tools/tests/ 排在 tools/ 前面，在那裡放一份同名的副本，測試
    # 驗的就是副本，工具跑的卻是 tools/ 裡改過的那一份（第二十三輪確認審查實測）。模組自己報的 __file__ 可以偽造，所以
    # 也問 import 系統照 sys.path 會找到哪個檔案（第二十五輪確認審查實測）。只在測試行程裡改寫 import 機制的（預先放進
    # sys.modules、path hook、.pth）這裡看不到，由 test_the_tools_on_disk_stop_where_the_tested_ones_do 在另一個不跑 site
    # 的 Python 裡跑 tools/ 的檔案（第二十六、二十七輪確認審查實測）
    tools = Path(__file__).resolve().parents[1]
    for module in (R, I, ipas_exam_pdf):
        own = tools / f'{module.__name__}.py'
        assert Path(module.__file__).resolve() == own, module
        assert Path(importlib.machinery.PathFinder.find_spec(module.__name__, sys.path).origin).resolve() == own, module
    # 就是原本的函式，照一般的名稱解析執行：包一層的話，inspect 讀到的是被包的那一個的原始碼（functools.wraps 留下
    # __wrapped__）；同一個 code 配另一份命名空間（dict 的子類別、另一個字典、另一份 builtins、str 子類別的鍵）或預設值，
    # 函式裡的名字就指到別處，雜湊與 code 物件照樣相同（第二十二輪確認審查實測）。模組是測試 import 的那一個，不照函式
    # 自己說的 __module__ 找（改掉它、再登記一個假的模組，就指到別處 —— 第二十三輪確認審查實測）。與 header() 那條釘選
    # 測試同樣的條件
    for function, module in ((R.extract_sources, R), (I.main, I), (R.check_official_header, R)):
        assert function.__module__ == module.__name__ and sys.modules[module.__name__] is module, function
        assert Path(function.__code__.co_filename).resolve() == tools / f'{module.__name__}.py', function
        assert type(function) is types.FunctionType and not hasattr(function, '__wrapped__'), function
        assert function.__code__.co_name == function.__qualname__ == function.__name__, function
        assert vars(module)[function.__name__] is function and function.__closure__ is None, function
        assert function.__globals__ is vars(module) and type(function.__globals__) is dict, function
        assert function.__builtins__ is vars(builtins), function
        assert all(type(key) is str for namespace in (function.__globals__, function.__builtins__) for key in namespace)
        assert (function.__defaults__, function.__kwdefaults__) == DEFAULTS[function.__name__], function
    # 讀頁首的呼叫只有釘住的那一個；這幾個名字只出現在原本那幾處（別名、vars()、改寫都會多出一處）
    assert _calls(R.extract_sources, 'HEADER_READERS[layout]') == ['HEADER_READERS[layout](path)']
    assert _calls(R.extract_sources, 'check_official_header') == ['check_official_header(src_id, meta, header)']
    assert _calls(I.main, 'ipas_exam_pdf.header') == ['ipas_exam_pdf.header(path)']
    assert _calls(I.main, 'R.check_official_header') == [
        'R.check_official_header(src_id, meta, ipas_exam_pdf.header(path))']
    assert _uses(R.extract_sources, 'HEADER_READERS') == ['HEADER_READERS[layout]', 'layout not in HEADER_READERS']
    assert _uses(R.extract_sources, 'check_official_header') == ['check_official_header(src_id, meta, header)']
    assert _uses(I.main, 'ipas_exam_pdf') == ['ipas_exam_pdf.extract', 'ipas_exam_pdf.header']
    assert _uses(R.extract_sources, 'ipas_exam_pdf') == _uses(I.main, 'HEADER_READERS') == []


def _source_sha256(function) -> str:
    return hashlib.sha256(inspect.getsource(function).replace('\r\n', '\n').encode('utf-8')).hexdigest()


@pytest.mark.parametrize('function', [R.extract_sources, I.main, R.check_official_header],
                         ids=['restore', 'import', 'compare'])
def test_the_header_path_runs_the_reviewed_code(function):
    # 整份釘住：只釘一部分，第十五到第十七輪都在沒釘到的地方找到繞法；比對用的 check_official_header 也釘（放寬它，
    # 例如遇到真的 iPAS 網址就不比，下面三層都看不到 —— 第十八輪確認審查實測）
    assert _source_sha256(function) == TOOL_SOURCES[function.__name__], (
        f'{function.__module__}.{function.__name__} 改了：照這一節開頭的三層重新審查讀頁首的路，'
        f'再把 TOOL_SOURCES 改成 {_source_sha256(function)}')
    # 執行的就是這段原始碼：雜湊讀的那一份檔案（inspect 照 code 記的檔名經 linecache 讀）整個重新編譯，這個函式的
    # code 物件整個相同（bytecode、常數、例外表……）。被 git add -f 加進來、不核對原始碼的 .pyc（unchecked-hash）跑的是
    # 另一份程式，原始碼的雜湊照樣相符（第十八輪確認審查實測）；讀的是同一份，不經 module.__file__ 或 loader，改指它們
    # 就岔不開（第二十二輪確認審查實測）。編譯整個檔案、不只編譯這個函式：模組層級 import 進來的名字（sys），呼叫它的
    # 屬性時 bytecode 不同
    lines, _ = inspect.findsource(function)
    compiled = next(const for const in compile(''.join(lines), function.__code__.co_filename, 'exec',
                                               dont_inherit=True).co_consts
                    if inspect.iscode(const) and const.co_name == function.__name__
                    and const.co_firstlineno == function.__code__.co_firstlineno)
    assert function.__code__ == compiled, f'{function.__module__}.{function.__name__} 執行的不是它的原始碼（快取的 .pyc？）'


def _tracked_files(root):
    """root 底下 git 追蹤的檔案（相對於 root），或跳過的原因（沒有清單可查）。有沒有 repo、是哪一個，照 git 自己找的
    方式：從 root 往上找，環境裡指定 repo 的 GIT_DIR、GIT_WORK_TREE 不算。只有 git 說「不是 repo」才跳過；git 讀不了
    找到的 repo（擁有者不同、config 或 index 壞了）是錯誤、不是跳過，帶著 git 自己的說明（第二十三、二十四、二十七輪
    確認審查實測：git 出錯一律回 128，config 壞了也是）。"""
    if not any((folder / '.git').exists() for folder in (root, *root.parents)):  # 沒有裝 git 也照樣跳過
        return 'repo 根目錄與外層都沒有 .git（例如解開的原始碼包）：沒有追蹤清單可查'
    env = {key: value for key, value in os.environ.items() if key not in ('GIT_DIR', 'GIT_WORK_TREE')}
    # git 的說明照語系翻譯：定成 C 才比得了。擁有者不同時 git 說的是 dubious ownership，不是「不是 repo」
    top = subprocess.run(['git', 'rev-parse', '--show-toplevel'], cwd=root, env={**env, 'LC_ALL': 'C'},
                         capture_output=True)
    # 往上都找不到才是「(or any ...)」；.git 檔指到不存在的目錄是「not a git repository: <路徑>」，那是讀不了（第二十八輪
    # 確認審查實測：主 repo 搬走之後，linked worktree 與 submodule 都是這樣）。git 2.16 以前寫的是大寫的 Not
    if top.returncode == 128 and top.stderr.lower().startswith(b'fatal: not a git repository (or any '):
        return 'git 從這裡往上找不到 repo（例如空的 .git，或 GIT_CEILING_DIRECTORIES 擋住外層）：沒有追蹤清單可查'
    assert top.returncode == 0, f'git 找 repo 失敗：{top.stderr.decode(errors="replace").strip()}'
    listed = subprocess.run(['git', 'ls-files', '-z'], cwd=root, env=env, stdout=subprocess.PIPE,
                            check=True).stdout.split(b'\0')
    # 被收進別的 repo 的子目錄：外層的 repo 追蹤這些檔案，就照樣查（第二十四輪確認審查實測）
    if Path(os.fsdecode(top.stdout.rstrip(b'\n'))).resolve() != root.resolve() \
            and b'tools/restore_from_source_pdf.py' not in listed:
        return '外層的 repo 沒有追蹤這些檔案：沒有追蹤清單可查'
    return listed


def test_no_bytecode_is_tracked():
    # .pyc 裡的程式審不了，連模組層級的也是：同一個 code 配另一份命名空間、改指 __file__ 或 loader，上面幾條未必
    # 看得到（第二十二輪確認審查實測）。所以 git 追蹤的檔案裡一個 .pyc、__pycache__ 都不收（要 git add -f 才加得進來）
    listed = _tracked_files(Path(__file__).resolve().parents[2])
    if isinstance(listed, str):
        pytest.skip(listed)
    assert b'tools/restore_from_source_pdf.py' in listed  # 真的列出了這個 repo 的檔案
    assert [name for name in listed if name.endswith(b'.pyc') or b'__pycache__' in name.split(b'/')] == []


# 版面裡的 git 不讀系統與使用者的設定（例如使用者層級的 safe.directory = * 會關掉擁有者的檢查、全域的 gitignore 會讓
# git add 漏掉檔案：第二十七輪確認審查實測）
QUIET_CONFIG = {'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull}


def _git_setup(folder, *args):  # 建版面用的 git：外面的 GIT_* 不算（在 git 的 hook 裡跑測試時，GIT_DIR 指到真的 repo）
    env = {**{key: value for key, value in os.environ.items() if not key.startswith('GIT_')}, **QUIET_CONFIG}
    subprocess.run(['git', *args], cwd=folder, env=env, check=True, capture_output=True)


def _tools_tree(folder):  # 一棵只有一個工具檔案的樹
    (folder / 'tools').mkdir(parents=True)
    (folder / 'tools' / 'restore_from_source_pdf.py').write_text('', encoding='utf-8')
    return folder


def _vendored(place, track=True):  # 收進外層 repo 的子目錄 outer/vendor
    root = _tools_tree(place / 'outer' / 'vendor')
    _git_setup(place / 'outer', 'init', '-q')
    if track:
        _git_setup(place / 'outer', 'add', '-A')
    return root


def _own_repo(place, track=True):
    root = _tools_tree(place / 'repo')
    _git_setup(root, 'init', '-q')
    if track:
        _git_setup(root, 'add', '-A')
    return root, {}


def _own_repo_not_tracking(place):  # 根目錄自己的 repo：沒有追蹤也照樣讀清單（測試再查清單裡有沒有那個檔案）
    return _own_repo(place, track=False)


def _archive(place):  # 解開的原始碼包
    return _tools_tree(place / 'archive'), {}


def _archive_without_git(place):  # 而且沒有裝 git：照樣跳過
    (place / 'empty-bin').mkdir()
    return _tools_tree(place / 'archive'), {'PATH': str(place / 'empty-bin')}


def _empty_git_above(place):  # 外層有一個不是 repo 的空 .git
    (place / 'outer' / '.git').mkdir(parents=True)
    return _tools_tree(place / 'outer' / 'vendor'), {}


def _ceiling(place):  # GIT_CEILING_DIRECTORIES 擋住追蹤這棵樹的外層 repo
    return _vendored(place), {'GIT_CEILING_DIRECTORIES': str(place / 'outer')}


def _vendored_untracked(place):
    return _vendored(place, track=False), {}


def _vendored_tracked(place):
    return _vendored(place), {}


def _relative_git_dir(place):  # 環境裡的 GIT_DIR 是相對路徑
    return _vendored(place), {'GIT_DIR': '.git'}


def _git_dir_of_the_outer_repo(place):  # GIT_DIR 指到追蹤這棵樹的外層 repo，外層追蹤一個 .pyc
    root = _vendored(place)
    (root / 'tools' / 'stray.pyc').write_bytes(b'')
    _git_setup(place / 'outer', 'add', '-f', 'vendor/tools/stray.pyc')
    return root, {'GIT_DIR': str(place / 'outer' / '.git')}


def _git_work_tree_of_the_parent(place):  # GIT_WORK_TREE 指到外層 repo 的上一層：git 列不出這棵樹的檔案
    return _vendored(place), {'GIT_WORK_TREE': str(place)}


def _different_owner(place):  # 外層的擁有者不同（git 測試用的開關，與真的換擁有者相同：dubious ownership）
    return _vendored(place), {'GIT_TEST_ASSUME_DIFFERENT_OWNER': '1'}


def _dangling_gitfile(place):  # 根目錄的 .git 檔指到不存在的目錄（主 repo 搬走了）：git 說的也是 not a git repository
    root = _tools_tree(place / 'repo')
    (root / '.git').write_text(f'gitdir: {place / "moved"}' + chr(10), encoding='utf-8')
    return root, {}


def _broken_config(place):  # 外層的 config 壞了：git 找得到 repo、讀不了它（也是回 128，不是「沒有 repo」）
    root = _vendored(place)
    with (place / 'outer' / '.git' / 'config').open('a', encoding='utf-8') as config:
        config.write('[core' + chr(10))
    return root, {}


def _broken_index(place):  # 外層的 index 壞了（截短的 index git 照樣讀、只讀出殘缺的路徑，所以整個換掉）
    root = _vendored(place)
    (place / 'outer' / '.git' / 'index').write_bytes(b'not an index file')
    return root, {}


TRACKED = [b'tools/restore_from_source_pdf.py']


@pytest.mark.parametrize(('layout', 'expected'), [
    (_own_repo, TRACKED),
    (_own_repo_not_tracking, []),
    (_archive, 'repo 根目錄與外層都沒有 .git'),
    (_archive_without_git, 'repo 根目錄與外層都沒有 .git'),
    (_empty_git_above, 'git 從這裡往上找不到 repo'),
    (_ceiling, 'git 從這裡往上找不到 repo'),
    (_vendored_untracked, '外層的 repo 沒有追蹤這些檔案'),
    (_vendored_tracked, TRACKED),
    (_relative_git_dir, TRACKED),
    (_git_dir_of_the_outer_repo, [*TRACKED, b'tools/stray.pyc']),
    (_git_work_tree_of_the_parent, TRACKED),
    (_different_owner, 'error'),
    (_dangling_gitfile, 'error'),
    (_broken_config, 'error'),
    (_broken_index, 'error'),
], ids=['own-repo', 'own-repo-not-tracking', 'archive', 'archive-without-git', 'empty-git-above', 'ceiling',
        'vendored-untracked', 'vendored', 'relative-git-dir', 'git-dir-of-the-outer-repo', 'git-work-tree-of-the-parent',
        'different-owner', 'dangling-gitfile', 'broken-config', 'broken-index'])
def test_the_tracked_files_are_found_the_way_git_finds_the_repo(monkeypatch, layout, expected):
    # 有沒有 repo、是哪一個 repo，照 git 自己找的方式：Python 看 .git 存不存在，與 git 不一致（第二十六輪確認審查實測：
    # 外層有空的 .git、GIT_CEILING_DIRECTORIES、相對路徑的 GIT_DIR 時轉紅，GIT_DIR 指到外層時漏查追蹤的 .pyc）。
    # 版面放在系統的暫存目錄：pytest 的 basetemp 可以設在 repo 裡；暫存目錄本身在 repo 裡（TMPDIR）就建不出外層沒有 repo
    # 的版面（第二十七輪確認審查實測）
    with tempfile.TemporaryDirectory() as folder:
        place = Path(folder).resolve()
        if any((above / '.git').exists() for above in (place, *place.parents)):
            pytest.skip(f'暫存目錄 {place} 在一個 repo 裡（TMPDIR）：建不出外層沒有 repo 的版面')
        for key in [key for key in os.environ if key.startswith('GIT_')]:  # 在 git 的 hook 裡跑測試時外面帶進來的
            monkeypatch.delenv(key)
        # 使用者與系統層級的設定故意寫成會讓這些版面出錯的樣子（safe.directory = * 關掉擁有者的檢查，全域的 gitignore 讓
        # git add 漏掉 .py）：版面裡的 git 都不讀它（QUIET_CONFIG）
        home = place / 'home'
        home.mkdir()
        (home / 'ignore').write_text('*.py', encoding='utf-8')
        _git_setup(home, 'config', '--file', '.gitconfig', 'safe.directory', '*')
        _git_setup(home, 'config', '--file', '.gitconfig', 'core.excludesFile', str(home / 'ignore'))
        monkeypatch.setenv('HOME', str(home))
        monkeypatch.setenv('XDG_CONFIG_HOME', str(home / '.config'))
        monkeypatch.setenv('GIT_CONFIG_SYSTEM', str(home / '.gitconfig'))  # 系統層級的也一樣
        # git 的說明照語系翻譯（「致命錯誤: 不是一個 git 版本庫」）：_tracked_files 自己把語系定成 C，這裡故意換成中文
        # （沒有這個語系的機器上 git 照樣說英文）
        monkeypatch.setenv('LC_ALL', 'zh_TW.UTF-8')
        monkeypatch.setenv('LANGUAGE', 'zh_TW')
        root, env = layout(place)
        for key, value in {**QUIET_CONFIG, **env}.items():
            monkeypatch.setenv(key, value)
        if expected == 'error':  # git 讀不了找到的 repo：錯誤，不是跳過
            with pytest.raises((subprocess.CalledProcessError, AssertionError)):
                _tracked_files(root)
        elif isinstance(expected, str):
            assert _tracked_files(root).startswith(expected)
        else:
            assert [name for name in _tracked_files(root) if name] == expected


@pytest.mark.parametrize(('message', 'expected'), [
    ('fatal: Not a git repository (or any of the parent directories): .git', 'git 從這裡往上找不到 repo'),
    ('fatal: Not a git repository: /moved', 'error'),
], ids=['not-found', 'dangling-gitfile'])
def test_the_wording_of_git_before_2_17_is_read_the_same_way(monkeypatch, tmp_path, message, expected):
    # git 2.16 以前的說明是大寫的 Not（第二十九輪確認審查實測：v2.7.0 到 v2.16.0 的 setup.c）。git 換成照那個版本回答的
    # subprocess.run（不寫可執行檔：暫存目錄可能不能執行，第三十輪確認審查實測）；.git 要在，Python 那一關才放行
    root = _tools_tree(tmp_path / 'repo')
    (root / '.git').mkdir()
    said = subprocess.CompletedProcess(['git'], 128, b'', message.encode() + chr(10).encode())
    monkeypatch.setattr(subprocess, 'run', lambda *args, **kwargs: said)
    if expected == 'error':
        with pytest.raises(AssertionError, match='git 找 repo 失敗'):
            _tracked_files(root)
    else:
        assert _tracked_files(root).startswith(expected)


@pytest.mark.parametrize(('function', 'first', 'variables'), [
    (R.extract_sources,
     "if meta.get('kind') == 'official_exam':\n    header = HEADER_READERS[layout](path)\n"
     '    check_official_header(src_id, meta, header)',
     {'src_id': ['for (src_id, meta) in SOURCES.items()'], 'meta': ['for (src_id, meta) in SOURCES.items()'],
      'layout': ["layout = meta.get('layout', 'two_column')"], 'path': ["path = cache / f'{src_id}.pdf'"],
      'header': ['header = HEADER_READERS[layout](path)', 'header = None'], 'cache': ['〈參數〉']}),
    (I.main, 'R.check_official_header(src_id, meta, ipas_exam_pdf.header(path))',
     {'src_id': ['for src_id in sources', 'for src_id in sources'],
      'meta': ['meta = R.SOURCES.get(src_id)', 'meta = R.SOURCES[src_id]'],
      'path': ["path = cache / f'{src_id}.pdf'"], 'cache': ['cache = Path(a.cache)']}),
], ids=['restore', 'import'])
def test_the_header_is_read_and_compared_in_one_pinned_statement(function, first, variables):
    # 唯一的 try 的第一句就是讀頁首與比對，例外處理就是中止（包一層 try/except 吞掉某一種拒絕、條件式的 sys.exit 都不行）；
    # 流進這一句的變數只在原本那幾處綁定（照 PDF 的頁首改寫 meta，比對就永遠相符）；模組層級的名字在函式裡不綁定
    tree, nodes = _inner(function)
    tries = [node for node in nodes if isinstance(node, (ast.Try, ast.TryStar))]
    assert len(tries) == 1 and not tries[0].orelse and not tries[0].finalbody
    assert ast.unparse(tries[0].body[0]) == first
    assert [ast.unparse(handler) for handler in tries[0].handlers] == [
        "except ValueError as e:\n    sys.exit(f'✗ {src_id}: {e}')"]
    assert {name: _binding_sites(tree, name) for name in variables} == variables
    assert sorted({name for node in nodes for name in _binds(node)} & {*MODULE_NAMES, *DYNAMIC_ACCESS}) == []


@pytest.mark.parametrize(('function', 'own'), [(R.extract_sources, {'out'}), (I.main, set())],
                         ids=['restore', 'import'])
def test_the_tools_leave_no_other_way_to_the_header(function, own):
    # 沒有巢狀的函式、類別、lambda、match、with、import、global；不動態存取（dunder 屬性也算）；屬性與下標的指派、
    # 刪除與 update 之類只用在函式自己建的區域變數（根不是名字的也算違規）
    _, nodes = _inner(function)
    assert [type(node).__name__ for node in nodes if isinstance(node, NESTED_SYNTAX)] == []
    assert [ast.unparse(node) for node in nodes if isinstance(node, ast.Name) and node.id in DYNAMIC_ACCESS
            or isinstance(node, ast.Attribute) and node.attr.startswith('__') and node.attr.endswith('__')] == []
    assert [ast.unparse(node) for node in nodes if isinstance(node, (ast.Attribute, ast.Subscript))
            and not isinstance(node.ctx, ast.Load) and _root(node) not in own] == []
    assert [ast.unparse(node) for node in nodes if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr in MUTATOR_METHODS and _root(node.func.value) not in own] == []


class _Extracted(Exception):
    """擷取器被叫到了：頁首那一關沒有擋下。"""


def _extraction_reached(*args, **kwargs):
    raise _Extracted(args)


def _real_meta(pdf, **change):
    """與 PDF 真正的頁首（ipas_exam_pdf.header）相符的 SOURCES 登記；change 改掉其中幾欄。"""
    real = ipas_exam_pdf.header(pdf)
    return {**META, 'title': real.title + real.subject, 'session': real.session, 'exam_date': real.exam_date,
            'subject': real.subject_code, 'exam_subject': R.EXAM_SUBJECT[real.subject_code], **change}


def _both_tools(monkeypatch, tmp_path, pdf, meta) -> list[str]:
    """真的 PDF 放進快取，SOURCES 登記它真正的 sha256：load_pdf、header()、check_official_header 都照常跑（真跑時就是
    這個狀態），只有擷取器換掉。restore 的 extract_sources 與匯入工具各跑一次，回傳各自怎麼結束。"""
    cache = tmp_path / 'cache'
    cache.mkdir()
    data = pdf.read_bytes()
    (cache / f'{SRC}.pdf').write_bytes(data)
    monkeypatch.setattr(R, 'SOURCES', {SRC: {**meta, 'sha256': hashlib.sha256(data).hexdigest()}})
    monkeypatch.setitem(R.EXPECTED_QUESTION_COUNT, SRC, 2)
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_exam_table', _extraction_reached)
    monkeypatch.setattr(ipas_exam_pdf, 'extract', _extraction_reached)
    ends = []
    for run in (lambda: R.extract_sources(cache), lambda: I.main([SRC, '--cache', str(cache)])):
        try:
            run()
        except SystemExit as stopped:
            ends.append(str(stopped.code))
        except _Extracted:
            ends.append('走到擷取')
        else:
            ends.append('沒有停')
    return ends


def test_both_tools_reach_the_extraction_when_the_real_header_agrees(monkeypatch, tmp_path):
    exam = samples._two_page_exam(tmp_path)
    assert _both_tools(monkeypatch, tmp_path, exam, _real_meta(exam)) == ['走到擷取'] * 2


@pytest.mark.parametrize(('field', 'value', 'what'), [
    ('session', '115-02', '場次'), ('exam_date', '2026-08-15', '考試日期'), ('subject', 'L12', '科目'),
    ('exam_subject', '考科2', '考科'),
    ('title', '115 年第二次淨零碳規劃管理師-初級能力鑑定【公告試題】第一科：淨零碳規劃管理基礎概論', '標題'),
])
def test_both_tools_stop_when_the_real_header_disagrees_with_sources(monkeypatch, tmp_path, field, value, what):
    # 這個 CL 要擋的情境走真的路徑：從上一場複製一份 SOURCES、漏改一欄（第十六輪確認審查實測：只在快取裡有 PDF 時
    # 照 SOURCES 組出頁首，以前整套全綠）
    exam = samples._two_page_exam(tmp_path)
    right = _real_meta(exam)
    wrong = f'✗ {SRC} 的 PDF 頁首與 SOURCES 不符：{what}：SOURCES 寫「{value}」，PDF 頁首是「{right[field]}」。'
    assert _both_tools(monkeypatch, tmp_path, exam, {**right, field: value}) == [wrong] * 2


@pytest.mark.parametrize('make', samples.HEADER_REFUSALS.values(), ids=samples.HEADER_REFUSALS.keys())
def test_both_tools_stop_with_the_headers_own_refusal_before_extracting(monkeypatch, tmp_path, make):
    # header() 在表格之前拒絕的每一種樣本：兩個工具都以 header() 的訊息停下，擷取器一次都沒叫到（第十六輪確認審查
    # 實測：在函式裡把讀頁首包一層、吞掉某一種拒絕，以前整套全綠）
    for folder in ('sample', 'clean'):
        (tmp_path / folder).mkdir()
    pdf = make(tmp_path / 'sample')
    with pytest.raises(ValueError) as refused:
        ipas_exam_pdf.header(pdf)
    meta = _real_meta(samples._two_page_exam(tmp_path / 'clean'))
    assert _both_tools(monkeypatch, tmp_path, pdf, meta) == [f'✗ {SRC}: {refused.value}'] * 2


# 子行程跑的程式：不經 pytest，照 CLI 的樣子從 tools/ 的檔案執行一個工具（每一個工具、每一份樣本各開一個新的子行程，
# cwd 是 tools/ 的上一層：與照 AGENTS.md 從 repo 根目錄執行的 CLI 相同），像 _both_tools 一樣只換掉擷取器。
# - -S 不跑 site，venv 的 site-packages 不在 sys.path 上：照 sys.executable 的位置自己接上（venv 是 python 所在目錄的
#   上一層，與 site.venv() 相同；不解析連結，venv 的 python 是指到別處的連結；不是 venv 的直譯器要從它自己的 bin/
#   執行），不向測試行程拿（只在測試行程生效的改動就伸得進來：第二十八輪確認審查實測），也不看 pyvenv.cfg 在哪（在
#   bin/ 放一份，以前就找錯地方、整條跳過：第二十九輪確認審查實測）。接不上相依就失敗，不跳過。
# - 把 tools/ 放到最前面之前，tools/ 頂層的每一項都要在名單裡：登記的工具（TOOL_MODULES）的 .py、tests/、
#   __pycache__/、pyproject.toml、uv.lock，點開頭的不算；登記的也不准與標準函式庫（任何平台的）或 venv 裡的同名。
#   CLI 啟動時 tools/ 就在最前面，同名的換掉別處的；這裡與 pytest 已經先載入（或找過）不少模組，同名的檔案在這兩處
#   換不掉。逐項比對、不照本機的副檔名推名字（第二十九到三十一輪確認審查實測：tools/re.py、tools/pdfplumber/、
#   tools/nt.py、tools/nt/，Windows 才認的 re.pyw）。
# - 工具照 CLI 執行（as_cli）：新的 __main__ 模組，命名空間照直譯器啟動時建的 __main__（就是這個程式的，在它定義任何
#   名字之前複製），加上 CLI 給腳本的 __file__、__cached__ 與 SourceFileLoader；原始碼照 CLI 解碼（BOM、編碼宣告）；
#   執行之前不 import 任何工具，所以模組裡分辨怎麼執行的寫法（__cached__、函式的 __module__、__annotations__、
#   sys.modules 裡有沒有 restore、cwd）在這裡看到的與 CLI 相同（第三十、三十一輪確認審查實測）。樣本在最後一段
#   （if __name__ == '__main__'）之前換進命名空間：restore 換 SOURCES 與擷取器，再照 --verify 跑完；匯入工具換它
#   import 的 restore（R）的 SOURCES 與擷取器、ipas_exam_pdf 的擷取器。兩個工具會寫的檔案（題庫、快照、manifest）
#   都改指暫存的資料夾（那裡沒有檔案）：真的 repo 一個都不寫（第三十二輪確認審查實測：放寬成走 R.EXTRACTORS 的匯入
#   工具真的擷取，題數再對得上就寫進真的題庫）。把自己的旗標、三個時間點（執行工具之前、最後一段之前、跑完之後）的隔離狀
#   態、工具第一行之前已經載入的標準函式庫以外的模組、行程狀態（FINGERPRINT：工具的第一行之前、最後一段之前、跑完之後各
#   一份，與 CLI 比）、樣本換進去時改了哪些行程狀態、兩個工具會寫的路徑、替身換上了沒有，與怎麼結束寫進 JSON；要比哪些、
#   該有幾項，由 _on_disk 照工具決定
# 指紋：子行程與 CLI 逐項比的這幾項行程狀態，工具看得到、pytest 或子行程可能改到的（第三十七輪確認審查實測：子行程頂層開
# faulthandler、或樣本裡加一條 warnings 的 always，工具到呼叫時才看這些放寬，整套全綠、真的 CLI 照收；第三十八輪：同樣兩
# 行改放在 as_cli 裡第一次記錄之後、或 main() 之前，以及頂層改 stdout 的 write_through、pdfminer 的 logger、socket 的逾
# 時，也一樣；第三十九輪：替 pdfminer 的 logger 加 NullHandler、關掉 stdin、設 alarm、在頂層照 restore 的寫法改 stdout
# 的 errors，也一樣；第四十輪：C 層的 faulthandler 計時器、rlimit、nice、logging.lastResort、關掉檔案描述子 0，也一樣；
# 第四十一輪：RLIMIT_FSIZE、可用的 CPU、擋下的訊號、排程的策略、自己開一個 session，也一樣）。子行程在工具的第一行之前、
# 最後一段之前、跑完之後各取一次，_on_disk 用同一個 venv 直接跑 CLI 取一次（-E：與子行程的 -I 一樣不讀 PYTHON* 環境變數；
# stdout、stderr 與子行程一樣接到 pipe），逐項比；樣本換進去前後也比。一項一個鍵（例如 stdout.closed）：表格的每一欄
# （設過的 logger 的六欄、warnings 的 filter 的五欄、執行緒的名字與 daemon）、固定的每一列（每一個訊號、每一種資源上限的
# 軟硬兩個、gc 的三代）、合在一起的值的每一部分（串流的型別與是不是原本那一個、編碼與 errors）都各是一個鍵，每一個鍵都有
# 必擋的測試（FINGERPRINT_ATTACKS：子行程在頂層改那一項，比對要紅、而且點名那一項 —— CLI 參考與子行程用同一份
# FINGERPRINT，拿掉其中一項兩邊一起少，比對照樣相等，第四十輪確認審查實測：只剩 sys.path[0] 也整套全綠；第四十一輪：一張
# 表只配一種改法時，拿掉 logger 的 level 一欄、資源上限只記 RLIMIT_CPU，也整套全綠）。工具自己不改這幾項，三次都要與 CLI
# 相同 —— 只有 stdout、stderr 的 encoding 與 errors 只在工具的第一行之前比（first，之後 restore 的模組層自己改；stdin 的
# 每一次都比），相依 import 時自己設的 logger 照它設的樣子不算（LIBRARY_LOGGERS）。sys.path 的第一項是腳本所在的資料夾
# （CLI）或 tools/（子行程一律放 tools/），另外比；site 加的 builtins 不比；檔案描述子只比 0 到 2 指向哪一種檔案。沒列在
# 這裡的行程狀態，一次記錄之後才設、下一次記錄之前就還原或被工具自己蓋掉的（例如 catch_warnings 只包住工具的模組層或只
# 包住最後一段；as_cli 裡第一次記錄之後改 stdout 的 errors，隨後被 restore 的模組層蓋掉），以及第一次記錄之後、樣本以外
# 才改 stdout、stderr 的編碼（例如 main() 之前改；樣本裡改的由快照擋下），這裡看不到（邊界清單）
FINGERPRINT = '''
def fingerprint(first=False):
    import builtins, faulthandler, gc, locale, logging, os, signal, socket, sys, threading, warnings
    try:
        import resource
    except ImportError:  # Windows 沒有
        resource = None

    def fd_type(fd):  # 檔案描述子：關掉了（None），或指向哪一種檔案（st_mode 的檔案類型）
        try:
            return os.fstat(fd).st_mode >> 12
        except OSError:
            return None

    def name_of(value):
        return f'{getattr(value, "__module__", None)}.{getattr(value, "__qualname__", type(value).__qualname__)}'

    def handler(number):  # 那個訊號怎麼處理：SIG_DFL、SIG_IGN，或處理函式的名字
        value = signal.getsignal(number)
        return getattr(value, 'name', None) or name_of(value)

    # 相依 import 時自己設的 logger，照它設的樣子：charset_normalizer 加一個 NullHandler（pdfminer import 它；只在跑完之後
    # 那一次出現）。名單外的 logger、名單內的其他設定照比（第三十九輪確認審查實測：所有 NullHandler 都不算時，子行程替
    # pdfminer 的 logger 加一個，整套全綠、真的 CLI 照收）
    LIBRARY_LOGGERS = [['charset_normalizer', 0, ['logging.NullHandler'], True, False, 0]]

    def configured(logger):  # 設過的 logger：與剛建立的不同，也不是相依自己設的樣子
        state = [logger.name, logger.level, [name_of(handler) for handler in logger.handlers], logger.propagate,
                 logger.disabled, len(logger.filters)]
        if state not in [[logger.name, 0, [], True, False, 0], *LIBRARY_LOGGERS]:
            return state
    def timer(which):  # 那個計時器有沒有在跑（Windows 沒有 getitimer）
        return signal.getitimer(getattr(signal, which))[0] > 0 if hasattr(signal, 'getitimer') else None
    root, umask = logging.getLogger(), os.umask(0o077)
    os.umask(umask)
    loggers = sorted(filter(None, (configured(logger) for logger in logging.root.manager.loggerDict.values()
                                   if isinstance(logger, logging.Logger))))
    filters = [[f[0], getattr(f[1], 'pattern', f[1]), getattr(f[2], '__name__', None), getattr(f[3], 'pattern', f[3]), f[4]]
               for f in warnings.filters]
    threads = sorted([thread.name, thread.daemon] for thread in threading.enumerate())
    state = {  # 一項一個鍵（表格的每一欄、固定的每一列各一個），每一個鍵都有必擋的改法（FINGERPRINT_ATTACKS）
        'sys.path[0]': sys.path[0], 'sys.path': sys.path[1:],
        'sys.excepthook': sys.excepthook is sys.__excepthook__, 'sys.displayhook': sys.displayhook is sys.__displayhook__,
        'sys.unraisablehook': sys.unraisablehook is sys.__unraisablehook__,
        'sys.breakpointhook': sys.breakpointhook is sys.__breakpointhook__,
        'threading.excepthook': threading.excepthook is threading.__excepthook__,
        'sys.gettrace': sys.gettrace() is None, 'sys.getprofile': sys.getprofile() is None,
        'threading.gettrace': threading.gettrace() is None, 'threading.getprofile': threading.getprofile() is None,
        'stdin.encoding': getattr(sys.stdin, 'encoding', None), 'stdin.errors': getattr(sys.stdin, 'errors', None),
        'sys.getrecursionlimit': sys.getrecursionlimit(), 'sys.getswitchinterval': sys.getswitchinterval(),
        'sys.get_int_max_str_digits': sys.get_int_max_str_digits(), 'sys.getfilesystemencoding': sys.getfilesystemencoding(),
        'sys.tracebacklimit': getattr(sys, 'tracebacklimit', None), 'gc.isenabled': gc.isenabled(),
        **{f'gc.get_threshold[{generation}]': value for generation, value in enumerate(gc.get_threshold())},
        'socket.getdefaulttimeout': socket.getdefaulttimeout(),
        'os.umask': umask, 'signal.ITIMER_REAL': timer('ITIMER_REAL'), 'signal.ITIMER_VIRTUAL': timer('ITIMER_VIRTUAL'),
        'signal.ITIMER_PROF': timer('ITIMER_PROF'), 'locale': locale.setlocale(locale.LC_ALL),
        'threading.enumerate name': [name for name, _ in threads],
        'threading.enumerate daemon': [daemon for _, daemon in threads],
        **{f'warnings.filters {column}': [f[i] for f in filters]
           for i, column in enumerate(['action', 'message', 'category', 'module', 'lineno'])},
        'warnings.showwarning': name_of(warnings.showwarning), 'warnings.formatwarning': name_of(warnings.formatwarning),
        'faulthandler': faulthandler.is_enabled(), 'logging root level': root.level,
        'logging root handlers': [name_of(handler) for handler in root.handlers], 'logging root filters': len(root.filters),
        'logging.disable': logging.root.manager.disable, 'logging.getLoggerClass': name_of(logging.getLoggerClass()),
        'logging.lastResort': name_of(logging.lastResort),
        'logging.lastResort level': getattr(logging.lastResort, 'level', None),
        **{f'loggers {column}': [row[i] for row in loggers]
           for i, column in enumerate(['name', 'level', 'handlers', 'propagate', 'disabled', 'filters'])},
        **{f'signal {int(number)}': handler(number) for number in signal.valid_signals()},
        'builtins': sorted([name, name_of(value)] for name, value in vars(builtins).items()
                           if name not in {'exit', 'quit', 'help', 'copyright', 'credits', 'license'}),
        'environ': sorted(os.environ.items()),
        'cwd': os.getcwd(),
        # 行程本身：OS 的執行緒數（Linux；C 層的 faulthandler 計時器也是一條）、排程的優先序與策略、可用的 CPU、主執行緒
        # 擋下的訊號、在哪一個 session 與行程群組、每一種資源上限的軟硬兩個
        'os threads': len(os.listdir('/proc/self/task')) if os.path.isdir('/proc/self/task') else None,
        'os.getpriority': os.getpriority(os.PRIO_PROCESS, 0) if hasattr(os, 'getpriority') else None,
        'os.sched_getscheduler': os.sched_getscheduler(0) if hasattr(os, 'sched_getscheduler') else None,
        'os.sched_getaffinity': sorted(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else None,
        'signal.pthread_sigmask': (sorted(int(number) for number in signal.pthread_sigmask(signal.SIG_BLOCK, []))
                                   if hasattr(signal, 'pthread_sigmask') else None),
        'os.getsid': os.getsid(0) if hasattr(os, 'getsid') else None,
        'os.getpgrp': os.getpgrp() if hasattr(os, 'getpgrp') else None,
        **({f'resource.{name} {which}': resource.getrlimit(getattr(resource, name))[i]
            for name in dir(resource) if name.startswith('RLIMIT_') for i, which in enumerate(['soft', 'hard'])}
           if resource else {}),
        **{f'fd {fd}': fd_type(fd) for fd in (0, 1, 2)},
    }
    for name, stream, original in (('stdin', sys.stdin, sys.__stdin__), ('stdout', sys.stdout, sys.__stdout__),
                                   ('stderr', sys.stderr, sys.__stderr__)):
        state.update({f'{name} type': type(stream).__name__, f'{name} is the original': stream is original,
                      f'{name}.line_buffering': getattr(stream, 'line_buffering', None),
                      f'{name}.write_through': getattr(stream, 'write_through', None),
                      f'{name}.closed': getattr(stream, 'closed', None)})
    if first:  # stdout、stderr 的 encoding 與 errors：之後 restore 的模組層自己改，只在工具的第一行之前比
        for name, stream in (('stdout', sys.stdout), ('stderr', sys.stderr)):
            state.update({f'{name}.encoding': getattr(stream, 'encoding', None),
                          f'{name}.errors': getattr(stream, 'errors', None)})
    return state
'''


ON_DISK = '''
CLI_MAIN = dict(globals())
import ast
import builtins
import importlib.machinery
import json
import os
import sys
import sysconfig
import types
from pathlib import Path

tools, out, registered, task = sys.argv[1:]
task = json.loads(task)
flags = [sys.flags.isolated, sys.flags.no_site, sys.flags.dont_write_bytecode, sys.flags.safe_path, sys.flags.optimize,
         sys.pycache_prefix]
venv = os.path.dirname(os.path.dirname(os.path.abspath(sys.executable)))
paths = sysconfig.get_paths('venv', vars={'base': venv, 'platbase': venv})
sys.path += sorted({paths['purelib'], paths['platlib']})
allowed = {name + '.py' for name in json.loads(registered)} | {'tests', '__pycache__', 'pyproject.toml', 'uv.lock'}
strays = sorted(entry for entry in os.listdir(tools) if not entry.startswith('.') and (
    entry not in allowed or entry.endswith('.py') and (
        entry[:-3] in sys.stdlib_module_names
        or importlib.machinery.PathFinder.find_spec(entry[:-3], sys.path) is not None)))
if strays:
    Path(out).write_text(json.dumps({'flags': flags, 'strays': strays}), encoding='utf-8')
    sys.exit(0)
sys.path[:0] = [tools]


def state():  # site 在不在 sys.modules，import 的 finder 與 path hook 的名字
    return ['site' in sys.modules, [getattr(finder, '__name__', type(finder).__name__) for finder in sys.meta_path],
            [getattr(hook, '__name__', type(hook).__name__) for hook in sys.path_hooks]]


def foreign_modules():  # 標準函式庫以外已經載入的模組（這個程式的 __main__、sysconfig 讀的 _sysconfigdata_* 不算）
    return sorted(name for name in list(sys.modules) if name.split('.')[0] not in sys.stdlib_module_names
                  and name != '__main__' and not name.startswith('_sysconfigdata_'))


@FINGERPRINT@

def snapshot():  # 樣本換進命名空間前後要一樣的行程狀態：樣本只換工具命名空間裡的值
    return {**fingerprint(first=True), 'modules': sorted(sys.modules), 'argv': list(sys.argv), 'finders': state()[1:],
            'importer cache': sorted((key, type(value).__name__) for key, value in sys.path_importer_cache.items()),
            'builtins': sorted([name, id(value)] for name, value in vars(builtins).items())}


isolation, preloaded, fingerprints, samples = [], [], [], []


def as_cli(path, argv, before_last=None):
    *body, last = ast.parse(Path(path).read_bytes(), path).body
    main = types.ModuleType('__main__')
    vars(main).update(CLI_MAIN, __file__=path, __cached__=None,
                      __loader__=importlib.machinery.SourceFileLoader('__main__', path))
    sys.modules['__main__'], sys.argv = main, [path, *argv]
    preloaded.append(foreign_modules())  # 工具的第一行之前：不跑 site，標準函式庫以外一個模組都還沒載入
    fingerprints.append(fingerprint(first=True))  # 同一時間的行程狀態，與 CLI 比（最後一段之前、跑完之後也比）
    exec(compile(ast.Module(body, []), path, 'exec', dont_inherit=True), vars(main))
    if before_last:
        before = snapshot()
        before_last(vars(main))
        samples.append(sorted(key for key, value in snapshot().items() if before[key] != value))
    isolation.append(state())  # 最後一段之前：工具的模組層跑完、樣本換好了，main() 還沒跑
    fingerprints.append(fingerprint())
    exec(compile(ast.Module([last], []), path, 'exec', dont_inherit=True), vars(main))


class Extracted(Exception):
    pass


def reached(*args, **kwargs):
    raise Extracted


seen = {}


def restore_sample(namespace):
    seen['namespace'] = namespace
    namespace['SOURCES'] = {task['source']: task['meta']}
    namespace['EXTRACTORS']['ipas_exam_table'] = reached
    namespace['ipas_exam_pdf'].extract = reached
    namespace['SNAPSHOT'] = Path(task['scratch'], 'restore_source_extract.json')
    namespace['MANIFEST'] = Path(task['scratch'], 'restoration-manifest.json')


def import_sample(namespace):
    seen['namespace'] = namespace
    namespace['R'].SOURCES = {task['source']: task['meta']}
    namespace['R'].EXPECTED_QUESTION_COUNT[task['source']] = 2
    namespace['R'].EXTRACTORS['ipas_exam_table'] = reached
    namespace['ipas_exam_pdf'].extract = reached
    namespace['DATASET'] = Path(task['scratch'], 'integrated_dataset.json')


end = None
isolation.append(state())  # 執行工具之前
if task['tool'] == 'probe':
    as_cli(task['script'], task['argv'])
elif task['tool']:
    try:
        if task['tool'] == 'restore':
            as_cli(os.path.join(tools, 'restore_from_source_pdf.py'), ['--verify', '--cache', task['cache']],
                   restore_sample)
        else:
            as_cli(os.path.join(tools, 'import_official_exam.py'), [task['source'], '--cache', task['cache']],
                   import_sample)
    except SystemExit as stopped:
        end = '沒有停' if stopped.code in (0, None) else str(stopped.code)
    except Extracted:
        end = '走到擷取'
    else:
        end = '沒有停'
namespace = seen.get('namespace', {})
writes = [str(namespace.get(name)) for name in (('SNAPSHOT', 'MANIFEST') if task['tool'] == 'restore' else ('DATASET',))
          if namespace]  # restore 寫快照與 manifest，匯入工具寫題庫
pdf, R = namespace.get('ipas_exam_pdf'), namespace.get('R', namespace)
stubs = [getattr(pdf, 'extract', None) is reached,
         (R['EXTRACTORS'] if isinstance(R, dict) else R.EXTRACTORS).get('ipas_exam_table') is reached] if namespace else []
isolation.append(state())  # 跑完之後
fingerprints.append(fingerprint())
Path(out).write_text(json.dumps({'flags': flags, 'isolation': isolation, 'preloaded': preloaded,
                                 'fingerprints': fingerprints, 'samples': samples, 'writes': writes, 'stubs': stubs,
                                 'end': end},
                                ensure_ascii=False), encoding='utf-8')
'''.replace('@FINGERPRINT@', FINGERPRINT)


# 分得出模組怎麼執行的名字：CLI 與 import（pytest）裡的值不同（第二十八到三十輪確認審查實測：CLI 的 __cached__ 是 None、
# import 的是字串；函式的 __module__ 在 CLI 是 '__main__'；3.13 的 CLI 一開始就有 __annotations__）。子行程照 CLI 執行，
# 看得到這些差別；這道禁令在測試行程裡就先擋下
TELLING = {'__name__', '__package__', '__spec__', '__loader__', '__cached__', '__builtins__', '__module__',
           '__annotations__'}


def _telling(source):
    """工具的最後一段之外，分得出自己怎麼執行的寫法：這幾個名字、它們當屬性（__name__ 除外：函式與類別的名字照用）、
    等於它們或 '__main__' 的字串（globals()['__spec__']、sys.modules['__main__']）、import __main__（拿它的 __file__
    比自己的，第二十九輪確認審查實測）。執行時才拼出來的名字、經 inspect 或堆疊去找的，是刻意分辨，交給 code review。"""
    *rest, _ = ast.parse(source).body
    return [ast.unparse(node) for statement in rest for node in ast.walk(statement)
            if isinstance(node, ast.Name) and node.id in TELLING
            or isinstance(node, ast.Attribute) and node.attr in TELLING - {'__name__'}
            or isinstance(node, ast.Constant) and node.value in {*TELLING, '__main__'}
            or isinstance(node, ast.Import) and any(alias.name == '__main__' for alias in node.names)
            or isinstance(node, ast.ImportFrom) and node.module == '__main__']


LAST_STATEMENT = "if __name__ == '__main__':" + chr(10) + '    sys.exit(main())'


@pytest.mark.parametrize('module', [R, I], ids=['restore', 'import'])
def test_only_the_last_statement_of_each_tool_tells_how_it_runs(module):
    # CLI 從 __main__ 那一段進來：在那裡多寫幾行（例如換掉 ipas_exam_pdf 的函式），測試 import 的模組照舊，CLI 卻跑了
    # 別的（第二十七輪確認審查實測）；別處用 __package__、__spec__、__cached__ 分辨是不是被當成腳本執行也一樣（第二十八、
    # 二十九輪確認審查實測：if __package__ is None、if __spec__ is None、if __cached__ is None、globals()['__spec__']）。
    # 所以兩個工具的最後一段只呼叫 main()，模組裡別處不准出現分得出怎麼執行的寫法（_telling；看 sys.argv 的是刻意分辨，
    # 交給 code review）
    source = Path(module.__file__).read_text(encoding='utf-8')
    assert ast.unparse(ast.parse(source).body[-1]) == LAST_STATEMENT
    assert _telling(source) == [], (
        f'{module.__name__} 在最後一段之外用了分得出自己怎麼執行的寫法：這些名字在 CLI 與 import 裡的值不同，拿來改變'
        "行為，測試與 CLI 就走不同的路。要模組的名字就寫出來（例如 logging.getLogger('restore_from_source_pdf')）；函式或"
        "類別的名字用屬性（f.__name__），不要寫成字串（getattr(f, '__name__')）")


@pytest.mark.parametrize(('line', 'found'), [
    ('LOOSE = __cached__ is None', ['__cached__']),
    ("LOOSE = globals()['__spec__'] is None", ["'__spec__'"]),
    ("LOOSE = vars().get('__package__') is None", ["'__package__'"]),
    ("LOOSE = getattr(sys.modules['__main__'], '__file__', None) is None", ["'__main__'"]),
    ('log = logging.getLogger(__name__)', ['__name__']),
    ('LOOSE = isinstance(__builtins__, dict)', ['__builtins__']),
    ('LOOSE = ipas_exam_pdf.__loader__ is None', ['ipas_exam_pdf.__loader__']),
    ('import __main__ as entry', ['import __main__ as entry']),
    ('from __main__ import main as entry', ['from __main__ import main as entry']),
    ("LOOSE = extract_sources.__module__ == '__main__'", ['extract_sources.__module__', "'__main__'"]),
    ("LOOSE = '__annotations__' in globals()", ["'__annotations__'"]),
    ('NAME = main.__name__', []),
    ("log = logging.getLogger('restore_from_source_pdf')", []),
], ids=['cached', 'spec-by-key', 'package-by-key', 'main-module', 'module-name', 'builtins', 'loader-attribute',
        'import-main', 'from-main', 'module-of-a-function', 'annotations', 'function-name', 'name-written-out'])
def test_the_ban_sees_each_way_a_tool_could_tell_how_it_runs(line, found):
    # 每一種寫法在 CLI 與子行程（或 pytest）裡的值都不同（第二十九輪確認審查實測：CLI 的 __cached__ 是 None、import 的
    # 是字串）；函式的名字與寫出來的模組名稱照用
    assert _telling(line + chr(10) + LAST_STATEMENT) == found


TOOLS_FOLDER = Path(__file__).resolve().parents[1]
# tools/ 頂層登記的工具模組：新增工具要加在這裡（AGENTS.md），其他檔案不要放在 tools/ 頂層
TOOL_MODULES = {'answer_key_crosscheck', 'build_evidence_manifest', 'explanation_guard', 'fetch_text', 'gen_gap_reports',
                'import_official_exam', 'ipas_exam_pdf', 'pin_law_articles', 'restore_from_source_pdf',
                'sync_derived_counts', 'verify_agent_quotes', 'verify_citations'}


# 照 -I -S 啟動、沒有跑 site 的子行程：site 不在 sys.modules，finder 與 path hook 只有預設的（3.13 與 3.14 實測）
ISOLATED = [False, ['BuiltinImporter', 'FrozenImporter', 'PathFinder'], ['zipimporter', 'path_hook_for_FileFinder']]
WRITES = {'restore': 2, 'import': 1}  # 兩個工具會寫的檔案：restore 的快照與 manifest，匯入工具的題庫


class Differs(AssertionError):
    """子行程的行程狀態與 CLI 不同、或樣本換進去時改了行程的狀態：keys 是不同的那幾項。必擋的測試只看 keys，不看訊息 ——
    pytest 改寫的 assert 在訊息後面加上兩邊的值，CI 上不截斷，整筆記錄的每一個鍵都在裡面（第四十一輪確認審查實測）"""

    def __init__(self, message, keys):
        super().__init__(message)
        self.keys = set(keys)


def _on_disk(tools, job, folder, registered=TOOL_MODULES, probe=(), child=None):
    """ON_DISK 在另一個 Python 裡跑：每一份樣本的每一個工具各開一個新的子行程（同時跑），cwd 是 tools 的上一層。job 是
    [(來源, 快取, SOURCES 登記), ...]，registered 是登記的工具模組，probe 是（腳本, 參數...）時只照 CLI 執行那個腳本，child 是
    子行程的程式（預設 ON_DISK；必擋的測試換成改過的）。
    回傳各自怎麼結束（每一份樣本依序是 restore、匯入工具），或 tools/ 頂層不在名單裡、或與別處同名的項目
    （{'strays': [...]}）。每一個子行程有自己的暫存資料夾，兩個工具會寫的檔案都指到那裡。"""
    folder.mkdir()
    (folder / 'pycache').mkdir()
    # 同一個 venv 直接跑的 CLI（有 site、從 tools 的上一層；-E 與子行程的 -I 一樣不讀 PYTHON* 環境變數，stdout、stderr
    # 與子行程一樣接到 pipe）在第一行取的行程狀態：子行程在工具的第一行之前、最後一段之前、跑完之後都要與它相同
    (folder / 'cli.py').write_text(FINGERPRINT + 'import json, sys' + chr(10)
                                   + 'json.dump([fingerprint(first=True), fingerprint()], open(sys.argv[1], "w"))' + chr(10),
                                   encoding='utf-8')
    ran = subprocess.run([sys.executable, '-E', str(folder / 'cli.py'), str(folder / 'cli.json')], cwd=Path(tools).parent,
                         capture_output=True, timeout=60)
    assert ran.returncode == 0, f'CLI 跑不起來：{ran.stderr.decode(errors="replace")[-2000:]}'
    cli_first, cli = json.loads((folder / 'cli.json').read_text(encoding='utf-8'))
    tasks = ([{'tool': 'probe', 'script': probe[0], 'argv': list(probe[1:])}] if probe else
             [{'tool': tool, 'source': src, 'cache': cache, 'meta': meta}
              for src, cache, meta in job for tool in ('restore', 'import')] or [{'tool': None}])

    def run(number):
        out, scratch = folder / f'{number}.json', folder / f'scratch-{number}'
        scratch.mkdir()
        ran = subprocess.run([sys.executable, '-I', '-S', '-B', '-X', f'pycache_prefix={folder / "pycache"}', '-c', child or ON_DISK,
                              str(tools), str(out), json.dumps(sorted(registered)),
                              json.dumps({**tasks[number], 'scratch': str(scratch)}, ensure_ascii=False)],
                             cwd=Path(tools).parent, capture_output=True, timeout=600)
        assert ran.returncode == 0, (
            f'子行程跑不起來：{ran.stderr.decode(errors="replace")[-2000:]}（若是相依 import 不到：子行程不跑 site，照 '
            f'{sys.executable} 的位置找 venv，要用專案的 venv 跑 pytest，例如 uv run --locked --directory tools pytest）')
        result = json.loads(out.read_text(encoding='utf-8'))
        # 子行程的隔離（見 test_the_tools_on_disk_stop_where_the_tested_ones_do）：照 -I -S -B（沒有 -O）與空的
        # pycache_prefix 啟動（拿掉 -S，venv 的 .pth 又能只在子行程裡換掉 import：第三十二輪確認審查實測）
        assert result['flags'] == [1, 1, 1, True, 0, str(folder / 'pycache')], (
            f'子行程沒有照 -I -S -B 與空的 pycache_prefix 執行：{result["flags"]}')
        # 要比哪些、該有幾項，照這個子行程跑的工具在這裡決定，不看子行程寫了哪些鍵（第三十四輪確認審查實測：子行程多寫
        # 一個空的 strays，下面的比對就整個跳過）。名單擋下時，子行程在執行工具之前就結束，只有旗標與擋下的項目
        tool = tasks[number]['tool']
        if 'strays' in result:
            assert sorted(result) == ['flags', 'strays'] and result['strays'], result
            return result
        assert sorted(result) == ['end', 'fingerprints', 'flags', 'isolation', 'preloaded', 'samples', 'stubs', 'writes'], (
            sorted(result))
        # 執行工具之前、最後一段之前（樣本換好了）與跑完之後，site 都不在 sys.modules，finder 與 path hook 的
        # 名字都是預設的（site.addsitedir、site.main 照樣跑 .pth，旗標卻不變：第三十三輪確認審查實測；只在執行工具
        # 之前比一次，site 改到 as_cli 或樣本裡跑就看不到：第三十四輪確認審查實測）。沒有工具的子行程只有前後兩次
        assert result['isolation'] == [ISOLATED] * (3 if tool else 2), (
            f'子行程載入了 site，或 finder、path hook 不是預設的：{result["isolation"]}')
        # 工具的第一行之前，標準函式庫以外沒有載入任何模組：CLI 在那裡有 site 載入的模組（uv 的 .pth 帶進來的 _virtualenv、
        # Debian 的 sitecustomize），子行程不跑 site，所以要求是空的（第三十五輪確認審查實測：子行程先 import pdfminer、
        # pdfplumber、pymupdf，工具看 pymupdf 有沒有載入來放寬，整套全綠、真的 CLI 照收；第三十六輪：先 import tools/ 裡的
        # ipas_exam_pdf 再跑 restore，只看 site-packages 的模組就看不到；第三十七輪更正這一句）
        assert result['preloaded'] == ([[]] if tool else []), (
            f'子行程在工具之前載入了標準函式庫以外的模組：{result["preloaded"]}')
        # 工具的第一行之前、最後一段之前（樣本換好了）、跑完之後，行程狀態都與 CLI 逐項相同（FINGERPRINT；第三十七輪確認
        # 審查實測：頂層開 faulthandler 或加 warnings 的 always，整套全綠、真的 CLI 照收；第三十八輪：同樣兩行放到
        # as_cli 裡第一次記錄之後、或 main() 之前，也一樣）。stdout、stderr 的 encoding 與 errors 只比第一次（之後
        # restore 的模組層自己改）。沒有工具的子行程只有跑完之後那一次
        points = ['工具的第一行之前', '最後一段之前', '跑完之後'] if tool else ['跑完之後']
        expected = [{**state, 'sys.path[0]': str(tools)}  # CLI 的第一項是它自己的資料夾；子行程一律是 tools/
                    for state in ([cli_first, cli, cli] if tool else [cli])]
        differ = [[point, sorted(key for key in {*want, *state} if state.get(key) != want.get(key))]
                  for point, state, want in zip(points, result['fingerprints'], expected) if state != want]
        if result['fingerprints'] != expected:  # 必擋的測試看 Differs 列出的鍵，不看訊息
            raise Differs(
                f'子行程的行程狀態與 CLI 不同（記了 {len(result["fingerprints"])} 次，應為 {len(points)} 次）：{differ}' + (
                    '（sys.path 不同：venv 裡會加路徑的 .pth，例如 editable 安裝，只在 CLI 生效，子行程不跑 site）'
                    if any('sys.path' in keys for _, keys in differ) else ''),
                [key for _, keys in differ for key in keys])
        # 樣本只換工具命名空間裡的值：換之前、換之後，指紋的每一項、載入的模組、argv、finder 與 path hook、importer 的
        # 快取（鍵與值的型別）、builtins 的每一個值都一樣（第三十六輪確認審查實測：樣本裡 import 相依，工具到 main() 才看
        # pymupdf 有沒有載入來放寬，整套全綠、真的 CLI 照收；第三十七輪：樣本裡加 warnings 的 always 也一樣）
        if result['samples'] != ([[]] if tool in WRITES else []):
            raise Differs(f'樣本換進去時改了行程的狀態：{result["samples"]}', [key for keys in result['samples'] for key in keys])
        # 兩個工具會寫的檔案都在這個子行程的暫存資料夾，擷取器都換成替身：restore 寫快照與 manifest，匯入工具寫題庫
        # （第三十三輪確認審查實測：拿掉其中一行，整套照樣全綠；第三十四輪：沒記到命名空間時，比對是空的）
        assert [Path(write).parent for write in result['writes']] == [scratch] * WRITES.get(tool, 0), result['writes']
        assert result['stubs'] == ([True, True] if tool in WRITES else []), result['stubs']
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(run, range(len(tasks))))
    strays = next((result['strays'] for result in results if 'strays' in result), None)
    return {'strays': strays} if strays else [result['end'] for result in results if result['end'] is not None]


def _registered_only(ends):
    assert not isinstance(ends, dict), (f'tools/ 頂層有不在名單裡、或與別處同名的項目：{ends["strays"]} —— 新的工具要登記'
                                        '在這個檔案的 TOOL_MODULES（AGENTS.md），其他檔案不要放在 tools/ 頂層')
    return ends


def test_the_tools_on_disk_stop_where_the_tested_ones_do(tmp_path):
    # 測試 import 的模組不一定是 CLI 跑的檔案：conftest.py 預先把審過的版本放進 sys.modules、對 tools/ 裝 path hook、
    # 改寫 PathFinder.find_spec，或 venv 的 .pth 只在 pytest 底下換掉 import，tools/ 裡放寬的檔案照樣整套全綠（第二十六輪
    # 確認審查實測 4 種）。同一個行程裡的檢查都能被同一個行程裡的程式改掉，所以另開一個 Python 從 tools/ 的檔案再走一遍：
    # -I（不讀環境變數與使用者的 site-packages）、-S（不跑 site，venv 的 .pth 也不跑：只在 -I 底下生效的 .pth 照樣換得掉
    # import，第二十七輪確認審查實測）、-B 與空的 pycache_prefix（不寫也不讀舊的 .pyc）。頁首這一關的每一個樣本，兩個
    # 工具都要與這裡的 header() 一樣結束。這一條擋的是只在測試行程裡生效的改動，以及只在照 CLI 執行時才生效的改動。
    # 子行程與 CLI 還分得出來的只剩刻意去看的：直譯器的旗標（-I -S -B）與 -X pycache_prefix（sys.pycache_prefix、
    # sys._xoptions）、sys.orig_argv（看得到 -c 與這些旗標）、子行程自己先載入的標準函式庫模組；反過來 CLI 的 site 做的
    # 一切，子行程都沒有 —— 它 import 的模組（site、_sitebuiltins、encodings.utf_8_sig、Debian 的 sitecustomize）、加的
    # builtins（exit、quit、help、copyright、credits、license）、設的 sys 屬性（sys.__interactivehook__、sys._home；3.13
    # 在 -S 底下 sys.prefix 與 sys.exec_prefix 是 base）、.pth 的副作用（例如 uv 的 _virtualenv 與它放在 sys.meta_path
    # 最前面的 finder；會加路徑的 .pth，例如 editable 安裝，讓 sys.path 與 CLI 不同，這一條就紅）；以及 argv[0] 寫成絕對
    # 路徑、從 pytest 繼承的環境變數、CLI 會讀的 PYTHON* 環境變數（PYTHONWARNINGS、PYTHONFAULTHANDLER、PYTHONDEVMODE、
    # PYTHONPATH 等：子行程的 -I 與 CLI 參考的 -E 都不讀）、父行程、模組程式上面還有子行程的 frame、stdout 是 pipe、
    # stdin 不是終端機、sys.path_importer_cache 裡腳本自己的路徑（CLI 啟動時放進去；資料夾兩邊都是第一次 import 才放）——
    # 這些，針對這條測試怎麼開子行程的改動（sys.executable、subprocess），以及依呼叫者改變行為的共用函式，這裡看不到，交
    # 給 code review。記錄點只記 site 在不在 sys.modules、finder 與 path hook 的名字、標準函式庫以外載入了哪些模組、三個
    # 時間點（工具的第一行之前、最後一段之前、跑完之後）的行程狀態（與 CLI 比；只比 FINGERPRINT 列的項目，沒列的，例如
    # sys.monitoring、audit hook、標準函式庫模組的屬性、0 到 2 以外的檔案描述子、I/O 的優先序、沒有 /proc/self/task 的平
    # 台上 _thread 直接開的執行緒，看不到；第一次記錄之後、樣本以外才改 stdout、stderr 的編碼也看不到），樣本換進去前後
    # 再比一次：一次記錄之後才設、下一次記錄之前就還原或被工具自己蓋掉的狀態（例如 catch_warnings 只包住工具的模組層或只
    # 包住最後一段；as_cli 裡第一次記錄之後改 stdout 的 errors，隨後被 restore 的模組層蓋掉），以及子行程裡執行的環境程
    # 式（venv 的套件、.pth）把這些值還原，或換成同名的類別，這裡看不到，同樣交給 code review。restore 照 --verify 跑：
    # --emit 那一支在 restore 的 main() 裡，不在釘住的三個函式之內，依上面的邊界交給 code review。子行程接不上相依就是這
    # 一條紅，不跳過：用專案的 venv 跑（uv run --locked --directory tools pytest）
    def folder(name):
        (tmp_path / name).mkdir()
        return tmp_path / name

    clean = samples._two_page_exam(folder('clean'))
    right = _real_meta(clean)
    cases = [(clean, right, ['走到擷取'] * 2),
             (clean, {**right, 'session': '115-02'},
              [f'✗ {SRC} 的 PDF 頁首與 SOURCES 不符：場次：SOURCES 寫「115-02」，PDF 頁首是「{right["session"]}」。'] * 2)]
    other_session = (samples.TITLE.replace('第一次', '第二次'), samples.SUBJECT, samples.DATE)
    makers = {**samples.HEADER_REFUSALS,  # 加上第 2 頁換成別場（審查放寬的就是這一條）
              'other-session-on-page-2': lambda at: samples._two_page_exam(at, page_options={2: {'header': other_session}})}
    for name, make in makers.items():
        pdf = make(folder(name))
        with pytest.raises(ValueError) as refused:
            ipas_exam_pdf.header(pdf)
        cases.append((pdf, right, [f'✗ {SRC}: {refused.value}'] * 2))
    job = []
    for number, (pdf, meta, _) in enumerate(cases):
        cache, data = folder(f'cache-{number}'), pdf.read_bytes()
        (cache / f'{SRC}.pdf').write_bytes(data)
        job.append((SRC, str(cache), {**meta, 'sha256': hashlib.sha256(data).hexdigest()}))
    assert _registered_only(_on_disk(TOOLS_FOLDER, job, tmp_path / 'run')) == [
        end for _, _, expected in cases for end in expected]


def _plant(*paths):  # 在 tools/ 的複本裡放這幾個檔案（空的）
    def plant(tools):
        for path in paths:
            (tools / path).parent.mkdir(parents=True, exist_ok=True)
            (tools / path).write_bytes(b'')
    return plant


@pytest.mark.parametrize(('plant', 'registered', 'strays'), [
    (_plant('notes.py'), (), ['notes.py']),
    (_plant('re.py'), ('re',), ['re.py']),
    (_plant('nt.py'), ('nt',), ['nt.py']),
    (_plant('pdfplumber.py'), ('pdfplumber',), ['pdfplumber.py']),
    (_plant('pdfplumber/__init__.py'), (), ['pdfplumber']),
    (_plant('nt/_path_splitroot_ex.py'), (), ['nt']),
    (_plant('json.pyc'), (), ['json.pyc']),
    (_plant('re.pyw'), (), ['re.pyw']),
    (_plant('nt.pyd'), (), ['nt.pyd']),
    (_plant('ipas_exam_pdf.pyw'), (), ['ipas_exam_pdf.pyw']),
    (_plant('ipas_exam_pdf/__init__.py'), (), ['ipas_exam_pdf']),
    (_plant('__pycache__/ipas_exam_pdf.cpython-313.pyc'), (), []),
    (_plant('.venv/pyvenv.cfg'), (), []),
    (_plant('pyproject.toml', 'uv.lock'), (), []),
], ids=['unregistered-module', 'standard-library-module', 'module-of-another-platform', 'dependency-module',
        'package-directory', 'namespace-directory', 'bytecode-only', 'windows-source', 'windows-extension',
        'registered-name-other-suffix', 'registered-name-directory', 'bytecode-cache', 'dotted-directory', 'project-files'])
def test_only_the_registered_tools_may_be_imported_from_tools(tmp_path, plant, registered, strays):
    # CLI 啟動時 tools/ 就在 sys.path 最前面，同名的換掉別處的：tools/re.py 換掉標準函式庫的 re、tools/pdfplumber/ 換掉
    # 相依，tools/nt.py 與沒有 __init__ 的 tools/nt/ 換掉 ntpath 在 Linux 上找不到、找過就算了的 nt，Windows 上
    # tools/re.pyw 也換得掉 re。pytest 與子行程都已經先載入（或找過）這些模組，同名的檔案在這兩處換不掉 —— 整套全綠，
    # CLI 跑的卻是那個檔案（第二十九到三十一輪確認審查實測）。所以 tools/ 頂層的每一項都要在名單裡（登記的工具的 .py、
    # tests/、__pycache__/、pyproject.toml、uv.lock，點開頭的不算），逐項比對、不照本機的副檔名推名字；登記了也不准與
    # 標準函式庫（任何平台的）或 venv 裡的同名。這裡拿 tools/ 的一份複本放進那些檔案（有的也登記進去）
    copy = _tools_copy(tmp_path)
    plant(copy)
    assert _on_disk(copy, [], tmp_path / 'run', TOOL_MODULES | set(registered)) == ({'strays': strays} if strays else [])


def _tools_copy(tmp_path):  # tools/ 的複本（登記的工具），旁邊放匯入工具在讀頁首之前就要讀的釘選法條
    missing = sorted(name for name in TOOL_MODULES if not (TOOLS_FOLDER / f'{name}.py').is_file())
    assert not missing, (f'TOOL_MODULES 登記了 tools/ 裡沒有的工具：{missing} —— 移除或改名工具時，也從這個檔案的 '
                         'TOOL_MODULES 拿掉或改名（AGENTS.md）')
    copy = tmp_path / 'tools'
    copy.mkdir()
    for name in TOOL_MODULES:
        shutil.copy(TOOLS_FOLDER / f'{name}.py', copy)
    (tmp_path / 'quiz-app' / 'src' / 'data').mkdir(parents=True)
    shutil.copy(I.PINNED_LAWS, tmp_path / 'quiz-app' / 'src' / 'data')
    return copy


# 只在照 CLI 執行時才生效的放寬，寫進工具的複本（'last'：最後一段的前面；'top'：那一行的前面）：
# - 函式的 __module__ 在 CLI 是 '__main__'、import 時是模組名；runpy 的 __loader__ 是 None、CLI 的是 SourceFileLoader
#   （第三十輪確認審查實測）；
# - CLI 裡 restore 不在 sys.modules（不是 import 進來的）、cwd 是 repo 根目錄（AGENTS.md 的跑法），匯入工具執行時
#   ipas_exam_pdf 還沒載入過（第三十一輪確認審查實測：以前子行程先 import 兩個工具、cwd 是 tools/、同一個行程先跑
#   restore 再跑匯入工具）。看 cwd 的那一種寫在 restore 的模組層級，匯入工具 import restore 時也執行，兩個都放寬。
# 工具開頭的 BOM（Windows 的編輯器會加）CLI 照讀：子行程也照讀，什麼都不放寬（第三十一輪確認審查實測）
BOM = chr(0xFEFF)
CLI_ONLY = {
    'restore-module-of-a-function': ([('restore_from_source_pdf.py', 'last',
                                       "if extract_sources.__module__ == '__main__':" + chr(10) + '    check_official_header = print' + chr(10))],
                                     {'restore'}),
    'import-loader': ([('import_official_exam.py', 'last',
                        'if __loader__ is not None:' + chr(10) + '    R.check_official_header = print' + chr(10))], {'import'}),
    'restore-sys-modules': ([('restore_from_source_pdf.py', 'last',
                              "if 'restore_from_source_pdf' not in sys.modules:" + chr(10) + '    check_official_header = print' + chr(10))],
                            {'restore'}),
    'restore-working-directory': ([('restore_from_source_pdf.py', 'last',
                                    "if Path('quiz-app').is_dir():" + chr(10) + '    check_official_header = print' + chr(10))],
                                  {'restore', 'import'}),
    'import-fresh-process': ([('import_official_exam.py', 'import ipas_exam_pdf' + chr(10),
                               "FRESH = 'ipas_exam_pdf' not in sys.modules" + chr(10)),
                              ('import_official_exam.py', 'last', 'if FRESH:' + chr(10) + '    R.check_official_header = print' + chr(10))],
                             {'import'}),
    'byte-order-mark': ([('restore_from_source_pdf.py', 'start', BOM), ('import_official_exam.py', 'start', BOM)], set()),
}


@pytest.mark.parametrize('case', CLI_ONLY, ids=CLI_ONLY)
def test_a_change_only_the_cli_runs_shows_up_in_the_tools_on_disk(tmp_path, case):
    # 子行程照 CLI 執行兩個工具：只在照 CLI 執行時才放寬比對的工具，在子行程裡也放寬（審查的樣本：頁首的場次與 SOURCES
    # 不符，放寬的走到擷取，其餘照樣停下）
    copy = _tools_copy(tmp_path)
    edits, loosened = CLI_ONLY[case]
    for name, where, code in edits:
        source = (copy / name).read_text(encoding='utf-8')
        if where == 'start':
            source = code + source
        elif where == 'last':
            assert source.endswith(LAST_STATEMENT + chr(10))
            source = source[:-len(LAST_STATEMENT) - 1] + code + LAST_STATEMENT + chr(10)
        else:
            assert source.count(where) == 1
            source = source.replace(where, code + where)
        (copy / name).write_text(source, encoding='utf-8')
    exam = samples._two_page_exam(tmp_path)
    cache = tmp_path / 'cache'
    cache.mkdir()
    (cache / f'{SRC}.pdf').write_bytes(exam.read_bytes())
    right = _real_meta(exam)
    wrong = {**right, 'session': '115-02', 'sha256': hashlib.sha256(exam.read_bytes()).hexdigest()}
    stopped = f'✗ {SRC} 的 PDF 頁首與 SOURCES 不符：場次：SOURCES 寫「115-02」，PDF 頁首是「{right["session"]}」。'
    ends = _on_disk(copy, [(SRC, str(cache), wrong)], tmp_path / 'run')
    assert ends == ['走到擷取' if tool in loosened else stopped for tool in ('restore', 'import')]


# 在 CLI 與子行程裡各執行一次，記下命名空間的每一個名字（值是字串或 None 的記值，loader 記它的類別與 name）
PROBE = chr(10).join([
    'import json, sys',
    'seen = [[key, type(value).__name__, value if isinstance(value, (str, type(None))) else getattr(value, "name", None)]',
    '        for key, value in globals().items()]',
    'json.dump([seen, sys.modules["__main__"].__dict__ is globals(), sys.argv[1:]], open(sys.argv[1], "w"))', ''])


def test_the_tools_on_disk_run_a_script_the_way_the_cli_does(tmp_path):
    # 同一個腳本，真的 CLI（python 腳本）與子行程的 as_cli 看到的命名空間逐項相同：每一個名字、型別、值（loader 比
    # 類別與 name），sys.modules['__main__'] 就是它自己
    probe = tmp_path / 'probe.py'
    probe.write_text(PROBE, encoding='utf-8')
    subprocess.run([sys.executable, str(probe), str(tmp_path / 'cli.json')], check=True, timeout=60)
    _registered_only(_on_disk(TOOLS_FOLDER, [], tmp_path / 'run', probe=(str(probe), str(tmp_path / 'child.json'))))
    cli, child = (json.loads((tmp_path / f'{name}.json').read_text(encoding='utf-8')) for name in ('cli', 'child'))
    assert [child[0], child[1], child[2][1:]] == [cli[0], cli[1], cli[2][1:]]


# 指紋的每一項都要擋得下（必擋）：子行程在頂層改那一項，與 CLI 的比對要紅，而且點名那一項（上面的測試是必過的）。
# CLI 參考與子行程用同一份 FINGERPRINT，拿掉其中一項兩邊一起少，比對照樣相等：只有這幾條會紅（第四十輪確認審查實測：
# 拿掉任一項，甚至只剩 sys.path[0]，整套全綠 —— 補進來的每一項都能在下一次改寫時安靜地消失）。一項一個鍵，每一個鍵都有
# 自己的改法：表格的每一欄、固定的每一列、合在一起的值的每一部分各是一個鍵（第四十一輪確認審查實測：一張表只配一種改法
# 時，拿掉 logger 的 level、資源上限只記 RLIMIT_CPU、串流只記型別，整套全綠，第三十八輪頂層改 pdfminer 的 level 又照收）；
# 列由改法新增的表（sys.path、builtins、environ、logging 根的 handler）以一條加一列的改法守。相依自己設的 logger 照它設的
# 樣子不算（LIBRARY_LOGGERS），那個樣子的每一欄也各有一條（LIBRARY_LOGGER_ATTACKS：只比名字時，替 charset_normalizer 的
# logger 先加 NullHandler 的子行程照收）。點名只看比對自己列出的鍵（Differs.keys），不看 pytest 加的說明（第四十一輪確認
# 審查實測：CI 上 pytest 不截斷說明，失敗訊息帶著整筆記錄的每一個鍵，改到別項的改法照樣算點名，那一項換成常數整套照樣
# 全綠）。sys.path[0] 由子行程自己放 tools/，不在這裡改
NL = chr(10)
STREAMS = ('stdin', 'stdout', 'stderr')
FILTER_COLUMNS = ['action', 'message', 'category', 'module', 'lineno']  # 與 FINGERPRINT 的順序相同
LOGGER_CHANGES = {'level': '.setLevel(logging.ERROR)', 'handlers': '.addHandler(logging.NullHandler())',
                  'propagate': '.propagate = False', 'disabled': '.disabled = True', 'filters': '.addFilter(lambda record: True)'}


def _toggle(stream, attribute):  # 把那個串流的 line_buffering 或 write_through 換成相反的（不管原本是哪一個）
    return f'sys.{stream}.reconfigure({attribute}=not sys.{stream}.{attribute})'


def _another(stream):  # 換成同一種類別、同樣編碼的另一個串流：只有「是不是原本那一個」不同
    mode = 'r' if stream == 'stdin' else 'w'
    return f"sys.{stream} = open(os.devnull, '{mode}', encoding=sys.{stream}.encoding, errors=sys.{stream}.errors)"


def _filter(column):  # warnings 第一條 filter 的那一欄換掉，其他欄不動
    new = {'action': "'error' if f[0] != 'error' else 'ignore'", 'message': "re.compile('probe')",
           'category': 'UserWarning if f[2] is not UserWarning else RuntimeWarning', 'module': "re.compile('probe')",
           'lineno': 'f[4] + 1'}[column]
    at = FILTER_COLUMNS.index(column)
    return NL.join(['import re, warnings', 'f = warnings.filters[0]', f'warnings.filters[0] = (*f[:{at}], {new}, *f[{at + 1}:])'])


def _limit(name, which):  # 那一種資源上限：軟的能降就降、是 0 就升到 1；硬的降一點（無限的降成 2⁴⁰）
    return NL.join(['import resource', f'soft, hard = resource.getrlimit(resource.{name})', 'INF = resource.RLIM_INFINITY',
                    'lower = lambda value: 2 ** 40 if value == INF else value - 1',
                    f'resource.setrlimit(resource.{name}, (lower(soft) if soft else 1, hard))' if which == 'soft' else
                    f'resource.setrlimit(resource.{name}, (soft if soft != INF and soft <= lower(hard) else lower(hard), lower(hard)))'])


LIMITS = sorted(name for name in dir(resource) if name.startswith('RLIMIT_')) if resource else []
FINGERPRINT_ATTACKS = {
    'sys.path': "sys.path.append('/nonexistent-probe')",  # 加 tools/ 會讓每一個工具都成了 stray
    'sys.excepthook': 'sys.excepthook = print', 'sys.displayhook': 'sys.displayhook = print',
    'sys.unraisablehook': 'sys.unraisablehook = print', 'sys.breakpointhook': 'sys.breakpointhook = print',
    'threading.excepthook': 'import threading' + NL + 'threading.excepthook = print',
    'sys.gettrace': 'sys.settrace(lambda *args: None)', 'sys.getprofile': 'sys.setprofile(lambda *args: None)',
    'threading.gettrace': 'import threading' + NL + 'threading.settrace(lambda *args: None)',
    'threading.getprofile': 'import threading' + NL + 'threading.setprofile(lambda *args: None)',
    **{f'{stream} type': 'import io' + NL + f'sys.{stream} = io.StringIO()' for stream in STREAMS},
    **{f'{stream} is the original': _another(stream) for stream in STREAMS},
    **{f'{stream}.{attribute}': _toggle(stream, attribute) for stream in STREAMS for attribute in ('line_buffering', 'write_through')},
    **{f'{stream}.closed': f'sys.{stream}.close()' for stream in STREAMS},
    **{f'{stream}.encoding': f"sys.{stream}.reconfigure(encoding='utf-8-sig')" for stream in STREAMS},  # stdout、stderr 只比第一次
    **{f'{stream}.errors': f"sys.{stream}.reconfigure(errors='replace')" for stream in STREAMS},  # stderr 預設是 backslashreplace
    'sys.getrecursionlimit': 'sys.setrecursionlimit(3000)', 'sys.getswitchinterval': 'sys.setswitchinterval(0.001)',
    'sys.get_int_max_str_digits': 'sys.set_int_max_str_digits(10000)',
    'sys.getfilesystemencoding': 'sys._enablelegacywindowsfsencoding()',  # 只有 Windows 改得了
    'sys.tracebacklimit': 'sys.tracebacklimit = 5',
    'gc.isenabled': 'import gc' + NL + 'gc.disable()',
    **{f'gc.get_threshold[{generation}]': NL.join(['import gc', 'threshold = list(gc.get_threshold())',
                                                   f'threshold[{generation}] += 1', 'gc.set_threshold(*threshold)'])
       for generation in range(3)},
    'socket.getdefaulttimeout': 'import socket' + NL + 'socket.setdefaulttimeout(60)',
    'os.umask': 'os.umask(os.umask(0) ^ 0o002)',
    **{f'signal.{timer}': 'import signal' + NL + f'signal.setitimer(signal.{timer}, 590)'
       for timer in ('ITIMER_REAL', 'ITIMER_VIRTUAL', 'ITIMER_PROF')},
    # LC_NUMERIC 在 C 與 C.UTF-8 之間換（LC_ALL=C 底下也改得了）
    'locale': ('import locale' + NL + "locale.setlocale(locale.LC_NUMERIC, 'C.UTF-8' if locale.setlocale(locale.LC_NUMERIC)"
               " in ('C', 'POSIX') else 'C')"),
    'threading.enumerate name': 'import threading' + NL + "threading.current_thread().name = 'probe'",
    'threading.enumerate daemon': ('import threading, time' + NL
                                   + 'threading.Thread(target=time.sleep, args=(60,), daemon=True).start()'),
    **{f'warnings.filters {column}': _filter(column) for column in FILTER_COLUMNS},
    'warnings.showwarning': 'import warnings' + NL + 'warnings.showwarning = print',
    'warnings.formatwarning': 'import warnings' + NL + 'warnings.formatwarning = str',
    'faulthandler': 'import faulthandler' + NL + 'faulthandler.enable()',
    'logging root level': 'import logging' + NL + 'logging.getLogger().setLevel(logging.INFO)',
    'logging root handlers': 'import logging' + NL + 'logging.getLogger().addHandler(logging.NullHandler())',
    'logging root filters': 'import logging' + NL + 'logging.getLogger().addFilter(lambda record: True)',
    'logging.disable': 'import logging' + NL + 'logging.disable(logging.INFO)',
    'logging.getLoggerClass': 'import logging' + NL + "logging.setLoggerClass(type('Logger', (logging.Logger,), {}))",
    'logging.lastResort': 'import logging' + NL + 'logging.lastResort = None',
    'logging.lastResort level': 'import logging' + NL + 'logging.lastResort.setLevel(logging.ERROR)',
    'loggers name': 'import logging' + NL + "logging.getLogger('probe').addHandler(logging.NullHandler())",
    **{f'loggers {column}': 'import logging' + NL + f"logging.getLogger('pdfminer'){change}"
       for column, change in LOGGER_CHANGES.items()},
    **{f'signal {int(number)}': ('import signal' + NL + f'signal.signal({int(number)}, signal.SIG_DFL if '
                                 f'signal.getsignal({int(number)}) is signal.SIG_IGN else signal.SIG_IGN)')
       for number in signal.valid_signals()},
    'builtins': 'builtins.probe = None', 'environ': "os.environ['IPAS_PROBE'] = '1'", 'cwd': 'os.chdir(tools)',
    'os threads': 'import faulthandler' + NL + 'faulthandler.dump_traceback_later(590, exit=True)',
    'os.getpriority': 'os.nice(1)',
    'os.sched_getscheduler': ('os.sched_setscheduler(0, os.SCHED_BATCH if os.sched_getscheduler(0) != os.SCHED_BATCH '
                              'else os.SCHED_IDLE, os.sched_param(0))'),
    'os.sched_getaffinity': 'os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:1])',
    'signal.pthread_sigmask': ('import signal' + NL + 'signal.pthread_sigmask(signal.SIG_UNBLOCK if signal.SIGUSR1 in '
                               'signal.pthread_sigmask(signal.SIG_BLOCK, []) else signal.SIG_BLOCK, {signal.SIGUSR1})'),
    'os.getsid': 'os.setsid()', 'os.getpgrp': 'os.setpgid(0, 0)',
    **{f'resource.{name} {which}': _limit(name, which) for name in LIMITS for which in ('soft', 'hard')},
    'fd 0': 'os.close(0)',
    **{f'fd {fd}': f'os.dup2(os.open(os.devnull, os.O_WRONLY), {fd})' for fd in (1, 2)},
}
# 相依自己設的 logger（charset_normalizer：一個 NullHandler）只改其中一欄：只比名字或少比一欄時照收
LIBRARY_LOGGER_ATTACKS = {
    f'charset_normalizer {column}': (f'loggers {column}', NL.join([
        'import logging', "library = logging.getLogger('charset_normalizer')", 'library.addHandler(logging.NullHandler())',
        f'library{change}']))
    for column, change in LOGGER_CHANGES.items()}


# 這個平台怎麼改都改不了的（沒有那個函式、只有一顆 CPU、上限是 0 而且硬上限也是 0、SIGKILL 與 SIGSTOP 不能換處理方式）：
# 改法什麼都沒改到，就不是在測這一項
NOT_HERE = {**{key: not hasattr(signal, 'setitimer') for key in ('signal.ITIMER_REAL', 'signal.ITIMER_VIRTUAL', 'signal.ITIMER_PROF')},
            'sys.getfilesystemencoding': not hasattr(sys, '_enablelegacywindowsfsencoding'),
            'os threads': not os.path.isdir('/proc/self/task'), 'os.getpriority': not hasattr(os, 'nice'),
            'os.sched_getscheduler': not hasattr(os, 'sched_setscheduler'),
            'os.sched_getaffinity': not hasattr(os, 'sched_setaffinity') or len(os.sched_getaffinity(0)) < 2,
            'signal.pthread_sigmask': not hasattr(signal, 'pthread_sigmask'),
            'os.getsid': not hasattr(os, 'setsid'), 'os.getpgrp': not hasattr(os, 'setpgid'),
            **{f'resource.{name} soft': resource.getrlimit(getattr(resource, name)) == (0, 0) for name in LIMITS},
            **{f'resource.{name} hard': resource.getrlimit(getattr(resource, name))[1] == 0 for name in LIMITS},
            **{f'signal {int(getattr(signal, name))}': True for name in ('SIGKILL', 'SIGSTOP') if hasattr(signal, name)}}


def _not_here(key):
    if key == 'locale':  # LC_NUMERIC 是 C 時要換到 C.UTF-8（較舊的 glibc 沒有）
        return locale.setlocale(locale.LC_NUMERIC) in ('C', 'POSIX') and subprocess.run(
            [sys.executable, '-c', "import locale; locale.setlocale(locale.LC_NUMERIC, 'C.UTF-8')"], capture_output=True,
            timeout=60).returncode != 0
    return NOT_HERE.get(key, False)


def _attacked(attack):  # 子行程在頂層（工具的第一行之前）多跑那幾行
    top = 'task = json.loads(task)' + NL
    assert ON_DISK.count(top) == 1
    return ON_DISK.replace(top, top + attack + NL)


def _named(folder, changes, job=(), probe=(), crashes=False):
    """每一種改法各開一個子行程（同時跑）：{改法: 比對有沒有點名該點的那一項}。changes 是 {改法: (該點名的項目, 改過的子行程
    程式)}；點名只看比對自己列出的鍵（Differs.keys）。子行程跑不起來時照樣紅，crashes 時算沒點名（這個平台做不到的改法）"""
    def named(name):
        key, child = changes[name]
        try:
            _on_disk(TOOLS_FOLDER, list(job), folder / name, probe=probe, child=child)
        except Differs as error:
            return key in error.keys
        except AssertionError:
            if not crashes:
                raise
        return False
    folder.mkdir()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        return dict(zip(changes, pool.map(named, changes)))


def _missed(folder, changes, job=(), probe=()):  # 改了卻沒有點名該點的那一項的改法
    return [name for name, found in _named(folder, changes, job, probe).items() if not found]


def _probe(folder):  # 什麼都不做的腳本：子行程照 CLI 執行它，三個記錄點都在
    (folder / 'probe.py').write_text('pass' + NL, encoding='utf-8')
    return (str(folder / 'probe.py'),)


def test_each_fingerprint_item_tells_a_changed_child_from_the_cli(tmp_path):
    changes = {key: (key, _attacked(attack)) for key, attack in FINGERPRINT_ATTACKS.items()}
    skipped = {key: changes.pop(key) for key in list(changes) if _not_here(key)}
    changes.update({name: (key, _attacked(attack)) for name, (key, attack) in LIBRARY_LOGGER_ATTACKS.items()})
    assert _missed(tmp_path / 'run', changes, probe=_probe(tmp_path)) == []
    # 跳過的改法在這個平台真的做不到（子行程跑不起來，或那一項沒變）：NOT_HERE 不能把改得到的一項藏起來（第四十一輪確認
    # 審查實測：locale 那一條原本照 LC_CTYPE 是不是 C 跳過，LC_ALL=C 底下其實改得了）
    assert [key for key, found in _named(tmp_path / 'skipped', skipped, probe=_probe(tmp_path), crashes=True).items()
            if found] == []


def test_a_change_that_names_another_item_is_missed(tmp_path, monkeypatch):
    # 點名這個判斷本身的必擋：改 displayhook 的子行程，問的是 excepthook，要算沒點名（CI 上 pytest 不截斷說明也一樣）
    monkeypatch.setenv('CI', 'true')
    changes = {'displayhook-for-excepthook': ('sys.excepthook', _attacked(FINGERPRINT_ATTACKS['sys.displayhook']))}
    assert _missed(tmp_path / 'run', changes, probe=_probe(tmp_path)) == ['displayhook-for-excepthook']


def test_every_fingerprint_item_has_its_attack():
    # 新加一項就要同時加它的必擋改法：指紋的鍵與上面的名單逐一相同；相依的 logger 那幾條點名的都是指紋的鍵
    namespace = {}
    exec(FINGERPRINT, namespace)
    keys = namespace['fingerprint'](first=True)
    assert sorted(keys) == sorted({'sys.path[0]', *FINGERPRINT_ATTACKS})
    assert {key for key, _ in LIBRARY_LOGGER_ATTACKS.values()} <= set(keys)


# 樣本換進去前後的快照，指紋以外的每一項也要擋得下：樣本裡改那一項，samples 要點名那一項（第四十輪確認審查實測：
# snapshot() 回空的字典，整套照樣全綠）。finder 與 path hook 的名字由隔離那一條先擋下，不在這裡；指紋的每一項上面已經
# 測過，這裡另測 stdout、stderr 的編碼與 errors（快照用 first=True，最後一段之前、跑完之後的記錄不比它們）
SNAPSHOT_ATTACKS = {
    'modules': 'import wave',  # 工具與相依都不載入的標準函式庫模組（csv 相依已經載入）
    'argv': "sys.argv.append('--probe')",
    'importer cache': "sys.path_importer_cache['/nonexistent-probe'] = None",
    'builtins': ('import functools' + NL + '_open = builtins.open' + NL  # 名字一樣、物件換了
                 + 'builtins.open = functools.wraps(_open)(lambda *args, **kwargs: _open(*args, **kwargs))'),
    **{f'{stream}.encoding': f"sys.{stream}.reconfigure(encoding='utf-8-sig')" for stream in ('stdout', 'stderr')},
    'stdout.errors': "sys.stdout.reconfigure(errors='backslashreplace')",  # restore 的模組層設成 replace
    'stderr.errors': "sys.stderr.reconfigure(errors='strict')",
}


@pytest.fixture(scope='module')
def one_clean_job(tmp_path_factory):  # 一份頁首正確的卷放進快取：兩個工具都走到擷取（替身）
    folder = tmp_path_factory.mktemp('clean-job')
    exam = samples._two_page_exam(folder)
    cache = folder / 'cache'
    cache.mkdir()
    data = exam.read_bytes()
    (cache / f'{SRC}.pdf').write_bytes(data)
    return [(SRC, str(cache), {**_real_meta(exam), 'sha256': hashlib.sha256(data).hexdigest()})]


def test_the_clean_job_reaches_the_extraction_in_both_tools(tmp_path, one_clean_job):  # 下面那一條的必過
    assert _on_disk(TOOLS_FOLDER, one_clean_job, tmp_path / 'run') == ['走到擷取'] * 2


def test_each_snapshot_item_tells_a_changed_sample(tmp_path, one_clean_job):
    changes = {}
    for key, attack in SNAPSHOT_ATTACKS.items():
        code, child = ''.join('    ' + line + NL for line in attack.split(NL)), ON_DISK
        for sample in ('restore_sample', 'import_sample'):
            start = f'def {sample}(namespace):' + NL + "    seen['namespace'] = namespace" + NL
            assert child.count(start) == 1
            child = child.replace(start, start + code)
        changes[key] = (key, child)
    assert _missed(tmp_path / 'run', changes, job=one_clean_job) == []


def test_a_layout_the_extractor_rejects_stops_with_the_source_named(monkeypatch, tmp_path):
    def reject(path):
        raise ValueError('第 3 頁有 0 張表，應為 1 張。')
    monkeypatch.setattr(R, 'SOURCES', {SRC: META})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.HEADER_READERS, 'ipas_exam_table', reject)  # 讀頁首時就擋下，也要說是哪一份
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_exam_table', reject)
    with pytest.raises(SystemExit, match=f'{SRC}: 第 3 頁有 0 張表'):
        R.extract_sources(tmp_path)
