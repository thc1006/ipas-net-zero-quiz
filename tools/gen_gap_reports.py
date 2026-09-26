# 重新生成 VERIFICATION-GAPS.md 與 UNVERIFIABLE.md。
#
# 這兩份文件是「我們還不知道什麼」的清單。手寫會漂 —— 資料一改，清單就不準，
# 而一份不準的「缺口清單」比沒有清單更糟：它會讓人以為缺口已經被盤點過了。
#
# 所以：**從資料生成，不要手寫。**

import json
import re
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

src = open('quiz-app/src/utils/source-authority.ts', encoding='utf-8').read()
block = src.split('export const PRIMARY')[1].split('];')[0]
PRIMARY = tuple(re.findall(r"host:\s*'([^']+)'", block))

ds = json.load(open('quiz-app/src/data/integrated_dataset.json', encoding='utf-8'))
pool = json.load(open('quiz-app/src/data/practice_pool.json', encoding='utf-8'))

ITEMS = [('主題庫', q) for q in ds['gist_items'] + ds['our_unique_items']]
ITEMS += [('練習池', q) for q in pool['items']]


def who(q):
    if q.get('item_id'):
        return q['item_id']
    if 'index' in q:
        return f"gist[{q['index']}]"
    return q.get('id', '?')


def stem(q):
    return (q.get('stem') or q.get('question') or '').replace('|', '｜').strip()


def srcs(bank, q):
    # 統一的 URL 蒐集：metadata.sources / source.url / 逐字 evidence[].url 都算「有來源」。
    # 少了 evidence[].url，一題就可能同時被算成「有逐字引文」又「完全沒有來源」的不可能狀態。
    if bank == '主題庫':
        out = [u for u in ((q.get('metadata') or {}).get('sources') or []) if isinstance(u, str)]
        s = q.get('source')
        if isinstance(s, dict) and isinstance(s.get('url'), str):
            out.append(s['url'])
        ev = (q.get('metadata') or {}).get('evidence') or []
    else:
        out = list(q.get('sources') or [])
        ev = (q.get('provenance') or {}).get('evidence') or []
    for e in ev:
        if isinstance(e, dict) and isinstance(e.get('url'), str):
            out.append(e['url'])
    return out


def evidence(bank, q):
    if bank == '主題庫':
        return (q.get('metadata') or {}).get('evidence')
    return (q.get('provenance') or {}).get('evidence')


# 第三輪被機械比對判定「引文查無此句」的題 —— 代理交了引文，但那句話不在它說的頁面上。
# 這些題因此**沒有拿到任何來源**，不是因為找不到，而是因為交上來的東西被擋下了。
FABRICATED = {'gist[5]', 'gist[8]', 'gist[9]', 'gist[11]', 'gist[28]', 'gist[169]'}

def is_primary(url):
    m = re.match(r'https?://([^/]+)', url)
    h = m.group(1).lower() if m else ''
    return any(h == p or h.endswith('.' + p) for p in PRIMARY)


def has_primary(b, q):
    return any(is_primary(u) for u in srcs(b, q))


def primary_evidence(b, q):
    # 「有一手逐字引文」＝ evidence 至少一筆，其 url 是一手來源、且有非空 quote。
    # 光有 evidence 不算 —— evidence 可能來自維基／新聞／標準轉載預覽（二手）。
    return any(
        isinstance(e, dict) and is_primary(e.get('url', '')) and (e.get('quote') or '').strip()
        for e in (evidence(b, q) or [])
    )


# 「有 URL」不等於「有一手來源」：一手來源必須由事實發布者／法規/標準制定者發布。
# 非一手 URL（部落格、新聞、二手研究）另計為第二類，不混入「一手來源」那一類。
no_source = [(b, q) for b, q in ITEMS if not srcs(b, q)]
# 舊版這兩類都用 `not evidence(b, q)`（有任何 evidence 就排除）——
#    於是「有一手來源 URL、但 evidence 是維基／新聞」的題會從兩類都溜掉，
#    被默默算進「已補齊一手逐字」。改用 primary_evidence()：一手逐字才算數。
nonprimary = [
    (b, q) for b, q in ITEMS
    if srcs(b, q) and not has_primary(b, q)
]
no_quote = [(b, q) for b, q in ITEMS if has_primary(b, q) and not primary_evidence(b, q)]


def is_calc(q):
    t = stem(q)
    return bool(re.search(r'請計算|試計算|排放量為多少|為多少|=\s*\?', t)) and bool(re.search(r'\d', t))


