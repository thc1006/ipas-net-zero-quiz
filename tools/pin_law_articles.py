#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把題庫引用到的法規條文「釘選」下來，成為可被 CI 比對的基準。

## 為什麼需要這個

這個專案原本只有一種來源檢查：**連結還通不通**（quarterly-time-sensitive-verify）。
它驗不出兩種真實發生過的錯誤：

1. **連結是活的，但指到錯的地方。**
   19 題碳費題引用 pcode=O0020102（溫管辦法），但碳費規定在 O0020139（碳費收費辦法）。
   兩個 URL 都回 200，連結檢查器永遠是綠的。

2. **連結是活的，但內容變了 —— 或者，我們寫的根本不是那條文說的話。**
   練習池有兩處把「憑空生成的文字」放進引號裡當成法條原文：
     - tw_regs_38 宣稱氣候法 §35 寫著「應參酌國際公約決議事項…保留及禁止移轉之事項」
       —— §35 全文裡沒有這兩句。
     - tw_regs_45 宣稱氣候法 §60 的滯納金「至應納金額之百分之十五為限」
       —— 條文根本沒有上限明文。而那題的干擾選項正好寫著「合計 15%」。

## 這支工具做什麼

抓下題庫引用到的每一部法規全文，逐條正規化後寫進
`quiz-app/src/data/law-articles.pinned.json`，並記下每部法的 sha256。

有了它，兩件事變成可機械檢查的：

  * **單元測試**（law-quote-integrity.test.ts）：解析裡凡是「」括起來、看起來像法條原文的
    句子，必須真的逐字出現在它所引用的那部法裡。捏造的條文會被擋下來。

  * **季排程**：重新執行本工具並 `git diff --exit-code`。
    **法規被修訂 → 釘選檔改變 → CI 變紅 → 有人必須去看。**
    這是這個 repo 第一個能偵測「來源內容變了」的機制。

用法：
    python tools/pin_law_articles.py            # 更新釘選檔
    python tools/pin_law_articles.py --check    # 只比對，不寫入（季排程用）
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

# Windows 繁中預設 cp950，直接 print 中文會 UnicodeEncodeError。
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parent.parent
PINNED = ROOT / 'quiz-app' / 'src' / 'data' / 'law-articles.pinned.json'

# 題庫引用到的法規。新增引用新法規的題目時，這裡要一起加。
LAWS: dict[str, str] = {
    'O0020098': '氣候變遷因應法',
    'O0020102': '溫室氣體排放量盤查登錄及查驗管理辦法',
    'O0020139': '碳費收費辦法',
    'O0020137': '溫室氣體自願減量專案管理辦法',
    'O0020140': '自主減量計畫管理辦法',
    'J0130032': '再生能源發展條例',
}

URL = 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode={}'


def fetch(pcode: str) -> str:
    req = urllib.request.Request(
        URL.format(pcode),
        headers={'User-Agent': 'ipas-net-zero-quiz/law-pinner (+https://github.com/thc1006/ipas-net-zero-quiz)'},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        if r.status != 200:
            raise RuntimeError(f'{pcode}: HTTP {r.status}')
        return r.read().decode('utf-8', errors='replace')


def parse_articles(raw: str) -> dict[str, str]:
    """從全國法規資料庫的 LawAll 頁面抽出 {條號: 條文}。

    條文正規化：去掉所有空白。**不動標點、不動數字** ——
    釘選的目的是逐字比對，任何「聰明的」正規化都會讓比對失去意義。
    """
    arts: dict[str, str] = {}
    blocks = re.findall(
        r'<div class="row">\s*<div class="col-no">.*?</div>\s*<div class="col-data">.*?</div>\s*</div>',
        raw,
        re.S,
    )
    for blk in blocks:
        no = re.search(r'第\s*([\d\-]+)\s*條', blk)
        if not no:
            continue
        body = html.unescape(re.sub(r'<[^>]+>', '', blk))
        body = re.sub(r'第\s*[\d\-]+\s*條', '', body, count=1)
        arts[no.group(1)] = re.sub(r'\s+', '', body)
    return arts


def build() -> dict:
    laws = {}
    for pcode, expected_name in LAWS.items():
        raw = fetch(pcode)
        title = re.search(r'<title>(.*?)</title>', raw, re.S)
        name = html.unescape(title.group(1)).replace('-全國法規資料庫', '').strip() if title else ''
        if name != expected_name:
            raise RuntimeError(
                f'{pcode} 的法規名稱是「{name}」，但我們預期「{expected_name}」——\n'
                f'  pcode 可能被重新指派，或法規已更名。請人工確認後再更新 LAWS。'
            )
        arts = parse_articles(raw)
        if not arts:
            raise RuntimeError(f'{pcode}: 一條都沒解析到，頁面結構可能改了')
        canon = '\n'.join(f'{k}\t{arts[k]}' for k in sorted(arts, key=lambda x: (int(x.split("-")[0]), x)))
        laws[pcode] = {
            'name': name,
            'url': URL.format(pcode),
            'article_count': len(arts),
            'sha256': hashlib.sha256(canon.encode('utf-8')).hexdigest(),
            'articles': arts,
        }
        print(f'  {pcode}  {name}  {len(arts)} 條  sha256={laws[pcode]["sha256"][:16]}…')
    return {
        '_meta': {
            'why': '題庫引用到的法規條文原文。解析裡「」括起來、宣稱是條文的句子，'
                   '必須逐字出現在這裡（見 law-quote-integrity.test.ts）。',
            'watch': '季排程會重跑 tools/pin_law_articles.py --check：'
                     '法規一旦被修訂，sha256 就對不上，CI 變紅 —— '
                     '這是本 repo 唯一能偵測「來源內容變了」（而非只是「連結還通」）的機制。',
            'source': 'https://law.moj.gov.tw/（全國法規資料庫）',
            'regenerate': 'python tools/pin_law_articles.py',
        },
        'laws': laws,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只比對，不寫入（季排程用）')
    args = ap.parse_args()

    print('抓取法規全文…')
    fresh = build()

    if not args.check:
        PINNED.write_text(
            json.dumps(fresh, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
        )
        print(f'\n已寫入 {PINNED.relative_to(ROOT)}')
        return 0

    if not PINNED.exists():
        print(f'\n釘選檔不存在：{PINNED}', file=sys.stderr)
        return 1
    old = json.loads(PINNED.read_text(encoding='utf-8'))
    drift = [
        f'  {p}  {LAWS[p]}\n'
        f'      釘選 sha256 {old["laws"].get(p, {}).get("sha256", "(缺)")[:16]}… '
        f'({old["laws"].get(p, {}).get("article_count", "?")} 條)\n'
        f'      現行 sha256 {fresh["laws"][p]["sha256"][:16]}… '
        f'({fresh["laws"][p]["article_count"]} 條)'
        for p in LAWS
        if old['laws'].get(p, {}).get('sha256') != fresh['laws'][p]['sha256']
    ]
    if drift:
        print('\n法規內容與釘選檔不符 —— 條文可能已被修訂：\n' + '\n'.join(drift), file=sys.stderr)
        print(
            '\n這正是季排程的連結檢查抓不到的那種變動（網址全程都是 200）。\n'
            '請人工確認修法內容，檢查受影響的題目，再執行：\n'
            '    python tools/pin_law_articles.py\n',
            file=sys.stderr,
        )
        return 1
    print('\n所有釘選的法規條文均未變動。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
