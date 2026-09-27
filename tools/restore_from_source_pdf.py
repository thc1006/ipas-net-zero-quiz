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

manifest 是產物，不是手寫文件
────────────────────────────
manifest 由這支工具產生：來源 PDF 的擷取結果 + 下面幾張修正表（每筆都附憑據）+ 題庫。
要改 manifest 的內容，就改這裡的表；手改的內容重跑不出來，會被下面兩道檢查擋下。
  - 改了題庫或這裡的表而牽動 manifest → 先問專案所有者（動 manifest 都要先問，見 AGENTS.md 的升級規則）；
    核准後 --reassemble：用 committed 的擷取快照離線重組 manifest，不必下載 PDF；
  - 來源 PDF 或擷取器變了 → --emit：重新擷取，改寫快照與 manifest。

CI 不下載 PDF，所以擷取結果以快照（tools/tests/fixtures/restore_source_extract.json）進版控：
  - restoration-manifest.test.ts 驗 manifest ↔ dataset 一致（每題的正規化文字 hash 對得上）；
  - tools/tests/test_restore_reproducibility.py 用快照重組整份 manifest，與 committed 的檔案逐字比對。
快照本身要對照來源 PDF 才驗得了，手動跑：

    uv sync --locked --project tools
    uv run --locked --project tools python tools/restore_from_source_pdf.py --verify   # 重跑擷取，逐字比對快照與 manifest
    uv run --locked --project tools python tools/restore_from_source_pdf.py --emit     # 重跑擷取，改寫快照與 manifest
    uv run --locked --project tools python tools/restore_from_source_pdf.py --reassemble   # 不讀 PDF，只重組 manifest

來源 PDF 快取在 --cache（預設 ~/.cache/ipas-src-pdf），沒有才下載；sha256 與 SOURCES 不符就中止。

