# 官方公告試題的匯入：import_official_exam.py 把擷取結果寫成題庫的題目，
# restore_from_source_pdf.py 把它們記進憑證（status: imported，不算還原題）。
# 這裡用一份合成的官方來源測兩邊的行為；真正的 115-01 資料由它自己的 CL 匯入與把關。
import copy
import json

import pytest

import import_official_exam as I
import restore_from_source_pdf as R

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
    return [_question(1, 'C'), _question(2, 'A')]


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
    monkeypatch.setattr(I.ipas_exam_pdf, 'extract', lambda path: copy.deepcopy(official_source))
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
    monkeypatch.setattr(I.ipas_exam_pdf, 'extract', lambda path: copy.deepcopy(official_source))
    assert I.main([SRC, '--cache', str(tmp_path)]) == 0


def test_main_refuses_extra_evidence_for_a_question_that_does_not_exist(official_source, monkeypatch, tmp_path):
    monkeypatch.setitem(I.EXTRA_EVIDENCE, (SRC, 99), [{'url': 'https://x', 'quote': 'q', 'supports_option': 'C'}])
    monkeypatch.setattr(I, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setattr(I.ipas_exam_pdf, 'extract', lambda path: copy.deepcopy(official_source))
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
    monkeypatch.setattr(I.ipas_exam_pdf, 'extract', lambda path: official_source[:1])
    with pytest.raises(SystemExit, match='擷取到 1 題，應為 2 題'):
        I.main([SRC, '--cache', str(tmp_path)])


@pytest.mark.parametrize('source', ['S_CHU_06', 'S_NO_SUCH_SOURCE'], ids=['not-official', 'unknown'])
def test_main_refuses_sources_that_are_not_official_exams(source, tmp_path):
    with pytest.raises(SystemExit, match='不是官方公告試題的來源'):
        I.main([source, '--cache', str(tmp_path)])


# ── 還原工具：官方來源記為 imported，不算還原題 ──────────────────────────────────

def test_official_questions_are_recorded_as_imported(official_source, monkeypatch):
    snapshot = copy.deepcopy(R.load_snapshot())
    snapshot[SRC] = {'pdf_sha256': META['sha256'], 'questions': official_source}
    dataset = R.load_dataset()
    dataset['our_unique_items'] += [I.build_item(SRC, META, q) for q in official_source]
    man = R.assemble(snapshot, dataset)
    mine = [d for d in man['dispositions'] if d['source_id'] == SRC]
    assert [(d['status'], d['item_id'], d['column']) for d in mine] == [
        ('imported', f'{SRC}-q001', None), ('imported', f'{SRC}-q002', None)]
    assert man['_meta']['restored_count'] == 159
    assert man['_meta']['imported_count'] == 2
    assert man['_meta']['disposition_summary']['imported'] == 2
    assert all(e['matches_source'] and not e['transformations'] for e in man['entries'] if e['source_id'] == SRC)


def test_a_source_with_a_layout_nobody_extracts_stops_before_downloading(monkeypatch, tmp_path):
    downloads = []
    monkeypatch.setattr(R, 'SOURCES', {SRC: {**META, 'layout': 'three_column'}})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: downloads.append(src_id))
    with pytest.raises(SystemExit, match=f"{SRC}: 不認得的版面 'three_column'"):
        R.extract_sources(tmp_path)
    assert downloads == []


def test_the_official_layout_is_extracted_with_the_table_extractor(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(R, 'SOURCES', {SRC: META})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_exam_table', lambda path: calls.append(path) or [_question(1)])
    assert R.extract_sources(tmp_path)[SRC]['questions'] == [_question(1)]
    assert calls == [tmp_path / f'{SRC}.pdf']


def test_a_layout_the_extractor_rejects_stops_with_the_source_named(monkeypatch, tmp_path):
    def reject(path):
        raise ValueError('第 3 頁有 0 張表，應為 1 張。')
    monkeypatch.setattr(R, 'SOURCES', {SRC: META})
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    monkeypatch.setitem(R.EXTRACTORS, 'ipas_exam_table', reject)
    with pytest.raises(SystemExit, match=f'{SRC}: 第 3 頁有 0 張表'):
        R.extract_sources(tmp_path)
