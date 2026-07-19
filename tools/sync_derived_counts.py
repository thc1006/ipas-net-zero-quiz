# 把「從資料算得出來的數字」重新算一次，同步到 meta / README / CONTENT-CURRENCY。
#
# 為什麼要有這支：這一輪我手動改這些數字改了六次，每次都是「跑測試 → 紅 → 改一個數字 → 再跑」。
# 那是一個遲早會改錯的流程 —— 而且改錯的方式很惡毒：
# **只要我把 README 改成跟錯的資料一致，gate 就會變綠。**
#
# 這支**不是**用來讓 gate 閉嘴的。
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

    **必須跟 docs-counts.test.ts 的 urlsOf() 一模一樣。**
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
    # 逐字 evidence[].url 也算「有來源」—— 否則會出現「有逐字引文卻無來源」的不可能狀態
    for e in (md(q).get('evidence') or []):
        if isinstance(e, dict) and isinstance(e.get('url'), str) and re.match(r'^https?://', e['url']):
            out.append(e['url'])
    return out


def pool_srcs(q):
    out = [u for u in (q.get('sources') or []) if isinstance(u, str)]
    for e in ((q.get('provenance') or {}).get('evidence') or []):
        if isinstance(e, dict) and isinstance(e.get('url'), str) and re.match(r'^https?://', e['url']):
            out.append(e['url'])
    return out


def has_evidence(q, kind):
    # ① 級「有一手來源的逐字引文」：evidence 至少一筆，其 url 屬一手來源、且有非空 quote。
    #
    # **不能只看 `evidence != null`。** 那樣的話，只要塞一筆
    #    `{"url": 某個維基頁, "quote": "隨便一句"}` 就會讓「機械驗證」題數 +1 ——
    #    這正是被抓到的 false positive（gist[137] 引文不在它指的頁上、6 題 evidence 是
    #    維基／新聞／標準轉載預覽）。一手逐字必須由**事實發布者**的頁面承載。
    #    這段邏輯必須跟 docs-counts.test.ts 的 primaryQuote() 一模一樣。
    evs = md(q).get('evidence') if kind == 'main' else (q.get('provenance') or {}).get('evidence')
    return any(
        isinstance(e, dict) and is_primary(e.get('url', '')) and (e.get('quote') or '').strip()
        for e in (evs or [])
    )


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


# ── 引用複驗（citation_audit）—— **跨兩個題庫算**，與 docs-counts.test.ts 一致 ──
#
# 這一段原本**完全不在這支工具裡**。於是資料裡的 citation_audit 標記一直在變，
# 而 meta / README 的數字凍在第四輪 —— `--check` 照樣說「全部一致」，CI 卻是紅的。
# **又一次：一個只檢查一半的同步工具，它的綠燈是一句假的保證。**
def verdict(q):
    a = (md(q).get('citation_audit') or {}).get('verdict')
    b = ((q.get('provenance') or {}).get('citation_audit') or {}).get('verdict')
    return a or b


BOTH = ALL + POOL


def _nd(q):
    return q.get('metadata') or q.get('provenance') or {}


# 官方答案卡蓋章數（tools/answer_key_crosscheck.py 寫進去的）
N['akc_confirmed'] = sum(1 for q in BOTH if _nd(q).get('answer_key_check'))

N['ca_supported'] = sum(1 for q in BOTH if verdict(q) == 'supported')
N['ca_replaced'] = sum(1 for q in BOTH if verdict(q) == 'citation_replaced')
N['ca_disputed'] = sum(1 for q in BOTH if verdict(q) == 'citation_disputed')
N['ca_no_quote'] = sum(1 for q in BOTH if verdict(q) == 'no_quote')
N['ca_dead'] = sum(1 for q in BOTH if verdict(q) == 'dead')
# gate 要求的恆等式：引錯地方的 = 已換掉的 + 仍存疑的
N['ca_wrong'] = N['ca_replaced'] + N['ca_disputed']

