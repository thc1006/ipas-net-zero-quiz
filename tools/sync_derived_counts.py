# 把「從資料算得出來的數字」重新算一次，同步到 meta / README / CONTENT-CURRENCY。
#
# 為什麼要有這支：這一輪我手動改這些數字改了六次，每次都是「跑測試 → 紅 → 改一個數字 → 再跑」。
# 那是一個遲早會改錯的流程 —— 而且改錯的方式很惡毒：
# **只要我把 README 改成跟錯的資料一致，gate 就會變綠。**
#
# ⚠️ 這支**不是**用來讓 gate 閉嘴的。
#   gate 存在的意義是「文件不能對資料說謊」。這支只是把「算術」自動化，
#   **它不會、也不該驗證資料本身是不是對的** —— 那是其他 gate 的事。
#   如果資料錯了，這支會忠實地把錯的數字寫進 README，然後 gate 依然是綠的。
#   所以：**先確認資料改對了，再跑這支。**
#
# 用法：
#   python tools/sync_derived_counts.py --check   # 只印出不一致，不寫檔（CI 用）
#   python tools/sync_derived_counts.py           # 實際寫回

import json
import re
import sys
import io
import unicodedata

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

CHECK = '--check' in sys.argv

DS_PATH = 'quiz-app/src/data/integrated_dataset.json'
POOL_PATH = 'quiz-app/src/data/practice_pool.json'
README = 'README.md'
CURRENCY = 'CONTENT-CURRENCY.md'

# PRIMARY 一律從 source-authority.ts 讀 —— 手抄過一次，漏了 re100.org.tw。
src = open('quiz-app/src/utils/source-authority.ts', encoding='utf-8').read()
block = src.split('export const PRIMARY')[1].split('];')[0]
PRIMARY = tuple(re.findall(r"host:\s*'([^']+)'", block))


def host_of(url):
    return re.sub(r'^https?://', '', url or '').split('/')[0].lower()


def is_primary(url):
    h = host_of(url)
    return any(h == p or h.endswith('.' + p) for p in PRIMARY)


ds = json.load(open(DS_PATH, encoding='utf-8'))
pool = json.load(open(POOL_PATH, encoding='utf-8'))
ALL = ds['gist_items'] + ds['our_unique_items']
POOL = pool['items']


def md(q):
    return q.get('metadata') or {}


def main_srcs(q):
    """來源 URL 的清單。

    ⚠️ **必須跟 docs-counts.test.ts 的 urlsOf() 一模一樣。**
    第一版我只讀 metadata.sources，結果算出「無來源 275」而 gate 說 274 ——
    因為 gate 還會讀**頂層的 source.url**。

    一支跟 gate 算出不同數字的同步工具，比沒有工具更糟：
    它會讓 gate 永遠紅，然後誘使我去「修 gate」來遷就它。
    """
    out = [
        u for u in (md(q).get('sources') or [])
        if isinstance(u, str) and re.match(r'^https?://', u)
    ]
    src = q.get('source')
    if isinstance(src, dict) and isinstance(src.get('url'), str):
        out.append(src['url'])
    return out


def pool_srcs(q):
    return q.get('sources') or []


def has_evidence(q, kind):
    if kind == 'main':
        return bool(md(q).get('evidence'))
    return bool((q.get('provenance') or {}).get('evidence'))


N = {
    'total': len(ALL),
    'with_answer': sum(1 for q in ALL if q.get('answer')),
    'time_sensitive': sum(1 for q in ALL if 'time_sensitive' in (q.get('quality_flags') or [])),
    'corrections': sum(
        1 for q in ALL if md(q).get('prior_answer') and md(q)['prior_answer'] != q.get('answer')
    ),
    'main_quote': sum(1 for q in ALL if has_evidence(q, 'main')),
    'main_primary': sum(1 for q in ALL if any(is_primary(u) for u in main_srcs(q))),
    'main_nosource': sum(1 for q in ALL if not main_srcs(q)),
    'pool_quote': sum(1 for q in POOL if has_evidence(q, 'pool')),
    'pool_primary': sum(1 for q in POOL if any(is_primary(u) for u in pool_srcs(q))),
    'pool_total': len(POOL),
}
corrected = [q for q in ALL if md(q).get('prior_answer') and md(q)['prior_answer'] != q.get('answer')]
N['corr_with_url'] = sum(1 for q in corrected if main_srcs(q))
N['corr_no_url'] = len(corrected) - N['corr_with_url']

