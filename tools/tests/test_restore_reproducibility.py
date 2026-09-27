# restoration-manifest.json 是 tools/restore_from_source_pdf.py 的產物，不是手寫文件。
#
# 起因：manifest 曾在最後一次 --emit 之後被手工補改（S_CHU_07 的 8 筆 (C) 欄修正、2 筆答案更正、
# q094 的反面證據、_meta 的查核紀錄），工具卻不知道。結果 --verify 與 --emit 都在 S_CHU_07-q030
# 中止 ——「任何人都能重現」在那段期間並不成立，而且沒有任何檢查發現。
#
# CI 不下載 PDF，所以 PDF 的擷取結果以快照（fixtures/restore_source_extract.json）進版控。
# 這裡用快照 + 工具裡的修正表 + 題庫重組整份 manifest，與 committed 的檔案逐字比對：
# 手改 manifest 的任何一個字、改了工具的表或題庫卻沒有重組，這裡都會轉紅。
# 守不到的：快照本身（只能由 --verify 對照 PDF），以及把快照與 manifest 一起改的協同修改。
import copy
import dataclasses
import re
import json

import pytest

import restore_from_source_pdf as R

REASSEMBLE = 'uv run --locked --project tools python tools/restore_from_source_pdf.py --reassemble'


@pytest.fixture(autouse=True)
def never_touch_the_committed_files(monkeypatch, tmp_path_factory):
    # --emit／--reassemble 會改寫 manifest 與快照：每一條測試都改用暫存的副本（內容與 committed 相同），
    # 即使程式被改壞也寫不到真正的檔案
    copies = tmp_path_factory.mktemp('committed')
    for name in ('MANIFEST', 'SNAPSHOT'):
        original = getattr(R, name)
        copy_ = copies / original.name
        copy_.write_bytes(original.read_bytes())
        monkeypatch.setattr(R, name, copy_)


@pytest.fixture(scope='module')
def snapshot():
    return R.load_snapshot()


@pytest.fixture(scope='module')
def dataset():
    return R.load_dataset()


def _question(number, key, text):
    return {'number': number, 'options': [{'key': k, 'text': text if k == key else f'其他{k}'} for k in 'ABCD']}


def _source_questions(src_id):
    """一份來源剛好用完 OPTION_FIXES 表所需的題目（每題的 PDF 原文與表相符）。"""
    return [_question(n, f['key'], f['pdf']) for n, f in R.OPTION_FIXES[src_id]['questions'].items()]


def _pdf_option(snapshot, src_id, number, key):
    q = next(q for q in snapshot[src_id]['questions'] if q['number'] == number)
    return next(o['text'] for o in q['options'] if o['key'] == key)


# ── 離線重現：committed 的檔案必須正好是工具的輸出 ─────────────────────────────

def test_the_committed_manifest_is_exactly_what_the_tool_assembles(snapshot, dataset):
    assert R.render(R.assemble(snapshot, dataset)) == R.MANIFEST.read_text(encoding='utf-8'), (
        'restoration-manifest.json 與工具重組的結果不同。manifest 不可手改。改了題庫（integrated_dataset.json）'
        '或工具裡的表而牽動 manifest：先問專案所有者（AGENTS.md 的升級規則）；核准後跑 '
        f'`{REASSEMBLE}`（離線，不讀 PDF），再用 git diff 確認只有預期的欄位變了。')


def test_the_snapshot_is_in_the_exact_form_emit_writes(snapshot):
    assert R.render(snapshot) == R.SNAPSHOT.read_text(encoding='utf-8')


def test_the_snapshot_covers_every_source_and_is_pinned_to_its_pdf(snapshot):
    message = '來源 PDF 換了或加了來源，要跑 --emit 重新擷取；不可以手改快照'
    assert list(snapshot) == list(R.SOURCES), message
    assert {s: v['pdf_sha256'] for s, v in snapshot.items()} == {s: v['sha256'] for s, v in R.SOURCES.items()}, message


def test_the_snapshot_has_exactly_the_shape_the_extractor_produces(snapshot):
    # 快照只有 --verify 對照 PDF 才驗得完整；這裡先擋掉離線就看得出來的手改：
    # 多出來的鍵、題目或選項的順序被調過、文字不是擷取器會輸出的樣子
    for src_id, source in snapshot.items():
        # 官方來源另記 PDF 的頁首（CI 拿它核對 SOURCES）；圖表題（擷取器對照 PDF 確認、題目欄裡真的有圖的題號）
        # 只在有的時候才寫
        official = R.SOURCES[src_id].get('kind') == 'official_exam'
        base = ['pdf_sha256', 'header', 'questions'] if official else ['pdf_sha256', 'questions']
        assert list(source) in (base, base + ['figure_questions'])
        if official:
            assert list(source['header']) == ['title', 'subject', 'date_line', 'session', 'exam_date', 'subject_code']
            # 場次、考試日期、科目代號是從頁首的三行推出來的：兩邊要對得上（手改其中一邊，離線就看得出來）
            header = source['header']
            derived = R.ipas_exam_pdf._header(header['title'], header['subject'], header['date_line'])
            assert dataclasses.asdict(derived) == header, f'{src_id} 的頁首自相矛盾：快照不可以手改，要跑 --emit'
        if 'figure_questions' in source:
            figures = source['figure_questions']
            assert figures and figures == sorted(set(figures)), f'{src_id} 的圖表題要是遞增、不重複、不是空的'
            assert set(figures) <= {q['number'] for q in source['questions']}, f'{src_id} 的圖表題不是這份的題號'
        numbers = [q['number'] for q in source['questions']]
        assert all(a < b for a, b in zip(numbers, numbers[1:])), '擷取依閱讀順序，題號必須遞增'
        for q in source['questions']:
            assert list(q) == ['number', 'page', 'column', 'answer', 'stem', 'options']
            assert [o['key'] for o in q['options']] == sorted(o['key'] for o in q['options'])
            for o in q['options']:
                assert list(o) == ['key', 'text']
            if R.SOURCES[src_id].get('layout', 'two_column') != 'two_column':
                # _tidy() 是雙欄擷取器的正規化；表格版面（ipas_exam_pdf）有自己的形狀（例如硬換行處留一個空格）
                assert _table_layout_problems(q) == [], f'{src_id} 第 {q["number"]} 題'
                continue
            for text in [q['stem'], *(o['text'] for o in q['options'])]:
                assert R._tidy(text) == text, f'第 {q["number"]} 題的文字不是擷取器的輸出：{text!r}'


def _table_layout_problems(q: dict) -> list[str]:
    # 表格版面（ipas_exam_pdf）擷取出來一定是這個樣子：頁碼從 1 起、沒有欄、答案與選項正好 A–D；
    # 文字是一行、字與字之間最多一個空格、頭尾沒有空白，也沒有擷取器會擋下的特殊字元
    problems = []
    if type(q['page']) is not int or q['page'] < 1:
        problems.append(f'page {q["page"]!r} 不是從 1 起的頁碼')
    if q['column'] is not None:
        problems.append(f'column {q["column"]!r}：表格版面沒有欄')
    if q['answer'] not in ('A', 'B', 'C', 'D'):
        problems.append(f'答案 {q["answer"]!r} 不是 A–D')
    if [o['key'] for o in q['options']] != ['A', 'B', 'C', 'D']:
        problems.append('選項不是正好 A–D')
    for text in [q['stem'], *(o['text'] for o in q['options'])]:
        if not re.fullmatch(r'\S+(?: \S+)*', text):
            problems.append(f'文字的空白或斷行不是擷取器的輸出：{text!r}')
        elif odd := R.ipas_exam_pdf._odd_character(text):
            problems.append(f'文字有擷取器會擋下的特殊字元 {odd}：{text!r}')
    return problems


TABLE_QUESTION = {'number': 8, 'page': 2, 'column': None, 'answer': 'C', 'stem': '每公升柴油排放 0.5kgCO₂e，下列何者正確？',
                  'options': [{'key': k, 'text': f'選項 {k}（ISO 14064-1）'} for k in 'ABCD']}


def test_the_table_layout_shape_passes_what_the_extractor_writes():
    assert _table_layout_problems(TABLE_QUESTION) == []


@pytest.mark.parametrize(('change', 'problem'), [
    ({'page': 0}, 'page'),
    ({'page': '2'}, 'page'),
    ({'column': 'left'}, 'column'),
    ({'answer': 'E'}, '答案'),
    ({'answer': 'AB'}, '答案'),
    ({'options': [{'key': k, 'text': '選項'} for k in 'ABC']}, '選項不是正好 A–D'),
    ({'options': [{'key': k, 'text': '選項'} for k in 'ABDC']}, '選項不是正好 A–D'),
    ({'stem': '題幹  兩個空白'}, '空白或斷行'),
    ({'stem': ' 題幹'}, '空白或斷行'),
    ({'stem': '題幹 '}, '空白或斷行'),
    ({'stem': '題幹\n第二行'}, '空白或斷行'),
    ({'stem': '題幹\u3000全形空白'}, '空白或斷行'),
    ({'stem': ''}, '空白或斷行'),
    ({'options': [{'key': k, 'text': '選項\u200b'} for k in 'ABCD']}, '特殊字元'),
], ids=['page-0', 'page-as-text', 'column', 'answer-e', 'two-answers', 'three-options', 'options-out-of-order',
        'double-space', 'leading-space', 'trailing-space', 'newline', 'ideographic-space', 'empty', 'zero-width'])