cr = ds['meta'].get('content_review', {})
last = cr.get('last_review_date')

# **必須是 `>=`，不可以是 `==`。**
#
# 這條原本寫 `valid_as_of == last_review_date`，於是它有一個很醜的失敗模式：
# **一題查得越新，分數越低。**
#
# gist[520] 在 07-13（last_review_date）複查過。07-14 我又查了一次，
# 而且**抓出它的答案是錯的**（B→C），於是 valid_as_of 更新成 07-14。
# 結果 `== last` 不成立 → 它從「本輪已重查」掉出去，還被歸進「積欠未查」那一堆。
#
# 「我今天重查並修好了它」被記成「我沒查它」。日期比較要用 `>=`。
# （ISO 日期字串的字典序 == 時序，可以直接比。）
N['reverified'] = sum(1 for q in ALL if (md(q).get('valid_as_of') or '') >= (last or ''))
N['carried_over'] = sum(
    1
    for q in ALL
    if 'time_sensitive' in (q.get('quality_flags') or [])
    and (md(q).get('valid_as_of') or '') < (last or '')
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
set_meta('citation_audit.supported', N['ca_supported'])
set_meta('citation_audit.replaced', N['ca_replaced'])
set_meta('citation_audit.disputed', N['ca_disputed'])
set_meta('citation_audit.no_quote', N['ca_no_quote'])
set_meta('citation_audit.dead', N['ca_dead'])
set_meta('citation_audit.wrong_source', N['ca_wrong'])
set_meta('answer_key_check.confirmed', N['akc_confirmed'])


# （這裡本來還有一個沒人呼叫的 `patch()` —— 而它裡面正是我剛修掉的那個
#   「錨點對不上就 print 一行然後 return」的行為。死碼帶著已知的 bug，
#   等著下一個人把它接回去用。刪掉。）

docs = {README: open(README, encoding='utf-8').read(), CURRENCY: open(CURRENCY, encoding='utf-8').read()}

# **這份清單漏一條，就等於在說謊。**
#
# 第一版漏掉了 README 與 CONTENT-CURRENCY 的「本輪只實查 N / 773 題」——
# 於是 `--check` 說「所有衍生數字都已一致」，但 CI 是紅的。
# **一個只檢查一半的同步工具，比沒有工具更糟：它的綠燈是一句假的保證。**
#
# 這裡涵蓋的是**會隨資料改動而變**的數字。
# 不涵蓋（因為它們不隨我的修改而變，且各自有 gate 守著）：
#   - 考科一/考科二題數、練習池 54+100 的組成
#   - restoration-manifest 的 159 題重建
#   - llms.txt 的 external_mock / ai_generated 題數
#
# **錨點要綁在結構上，不要綁在散文上。**
#   「主題庫一手來源」那條原本錨在 `連結（季排程每季檢查是否還通） | (\d+) / 773`，
#   後來有人在那一格加了一句「連結還通不代表指對地方」—— 正則就對不上了。
#   **那條規則從此死掉**，而 README 的 740 凍在原地、資料早就走到 746。
#   現在改成錨在列首的「② 有一手來源 URL」，散文怎麼改都不影響。
RULES = [
    (README, r'本輪只實查\s*\*\*(\d+)\s*/', N['reverified'], 'README 本輪實查題數'),
    (CURRENCY, r'本輪只實查了\s*\*\*(\d+)\s*/', N['reverified'], 'CURRENCY 本輪實查題數'),
    (README, r'\*\*(\d+) / 773\*\*', N['main_quote'], '主題庫逐字引文'),
    (README, r'② 有一手來源 URL[^|]*\|[^|]*\| (\d+) / 773', N['main_primary'], '主題庫一手來源'),
    (README, r'\*\*無從查證\*\* \| (\d+) / 773', N['main_nosource'], '主題庫無來源'),
    (README, r'\*\*(\d+) / 154\*\*', N['pool_quote'], '練習池逐字引文'),
    (README, rf'\| (\d+) / {N["pool_total"]} \|\n', N['pool_primary'], '練習池一手來源'),
    (README, r'(\d+) 題答案曾被更正', N['corrections'], 'README 更正題數'),
    (README, r'其中 (\d+) 題附一手來源 URL', N['corr_with_url'], 'README 更正題有 URL'),
    (README, r'另外 (\d+) 題的依據是標準條文', N['corr_no_url'], 'README 更正題無 URL'),
    (README, r'題庫中有 \*\*(\d+) 題\*\*的答案會隨法規變動', N['time_sensitive'], 'README time_sensitive'),
    (CURRENCY, r'\*\*(\d+) 題\*\*標記 `time_sensitive`', N['time_sensitive'], 'CURRENCY time_sensitive'),
    # 引用複驗那張表 —— 這四個數字過去**完全沒人同步**
    (README, r'\| 引用正確[^|]*\| \*\*(\d+)\*\*', N['ca_supported'], 'README 引用正確'),
    (README, r'\| \*\*引錯地方[^|]*\| \*\*(\d+)\*\*', N['ca_wrong'], 'README 引錯地方'),
    (README, r'\| 主題相關[^|]*\| (\d+)', N['ca_no_quote'], 'README 主題相關無引文'),
    (README, r'\| 連結已死[^|]*\| (\d+)', N['ca_dead'], 'README 連結已死'),
    # 這兩條**第一版漏掉了**（第四次犯同一個錯）。docs-counts.test.ts 有守它們，
    #    但這支沒有 —— 於是 README 的「已換成…」凍在 27，而資料走到 29，CI 紅。
    #    **gate 守幾個數字，這裡就要涵蓋幾個。**
    (README, r'\*\*(\d+) 題\*\*已換成經機械驗證的一手來源', N['ca_replaced'], 'README 已換來源'),
    (README, r'\*\*(\d+) 題\*\*[^\n]*`citation_audit\.verdict = citation_disputed`',
     N['ca_disputed'], 'README 仍存疑'),
    (README, r'\*\*(\d+) 題的答案已與官方答案卡逐題對過', N['akc_confirmed'], 'README 答案卡確認'),
]

dead_rules = []
for path, pat, val, label in RULES:
    text = docs[path]
    m = re.search(pat, text)
    if not m:
        # **這裡以前是 `continue`。** 對不上錨點的規則就這樣靜靜跳過，
        # 然後這支工具照樣印出「所有衍生數字都已一致」、exit 0 —— 而 CI 是紅的。
        #
        # **一條找不到錨點的同步規則 = 一條死掉的規則。**
        # 而一個「規則死了還發綠燈」的工具，比沒有工具更糟：
        # 它讓我以為數字有人在顧。**對不上就硬失敗。**
        dead_rules.append(f'  {path} 找不到錨點：{label}\n       pattern: {pat}')
        continue
    if m.group(1) == str(val):
        continue
    changed.append(f'  {path} [{label}]: {m.group(1)} -> {val}')
    s, e = m.span(1)
    docs[path] = text[:s] + str(val) + text[e:]

if dead_rules:
    print('=' * 70)
    print('有同步規則對不上錨點 —— 它守的那個數字**現在沒人顧**：')
    print('\n'.join(dead_rules))
    print('\n**不要改規則去遷就文件的措辭，也不要刪掉規則。**')
    print('把錨點綁回結構（列首的標籤），或確認那個數字是不是被誰刪掉了。')
    sys.exit(1)

print('=' * 70)
for k, v in N.items():
    print(f'  {k:16} = {v}')
print('=' * 70)

if not changed:
    print('  所有衍生數字都已一致')
    sys.exit(0)

print('  需要同步：')
for c in changed:
    print(c)

if CHECK:
    print('\n  --check 模式：有不一致，未寫檔')
    sys.exit(1)

json.dump(ds, open(DS_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
for path, text in docs.items():
    open(path, 'w', encoding='utf-8').write(text)
print('\n  已寫回')
