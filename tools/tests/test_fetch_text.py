# fetch_text._to_text 真的把 PDF 讀成文字。
#
# fetch() 吞掉所有例外、回傳空字串（呼叫端當成「無法判斷」）：讀 PDF 的那一行一旦壞掉 —— PyMuPDF 升級改了
# API、打錯函式名稱 —— 交叉比對只會安靜地少驗一批題目。這裡直接呼叫 _to_text，例外不會被吞掉。
import importlib
from pathlib import Path

import pymupdf
import pytest

TOOLS = Path(__file__).resolve().parents[1]


@pytest.fixture
def fetch_text(monkeypatch):
    monkeypatch.syspath_prepend(str(TOOLS))
    return importlib.import_module('fetch_text')


def _pdf(*pages: str) -> bytes:
    doc = pymupdf.open()
    for text in pages:
        doc.new_page().insert_text((72, 72), text)
    return doc.tobytes()


def test_a_pdf_is_read_back_as_text_page_by_page(fetch_text):
    text = fetch_text._to_text(_pdf('emissions shall be excluded', 'second page: Scope 3'), 'application/pdf')
    assert 'emissions shall be excluded' in text and 'second page: Scope 3' in text  # 每一頁都讀，不是只讀第一頁


def test_a_pdf_is_recognised_by_its_magic_bytes_not_by_the_content_type(fetch_text):
    # 伺服器常把 PDF 標成 application/octet-stream
    assert 'Scope 3' in fetch_text._to_text(_pdf('Scope 3'), 'application/octet-stream')


def test_an_html_block_page_is_not_fed_to_the_pdf_reader(fetch_text, monkeypatch):
    # 網址以 .pdf 結尾、伺服器回的卻是 HTML 擋頁：當成 HTML 讀，不是「一頁、零個字」的 PDF。
    # 新版 PyMuPDF 收到 HTML 也會自己認出來、解出同樣的字，所以要直接確認 PDF reader 沒被叫到
    def refuse(*args, **kwargs):
        raise AssertionError('HTML 被送進了 PDF reader')
    monkeypatch.setattr(fetch_text.pymupdf, 'open', refuse)
    assert fetch_text._to_text(b'<html><body>Access denied</body></html>', 'application/pdf').strip() == 'Access denied'
