"""把 iPAS 參考樣題匯入主題庫（integrated_dataset.json 的 our_unique_items）。

用法（repo 根目錄）：
    uv run --locked --project tools python tools/import_official_sample.py <來源代號> ... [--cache 目錄]
    uv run --locked --project tools python tools/restore_from_source_pdf.py --emit [--cache 目錄]
    cd quiz-app && pnpm preflight        # 同步題庫的衍生統計（meta）與文件數字，並跑所有 gate

來源（網址、sha256、版次、科目）登記在 restore_from_source_pdf.py 的 SOURCES（kind 為 official_sample）；題目由
ipas_sample_pdf.py 從 PDF 擷取。這支只負責把擷取結果寫成題庫的題目：
  - 題幹、選項、答案照 PDF；
  - 標上 official_sample（版次、科目、題號）；
  - 答案依據是參考樣題本身與它印的「解答」；
  - 主庫已經有同一題的（restore_from_source_pdf.DATASET_DUPLICATES 登記的配對）不另外匯入，在主庫那一題標上
    official_sample、附上同樣的答案依據：同一題只收一次，「只出官方題目」照樣抽得到它。
已經在題庫裡的題目（重新匯入時），規則與官方公告試題的匯入工具相同（import_official_exam.merge）：題幹、選項、
答案、考科或 official_sample 與這次擷取的結果不同就中止；工具負責的引文（帶這支工具的 generated_by 標記）整批換成
這次建出來的版本；其他的照原樣保留。主庫配對那一題也一樣：official_sample 沒有就標上、不同就中止，答案與 PDF 不同就
中止，工具負責的引文換成這次建出來的版本。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import import_official_exam
import ipas_sample_pdf
import restore_from_source_pdf as R
from restore_from_source_pdf import load_pdf

DATASET = R.DATASET
OWNED = ('stem', 'options', 'answer', 'exam_subject', 'official_sample')  # 這支工具負責、不准被別處改掉的欄位
SUBJECT_LABEL = {'L11': '第一科', 'L12': '第二科'}
GENERATED_BY = 'tools/import_official_sample.py'  # 這支工具建出來的引文都帶這個標記；重新匯入時只換帶標記的


def _label(meta: dict) -> str:
    return f'參考樣題（{meta["edition"]} 年版）{SUBJECT_LABEL[meta["subject"]]}'


def _printed(question: dict) -> str:
    """題目在 PDF 上的樣子：題幹，下一行接四個選項（PDF 以「；」分隔），再一行解答。"""
    options = '；'.join(f'({o["key"]}){o["text"]}' for o in question['options'])
    return f'{question["stem"]}\n{options}\n解答：({question["answer"]})'


def marker(meta: dict, number: int) -> dict:
    """official_sample 標記：版次、科目、題號。"""
    return {'edition': meta['edition'], 'subject': meta['subject'], 'question_number': number}


def build_item(src_id: str, meta: dict, question: dict) -> dict:
    """一題擷取結果 → 題庫的一題。"""
    number, answer = question['number'], question['answer']
    return {
        'item_id': f'{src_id}-q{number:03d}',
        'year': int(meta['edition']) + 1911,
        'year_confidence': 'high',
        'credential': 'iPAS 淨零碳規劃管理師',
        'level': None,  # 參考樣題的 PDF 沒有寫等級
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
        'notes': '由參考樣題 PDF 擷取（tools/import_official_sample.py）；題幹、選項、答案照 PDF。',
        'exam_subject': meta['exam_subject'],
        'subject_confidence': 1.0,
        'official_sample': marker(meta, number),
        'metadata': {
            'sources': [meta['url']],
            'evidence': [{
                'url': meta['url'],
                'quote': _printed(question),
                'supports_option': answer,
                'note': f'{_label(meta)}第 {number} 題：PDF 印「解答：({answer})」。',
                'generated_by': GENERATED_BY,
            }],
        },
    }


def mark_twins(dataset: dict, twins: list[tuple[str, dict]]) -> int:
    """主庫已經有同一題的參考樣題（DATASET_DUPLICATES 登記的配對，twins 是來源代號與擷取到的那一題）：在主庫那一題
    標上 official_sample，工具負責的引文換成這次建出來的版本（與匯入的題目同一則：PDF 上的這一題連同「解答」）。
    已經有同樣的標記就不動；標記不同、或主庫那一題的答案與 PDF 不同就中止（引文支持的選項必須是那一題的答案）。
    回傳有變動的題數。"""
    items = dataset['gist_items'] + dataset['our_unique_items']
    changed = 0
    for src_id, question in twins:
        number = question['number']
        pin = R.DATASET_DUPLICATES[(src_id, number)]
        found = [it for it in items if R._dataset_ref(it) == pin['dataset_item']]
        if len(found) != 1:
            sys.exit(f'✗ {src_id} 第 {number} 題：DATASET_DUPLICATES 登記的 {pin["dataset_item"]} 在主庫找到 '
                     f'{len(found)} 題，要重新裁決。')
        twin = found[0]
        if twin.get('answer') != question['answer']:
            sys.exit(f'✗ {pin["dataset_item"]} 的答案是 {twin.get("answer")}，{src_id} 第 {number} 題的 PDF 印'
                     f'「解答：({question["answer"]})」：配對要重新裁決。')
        want = marker(R.SOURCES[src_id], number)
        have = twin.get('official_sample')
        if have is not None and have != want:
            sys.exit(f'✗ {pin["dataset_item"]} 已經標了 official_sample {have}，與 {src_id} 第 {number} 題的 {want} '
                     '不同：不覆寫，先查清楚。')
        twin['official_sample'] = want
        built = build_item(src_id, R.SOURCES[src_id], question)
        refreshed = import_official_exam._refresh_owned_evidence(twin, built, generated_by=GENERATED_BY)
        changed += have is None or refreshed
    return changed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description='把 iPAS 參考樣題匯入主題庫。')
    ap.add_argument('sources', nargs='+', help='SOURCES 裡 kind 為 official_sample 的來源代號')
    ap.add_argument('--cache', default=str(Path.home() / '.cache' / 'ipas-src-pdf'),
                    help='來源 PDF 的快取目錄：沒有才下載，sha256 與 SOURCES 不符就中止')
    a = ap.parse_args(argv)

    cache = Path(a.cache)
    sources = list(dict.fromkeys(a.sources))  # 同一個來源寫兩次只匯入一次
    for src_id in sources:  # 先確認每一份都登記齊全，再開始下載
        meta = R.SOURCES.get(src_id)
        if not meta or meta.get('kind') != 'official_sample':
            sys.exit(f'✗ {src_id} 不是參考樣題的來源（SOURCES 裡沒有，或 kind 不是 official_sample）。')
        if meta.get('layout') not in R.SAMPLE_HEADER_READERS:  # 與 restore 的 extract_sources 同一條：版面要是樣題的
            sys.exit(f'✗ {src_id}: 參考樣題（kind official_sample）與它的版面（{meta.get("layout")!r}）要一起用。')
        if src_id not in R.EXPECTED_QUESTION_COUNT:
            sys.exit(f'✗ {src_id} 沒有登記總題數（restore_from_source_pdf.py 的 EXPECTED_QUESTION_COUNT）。')
    items, twins = [], []
    for src_id in sources:
        meta = R.SOURCES[src_id]
        cache.mkdir(parents=True, exist_ok=True)
        load_pdf(src_id, cache)
        path = cache / f'{src_id}.pdf'
        try:
            R.check_sample_header(src_id, meta, ipas_sample_pdf.header(path, meta['subject']))  # 是那一版、那一科
            questions = ipas_sample_pdf.extract(path, meta['subject'])
        except ValueError as e:
            sys.exit(f'✗ {src_id}: {e}')
        expected = R.EXPECTED_QUESTION_COUNT[src_id]
        if len(questions) != expected:
            sys.exit(f'✗ {src_id}: 擷取到 {len(questions)} 題，應為 {expected} 題。')
        paired = {n for s, n in R.DATASET_DUPLICATES if s == src_id}  # 主庫已有同一題：不另外匯入
        items += [build_item(src_id, meta, q) for q in questions if q['number'] not in paired]
        twins += [(src_id, q) for q in questions if q['number'] in paired]

    dataset = json.loads(DATASET.read_text(encoding='utf-8'))
    before = len(dataset['our_unique_items'])
    refreshed = import_official_exam.merge(dataset, items, owned=OWNED, generated_by=GENERATED_BY)
    marked = mark_twins(dataset, twins)
    added = len(dataset['our_unique_items']) - before
    # 與 tools/sync_derived_counts.py 相同的寫法：縮排 2、不跳脫中文、檔尾不換行
    DATASET.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding='utf-8', newline='\n')
    print(f'新增 {added} 題；已在題庫裡 {len(items) - added} 題，其中 {refreshed} 題更新了工具負責的引文或來源；'
          f'主庫已有同一題的 {len(twins)} 題，其中 {marked} 題新標上 official_sample 或更新了工具負責的引文。'
          '接著跑 restore_from_source_pdf.py --emit 記進憑證，再 cd quiz-app && pnpm preflight。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
