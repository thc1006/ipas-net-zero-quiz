# 拿 iPAS 公版教材**範例題 PDF 上印的官方答案卡**，去交叉比對題庫的答案。
#
# 為什麼要有這支：這個 repo 到今天為止的每一道閘門，查的都是「引用對不對」，
# **沒有一道在查「答案對不對」**。32 個錯答案全部是靠人一題一題挖出來的 ——
# 而我這一輪已經證明了自己會看錯。
#
# ⚠️ **絕對不可以按「字母」比對。**
#   題庫把選項順序打散過。我寫這支之前一分鐘才踩到：
#   gist[151] 的教材答案卡印「(D)」、題庫標「(A)」，我差點宣告它是錯答案 ——
#   但教材的 (D)「促進投資者…管理其環境影響」**就是題庫的 (A)**。答案本來是對的。
#   **字母是排版，文字才是內容。**
#
# ⚠️ **也不可以按「字串相等」比對。**
#   題庫不只重排，還**改寫**了選項文字：
#     gist[62]  教材「對碳排放設定價格的政策工具」/ 題庫「為二氧化碳排放訂定價格之政策工具措施」
#   同義、不同字。前綴比對會全部落空 —— 那不是「答案錯了」，是**我比不出來**。
#   所以改用相似度取最佳匹配，而且**分不出高下時誠實回報「驗不了」**。
#
# ⚠️ **這支只產出候選，不產出判決。** 每一筆 MISMATCH 都要人去讀 PDF 確認。
#   「代理/工具說它錯」不等於「它錯」—— 這個 repo 已經被這件事咬過很多次。

import io
import json
import re
import sys
from difflib import SequenceMatcher

sys.path.insert(0, 'tools')
from fetch_text import fetch, norm  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 這些 PDF 直接印答案卡（行首或右欄）
KEYED = ('316660797', '500712036', '583537684', '190841777', '697134715', '775097586')

# 異體字：題庫寫「計劃」，教材印「計畫」—— 不折會把一堆對的判成「不符」
FOLD = str.maketrans('劃佈鏈鑑昇姊台週佔', '畫布链鉴升姐臺周占')

MARK = re.compile(r'[(（]([A-D])[)）]|(?<![A-Za-z])([A-D])[.．]\s')

TODAY = '2026-07-14'


def key(s):
    return norm(s or '').translate(FOLD)


def sim(a, b):
    return SequenceMatcher(None, key(a), key(b)).ratio()


def _cut(page, i):
    st = page.rfind('\n', 0, max(0, i - 1))
    st = 0 if st < 0 else st + 1
    nxt = re.search(r'\n\s*(?:[(（][A-D][)）]\s*)?(?:Q\s*)?\d{1,3}\s*[.．、]|\nQ\s*\d', page[i + 12:])
    en = i + 12 + nxt.start() if nxt else min(len(page), i + 480)
    return page[st:en]


def blocks_of(page, stem, quote):
    """切出這一題**所有可能**的區塊（題幹在 PDF 裡可能出現不只一次）。

    ⚠️ **不可以盲取第一個。** 697134715.pdf 裡「什麼是氣候變遷減緩？」
    出現了**兩次**（Q60 與 Q78），而**兩次的選項完全不同**。
    題庫抄的是 Q78，我的工具鎖到 Q60 —— 拿 Q60 的答案去對 Q78 的選項，
    於是相似度把它配到別的字母，**憑空報出一個錯答案**。
    （兩題的正解其實都是 (A)。這是我的工具製造出來的假錯誤，不是資料的錯。）

    → 回傳所有候選區塊，由呼叫端**用「哪個區塊的選項最像題庫的選項」**來決定。

    ⚠️ find() 回 -1 時絕對不可以繼續切片 —— 那會靜靜切出檔案開頭。
    """
    flat = re.sub(r'\s+', '', page)
    # 壓平後的位置 → 原文位置
    back = [pos for pos, ch in enumerate(page) if not ch.isspace()]
    out = []
    for probe in (stem, quote):
        anchor = re.sub(r'\s+', '', probe or '')[:14]
        if len(anchor) < 6:
            continue
        start = 0
        while True:
            j = flat.find(anchor, start)
            if j < 0 or j >= len(back):
                break
            out.append(_cut(page, back[j]))
            start = j + 1
        if out:
            break
    return out


