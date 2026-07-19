# 第四輪：**複驗題庫既有的引用**。
#
# 前三輪問的是「這題有沒有來源？」
# 這一輪問的是「**題庫已經附的那個 URL，到底有沒有說這件事？**」
#
# 為什麼分開做：**連結是活的，不代表指對地方。**
# 這個題庫抓到過 19 題碳費的題目引到溫室氣體管理辦法 —— 兩個 URL 都回 HTTP 200，
# 連結健康檢查完全看不出來。
#
# **這支工具最危險的地方，是 agent 的 WRONG_SOURCE 判定。**
#
# 「這個 URL 不支持這題」是一個**否定命題**。而這個 repo 反覆學到的教訓是：
# **「我抓不到」≠「它不存在」。**
# agent 說找不到，可能是它沒搜到、可能是頁面 JS 渲染、可能是它根本被擋。
#
# 所以本工具**不會**因為一句 WRONG_SOURCE 就把引用拿掉。它只做兩件事：
#   1. 驗證 agent 提出的**正面證據**（correct_source_url 上的 correct_quote 是否逐字存在）——
#      那是可以機械驗證的。
#   2. 把所有 WRONG_SOURCE / CONTRADICTED **列出來給人逐題複驗**，不自動改資料。
#
# 用法：python tools/verify_citations.py [r4]

import collections
import glob
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_text import fetch, is_primary, load_primary, quote_status  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

S = (r'C:\Users\thc1006\AppData\Local\Temp\claude'
     r'\D--dev-06-june-exam\2a55d42b-3609-4580-be5d-18f505590582\scratchpad')
ROUND = sys.argv[1] if len(sys.argv) > 1 else 'r4'
PRIMARY = load_primary()

results = []
for f in sorted(glob.glob(f'{S}/{ROUND}/res*.json')):
    try:
        results += json.load(open(f, encoding='utf-8'))
    except Exception as e:
        print(f'!! 讀不到 {f}: {e}')

print(f'agents 交回 {len(results)} 題\n')
print('=' * 96)
print('引用複驗：把題庫「已經引的那個 URL」抓回來，檢查它到底有沒有說這件事')
print('=' * 96)

cache = {}
tally = collections.Counter()
rows = []
needs_human = []


def page(url):
    if url not in cache:
        cache[url] = fetch(url)
    return cache[url]


for r in results:
    qid = r.get('id')
    v = (r.get('verdict') or '').upper()
    cited = (r.get('cited_url') or '').strip()
    quote = (r.get('quote') or '').strip()

    # ---- SUPPORTED：引文必須逐字在**被引用的那個 URL** 上
    if v == 'SUPPORTED':
        if not cited or not quote:
            tally['宣稱 SUPPORTED 卻沒交 URL 或引文'] += 1
            rows.append((qid, v, '', '沒有 cited_url 或 quote'))
            continue
        txt, via = page(cited)
        if not txt:
            tally['抓不到頁面（無法判斷，≠ 捏造）'] += 1
            rows.append((qid, v, '', f'{cited[:44]}… 抓不到 —— **無法判斷**'))
            continue
        st = quote_status(quote, txt)
        if st == 'verbatim':
            tag = '引用正確（引文逐字在該頁上）'
            mark = ''
        elif st == 'reordered':
            tag = '引用正確，但引文被重新排序（片段皆真）'
            mark = ''
        else:
            tag = '引文在該頁上查無此句（捏造）'
            mark = ''
        tally[tag] += 1
        rows.append((qid, v, mark, f'{cited[:52]}'))
        continue

    # ---- WRONG_SOURCE / CONTRADICTED：**不自動改資料**，只驗證正面證據
    if v in ('WRONG_SOURCE', 'CONTRADICTED'):
        cu = (r.get('correct_source_url') or '').strip()
        cq = (r.get('correct_quote') or '').strip()
        if not cu or not cq:
            tally[f'{v}（未提出替代證據，需人工判斷）'] += 1
            rows.append((qid, v, '', '沒有提出正確來源 —— 只是「我找不到」，不足以動資料'))
            needs_human.append((qid, v, cited, '（無替代來源）', ''))
            continue
        if not is_primary(cu, PRIMARY):
            tally[f'{v} 的替代來源不是一手來源'] += 1
            rows.append((qid, v, '', f'替代來源 {cu[:40]} 不在一手清單裡'))
            continue
        txt, via = page(cu)
        if not txt:
            tally[f'{v} 的替代來源抓不到'] += 1
            rows.append((qid, v, '', f'{cu[:44]}… 抓不到'))
            needs_human.append((qid, v, cited, cu, cq))
            continue
        st = quote_status(cq, txt)
        if st == 'absent':
            tally[f'{v} 的替代引文查無此句（捏造）'] += 1
            rows.append((qid, v, '', f'替代引文在 {cu[:36]} 上查無此句'))
            continue
        tally[f'{v}（替代證據已驗證，等我逐題複驗）'] += 1
        rows.append((qid, v, '', f'替代來源 {cu[:44]} 引文逐字存在'))
        needs_human.append((qid, v, cited, cu, cq))
        continue

    # ---- NO_QUOTE / DEAD：本身就是誠實的回報，不需要證據
    if v in ('NO_QUOTE', 'DEAD'):
        tally[f'— {v}'] += 1
        rows.append((qid, v, '—', '（誠實回報 —— 這是正確的行為）'))
        continue

    tally[f'?? 未知 verdict: {v}'] += 1
    rows.append((qid, v, '??', '未知的 verdict'))

for qid, v, mark, note in rows:
    print(f'  {mark} {str(qid):22} {str(v):14} {note}')

print()
print('=' * 96)
print('統計')
print('=' * 96)
for k, n in tally.most_common():
    print(f'  {k:<48} {n}')

print()
print('=' * 96)
print(f'需要我逐題人工複驗的（{len(needs_human)} 題）—— **不會自動改資料**')
print('=' * 96)
for qid, v, cited, cu, cq in needs_human:
    print(f'  [{v}] {qid}')
    print(f'      題庫現在引的：{cited[:76]}')
    print(f'      agent 說應該是：{cu[:76]}')
    if cq:
        print(f'      替代引文：{cq[:76]}')