calc = [(b, q) for b, q in no_source if is_calc(q)]
fab = [(b, q) for b, q in no_source if who(q) in FABRICATED and not is_calc(q)]
rest = [(b, q) for b, q in no_source if not is_calc(q) and who(q) not in FABRICATED]

L = []
L.append('# 還沒有一手來源的題目')
L.append('')
L.append('> **這份檔案由 `python tools/gen_gap_reports.py` 從資料生成，不要手改。**')
L.append('> 手寫的缺口清單一定會漂 —— 而一份不準的缺口清單比沒有清單更糟：')
L.append('> 它會讓人以為缺口已經被盤點過了。')
L.append('')
L.append(
    f'題庫共 {len(ITEMS)} 題'
    f'（主題庫 {len(ds["gist_items"]) + len(ds["our_unique_items"])}、練習池 {len(pool["items"])}）。'
)
L.append('')
L.append('| | 題數 |')
L.append('| --- | ---: |')
L.append(f'| **完全沒有 URL** | **{len(no_source)}** |')
L.append(f'| 有 URL 但沒有一手來源（部落格／新聞／二手） | {len(nonprimary)} |')
L.append(f'| 有一手來源，但沒有一手逐字引文 | {len(no_quote)} |')
L.append('')
L.append('---')
L.append('')
L.append('## 這批缺口「不是還沒查」——是查完沒回填')
L.append('')
L.append('第十六輪（`ipas-research-archive/verification-rounds/r16/`）就是專門查這個桶：')
L.append('34 題逐題附 `source_url` + 逐字 `quote` + `quote_supports_option` + 判定理由，')
L.append('判定為 CORRECT 30 題、UNVERIFIABLE 3 題、WRONG 1 題（WRONG 那題 `pool-aig-ind-005`')
L.append('的錯誤日期已於後續輪次修正）。')
L.append('')
L.append('**但那些引文從來沒有寫回題庫** —— 所以這份報告一直把它們算成缺口。')
L.append('')
L.append('2026-08-27 這輪回填的判準：**只寫回能逐字對上的**。')
L.append('r16 一併歸檔了當時抓下的來源全文（`s1.txt`／`s2.txt`／`cdmfaq.txt`／`removals.txt`／')
L.append('`frld_a01.txt`／`sbti_v1.txt`），7 題的引文在這些全文裡逐字命中，已寫回；')
L.append('其餘來源當時只存了網址，現在重抓多半 403（環境部新聞頁即是），')
L.append('**在能重新逐字驗證之前不寫入** —— 照抄代理的轉述正是本 repo 抓過 8.1% 引錯地方的那條路。')
L.append('')
L.append('### 為什麼「查過了」還會一直留在缺口清單裡')
L.append('')
L.append('不是有人忘了回填 —— 是**回填被一道 fail-closed 的閘門擋著，而且擋得對**。')
L.append('')
L.append('流程是：代理只准交「一手來源 URL + 該頁逐字引文」，不准交判定；')
L.append('再由 `tools/verify_agent_quotes.py` 把那個 URL 重抓回來、逐字機械比對，')
L.append('**通過的才寫進題庫**。理由是 repo 自己踩過：AI 驗 AI 的 155 筆 CONFIRMED 裡，')
L.append('後來用法條原文比對抓出 13 個實質缺陷。')
L.append('')
L.append('所以引文沒落地，幾乎都是「**重抓不到**」而不是「沒查」。實測 r16 的 30 筆：')
L.append('')
L.append('| | 已落地 | 未落地 |')
L.append('| --- | ---: | ---: |')
L.append('| ifrs.org / unfccc.int / law.moj.gov.tw 等可抓的站 | 多數 | 少數（代理改寫過，非逐字） |')
L.append('| `enews.moenv.gov.tw`（環境部新聞稿） | 0 | **4** —— 對抓取器一律 403 |')
L.append('')
L.append('也就是說：**一個對機器人回 403 的官方新聞稿，會讓一題永遠停在缺口清單上**，')
L.append('即使人早就讀過那頁、也抄回了正確的原文。')
L.append('')
L.append('可行的解法有二：(1) 改用同一機關「可抓得到」的等價來源（法規系統公告本文、')
L.append('附件 PDF）取代新聞稿；(2) 用本機調研歸檔裡當時抓下的來源全文當第二個驗證基準 ——')
L.append('2026-08-27 這輪就是這樣多救回 2 題（`gist[126]`、`gist[383]`）。')
L.append('')
L.append('下一個要處理這批的人：先看 r16 的 `res_*.json`，不要從頭再查一次。')
L.append('')
L.append('---')
L.append('')
L.append(f'## 一、完全沒有來源（{len(no_source)} 題）')
L.append('')

