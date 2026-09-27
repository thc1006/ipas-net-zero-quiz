# normalized_text_sha256() 是還原憑證的內容指紋；quiz-app/src/data/restoration-manifest.test.ts
# 有一份 TS 鏡像，拿它比對題庫有沒有被改過。兩邊只要對某個字元的處理不同，同一道題就會算出
# 不同的指紋，竄改檢查跟著誤判。所以兩邊讀同一份 normalized_text_sha256_vectors.json：
# payload 依規則手寫、sha256 只由 payload 算出，任一邊漂移，該邊的測試就轉紅。
import hashlib
import json
import re
from pathlib import Path

import pytest

from restore_from_source_pdf import normalized_text_payload, normalized_text_sha256

SPEC = json.loads((Path(__file__).resolve().parents[2] / 'quiz-app' / 'src' / 'data' / '__fixtures__'
                   / 'normalized_text_sha256_vectors.json').read_text(encoding='utf-8'))
VECTORS = SPEC['vectors']
IDS = [v['what'] for v in VECTORS]
EVERY_CODE_POINT = ''.join(chr(cp) for cp in range(0x110000) if not 0xD800 <= cp <= 0xDFFF)


def test_the_shared_whitespace_list_is_exactly_what_python_strips():
    # normalized_text_sha256() 用 re 的 \s 剝題幹空白。Python 換了 Unicode 版本、空白定義跟著變時，
    # 這裡先紅，而不是等到兩邊的指紋對不上
    stripped = [f'U+{cp:04X}' for cp in range(0x110000) if re.fullmatch(r'\s', chr(cp))]
    assert stripped == SPEC['python_whitespace']


@pytest.mark.parametrize('vector', VECTORS, ids=IDS)
def test_each_vector_hash_is_the_sha256_of_its_hand_written_payload(vector):
    assert hashlib.sha256(vector['payload'].encode('utf-8')).hexdigest() == vector['sha256']


@pytest.mark.parametrize('vector', VECTORS, ids=IDS)
def test_the_payload_and_the_hash_match_each_vector(vector):
    # 先比 payload：失敗時看得到是哪個字元不同，而不是只有兩串 hash
    assert normalized_text_payload(vector['stem'], vector['options']) == vector['payload']
    assert normalized_text_sha256(vector['stem'], vector['options']) == vector['sha256']


def test_the_every_code_point_hashes_follow_from_the_written_rules():
    # 兩個預期值只由規則推導：題幹去掉 python_whitespace 清單，選項去掉空格、tab、CR、LF。
    # 沒有這條，日後重生 fixture 時若是跑實作得到的，就會變成拿實作驗實作
    whitespace = {int(code[2:], 16) for code in SPEC['python_whitespace']}
    stem_kept = ''.join(ch for ch in EVERY_CODE_POINT if ord(ch) not in whitespace)
    option_kept = ''.join(ch for ch in EVERY_CODE_POINT if ch not in ' \t\r\n')
    expected = SPEC['every_code_point']
    assert hashlib.sha256((stem_kept + '||A:x').encode('utf-8')).hexdigest() == expected['stem_sha256']
    assert hashlib.sha256(('q||A:' + option_kept).encode('utf-8')).hexdigest() == expected['option_sha256']


def test_a_stem_of_every_code_point_loses_exactly_the_whitespace():
    # 函式若多剝任何一個不是空白的字元（例如 U+00AD 軟連字號），這裡就紅
    got = normalized_text_sha256(EVERY_CODE_POINT, [{'key': 'A', 'text': 'x'}])
    assert got == SPEC['every_code_point']['stem_sha256']


def test_an_option_of_every_code_point_loses_exactly_space_tab_cr_lf():
    got = normalized_text_sha256('q', [{'key': 'A', 'text': EVERY_CODE_POINT}])
    assert got == SPEC['every_code_point']['option_sha256']


# TS 鏡像比照這個行為直接失敗（Node 會默默把它換成 U+FFFD，算出另一個指紋）。U+DCFF 在 surrogateescape
# 能編碼的範圍（U+DC80–U+DCFF）裡：編碼改用 surrogateescape 時，這一格會安靜地算出指紋。
@pytest.mark.parametrize(('stem', 'options'), [
    ('a' + chr(0xD800), [{'key': 'A', 'text': 'x'}]),
    ('q', [{'key': 'A', 'text': chr(0xDCFF)}]),
    ('q', [{'key': chr(0xDC00), 'text': 'x'}]),
    ('q' + chr(0xD800) + ' ' + chr(0xDC00), [{'key': 'A', 'text': 'x'}]),  # 剝掉空白也不會變成一對
], ids=['stem', 'option-text', 'option-key', 'high-space-low'])
def test_a_lone_surrogate_cannot_be_fingerprinted(stem, options):
    with pytest.raises(UnicodeEncodeError):
        normalized_text_sha256(stem, options)


def test_option_order_does_not_change_the_hash():
    options = [{'key': 'A', 'text': '甲'}, {'key': 'B', 'text': '乙'}]
    assert normalized_text_sha256('題', options) == normalized_text_sha256('題', options[::-1])


def test_a_changed_option_text_changes_the_hash():
    before = normalized_text_sha256('題', [{'key': 'A', 'text': '甲'}])
    assert normalized_text_sha256('題', [{'key': 'A', 'text': '乙'}]) != before
