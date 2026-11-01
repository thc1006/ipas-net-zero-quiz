# explanation_guard 的斷言抽取：解析裡的條號、節號、標準編號……都必須出現在題目或引文裡。
#
# #148 的研究找到的洞：「依 ISO 14064-1 第 8.3 節」整句通過，因為 CLAIM 只認「第N條／項／款／目」，
# 節與帶小數點的節號（8.3、11.2）都不算斷言，寫錯了也沒有人知道。
import pytest

from explanation_guard import check, claims

STEM = '依據 ISO14064-1：2018 之規範，關於「不確定性（Uncertainty）」與「誤差（Error）」，下列敘述何者正確？'


@pytest.mark.parametrize(('explanation', 'claim'), [
    ('依 ISO 14064-1 第 8.3 節，誤差應予以修正。', ('節號', '第8.3節')),
    ('依 ISO 14064-1 第8.3節，誤差應予以修正。', ('節號', '第8.3節')),
    ('依 ISO 14064-1 第８．３節，誤差應予以修正。', ('節號', '第8.3節')),  # 全形數字與點
    ('依標準 8.3 節，誤差應予以修正。', ('節號', '8.3節')),
    ('依標準第五節，誤差應予以修正。', ('節號', '第五節')),
    ('依 ISO 14064-1 Section 8.3，誤差應予以修正。', ('條號(英)', 'Section8.3')),
    ('依 ISO 14064-1 Clause 8.3，誤差應予以修正。', ('條號(英)', 'Clause8.3')),
    ('依巴黎協定第 6.2 條。', ('條號', '第6.2條')),
    ('依年報準則第 10-4 條。', ('條號', '第10-4條')),
    ('依年報準則第 10\u20134 條。', ('條號', '第10\u20134條')),  # 連字號寫成 U+2013
], ids=['節-半形空白', '節-無空白', '節-全形', '無第字的點號節', '中文數字節', 'Section-點號', 'Clause-點號',
        '點號條', '連字號條', 'en-dash條'])
def test_section_numbers_are_claims_and_must_be_in_the_allowed_texts(explanation, claim):
    assert claim in claims(explanation)
    assert claim in check(explanation, [STEM])


@pytest.mark.parametrize(('explanation', 'evidence'), [
    ('依 ISO 14064-1 第 8.3 節，誤差應予以修正。', 'ISO 14064-1 第8.3節 規定誤差應予以修正'),
    ('依標準 8.3 節，誤差應予以修正。', '見 8.3 節'),
    ('依 Section 8.3，誤差應予以修正。', 'Section 8.3 Uncertainty'),
    ('依巴黎協定第 6.2 條。', '第 6.2 條'),
])
def test_a_section_number_that_is_in_the_evidence_passes(explanation, evidence):
    assert check(explanation, [STEM, evidence]) == []


@pytest.mark.parametrize(('explanation', 'evidence'), [
    # 節號不走數字寬容：引文裡有「8.3」不代表有「第 8.3 節」（「18.3%」「8.31」都含 8.3）
    ('依 ISO 14064-1 第 8.3 節，誤差應予以修正。', '不確定性為 18.3%'),
    ('依 ISO 14064-1 第 8.3 節，誤差應予以修正。', '第 8.31 節'),
    ('依 Section 8.3，誤差應予以修正。', 'Section 8.31'),
    ('依標準 8.3 節，誤差應予以修正。', '見 18.3 節'),
    ('依 Section 8.3，誤差應予以修正。', 'Section 8'),  # 以前只抽到 Section8，引文有 Section 8 就過
    ('依 Section 8.3，誤差應予以修正。', 'Section 8.3.1'),  # 後面接「點加數字」是更下一層的節，不是 8.3
])
def test_a_section_number_is_not_matched_by_a_different_number(explanation, evidence):
    assert check(explanation, [STEM, evidence]) != []


def test_numbers_that_are_not_section_numbers_are_unchanged():
    # 一般的小數不是節號：「0.509」「±5%」照舊（百分比照原本的規則）
    text = '電力排放係數為 0.509，±5% 是數值可能的範圍。'
    assert [k for k, _ in claims(text) if k in ('節號', '條號', '條號(英)')] == []
    assert check(text, ['電力排放係數為 0.509', '±5%']) == []


# 比對時保留空白：去掉空白之後，引文裡「Article 6 1. Parties」變成「Article61」，「第 9 條 2026 年」變成
# 「第9條2026」，條號後面像是接著數字，main 通過的解析在這裡被誤判（PR #160 審查）
@pytest.mark.parametrize(('explanation', 'evidence'), [
    ('依 Article 6，締約方可以自願合作。', 'Article 6 1. Parties recognize that some Parties choose'),
    ('依第 9 條，事業要上傳修正後的清冊。', '第 9 條 2026 年起事業應上傳'),
    ('依 §6.3 計算。', '見 §6.3 2 節'),
])
def test_a_number_after_whitespace_does_not_count_as_part_of_the_claim(explanation, evidence):
    assert check(explanation, [evidence]) == []


