# 官方公告試題的匯入：import_official_exam.py 把擷取結果寫成題庫的題目，
# restore_from_source_pdf.py 把它們記進憑證（status: imported，不算還原題）。
# 這裡用一份合成的官方來源測兩邊的行為；真正的 115-01 資料由它自己的 CL 匯入與把關。
import copy
import json
import re

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


def test_every_extra_evidence_entry_belongs_to_an_official_question():
    official = {(s, q['number']) for s, meta in R.SOURCES.items() if meta.get('kind') == 'official_exam'
                for q in R.load_snapshot()[s]['questions']}
    assert sorted(set(I.EXTRA_EVIDENCE) - official) == []


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