def test_the_table_layout_shape_blocks_hand_edits(change, problem):
    # 快照只有 --verify 對照 PDF 才驗得完整；離線看得出來的手改在這裡先擋
    problems = _table_layout_problems({**TABLE_QUESTION, **change})
    assert any(problem in p for p in problems), problems


def test_assemble_does_not_modify_its_input(snapshot, dataset):
    before = copy.deepcopy(snapshot)
    R.assemble(snapshot, dataset)
    assert snapshot == before


# ── assemble() 自己擋下的錯（這些規則寫在工具裡，每一條都要有會觸發它的測試）──────

def test_a_declared_fix_that_changes_nothing_is_refused(snapshot, dataset, monkeypatch):
    # raw ≠ canonical ⟺ 有列明的修正。表上多一筆「改了等於沒改」的修正，就是紀錄與事實不符
    # （用錯位區段以外的第 20 題：區段內的題目都被別列的 printed_from 指著，加上去會先撞到那條自洽檢查；
    #   所以這裡把區段放寬到第 20 題，讓它只剩「改了等於沒改」這一個問題）
    fixes = copy.deepcopy(R.OPTION_FIXES)
    same = _pdf_option(snapshot, 'S_CHU_07', 20, 'C')
    fixes['S_CHU_07']['misaligned'] = (20, 40)
    fixes['S_CHU_07']['questions'][20] = {'key': 'C', 'printed_from': 37, 'pdf': same, 'fixed': same}
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match='raw≠canonical=False'):
        R.assemble(snapshot, dataset)


def test_a_change_that_nobody_declared_is_refused(snapshot, dataset, monkeypatch):
    # 另一個方向：修正確實改了文字，卻沒有留下 transformation（藏起來的手腳）
    real = R.patch_pdf_typos

    def silent(qs, src_id):
        real(qs, src_id)  # S_CHU_06 第 37 題的選項標號照樣被改 ……
        return []         # …… 卻沒有任何紀錄
    monkeypatch.setattr(R, 'patch_pdf_typos', silent)
    with pytest.raises(SystemExit, match='raw≠canonical=True'):
        R.assemble(snapshot, dataset)


def test_a_fix_on_a_question_that_is_not_in_the_bank_is_refused(snapshot, dataset, monkeypatch):
    # S_CHU_07 第 32 題沒有進題庫；修正只記在進題庫的題目上，修它就不會留下任何紀錄
    # 這一列本身是對的（第 32 題印的「ISO9001」是第 33 題的 (C)，本題的 (C) 是第 31 題印出來的那個），
    # 所以表是自洽的；錯的只有「修了一題不在題庫裡的題目」
    fixes = copy.deepcopy(R.OPTION_FIXES)
    printed = _pdf_option(snapshot, 'S_CHU_07', 32, 'C')
    fixes['S_CHU_07']['questions'][32] = {'key': 'C', 'printed_from': 33, 'pdf': printed,
                                          'fixed': fixes['S_CHU_07']['questions'][31]['pdf']}
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match='OPTION_FIXES 修了一題沒有進題庫的題目'):
        R.assemble(snapshot, dataset)


def test_a_typo_fix_on_a_question_that_is_not_in_the_bank_is_refused(snapshot, dataset):
    without_q037 = copy.deepcopy(dataset)
    without_q037['our_unique_items'] = [i for i in without_q037['our_unique_items']
                                        if i['item_id'] != 'S_CHU_06-q037']
    with pytest.raises(SystemExit, match=r'PDF 錯字修正（patch_pdf_typos） 修了一題沒有進題庫的題目'):
        R.assemble(snapshot, without_q037)


@pytest.mark.parametrize(('dead', 'message'), [
    (('ANSWER_OVERRIDES', ('S_CHU_07', 13)), '修正表的這些題目不在題庫裡'),     # 這一題沒有進題庫（重複題）
    (('ANSWER_OVERRIDES', ('S_CHU_07', 71)), '修正表有對不到任何來源題的項目'),  # 超出 PDF 的題號
    (('ANSWER_OVERRIDES', ('S_CHU_7', 30)), '修正表有對不到任何來源題的項目'),   # 來源代號打錯
    (('OPTION_FIXES', 'S_CHU_7'), '修正表有對不到任何來源題的項目'),             # 整張表的來源代號打錯
], ids=['override-not-in-bank', 'override-out-of-range', 'override-unknown-source', 'fixes-unknown-source'])
def test_a_table_entry_that_matches_nothing_is_refused(snapshot, dataset, monkeypatch, dead, message):
    table, key = dead
    patched = copy.deepcopy(getattr(R, table))
    patched[key] = (copy.deepcopy(R.ANSWER_OVERRIDES[('S_CHU_07', 30)]) if table == 'ANSWER_OVERRIDES'
                    else copy.deepcopy(R.OPTION_FIXES['S_CHU_07']))
    monkeypatch.setattr(R, table, patched)
    with pytest.raises(SystemExit, match=message):
        R.assemble(snapshot, dataset)


@pytest.mark.parametrize(('key', 'ok'), [
    (('S_CHU_06', 1), True), (('S_CHU_06', 100), True),     # 第一題與最後一題都是合法的鍵
    (('S_CHU_06', 0), False), (('S_CHU_06', 101), False), (('S_CHU_6', 1), False),
], ids=['first', 'last', 'zero', 'past-the-end', 'unknown-source'])
def test_a_table_key_names_a_source_question(key, ok):
    assert R._source_question(key) is ok


@pytest.mark.parametrize(('item_id', 'message'), [
    ('S_CHU_07-q031', r'S_CHU_07-q031: OPTION_FIXES 修了一題沒有進題庫的題目 —— 題目被刪了？誤刪請還原'),
    ('S_CHU_06-q037', r'S_CHU_06-q037: PDF 錯字修正（patch_pdf_typos） 修了一題沒有進題庫的題目 —— 題目被刪了？'),
    ('S_CHU_06-q002', r'題庫誤刪了？還原它們(?s:.*)S_CHU_06#2'),
], ids=['with-option-fix', 'with-pdf-typo-fix', 'plain'])
def test_a_restored_question_deleted_from_the_bank_is_asked_about_first(snapshot, dataset, item_id, message):
    changed = copy.deepcopy(dataset)
    changed['our_unique_items'] = [i for i in changed['our_unique_items'] if i['item_id'] != item_id]
    with pytest.raises(SystemExit, match=message):
        R.assemble(snapshot, changed)


def test_a_restored_question_deleted_from_the_bank_is_named_before_its_override(snapshot, dataset):
    # 題庫誤刪一題帶 override 的還原題：鍵本身是對的，要先說「那一題不在題庫裡」，而不是叫人去檢查鍵
    changed = copy.deepcopy(dataset)
    changed['our_unique_items'] = [i for i in changed['our_unique_items'] if i['item_id'] != 'S_CHU_06-q094']
    with pytest.raises(SystemExit, match=r"修正表的這些題目不在題庫裡：\['S_CHU_06-q094'\] —— .*被刪了"):
        R.assemble(snapshot, changed)


def test_a_question_deleted_from_a_reprinted_pair_is_reported_as_lost(snapshot, dataset):
    # S_CHU_06 第 66 題是第 47 題的重印（本來就是丟棄題）。從題庫刪掉 q047 時，兩題不能互相記成重印 ——
    # 只有後面那一題能指向前面那一題，否則「不會安靜掉題」這個保證就破了（審查實測：改成 != 時全綠）
    changed = copy.deepcopy(dataset)
    changed['our_unique_items'] = [i for i in changed['our_unique_items'] if i['item_id'] != 'S_CHU_06-q047']
    with pytest.raises(SystemExit, match=r'S_CHU_06#47'):
        R.assemble(snapshot, changed)


def test_a_pin_moved_onto_a_reprint_is_reported_as_the_pin_not_as_a_lost_question(snapshot, dataset, monkeypatch):
    pins = dict(R.DATASET_DUPLICATES)
    pins[('S_CHU_06', 66)] = pins.pop(('S_CHU_07', 13))  # 登記寫到一題 PDF 自己重印的題目上
    monkeypatch.setattr(R, 'DATASET_DUPLICATES', pins)
    with pytest.raises(SystemExit, match=r"DATASET_DUPLICATES 有用不到的項目：\[\('S_CHU_06', 66\)\]"):
        R.assemble(snapshot, dataset)


def test_an_answer_that_departs_from_the_pdf_without_an_override_is_refused(snapshot, dataset):
    changed = copy.deepcopy(dataset)
    item = next(i for i in changed['our_unique_items'] if i['item_id'] == 'S_CHU_06-q001')
    item['answer'] = 'A' if item['answer'] != 'A' else 'B'
    with pytest.raises(SystemExit, match='沒有列在 ANSWER_OVERRIDES'):
        R.assemble(snapshot, changed)