def parse_opts(block):
    """區塊裡**來源自己的**選項。回傳 (選項字典, 行首答案字母, 去掉行首後的內文)。

    ⚠️ 行首的「(D) 18.」是**答案卡**，不是選項 D —— 先剝掉它再找選項。
    ⚠️ 每個選項的文字切到**下一個標記**為止，不是切到「下一個第一次出現的字母」——
       否則選項 D 會把右欄的答案卡整段吞進去，答案就永遠解析不出來。
    """
    lead = None
    m = re.match(r'\s*[(（]([A-D])[)）]\s*\d{1,3}\s*[.．]', block)
    if m:
        lead, block = m.group(1), block[m.end():]

    marks = [(mm.start(), mm.group(1) or mm.group(2)) for mm in MARK.finditer(block)]
    firsts, seen = [], set()
    for pos, k in marks:
        if k not in seen:
            seen.add(k)
            firsts.append((pos, k))
    src = {}
    for pos, k in firsts:
        nxt = next((p for p, _ in marks if p > pos), len(block))
        src[k] = _trim(block[pos + 3:nxt])
    return src, lead, block, marks, firsts


# 選項 D 是最後一個，它的文字會一路吃到區塊結尾 ——
# 把**頁尾／解析段**也吃進去（「以上皆是 \n ML (2024.08.16 整理) \n 4 \n 考科1…」），
# 相似度就被稀釋成 0.17，一個本來 100% 對的答案被判成「分不出高下」。
_STOP = re.compile(r'\n\s*\n|-{4,}|ML\s*[(（]|\n\s*考科\s*\d')


def _trim(t):
    m = _STOP.search(t or '')
    return (t[:m.start()] if m else t).strip()


def key_letter(block):
    """(來源選項字典, 答案卡上的**字母**, 格式) —— 解析不出來就回 (src, None, 原因)。"""
    src, lead, body, marks, firsts = parse_opts(block)
    if not marks:
        return src, None, '區塊裡找不到選項標記'
    if len(src) < 3:
        return src, None, f'只解析出 {len(src)} 個選項'

    if lead and lead in src:
        return src, lead, 'A:行首答案卡'

    m = re.search(r'[(（]\s*答案\s*[:：]?\s*([A-D])\s*[)）]', body)
    if m and m.group(1) in src:
        return src, m.group(1), 'B:(答案: X)'

    # 格式 C：雙欄 —— 選項列完之後，右欄**重印一次答案**（開頭就是 (X)）
    pD = dict((k, p) for p, k in firsts).get('D')
    if pD is not None:
        after = [(p, k) for p, k in marks if p > pD]
        if after and after[0][1] in src:
            return src, after[0][1], 'C:雙欄答案卡'
    return src, None, '認不出答案卡格式'


def load_overrides():
    """restoration-manifest 裡**有記錄、有一手依據**的刻意偏離。

    ⚠️ 這個 repo **早就有**一套「答案必須等於 PDF 答案卡」的閘門
    （restoration-manifest.test.ts），而偏離答案卡必須登記成 `answer_override` 並附依據。

    我寫這支新工具時**完全不知道那套機制存在** —— 於是它把 `S_CHU_06-q094`
    報成「第 33 個錯答案」，我還差點改下去。實際上那是一個 2026-07-13 的**刻意決定**：
    PDF 答案卡印 (D) 以上皆非，但那與 ISO 14064-1:2018 對 base year 的定義不符，
    所以採 (C)，並把理由與一手依據寫進 manifest。

    **兩個互不知道的系統，一定會漂。** 這支工具必須讀那份 manifest。
    """
    try:
        m = json.load(open('quiz-app/src/data/restoration-manifest.json', encoding='utf-8'))
    except OSError:
        return {}
    return {e['item_id']: e['answer_override']
            for e in m.get('entries', []) if e.get('answer_override')}


