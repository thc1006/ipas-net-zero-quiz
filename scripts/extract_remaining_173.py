#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
提取剩餘 173 題未驗證的題目並分批
"""

import json
import sys
from pathlib import Path

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

def main():
    base_dir = Path(__file__).parent.parent
    dataset_file = base_dir / 'quiz-app' / 'src' / 'data' / 'integrated_dataset_updated.json'

    with open(dataset_file, 'r', encoding='utf-8') as f:
        dataset = json.load(f)

    # 提取未驗證的題目
    no_answer = []
    has_answer_unverified = []

    all_items = dataset['gist_items'] + dataset['our_unique_items']

    for item in all_items:
        if item.get('metadata', {}).get('answer_verified'):
            continue

        q_data = {
            'index': item.get('index'),
            'stem': item.get('stem', ''),
            'options': item.get('options', []),
            'current_answer': item.get('answer'),
            'source': item.get('source', 'unknown'),
            'subject': item.get('exam_subject', 'unknown')
        }

        if item.get('answer'):
            has_answer_unverified.append(q_data)
        else:
            no_answer.append(q_data)

    print(f'=== 剩餘題目統計 ===')
    print(f'有答案待驗證: {len(has_answer_unverified)} 題')
    print(f'無答案需研究: {len(no_answer)} 題')
    print(f'總計: {len(has_answer_unverified) + len(no_answer)} 題')

    # 輸出無答案的題目（優先處理）
    no_answer_file = base_dir / 'REMAINING_NO_ANSWER_16.json'
    with open(no_answer_file, 'w', encoding='utf-8') as f:
        json.dump({
            'total': len(no_answer),
            'priority': 'HIGH',
            'questions': no_answer
        }, f, ensure_ascii=False, indent=2)
    print(f'\n已輸出無答案題目: {no_answer_file.name}')

    # 分批輸出有答案但未驗證的題目
    batch_size = 40
    for i in range(0, len(has_answer_unverified), batch_size):
        batch = has_answer_unverified[i:i+batch_size]
        batch_num = (i // batch_size) + 1
        batch_file = base_dir / f'REMAINING_VERIFY_BATCH_{batch_num}.json'
        with open(batch_file, 'w', encoding='utf-8') as f:
            json.dump({
                'batch': batch_num,
                'count': len(batch),
                'questions': batch
            }, f, ensure_ascii=False, indent=2)
        print(f'Batch {batch_num}: {len(batch)} 題 -> {batch_file.name}')

if __name__ == '__main__':
    main()
