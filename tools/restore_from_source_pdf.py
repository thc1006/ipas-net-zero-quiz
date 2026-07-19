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

# 繁體中文 Windows 的預設 codepage 是 cp950 —— 而那正是這個專案的主要讀者。
# 這支腳本印 ✓ / / 中文，在 cp950 下會直接 UnicodeEncodeError，**一題都還沒驗就死**。
# DATA-PROVENANCE.md 的整篇論點是「每個宣稱都對應一個任何人都能自己跑一遍的檢查」——
# 那個「任何人」如果在 Windows 上跑不動，這句話就是空的。
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

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

# 來源 PDF 各自的總題數。這是「對帳」的分母 ——
# 少了這個，manifest 只能說「我還原了 159 題」，卻證明不了「沒有東西被弄丟」。
EXPECTED_QUESTION_COUNT = {'S_CHU_06': 100, 'S_CHU_07': 70}

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


# 來源 PDF 自己印的答案卡**是錯的**的題目。
#
# 這是一份刻意極小、且每一筆都必須附上一手依據的清單。預設一律以 PDF 的 answer key 為準
# —— 它是我們的錨點，隨便推翻它，整條證據鏈就沒有意義了。
# （實際上還發生過反過來的情況：一題 ISO 14064-1 強制揭露題，我們原本教 C、PDF 印 D，
#   查證後是 **PDF 對、我們錯**。所以「來源錯了」這個結論必須拿得出條文。）
#
# 但「以來源為準」不等於「明知有錯還照抄」。差別在於：偏離必須被**記錄下來、附上憑據**，
# 而不是安靜地改掉。這跟 transformations 是同一套規矩 —— 不允許沒被記錄的偏離。
ANSWER_OVERRIDES = {
    ('S_CHU_06', 94): {
        'source_answer_key': 'D',
        'corrected_answer': 'C',
        'reason': 'PDF 的答案卡（D 以上皆非）與 ISO 14064-1:2018 對 base year 的定義不符。',
        'evidence': (
            'ISO 14064-1:2018 將「基準年（base year）」定義為：為了隨時間比較溫室氣體排放、'
            '移除或其他溫室氣體相關資訊，而選定的特定歷史期間。'
            '選項 C「與其他年份進行比較的參考年份」正是這個定義；'
            'A（開始盤查的年份）與 B（設定減碳目標的年份）都不是，'
            '故正解為 C，而非 D（以上皆非）。'
        ),
        'decided_on': '2026-07-13',
    },
}


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


def _norm_for_compare(s: str) -> str:
    """比對用的正規化：剝空白、剝標點。'數據來源' 與 '數據來源；' 是同一件事。"""
    return re.sub(r'[\s，,。.；;、：:（）()「」【】]', '', s)


def _answer_text(item: dict) -> str | None:
    """取出答案對應的**選項文字**。

    絕對不能拿字母去比 —— 同一道題在不同來源的選項順序常常不同，
    A 在這邊是「國際排放係數」、在那邊可能是 D。比字母會得到「答案不一致」的假警報，
    也會漏掉真正的衝突。（這個坑先前已經踩過一次，答案回填時把字母當答案抄。）
    """
    ans = item.get('answer')
    if ans is None:
        return None
    for o in item['options']:
        if o['key'] == ans:
            return o['text']
    return None


def _similar(a: str, b: str) -> float:
    import difflib
    return difflib.SequenceMatcher(None, a, b).ratio()


def _answers_agree(src_q: dict, ds_item: dict) -> tuple[bool, float]:
    """兩個來源對「同一道題」給的答案，是不是同一個選項？

    這件事有兩種顯而易見但都會出錯的做法：

      1. 比字母（'D' == 'D'）—— 不安全。同一道題在不同來源的選項順序常常不同，
         這邊的 D 可能是那邊的 A。（先前答案回填就踩過這個坑，把字母當答案抄。）
      2. 比答案的文字是否相等 —— 太脆。同一個選項換個講法就誤報：
         來源印「產生自化石與生質碳之GHG排放與移除」，主庫寫「化石與生質碳排放與移除」，
         指的是同一個選項，字面卻不同。

    正確做法：把來源的「正解選項文字」拿去和主庫的**每一個選項**比相似度，
    看它最像哪一個；那一個是不是主庫的正解。這對「改寫」與「重新排序」同時免疫，
    而且真正的衝突（C 電力之處理方式 vs D 化石與生質碳…）文字天差地遠，
    不可能誤判成一致。
    """
    src_ans = _answer_text(src_q)
    ds_ans_key = ds_item.get('answer')
    if src_ans is None or ds_ans_key is None:
        return False, 0.0

    src_norm = _norm_for_compare(src_ans)
    scored = sorted(
        ((_similar(src_norm, _norm_for_compare(o['text'])), o['key']) for o in ds_item['options']),
        reverse=True,
    )
    best_r, best_key = scored[0]
    runner_r = scored[1][0] if len(scored) > 1 else 0.0

    # 對得夠像、而且明顯比第二名像 —— 否則寧可當成「無法判定」丟出來讓人看。
    # （沒有這個 margin，四個選項長得都差不多時會隨機挑一個，那種一致只是碰運氣。）
    if best_r < 0.55 or (best_r - runner_r) < 0.10:
        return False, round(best_r, 3)
    return best_key == ds_ans_key, round(best_r, 3)


