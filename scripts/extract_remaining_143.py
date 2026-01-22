#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
提取剩餘 143 題未驗證的題目
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

    remaining = []

    # 檢查 gist_items
    for item in dataset.get('gist_items', []):
        metadata = item.get('metadata', {})
        if not metadata.get('answer_verified'):
            remaining.append({
                'index': item.get('index'),
                'stem': item.get('stem', '')[:60] + '...' if len(item.get('stem', '')) > 60 else item.get('stem', ''),
                'options': [f"{o['key']}: {o['text'][:30]}..." if len(o['text']) > 30 else f"{o['key']}: {o['text']}" for o in item.get('options', [])],
                'current_answer': item.get('answer'),
                'source': 'gist',
                'subject': item.get('exam_subject', 'unknown')
            })

    # 檢查 our_unique_items
    for item in dataset.get('our_unique_items', []):
        metadata = item.get('metadata', {})
        if not metadata.get('answer_verified'):
            remaining.append({
                'index': item.get('index'),
                'stem': item.get('stem', '')[:60] + '...' if len(item.get('stem', '')) > 60 else item.get('stem', ''),
                'options': [f"{o['key']}: {o['text'][:30]}..." if len(o['text']) > 30 else f"{o['key']}: {o['text']}" for o in item.get('options', [])],
                'current_answer': item.get('answer'),
                'source': 'our_unique',
                'subject': item.get('exam_subject', 'unknown')
            })

    print(f"總計找到 {len(remaining)} 題未驗證")
    print(f"\n按考科分布:")

    subject_counts = {}
    for q in remaining:
        subj = q['subject']
        subject_counts[subj] = subject_counts.get(subj, 0) + 1

    for subj, count in sorted(subject_counts.items()):
        print(f"  {subj}: {count} 題")

    # 輸出完整清單到 JSON
    output_file = base_dir / 'REMAINING_143_QUESTIONS.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump({
            'total': len(remaining),
            'by_subject': subject_counts,
            'questions': remaining
        }, f, ensure_ascii=False, indent=2)

    print(f"\n已輸出到: {output_file}")

    # 分批輸出（每批 36 題，分 4 批）
    batch_size = 36
    for i in range(0, len(remaining), batch_size):
        batch = remaining[i:i+batch_size]
        batch_num = (i // batch_size) + 1
        batch_file = base_dir / f'REMAINING_BATCH_{batch_num}.json'
        with open(batch_file, 'w', encoding='utf-8') as f:
            json.dump({
                'batch': batch_num,
                'count': len(batch),
                'questions': batch
            }, f, ensure_ascii=False, indent=2)
        print(f"Batch {batch_num}: {len(batch)} 題 -> {batch_file.name}")

if __name__ == '__main__':
    main()