L.append(f'### 1-A 純計算題 —— 題目自帶數據，本來就沒有外部來源可查（{len(calc)} 題）')
L.append('')
L.append('這些題的正確性**不靠外部來源，靠算術**。CI 已有 `CALC` 回歸表逐題重算。')
L.append('')
L.append('| id | 題幹 |')
L.append('| --- | --- |')
for b, q in sorted(calc, key=lambda x: who(x[1])):
    L.append(f'| `{who(q)}` | {stem(q)[:60]} |')
L.append('')

L.append(f'### 1-B 代理交了引文，但引文查無此句（{len(fab)} 題）')
L.append('')
L.append('第三輪有代理替這些題交了「一手來源 + 逐字引文」，但 `tools/verify_agent_quotes.py`')
L.append('把該頁面抓回來逐字比對後，**那句話不在上面**。')
L.append('')
L.append('**這不代表題目是錯的** —— 只代表**我們還沒有拿到可信的證據**。')
L.append('捏造的引文一筆都沒有寫進題庫，所以這些題維持「沒有來源」。')
L.append('')
L.append('| id | 題幹 |')
L.append('| --- | --- |')
for b, q in sorted(fab, key=lambda x: who(x[1])):
    L.append(f'| `{who(q)}` | {stem(q)[:60]} |')
L.append('')

L.append(f'### 1-C 其他（{len(rest)} 題）')
L.append('')
L.append('派了代理，窮盡搜過 iPAS 公版教材、法規資料庫、環境部與國際標準，**仍然找不到一手來源**。')
L.append('多半是社群共筆自行改寫的題目，不對應任何官方教材段落。')
L.append('')
L.append('| id | 題庫 | 題幹 |')
L.append('| --- | --- | --- |')
for b, q in sorted(rest, key=lambda x: who(x[1])):
    L.append(f'| `{who(q)}` | {b} | {stem(q)[:56]} |')
L.append('')

L.append('---')
L.append('')
L.append(f'## 二、有 URL 但沒有一手來源（{len(nonprimary)} 題）')
L.append('')
L.append('這些題附了 URL，但網域不在 `source-authority.ts` 的一手來源清單內（部落格、新聞、')
L.append('二手研究等）。**有連結不代表有一手依據** —— 這批仍需換成官方／法規／標準的一手來源。')
L.append('')
if nonprimary:
    L.append('| id | 題庫 | 題幹 |')
    L.append('| --- | --- | --- |')
    for b, q in sorted(nonprimary, key=lambda x: who(x[1])):
        L.append(f'| `{who(q)}` | {b} | {stem(q)[:56]} |')
    L.append('')

L.append('---')
L.append('')
L.append(f'## 三、有一手來源，但沒有一手逐字引文（{len(no_quote)} 題）')
L.append('')
L.append('這些題**附了一手來源 URL**，但沒有一筆「一手來源 + 逐字引文」的 evidence ——')
L.append('可能完全沒有 evidence，也可能 evidence 只落在二手來源（維基／新聞／標準轉載預覽）上。')
L.append('')
L.append('**連結是活的，不代表指對地方。** 我們抓到過 19 題引錯法規 ——')
L.append('碳費題引到溫管辦法，兩個 URL 都回 HTTP 200。')
L.append('')
L.append('<details>')
L.append(f'<summary>展開全部 {len(no_quote)} 題</summary>')
L.append('')
L.append('| id | 題庫 | 題幹 |')
L.append('| --- | --- | --- |')
for b, q in sorted(no_quote, key=lambda x: who(x[1])):
    L.append(f'| `{who(q)}` | {b} | {stem(q)[:56]} |')
L.append('')
L.append('</details>')

out = '\n'.join(L) + '\n'
out = re.sub(r'[ \t]+\n', '\n', out)      # 行尾空白（MD009）
out = re.sub(r'\n{3,}', '\n\n', out)      # 連續空行（MD012）
open('VERIFICATION-GAPS.md', 'w', encoding='utf-8').write(out)
print(f'VERIFICATION-GAPS.md：完全沒來源 {len(no_source)}（算術 {len(calc)}／引文被擋 {len(fab)}／其他 {len(rest)}）'
      f'、有來源無引文 {len(no_quote)}')
