# 產生 evidence-manifest.json —— committed 題庫裡每一筆 evidence 的可重現盤點。
#
# 為什麼要有這支：
#   README 的「① 逐字引文」等級，過去是用「evidence 欄位存不存在」算的，
#   於是只要塞一筆二手 evidence（維基／新聞）就能讓「已驗證」題數 +1 —— 一個純由
#   欄位存在與否決定的信任標章。這份 manifest 把判定攤開成**可逐筆檢視、可離線重跑**的清單：
#   每一筆 evidence 的 url／網域／一手或二手／有沒有引文／算不算入 tier ①。
#
# 注意：它記的是**可離線判定**的事實（分級＋有無引文）。它**不**宣稱「已重抓網頁逐字比對」——
#    逐字比對是在**擷取當下**由 tools/verify_agent_quotes.py 對代理提交做的（擋掉捏造與非一手
#    引文），並**沒有**對 committed 資料持續重跑。這份檔案誠實地只記它擔保得起的東西。
#
# docs-counts.test.ts 會離線重算本檔並逐項比對 —— 確保它可重現、不漂，且 tier ① 與 README 一致。
#
# 用法：python tools/build_evidence_manifest.py

import json
import re
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

src = open('quiz-app/src/utils/source-authority.ts', encoding='utf-8').read()


def hosts(tag):
    # 一律從 source-authority.ts 讀，別手抄 —— 手抄過一次就漏了一個網域。
    block = src.split(f'export const {tag}')[1].split('];')[0]
    return tuple(re.findall(r"host:\s*'([^']+)'", block))


PRIMARY = hosts('PRIMARY')
SECONDARY = hosts('SECONDARY')


def host_of(u):
    return re.sub(r'^https?://', '', u or '').split('/')[0].lower()


def authority(u):
    h = host_of(u)
    if any(h == p or h.endswith('.' + p) for p in PRIMARY):
        return 'primary'
    if any(h == s or h.endswith('.' + s) for s in SECONDARY):
        return 'secondary'
    return 'unknown'


ds = json.load(open('quiz-app/src/data/integrated_dataset.json', encoding='utf-8'))
pool = json.load(open('quiz-app/src/data/practice_pool.json', encoding='utf-8'))


def qid(q):
    if 'index' in q:
        return f"gist[{q['index']}]"
    return q.get('item_id') or q.get('id') or '?'


entries = []


def collect(items, bank, getev):
    for q in items:
        for e in (getev(q) or []):
            if not isinstance(e, dict):
                continue
            u = e.get('url')
            if not isinstance(u, str) or not re.match(r'^https?://', u):
                continue
            a = authority(u)
            has_q = bool((e.get('quote') or '').strip())
            entries.append({
                'qid': qid(q),
                'bank': bank,
                'url': u,
                'host': host_of(u),
                'authority': a,
                'has_quote': has_q,
                'tier1': a == 'primary' and has_q,
            })


collect(ds['gist_items'] + ds['our_unique_items'], 'main',
        lambda q: (q.get('metadata') or {}).get('evidence'))
collect(pool['items'], 'pool',
        lambda q: (q.get('provenance') or {}).get('evidence'))
# 穩定排序（沒有時間戳、沒有隨機）—— 同樣的資料永遠產生同一份檔案。
entries.sort(key=lambda e: (e['bank'], e['qid'], e['url']))


def tier1_questions(items, getev):
    return sum(
        1 for q in items
        if any(
            isinstance(e, dict) and authority(e.get('url', '')) == 'primary' and (e.get('quote') or '').strip()
            for e in (getev(q) or [])
        )
    )


main_t1 = tier1_questions(ds['gist_items'] + ds['our_unique_items'],
                          lambda q: (q.get('metadata') or {}).get('evidence'))
pool_t1 = tier1_questions(pool['items'],
                          lambda q: (q.get('provenance') or {}).get('evidence'))

manifest = {
    '_meta': {
        'generated_by': 'tools/build_evidence_manifest.py',
        'what_this_is': 'committed 題庫每一筆 evidence 的可重現盤點：分級＋有無引文＋是否計入 tier ①',
        'what_this_is_NOT': (
            '這不是「已重抓網頁逐字比對」的證明。逐字比對只在擷取當下由 verify_agent_quotes.py '
            '對代理提交做過，未對 committed 資料持續重跑。'
        ),
        'tier1_rule': 'authority == primary 且 has_quote —— 二手 evidence（維基／新聞／標準轉載預覽）不計入',
    },
    'summary': {
        'main_tier1_questions': main_t1,
        'pool_tier1_questions': pool_t1,
        'total_evidence_urls': len(entries),
        'primary_evidence_urls': sum(1 for e in entries if e['authority'] == 'primary'),
        'secondary_evidence_urls': sum(1 for e in entries if e['authority'] == 'secondary'),
        'unknown_evidence_urls': sum(1 for e in entries if e['authority'] == 'unknown'),
    },
    'entries': entries,
}

out = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
open('evidence-manifest.json', 'w', encoding='utf-8').write(out)
s = manifest['summary']
print(
    f"evidence-manifest.json: main_tier1={s['main_tier1_questions']} pool_tier1={s['pool_tier1_questions']} "
    f"total_urls={s['total_evidence_urls']} primary={s['primary_evidence_urls']} "
    f"secondary={s['secondary_evidence_urls']} unknown={s['unknown_evidence_urls']}"
)
