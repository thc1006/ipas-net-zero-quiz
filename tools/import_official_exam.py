"""把 iPAS 官方公告試題匯入主題庫（integrated_dataset.json 的 our_unique_items）。

用法（repo 根目錄）：
    uv run --locked --project tools python tools/import_official_exam.py <來源代號> ... [--cache 目錄]
    uv run --locked --project tools python tools/restore_from_source_pdf.py --emit [--cache 目錄]
    cd quiz-app && pnpm preflight        # 同步題庫的衍生統計（meta）與文件數字，並跑所有 gate

來源（網址、sha256、場次、考試日期、科目）登記在 restore_from_source_pdf.py 的 SOURCES（kind 為
official_exam）；題目由 ipas_exam_pdf.py 從 PDF 擷取。這支只負責把擷取結果寫成題庫的題目：
  - 題幹、選項、答案照 PDF；
  - 標上 official_exam（場次、考試日期、科目、題號）；
  - PDF 首頁註明「試題參考答案以該次考試公告時之法規內容為準」，所以每一題都標時效
    （quality_flags: time_sensitive），查證日期（metadata.valid_as_of）就是考試日期；
  - 答案依據是官方題目本身與它的答案欄；個別題目另有一手依據（例如題幹點名的法條）時，
    登記在 EXTRA_EVIDENCE，排在前面。
  - 登記為圖表題的（SOURCES 的 figure_questions：題目要讀圖、題庫還不支援圖片）照常擷取、核對，但不寫進題庫；
    manifest 記為 not_imported_figure 並寫明理由。
已經在題庫裡的題目（重新匯入時）：
  - 題幹、選項、答案、考科或 official_exam 與這次擷取的結果不同就中止 —— 來源 PDF 變了要先查清楚，
    題庫被改過就要先還原；
  - 工具負責的引文（官方題目本身與 EXTRA_EVIDENCE，每一則都帶 generated_by 標記）整批換成這次建出來的
    版本：改了、加了、從表上拿掉了 EXTRA_EVIDENCE，重新匯入就會生效；被手改的也換回工具建出來的版本；
  - metadata.sources 以工具的網址開頭；工具的引文帶進來、這次不再需要的網址一併拿掉，除非還有人工的
    引文用它（sources 沒有歸屬標記，所以用引文來判斷：人工另外列在 sources、剛好與工具引文同網址的，
    也會被當成工具帶進來的）；
  - 其他的（之後補上的解析、標籤、另外附的引文 —— 即使網址與工具的引文相同 —— 以及人工另外列的網址）
    照原樣保留。
題庫裡工具負責的部分被手改時，tools/tests/test_official_exam_import.py 的
test_the_bank_holds_what_the_importer_builds 拿擷取快照重建每一題、逐欄比對而轉紅。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import ipas_exam_pdf
import restore_from_source_pdf as R
from restore_from_source_pdf import load_pdf

DATASET = R.DATASET
OWNED = ('stem', 'options', 'answer', 'exam_subject', 'official_exam')  # 匯入工具負責、不准被別處改掉的欄位
SUBJECT_LABEL = {'L11': '第一科', 'L12': '第二科'}
GENERATED_BY = 'tools/import_official_exam.py'  # 工具建出來的引文都帶這個標記；重新匯入時只換帶標記的
ORDINAL = '一二三四五六七八九十'  # 第十一次起寫阿拉伯數字（題卡的標籤也是這樣寫）

# 個別題目的額外一手依據（排在官方題目之前）。每一筆都必須支持官方答案。
# 鍵：(來源代號, 題號)。法條（全國法規資料庫的網址）要寫 clause，由 law_evidence_problems 對照
# law-articles.pinned.json 的釘選條文核對：法規要已釘選、網址的 flno 與 clause 是同一條、引文逐字在那一條裡
# （匯入時與 CI 的工具測試都跑）。
EXTRA_EVIDENCE: dict[tuple[str, int], list[dict]] = {
    # 題幹點名的條文本身就寫著答案（引文與 law-articles.pinned.json 的釘選條文逐字相同）
    ('S_IPAS_115_01_L12', 17): [{
        'url': 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=O0020102&flno=4',
        'quote': '依前項排放係數法計算燃料燃燒產生之排放量，應以燃料用量乘以低位熱值及係數。',
        'supports_option': 'C',
        'clause': '第4條',
    }],
    ('S_IPAS_115_01_L12', 32): [{
        'url': 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=O0020098&flno=37',
        'quote': '應於指定期限內向中央主管機關申請核定碳足跡，經中央主管機關審查、查驗及核算後核定之，'
                 '並於規定期限內依核定內容使用及分級標示於產品之容器或外包裝。',
        'supports_option': 'B',
        'clause': '第37條',
    }],
    # 《巴黎協定》第 6 條：UNFCCC 現行的官方出版本（2026-09-28 下載，sha256 9c19b811a9e346bc532de9c64430494776dc4348
    # 04d84cb48ad1ceacb66c884e；先前引的 english_paris_agreement.pdf 已從網站移除）。引文從條標「Article 6」
    # 起引到第 2 項（引文取 PDF 文字層、空白合併為一個）：題幹點名的「第六條」由條標綁住。
    ('S_IPAS_115_01_L11', 18): [{
        'url': 'https://unfccc.int/sites/default/files/resource/parisagreement_publication.pdf',
        'quote': ('Article 6 1. Parties recognize that some Parties choose to pursue voluntary cooperation in '
                  'the implementation of their nationally determined contributions to allow for higher ambition'
                  ' in their mitigation and adaptation actions and to promote sustainable development and '
                  'environmental integrity. 2. Parties shall, where engaging on a voluntary basis in '
                  'cooperative approaches that involve the use of internationally transferred mitigation '
                  'outcomes towards nationally determined contributions, promote sustainable development and '
                  'ensure environmental integrity and transparency'),
        'supports_option': 'C',
        'clause': 'Article 6',
        'note': '《巴黎協定》第 6 條第 1、2 項：締約方以自願合作的方式，使用國際轉讓減緩成果（ITMOs）'
                '來達成國家自定貢獻。',
    }],
}


# 不是釘選法條的額外引文（例如 UNFCCC 的《巴黎協定》出版本）：CI 拿不到原文，引文是不是逐字出自來源，
# 由 --verify-extra 對照本機快取裡的那一份 PDF 核對（檔名是它的 sha256；網站擋下載時用瀏覽器存）。
# 每一個網址登記核對時那一份 PDF 的 sha256。法條引文不在這裡：law_evidence_problems 拿釘選的條文核對。
LAW_HOST = 'law.moj.gov.tw'
PINNED_LAWS = DATASET.parent / 'law-articles.pinned.json'
CLAUSE = re.compile(r'第(\d+)條(?:之(\d+))?')
EXTRA_SOURCES = {
    'https://unfccc.int/sites/default/files/resource/parisagreement_publication.pdf':
        '9c19b811a9e346bc532de9c64430494776dc434804d84cb48ad1ceacb66c884e',
}


def _flat(text: str) -> str:
    """空白不計：PDF 的文字層在斷行處留下空白（「pre- industrial」、中文換行），閱讀器上看不到。"""
    return re.sub(r'\s+', '', text)


def load_pinned_laws() -> dict:
    return json.loads(PINNED_LAWS.read_text(encoding='utf-8'))


def law_query(url: str) -> dict[str, list[str]] | None:
    """全國法規資料庫（主機名稱就是 law.moj.gov.tw）的網址 → 查詢參數，名稱一律小寫（pcode、PCode 都認）；
    不是就回傳 None。比的是主機名稱，不是子字串：law.moj.gov.tw.example.org 不算。"""
    parts = urlsplit(url)
    if parts.hostname != LAW_HOST:
        return None
    query: dict[str, list[str]] = {}
    for name, values in parse_qs(parts.query).items():
        query.setdefault(name.lower(), []).extend(values)
    return query


def law_evidence_problems(pinned: dict, sources=None) -> list[str]:
    """EXTRA_EVIDENCE 的法條引文，對照 law-articles.pinned.json 的釘選條文核對。回傳問題清單。
    網址的 pcode 恰好一個、而且是釘選的法規；clause 寫成「第N條」或「第N條之M」，對得到那部法規的一條；
    網址帶 flno 時必須是同一條；引文逐字（空白不計）在那一條的條文裡。不需要網路：匯入時與 CI 的工具測試都跑。
    sources：只核對這幾份來源的項目（匯入時）；None 是全部。"""
    laws = pinned['laws']
    problems = []
    for key, entries in sorted(EXTRA_EVIDENCE.items()):
        if sources is not None and key[0] not in sources:
            continue
        for e in entries:
            query = law_query(e['url'])
            if query is None:
                continue
            codes = query.get('pcode', [])
            if len(codes) != 1:
                problems.append(f'{key}：{e["url"]} 的 pcode 不是恰好一個 —— 看不出是哪一部法規')
                continue
            law = laws.get(codes[0])
            if law is None:
                problems.append(f'{key}：{codes[0]} 不在 law-articles.pinned.json —— 法規沒有釘選，引文無從核對。'
                                '要釘選新的法規，先問專案所有者（AGENTS.md）')
                continue
            m = CLAUSE.fullmatch(str(e.get('clause')))
            if not m:
                problems.append(f'{key}：clause「{e.get("clause")}」不是「第N條」或「第N條之M」的寫法')
                continue
            article = m[1] + (f'-{m[2]}' if m[2] else '')
            flno = query.get('flno')
            if flno is not None and flno != [article]:
                problems.append(f'{key}：網址的 flno={",".join(flno)} 與 clause「{e["clause"]}」不是同一條')
                continue
            text = law['articles'].get(article)
            if text is None:
                problems.append(f'{key}：{law["name"]}沒有第 {article} 條（釘選的條文裡查無此條）')
                continue
            if _flat(e['quote']) not in _flat(text):
                problems.append(f'{key}：引文不在{law["name"]}第 {article} 條裡（{e["quote"][:40]}…）')
    return problems


def verify_extra_evidence(cache: Path) -> list[str]:
    """EXTRA_EVIDENCE 裡非法條的引文，是否逐字（空白不計）出自登記的那一份來源 PDF。回傳問題清單。
    引文不能跨頁：頁碼會夾在中間。"""
    import pymupdf  # 延後 import：只有核對時才讀 PDF

    problems, texts = [], {}
    for key, entries in sorted(EXTRA_EVIDENCE.items()):
        for e in entries:
            url = e['url']
            if law_query(url) is not None:  # 法條：law_evidence_problems 核對
                continue
            sha = EXTRA_SOURCES.get(url)
            if sha is None:
                problems.append(f'{key}：{url} 沒有登記在 EXTRA_SOURCES（核對時那一份 PDF 的 sha256）')
                continue
            if url not in texts:
                texts[url] = None
                path = cache / f'{sha}.pdf'
                if not path.exists():
                    problems.append(f'{key}：快取裡沒有 {path}（下載 {url}，存成這個檔名）')
                    continue
                data = path.read_bytes()
                if R.sha256_bytes(data) != sha:
                    problems.append(f'{key}：{path} 的 sha256 不符 —— 不是登記的那一份 PDF')
                    continue
                with pymupdf.open(stream=data, filetype='pdf') as doc:
                    texts[url] = _flat(' '.join(page.get_text() for page in doc))
            if texts[url] is not None and _flat(e['quote']) not in texts[url]:
                problems.append(f'{key}：引文不在 {url} 裡（{e["quote"][:40]}…）')
    return problems


def _label(meta: dict) -> str:
    year, round_ = meta['session'].split('-')
    n = int(round_)
    session = f'第{ORDINAL[n - 1]}次' if 1 <= n <= len(ORDINAL) else f'第 {n} 次'
    return f'{year} 年{session}公告試題{SUBJECT_LABEL[meta["subject"]]}'


def _printed(question: dict) -> str:
    """題目在 PDF 上的樣子：題幹，下一行接四個選項（PDF 以「；」分隔）。"""
    return question['stem'] + '\n' + '；'.join(f'({o["key"]}){o["text"]}' for o in question['options'])


def build_item(src_id: str, meta: dict, question: dict, extra_evidence: list[dict] | None = None) -> dict:
    """一題擷取結果 → 題庫的一題。"""
    number, answer = question['number'], question['answer']
    for e in extra_evidence or []:
        if e.get('supports_option') != answer:
            sys.exit(f'✗ {src_id} 第 {number} 題：額外依據的 supports_option 是 {e.get("supports_option")!r}，'
                     f'官方答案是 {answer}。')
    official = {
        'url': meta['url'],
        'quote': _printed(question),
        'supports_option': answer,
        'note': f'{_label(meta)}第 {number} 題：PDF 的答案欄印 {answer}。',
        'generated_by': GENERATED_BY,
    }
    extras = [{**e, 'generated_by': GENERATED_BY} for e in extra_evidence or []]
    return {
        'item_id': f'{src_id}-q{number:03d}',
        'year': int(meta['exam_date'][:4]),
        'year_confidence': 'high',
        'credential': 'iPAS 淨零碳規劃管理師',
        'level': '初級',
        'topic_tags': [],
        'question_type': 'single_choice',
        'stem': question['stem'],
        'options': [dict(o) for o in question['options']],
        'answer': answer,
        'explanation': None,
        'source': {
            'source_id': src_id,
            'url': meta['url'],
            'publisher': 'iPAS',
            'authority': 'official',
            'evidence': {'page': question['page'], 'quote': question['stem']},
        },
        'alt_sources': [],
        'notes': '由官方公告試題 PDF 擷取（tools/import_official_exam.py）；題幹、選項、答案照 PDF。',
        'exam_subject': meta['exam_subject'],
        'subject_confidence': 1.0,
        'official_exam': {
            'session': meta['session'],
            'exam_date': meta['exam_date'],
            'subject': meta['subject'],
            'question_number': number,
        },
        'quality_flags': ['time_sensitive'],
        'metadata': {
            'valid_as_of': meta['exam_date'],
            # 題庫的慣例：引文的網址也列在 sources 裡（季排程依它檢查連結）
            'sources': list(dict.fromkeys([meta['url'], *(e['url'] for e in extras)])),
            'evidence': [*extras, official],
        },
    }


def _refresh_owned_evidence(current: dict, built: dict) -> bool:
    """工具負責的引文（帶 generated_by 標記）整批換成這次建出來的版本，排在前面；其他引文照留，
    即使網址相同。sources 以工具的網址開頭；舊的工具引文帶進來的網址，這次不再需要、也沒有人工引文
    用它，就拿掉。回傳檔案裡寫出來的內容有沒有變（含順序）。"""
    meta = current.get('metadata') or {}
    current['metadata'] = meta
    before = json.dumps([meta.get('evidence'), meta.get('sources')], ensure_ascii=False)
    evidence = meta.get('evidence') or []
    others = [e for e in evidence if e.get('generated_by') != GENERATED_BY]
    dropped = ({e.get('url') for e in evidence if e.get('generated_by') == GENERATED_BY}
               - {e.get('url') for e in others})
    meta['evidence'] = [dict(e) for e in built['metadata']['evidence']] + others
    ours = built['metadata']['sources']
    meta['sources'] = [*ours, *(u for u in meta.get('sources') or [] if u not in ours and u not in dropped)]
    return json.dumps([meta['evidence'], meta['sources']], ensure_ascii=False) != before


def merge(dataset: dict, items: list[dict]) -> int:
    """新題接在 our_unique_items 最後；已經在的題目核對工具負責的欄位、更新工具負責的引文。

    回傳更新了引文的題數。
    """
    existing = {i.get('item_id'): i for i in dataset['our_unique_items']}
    refreshed = 0
    for item in items:
        current = existing.get(item['item_id'])
        if current is None:
            dataset['our_unique_items'].append(item)
            existing[item['item_id']] = item  # 同一個來源傳了兩次：第二次當成「已經在題庫裡」
            continue
        changed = [f for f in OWNED if current.get(f) != item[f]]
        if changed:
            sys.exit(f'✗ {item["item_id"]} 已經在題庫裡，而且 {changed} 與這次擷取的結果不同 —— '
                     '不覆寫。來源 PDF 變了要先查清楚；題庫被改過就要先還原。')
        refreshed += _refresh_owned_evidence(current, item)
    return refreshed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description='把 iPAS 官方公告試題匯入主題庫。')
    ap.add_argument('sources', nargs='*', help='SOURCES 裡 kind 為 official_exam 的來源代號')
    ap.add_argument('--cache', default=str(Path.home() / '.cache' / 'ipas-src-pdf'),
                    help='來源 PDF 的快取目錄：沒有才下載，sha256 與 SOURCES 不符就中止')
    ap.add_argument('--verify-extra', action='store_true',
                    help='不匯入：核對 EXTRA_EVIDENCE 的引文（法條對照釘選的條文，其他對照快取裡登記的來源 PDF）')
    a = ap.parse_args(argv)

    cache = Path(a.cache)
    if a.verify_extra:
        problems = law_evidence_problems(load_pinned_laws()) + verify_extra_evidence(cache)
        if problems:
            sys.exit('✗ 額外引文核對不過：\n  ' + '\n  '.join(problems))
        print('✓ EXTRA_EVIDENCE 的引文都逐字核對過（法條對照釘選的條文，其他對照快取裡登記 sha256 的來源 PDF）。')
        return 0
    if not a.sources:
        ap.error('要匯入的來源代號（或 --verify-extra）')
    sources = list(dict.fromkeys(a.sources))  # 同一個來源寫兩次只匯入一次
    for src_id in sources:  # 先確認每一份都登記齊全，再開始下載
        meta = R.SOURCES.get(src_id)
        if not meta or meta.get('kind') != 'official_exam':
            sys.exit(f'✗ {src_id} 不是官方公告試題的來源（SOURCES 裡沒有，或 kind 不是 official_exam）。')
        if src_id not in R.EXPECTED_QUESTION_COUNT:
            sys.exit(f'✗ {src_id} 沒有登記總題數（restore_from_source_pdf.py 的 EXPECTED_QUESTION_COUNT）。')
    R.check_figure_questions(sources)  # 圖表題的登記說得通，才下載
    on_figures = sorted(k for k in EXTRA_EVIDENCE
                        if k[0] in sources and k[1] in R.SOURCES[k[0]].get('figure_questions', {}))
    if on_figures:
        sys.exit(f'✗ EXTRA_EVIDENCE 掛在不收錄的圖表題上：{on_figures} —— 那幾題不會進題庫。')
    if problems := law_evidence_problems(load_pinned_laws(), sources):  # 不需要網路：下載之前先核對
        sys.exit('✗ 法條引文核對不過：\n  ' + '\n  '.join(problems))
    items, used = [], set()
    for src_id in sources:
        meta = R.SOURCES[src_id]
        cache.mkdir(parents=True, exist_ok=True)
        load_pdf(src_id, cache)
        path = cache / f'{src_id}.pdf'
        try:
            R.check_official_header(src_id, meta, ipas_exam_pdf.header(path))  # 是 SOURCES 說的那一場、那一科
            figures = meta.get('figure_questions', {})
            questions = ipas_exam_pdf.extract(path, figure_questions=frozenset(figures))
        except ValueError as e:
            sys.exit(f'✗ {src_id}: {e}')
        expected = R.EXPECTED_QUESTION_COUNT[src_id]
        if len(questions) != expected:
            sys.exit(f'✗ {src_id}: 擷取到 {len(questions)} 題，應為 {expected} 題。')
        kept = [q for q in questions if q['number'] not in figures]  # 圖表題不收錄（憑證裡記下理由）
        items += [build_item(src_id, meta, q, EXTRA_EVIDENCE.get((src_id, q['number']))) for q in kept]
        used |= {(src_id, q['number']) for q in kept}
    stale = sorted(k for k in EXTRA_EVIDENCE if k[0] in sources and k not in used)
    if stale:
        sys.exit(f'✗ EXTRA_EVIDENCE 有對不到任何題目的項目：{stale} —— 題號打錯，或那一題不在這份 PDF 裡。')

    dataset = json.loads(DATASET.read_text(encoding='utf-8'))
    before = len(dataset['our_unique_items'])
    refreshed = merge(dataset, items)
    added = len(dataset['our_unique_items']) - before
    # 與 tools/sync_derived_counts.py 相同的寫法：縮排 2、不跳脫中文、檔尾不換行
    DATASET.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding='utf-8', newline='\n')
    print(f'新增 {added} 題；已在題庫裡 {len(items) - added} 題，其中 {refreshed} 題更新了工具負責的引文或來源。'
          '接著跑 restore_from_source_pdf.py --emit 記進憑證，再 cd quiz-app && pnpm preflight。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