def test_a_lettered_section_number_is_a_claim():
    # 「B.2.99」這種附錄節號：以前抽不到（數字前面是點）
    assert ('節號', 'B.2.99節') in claims('依 GUM B.2.99 節的定義。')
    assert check('依 GUM B.2.99 節的定義。', ['B.2.19 error (of measurement)']) == [('節號', 'B.2.99節')]
    assert check('依 GUM B.2.19 節的定義。', ['B.2.19 節 error (of measurement)']) == []


@pytest.mark.parametrize(('explanation', 'evidence', 'red'), [
    ('依 8.3 節修正。', '見附錄 B.8.3 節', True),       # 前面是點：不是 8.3 節
    ('依第 8.3 節修正。', '表 1第 8.3 節', False),     # 以「第」開頭的斷言，前面接數字不影響
    ('依 §6.3 計算。', '§6.31', True),                  # § 條號也看後面
    ('依 §6.3 計算。', '§6.3.1', True),
])
def test_the_boundary_checks_each_side_only_where_it_matters(explanation, evidence, red):
    assert (check(explanation, [evidence]) != []) is red


def test_a_bare_number_before_節_needs_a_dot():
    # 沒有「第」字時，只有帶點的「8.3 節」才是節號；「3 節課」不是
    assert [k for k, _ in claims('這一章共有 3 節課。') if k == '節號'] == []


# 英文來源（GUM、ISO）只寫節號、不寫「節」：引文裡有同一個帶點的節號就算有出處（PR #160 審查）
@pytest.mark.parametrize(('explanation', 'evidence', 'red'), [
    ('依 3.2.4 節，已知系統效應要修正。', '3.2.4 It is assumed that the result of a measurement has been corrected', False),
    ('依 ISO 14064-1 第 9.3.1 節，要做查證。', 'ISO 14064-1:2018 9.3.1 Verification', False),
    ('依第 8.3 節，誤差應予以修正。', '8.3 Uncertainty assessment', False),     # 不必有「第」
    ('依 GUM B.2.99 節的定義。', 'B.2.19 error (of measurement)', True),     # 字母開頭的節號要整個對得上
    ('依 8.3 節，誤差應予以修正。', '8.3.1 Uncertainty assessment', True),    # 8.3 不是 8.3.1
    ('依 8.3.1 節，誤差應予以修正。', '8.3 Uncertainty assessment', True),    # 8.3.1 不是 8.3
    ('依第 5 節，誤差應予以修正。', '表 5 列出排放源', True),                 # 沒有點的節號仍要寫著「第 5 節」
    ('依 8.3 節，誤差應予以修正。', 'Table A8.3 shows the budget', True),      # 前面緊接字母：A8.3 不是 8.3
])
def test_a_dotted_section_number_in_an_english_source_supports_the_claim(explanation, evidence, red):
    assert (check(explanation, [evidence]) != []) is red


