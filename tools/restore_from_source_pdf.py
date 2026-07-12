#!/usr/bin/env python3
"""從來源 PDF 重建被刪除的題目，並產生／驗證 restoration manifest。

背景
────
2026-01-23 的清理，面對來源 PDF「雙欄排版轉純文字時左右欄交錯」而壞掉的題目，
是直接刪掉而非修復。而且那 77 個 item 根本不是去重後的子集 —— 錯置把成對的題目
黏在一起，170 題被壓成 77 個壞掉的 item。

2026-07-13 改由來源 PDF（本身內嵌答案 key）以「分欄擷取」重建。

為什麼需要 manifest
──────────────────
repo 裡的測試只能驗「總題數對不對、選項結構對不對、答案字母在不在選項裡」。
這些都證明不了「每一道還原題確實對應到 PDF 的哪一頁、哪一欄、第幾題、answer key
是什麼」。也就是說，「159 題都正確還原」這個宣稱，光看 repo 內容是無法獨立重現的。

manifest 把這條證據鏈固定下來：

    item_id  ->  source_document(+sha256) / page / column / question_no / answer_key
                 + normalized_text_sha256

有了 PDF 的 sha256 才有錨點 —— 否則 manifest 只是一份自說自話的宣稱。

CI 不碰 PDF
───────────
CI 只驗「manifest ↔ dataset 一致」（每題的正規化文字 hash 對得上），離線、秒級，
足以防竄改。要做「manifest ↔ PDF」的完整重現，手動跑這支腳本：

    pip install pdfplumber
    python tools/restore_from_source_pdf.py --verify      # 重新下載 PDF 並比對 manifest
    python tools/restore_from_source_pdf.py --emit        # 重新產生 manifest

PDF 版面
────────
A4 雙欄。左欄 x0 ≈ 40–285、右欄 x0 ≈ 300–560，分界 292。
每題前綴就是答案：`(B) 1.聯合國間為了預防…`
頁首（top<42）與頁尾（bottom>h-46）是頁面裝飾，必須丟掉 —— 它們正是當初污染題目的元凶。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MANIFEST = REPO / 'quiz-app' / 'src' / 'data' / 'restoration-manifest.json'
DATASET = REPO / 'quiz-app' / 'src' / 'data' / 'integrated_dataset.json'

SOURCES = {
    'S_CHU_06': {
        'url': 'https://usr.chu.edu.tw/var/file/81/1081/img/697134715.pdf',
        'sha256': 'f54d0711ad5feacb8de48a26a94a9c56a0d98f0d8b0d8b496bc2e8f215fc7334',
        'title': '考科 1 淨零碳規劃管理基礎概論-模擬試題（商研院 2024.08）',
        'exam_subject': '考科1',
    },
    'S_CHU_07': {
        'url': 'https://usr.chu.edu.tw/var/file/81/1081/img/214245506.pdf',
        'sha256': '6e4b861f4ec7f5855afda0a580eab79ffa4512c8dca55ec5babfcb3bd00c74bb',
        'title': '考科 2 溫室氣體盤查規範與程序概要-模擬試題（商研院 2024.08）',
        'exam_subject': '考科2',
    },
}

COLUMN_BOUNDARY = 292.0
CJK = re.compile(r'[⺀-鿿豈-﫿＀-￯]')
Q_RE = re.compile(r'^\(([A-D])\)\s*(\d{1,3})\s*[.、]\s*(.*)$')
OPT_RE = re.compile(r'^\(([A-D])\)\s*(.*)$')
SEP_RE = re.compile(r'^-{5,}$')


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def normalized_text_sha256(stem: str, options: list[dict]) -> str:
    """題目內容的正規化指紋。空白全部剝掉，選項依 key 排序 —— 只認內容，不認排版。"""
    payload = re.sub(r'\s+', '', stem) + '||' + '|'.join(
        f"{o['key']}:{re.sub(r'[ \t\r\n]+', '', o['text'])}"
        for o in sorted(options, key=lambda x: x['key'])
    )
    return sha256_bytes(payload.encode('utf-8'))


def _join(a: str, b: str) -> str:
    """接回被斷行的字。CJK 直接接；拉丁字要補空格，否則 'Climate change'+'mitigation' 會黏成一團。"""
    if not a:
        return b
    if not b:
        return a
    return a + b if (CJK.search(a[-1]) or CJK.search(b[0])) else a + ' ' + b


def _tidy(s: str) -> str:
    s = re.sub(r'(?<=[一-鿿])\s+(?=[一-鿿])', '', s)  # 對齊造成的字間空白
    return re.sub(r'\s{2,}', ' ', s).strip()


def extract(pdf_path: Path):
    """回傳 [(page, column, answer, number, stem, options, note)]。

    閱讀順序：每一頁「先左欄由上到下，再右欄由上到下」。
    這正是當初出錯的地方 —— 純文字擷取會把兩欄交錯，把鄰題的字插進題幹。
    """
    import pdfplumber  # 延後 import：CI 不需要這個相依

    out = []
    with pdfplumber.open(pdf_path) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            words = [w for w in page.extract_words() if 42 < w['top'] < page.height - 46]
            cols = {'left': [], 'right': []}
            for w in words:
                cols['left' if w['x0'] < COLUMN_BOUNDARY else 'right'].append(w)

            for col in ('left', 'right'):
                rows: dict[int, list] = {}
                for w in cols[col]:
                    rows.setdefault(round(w['top'] / 3.0), []).append(w)
                if not rows:
                    continue
                margin = min(min(w['x0'] for w in ws) for ws in rows.values())

                cur = None
                mode = None
                for k in sorted(rows):
                    ws = sorted(rows[k], key=lambda w: w['x0'])
                    text = ''
                    for w in ws:
                        text = _join(text, w['text']) if text else w['text']
                    text = text.strip()
                    if not text or SEP_RE.match(text):
                        continue
                    # 選項的續行是「縮排」的；題幹續行與解析段落貼齊欄位左緣。
                    indented = ws[0]['x0'] > margin + 8

                    m = Q_RE.match(text)
                    if m:
                        if cur:
                            out.append(cur)
                        cur = dict(page=pno, column=col, answer=m.group(1),
                                   number=int(m.group(2)), stem=m.group(3).strip(),
                                   options=[], note=[])
                        mode = 'stem'
                        continue
                    if cur is None:
                        continue
                    m = OPT_RE.match(text)
                    if m:
                        cur['options'].append({'key': m.group(1), 'text': m.group(2).strip()})
                        mode = 'opt'
                        continue
                    if mode == 'stem':
                        cur['stem'] = _join(cur['stem'], text)
                    elif mode == 'opt' and cur['options'] and indented:
                        cur['options'][-1]['text'] = _join(cur['options'][-1]['text'], text)
                    else:
                        cur['note'].append(text)   # 貼齊左緣 => 是解析段落，不是選項續行
                        mode = 'note'
                if cur:
                    out.append(cur)

    for q in out:
        q['stem'] = _tidy(q['stem'])
        for o in q['options']:
            o['text'] = _tidy(o['text'])
        q['note'] = _tidy(' '.join(q['note']))
    return out


def patch_pdf_typos(qs, src_id):
    """來源 PDF 自己的錯字。逐筆註明，不做無憑據的猜測。"""
    patched = []
    if src_id == 'S_CHU_06':
        q37 = next((q for q in qs if q['number'] == 37), None)
        q86 = next((q for q in qs if q['number'] == 86), None)
        if q37 and [o['key'] for o in q37['options']] == ['A', 'B', 'B', 'C']:
            # PDF 原文把選項標成 (A)(B)(B)(C)。同一份 PDF 的第 86 題是同一道題目、
            # 選項文字完全相同且標號正確 —— 所以這個修正是有憑據的，不是猜的。
            assert q86 and [o['text'] for o in q37['options']] == [o['text'] for o in q86['options']]
            for o, k in zip(q37['options'], ['A', 'B', 'C', 'D']):
                o['key'] = k
            patched.append({'question_no': 37,
                            'fix': 'option lettering (A,B,B,C) -> (A,B,C,D)',
                            'evidence': 'identical to Q86 in the same PDF, which is lettered correctly'})
    return patched


def load_pdf(src_id: str, cache: Path) -> bytes:
    meta = SOURCES[src_id]
    local = cache / f'{src_id}.pdf'
    if local.exists():
        data = local.read_bytes()
    else:
        print(f'  下載 {meta["url"]}')
        with urllib.request.urlopen(meta['url'], timeout=60) as r:
            data = r.read()
        local.write_bytes(data)
    got = sha256_bytes(data)
    if got != meta['sha256']:
        sys.exit(f'✗ {src_id} PDF sha256 不符！\n  期望 {meta["sha256"]}\n  實得 {got}\n'
                 '  來源檔案已變動 —— manifest 的錨點失效，必須人工重新確認。')
    print(f'  ✓ {src_id} sha256 相符 ({len(data)} bytes)')
    return data


def build(cache: Path):
    ds = json.loads(DATASET.read_text(encoding='utf-8'))
    by_item = {i['item_id']: i for i in ds['our_unique_items']}

    entries, pdf_typos = [], {}
    for src_id in SOURCES:
        load_pdf(src_id, cache)
        qs = extract(cache / f'{src_id}.pdf')
        pdf_typos[src_id] = patch_pdf_typos(qs, src_id)
        for q in qs:
            item_id = f'{src_id}-q{q["number"]:03d}'
            if item_id not in by_item:
                continue  # 這一題與 gist 主庫重複，還原時已去重
            it = by_item[item_id]

            # 兩個 hash 必須分開算，否則等於自己驗自己：
            #   pdf_text_sha256     —— 從「PDF 擷取出來」的文字
            #   dataset_text_sha256 —— repo 裡「現在」的文字
            # 只記一個（而且是從 dataset 算的）的話，--verify 就是拿 dataset-hash 比
            # dataset-hash，永遠相等，根本沒在驗「repo 的內容是否真的等於 PDF」。
            pdf_hash = normalized_text_sha256(q['stem'], q['options'])
            ds_hash = normalized_text_sha256(it['stem'], it['options'])

            entries.append({
                'item_id': item_id,
                'source_id': src_id,
                'source_document': SOURCES[src_id]['url'],
                'source_sha256': SOURCES[src_id]['sha256'],
                'page': q['page'],
                'column': q['column'],
                'source_question_number': q['number'],
                'answer_key': q['answer'],           # PDF 自己印在題號前的答案
                'pdf_text_sha256': pdf_hash,
                'dataset_text_sha256': ds_hash,
                'matches_source': pdf_hash == ds_hash,
                'dataset_answer': it.get('answer'),
            })

    entries.sort(key=lambda e: (e['source_id'], e['source_question_number']))
    return {
        '_meta': {
            'description': '被刪除題目的還原憑證。每筆記錄該題來自哪一份 PDF 的哪一頁、'
                           '哪一欄、第幾題，以及 PDF 自己印的 answer key。'
                           'normalized_text_sha256 讓 CI 不需要 PDF 也能驗證資料未被竄改。',
            'generated_by': 'tools/restore_from_source_pdf.py',
            'restored_count': len(entries),
            'sources': {k: {kk: vv for kk, vv in v.items()} for k, v in SOURCES.items()},
            'source_pdf_typos': pdf_typos,
            'how_to_reproduce': [
                'pip install pdfplumber',
                'python tools/restore_from_source_pdf.py --verify',
            ],
            'ci_note': 'CI 不下載 PDF。restoration-manifest.test.ts 只驗 manifest ↔ dataset 一致。',
        },
        'entries': entries,
    }


def verify(cache: Path) -> int:
    if not MANIFEST.exists():
        sys.exit('✗ 找不到 manifest，請先 --emit')
    man = json.loads(MANIFEST.read_text(encoding='utf-8'))
    fresh = build(cache)

    old = {e['item_id']: e for e in man['entries']}
    new = {e['item_id']: e for e in fresh['entries']}
    bad = 0

    for iid in sorted(set(old) | set(new)):
        a, b = old.get(iid), new.get(iid)
        if a is None:
            print(f'  ✗ {iid}: manifest 缺這一題'); bad += 1; continue
        if b is None:
            print(f'  ✗ {iid}: PDF 重跑後不存在'); bad += 1; continue
        for f in ('page', 'column', 'source_question_number', 'answer_key',
                  'pdf_text_sha256', 'dataset_text_sha256', 'source_sha256', 'dataset_answer'):
            if a.get(f) != b.get(f):
                print(f'  ✗ {iid}.{f}: manifest={a.get(f)!r} 重跑={b.get(f)!r}'); bad += 1

    # 這才是真正的重現性檢查：repo 裡的文字 == PDF 裡的文字
    drift = [e['item_id'] for e in fresh['entries'] if not e['matches_source']]
    if drift:
        print(f'\n  ✗ 有 {len(drift)} 題的 repo 內容與 PDF 不一致（dataset_text ≠ pdf_text）：')
        for iid in drift[:10]:
            print(f'      {iid}')
        bad += len(drift)

    # 答案也要一致：dataset 的 answer 必須等於 PDF 自己印的 answer key
    ans = [e['item_id'] for e in fresh['entries'] if e['dataset_answer'] != e['answer_key']]
    if ans:
        print(f'\n  ✗ 有 {len(ans)} 題的 answer 與 PDF answer key 不符：')
        for iid in ans[:10]:
            print(f'      {iid}')
        bad += len(ans)

    print()
    if bad:
        print(f'✗ {bad} 項不符 —— 還原內容與來源 PDF 對不上')
        return 1
    print(f'✅ {len(new)} 題全部與來源 PDF 相符')
    print('   （頁碼／欄位／題號／answer key／PDF 文字 hash／repo 文字 hash 全部一致）')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--emit', action='store_true', help='重新產生 manifest')
    ap.add_argument('--verify', action='store_true', help='重新下載 PDF 並比對 manifest')
    ap.add_argument('--cache', default=str(Path.home() / '.cache' / 'ipas-src-pdf'))
    a = ap.parse_args()

    cache = Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)

    if a.emit:
        man = build(cache)
        MANIFEST.write_text(
            json.dumps(man, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'\n✅ 已寫入 {MANIFEST.relative_to(REPO)}（{man["_meta"]["restored_count"]} 題）')
        return 0
    if a.verify:
        return verify(cache)
    ap.print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main())
