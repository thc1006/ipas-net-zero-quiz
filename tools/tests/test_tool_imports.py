# tools/*.py 用到的每一個第三方套件，都必須是 pyproject.toml 宣告的直接相依，並從 uv.lock 鎖定的環境載入。
#
# 起因：fetch_text.py 用 PyMuPDF 讀 PDF，卻沒有任何相依清單列出它；而 fetch() 把 ImportError
# 吞掉，PDF 來源就安靜地變成「抓不到文字」—— 交叉比對少驗一批題目，沒有任何紅燈。
# 所以這裡用 ast 找出所有 import（含函式裡延後的 import），在鎖定的環境裡逐一真的 import 一次。
import ast
import importlib
import re
import sys
import tomllib
from importlib.metadata import packages_distributions
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
LOCAL_MODULES = {p.stem for p in TOOLS.glob('*.py')}


def _top_level_imports(path: Path) -> set[str]:
    names = set()
    # read_bytes：Windows 編輯器常加的 UTF-8 BOM 交給 ast 處理，不會被當成語法錯誤
    for node in ast.walk(ast.parse(path.read_bytes(), filename=str(path))):
        if isinstance(node, ast.Import):
            names.update(alias.name.split('.')[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module.split('.')[0])
    return names


def _normalized(name: str) -> str:
    return re.sub(r'[-_.]+', '-', name).lower()


THIRD_PARTY = sorted(
    {name for path in TOOLS.glob('*.py') for name in _top_level_imports(path)}
    - set(sys.stdlib_module_names)
    - LOCAL_MODULES
)
DECLARED = {_normalized(re.match(r'[A-Za-z0-9._-]+', dep).group())
            for dep in tomllib.loads((TOOLS / 'pyproject.toml').read_text(encoding='utf-8'))['project']['dependencies']}
PROVIDED_BY = packages_distributions()


def test_the_scan_finds_the_known_third_party_imports():
    # 掃描本身壞掉（例如漏看函式裡的 import）時，下面的參數化會少掉那些套件而照樣全綠
    assert {'pdfplumber', 'pymupdf'} <= set(THIRD_PARTY)


@pytest.mark.parametrize('module', THIRD_PARTY)
def test_every_third_party_import_loads_from_the_locked_environment(module):
    loaded = importlib.import_module(module)
    # PYTHONPATH 指向別的環境時，import 得到不代表鎖定的環境裡有它。只解析目錄：
    # UV_LINK_MODE=symlink 時 site-packages 裡的檔案是指向 uv 快取的連結，解析檔案會跑出 venv
    assert Path(loaded.__file__).parent.resolve().is_relative_to(Path(sys.prefix).resolve())


@pytest.mark.parametrize('module', THIRD_PARTY)
def test_every_third_party_import_is_a_declared_dependency(module):
    # 只靠間接相依（例如 pdfplumber 帶進來的 PIL）或只在 dev group 的套件，升級時隨時會消失
    providers = {_normalized(d) for d in PROVIDED_BY.get(module, [])}
    assert providers & DECLARED, f'{module} 由 {sorted(providers)} 提供，不在 pyproject.toml 的 dependencies'


@pytest.fixture
def fresh_fetch_text(monkeypatch):
    monkeypatch.syspath_prepend(str(TOOLS))
    monkeypatch.delitem(sys.modules, 'fetch_text', raising=False)
    return lambda: importlib.import_module('fetch_text')


def test_fetch_text_imports_in_the_locked_environment(fresh_fetch_text):
    # 對照組：下面那條的 ImportError 必須是缺 PyMuPDF 造成的，不是找不到 fetch_text 本身
    assert fresh_fetch_text().pymupdf is sys.modules['pymupdf']


def test_fetch_text_fails_loudly_without_pymupdf(fresh_fetch_text, monkeypatch):
    # fetch() 會吞掉所有例外：PyMuPDF 的 import 一旦又被移進 fetch() 會呼叫到的函式裡，
    # 沒裝它的環境就會安靜地把每份 PDF 讀成空字串。它必須在 import fetch_text 時就失敗。
    monkeypatch.setitem(sys.modules, 'pymupdf', None)
    with pytest.raises(ImportError, match='pymupdf'):
        fresh_fetch_text()