def test_an_override_that_repeats_the_pdf_answer_is_refused(snapshot, dataset, monkeypatch):
    overrides = copy.deepcopy(R.ANSWER_OVERRIDES)
    overrides[('S_CHU_06', 94)]['corrected_answer'] = overrides[('S_CHU_06', 94)]['source_answer_key']
    monkeypatch.setattr(R, 'ANSWER_OVERRIDES', overrides)
    with pytest.raises(SystemExit, match='override 的更正答案與來源相同'):
        R.assemble(snapshot, dataset)


def test_an_override_the_bank_no_longer_follows_is_refused(snapshot, dataset):
    # 題庫把答案改回 PDF 印的 D，卻留著「更正為 C」的 override：那筆紀錄已經不是事實
    reverted = copy.deepcopy(dataset)
    next(i for i in reverted['our_unique_items'] if i['item_id'] == 'S_CHU_06-q094')['answer'] = 'D'
    with pytest.raises(SystemExit, match='已列 override'):
        R.assemble(snapshot, reverted)


def test_a_restored_question_missing_from_the_bank_is_reported_as_lost(snapshot, dataset):
    lost = copy.deepcopy(dataset)
    lost['our_unique_items'] = [i for i in lost['our_unique_items'] if i['item_id'] != 'S_CHU_06-q002']
    with pytest.raises(SystemExit, match='S_CHU_06#2'):
        R.assemble(snapshot, lost)


def test_an_override_that_misquotes_the_pdf_answer_is_refused(snapshot, dataset, monkeypatch):
    overrides = copy.deepcopy(R.ANSWER_OVERRIDES)
    overrides[('S_CHU_06', 94)]['source_answer_key'] = 'A'
    monkeypatch.setattr(R, 'ANSWER_OVERRIDES', overrides)
    with pytest.raises(SystemExit, match='override 宣稱來源答案是 A'):
        R.assemble(snapshot, dataset)


def test_a_question_count_for_a_source_that_is_not_registered_is_refused(snapshot, dataset, monkeypatch):
    # 以前只有「disposition 數 != 來源總題數」擋它，訊息看不出原因，而且沒有任何測試走得到
    monkeypatch.setitem(R.EXPECTED_QUESTION_COUNT, 'S_CHU_08', 5)
    with pytest.raises(SystemExit, match=r"EXPECTED_QUESTION_COUNT 有不在 SOURCES 裡的來源 \['S_CHU_08'\]"):
        R.assemble(snapshot, dataset)


def test_a_hand_edited_snapshot_is_named_as_a_possible_cause(snapshot, dataset):
    # --reassemble 與測試讀的是擷取快照：題號不對時，除了擷取器，快照被手改過也是一種可能
    broken = copy.deepcopy(snapshot)
    broken['S_CHU_06']['questions'] = broken['S_CHU_06']['questions'][:-1]
    with pytest.raises(SystemExit, match=r'擷取結果有 99 題（應為 100）：缺題號 \[100\] —— 擷取器壞了.*擷取快照被手改'):
        R.assemble(broken, dataset)


def test_a_repeated_question_number_is_reported_as_an_extractor_failure(snapshot, dataset):
    broken = copy.deepcopy(snapshot)
    questions = broken['S_CHU_06']['questions']
    questions[1] = copy.deepcopy(questions[0])  # 題數沒少，但第 2 題變成第二個第 1 題
    with pytest.raises(SystemExit, match=r'缺題號 \[2\]、題號重複 \[1\] —— 擷取器壞了'):
        R.assemble(broken, dataset)


def test_a_question_number_out_of_range_is_reported_as_an_extractor_failure(snapshot, dataset):
    broken = copy.deepcopy(snapshot)
    broken['S_CHU_06']['questions'][-1]['number'] = 101
    with pytest.raises(SystemExit, match=r'缺題號 \[100\]、題號超出 1–100 \[101\]'):
        R.assemble(broken, dataset)


def test_a_lost_question_is_reported_before_the_fix_tables_complain(snapshot, dataset):
    broken = copy.deepcopy(snapshot)
    broken['S_CHU_07']['questions'] = [q for q in broken['S_CHU_07']['questions'] if q['number'] != 31]
    # 第 31 題也在 OPTION_FIXES 表上：題數對帳必須先發生，錯誤訊息才會指向擷取器
    with pytest.raises(SystemExit, match=r'缺題號 \[31\] —— 擷取器壞了'):
        R.assemble(broken, dataset)


@pytest.mark.parametrize('field', ['items', 'subject'])
def test_source_reviews_cannot_overwrite_the_derived_fields(snapshot, dataset, monkeypatch, field):
    reviews = copy.deepcopy(R.SOURCE_REVIEWS)
    reviews['S_CHU_06'][field] = 'x'
    monkeypatch.setattr(R, 'SOURCE_REVIEWS', reviews)
    with pytest.raises(SystemExit, match='items／subject'):
        R.assemble(snapshot, dataset)


def test_every_source_needs_a_review(snapshot, dataset, monkeypatch):
    reviews = dict(R.SOURCE_REVIEWS)
    del reviews['S_CHU_06']
    monkeypatch.setattr(R, 'SOURCE_REVIEWS', reviews)
    with pytest.raises(SystemExit, match=r"\['S_CHU_06'\] 沒有人工查核紀錄"):
        R.assemble(snapshot, dataset)


def test_source_reviews_must_name_a_known_source(snapshot, dataset, monkeypatch):
    reviews = copy.deepcopy(R.SOURCE_REVIEWS)
    reviews['S_CHU_99'] = {'status': 'x'}
    monkeypatch.setattr(R, 'SOURCE_REVIEWS', reviews)
    with pytest.raises(SystemExit, match='不在 SOURCES 裡的來源'):
        R.assemble(snapshot, dataset)


# ── --verify、--emit、--reassemble（以快照代替下載 PDF）───────────────────────

@pytest.fixture
def offline(monkeypatch, snapshot):
    """讓 extract_sources() 回傳快照（可先改壞），並記下它被呼叫了幾次。"""
    extracted = copy.deepcopy(snapshot)
    calls = []

    def fake_extract(cache):
        calls.append(cache)
        return copy.deepcopy(extracted)

    monkeypatch.setattr(R, 'extract_sources', fake_extract)
    return extracted, calls


def test_verify_passes_on_the_committed_files(offline, tmp_path, capsys):
    assert R.verify(tmp_path) == 0
    meta = json.loads(R.MANIFEST.read_text(encoding='utf-8'))['_meta']
    assert (f'{meta["restored_count"] + meta["imported_count"]} 題全部與來源 PDF 相符（還原 {meta["restored_count"]} 題'
            in capsys.readouterr().out)


def test_verify_accepts_a_crlf_working_tree(offline, tmp_path, monkeypatch):
    # 專案在 Windows 上以 core.autocrlf=true 開發：工作區的 JSON 是 CRLF，不可以因此判定不符
    crlf = tmp_path / 'restoration-manifest.json'
    crlf.write_bytes(R.MANIFEST.read_text(encoding='utf-8').replace('\n', '\r\n').encode('utf-8'))
    monkeypatch.setattr(R, 'MANIFEST', crlf)
    assert R.verify(tmp_path) == 0


def test_verify_fails_when_the_manifest_was_edited_by_hand(offline, tmp_path, monkeypatch, capsys):
    edited = tmp_path / 'restoration-manifest.json'
    man = json.loads(R.MANIFEST.read_text(encoding='utf-8'))
    dropped = next(d for d in man['dispositions'] if d['status'] != 'restored')
    dropped['evidence'] = '手改的說明'
    edited.write_text(R.render(man), encoding='utf-8')
    monkeypatch.setattr(R, 'MANIFEST', edited)
    assert R.verify(tmp_path) == 1
    out = capsys.readouterr().out
    assert 'restoration-manifest.json 與重跑結果不同' in out
    # 差異要印出來，而且標明是 committed 那一邊（-）多出來的內容
    assert [line.strip()[:1] for line in out.splitlines() if '手改的說明' in line] == ['-']


def test_verify_says_so_when_only_the_final_newline_differs(offline, tmp_path, monkeypatch, capsys):
    edited = tmp_path / 'restoration-manifest.json'
    edited.write_text(R.MANIFEST.read_text(encoding='utf-8').rstrip('\n'), encoding='utf-8')
    monkeypatch.setattr(R, 'MANIFEST', edited)
    assert R.verify(tmp_path) == 1
    assert '只差在檔尾換行' in capsys.readouterr().out


def test_verify_says_so_when_the_file_starts_with_a_bom(offline, tmp_path, monkeypatch, capsys):
    edited = tmp_path / 'restoration-manifest.json'
    edited.write_text(chr(0xFEFF) + R.MANIFEST.read_text(encoding='utf-8'), encoding='utf-8')
    monkeypatch.setattr(R, 'MANIFEST', edited)
    assert R.verify(tmp_path) == 1
    assert '檔案開頭有 BOM' in capsys.readouterr().out