def _disposition_for_dropped(q: dict, src_id: str, same_pdf: dict, ds_items: list) -> dict:
    """一道「沒有進 dataset」的來源題，到底發生了什麼事？必須拿出證據，不能用猜的。

    舊版是這樣寫的：

        if item_id not in by_item:
            continue          # 這一題與 gist 主庫重複，還原時已去重

    那行註解是**斷言**，不是驗證。它把「dataset 裡沒有」直接等同於「一定是重複題」。
    真的在還原過程中掉了一題，這行也會安靜地把它說成重複，而且沒有任何人會知道。
    實測結果：170 題裡有 11 題走進這條路，其中 8 題確實是 PDF 自己重印的題目，
    但另外 3 題並不是 —— 而且其中一題的答案還跟主庫**互相矛盾**。
    """
    qhash = normalized_text_sha256(q['stem'], q['options'])
    qnorm = _norm_for_compare(q['stem'])

    # 1) 同一份 PDF 裡有一模一樣的題目（PDF 自己重印）
    twin = [n for n, h in same_pdf.items() if h == qhash and n < q['number']]
    if twin:
        return {
            'status': 'duplicate_within_source',
            'duplicate_of': {'source_id': src_id, 'source_question_number': twin[0]},
            'evidence': 'normalized_text_sha256 完全相同（同一份 PDF 重印了這一題）',
            'normalized_text_sha256': qhash,
        }

    # 2) 主庫裡已經有內容相同／幾乎相同的題目
    best, best_r = None, 0.0
    for it in ds_items:
        r = _similar(qnorm, _norm_for_compare(it['stem']))
        if r > best_r:
            best, best_r = it, r

    if best is not None and best_r >= 0.80:
        src_ans = _answer_text(q)
        ds_ans = _answer_text(best)
        agree, align_r = _answers_agree(q, best)
        who = best.get('item_id') or f"gist_items[{best.get('index')}]"
        d = {
            'status': 'duplicate_in_dataset' if agree else 'duplicate_in_dataset_ANSWER_CONFLICT',
            'duplicate_of': {'dataset_item': who},
            'stem_similarity': round(best_r, 3),
            'source_answer_key': q['answer'],
            'source_answer_text': src_ans,
            'dataset_answer': best.get('answer'),
            'dataset_answer_text': ds_ans,
            'answers_agree': agree,
            'answer_option_alignment': align_r,   # 來源正解對到主庫選項的相似度
            'normalized_text_sha256': qhash,
        }
        if not agree:
            # 這才是重點：來源 PDF 自己印的答案卡與主庫教的答案不同。
            # 我們把來源題當成「重複」丟掉了，卻留下一個**可能是錯的**答案在教。
            # 這種情形不可以安靜通過，必須留在 manifest 上讓人看見。
            d['evidence'] = ('題幹幾乎相同但**答案不一致** —— 丟掉的來源題帶著它自己的答案卡，'
                             '留下的主庫題可能是錯的。需人工用一手標準文件裁決。')
        else:
            d['evidence'] = '題幹幾乎相同且答案文字一致（比對的是選項文字，不是字母）'
        return d

    # 3) 沒有任何證據 —— 這題就是掉了。絕不可以安靜跳過。
    return {
        'status': 'UNACCOUNTED',
        'evidence': ('在 dataset 裡找不到、在同一份 PDF 裡也沒有重複題 —— '
                     '這題在還原過程中遺失了。'),
        'stem': q['stem'][:80],
        'closest_in_dataset': (best.get('item_id') or f"gist_items[{best.get('index')}]") if best else None,
        'closest_similarity': round(best_r, 3),
        'normalized_text_sha256': qhash,
    }


