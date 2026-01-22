#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
同步 310 題已驗證答案到 719 題資料集
將 310 題中已驗證的答案同步到 integrated_dataset_updated.json
"""

import json
import sys
from pathlib import Path
from datetime import datetime

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

def normalize_stem(stem: str) -> str:
    """標準化題目文字以便比對"""
    return stem.strip().replace(' ', '').replace('\n', '')[:100]

def main():
    base_dir = Path(__file__).parent.parent

    # 讀取 310 題
    q310_file = base_dir / 'quiz-app' / 'src' / 'data' / 'questions.json'
    with open(q310_file, 'r', encoding='utf-8') as f:
        q310 = json.load(f)

    # 建立 310 題的查詢表（題目 -> 答案）
    q310_map = {}
    for q in q310:
        stem = normalize_stem(q.get('question', ''))
        if stem and q.get('answer'):
            q310_map[stem] = {
                'answer': q['answer'],
                'id': q.get('id', ''),
                'verified': q.get('verified', False),
                'explanation': q.get('explanation', '')
            }

    print(f'載入 310 題: {len(q310_map)} 題有效答案')

    # 讀取 719 題
    dataset_file = base_dir / 'quiz-app' / 'src' / 'data' / 'integrated_dataset_updated.json'
    with open(dataset_file, 'r', encoding='utf-8') as f:
        dataset = json.load(f)

    # 同步答案
    synced = 0
    already_verified = 0
    not_matched = 0

    for item in dataset['gist_items'] + dataset['our_unique_items']:
        # 跳過已驗證的
        if item.get('metadata', {}).get('answer_verified'):
            already_verified += 1
            continue

        stem = normalize_stem(item.get('stem', ''))

        if stem in q310_map:
            q310_data = q310_map[stem]

            # 更新答案和 metadata
            item['answer'] = q310_data['answer']
            if 'metadata' not in item:
                item['metadata'] = {}
            item['metadata']['answer_verified'] = True
            item['metadata']['verification_date'] = datetime.now().strftime('%Y-%m-%d')
            item['metadata']['verification_source'] = 'sync_from_310'
            item['metadata']['original_id'] = q310_data['id']

            synced += 1
        else:
            not_matched += 1

    # 更新 meta
    dataset['meta']['last_updated'] = datetime.now().isoformat()

    # 儲存
    with open(dataset_file, 'w', encoding='utf-8') as f:
        json.dump(dataset, f, ensure_ascii=False, indent=2)

    print(f'\n=== 同步結果 ===')
    print(f'已驗證（跳過）: {already_verified} 題')
    print(f'成功同步: {synced} 題')
    print(f'未匹配: {not_matched} 題')
    print(f'\n已更新: {dataset_file}')

    # 統計最終狀態
    final_verified = 0
    final_unverified_with_answer = 0
    final_no_answer = 0

    for item in dataset['gist_items'] + dataset['our_unique_items']:
        if item.get('metadata', {}).get('answer_verified'):
            final_verified += 1
        elif item.get('answer'):
            final_unverified_with_answer += 1
        else:
            final_no_answer += 1

    print(f'\n=== 最終狀態 ===')
    print(f'已驗證: {final_verified} 題')
    print(f'有答案未驗證: {final_unverified_with_answer} 題')
    print(f'無答案: {final_no_answer} 題')

if __name__ == '__main__':
    main()