def test_verify_counts_bank_text_that_drifted_from_the_source(offline, snapshot, tmp_path, monkeypatch, capsys):
    drifted = R.load_dataset()
    item = next(i for i in drifted['our_unique_items'] if i['item_id'] == 'S_CHU_06-q001')
    item['stem'] += '（改過）'
    monkeypatch.setattr(R, 'load_dataset', lambda: drifted)
    # committed 的 manifest 也跟著改過（例如有人手動重組過）：兩個檔都對得上，只剩 drift 這一個問題
    agreeing = tmp_path / 'restoration-manifest.json'
    agreeing.write_text(R.render(R.assemble(snapshot, drifted)), encoding='utf-8')
    monkeypatch.setattr(R, 'MANIFEST', agreeing)
    assert R.verify(tmp_path) == 1
    assert '有 1 題的 repo 內容與來源不一致' in capsys.readouterr().out


def test_verify_fails_when_the_manifest_is_missing(offline, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(R, 'MANIFEST', tmp_path / 'no-such-manifest.json')
    assert R.verify(tmp_path) == 1
    assert '檔案不存在' in capsys.readouterr().out


def test_verify_fails_when_the_pdf_text_no_longer_matches_the_snapshot(offline, tmp_path, capsys):
    extracted, _ = offline
    q = next(q for q in extracted['S_CHU_06']['questions'] if q['number'] == 1)
    q['stem'] += '（PDF 換了版本）'
    assert R.verify(tmp_path) == 1
    out = capsys.readouterr().out
    assert 'restore_source_extract.json 與重跑結果不同' in out
    assert 'S_CHU_06-q001' in out  # repo 的文字不再等於來源


def test_emit_extracts_again_and_writes_exactly_the_committed_files(offline, tmp_path, monkeypatch):
    _, calls = offline
    committed = {R.SNAPSHOT: R.SNAPSHOT.read_text(encoding='utf-8'),
                 R.MANIFEST: R.MANIFEST.read_text(encoding='utf-8')}
    written = {name: tmp_path / name.name for name in committed}
    monkeypatch.setattr(R, 'SNAPSHOT', written[R.SNAPSHOT])
    monkeypatch.setattr(R, 'MANIFEST', written[R.MANIFEST])
    assert R.main(['--emit', '--cache', str(tmp_path / 'cache')]) == 0
    assert len(calls) == 1  # 真的重新擷取了，不是讀 committed 的快照
    for original, text in committed.items():
        assert written[original].read_text(encoding='utf-8') == text
        assert b'\r' not in written[original].read_bytes()  # 任何平台都寫 LF


def test_reassemble_rebuilds_the_manifest_without_reading_any_pdf(offline, tmp_path, monkeypatch):
    _, calls = offline
    committed = R.MANIFEST.read_text(encoding='utf-8')
    target = tmp_path / 'restoration-manifest.json'
    monkeypatch.setattr(R, 'MANIFEST', target)
    assert R.main(['--reassemble']) == 0
    assert calls == []
    assert target.read_text(encoding='utf-8') == committed
    assert b'\r' not in target.read_bytes()  # 任何平台都寫 LF


def test_emit_writes_nothing_when_the_extractor_lost_a_question(offline, tmp_path, monkeypatch):
    # 擷取器掉題：那份快照本身就是錯的，寫出去之後 --reassemble 只會永遠報同一個錯（第四輪審查實測過）
    extracted, _ = offline
    extracted['S_CHU_07']['questions'] = [q for q in extracted['S_CHU_07']['questions'] if q['number'] != 31]
    targets = {'SNAPSHOT': tmp_path / 'snapshot.json', 'MANIFEST': tmp_path / 'manifest.json'}
    for name, path in targets.items():
        monkeypatch.setattr(R, name, path)
    with pytest.raises(SystemExit, match=r'缺題號 \[31\] —— 擷取器壞了'):
        R.main(['--emit', '--cache', str(tmp_path / 'cache')])
    assert not any(p.exists() for p in targets.values())


def test_emit_names_a_source_without_a_question_count_instead_of_crashing(offline, tmp_path, monkeypatch):
    # 新增來源時跑的正是 --emit：以前在寫檔前的題號對帳丟出 KeyError traceback，走不到 assemble() 那句說明
    extracted, _ = offline
    extracted['S_NEW'] = {'pdf_sha256': '0' * 64, 'questions': []}
    monkeypatch.setitem(R.SOURCES, 'S_NEW', {'url': 'https://example.org/new.pdf', 'sha256': '0' * 64,
                                             'title': '新的來源', 'exam_subject': '考科1'})
    targets = {'SNAPSHOT': tmp_path / 'snapshot.json', 'MANIFEST': tmp_path / 'manifest.json'}
    for name, path in targets.items():
        monkeypatch.setattr(R, name, path)
    with pytest.raises(SystemExit, match=r"\['S_NEW'\] 沒有登記總題數"):
        R.main(['--emit', '--cache', str(tmp_path / 'cache')])
    assert not any(p.exists() for p in targets.values())


def test_no_action_creates_no_cache_directory(tmp_path, monkeypatch):
    monkeypatch.setattr(R.Path, 'home', lambda: tmp_path)
    assert R.main([]) == 1
    assert not (tmp_path / '.cache').exists()


def test_verify_says_which_kind_of_problem_it_found(offline, snapshot, tmp_path, monkeypatch, capsys):
    # 兩個檔都與重跑結果相同、只有題庫文字與來源不一致時，結論不可以說「committed 的檔案不同」
    drifted = R.load_dataset()
    next(i for i in drifted['our_unique_items'] if i['item_id'] == 'S_CHU_06-q001')['stem'] += '（改過）'
    monkeypatch.setattr(R, 'load_dataset', lambda: drifted)
    agreeing = tmp_path / 'restoration-manifest.json'
    agreeing.write_text(R.render(R.assemble(snapshot, drifted)), encoding='utf-8')
    monkeypatch.setattr(R, 'MANIFEST', agreeing)
    assert R.verify(tmp_path) == 1
    last = capsys.readouterr().out.strip().splitlines()[-1]
    assert last == '✗ 1 項不符 —— 題庫的文字與來源不一致'


def test_emit_writes_the_snapshot_but_not_a_manifest_that_would_record_a_problem(offline, tmp_path, monkeypatch,
                                                                                    capsys):
    # 來源改版：新擷取的題幹與題庫對不上。manifest 不能寫（那是要先處理的問題），但快照要寫 ——
    # 否則維護者看不到新版到底改了什麼，也就無從照著改題庫（第三輪審查實測過這條死路）。
    extracted, _ = offline
    next(q for q in extracted['S_CHU_06']['questions'] if q['number'] == 1)['stem'] += '（來源改版）'
    targets = {'SNAPSHOT': tmp_path / 'snapshot.json', 'MANIFEST': tmp_path / 'manifest.json'}
    for name, path in targets.items():
        monkeypatch.setattr(R, name, path)
    with pytest.raises(SystemExit, match='不寫 manifest'):
        R.main(['--emit', '--cache', str(tmp_path / 'cache')])
    assert targets['SNAPSHOT'].read_text(encoding='utf-8') == R.render(extracted)
    assert not targets['MANIFEST'].exists()
    assert '已寫入新的擷取快照' in capsys.readouterr().err


def test_reassemble_refuses_a_snapshot_that_no_longer_matches_sources(tmp_path, monkeypatch, snapshot):
    stale = copy.deepcopy(snapshot)
    stale['S_CHU_06']['pdf_sha256'] = '0' * 64
    monkeypatch.setattr(R, 'load_snapshot', lambda: stale)
    monkeypatch.setattr(R, 'MANIFEST', tmp_path / 'manifest.json')
    with pytest.raises(SystemExit, match='擷取快照與 SOURCES 對不上'):
        R.main(['--reassemble'])
    assert not (tmp_path / 'manifest.json').exists()


def test_reassemble_refuses_to_record_bank_text_that_drifted(tmp_path, monkeypatch):
    drifted = R.load_dataset()
    next(i for i in drifted['our_unique_items'] if i['item_id'] == 'S_CHU_06-q001')['stem'] += '（改過）'
    monkeypatch.setattr(R, 'load_dataset', lambda: drifted)
    monkeypatch.setattr(R, 'MANIFEST', tmp_path / 'manifest.json')
    with pytest.raises(SystemExit, match='不寫 manifest'):
        R.main(['--reassemble'])
    assert not (tmp_path / 'manifest.json').exists()


@pytest.mark.parametrize('flags', [['--emit', '--verify'], ['--emit', '--reassemble'], ['--verify', '--reassemble']],
                         ids=['emit+verify', 'emit+reassemble', 'verify+reassemble'])
def test_only_one_action_at_a_time(flags):
    with pytest.raises(SystemExit) as stopped:
        R.main(flags)
    assert stopped.value.code == 2  # argparse：互斥的參數


def test_cache_only_goes_with_actions_that_read_pdfs(tmp_path):
    with pytest.raises(SystemExit) as stopped:
        R.main(['--reassemble', '--cache', str(tmp_path)])
    assert stopped.value.code == 2


def test_no_action_prints_help_and_fails(capsys):
    assert R.main([]) == 1
    assert '--reassemble' in capsys.readouterr().out


def test_verify_from_the_command_line_uses_the_given_cache(offline, tmp_path, capsys):
    _, calls = offline
    cache = tmp_path / 'not-yet-created'
    assert R.main(['--verify', '--cache', str(cache)]) == 0
    assert calls == [cache] and cache.is_dir()  # 真的用了指定的快取目錄，而且沒有就建立
    entries = len(json.loads(R.MANIFEST.read_text(encoding='utf-8'))['entries'])
    assert f'{entries} 題全部與來源 PDF 相符' in capsys.readouterr().out


def test_verify_from_the_command_line_fails_when_the_pdf_changed(offline, tmp_path):
    extracted, _ = offline
    next(q for q in extracted['S_CHU_06']['questions'] if q['number'] == 1)['stem'] += '（PDF 換了版本）'
    assert R.main(['--verify', '--cache', str(tmp_path)]) == 1


def test_verify_says_so_when_the_manifest_is_not_utf8(offline, tmp_path, monkeypatch, capsys):
    # Windows 的編輯器以 cp950 另存：要說清楚，不是丟一個 UnicodeDecodeError 的 traceback
    cp950 = tmp_path / 'restoration-manifest.json'
    cp950.write_bytes(R.MANIFEST.read_text(encoding='utf-8').encode('cp950', errors='replace'))
    monkeypatch.setattr(R, 'MANIFEST', cp950)
    assert R.verify(tmp_path) == 1
    assert '不是 UTF-8' in capsys.readouterr().out


@pytest.mark.parametrize('action', ['--emit', '--reassemble'])
def test_every_write_uses_lf_on_any_platform(offline, tmp_path, monkeypatch, action):
    # Linux 上寫出來的位元組本來就是 LF，驗不出 newline 參數有沒有傳：直接看每一次寫檔傳了什麼
    newlines = []
    real = R.Path.write_text

    def spy(self, data, *args, **kwargs):
        newlines.append((self.name, kwargs.get('newline')))
        return real(self, data, *args, **kwargs)
    monkeypatch.setattr(R.Path, 'write_text', spy)  # 寫到的是 autouse fixture 準備的暫存副本
    R.main([action] + (['--cache', str(tmp_path / 'cache')] if action == '--emit' else []))
    assert newlines and all(nl == '\n' for _, nl in newlines), newlines


# ── 來源 PDF 的快取：sha256 不符就中止，壞掉的下載不留在快取裡 ─────────────────────────

class _Download:
    def __init__(self, data):
        self.data = data

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.data


def test_a_cached_pdf_with_the_wrong_sha256_stops_everything(tmp_path):
    # 快取檔壞了（例如舊版工具先寫快取才驗 sha256）不等於來源變了：叫人刪掉快取重跑，而不是說錨點失效
    (tmp_path / 'S_CHU_06.pdf').write_bytes(b'not the pinned pdf')
    with pytest.raises(SystemExit, match=r'S_CHU_06 快取的 .*S_CHU_06\.pdf sha256 不符(?s:.*)刪掉它再重跑') as e:
        R.load_pdf('S_CHU_06', tmp_path)
    assert '錨點失效' not in str(e.value)


@pytest.mark.parametrize(('body', 'message'), [
    (b'<html><body>Request unsuccessful. Incapsula incident</body></html>', r'不是 PDF(?s:.*)擋頁'),
    (b'%PDF-1.7 a different pdf\n%%EOF\n', r'是完整的 PDF(?s:.*)來源檔案已變動'),
    (b'%PDF-1.7 the first 60% of the pinned pdf', r'檔尾沒有 %%EOF(?s:.*)截斷'),
], ids=['block-page', 'changed-pdf', 'truncated-pdf'])
def test_a_download_with_the_wrong_sha256_is_not_cached(tmp_path, monkeypatch, body, message):
    # sha256 不符不一定是來源變了：網站的擋頁、被截斷的回應也會不符。訊息要說出拿到的是什麼
    monkeypatch.setattr(R.urllib.request, 'urlopen', lambda url, timeout: _Download(body))
    with pytest.raises(SystemExit, match=rf'下載的檔案 sha256 不符，沒有放進快取（{len(body)} bytes）(?s:.*){message}'):
        R.load_pdf('S_CHU_06', tmp_path)
    assert not (tmp_path / 'S_CHU_06.pdf').exists()  # 下一次不會讀到這份壞掉的檔案


def test_a_download_with_the_right_sha256_is_cached(tmp_path, monkeypatch):
    data = b'the pinned pdf'
    monkeypatch.setitem(R.SOURCES, 'S_CHU_06', {**R.SOURCES['S_CHU_06'], 'sha256': R.sha256_bytes(data)})
    monkeypatch.setattr(R.urllib.request, 'urlopen', lambda url, timeout: _Download(data))
    assert R.load_pdf('S_CHU_06', tmp_path) == data
    assert (tmp_path / 'S_CHU_06.pdf').read_bytes() == data


def test_extract_sources_keeps_only_the_snapshot_fields(monkeypatch, tmp_path):
    # 擷取器多吐的欄位（例如解析段落 note）不進快照；pdf_sha256 取自 SOURCES，不是自己算
    monkeypatch.setattr(R, 'load_pdf', lambda src_id, cache: b'')
    question = {'number': 1, 'page': 1, 'column': 'left', 'answer': 'A', 'stem': '題幹',
                'options': [{'key': 'A', 'text': '甲'}], 'note': '解析'}
    for layout in R.EXTRACTORS:  # 每一種版面的擷取器都一樣：只留快照的欄位
        monkeypatch.setitem(R.EXTRACTORS, layout, lambda path: [dict(question)])
    monkeypatch.setattr(R, 'check_official_header', lambda src_id, meta, header: None)  # 頁首另有測試
    for layout in R.HEADER_READERS:
        monkeypatch.setitem(R.HEADER_READERS, layout, lambda path: None)
    out = R.extract_sources(tmp_path)
    assert list(out) == list(R.SOURCES)
    for src_id, source in out.items():
        assert source['pdf_sha256'] == R.SOURCES[src_id]['sha256']
        assert source['questions'] == [{k: v for k, v in question.items() if k != 'note'}]


# ── 快照必須正好對應 SOURCES ─────────────────────────────────────────────────────────

@pytest.mark.parametrize('change', ['missing-source', 'extra-source', 'different-pdf'])
def test_a_snapshot_that_does_not_match_sources_is_refused(snapshot, change):
    stale = copy.deepcopy(snapshot)
    if change == 'missing-source':
        del stale['S_CHU_07']
    elif change == 'extra-source':
        stale['S_OTHER'] = {'pdf_sha256': '0' * 64, 'questions': []}
    else:
        stale['S_CHU_07']['pdf_sha256'] = '0' * 64
    with pytest.raises(SystemExit, match='擷取快照與 SOURCES 對不上'):
        R.check_snapshot(stale)


def test_the_committed_snapshot_matches_sources(snapshot):
    R.check_snapshot(snapshot)  # 不中止


# ── 丟棄題：配對與答案一致由 DATASET_DUPLICATES 登記，不在每次重組時重猜 ──────────────────

def _gist(ds, ref):
    return next(g for g in ds['gist_items'] if f"gist_items[{g['index']}]" == ref)


def _disposition(man, src_id, number):
    return next(d for d in man['dispositions']
                if d['source_id'] == src_id and d['source_question_number'] == number)


def test_rewording_the_stem_or_a_distractor_of_a_bank_twin_is_not_an_answer_conflict(snapshot, dataset):
    # 第三輪審查的情境 B：合法地改寫主庫那一題的題幹與誘答選項。以前會硬轉紅，而且報成「題目遺失」。
    reworded = copy.deepcopy(dataset)
    twin = _gist(reworded, 'gist_items[408]')
    next(o for o in twin['options'] if o['key'] == 'A')['text'] = '生物源的溫室氣體排放量'
    twin['stem'] = '依 ISO 14064-1:2018，組織的溫室氣體報告中，下列哪一項不在強制揭露之列？'
    man = R.assemble(snapshot, reworded)
    R.refuse_to_write(man)  # 不中止
    d = _disposition(man, 'S_CHU_07', 13)
    assert (d['status'], d['answers_agree'], d['duplicate_of']) == (
        'duplicate_in_dataset', True, {'dataset_item': 'gist_items[408]'})
    assert man['_meta']['answer_conflicts'] == []


def test_the_evidence_says_how_alike_the_two_stems_are(snapshot, dataset):
    # 不計空白與標點完全相同的說「題幹相同」，其餘 0.8 以上的說「題幹幾乎相同」（以前 1.0 也寫幾乎相同）
    man = R.assemble(snapshot, dataset)
    said = {n: _disposition(man, 'S_CHU_07', n)['evidence'].split('。')[0] for n in (13, 23, 32)}
    assert said == {13: '題幹幾乎相同', 23: '題幹幾乎相同', 32: '題幹相同（不計空白與標點）'}


@pytest.mark.parametrize(('source', 'twin', 'similarity', 'said'), [
    ('甲乙丙', '甲乙丙', 1.0, '題幹相同（不計空白與標點）'),
    ('甲' * 200, '甲' * 199 + '乙', 0.995, '題幹幾乎相同'),  # 相似度四捨五入之後近 1，題幹卻不相同
    ('甲' * 2000, '甲' * 1999 + '乙', 1.0, '題幹幾乎相同'),  # 四捨五入到三位就是 1.0，題幹還是不相同
    ('甲乙丙丁', '甲乙丙戊', 0.8, '題幹幾乎相同'),
    ('甲乙丙丁', '戊己庚辛', 0.79, '主庫那一題的題幹已改寫'),
], ids=['equal', 'one-character-apart', 'rounded-to-one', 'at-the-threshold', 'below-the-threshold'])
def test_the_evidence_wording_follows_the_stems_not_the_rounded_similarity(source, twin, similarity, said):
    assert R._how_alike(source, twin, similarity) == said


def test_stems_equal_except_for_spaces_and_punctuation_are_the_same(snapshot, dataset):
    # 「題幹相同」比的是正規化之後（不計空白與標點）：主庫那一題多了空白與標點，仍寫「題幹相同」
    ref = _disposition(R.assemble(snapshot, dataset), 'S_CHU_07', 32)['duplicate_of']['dataset_item']
    reworded = copy.deepcopy(dataset)
    twin = next(it for it in reworded['gist_items'] + reworded['our_unique_items'] if R._dataset_ref(it) == ref)
    twin['stem'] = ' ' + twin['stem'] + ' 。'  # 原文不同，正規化之後相同
    d = _disposition(R.assemble(snapshot, reworded), 'S_CHU_07', 32)
    assert d['evidence'].startswith('題幹相同（不計空白與標點）。')


def test_a_bank_twin_whose_stem_was_rewritten_says_so(snapshot, dataset):
    # 題幹改寫到不像了，配對仍由登記表決定；說明文字不再宣稱「題幹幾乎相同」
    reworded = copy.deepcopy(dataset)
    _gist(reworded, 'gist_items[408]')['stem'] = '下列哪一個選項，組織可以不必在報告裡交代？'
    d = _disposition(R.assemble(snapshot, reworded), 'S_CHU_07', 13)
    assert d['status'] == 'duplicate_in_dataset' and d['stem_similarity'] < 0.8
    assert d['evidence'].startswith('主庫那一題的題幹已改寫。兩邊是同一題、答案一致，由人登記（DATASET_DUPLICATES')


def _swap_texts(twin, a, b):
    oa = next(o for o in twin['options'] if o['key'] == a)
    ob = next(o for o in twin['options'] if o['key'] == b)
    oa['text'], ob['text'] = ob['text'], oa['text']


# 第四輪審查的情境：只核對字母時，這些都寫得出一份宣稱「答案一致」的 manifest，
# 而主庫其實已經在教別的答案（P1 正是當初這道稽核抓到的那個錯答案）
@pytest.mark.parametrize('change, what', [
    (lambda ds: _gist(ds, 'gist_items[408]').__setitem__('answer', 'B'), '主庫那一題的正解字母'),
    (lambda ds: _swap_texts(_gist(ds, 'gist_items[408]'), 'C', 'D'), '主庫那一題正解選項的文字'),
    (lambda ds: [_swap_texts(_gist(ds, 'gist_items[430]'), k, 'D') for k in 'ABC'], '主庫那一題正解選項的文字'),
    (lambda ds: next(o for o in _gist(ds, 'gist_items[408]')['options'] if o['key'] == 'D').__setitem__(
        'text', '電力之處理方式'), '主庫那一題正解選項的文字'),
], ids=['answer-letter', 'swap-C-D', 'rotate-options', 'rewrite-the-answer'])
def test_a_changed_answer_in_a_bank_twin_is_an_answer_conflict(snapshot, dataset, tmp_path, monkeypatch,
                                                             change, what):
    changed = copy.deepcopy(dataset)
    change(changed)
    man = R.assemble(snapshot, changed)
    [key] = man['_meta']['answer_conflicts']
    d = next(d for d in man['dispositions'] if f"{d['source_id']}#{d['source_question_number']}" == key)
    assert (d['status'], d['answers_agree']) == ('duplicate_in_dataset_ANSWER_CONFLICT', False)
    assert what in d['evidence']
    with pytest.raises(SystemExit, match=rf"答案衝突 \[{key!r}\].*DATASET_DUPLICATES.*{what}"):
        R.refuse_to_write(man)
    # --reassemble 也不寫
    monkeypatch.setattr(R, 'load_dataset', lambda: changed)
    monkeypatch.setattr(R, 'MANIFEST', tmp_path / 'manifest.json')
    with pytest.raises(SystemExit, match='答案衝突'):
        R.main(['--reassemble'])
    assert not (tmp_path / 'manifest.json').exists()


def test_a_bank_twin_replaced_by_another_question_is_an_answer_conflict(snapshot, dataset):
    changed = copy.deepcopy(dataset)
    twin = next(i for i in changed['our_unique_items'] if i['item_id'] == 'S_YAMOL_018-q002')
    other = next(i for i in changed['our_unique_items'] if i['item_id'] == 'S_CHU_06-q001')
    twin.update(stem=other['stem'], options=copy.deepcopy(other['options']), answer=other['answer'])
    man = R.assemble(snapshot, changed)
    assert man['_meta']['answer_conflicts'] == ['S_CHU_07#32']


@pytest.mark.parametrize('change, what', [
    (lambda q: q.__setitem__('answer', 'C'), '來源 PDF 的答案卡'),
    (lambda q: q.__setitem__('stem', q['stem'] + '（改版）'), '來源那一題的內容'),
], ids=['answer-key', 'question-text'])
def test_a_changed_source_question_is_an_answer_conflict(snapshot, dataset, change, what):
    # 來源改版（--emit 重新擷取）時：同一個題號印了別的答案卡或別的題目，登記的配對就不再成立
    changed = copy.deepcopy(snapshot)
    change(next(q for q in changed['S_CHU_07']['questions'] if q['number'] == 13))
    man = R.assemble(changed, dataset)
    assert man['_meta']['answer_conflicts'] == ['S_CHU_07#13']
    assert what in _disposition(man, 'S_CHU_07', 13)['evidence']


def test_a_ref_that_names_two_bank_items_is_refused(snapshot, dataset):
    doubled = copy.deepcopy(dataset)
    doubled['gist_items'].append(copy.deepcopy(_gist(doubled, 'gist_items[408]')))
    with pytest.raises(SystemExit, match=r'gist_items\[408\] 重複，主庫卻找到 2 題叫這個名字'):
        R.assemble(snapshot, doubled)


def test_verify_reports_answer_conflicts(offline, snapshot, dataset, tmp_path, monkeypatch, capsys):
    changed = copy.deepcopy(dataset)
    _gist(changed, 'gist_items[408]')['answer'] = 'B'
    monkeypatch.setattr(R, 'load_dataset', lambda: changed)
    # committed 的 manifest 也跟著改過：兩個檔都對得上，只剩答案衝突這一個問題
    agreeing = tmp_path / 'restoration-manifest.json'
    agreeing.write_text(R.render(R.assemble(snapshot, changed)), encoding='utf-8')
    monkeypatch.setattr(R, 'MANIFEST', agreeing)
    assert R.verify(tmp_path) == 1
    assert '有 1 題丟棄題的答案卡與它對應的題目不一致' in capsys.readouterr().out


def test_a_reprinted_question_with_a_different_answer_key_is_an_answer_conflict(snapshot, dataset):
    # 同一份 PDF 重印的兩題答案卡不同：PDF 自己前後矛盾，丟掉哪一題都等於替另一題背書。
    # 工具目前沒有登記這種裁決的地方 —— 訊息必須照實說，不能指向行不通的補救（第四輪審查實測過）
    reprinted = copy.deepcopy(snapshot)
    q66 = next(q for q in reprinted['S_CHU_06']['questions'] if q['number'] == 66)
    q66['answer'] = next(k for k in 'ABCD' if k != q66['answer'])
    man = R.assemble(reprinted, dataset)
    assert _disposition(man, 'S_CHU_06', 66)['status'] == 'duplicate_within_source_ANSWER_CONFLICT'
    with pytest.raises(SystemExit, match=r"答案衝突 \['S_CHU_06#66'\].*工具目前沒有登記這種裁決的地方"):
        R.refuse_to_write(man)


def test_a_dropped_question_nobody_paired_is_reported_as_lost(snapshot, dataset, monkeypatch):
    pins = dict(R.DATASET_DUPLICATES)
    del pins[('S_CHU_07', 13)]
    monkeypatch.setattr(R, 'DATASET_DUPLICATES', pins)
    with pytest.raises(SystemExit, match=r'S_CHU_07#13（最接近的主庫題目：gist_items\[408\]'):
        R.assemble(snapshot, dataset)


def test_a_pin_to_a_bank_item_that_no_longer_exists_is_refused(snapshot, dataset, monkeypatch):
    pins = {**R.DATASET_DUPLICATES, ('S_CHU_07', 13): {**R.DATASET_DUPLICATES[('S_CHU_07', 13)],
                                                       'dataset_item': 'gist_items[99999]'}}
    monkeypatch.setattr(R, 'DATASET_DUPLICATES', pins)
    with pytest.raises(SystemExit, match=r'S_CHU_07#13：DATASET_DUPLICATES 登記它與 gist_items\[99999\] 重複'):
        R.assemble(snapshot, dataset)


@pytest.mark.parametrize(('key', 'message'), [
    (('S_CHU_06', 1), 'DATASET_DUPLICATES 有對不到的項目'),    # 那一題在題庫裡：迴圈之前就擋
    (('S_CHU_7', 13), 'DATASET_DUPLICATES 有對不到的項目'),    # 來源代號打錯
    (('S_CHU_06', 101), 'DATASET_DUPLICATES 有對不到的項目'),  # 題號超出範圍
    (('S_CHU_06', 66), 'DATASET_DUPLICATES 有用不到的項目'),   # PDF 自己重印的題目：要跑完才知道
], ids=['restored-question', 'misspelt-source', 'out-of-range', 'reprint-within-the-pdf'])
def test_a_pin_that_matches_no_dropped_question_is_refused(snapshot, dataset, monkeypatch, key, message):
    pins = {**R.DATASET_DUPLICATES, key: {'dataset_item': 'gist_items[408]', 'dataset_answer': 'D',
                                          'decided_on': '2026-09-28', 'why': 'x'}}
    monkeypatch.setattr(R, 'DATASET_DUPLICATES', pins)
    with pytest.raises(SystemExit, match=message):
        R.assemble(snapshot, dataset)


@pytest.mark.parametrize('wrong', [('S_CHU_7', 13), ('S_CHU_07', 12)], ids=['source', 'number'])
def test_a_misspelt_pin_key_is_reported_as_the_typo_not_as_a_lost_question(snapshot, dataset, monkeypatch, wrong):
    pins = dict(R.DATASET_DUPLICATES)
    pins[wrong] = pins.pop(('S_CHU_07', 13))
    monkeypatch.setattr(R, 'DATASET_DUPLICATES', pins)
    with pytest.raises(SystemExit, match=rf"DATASET_DUPLICATES 有對不到的項目：\[{re.escape(repr(wrong))}\]"):
        R.assemble(snapshot, dataset)


def test_a_misspelt_override_key_is_reported_as_the_typo_not_as_a_missing_override(snapshot, dataset, monkeypatch):
    overrides = dict(R.ANSWER_OVERRIDES)
    overrides[('S_CHU_7', 30)] = overrides.pop(('S_CHU_07', 30))
    monkeypatch.setattr(R, 'ANSWER_OVERRIDES', overrides)
    with pytest.raises(SystemExit, match="對不到任何來源題的項目：.*'S_CHU_7', 30"):
        R.assemble(snapshot, dataset)


@pytest.mark.parametrize('item_id', ['S_CHU_06-q001', 'S_CHU_07-q030'], ids=['plain', 'carries-a-fix'])
def test_a_bank_item_whose_id_matches_no_source_question_is_refused(snapshot, dataset, item_id):
    # item_id 打錯（少了補零）的題目，以前會被當成「沒進題庫」的來源題，再被配對成它自己的重複；
    # 帶修正的題目（S_CHU_07 第 30 題）則會被報成「修正表修了沒有進題庫的題目」。兩種都要指向 item_id。
    misnamed = copy.deepcopy(dataset)
    item = next(i for i in misnamed['our_unique_items'] if i['item_id'] == item_id)
    item['item_id'] = item_id.replace('-q0', '-q')
    with pytest.raises(SystemExit, match=rf"對不到來源的任何一題：\[{item['item_id']!r}\]"):
        R.assemble(snapshot, misnamed)


def test_a_source_without_an_expected_question_count_is_refused(snapshot, dataset, monkeypatch):
    monkeypatch.delitem(R.EXPECTED_QUESTION_COUNT, 'S_CHU_07')
    with pytest.raises(SystemExit, match=r"\['S_CHU_07'\] 沒有登記總題數"):
        R.assemble(snapshot, dataset)


def test_drift_in_a_question_that_carries_a_declared_fix_is_refused(snapshot, dataset):
    # 有 transformations 的題目（S_CHU_06 第 37 題改過選項標號）也一樣：題庫必須等於「來源 + 已列明的修正」
    drifted = copy.deepcopy(dataset)
    item = next(i for i in drifted['our_unique_items'] if i['item_id'] == 'S_CHU_06-q037')
    item['options'][0]['text'] += '（改過）'
    man = R.assemble(snapshot, drifted)
    entry = next(e for e in man['entries'] if e['item_id'] == 'S_CHU_06-q037')
    assert entry['transformations'] and not entry['matches_source']
    with pytest.raises(SystemExit, match=r"題庫的文字與來源不一致 \['S_CHU_06-q037'\]"):
        R.refuse_to_write(man)


# ── OPTION_FIXES：只改表上記的那一格，而且要先確認 PDF 原文 ─────────────────────

def test_option_fix_rewrites_exactly_the_listed_option():
    src_id = next(iter(R.OPTION_FIXES))
    qs = _source_questions(src_id)
    before = copy.deepcopy(qs)
    applied = R.apply_option_fixes(qs, src_id)
    assert sorted(applied) == sorted(R.OPTION_FIXES[src_id]['questions'])
    for q, old in zip(qs, before):
        f = R.OPTION_FIXES[src_id]['questions'][q['number']]
        for o, o_old in zip(q['options'], old['options']):
            assert o['text'] == (f['fixed'] if o['key'] == f['key'] else o_old['text'])


def test_option_fix_refuses_unexpected_pdf_text():
    src_id = next(iter(R.OPTION_FIXES))
    qs = _source_questions(src_id)
    key = R.OPTION_FIXES[src_id]['questions'][qs[0]['number']]['key']
    next(o for o in qs[0]['options'] if o['key'] == key)['text'] += '（不同）'
    # 其他題都正確，只有這一題的 PDF 原文與表不同：必須因為「原文不符」而中止，不是別的原因
    with pytest.raises(SystemExit, match='實際擷取到'):
        R.apply_option_fixes(qs, src_id)


def test_option_fix_refuses_a_question_without_the_listed_option():
    src_id = next(iter(R.OPTION_FIXES))
    qs = _source_questions(src_id)
    key = R.OPTION_FIXES[src_id]['questions'][qs[0]['number']]['key']
    qs[0]['options'] = [o for o in qs[0]['options'] if o['key'] != key]
    with pytest.raises(SystemExit, match='實際擷取到 None'):
        R.apply_option_fixes(qs, src_id)


def test_option_fix_names_a_row_missing_a_template_field(monkeypatch):
    src_id = next(iter(R.OPTION_FIXES))
    fixes = copy.deepcopy(R.OPTION_FIXES)
    first = next(iter(fixes[src_id]['questions']))
    del fixes[src_id]['questions'][first]['printed_from']
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match=f'第 {first} 題：OPTION_FIXES 這一列沒有 printed_from'):
        R.apply_option_fixes(_source_questions(src_id), src_id)


