# uv.lock 裡的每一個套件，在 CI（Linux x86_64）與開發機（Windows x64）上都要有 Python 3.13 能裝的 wheel。
#
# pyproject.toml 設了 no-build（只裝 wheel，不從原始碼編譯）。required-environments 看起來像是「兩個平台都必須
# 有 wheel」，但 uv 只對沒有 sdist 的套件套用它：審查實測，有 sdist、缺 Windows wheel 的版本照樣鎖得進來，
# uv lock --check 與只跑 Linux 的 Tools CI 都是綠的，要到 Windows 上 uv sync 才失敗。所以這裡直接讀 lock。
import re
import tomllib
from pathlib import Path

LOCK = Path(__file__).resolve().parents[1] / 'uv.lock'

PLATFORMS = {  # 平台標籤裡只要有一個符合就能裝（musllinux 不算：CI 是 glibc）
    'Linux x86_64': lambda tag: tag == 'any' or (tag.startswith(('manylinux', 'linux_')) and tag.endswith('_x86_64')),
    'Windows x64': lambda tag: tag in ('any', 'win_amd64'),
}


def _python_313(pythons: list[str], abis: list[str]) -> bool:
    """wheel 的 Python 與 ABI 標籤能不能在 CPython 3.13 上裝：py3、cp313，或 cp3x 的 abi3（x ≤ 13）。
    free-threaded 的 ABI（cp313t）不算：.python-version 選的是一般的 CPython。"""
    if any(abi.endswith('t') for abi in abis):
        return False
    for py in pythons:
        if py == 'py3':
            return True
        m = re.fullmatch(r'cp3(\d+)', py)
        if m and (int(m[1]) == 13 or ('abi3' in abis and int(m[1]) <= 13)):
            return True
    return False


def missing_wheels(lock: dict) -> list[str]:
    out = []
    for pkg in lock['package']:
        if 'virtual' in pkg.get('source', {}):  # 這個專案本身，不安裝
            continue
        tags = [w['url'].rsplit('/', 1)[-1][:-len('.whl')].split('-')[-3:] for w in pkg.get('wheels', [])]
        for platform, fits in PLATFORMS.items():
            if not any(_python_313(py.split('.'), abi.split('.')) and any(fits(t) for t in plat.split('.'))
                       for py, abi, plat in tags):
                out.append(f'{pkg["name"]} {pkg["version"]}：{platform} 沒有 Python 3.13 能裝的 wheel')
    return out


def test_every_locked_package_has_a_wheel_for_ci_and_for_windows():
    lock = tomllib.loads(LOCK.read_text(encoding='utf-8'))
    # 反空轉：lock 裡確實有分平台的 wheel（PyMuPDF 的 win_amd64），檢查才有東西可看
    assert any('win_amd64' in w['url'] for p in lock['package'] for w in p.get('wheels', []))
    assert missing_wheels(lock) == []


def _lock(*wheels, sdist=True):
    pkg = {'name': 'demo', 'version': '1.0', 'source': {'registry': 'https://pypi.org/simple'},
           'wheels': [{'url': f'https://files.example/demo-1.0-{w}.whl'} for w in wheels]}
    if sdist:
        pkg['sdist'] = {'url': 'https://files.example/demo-1.0.tar.gz'}
    return {'package': [pkg, {'name': 'ipas-quiz-tools', 'version': '0.0.0', 'source': {'virtual': '.'}}]}


def test_the_check_flags_what_uv_lets_through():
    # 有 sdist、只有 Linux wheel：uv 照樣鎖得進來（required-environments 不管有 sdist 的套件）
    assert missing_wheels(_lock('cp313-cp313-manylinux_2_28_x86_64')) == ['demo 1.0：Windows x64 沒有 Python 3.13 能裝的 wheel']
    assert missing_wheels(_lock('cp313-cp313-win_amd64')) == ['demo 1.0：Linux x86_64 沒有 Python 3.13 能裝的 wheel']
    assert len(missing_wheels(_lock('cp312-cp312-win_amd64', 'cp312-cp312-manylinux_2_28_x86_64'))) == 2  # 舊 Python
    assert len(missing_wheels(_lock('cp313-cp313-musllinux_1_2_x86_64', 'cp313-cp313-win_arm64'))) == 2
    assert len(missing_wheels(_lock(sdist=True))) == 2  # 只有 sdist
    assert missing_wheels(_lock('cp313-cp313-manylinux_2_28_x86_64', 'cp313-cp313t-win_amd64')) == [
        'demo 1.0：Windows x64 沒有 Python 3.13 能裝的 wheel']  # free-threaded 的 wheel 裝不進一般的 CPython


def test_the_check_lets_real_wheel_layouts_through():
    assert missing_wheels(_lock('py3-none-any')) == []
    assert missing_wheels(_lock('py2.py3-none-any')) == []
    assert missing_wheels(_lock('cp310-abi3-manylinux_2_28_x86_64', 'cp310-abi3-win_amd64')) == []  # PyMuPDF
    assert missing_wheels(_lock('cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64',
                                'cp313-cp313-win_amd64')) == []