# 帶點的數字不一定是節號：「2.5kgCO₂e」「8.3%」「4.2 億公噸」是數量。只有像節號的位置才算（PR #160 第二輪內容審查）：
# 引文或其中一行、一句的開頭，Section／Clause／§／第／節之後，大寫的標準編號後面隔一個空白，或後面接「節」；後面接單位就不算
@pytest.mark.parametrize(('explanation', 'evidence', 'red'), [
    ('依第 2.5 節，柴油屬於類別一。', '柴油的排放係數為 2.5kgCO₂e', True),
    ('依第 8.3 節，不確定性要量化。', '不確定性為 8.3%', True),
    ('依第 4.2 節，減碳目標如下。', '減碳 4.2 億公噸', True),
    ('依第 2.5 節，柴油屬於類別一。', '2.5tCO₂e，5tCO₂e', True),          # q008 的選項：開頭的數字後面接單位
    ('依第 3.2.4 節，已知系統效應要修正。', '3.2.4 It is assumed that the result has been corrected', False),
    ('依第３．２．４節，已知系統效應要修正。', '3.2.4 It is assumed that the result has been corrected', False),
    ('依 3.2.4 節，已知系統效應要修正。', 'measurand. 3.2.4 It is assumed that the result has been corrected', False),  # 句子開頭
    ('依 3.2.4 節，已知系統效應要修正。', '如前\n3.2.4 It is assumed', False),   # 一行的開頭
    ('依 3.2.4 節，已知系統效應要修正。', '見 Section 3.2.4', False),
    ('依 3.2.4 節，已知系統效應要修正。', '見 § 3.2.4', False),
    ('依 3.2.4 節，已知系統效應要修正。', '見第 3.2.4 節', False),
    ('依 3.2.4 節，已知系統效應要修正。', '見 3.2.4 節', False),
    ('依 3.2.4 節，已知系統效應要修正。', '量測值為 3.2.4 次', True),         # 句中、後面不是「節」
    ('依 3.2.4 節，已知系統效應要修正。', 'see clause 3.2.4', False),
    ('依 3.2.4 節，已知系統效應要修正。', '本節 3.2.4 說明修正', False),
    ('依 3.2.4 節，已知系統效應要修正。', 'CNS 14064-1 3.2.4 Correction', False),
    ('依 3.2.4 節，已知系統效應要修正。', 'Table 3 3.2.4 shows', True),     # 小寫的字加數字不是標準編號
    ('依 3.2.4 節，已知系統效應要修正。', '修正值 3.2.4 shows', True),
    ('依 8.3 節，不確定性要量化。', '8.3 t of CO2', True),
    ('依 8.3 節，不確定性要量化。', '8.3 to 8.5 Uncertainty', False),      # t 後面接字母就不是公噸
    ('依 8.3 節，不確定性要量化。', '不確定性為 8.3%。8.3 Uncertainty', False),  # 第一處是數量，第二處是節號
    ('依 3.2.4 節，已知系統效應要修正。', '如前所述。3.2.4 It is assumed', False),
    ('依 3.2.4 節，已知系統效應要修正。', '如前所述；3.2.4 It is assumed', True),     # 分號不是句子結束
    ('依 3.2.4 節，已知系統效應要修正。', '３．２．４ It is assumed', False),       # 全形的引文
    ('依 8.3 節，不確定性要量化。', '見附錄 A8.3 節', True),                 # A8.3 不是 8.3
    ('依 3.2 節，已知系統效應要修正。', '第 3.2 條', True),
    ('依第 5 節，不確定性要量化。', '5 Scope of this standard', True),        # 不帶點的節號要原文有「第 5 節」
    ('依 9.3.1 節，查證要確認資料。', 'ISO 14064-1:2018-9.3.1', True),       # 標準編號後面要隔一個空白
    ('依 8.3 節，不確定性要量化。', '8.31 Uncertainty', True),               # 8.31 不是 8.3
])
def test_a_dotted_number_supports_a_section_claim_only_where_it_reads_as_a_section(explanation, evidence, red):
    assert (check(explanation, [evidence]) != []) is red


@pytest.mark.parametrize('unit', ['%', '億', '萬', '千', '百', '兆', '公噸', '噸', '公斤', '公升', '公尺', '公里', '度', '元',
                                  '倍', '年', '個', '項', '次', '人', '家', '°', 'kg', 'g', 't', 'kWh', 'MWh', 'GWh',
                                  'kW', 'MW', 'GW', 'L', 'm'])
def test_a_dotted_number_followed_by_a_unit_is_a_quantity_even_at_the_start(unit):
    assert check('依 2.5 節，柴油屬於類別一。', [f'2.5 {unit} 的柴油']) == [('節號', '2.5節')]
    assert check('依 2.5 節，柴油屬於類別一。', [f'2.5{unit} 的柴油']) == [('節號', '2.5節')]


def test_each_quote_starts_a_new_text_for_the_section_position():
    # 每段引文各自算開頭：第二段引文開頭的節號也算，即使第一段結尾是數字
    assert check('依 3.2.4 節，已知系統效應要修正。', ['排放係數 2', '3.2.4 It is assumed']) == []


def test_the_bank_question_with_2_5_kgco2e_does_not_support_section_2_5():
    stem = ('某企業使用 10,000 度的電力，每度電排放係數為 0.5kgCO₂e，以及 1,000 公升柴油用於發電機，每公升柴油排放係數為 '
            '2.5kgCO₂e。請問該企業上述情境下的類別一、類別二排放量分別為下列何者？')
    options = ['5tCO₂e，2.5tCO₂e', '25tCO₂e，50tCO₂e', '0.5tCO₂e，0.25tCO₂e', '2.5tCO₂e，5tCO₂e']
    assert ('節號', '第2.5節') in check('依第 2.5 節，柴油屬於類別一。', [stem, *options])


# 去掉空白後才相鄰的兩個數字不算同一個號碼：引文「Article 6 1. Parties」裡沒有 Article 61
@pytest.mark.parametrize(('explanation', 'evidence', 'red'), [
    ('依 Article 61，締約方可以自願合作。', 'Article 6 1. Parties recognize', True),
    ('依 Article 6，締約方可以自願合作。', 'Article 6 1. Parties recognize', False),
    ('依 Art. 6，締約方可以自願合作。', 'Art. 6 Parties recognize', False),       # 字與字之間的空白照舊可以
    ('依 §6.3 計算。', '§ 6 .3', True),
    ('依 §6.3 計算。', '§ 6.3', False),
    ('依 §6-3 計算。', '§ 6 - 3', False),                                  # 連字號兩邊可以有空白
])
def test_a_claim_does_not_match_across_whitespace_between_two_numbers(explanation, evidence, red):
    assert (check(explanation, [evidence]) != []) is red