def test_option_fix_templates_fill_only_the_row_fields(monkeypatch):
    # 說明文字裡其他的大括號（「{GWP}」、單獨一個「}」）原樣保留，不被當成模板欄位
    src_id = next(iter(R.OPTION_FIXES))
    fixes = copy.deepcopy(R.OPTION_FIXES)
    fixes[src_id]['why'] = '印的是「{pdf}」，第 {printed_from} 題的 ({key})；{GWP} 與 } 原樣保留'
    fixes[src_id]['evidence'] = '更正為「{fixed}」{ 與 {CO2}、{CO2_EQ}、{1, 2} 原樣保留'
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    applied = R.apply_option_fixes(_source_questions(src_id), src_id)
    for n, f in fixes[src_id]['questions'].items():
        [t] = applied[n]
        assert t['why'] == f'印的是「{f["pdf"]}」，第 {f["printed_from"]} 題的 ({f["key"]})；{{GWP}} 與 }} 原樣保留'
        assert t['evidence'] == f'更正為「{f["fixed"]}」{{ 與 {{CO2}}、{{CO2_EQ}}、{{1, 2}} 原樣保留'


@pytest.mark.parametrize('typo', ['printed_frm', 'printedFrom', 'Key', 'PDF', 'PRINTED_FROM', 'PRINTED_FRM',
                                  'printed-from', ' key ', 'pdf1'])