def main():
    ds = json.load(open('quiz-app/src/data/integrated_dataset.json', encoding='utf-8'))
    pool = json.load(open('quiz-app/src/data/practice_pool.json', encoding='utf-8'))
    ALL = ds['gist_items'] + ds['our_unique_items'] + pool['items']
    OVERRIDE = load_overrides()

    def qid(q):
        return q.get('id') or q.get('item_id') or f"gist[{q.get('index')}]"

    def node(q):
        return q.get('metadata') or q.get('provenance') or {}

    idx_all = {qid(q): q for q in ALL}
    cache, rows = {}, []
    for q in ALL:
        # ⚠️ **母體要看 sources，不能只看 evidence。**
        #   第一版只掃「有 evidence 的題目」—— 於是 S_CHU_06-q094 整個被漏掉：
        #   它的 sources 指著答案卡 PDF，但沒人替它抽過引文。
        #   而它正是**唯一一題與官方答案卡不符的**（答案卡 (D)，題庫標 C）。
        #   **一個把該查的題目排除在母體外的檢查，它的綠燈是一句假的保證。**
        ev = (node(q).get('evidence') or [None])[0]
        cand = [ev['url']] if (ev and ev.get('url')) else []
        cand += [x for x in ((q.get('metadata') or {}).get('sources') or q.get('sources') or [])
                 if isinstance(x, str)]
        u = next((x for x in cand if any(k in x for k in KEYED)), None)
        if not u:
            continue
        if u not in cache:
            cache[u] = fetch(u)[0]
        r = {'id': qid(q), 'url': u, 'answer': q.get('answer')}
        if not cache[u]:
            rows.append({**r, 'verdict': 'FETCH_FAIL'})
            continue
        if not q.get('answer'):
            # 刻意標成無答案（多重正解）的題目，本來就沒有「題庫答案」可比
            rows.append({**r, 'verdict': 'ANSWER_NULL'})
            continue
        blks = blocks_of(cache[u], q.get('stem') or q.get('question'),
                         (ev or {}).get('quote'))
        if not blks:
            rows.append({**r, 'verdict': 'NOT_FOUND'})
            continue
        # 題幹可能在 PDF 裡出現多次（同一題被改寫成兩版）——
        # **用「哪個區塊的選項最像題庫的選項」來挑**，不要盲取第一個。
        def fit(b, _q=q):
            src = parse_opts(b)[0]
            if not src:
                return -1.0
            return sum(max((sim(t, o['text']) for t in src.values()), default=0.0)
                       for o in _q['options']) / len(_q['options'])
        blk = max(blks, key=fit) if len(blks) > 1 else blks[0]

        # ⚠️ **「來源是答案卡 PDF」不等於「這筆引文是範例題」。**
        #   同一份 PDF 裡也有大量實質內文，而有些題目引的正是那些內文。
        #   我原本沒擋這件事，於是工具會拿**隔壁題**的答案卡去對這一題的選項 ——
        #   gist[339] 被切到「從化石燃料轉向再生能源的過程」（那是別題的答案）。
        #   **那會憑空製造出錯答案。** 區塊的選項對不上題庫的選項，就不適用這個比對。
        if fit(blk) < 0.35:
            rows.append({**r, 'verdict': 'NOT_SAMPLE_Q', 'how': '這筆引文不是範例題，交叉比對不適用'})
            continue

        src, lead, how = key_letter(blk)
        if not lead:
            rows.append({**r, 'verdict': 'NO_KEY', 'how': how})
            continue

        # ⚠️ **不要拿「答案卡的那段文字」去跟四個選項比相似度。**
        #   S_CHU_06-q067 的答案卡是「以上皆是」（= 題庫的 D），但 PDF 在它後面
        #   **緊接著一行解析**（「負排放技術是能夠從大氣中移除二氧化碳…」）——
        #   那段解析把相似度整個拉去 B，於是工具報出一個**根本不存在的錯答案**。
        #
        #   但我其實**已經知道答案卡的字母**了。缺的只是「來源字母 ↔ 題庫字母」的對應表。
        #   先用四個選項建對應（貪婪指派 + 排除法），再用字母查 ——
        #   **重排、改寫、尾巴汙染，三種都免疫。**
        pairs = sorted(((sim(t, o['text']), sk, o['key'])
                        for sk, t in src.items() for o in q['options']), reverse=True)
        m_s2b, used_s, used_b, scores = {}, set(), set(), {}
        for s, sk, bk in pairs:
            if sk in used_s or bk in used_b:
                continue
            m_s2b[sk], scores[sk] = bk, s
            used_s.add(sk)
            used_b.add(bk)
        # 排除法：來源選項只剩一個沒配到時，題庫也只剩一個 —— 那就是它
        left_s = [k for k in src if k not in used_s]
        left_b = [o['key'] for o in q['options'] if o['key'] not in used_b]
        if len(left_s) == 1 and len(left_b) == 1:
            m_s2b[left_s[0]], scores[left_s[0]] = left_b[0], -1.0   # -1 = 靠排除法

        bk = m_s2b.get(lead)
        r |= {'how': how, 'key_text': (src.get(lead) or '').strip()[:46], 'best': bk,
              'score': round(scores.get(lead, 0), 2), 'fit': round(fit(blk), 2)}
        ov = OVERRIDE.get(r['id'])
        if not bk:
            rows.append({**r, 'verdict': 'AMBIGUOUS'})
        elif bk == q.get('answer'):
            rows.append({**r, 'verdict': 'AGREE'})
        elif ov and ov.get('corrected_answer') == q.get('answer'):
            # **有記錄、有一手依據的刻意偏離** —— 不是錯，是一個被寫下來的判斷。
            # 「這題我覺得應該是 D」不是推翻它的理由。
            rows.append({**r, 'verdict': 'DOCUMENTED_OVERRIDE',
                         'why': (ov.get('reason') or '')[:90]})
        else:
            rows.append({**r, 'verdict': 'MISMATCH'})

    # ── --write：把結果**凍進資料**，讓 CI 用得上 ───────────────────────
    #
    # CI 不能跑這支（它要抓 PDF，而我們刻意不讓 CI 下載/解析 PDF）。
    # 所以把「這題的答案已經跟官方答案卡對過了」寫成一筆 `answer_key_check`，
    # 再由**離線的** gate 去釘：只要有人動了這些題目的答案，CI 就紅。
    # （跟釘法條 sha256 是同一個模式：線上驗一次，離線守一輩子。）
    if '--write' in sys.argv:
        n = 0
        for x in rows:
            if x['verdict'] != 'AGREE':
                continue
            q = idx_all[x['id']]
            nd = q.setdefault('metadata', {}) if 'provenance' not in q else q['provenance']
            nd['answer_key_check'] = {
                'date': TODAY, 'verdict': 'agrees_with_official_key',
                'answer': x['answer'], 'source': x['url'],
                'key_text': (x['key_text'] or '').splitlines()[0][:60], 'how': x['how'],
            }
            n += 1
        ds['meta']['answer_key_check'] = {
            'date': TODAY, 'population': len(rows), 'confirmed': n,
            'what': 'iPAS 公版教材的範例題 PDF **直接印答案卡**。把題庫的答案拿去跟官方答案卡'
                    '逐題交叉比對 —— 這是本專案第一個能機械驗證「答案」（而非「引用」）的檢查。',
            'note': '⚠️ **按文字比對，不按字母**：題庫把選項順序打散、文字也改寫過，'
                    '照字母抄會抄出錯答案。confirmed 以外的題目**不是「沒問題」，是「沒驗到」**。',
        }
        json.dump(ds, open('quiz-app/src/data/integrated_dataset.json', 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=2)
        json.dump(pool, open('quiz-app/src/data/practice_pool.json', 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=2)
        print(f'\n  ✍️ 已把 {n} 題的 answer_key_check 寫回資料（離線 gate 用）')

    import collections
    c = collections.Counter(x['verdict'] for x in rows)
    print('=' * 70)
    print(f'  母體（引文來自答案卡 PDF）: {len(rows)} 題')
    for k in ('AGREE', 'MISMATCH', 'DOCUMENTED_OVERRIDE', 'AMBIGUOUS', 'NO_KEY',
              'NOT_SAMPLE_Q', 'ANSWER_NULL', 'NOT_FOUND', 'FETCH_FAIL'):
        if c[k]:
            print(f'    {k:11} {c[k]:4}')
    print('=' * 70)
    for x in rows:
        if x['verdict'] == 'MISMATCH':
            print(f"  🚨 {x['id']:22} 答案卡→{x['best']} 題庫→{x['answer']}  "
                  f"(配對相似度 {x['score']}, 題目吻合度 {x['fit']}) {x['how']}")
            print(f"       答案卡原文：{(x['key_text'] or '').splitlines()[0][:46]}")
    for x in rows:
        if x['verdict'] == 'DOCUMENTED_OVERRIDE':
            print(f"  📌 {x['id']:22} 答案卡→{x['best']} 題庫→{x['answer']}  "
                  f"**有記錄的刻意偏離**（restoration-manifest 的 answer_override）")
            print(f"       理由：{x['why']}")
    print()
    print('  ⚠️ AGREE 以外的**每一種**都不是「答案沒問題」，是「我沒驗到」。')
    json.dump(rows, open('scratchpad_answer_key.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
