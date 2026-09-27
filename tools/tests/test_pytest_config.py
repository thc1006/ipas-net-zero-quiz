# pytest 必須讀到 tools/pyproject.toml 的設定。
#
# 在 repo 根目錄直接跑 `pytest` 時找不到設定檔：testpaths 不生效而掃進整個 repo，
# 還會在根目錄留下 .pytest_cache（被 repo-layout 的根目錄 gate 擋下）。
# 正確的跑法是 `uv run --locked --directory tools pytest`；跑錯時這裡轉紅，而不是安靜地用預設值跑。
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]


def test_pytest_reads_the_tools_config(pytestconfig):
    assert pytestconfig.inipath is not None
    assert Path(pytestconfig.inipath).resolve() == (TOOLS / 'pyproject.toml').resolve()
    assert pytestconfig.getini('testpaths') == ['tests']


def test_pytest_writes_no_cache_directory(pytestconfig):
    assert pytestconfig.pluginmanager.is_blocked('cacheprovider')


def test_pytest_is_strict_and_an_empty_parametrize_fails(pytestconfig):
    assert pytestconfig.getini('strict') is True
    assert pytestconfig.getini('empty_parameter_set_mark') == 'fail_at_collect'