def test_option_fix_templates_refuse_a_misspelt_field(monkeypatch, typo):
    # 「{printed_frm}」以前會原樣寫進 manifest 的每一筆 transformation，沒有任何錯誤；
    # 大小寫打錯的也一樣（全大寫的欄位名也算）。全大寫、又不是欄位名的「{GWP}」不是模板欄位（見上一條）。
    src_id = next(iter(R.OPTION_FIXES))
    fixes = copy.deepcopy(R.OPTION_FIXES)
    fixes[src_id]['why'] = f'本題印的是第 {{{typo}}} 題的 (C)'
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match=rf"模板用到不認得的欄位 \['{typo}'\]"):
        R.apply_option_fixes(_source_questions(src_id), src_id)


@pytest.mark.parametrize('field', ['key', 'pdf', 'fixed'])
def test_option_fix_names_a_row_missing_a_field(monkeypatch, field):
    # 以前表的自洽檢查先讀了這些欄位：缺了就是一個沒有指名來源與題號的 KeyError
    questions = _source_questions('S_CHU_07')
    fixes = copy.deepcopy(R.OPTION_FIXES)
    del fixes['S_CHU_07']['questions'][33][field]
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match=rf"S_CHU_07 第 33 題：OPTION_FIXES 這一列缺少 \['{field}'\]"):
        R.apply_option_fixes(questions, 'S_CHU_07')