cr = ds['meta'].get('content_review', {})
last = cr.get('last_review_date')
N['reverified'] = sum(1 for q in ALL if md(q).get('valid_as_of') == last)
N['carried_over'] = sum(
    1
    for q in ALL
    if 'time_sensitive' in (q.get('quality_flags') or []) and md(q).get('valid_as_of') != last
)

changed = []


def set_meta(path, val):
    node = ds['meta']
    *parents, leaf = path.split('.')
    for p in parents:
        node = node[p]
    if node.get(leaf) != val:
        changed.append(f'  meta.{path}: {node.get(leaf)} -> {val}')
        node[leaf] = val


set_meta('total_questions', N['total'])
set_meta('with_answer', N['with_answer'])
set_meta('corrections_applied', N['corrections'])
set_meta('content_review.time_sensitive_count', N['time_sensitive'])
set_meta('content_review.reverified_count', N['reverified'])
set_meta('content_review.carried_over_count', N['carried_over'])


def patch(path, pattern, val, label):
    text = open(path, encoding='utf-8').read()
    m = re.search(pattern, text)
    if not m:
        print(f'  !! {path} 找不到 pattern：{label}')
        return text, False
    if m.group(1) == str(val):
        return text, False
    changed.append(f'  {path} [{label}]: {m.group(1)} -> {val}')
    s, e = m.span(1)
    return text[:s] + str(val) + text[e:], True


docs = {README: open(README, encoding='utf-8').read(), CURRENCY: open(CURRENCY, encoding='utf-8').read()}

RULES = [
    (README, r'\*\*(\d+) / 773\*\*', N['main_quote'], '主題庫逐字引文'),
    (README, r'連結（季排程每季檢查是否還通） \| (\d+) / 773', N['main_primary'], '主題庫一手來源'),
    (README, r'\*\*無從查證\*\* \| (\d+) / 773', N['main_nosource'], '主題庫無來源'),
    (README, r'\*\*(\d+) / 154\*\*', N['pool_quote'], '練習池逐字引文'),
    (README, rf'\| (\d+) / {N["pool_total"]} \|\n', N['pool_primary'], '練習池一手來源'),
    (README, r'(\d+) 題答案曾被更正', N['corrections'], 'README 更正題數'),
    (README, r'其中 (\d+) 題附一手來源 URL', N['corr_with_url'], 'README 更正題有 URL'),
    (README, r'另外 (\d+) 題的依據是標準條文', N['corr_no_url'], 'README 更正題無 URL'),
    (README, r'題庫中有 \*\*(\d+) 題\*\*的答案會隨法規變動', N['time_sensitive'], 'README time_sensitive'),
    (CURRENCY, r'\*\*(\d+) 題\*\*標記 `time_sensitive`', N['time_sensitive'], 'CURRENCY time_sensitive'),
]

for path, pat, val, label in RULES:
    text = docs[path]
    m = re.search(pat, text)
    if not m:
        print(f'  !! {path} 找不到 pattern：{label}')
        continue
    if m.group(1) == str(val):
        continue
    changed.append(f'  {path} [{label}]: {m.group(1)} -> {val}')
    s, e = m.span(1)
    docs[path] = text[:s] + str(val) + text[e:]

print('=' * 70)
for k, v in N.items():
    print(f'  {k:16} = {v}')
print('=' * 70)

if not changed:
    print('  ✅ 所有衍生數字都已一致')
    sys.exit(0)

print('  需要同步：')
for c in changed:
    print(c)

if CHECK:
    print('\n  ❌ --check 模式：有不一致，未寫檔')
    sys.exit(1)

json.dump(ds, open(DS_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
for path, text in docs.items():
    open(path, 'w', encoding='utf-8').write(text)
print('\n  ✅ 已寫回')