PDF 版面
────────
A4 雙欄。左欄 x0 ≈ 40–285、右欄 x0 ≈ 300–560，分界 292。
每題前綴就是答案：`(B) 1.聯合國間為了預防…`
頁首（top<42）與頁尾（bottom>h-46）是頁面裝飾，必須丟掉 —— 它們正是當初污染題目的元凶。
"""
from __future__ import annotations

import argparse
import copy
import dataclasses
from collections import Counter
import difflib
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

import ipas_exam_pdf

# 繁體中文 Windows 的預設 codepage 是 cp950 —— 而那正是這個專案的主要讀者。
# 這支腳本印 ✓ / / 中文，在 cp950 下會直接 UnicodeEncodeError，**一題都還沒驗就死**。
# docs/DATA-PROVENANCE.md 的整篇論點是「每個宣稱都對應一個任何人都能自己跑一遍的檢查」——
# 那個「任何人」如果在 Windows 上跑不動，這句話就是空的。
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

REPO = Path(__file__).resolve().parent.parent
MANIFEST = REPO / 'quiz-app' / 'src' / 'data' / 'restoration-manifest.json'
DATASET = REPO / 'quiz-app' / 'src' / 'data' / 'integrated_dataset.json'
SNAPSHOT = REPO / 'tools' / 'tests' / 'fixtures' / 'restore_source_extract.json'

# 來源 PDF。沒寫 layout 的是商研院模擬卷的雙欄版面；layout 為 ipas_exam_table 的是 iPAS 官方公告試題的
# 表格版面（擷取器是 tools/ipas_exam_pdf.py）。kind 為 official_exam 的來源不是「被刪除後還原」的題目，
# 在題庫裡的記為 imported，不計入 restored_count。
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
    # iPAS 官方公告試題：115 年第一次淨零碳規劃管理師初級能力鑑定（考試日期 2026-05-16），
    # 官網學習資源頁 2026-07-29 公告（網址裡的時間戳也是這一天）。
    'S_IPAS_115_01_L11': {
        'url': 'https://www.ipas.org.tw/api/proxy/uploads/certification_resource/ca7c798fe06a4ec8a97d5b72cd741963/115-01-%E5%88%9D%E7%B4%9A%E6%B7%A8%E9%9B%B6%E7%A2%B3_L11_%E6%B7%A8%E9%9B%B6%E7%A2%B3%E8%A6%8F%E5%8A%83%E7%AE%A1%E7%90%86%E5%9F%BA%E7%A4%8E%E6%A6%82%E8%AB%96_%E5%85%AC%E5%91%8A%E8%A9%A6%E9%A1%8C_20260729142039.pdf',
        'sha256': 'bef4f1e9a78a83fa4e635ebf522ea8a6088c771611cc9b7fd3709d3c38e567a4',
        'title': '115 年第一次淨零碳規劃管理師-初級能力鑑定【公告試題】第一科：淨零碳規劃管理基礎概論',
        'exam_subject': '考科1',
        'layout': 'ipas_exam_table',
        'kind': 'official_exam',
        'session': '115-01',
        'exam_date': '2026-05-16',
        'published_on': '2026-07-29',
        'subject': 'L11',
    },
    'S_IPAS_115_01_L12': {
        'url': 'https://www.ipas.org.tw/api/proxy/uploads/certification_resource/ca7c798fe06a4ec8a97d5b72cd741963/115-01-%E5%88%9D%E7%B4%9A%E6%B7%A8%E9%9B%B6%E7%A2%B3_L12_%E6%B7%A8%E9%9B%B6%E7%A2%B3%E7%9B%A4%E6%9F%A5%E8%A6%8F%E7%AF%84%E8%88%87%E7%A8%8B%E5%BA%8F%E6%A6%82%E8%A6%81_%E5%85%AC%E5%91%8A%E8%A9%A6%E9%A1%8C_20260729142047.pdf',
        'sha256': '1c4e08cf48110aa0e229f691c6b1ca16a543cd64adfefc2a7dbe834823fec36d',
        'title': '115 年第一次淨零碳規劃管理師-初級能力鑑定【公告試題】第二科：淨零碳盤查規範與程序概要',
        'exam_subject': '考科2',
        'layout': 'ipas_exam_table',
        'kind': 'official_exam',
        'session': '115-01',
        'exam_date': '2026-05-16',
        'published_on': '2026-07-29',
        'subject': 'L12',
    },
}

# 每份來源 PDF 的人工查核紀錄，寫進 manifest 的 _meta.source_documents（以 PDF 網址為鍵）。
# items（還原進題庫的題數）與 subject（來源代號）由 assemble() 從資料算出，不在這裡手寫。
SOURCE_REVIEWS = {
    'S_CHU_07': {
        'status': 'DEFECTIVE',
        'defect': (
            '**選項 (C) 欄在第 30–40 題錯位** —— 第 30–36、38 題印的 (C) 是下一題的 (C)；'
            '第 40 題印的是第 31 題的 (C)「功能單位或宣告單位」（第 30 題印的也是這個）；'
            '第 37、39 題印的是本題自己的 (C)，但各差一個詞（「與」／「和」、「應用」／「使用」）。'
            '其餘各題的 (C) 沒有錯位。'
            'Q33「生命週期評估依據哪份 **ISO 標準**文件？」的 (C) 竟然是「場址特定數據」；'
            'Q34「在組織邊界外所獲得的數據」的 (C) 是「確保量化結果的全面性和準確性」，'
            '而且**答案卡也錯**（印 (A) 初級數據，正解是 (B) 次級數據）。'
            '第 32 題也錯位（印「ISO9001」，應為「內外部議題」）；它與 S_YAMOL_018-q002 重複、'
            '沒有收進題庫，所以不在修正表上。'
        ),
        'how_found': (
            '2026-07-14。'
            '把答案卡交叉比對的母體從「有引用指向答案卡 PDF 的題目」改成「**題幹在答案卡 PDF 上找得到的題目**」之後跳出來的。'
            '判準應該是「這一題驗得了嗎」，不是「有沒有人記得引用它」。'
        ),
        'resolution': (
            '8 題已依同一份模擬卷的乾淨版本 https://usr.chu.edu.tw/var/file/81/1081/img/1034/190841777.pdf 修正（該版本把答案印在每題正右方欄位）。'
            '收進題庫的 67 題中，65 題以**題幹**（不是題號）對到乾淨版本的唯一一題：'
            '63 題去掉空白與標點後逐字相同（字形相同、碼位不同的字視為相同），'
            '第 25、63 題的題幹有字差（見 warning），以相似度對到（0.945、0.985，次高者都不到 0.4）；'
            '第 39、59 題改以選項對應 —— 乾淨版本第 59 題誤印了第 39 題的題幹。'
            '逐選項比對（不計空白、標點與字形相同的異碼字，例如乾淨版本文字層的「㇐」）：'
            'A/B/D 與乾淨版本相同，唯一例外是第 14 題的 (B)(D)，那是乾淨版本印壞'
            '（來源的文字與乾淨版本第 15 題的 (B)(D) 相同）；(C) 除了修正的 8 題，第 37、39 題各差一個詞'
            '（兩版答案都是 (C)，題庫保留來源用字），第 63 題是乾淨版本把題幹的「該」印到了 (C) 前面。'
        ),
        'warning': (
            '題庫**忠實地複製了這份壞掉的 PDF**，'
            '所以 `matches_source: true` 一直是綠的。'
            '**一個「忠實複製一份壞掉的來源」的檢查，永遠是綠的。**'
            '乾淨版本也不是全對：第 14 題 (B)(D)、第 59 題題幹印錯，第 63 題把題幹的「該」印到 (C) 前面'
            '（題幹「應選擇」、(C)「該GWP-200年」；來源是「應該選擇」、「GWP-200年」），'
            '第 25 題題幹多了「稱之為？」，第 18 題答案欄印的文字是第 19 題的 (C)（字母 (C) 沒錯）。這些題以來源為準。'
        ),
    },
    'S_CHU_06': {
        'status': 'NO_SECOND_SOURCE',
        'cross_check': (
            '**92 題裡有 91 題只存在於這一份 PDF** ——'
            ' 找遍 usr.chu.edu.tw 上 12 份教材/範例題 PDF，'
            '都沒有第二份可以交叉比對。所以「來源本身對不對」**無法用機械交叉驗證**。'
        ),
        'human_review': (
            '2026-07-14：改用人工逐題檢視全部 92 題（題幹 + 四個選項 + 答案），'
            '尋找 214245506.pdf 那種「選項與題目語意不通」的錯位指紋 ——'
            ' **沒有發現**。每一題的四個選項都是同一主題上的合理替代項。'
            '旁證：q011「碳關稅(CBAM)」的答案是「防止碳洩漏」，'
            '與 iPAS 公版教材《淨零碳管理基礎概論》一致。'
        ),
        'honest_limit': (
            '**「我讀過而且沒看到問題」不是「已驗證」。** 這是一個人工的陰性結果，'
            '沒有第二份來源可以背書。不要把它寫成「已交叉驗證」。'
        ),
    },
    'S_IPAS_115_01_L11': {
        'status': 'OFFICIAL',
        'note': (
            'iPAS 官方公告試題（115 年第一次，考試日期 2026-05-16，官網 2026-07-29 公告），答案取自 PDF 的答案欄。'
            'PDF 首頁註明「※相關法規可能修訂，試題參考答案以該次考試公告時之法規內容為準。」'
            '—— 所以每一題都標時效，valid_as_of 為考試日期。'
        ),
    },
    'S_IPAS_115_01_L12': {
        'status': 'OFFICIAL',
        'note': (
            'iPAS 官方公告試題（115 年第一次，考試日期 2026-05-16，官網 2026-07-29 公告），答案取自 PDF 的答案欄。'
            'PDF 首頁註明「※相關法規可能修訂，試題參考答案以該次考試公告時之法規內容為準。」'
            '—— 所以每一題都標時效，valid_as_of 為考試日期。'
        ),
    },
}

# 試過、驗證後放棄的做法（寫進 _meta.tried_and_rejected，避免下一個人再試一次）。
TRIED_AND_REJECTED = {
    'answer_vs_explanation_detector': (
        '曾寫過一支「答案的文字對不對得上該題解析」的偵測器，'
        '想用**單一來源的內部一致性**取代交叉比對。'
        '**在已知有病的 214245506.pdf 上驗證後放棄**：已知錯位的題目分數是 0.00 / 0.12 / 0.58，'
        '而**健康的題目也有 0.00 / 0.06 / 0.06** ——分佈完全重疊，'
        '**沒有鑑別力**；而且 159 題裡只有 21 題抽得出解析。'
        '**一個分不開陽性與陰性的偵測器，它的綠燈是一句假的保證。** 已刪除，不 ship。'
    ),
}

# 來源 PDF 各自的總題數。這是「對帳」的分母 ——
# 少了這個，manifest 只能說「我還原了 159 題」，卻證明不了「沒有東西被弄丟」。
EXPECTED_QUESTION_COUNT = {'S_CHU_06': 100, 'S_CHU_07': 70, 'S_IPAS_115_01_L11': 50, 'S_IPAS_115_01_L12': 50}

COLUMN_BOUNDARY = 292.0
CJK = re.compile(r'[⺀-鿿豈-﫿＀-￯]')
Q_RE = re.compile(r'^\(([A-D])\)\s*(\d{1,3})\s*[.、]\s*(.*)$')
OPT_RE = re.compile(r'^\(([A-D])\)\s*(.*)$')
SEP_RE = re.compile(r'^-{5,}$')


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def normalized_text_payload(stem: str, options: list[dict]) -> str:
    """指紋的原文：題幹去掉所有 Unicode 空白（同 str.isspace()），選項只去掉空格、tab、CR、LF，
    選項依 key 排序 —— 只認內容，不認排版。

    quiz-app/src/data/restoration-manifest.test.ts 有一份逐位元一致的 TS 鏡像；兩邊共用
    quiz-app/src/data/__fixtures__/normalized_text_sha256_vectors.json 的測試向量。
    """
    return re.sub(r'\s+', '', stem) + '||' + '|'.join(
        f"{o['key']}:{re.sub(r'[ \t\r\n]+', '', o['text'])}"
        for o in sorted(options, key=lambda x: x['key'])
    )


def normalized_text_sha256(stem: str, options: list[dict]) -> str:
    """題目內容的正規化指紋：normalized_text_payload() 的 sha256。"""
    return sha256_bytes(normalized_text_payload(stem, options).encode('utf-8'))


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
    import pdfplumber  # 延後 import：只有真的讀 PDF 時才需要（離線組裝與測試用不到）

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
        'counter_argument': '**反面證據（2026-07-14 補記）：**題目問的是「基**線**年」，而 iPAS 公版教材《溫室氣體盤查方法與解析(ISO 14064-1)》裡「基**準**年」出現 **16 次**（另一冊 11 次），「基**線**年」出現 **0 次**、「基線」也是 **0 次** —— 亦即**盤查用語裡根本沒有「基線年」**。若出題者是刻意設術語陷阱，則答案卡的 (D) 以上皆非才是對的。**我們仍維持 C**，理由是：這份是第三方模擬題（非官方試題），其「基線年」極可能只是「基準年」的口語寫法；而 ISO 14064-1 對 base year 的定義與選項 C 逐字相符，選項 A／B 都不是。**但這個不確定性應該被記錄下來，而不是被藏起來。**',
        'revisited_on': '2026-07-14',
        'revisit_note': '2026-07-14：新寫的 tools/answer_key_crosscheck.py 把這題報成「錯答案」，因為**那支工具不知道 answer_override 這套機制存在**，我還差點照著改下去。兩個互不知道的系統一定會漂 —— 已讓該工具讀這份 manifest。這筆偏離**維持不變**：「我覺得應該是 D」不是推翻一個有依據的記錄的理由。',
    },
    # S_CHU_07 兩題的答案卡印錯；依同一份模擬卷乾淨版本右欄的答案更正。
    ('S_CHU_07', 30): {
        'source_answer_key': 'A',
        'corrected_answer': 'C',
        'reason': '來源 PDF 的答案卡印 (A)；乾淨版本右欄的答案是 (C)，正是本題被錯位掉的那個 (C)。',
        'evidence': (
            '乾淨版本 https://usr.chu.edu.tw/var/file/81/1081/img/1034/190841777.pdf 右欄答案卡：(C) 直接監測法通過監測排氣濃度和流率來量測，'
            '而質量平衡法通過計算物質的進出和轉換來估算。'
        ),
        'decided_on': '2026-07-14',
    },
    ('S_CHU_07', 34): {
        'source_answer_key': 'A',
        'corrected_answer': 'B',
        'reason': '來源 PDF 的答案卡印 (A)；乾淨版本右欄的答案是 (B)。本題的 (C) 也錯位，但正解 (B) 的文字兩版相同。',
        'evidence': '乾淨版本 https://usr.chu.edu.tw/var/file/81/1081/img/1034/190841777.pdf 右欄答案卡：(B) 次級數據。',
        'decided_on': '2026-07-14',
    },
}


# 沒有進題庫、因為主庫已經有同一題的來源題（去重）。配對與答案一致由人裁決、登記在這裡。
#
# 以前每次重組都用模糊比對重新猜：題幹相似度 >= 0.80 就當成同一題，再比選項文字的相似度判斷
# 答案是否一致。主庫那一題被合法地改寫（換個講法、修個錯字）時分數會變，猜出來的配對或
# 「答案一致」也跟著變 —— CI 會為了一件沒發生的事硬轉紅，錯誤訊息還指向不相干的還原題。
# 模糊比對留下來只做兩件事：manifest 上記相似度給人看，以及替沒登記的丟棄題找最接近的候選。
#
# 每一筆記下裁決當時兩邊的樣子：
#   dataset_item         主庫那一題：gist_items[<index 欄位>]（**不是**陣列位置）或 item_id
#   dataset_answer       主庫那一題的正解字母
#   dataset_answer_text  主庫那一題正解選項的文字
#   source_answer_key    來源 PDF 印的答案卡
#   source_text_sha256   來源那一題的內容指紋（normalized_text_sha256）
#   decided_on、why      誰、何時、憑什麼認定「同一題、答案是同一個選項」
# 重組時逐項核對：主庫那一題還在，它的正解（字母與文字）、來源那一題（內容與答案卡）都還是登記的樣子。
# 任何一項變了就是答案衝突：不寫 manifest，要重新裁決 —— 對調選項文字、調了順序、改寫正解的意思、
# 換掉整題、來源改版印了別的答案卡，都會在這裡被擋下。只改寫主庫那一題的題幹或其他選項不受影響
# （題幹相似度記在 manifest 上給人看）。
DATASET_DUPLICATES = {
    ('S_CHU_07', 13): {
        'dataset_item': 'gist_items[408]',
        'dataset_answer': 'D',
        'dataset_answer_text': '化石與生質碳排放與移除',
        'source_answer_key': 'D',
        'source_text_sha256': '4033fe0c60d0e4bdc62cf122bb518cbd62373d7e20889884a326ba521aabc664',
        'decided_on': '2026-09-28',
        'why': '同一題（ISO 14064-1:2018 何者非強制揭露）；來源的 (D)「產生自化石與生質碳之GHG排放與移除」'
               '就是主庫的 (D)「化石與生質碳排放與移除」。主庫原本答 C，2026-07-13 依 ISO 14064-1:2018 '
               '§9.3.1(g) 與規範性附錄 E 裁決為 D（見 DATA-PROVENANCE.md）。',
    },
    ('S_CHU_07', 23): {
        'dataset_item': 'gist_items[430]',
        'dataset_answer': 'D',
        'dataset_answer_text': '國際排放係數',
        'source_answer_key': 'A',
        'source_text_sha256': '397063985dc1dc64ff4c44bbd932e3f829e2857260e47168c6374792edb210b2',
        'decided_on': '2026-09-28',
        'why': '同一題（哪一種排放係數的不確定性最高），誘答選項與選項順序不同：來源的 (A)「國際排放係數」'
               '是主庫的 (D)。',
    },
    ('S_CHU_07', 32): {
        'dataset_item': 'S_YAMOL_018-q002',
        'dataset_answer': 'A',
        'dataset_answer_text': '數據收集資訊，包括數據來源；',
        'source_answer_key': 'A',
        'source_text_sha256': 'e37b74595398db0e4b4f6222bf6517310f1c0fc2c6a2b3e1dcd8a6d079a7e15d',
        'decided_on': '2026-09-28',
        'why': '同一題、同一個答案 (A)「數據收集資訊，包括數據來源」。來源這一題的 (C) 印成「ISO9001」，'
               '主庫的 (C) 是「內外部議題」。',
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


# 來源 PDF 自己印錯的選項文字，依另一份一手來源逐筆更正（記進該題的 transformations）。
# 每個來源一張表，自帶出處；表上記「PDF 印的」與「更正後」的文字。套用前先確認 PDF 原文正是前者
# —— 對不上就中止，不猜。表上每一題都必須剛好用到一次。
OPTION_FIXES = {
    # 214245506.pdf 第 30–40 題的 (C) 錯位（見 SOURCE_REVIEWS）。同一份模擬卷另有乾淨版本，
    # 以題幹（不是題號）配對、逐選項比對。printed_from：本題印的 (C) 其實是哪一題的 (C)。
    # why／evidence 是模板：{key}、{pdf}、{fixed}、{printed_from} 換成這一列的值，其餘文字（含大括號）原樣保留。
    'S_CHU_07': {
        'why': '來源 PDF 214245506.pdf 第 30–40 題的 (C) 錯位：本題印的「{pdf}」是第 {printed_from} 題的 (C)。',
        'evidence': (
            '同一份模擬卷的乾淨版本 https://usr.chu.edu.tw/var/file/81/1081/img/1034/190841777.pdf 上，'
            '本題的 ({key}) 為「{fixed}」；其餘三個選項與題幹皆相符（不計空白、標點與字形相同的異碼字；'
            '以題幹配對，非題號）。'
        ),
        'decided_on': '2026-07-14',
        # 錯位發生的區段（SOURCE_REVIEWS 的 defect）：printed_from 只能是這一段裡的另一題
        'misaligned': (30, 40),
        'questions': {
            30: {'key': 'C', 'printed_from': 31, 'pdf': '功能單位或宣告單位',
                 'fixed': '直接監測法通過監測排氣濃度和流率來量測，而質量平衡法通過計算物質的進出和轉換來估算'},
            31: {'key': 'C', 'printed_from': 32, 'pdf': '內外部議題',
                 'fixed': '功能單位或宣告單位'},
            33: {'key': 'C', 'printed_from': 34, 'pdf': '場址特定數據',
                 'fixed': 'ISO9001'},
            34: {'key': 'C', 'printed_from': 35, 'pdf': '確保量化結果的全面性和準確性',
                 'fixed': '場址特定數據'},
            35: {'key': 'C', 'printed_from': 36, 'pdf': '增加報告的複雜度',
                 'fixed': '確保量化結果的全面性和準確性'},
            36: {'key': 'C', 'printed_from': 37, 'pdf': '保證結果的客觀性和可靠性',
                 'fixed': '增加報告的複雜度'},
            38: {'key': 'C', 'printed_from': 39, 'pdf': '適當揭露假設、方法及數據的使用',
                 'fixed': '納入所有重大GHG排放與移除量'},
            40: {'key': 'C', 'printed_from': 31, 'pdf': '功能單位或宣告單位',
                 'fixed': '重複計算所有排放源'},
        },
    },
}


_TEMPLATE_FIELDS = ('key', 'pdf', 'fixed', 'printed_from')
_TEMPLATE_FIELD = re.compile(r'\{(key|pdf|fixed|printed_from)\}')
_TEMPLATE_LIKE = re.compile(r'\{([^{}]*)\}')  # 大括號裡的東西；是不是打錯的模板欄位由 _template_typo 判斷


def _template_typo(inner: str) -> bool:
    """大括號裡的東西是不是打錯的模板欄位（原樣印出去就會寫進 manifest）。
    全大寫的名字（{GWP}、{CO2_EQ}）是一般文字，除非它就是某個欄位（{PDF}）或只差一兩個字（{PRINTED_FRM}）；
    其餘長得像名字的都算：{printed_frm}、{printedFrom}、{printed-from}、{ key }、{pdf1}。"""
    if inner in _TEMPLATE_FIELDS:
        return False
    if re.fullmatch(r'[A-Z0-9_]+', inner):
        return bool(difflib.get_close_matches(inner.lower(), _TEMPLATE_FIELDS, n=1, cutoff=0.8))
    return bool(re.fullmatch(r'\s*[A-Za-z0-9_-]+\s*', inner))


def _fill(template: str, row: dict, where: str) -> str:
    """模板裡的 {key}、{pdf}、{fixed}、{printed_from} 換成這一列的值；其餘文字（含「{GWP}」這種大括號）原樣保留。

    長得像模板欄位、卻不在清單上的（「{printed_frm}」「{printedFrom}」，見 _template_typo）是打錯字：
    原樣印出去就會寫進 manifest，所以擋下。
    """
    typos = sorted(inner for inner in {m.group(1) for m in _TEMPLATE_LIKE.finditer(template)} if _template_typo(inner))
    if typos:
        sys.exit(f'✗ {where}：OPTION_FIXES 的模板用到不認得的欄位 {typos}（可用的是 {list(_TEMPLATE_FIELDS)}）。')

    def value(m):
        if m.group(1) not in row:
            sys.exit(f'✗ {where}：OPTION_FIXES 這一列沒有 {m.group(1)}，模板卻用到 {m.group(0)}。')
        return str(row[m.group(1)])
    return _TEMPLATE_FIELD.sub(value, template)


def _check_option_fix_table(table: dict, src_id: str) -> None:
    """表本身要自洽：缺鍵、或 printed_from 與表上的別列對不起來，就中止 —— 不等寫進 manifest 才被人讀到。"""
    missing = [k for k in ('why', 'evidence', 'decided_on', 'misaligned', 'questions') if k not in table]
    if missing:
        sys.exit(f'✗ {src_id}：OPTION_FIXES 的表缺少 {missing}。')
    rows = table['questions']
    if not rows:
        sys.exit(f'✗ {src_id}：OPTION_FIXES 的表沒有任何一題 —— 不需要修正就把整張表拿掉。')
    span = table['misaligned']
    if not (isinstance(span, (list, tuple)) and len(span) == 2 and all(type(n) is int for n in span)
            and span[0] < span[1]):
        sys.exit(f'✗ {src_id}：OPTION_FIXES 的 misaligned 是 {span!r}，應是錯位區段的頭尾兩個題號（整數，頭小於尾）。')
    lo, hi = span
    for n, f in rows.items():  # 下面的自洽檢查會讀這幾欄：先確定都在，缺了才說得出是哪一題
        missing = [k for k in ('key', 'pdf', 'fixed') if k not in f]
        if missing:
            sys.exit(f'✗ {src_id} 第 {n} 題：OPTION_FIXES 這一列缺少 {missing}。')
    outside = sorted(n for n in rows if not lo <= n <= hi)
    if outside:
        sys.exit(f'✗ {src_id}：OPTION_FIXES 的第 {outside} 題不在錯位的區段第 {lo}–{hi} 題裡。')
    for n, f in rows.items():
        if 'printed_from' not in f:
            continue  # 模板用到卻缺少時，_fill 會指名這一列
        p = f['printed_from']
        if type(p) is not int:  # None 會讓兩個方向的檢查都跳過、manifest 寫出「第 None 題」；bool 也不是題號
            sys.exit(f'✗ {src_id} 第 {n} 題：printed_from 是 {p!r}，應是題號（整數）。')
        # 錯位發生在這一段題目之間：本題印的選項來自同一段裡的另一題
        if p == n or not lo <= p <= hi:
            sys.exit(f'✗ {src_id} 第 {n} 題：printed_from={p}，應是第 {lo}–{hi} 題中的另一題。')
        # 兩個方向都要對得上（表內能自證的部分；指向表外的題目要對照乾淨版本 PDF 才驗得了）：
        #   那一題在表上 → 本題印的文字必須正是那一題更正後的文字；
        #   表上有哪一題更正後的文字正是本題印的 → printed_from 必須指向那一題。
        if p in rows and rows[p]['key'] == f['key'] and rows[p]['fixed'] != f['pdf']:
            sys.exit(f'✗ {src_id} 第 {n} 題：printed_from={p}，但本題印的「{f["pdf"]}」'
                     f'不是第 {p} 題更正後的 ({f["key"]})「{rows[p]["fixed"]}」。')
        owners = [m for m, g in rows.items() if m != n and g['key'] == f['key'] and g['fixed'] == f['pdf']]
        if owners and p not in owners:
            sys.exit(f'✗ {src_id} 第 {n} 題：本題印的「{f["pdf"]}」正是第 {owners[0]} 題更正後的 ({f["key"]})，'
                     f'printed_from 卻是 {p}。')


def apply_option_fixes(qs, src_id):
    """套用 OPTION_FIXES[src_id]，回傳 {題號: [transformation]}。表上每一題都必須剛好用到一次。"""
    table = OPTION_FIXES.get(src_id)
    if table is None:
        return {}
    _check_option_fix_table(table, src_id)
    applied = {}
    for q in qs:
        f = table['questions'].get(q['number'])
        if f is None:
            continue
        opt = next((o for o in q['options'] if o['key'] == f['key']), None)
        if opt is None or opt['text'] != f['pdf']:
            sys.exit(f'✗ {src_id} 第 {q["number"]} 題：OPTION_FIXES 記的 PDF 原文是「{f["pdf"]}」，'
                     f'實際擷取到 {opt["text"] if opt else None!r} —— 來源或擷取器已變動，必須人工重新確認。')
        opt['text'] = f['fixed']
        where = f'{src_id} 第 {q["number"]} 題'
        applied[q['number']] = [{
            'fix': f'option ({f["key"]}) text: 「{f["pdf"]}」 -> 「{f["fixed"]}」',
            'why': _fill(table['why'], f, where),
            'evidence': _fill(table['evidence'], f, where),
            'decided_on': table['decided_on'],
        }]
    unused = sorted(set(table['questions']) - set(applied))
    if unused:
        sys.exit(f'✗ {src_id}：OPTION_FIXES 有沒用到的題號 {unused} —— 表與來源對不上。')
    return applied


def load_pdf(src_id: str, cache: Path) -> bytes:
    meta = SOURCES[src_id]
    local = cache / f'{src_id}.pdf'
    cached = local.exists()
    if cached:
        data = local.read_bytes()
    else:
        print(f'  下載 {meta["url"]}')
        with urllib.request.urlopen(meta['url'], timeout=60) as r:
            data = r.read()
    got = sha256_bytes(data)
    if got != meta['sha256'] and cached:
        # 快取檔壞了不等於來源變了（例如舊版工具先寫快取才驗 sha256，壞掉的下載就留在快取裡）
        sys.exit(f'✗ {src_id} 快取的 {local} sha256 不符！\n  期望 {meta["sha256"]}\n  實得 {got}\n'
                 '  快取檔可能壞了：刪掉它再重跑，會重新下載；重新下載後仍不符，才是來源檔案變了。')
    if got != meta['sha256']:
        # 不符不一定是來源變了：網站的擋頁（Incapsula）、被截斷的回應也會不符 —— 先看拿到的是不是 PDF
        if data[:5] != b'%PDF-':
            what = (f'不是 PDF（開頭 {data[:16]!r}）：多半是網站的擋頁，換個方式（例如瀏覽器）下載、確認是 PDF '
                    '再放進快取。')
        elif b'%%EOF' not in data[-2048:]:
            what = 'PDF 的開頭，但檔尾沒有 %%EOF：多半是下載被截斷，重新下載。'
        else:
            what = '是完整的 PDF：來源檔案已變動 —— manifest 的錨點失效，必須人工重新確認。'
        sys.exit(f'✗ {src_id} 下載的檔案 sha256 不符，沒有放進快取（{len(data)} bytes）！\n'
                 f'  期望 {meta["sha256"]}\n  實得 {got}\n  {what}')
    if not cached:
        local.write_bytes(data)
    print(f'  ✓ {src_id} sha256 相符 ({len(data)} bytes)')
    return data


def _norm_for_compare(s: str) -> str:
    """比對用的正規化：剝空白、剝標點。'數據來源' 與 '數據來源；' 是同一件事。"""
    return re.sub(r'[\s，,。.；;、：:（）()「」【】]', '', s)


def _how_alike(source: str, twin: str, similarity: float) -> str:
    """duplicate_in_dataset 證據的開頭：兩邊的題幹有多像。source、twin 是 _norm_for_compare 之後的題幹；
    「相同」看的是字串本身，不是四捨五入過的相似度（長題幹只差一個字，相似度也近 1）。"""
    if source == twin:
        return '題幹相同（不計空白與標點）'
    return '題幹幾乎相同' if similarity >= 0.80 else '主庫那一題的題幹已改寫'


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
    return difflib.SequenceMatcher(None, a, b).ratio()


def _answer_option_alignment(src_q: dict, ds_item: dict) -> float:
    """來源正解選項的文字，和主庫最像的那一個選項有多像（manifest 的 answer_option_alignment，只給人看）。

    「答案是否一致」不由這個分數決定，由 DATASET_DUPLICATES 的人工裁決決定（理由見那張表的說明）。

    比的是選項文字、不是字母：同一道題在不同來源的選項順序常常不同，這邊的 D 可能是那邊的 A
    （先前答案回填就踩過這個坑，把字母當答案抄）。也不比文字是否相等：同一個選項換個講法
    （來源印「產生自化石與生質碳之GHG排放與移除」，主庫寫「化石與生質碳排放與移除」）字面就不同。
    所以拿來源的正解選項文字和主庫的每一個選項比相似度，記下最像的那一個的分數。
    """
    src_ans = _answer_text(src_q)
    if src_ans is None or ds_item.get('answer') is None:
        return 0.0
    src_norm = _norm_for_compare(src_ans)
    return round(max(_similar(src_norm, _norm_for_compare(o['text'])) for o in ds_item['options']), 3)


def _dataset_ref(item: dict) -> str:
    """主庫題目在 manifest 與 DATASET_DUPLICATES 裡的稱呼：題庫題用 item_id，gist 題用它的 index 欄位。"""
    return item.get('item_id') or f"gist_items[{item.get('index')}]"


def _disposition_for_dropped(q: dict, src_id: str, same_pdf: dict, ds_items: list) -> dict:
    """一道「沒有進 dataset」的來源題，到底發生了什麼事？必須拿出證據，不能用猜的。

    舊版是這樣寫的：

        if item_id not in by_item:
            continue          # 這一題與 gist 主庫重複，還原時已去重

    那行註解是**斷言**，不是驗證。它把「dataset 裡沒有」直接等同於「一定是重複題」。
    真的在還原過程中掉了一題，這行也會安靜地把它說成重複，而且沒有任何人會知道。
    實測結果：170 題裡有 11 題走進這條路，其中 8 題確實是 PDF 自己重印的題目，
    但另外 3 題並不是 —— 而且其中一題的答案還跟主庫**互相矛盾**。

    same_pdf：同一份 PDF 每一題的 {題號: (內容指紋, 答案卡)}。
    答案衝突（重印的兩題答案卡不同、主庫那一題的正解字母不是登記的那個）記成 *_ANSWER_CONFLICT，
    assemble() 會把它們列進 answer_conflicts，而 --emit／--reassemble 不寫出有衝突的 manifest。
    """
    qhash = normalized_text_sha256(q['stem'], q['options'])
    qnorm = _norm_for_compare(q['stem'])

    # 1) 同一份 PDF 裡有一模一樣的題目（PDF 自己重印）。兩處印的答案卡也必須相同 ——
    #    否則是 PDF 自己前後矛盾，丟掉哪一題都等於替另一題的答案背書。
    twin = [n for n, (h, _) in same_pdf.items() if h == qhash and n < q['number']]
    if twin:
        twin_answer = same_pdf[twin[0]][1]
        d = {
            'status': 'duplicate_within_source',
            'duplicate_of': {'source_id': src_id, 'source_question_number': twin[0]},
            'evidence': 'normalized_text_sha256 完全相同（同一份 PDF 重印了這一題）',
            'normalized_text_sha256': qhash,
        }
        if twin_answer != q['answer']:
            # 目前沒有任何一組重印題的答案卡不同，所以工具沒有登記這種裁決的表（DATASET_DUPLICATES 與
            # ANSWER_OVERRIDES 都不適用：前者對的是主庫的題目，後者對的是還原進題庫的題目）。
            d['status'] = 'duplicate_within_source_ANSWER_CONFLICT'
            d['evidence'] = (f'同一份 PDF 重印了這一題，但答案卡不同：第 {twin[0]} 題印 {twin_answer}、'
                             f'第 {q["number"]} 題印 {q["answer"]}。工具目前沒有登記這種裁決的地方 —— '
                             '先問專案所有者：要用一手依據裁決哪一個對，並在工具裡加一張裁決表。')
        return d

    # 2) 主庫已經有同一題：由 DATASET_DUPLICATES 登記的配對決定，不用相似度猜
    pin = DATASET_DUPLICATES.get((src_id, q['number']))
    if pin is not None:
        found = [it for it in ds_items if _dataset_ref(it) == pin['dataset_item']]
        if len(found) != 1:
            sys.exit(f'✗ {src_id}#{q["number"]}：DATASET_DUPLICATES 登記它與 {pin["dataset_item"]} 重複，'
                     f'主庫卻找到 {len(found)} 題叫這個名字 —— 那一題被刪了或改了 id，要重新裁決。')
        twin_item = found[0]
        similarity = round(_similar(qnorm, _norm_for_compare(twin_item['stem'])), 3)
        changed = [what for what, now, then in (
            ('主庫那一題的正解字母', twin_item.get('answer'), pin['dataset_answer']),
            ('主庫那一題正解選項的文字', _answer_text(twin_item), pin['dataset_answer_text']),
            ('來源 PDF 的答案卡', q['answer'], pin['source_answer_key']),
            ('來源那一題的內容', qhash, pin['source_text_sha256']),
        ) if now != then]
        agree = not changed
        d = {
            'status': 'duplicate_in_dataset' if agree else 'duplicate_in_dataset_ANSWER_CONFLICT',
            'duplicate_of': {'dataset_item': pin['dataset_item']},
            'stem_similarity': similarity,
            'source_answer_key': q['answer'],
            'source_answer_text': _answer_text(q),
            'dataset_answer': twin_item.get('answer'),
            'dataset_answer_text': _answer_text(twin_item),
            'answers_agree': agree,
            'answer_option_alignment': _answer_option_alignment(q, twin_item),  # 僅供參考
            'normalized_text_sha256': qhash,
        }
        if not agree:
            d['evidence'] = (f'DATASET_DUPLICATES 登記的配對（主庫 {pin["dataset_item"]} 的 ({pin["dataset_answer"]})'
                             f'「{pin["dataset_answer_text"]}」＝ 來源答案卡 ({pin["source_answer_key"]})）與現況不同：'
                             f'{"、".join(changed)}變了 —— 要重新裁決。')
        else:
            # 配對與答案一致是人裁決的（工具不再自己比對）：證據就是那筆登記的日期與理由
            stem = _how_alike(qnorm, _norm_for_compare(twin_item['stem']), similarity)
            d['evidence'] = (f'{stem}。兩邊是同一題、答案一致，由人登記（DATASET_DUPLICATES，{pin["decided_on"]}）：'
                             f'{pin["why"]}')
        return d

    # 3) 沒有任何證據 —— 這題就是掉了。絕不可以安靜跳過。最接近的主庫題目只是給人查的線索。
    best, best_r = None, 0.0
    for it in ds_items:
        r = _similar(qnorm, _norm_for_compare(it['stem']))
        if r > best_r:
            best, best_r = it, r
    return {
        'status': 'UNACCOUNTED',
        'evidence': ('在 dataset 裡找不到、在同一份 PDF 裡也沒有重複題 —— '
                     '這題在還原過程中遺失了。'),
        'stem': q['stem'][:80],
        'closest_in_dataset': _dataset_ref(best) if best else None,
        'closest_similarity': round(best_r, 3),
        'normalized_text_sha256': qhash,
    }


EXTRACTORS = {'two_column': extract, 'ipas_exam_table': ipas_exam_pdf.extract}
HEADER_READERS = {'ipas_exam_table': ipas_exam_pdf.header}  # 讀得到頁首（哪一場、哪一科）的版面


EXAM_SUBJECT = {'L11': '考科1', 'L12': '考科2'}  # iPAS 的科目代號 → 題庫的考科


def check_official_header(src_id: str, meta: dict, header) -> None:
    """官方來源：PDF 頁首的場次、考試日期、科目（與它決定的考科）、標題，必須與 SOURCES 登記的一致。

    sha256 釘住了 PDF 的位元組，但 SOURCES 的這幾欄是人抄的：新增一場時從上一場複製一份、漏改場次，
    整份的題目就會安靜地標成錯的場次（題卡標籤、官方引文的 note、valid_as_of 都跟著錯）。
    讀 PDF 時（--emit、--verify、匯入）拿 PDF 的頁首比；--emit 把頁首記進擷取快照，不讀 PDF 的 --reassemble
    與 CI 拿快照裡的頁首比（改了 SOURCES 卻對不上 PDF，CI 就轉紅）。
    """
    wrong = [f'{what}：SOURCES 寫「{mine}」，PDF 頁首是「{theirs}」' for what, mine, theirs in (
        ('場次', meta['session'], header.session),
        ('考試日期', meta['exam_date'], header.exam_date),
        ('科目', meta['subject'], header.subject_code),
        ('考科', meta['exam_subject'], EXAM_SUBJECT.get(header.subject_code)),
        ('標題', meta['title'], header.title + header.subject),
    ) if mine != theirs]
    if wrong:
        sys.exit(f'✗ {src_id} 的 PDF 頁首與 SOURCES 不符：' + '；'.join(wrong) + '。')


def extract_sources(cache: Path) -> dict:
    """每份來源 PDF 的擷取結果（未套用任何修正）。--emit 把它原樣寫成擷取快照。"""
    out = {}
    for src_id, meta in SOURCES.items():
        layout = meta.get('layout', 'two_column')
        if layout not in EXTRACTORS:
            sys.exit(f'✗ {src_id}: 不認得的版面 {layout!r}')
        if meta.get('kind') == 'official_exam' and layout not in HEADER_READERS:
            sys.exit(f'✗ {src_id}: 官方來源的版面 {layout!r} 讀不到頁首，無法確認它是哪一場、哪一科。')
        load_pdf(src_id, cache)
        path = cache / f'{src_id}.pdf'
        header = None
        try:
            if meta.get('kind') == 'official_exam':  # 先確定是 SOURCES 說的那一場、那一科，再擷取
                header = HEADER_READERS[layout](path)
                check_official_header(src_id, meta, header)
            questions = EXTRACTORS[layout](path)
        except ValueError as e:  # ipas_exam_pdf 遇到不在預期內的版面一律丟 ValueError
            sys.exit(f'✗ {src_id}: {e}')
        out[src_id] = {'pdf_sha256': meta['sha256']}
        if header is not None:  # 官方來源：PDF 自己說的場次、日期、科目、標題（CI 拿它核對 SOURCES，見 assemble）
            out[src_id]['header'] = dataclasses.asdict(header)
        out[src_id]['questions'] = [{k: q[k] for k in ('number', 'page', 'column', 'answer', 'stem', 'options')}
                                    for q in questions]
    return out


def load_snapshot() -> dict:
    return json.loads(SNAPSHOT.read_text(encoding='utf-8'))


def load_dataset() -> dict:
    return json.loads(DATASET.read_text(encoding='utf-8'))


def render(obj: dict) -> str:
    """--emit 寫檔的格式。committed 的快照與 manifest 必須正好是這個輸出。"""
    return json.dumps(obj, ensure_ascii=False, indent=2) + '\n'


def check_question_numbers(src_id: str, qs: list) -> None:
    """一份來源擷取到的題號必須正好是 1..總題數：缺號、重號、超出範圍都是擷取器壞了，不是資料的問題。"""
    expected = EXPECTED_QUESTION_COUNT[src_id]
    counts = Counter(q['number'] for q in qs)
    problems = [label for label, numbers in (
        ('缺題號', sorted(set(range(1, expected + 1)) - set(counts))),
        ('題號重複', sorted(n for n, c in counts.items() if c > 1)),
        (f'題號超出 1–{expected}', sorted(n for n in counts if not 1 <= n <= expected)),
    ) for label in ([f'{label} {numbers}'] if numbers else [])]
    if problems:
        sys.exit(f'✗ {src_id}: 擷取結果有 {len(qs)} 題（應為 {expected}）：{"、".join(problems)} '
                 '—— 擷取器壞了（--emit／--verify 讀 PDF 時），或擷取快照被手改過（--reassemble 與測試讀快照時），'
                 '不是題庫的問題。')


def _source_question(key) -> bool:
    """(來源代號, 題號) 是不是某一份來源的某一題：來源登記過、題號在 1..總題數。"""
    src_id, number = key
    return src_id in SOURCES and 1 <= number <= EXPECTED_QUESTION_COUNT[src_id]


def check_counts_registered() -> None:
    """SOURCES 與 EXPECTED_QUESTION_COUNT 的來源必須一一對應：題數是對帳的分母。"""
    no_count = [s for s in SOURCES if s not in EXPECTED_QUESTION_COUNT]
    if no_count:
        sys.exit(f'✗ {no_count} 沒有登記總題數（EXPECTED_QUESTION_COUNT）—— 沒有分母就證明不了沒有掉題。')
    stray_count = [s for s in EXPECTED_QUESTION_COUNT if s not in SOURCES]
    if stray_count:
        sys.exit(f'✗ EXPECTED_QUESTION_COUNT 有不在 SOURCES 裡的來源 {stray_count} —— 來源代號打錯，或 SOURCES 漏登記；'
                 '否則來源總題數會把它算進去。')


def assemble(extracted: dict, ds: dict) -> dict:
    """由擷取結果（extract_sources() 或擷取快照）與題庫組出整份 manifest。不讀 PDF、不碰網路。"""
    by_item = {i['item_id']: i for i in ds['our_unique_items']}
    ds_items = ds['gist_items'] + ds['our_unique_items']

    check_counts_registered()
    # 官方來源：SOURCES 的場次、考試日期、科目、考科、標題要對得上 --emit 記下的 PDF 頁首（CI 不讀 PDF，也看得到）
    for s, meta in SOURCES.items():
        if meta.get('kind') == 'official_exam':
            recorded = extracted.get(s, {}).get('header')
            if recorded is None:
                sys.exit(f'✗ {s}：擷取快照沒有 PDF 的頁首 —— 官方來源要跑 --emit，把頁首記進快照（CI 拿它核對 SOURCES）。')
            check_official_header(s, meta, ipas_exam_pdf.Header(**recorded))

    # 先對帳每一份來源的題數：擷取器掉題時，要說「擷取器壞了」，而不是讓後面的檢查報成別的錯
    # （修正表「用不到的題號」、題庫題「對不到來源」）。
    for src_id in SOURCES:
        check_question_numbers(src_id, extracted[src_id]['questions'])

    # 題庫裡標了這些來源的題目，必須正好對到來源的某一題（item_id = <來源代號>-qNNN）。
    # item_id 打錯的題目會被當成「沒進題庫」的來源題，後面的檢查會報成別的錯（修正表、題目遺失）。
    source_ids = {f'{src_id}-q{q["number"]:03d}' for src_id in SOURCES for q in extracted[src_id]['questions']}
    stray = sorted(i['item_id'] for i in ds['our_unique_items']
                   if (i.get('source') or {}).get('source_id') in SOURCES and i['item_id'] not in source_ids)
    if stray:
        sys.exit(f'✗ 題庫裡這些題目標了 manifest 的來源，卻對不到來源的任何一題：{stray[:10]} '
                 '—— item_id 必須是「<來源代號>-q<三位數題號>」。')
    # 修正表與配對表的鍵先對過：鍵打錯時，錯誤要指向打錯的那一筆，
    # 而不是等迴圈裡報出「答案與來源不同」「題目遺失」這些症狀
    in_bank = lambda k: f'{k[0]}-q{k[1]:03d}' in by_item  # noqa: E731
    dead = sorted({k for k in ANSWER_OVERRIDES if not _source_question(k)}
                  | {(s, None) for s in OPTION_FIXES if s not in SOURCES}, key=str)
    if dead:
        sys.exit(f'✗ 修正表有對不到任何來源題的項目：{dead} —— 來源代號或題號打錯。')
    gone = sorted(f'{k[0]}-q{k[1]:03d}' for k in ANSWER_OVERRIDES if not in_bank(k))
    if gone:  # 鍵是對的、題目卻不在題庫裡：先說題目，不要叫人去改鍵
        sys.exit(f'✗ 修正表的這些題目不在題庫裡：{gone} —— 題目被刪了？誤刪請還原（刪還原題會動到 manifest，'
                 '要先問專案所有者）；若是本來就沒有進題庫的題目（例如重複題），修正不該記在它身上。')
    misplaced = sorted(k for k in DATASET_DUPLICATES if not _source_question(k) or in_bank(k))
    if misplaced:
        sys.exit(f'✗ DATASET_DUPLICATES 有對不到的項目：{misplaced} —— 來源代號或題號打錯，或那一題已經在題庫裡。')

    entries, pdf_typos, dispositions = [], {}, []
    for src_id in SOURCES:
        qs = copy.deepcopy(extracted[src_id]['questions'])  # 下面的修正會就地改寫題目

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
        option_fixes_by_no = apply_option_fixes(qs, src_id)

        # 同一份 PDF 內每題的內容指紋與答案卡 —— 用來認出「PDF 自己重印的題目」
        same_pdf = {q['number']: (normalized_text_sha256(q['stem'], q['options']), q['answer']) for q in qs}

        for q in qs:
            item_id = f'{src_id}-q{q["number"]:03d}'
            if item_id not in by_item:
                tables = [name for name, fixed in (('PDF 錯字修正（patch_pdf_typos）', fixes_by_no),
                                                   ('OPTION_FIXES', option_fixes_by_no)) if q['number'] in fixed]
                if tables:
                    sys.exit(f'✗ {item_id}: {"、".join(tables)} 修了一題沒有進題庫的題目 —— 題目被刪了？誤刪請還原'
                             '（刪還原題會動到 manifest，要先問專案所有者）。修正只記在進題庫題目的 transformations 上，'
                             '套在這一題身上就沒有對應的紀錄。')
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
                'status': 'imported' if SOURCES[src_id].get('kind') == 'official_exam' else 'restored',
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
            transformations = ([{'fix': fix['fix'], 'evidence': fix['evidence']}] if fix else []) \
                + option_fixes_by_no.get(q['number'], [])

            # raw ≠ canonical ⟺ 有列明的修正。有差異卻沒列明＝藏起來的手腳；
            # 列明了卻沒差異＝修正表與事實不符。兩種都直接失敗，不讓它進到 manifest。
            if bool(transformations) != (raw_h != canon_h):
                sys.exit(f'✗ {item_id}: raw≠canonical={raw_h != canon_h}，transformations '
                         f'{"有" if transformations else "沒有"}列明 —— 兩者必須一致。')

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
                'answer_override': ({k: v for k, v in ov.items() if k != 'source_answer_key'}
                                    if ov else None),
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
    # 每一份來源的題號都已對帳成 1..總題數（check_question_numbers），每一題恰好一筆 disposition，
    # EXPECTED_QUESTION_COUNT 與 SOURCES 的來源也一一對應（上面兩道檢查）—— 所以 disposition 數等於來源總題數。
    total_source = sum(EXPECTED_QUESTION_COUNT.values())

    by_status = {}
    for d in dispositions:
        by_status.setdefault(d['status'], []).append(
            f"{d['source_id']}#{d['source_question_number']}")

    pinned = {(d['source_id'], d['source_question_number']) for d in dispositions
              if d['status'].startswith('duplicate_in_dataset')}
    dead_pins = sorted(k for k in DATASET_DUPLICATES if k not in pinned)
    if dead_pins:  # 在「遺失」之前報：登記在錯的那一題上時，錯誤要先指向登記
        sys.exit(f'✗ DATASET_DUPLICATES 有用不到的項目：{dead_pins} —— 那一題是 PDF 自己重印的（不是與主庫重複），'
                 '或題號打錯。')

    unaccounted = [d for d in dispositions if d['status'] == 'UNACCOUNTED']
    if unaccounted:
        sys.exit('✗ 這些來源題不在題庫裡，也找不到任何重複的憑據 —— 題庫誤刪了？還原它們（刪還原題會動到 manifest，'
                 '要先問專案所有者）：\n  '
                 + '\n  '.join(f"{d['source_id']}#{d['source_question_number']}"
                               f"（最接近的主庫題目：{d['closest_in_dataset']}，題幹相似度 {d['closest_similarity']}）"
                               for d in unaccounted)
                 + '\n  沒有證據就不是「重複所以刪掉」。若確實與那一題是同一題，用一手依據裁決後登記進 '
                   'DATASET_DUPLICATES（先問專案所有者）；否則是題目真的掉了，必須人工確認。')

    conflicts = sorted(k for status, keys in by_status.items() if status.endswith('_ANSWER_CONFLICT')
                       for k in keys)
    for s, review in SOURCE_REVIEWS.items():
        if s not in SOURCES:
            sys.exit(f'✗ SOURCE_REVIEWS 有不在 SOURCES 裡的來源 {s!r}。')
        if {'items', 'subject'} & set(review):
            sys.exit(f'✗ SOURCE_REVIEWS[{s!r}] 手寫了 items／subject —— 這兩欄由資料算出，不可覆寫。')
    unreviewed = [s for s in SOURCES if s not in SOURCE_REVIEWS]
    if unreviewed:
        # 沒有查核紀錄的來源不會出現在 manifest 的 source_documents 裡 —— 安靜地缺席，而不是被看見
        sys.exit(f'✗ {unreviewed} 沒有人工查核紀錄（SOURCE_REVIEWS）：每一份來源 PDF 都要寫下查過什麼、'
                 '有沒有已知的問題。')

    restored_per_source = {s: sum(1 for e in entries if e['source_id'] == s) for s in SOURCES}

    return {
        '_meta': {
            'description': '來源 PDF 逐題的憑證：被刪除後還原的題目，以及匯入的官方公告試題。'
                           '來源 PDF 的**每一題**都有交代：restored（還原進 dataset）、'
                           'imported（官方公告試題，匯入 dataset）、duplicate_within_source（PDF 自己重印）、'
                           'duplicate_in_dataset（主庫已有相同題）。'
                           '任何一題交代不出來就是 UNACCOUNTED —— 產生 manifest 時直接失敗，'
                           '不會安靜地當成「重複」放過。',
            'hash_fields': {
                'raw_pdf_text_sha256':
                    'PDF 原文（擷取後、未套用任何修正：雙欄的模擬卷分欄擷取，官方公告試題逐列擷取表格）。'
                    '拿原始 PDF 重跑就該得到這個值。',
                'canonical_source_text_sha256':
                    '套用 transformations 所列的修正之後的來源文字。dataset 應該等於這個。',
                'dataset_text_sha256': 'repo 裡「現在」的文字。',
                'transformations':
                    '這一題做過哪些修正、憑什麼做。空陣列＝原文照抄。'
                    'raw ≠ canonical 與「有列明 transformations」不一致時（有差異卻沒列明，或列明了卻沒差異），'
                    '產生 manifest 時直接失敗 —— 不允許存在「沒被記錄的轉換」。',
                'why':
                    '舊版只存一個 pdf_text_sha256，名字宣稱是「PDF 裡的文字」，實際卻是'
                    '「套用修正之後」的文字（S_CHU_06 第 37 題的選項標號原文是 (A)(B)(B)(C)，'
                    '被改成 (A)(B)(C)(D)）。結果任何人拿原始 PDF 重算都會對不上，'
                    '而且看不出為什麼。一條只有作者本人重算才對得上的證據鏈，不是證據鏈。',
            },
            'generated_by': 'tools/restore_from_source_pdf.py',
            'source_question_total': total_source,
            'restored_count': len(by_status.get('restored', [])),
            'imported_count': len(by_status.get('imported', [])),
            'disposition_summary': {k: len(v) for k, v in sorted(by_status.items())},
            'answer_conflicts': conflicts,
            # 有衝突的 manifest 不會被寫出去（refuse_to_write），所以 committed 的這兩欄永遠是 [] 與 null；
            # 留著是讓 verify() 與直接呼叫 assemble() 的人看得到衝突是什麼。
            'answer_conflict_note':
                '這些丟棄題的答案卡與它所對應的題目不一致（主庫那一題、或同一份 PDF 重印的另一題）。'
                '要先用一手依據裁決：主庫錯就改主庫；配對或登記的字母過時，就更新 DATASET_DUPLICATES。'
                if conflicts else None,
            'sources': {k: dict(v) for k, v in SOURCES.items()},
            'source_pdf_typos': pdf_typos,
            'how_to_reproduce': [
                'uv sync --locked --project tools',
                'uv run --locked --project tools python tools/restore_from_source_pdf.py --verify',
            ],
            'ci_note': 'CI 不下載 PDF：restoration-manifest.test.ts 驗 manifest ↔ dataset 一致；'
                       'tools/tests/test_restore_reproducibility.py 用 committed 的擷取快照重組整份 manifest、逐字比對。'
                       '快照與來源 PDF 是否一致，由 --verify 驗。',
            'source_documents': {
                SOURCES[s]['url']: {'items': restored_per_source[s], 'subject': s, **review}
                for s, review in SOURCE_REVIEWS.items()
            },
            'tried_and_rejected': TRIED_AND_REJECTED,
            'imported_note': '官方公告試題（SOURCES 的 kind 為 official_exam）不是被刪除後還原的題目：'
                             '在題庫裡的記為 imported，不計入 restored_count。其餘規則與還原題相同：逐題記錄'
                             ' PDF 的 sha256、頁碼、題號、PDF 印的答案與三個文字 hash，任何偏離都要列明。',
        },
        'entries': entries,
        'dispositions': dispositions,
    }


def check_snapshot(extracted: dict) -> None:
    """擷取快照必須正好對應 SOURCES 裡的每一份 PDF（同一組來源、同一個 sha256）。"""
    have = {s: v.get('pdf_sha256') for s, v in extracted.items()}
    want = {s: v['sha256'] for s, v in SOURCES.items()}
    if have != want:
        sys.exit('✗ 擷取快照與 SOURCES 對不上（來源或 PDF 的 sha256 不同）。來源 PDF 換了或加了來源，'
                 '要跑 --emit 重新擷取；不可以手改快照。')


def refuse_to_write(man: dict) -> None:
    """repo 內容與來源不一致、或有答案衝突的 manifest 不寫出去：那是要先處理的問題，不是要記錄的結果。"""
    drift = [e['item_id'] for e in man['entries'] if not e['matches_source']]
    conflicts = man['_meta']['answer_conflicts']
    problems = []
    if drift:
        problems.append(f'題庫的文字與來源不一致 {drift[:10]}：還原題的文字不可以改（AGENTS.md）；'
                        '誤改請還原，若確定是來源本身的錯，先問專案所有者。')
    if conflicts:
        detail = '；'.join(f"{d['source_id']}#{d['source_question_number']}：{d['evidence']}"
                          for d in man['dispositions'] if d['status'].endswith('_ANSWER_CONFLICT'))
        problems.append(f'答案衝突 {conflicts[:10]}（{detail}）要先用一手依據裁決（先問專案所有者）。')
    if problems:
        sys.exit('✗ 不寫 manifest：' + '\n  '.join(problems))


def build(cache: Path) -> tuple[dict, dict]:
    """從來源 PDF 重跑：回傳（擷取結果, manifest）。"""
    extracted = extract_sources(cache)
    return extracted, assemble(extracted, load_dataset())


DIFF_LINES = 60


def _rel(path: Path):
    """顯示用：repo 裡的檔案印相對路徑，其他照原樣。"""
    try:
        return path.relative_to(REPO)
    except ValueError:
        return path


def _same_as_committed(path: Path, fresh_text: str) -> bool:
    """committed 的檔案必須與重跑結果逐字相同。

    行尾不計：這個專案在 Windows 上以 core.autocrlf=true 開發，工作區的 JSON 會是 CRLF，
    read_text() 會把它讀回 LF。不同時印出差異，讓人看得到是哪一行、哪個欄位。
    """
    rel = _rel(path)
    try:
        committed = path.read_text(encoding='utf-8') if path.exists() else ''
    except UnicodeDecodeError:
        print(f'  ✗ {rel} 不是 UTF-8（編輯器以其他編碼存檔，例如 cp950）')
        return False
    if committed == fresh_text:
        print(f'  ✓ {rel} 與重跑結果相同')
        return True
    print(f'  ✗ {rel} 與重跑結果不同：')
    if not path.exists():
        print('      檔案不存在')
        return False
    if committed.rstrip('\n') == fresh_text.rstrip('\n'):
        print('      只差在檔尾換行（手動編輯器存檔常見）')
        return False
    if committed.startswith('\ufeff'):
        print('      檔案開頭有 BOM（手動編輯器存檔常見）')
        return False
    diff = list(difflib.unified_diff(committed.splitlines(), fresh_text.splitlines(),
                                     f'{rel}（committed）', f'{rel}（重跑）', lineterm='', n=1))
    for line in diff[:DIFF_LINES]:
        print(f'      {line}')
    if len(diff) > DIFF_LINES:
        print(f'      …（還有 {len(diff) - DIFF_LINES} 行；重新產生之後用 git diff 看完整差異）')
    return False


def verify(cache: Path) -> int:
    extracted, fresh = build(cache)

    # 擷取快照與 manifest 都必須正好是重跑的輸出；重跑不出來的內容，就是沒被記錄的手工修改。
    bad = 0
    files_differ = 0
    for path, obj in ((SNAPSHOT, extracted), (MANIFEST, fresh)):
        if not _same_as_committed(path, render(obj)):
            files_differ += 1
    bad += files_differ

    # 這才是真正的重現性檢查：repo 裡的文字 == 來源（套用已列明的修正之後）
    drift = [e['item_id'] for e in fresh['entries'] if not e['matches_source']]
    if drift:
        print(f'\n  ✗ 有 {len(drift)} 題的 repo 內容與來源不一致'
              f'（dataset_text ≠ canonical_source_text）：')
        for iid in drift[:10]:
            print(f'      {iid}')
        bad += len(drift)

    conflicts = fresh['_meta']['answer_conflicts']
    if conflicts:
        print(f'\n  ✗ 有 {len(conflicts)} 題丟棄題的答案卡與它對應的題目不一致：')
        for d in fresh['dispositions']:
            if d['status'].endswith('_ANSWER_CONFLICT'):
                print(f"      {d['source_id']}#{d['source_question_number']}：{d['evidence']}")
        bad += len(conflicts)

    ov = [e for e in fresh['entries'] if e['answer_override']]
    if ov:
        print(f'\n  ℹ 有 {len(ov)} 題刻意偏離來源的 answer key（已列明一手依據）：')
        for e in ov:
            print(f'      {e["item_id"]}: PDF={e["answer_key"]} -> '
                  f'{e["answer_override"]["corrected_answer"]}')
            print(f'         {e["answer_override"]["reason"]}')

    print()
    if bad:
        reasons = [label for label, n in (('committed 的檔案與重跑結果不同', files_differ),
                                          ('題庫的文字與來源不一致', len(drift)),
                                          ('答案衝突', len(conflicts))) if n]
        print(f'✗ {bad} 項不符 —— {"、".join(reasons)}')
        return 1
    print(f'{len(fresh["entries"])} 題全部與來源 PDF 相符（還原 {fresh["_meta"]["restored_count"]} 題、'
          f'官方公告試題 {fresh["_meta"]["imported_count"]} 題）')
    print('   （擷取快照與 manifest 都與重跑結果逐字相同；repo 文字 == 來源 + 已列明的修正）')
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description='從來源 PDF 重建還原題的憑證（restoration manifest）。')
    action = ap.add_mutually_exclusive_group()
    action.add_argument('--emit', action='store_true', help='從來源 PDF 重跑，改寫擷取快照與 manifest')
    action.add_argument('--verify', action='store_true', help='從來源 PDF 重跑，逐字比對擷取快照與 manifest（不寫檔）')
    action.add_argument('--reassemble', action='store_true',
                        help='不讀 PDF：用 committed 的擷取快照、題庫與修正表重組 manifest（改了題庫或修正表、'
                             '牽動 manifest 時用；動 manifest 要先問專案所有者）')
    ap.add_argument('--cache', help='來源 PDF 的快取目錄（預設 ~/.cache/ipas-src-pdf）：沒有才下載，'
                                    'sha256 與 SOURCES 不符就中止。只對 --emit／--verify 有意義')
    a = ap.parse_args(argv)
    if a.cache and not (a.emit or a.verify):
        ap.error('--cache 只對 --emit／--verify 有意義')

    # 寫檔一律用 LF：committed 的檔案必須正好是 render() 的輸出（Windows 的 autocrlf 在 checkout 時才轉 CRLF）
    if a.reassemble:
        snapshot = load_snapshot()
        check_snapshot(snapshot)
        man = assemble(snapshot, load_dataset())
        refuse_to_write(man)
        MANIFEST.write_text(render(man), encoding='utf-8', newline='\n')
        print(f'已寫入 {_rel(MANIFEST)}（由 {_rel(SNAPSHOT)} 重組，沒有讀 PDF）')
        return 0

    if not (a.emit or a.verify):
        ap.print_help()
        return 1
    cache = Path(a.cache or Path.home() / '.cache' / 'ipas-src-pdf')
    cache.mkdir(parents=True, exist_ok=True)

    if a.emit:
        # 快照只記「PDF 上印的是什麼」，與題庫無關：擷取成功就寫。manifest 要等題庫也對得上才寫 ——
        # 來源改版時，這個中間狀態（新快照、舊 manifest）正是用 git diff 看清改了什麼、再照著改題庫的起點，
        # CI 會一直紅到 manifest 重組為止。
        extracted = extract_sources(cache)
        check_counts_registered()  # 新增來源忘了登記題數：說清楚，不是在下面丟 KeyError
        for src_id in SOURCES:  # 擷取器壞了（掉題、重號）就什麼都不寫：那份快照本身就是錯的
            check_question_numbers(src_id, extracted[src_id]['questions'])
        SNAPSHOT.write_text(render(extracted), encoding='utf-8', newline='\n')
        try:
            man = assemble(extracted, load_dataset())
            refuse_to_write(man)
        except SystemExit:
            print(f'（已寫入新的擷取快照 {_rel(SNAPSHOT)}，manifest 沒有寫：用 git diff 看快照變了什麼，'
                  '處理下面的問題之後跑 --reassemble。）', file=sys.stderr)
            raise
        MANIFEST.write_text(render(man), encoding='utf-8', newline='\n')
        print(f'\n已寫入 {_rel(SNAPSHOT)} 與 {_rel(MANIFEST)}（還原 {man["_meta"]["restored_count"]} 題、'
              f'匯入 {man["_meta"]["imported_count"]} 題）')
        return 0
    return verify(cache)


if __name__ == '__main__':
    sys.exit(main())