@pytest.mark.parametrize('value', [30, [30], [30, 40, 50], ['30', 40], [40, 30], None, [True, 40]],
                         ids=['a-number', 'one', 'three', 'text', 'reversed', 'none', 'bool'])
def test_option_fix_misaligned_must_be_two_question_numbers(monkeypatch, value):
    # 以前格式不對就是 TypeError（沒有指名是哪一份來源、哪一欄）
    fixes = copy.deepcopy(R.OPTION_FIXES)
    fixes['S_CHU_07']['misaligned'] = value
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match=r'S_CHU_07：OPTION_FIXES 的 misaligned 是 .+，應是錯位區段的頭尾兩個題號'):
        R.apply_option_fixes(_source_questions('S_CHU_07'), 'S_CHU_07')


@pytest.mark.parametrize('missing', ['why', 'evidence', 'decided_on', 'misaligned'])
def test_option_fix_table_missing_a_key_is_refused(monkeypatch, missing):
    src_id = next(iter(R.OPTION_FIXES))
    fixes = copy.deepcopy(R.OPTION_FIXES)
    del fixes[src_id][missing]
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match=f"OPTION_FIXES 的表缺少 \\['{missing}'\\]"):
        R.apply_option_fixes(_source_questions(src_id), src_id)


# printed_from 記的是「本題印的選項其實是哪一題的」。S_CHU_07 第 30 題印的 (C) 是第 31 題的 (C)，
# 而第 31 題也在表上 —— 所以表內就能自證：第 30 題的 pdf 必須等於第 31 題的 fixed。
@pytest.mark.parametrize('printed_from, message', [
    (29, 'printed_from=29，應是第 30–40 題中的另一題'),
    (41, 'printed_from=41，應是第 30–40 題中的另一題'),
    (30, 'printed_from=30，應是第 30–40 題中的另一題'),
    (33, 'printed_from=33，但本題印的「功能單位或宣告單位」不是第 33 題更正後的'),
], ids=['before-the-block', 'after-the-block', 'itself', 'another-row-that-does-not-match'])
def test_option_fix_printed_from_must_agree_with_the_table(monkeypatch, printed_from, message):
    fixes = copy.deepcopy(R.OPTION_FIXES)
    assert fixes['S_CHU_07']['questions'][30]['printed_from'] == 31  # 案例建立在這一列上
    fixes['S_CHU_07']['questions'][30]['printed_from'] = printed_from
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match=f'S_CHU_07 第 30 題：{message}'):
        R.apply_option_fixes(_source_questions('S_CHU_07'), 'S_CHU_07')


