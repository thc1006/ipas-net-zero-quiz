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
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import ipas_exam_pdf
import restore_from_source_pdf as R
from restore_from_source_pdf import load_pdf

DATASET = R.DATASET
OWNED = ('stem', 'options', 'answer', 'exam_subject', 'official_exam')  # 匯入工具負責、不准被別處改掉的欄位
SUBJECT_LABEL = {'L11': '第一科', 'L12': '第二科'}
GENERATED_BY = 'tools/import_official_exam.py'  # 工具建出來的引文都帶這個標記；重新匯入時只換帶標記的
ORDINAL = '一二三四五六七八九十'  # 第十一次起寫阿拉伯數字（題卡的標籤也是這樣寫）

# 個別題目的額外一手依據（排在官方題目之前）。每一筆都必須支持官方答案。
# 鍵：(來源代號, 題號)。
EXTRA_EVIDENCE: dict[tuple[str, int], list[dict]] = {}


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
    ap.add_argument('sources', nargs='+', help='SOURCES 裡 kind 為 official_exam 的來源代號')
    ap.add_argument('--cache', default=str(Path.home() / '.cache' / 'ipas-src-pdf'),
                    help='來源 PDF 的快取目錄：沒有才下載，sha256 與 SOURCES 不符就中止')
    a = ap.parse_args(argv)

    cache = Path(a.cache)
    sources = list(dict.fromkeys(a.sources))  # 同一個來源寫兩次只匯入一次
    for src_id in sources:  # 先確認每一份都登記齊全，再開始下載
        meta = R.SOURCES.get(src_id)
        if not meta or meta.get('kind') != 'official_exam':
            sys.exit(f'✗ {src_id} 不是官方公告試題的來源（SOURCES 裡沒有，或 kind 不是 official_exam）。')
        if src_id not in R.EXPECTED_QUESTION_COUNT:
            sys.exit(f'✗ {src_id} 沒有登記總題數（restore_from_source_pdf.py 的 EXPECTED_QUESTION_COUNT）。')
    items, used = [], set()
    for src_id in sources:
        meta = R.SOURCES[src_id]
        cache.mkdir(parents=True, exist_ok=True)
        load_pdf(src_id, cache)
        try:
            questions = ipas_exam_pdf.extract(cache / f'{src_id}.pdf')
        except ValueError as e:
            sys.exit(f'✗ {src_id}: {e}')
        expected = R.EXPECTED_QUESTION_COUNT[src_id]
        if len(questions) != expected:
            sys.exit(f'✗ {src_id}: 擷取到 {len(questions)} 題，應為 {expected} 題。')
        items += [build_item(src_id, meta, q, EXTRA_EVIDENCE.get((src_id, q['number']))) for q in questions]
        used |= {(src_id, q['number']) for q in questions}
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