def build(cache: Path):
    ds = json.loads(DATASET.read_text(encoding='utf-8'))
    by_item = {i['item_id']: i for i in ds['our_unique_items']}
    ds_items = ds['gist_items'] + ds['our_unique_items']

    entries, pdf_typos, dispositions = [], {}, []
    for src_id in SOURCES:
        load_pdf(src_id, cache)
        qs = extract(cache / f'{src_id}.pdf')

        # 先把「還沒動過任何一個字」的 hash 存下來，再去套用修正。
        #
        # 舊版是先 patch 再算 hash，然後把結果叫做 pdf_text_sha256（宣稱是「PDF 裡的文字」）。
        # 那是假的：S_CHU_06 第 37 題的選項標號在 PDF 原文是 (A)(B)(B)(C)，我們把它改成
        # (A)(B)(C)(D)。於是 manifest 上那個 hash 既不是 PDF 的文字、也沒有任何地方說明
        # 中間做過什麼手腳 —— 任何人拿原始 PDF 重算都會對不上，而且看不出為什麼。
        #
        # 一條「只有作者本人重算才對得上」的證據鏈，不是證據鏈。
        raw_hash = {q['number']: normalized_text_sha256(q['stem'], q['options']) for q in qs}

        pdf_typos[src_id] = patch_pdf_typos(qs, src_id)
        fixes_by_no = {t['question_no']: t for t in pdf_typos[src_id]}

        # 同一份 PDF 內每題的內容指紋 —— 用來認出「PDF 自己重印的題目」
        same_pdf = {q['number']: normalized_text_sha256(q['stem'], q['options']) for q in qs}

        expected = EXPECTED_QUESTION_COUNT[src_id]
        got_numbers = sorted(q['number'] for q in qs)
        if got_numbers != list(range(1, expected + 1)):
            missing = sorted(set(range(1, expected + 1)) - set(got_numbers))
            sys.exit(f'✗ {src_id}: 從 PDF 只抽到 {len(got_numbers)} 題（應為 {expected}）。'
                     f'缺題號 {missing} —— 擷取器壞了，不是資料的問題。')

        for q in qs:
            item_id = f'{src_id}-q{q["number"]:03d}'
            if item_id not in by_item:
                d = _disposition_for_dropped(q, src_id, same_pdf, ds_items)
                d.update({'source_id': src_id, 'source_question_number': q['number'],
                          'page': q['page'], 'column': q['column']})
                dispositions.append(d)
                continue
            it = by_item[item_id]
            dispositions.append({
                'source_id': src_id,
                'source_question_number': q['number'],
                'page': q['page'],
                'column': q['column'],
                'status': 'restored',
                'item_id': item_id,
            })

            # 三個 hash，各自回答一個不同的問題 —— 少任何一個，證據鏈就有缺口：
            #
            #   raw_pdf_text_sha256        PDF 原文長什麼樣（一個字都沒動）
            #   canonical_source_text_sha256  套用「已列明的修正」之後長什麼樣
            #   dataset_text_sha256        repo 裡「現在」長什麼樣
            #
            # 只記一個（而且是從 dataset 算的）的話，--verify 就是拿 dataset-hash 比
            # dataset-hash，永遠相等，根本沒在驗「repo 的內容是否真的等於來源」。
            # 而只記 canonical 不記 raw（舊版的做法），則是把「我們動過手腳」這件事藏起來：
            # 別人拿原始 PDF 重算會對不上，卻找不到原因。
            #
            # transformations 逐筆列出「動了什麼、憑什麼動」。空陣列＝原文照抄。
            raw_h = raw_hash[q['number']]
            canon_h = normalized_text_sha256(q['stem'], q['options'])
            ds_hash = normalized_text_sha256(it['stem'], it['options'])
            fix = fixes_by_no.get(q['number'])
            transformations = [{'fix': fix['fix'], 'evidence': fix['evidence']}] if fix else []

            # 沒有列明的修正，raw 就必須等於 canonical。不相等代表有「沒被記錄的轉換」，
            # 那正是這次要根除的東西 —— 直接失敗，不要讓它悄悄進到 manifest。
            if not transformations and raw_h != canon_h:
                sys.exit(f'✗ {item_id}: 沒有列明任何修正，raw 與 canonical 卻不同 —— '
                         '有未被記錄的轉換偷偷改動了來源文字。')

            # 答案偏離來源 answer key 的，必須在 ANSWER_OVERRIDES 裡列明憑據。
            ov = ANSWER_OVERRIDES.get((src_id, q['number']))
            if ov:
                if ov['source_answer_key'] != q['answer']:
                    sys.exit(f'✗ {item_id}: override 宣稱來源答案是 '
                             f'{ov["source_answer_key"]}，但 PDF 實際印的是 {q["answer"]} '
                             '—— 來源檔可能已變動，這筆 override 必須重新確認。')
                if ov['corrected_answer'] == q['answer']:
                    sys.exit(f'✗ {item_id}: override 的更正答案與來源相同 —— 那不是 override。')
                if it.get('answer') != ov['corrected_answer']:
                    sys.exit(f'✗ {item_id}: 已列 override（應為 {ov["corrected_answer"]}），'
                             f'但 dataset 實際是 {it.get("answer")}。')
            elif it.get('answer') != q['answer']:
                # 沒有列明憑據，卻偷偷跟來源不一樣 —— 這正是要根除的「沒被記錄的偏離」。
                sys.exit(f'✗ {item_id}: dataset 答案 {it.get("answer")} 與 PDF 的 answer key '
                         f'{q["answer"]} 不同，卻沒有列在 ANSWER_OVERRIDES 裡。'
                         '要推翻來源的答案卡，必須拿得出一手依據。')

            entries.append({
                'item_id': item_id,
                'source_id': src_id,
                'source_document': SOURCES[src_id]['url'],
                'source_sha256': SOURCES[src_id]['sha256'],
                'page': q['page'],
                'column': q['column'],
                'source_question_number': q['number'],
                'answer_key': q['answer'],           # PDF 自己印在題號前的答案
                'answer_override': ({'corrected_answer': ov['corrected_answer'],
                                     'reason': ov['reason'],
                                     'evidence': ov['evidence'],
                                     'decided_on': ov['decided_on']} if ov else None),
                'raw_pdf_text_sha256': raw_h,
                'canonical_source_text_sha256': canon_h,
                'dataset_text_sha256': ds_hash,
                'transformations': transformations,
                'matches_source': canon_h == ds_hash,
                'dataset_answer': it.get('answer'),
            })

    entries.sort(key=lambda e: (e['source_id'], e['source_question_number']))
    dispositions.sort(key=lambda d: (d['source_id'], d['source_question_number']))

    # ── 對帳：來源的每一題都必須有交代 ────────────────────────────────────────
    #
    # 舊版只報「restored_count: 159」，從來沒說另外 11 題去哪了。
    # 一份只講「我留下了什麼」而不講「我丟掉了什麼、為什麼」的憑證，
    # 沒辦法證明「沒有東西被弄丟」—— 而那正是這份 manifest 唯一要證明的事。
    total_source = sum(EXPECTED_QUESTION_COUNT.values())
    if len(dispositions) != total_source:
        sys.exit(f'✗ disposition 數 {len(dispositions)} != 來源總題數 {total_source}')

    by_status = {}
    for d in dispositions:
        by_status.setdefault(d['status'], []).append(
            f"{d['source_id']}#{d['source_question_number']}")

    unaccounted = by_status.get('UNACCOUNTED', [])
    if unaccounted:
        sys.exit('✗ 有題目在還原過程中遺失，且找不到任何重複的憑據：\n  '
                 + '\n  '.join(unaccounted)
                 + '\n  這不是「重複所以刪掉」—— 是真的掉了。必須人工確認。')

    conflicts = by_status.get('duplicate_in_dataset_ANSWER_CONFLICT', [])

    return {
        '_meta': {
            'description': '被刪除題目的還原憑證。來源 PDF 的**每一題**都有交代：'
                           'restored（還原進 dataset）、duplicate_within_source（PDF 自己重印）、'
                           'duplicate_in_dataset（主庫已有相同題）。'
                           '任何一題交代不出來就是 UNACCOUNTED —— 產生 manifest 時直接失敗，'
                           '不會安靜地當成「重複」放過。',
            'hash_fields': {
                'raw_pdf_text_sha256':
                    'PDF 原文（分欄擷取後、未套用任何修正）。拿原始 PDF 重跑就該得到這個值。',
                'canonical_source_text_sha256':
                    '套用 transformations 所列的修正之後的來源文字。dataset 應該等於這個。',
                'dataset_text_sha256': 'repo 裡「現在」的文字。',
                'transformations':
                    '這一題做過哪些修正、憑什麼做。空陣列＝原文照抄。'
                    '若 raw != canonical 卻沒有列明 transformations，--emit 直接失敗 —— '
                    '不允許存在「沒被記錄的轉換」。',
                'why':
                    '舊版只存一個 pdf_text_sha256，名字宣稱是「PDF 裡的文字」，實際卻是'
                    '「套用修正之後」的文字（S_CHU_06 第 37 題的選項標號原文是 (A)(B)(B)(C)，'
                    '被改成 (A)(B)(C)(D)）。結果任何人拿原始 PDF 重算都會對不上，'
                    '而且看不出為什麼。一條只有作者本人重算才對得上的證據鏈，不是證據鏈。',
            },
            'generated_by': 'tools/restore_from_source_pdf.py',
            'source_question_total': total_source,
            'restored_count': len(entries),
            'disposition_summary': {k: len(v) for k, v in sorted(by_status.items())},
            'answer_conflicts': conflicts,
            'answer_conflict_note':
                '這些題的題幹與主庫幾乎相同，但**來源 PDF 自己印的答案卡**與主庫教的答案不一致。'
                '我們把來源題當重複丟掉了，卻可能留下一個錯的答案在教。'
                '在拿一手標準文件裁決之前，主庫的那一題已標 ambiguous + answer=null（排除計分）。'
                if conflicts else None,
            'sources': {k: {kk: vv for kk, vv in v.items()} for k, v in SOURCES.items()},
            'source_pdf_typos': pdf_typos,
            'how_to_reproduce': [
                'pip install pdfplumber',
                'python tools/restore_from_source_pdf.py --verify',
            ],
            'ci_note': 'CI 不下載 PDF。restoration-manifest.test.ts 只驗 manifest ↔ dataset 一致。',
        },
        'entries': entries,
        'dispositions': dispositions,
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
                  'raw_pdf_text_sha256', 'canonical_source_text_sha256',
                  'dataset_text_sha256', 'source_sha256', 'dataset_answer'):
            if a.get(f) != b.get(f):
                print(f'  ✗ {iid}.{f}: manifest={a.get(f)!r} 重跑={b.get(f)!r}'); bad += 1
        # transformations 也要一致 —— 否則「我們動過哪些手腳」可以被偷偷改掉
        if a.get('transformations') != b.get('transformations'):
            print(f'  ✗ {iid}.transformations: manifest={a.get("transformations")!r} '
                  f'重跑={b.get("transformations")!r}'); bad += 1

    # 這才是真正的重現性檢查：repo 裡的文字 == 來源（套用已列明的修正之後）
    drift = [e['item_id'] for e in fresh['entries'] if not e['matches_source']]
    if drift:
        print(f'\n  ✗ 有 {len(drift)} 題的 repo 內容與來源不一致'
              f'（dataset_text ≠ canonical_source_text）：')
        for iid in drift[:10]:
            print(f'      {iid}')
        bad += len(drift)

    # raw != canonical 的題目，必須剛好就是有列明 transformations 的那些。
    # 有差異卻沒列明 = 藏起來的手腳；列明了卻沒差異 = 記錄與事實不符。
    for e in fresh['entries']:
        differs = e['raw_pdf_text_sha256'] != e['canonical_source_text_sha256']
        declared = bool(e['transformations'])
        if differs != declared:
            print(f'  ✗ {e["item_id"]}: raw≠canonical={differs} 但 transformations '
                  f'{"有" if declared else "沒有"}列明 —— 兩者必須一致'); bad += 1

    # 答案要一致：dataset 的 answer 必須等於 PDF 自己印的 answer key ——
    # **除非**那一題有列明一手依據的 answer_override（來源的答案卡本身是錯的）。
    #
    # 預設一律以來源的答案卡為錨點。隨便推翻它，整條證據鏈就沒有意義了。
    # 但「以來源為準」不等於「明知有錯還照抄」—— 差別在於偏離必須被記錄下來、附上憑據。
    ans = [e['item_id'] for e in fresh['entries']
           if e['dataset_answer'] != e['answer_key'] and not e.get('answer_override')]
    if ans:
        print(f'\n  ✗ 有 {len(ans)} 題的 answer 與 PDF answer key 不符，且**未列明 override**：')
        for iid in ans[:10]:
            print(f'      {iid}')
        bad += len(ans)

    ov = [e for e in fresh['entries'] if e.get('answer_override')]
    if ov:
        print(f'\n  ℹ 有 {len(ov)} 題刻意偏離來源的 answer key（已列明一手依據）：')
        for e in ov:
            print(f'      {e["item_id"]}: PDF={e["answer_key"]} -> '
                  f'{e["answer_override"]["corrected_answer"]}')
            print(f'         {e["answer_override"]["reason"]}')

    print()
    if bad:
        print(f'✗ {bad} 項不符 —— 還原內容與來源 PDF 對不上')
        return 1
    print(f'{len(new)} 題全部與來源 PDF 相符')
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
        print(f'\n已寫入 {MANIFEST.relative_to(REPO)}（{man["_meta"]["restored_count"]} 題）')
        return 0
    if a.verify:
        return verify(cache)
    ap.print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main())