def test_option_fix_refuses_unused_table_entries():
    src_id = next(iter(R.OPTION_FIXES))
    with pytest.raises(SystemExit, match='沒用到的題號'):
        R.apply_option_fixes(_source_questions(src_id)[1:], src_id)


def test_option_fix_does_not_touch_sources_without_a_table():
    q = _question(30, 'C', '任意')
    assert R.apply_option_fixes([q], 'S_OTHER') == {}
    assert q['options'][2]['text'] == '任意'


# 反方向：第 33 題印的「場址特定數據」正是第 34 題更正後的 (C)，所以 printed_from 只能是 34。
# 以前只要指向區段內、但不在表上的題目（32、37、39），任何一列都改得動，而所有測試照樣全綠。
@pytest.mark.parametrize('row, wrong', [(33, 37), (34, 39), (35, 37), (40, 39)])
def test_option_fix_printed_from_must_point_at_the_row_whose_fix_it_printed(monkeypatch, row, wrong):
    fixes = copy.deepcopy(R.OPTION_FIXES)
    fixes['S_CHU_07']['questions'][row]['printed_from'] = wrong
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match=rf'S_CHU_07 第 {row} 題：本題印的「.+」正是第 \d+ 題更正後的 \(C\)，printed_from 卻是 {wrong}'):
        R.apply_option_fixes(_source_questions('S_CHU_07'), 'S_CHU_07')


def test_option_fix_rows_that_point_outside_the_table_are_pinned():
    # 這三列印的 (C) 來自不在表上的題目，表內無從自證：依據是乾淨版本 190841777.pdf
    # （第 31 題印的「內外部議題」是第 32 題的 (C)；第 36、38 題印的是第 37、39 題的 (C)）。
    # 改了這三個數字，就要重新對照乾淨版本 —— 這裡把它們釘住，改了就轉紅。
    rows = R.OPTION_FIXES['S_CHU_07']['questions']
    assert {n: rows[n]['printed_from'] for n in (31, 36, 38)} == {31: 32, 36: 37, 38: 39}


def test_option_fix_rows_must_lie_in_the_misaligned_block(monkeypatch):
    fixes = copy.deepcopy(R.OPTION_FIXES)
    fixes['S_CHU_07']['questions'][20] = {'key': 'C', 'printed_from': 37, 'pdf': 'x', 'fixed': 'y'}
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match=r'第 \[20\] 題不在錯位的區段第 30–40 題裡'):
        R.apply_option_fixes(_source_questions('S_CHU_07'), 'S_CHU_07')


@pytest.mark.parametrize('value', [None, '31', 31.0, True], ids=['none', 'string', 'float', 'bool'])
def test_printed_from_must_be_a_question_number(monkeypatch, value):
    # 寫成 None 會同時跳過兩個方向的檢查、manifest 寫出「第 None 題」；寫成字串會丟出沒有指名的 TypeError
    fixes = copy.deepcopy(R.OPTION_FIXES)
    fixes['S_CHU_07']['questions'][30]['printed_from'] = value
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match=f'S_CHU_07 第 30 題：printed_from 是 {value!r}，應是題號'):
        R.apply_option_fixes(_source_questions('S_CHU_07'), 'S_CHU_07')


def test_a_duplicate_in_the_bank_carries_the_registered_reason(snapshot, dataset):
    # 配對由人登記（DATASET_DUPLICATES）：manifest 上的證據要寫出登記的日期與理由，
    # 不是一句「比對的是選項文字」—— 工具早就不再自己比對
    man = R.assemble(snapshot, dataset)
    dups = [d for d in man['dispositions'] if d['status'] == 'duplicate_in_dataset']
    assert dups, '沒有 duplicate_in_dataset —— 這條測試在空轉'
    for d in dups:
        pin = R.DATASET_DUPLICATES[(d['source_id'], d['source_question_number'])]
        assert pin['decided_on'] in d['evidence'] and pin['why'] in d['evidence'], d['evidence']
        assert '比對的是選項文字' not in d['evidence']


def _fix_table(rows):
    return {'why': 'w', 'evidence': 'e', 'decided_on': '2026-09-28', 'misaligned': (1, 9), 'questions': rows}


def test_option_fix_rows_about_different_options_do_not_vouch_for_each_other():
    # 表內自證只在同一個選項之間成立：第 2 題修的是 (B)，它更正後的文字與第 1 題印的 (C) 無關
    R._check_option_fix_table(_fix_table({
        1: {'key': 'C', 'printed_from': 2, 'pdf': '甲', 'fixed': '乙'},
        2: {'key': 'B', 'printed_from': 3, 'pdf': '丙', 'fixed': '丁'},
    }), 'S_TEST')


def test_the_reverse_check_only_looks_at_rows_about_the_same_option():
    # 第 3 題更正後的 (B) 碰巧就是第 1 題印在 (C) 的文字：選項不同，不算「本題印的就是它」
    R._check_option_fix_table(_fix_table({
        1: {'key': 'C', 'printed_from': 2, 'pdf': '甲', 'fixed': '乙'},
        3: {'key': 'B', 'printed_from': 4, 'pdf': '丙', 'fixed': '甲'},
    }), 'S_TEST')


def test_an_empty_option_fix_table_is_refused(monkeypatch):
    fixes = copy.deepcopy(R.OPTION_FIXES)
    fixes['S_CHU_07']['questions'] = {}
    monkeypatch.setattr(R, 'OPTION_FIXES', fixes)
    with pytest.raises(SystemExit, match='OPTION_FIXES 的表沒有任何一題'):
        R.apply_option_fixes([], 'S_CHU_07')
