#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
從 MISSING_ANSWERS_ANALYSIS.json 生成指定 Batch 的題目清單
用於並行驗證工作
"""

import json
import sys
from pathlib import Path

# Windows 編碼修正
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

def load_json(file_path: Path):
    """載入 JSON 檔案"""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(data, file_path: Path):
    """儲存 JSON 檔案"""
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def generate_batch_questions(batch_name: str, start_idx: int, batch_size: int):
    """
    生成指定 Batch 的題目清單

    Args:
        batch_name: Batch 名稱 (A, B, C, D, E, F)
        start_idx: 起始索引（從優先級清單中）
        batch_size: Batch 大小
    """
    base_dir = Path(__file__).parent.parent

    # 載入分析報告
    analysis_file = base_dir / 'MISSING_ANSWERS_ANALYSIS.json'
    if not analysis_file.exists():
        print(f"❌ 找不到分析報告: {analysis_file}")
        return None

    analysis = load_json(analysis_file)
    prioritized = analysis['prioritized']

    # 提取指定範圍的題目
    batch_questions = prioritized[start_idx:start_idx + batch_size]

    # 從 integrated_dataset.json 提取完整題目資訊
    dataset_file = base_dir / 'quiz-app' / 'src' / 'data' / 'integrated_dataset.json'
    dataset = load_json(dataset_file)

    # 建立索引映射
    full_questions = []
    for item in dataset.get('gist_items', []):
        idx = item.get('index')
        if any(q['index'] == idx for q in batch_questions):
            full_questions.append({
                'index': idx,
                'number': item.get('number'),
                'subject': item.get('exam_subject'),
                'question': item.get('stem'),
                'options': item.get('options', {}),
                'answer': None,  # 需要驗證
                'source': 'gist',
                'priority_score': next(q['priority_score'] for q in batch_questions if q['index'] == idx),
                'keywords': next(q['keywords'] for q in batch_questions if q['index'] == idx)
            })

    for item in dataset.get('our_unique_items', []):
        idx = item.get('index')
        if any(q['index'] == idx for q in batch_questions):
            full_questions.append({
                'index': idx,
                'number': item.get('number'),
                'subject': item.get('exam_subject'),
                'question': item.get('stem'),
                'options': item.get('options', {}),
                'answer': None,
                'source': 'our_unique',
                'priority_score': next(q['priority_score'] for q in batch_questions if q['index'] == idx),
                'keywords': next(q['keywords'] for q in batch_questions if q['index'] == idx)
            })

    # 按優先級排序
    full_questions.sort(key=lambda x: x['priority_score'], reverse=True)

    # 生成輸出
    output = {
        'batch_name': batch_name,
        'batch_size': len(full_questions),
        'priority_range': f"{start_idx + 1} ~ {start_idx + len(full_questions)}",
        'questions': full_questions,
        'summary': {
            'total': len(full_questions),
            'by_subject': {},
            'by_keywords': {}
        }
    }

    # 統計
    from collections import Counter
    subject_counter = Counter(q['subject'] for q in full_questions)
    all_keywords = []
    for q in full_questions:
        all_keywords.extend(q['keywords'])
    keyword_counter = Counter(all_keywords)

    output['summary']['by_subject'] = dict(subject_counter)
    output['summary']['by_keywords'] = dict(keyword_counter.most_common(10))

    return output

def main():
    import argparse
    parser = argparse.ArgumentParser(description='生成 266 題的 Batch 題目清單')
    parser.add_argument('batch', choices=['A', 'B', 'C', 'D', 'E', 'F'],
                       help='Batch 名稱')
    parser.add_argument('--size', type=int, default=45,
                       help='Batch 大小（預設 45）')

    args = parser.parse_args()

    # Batch 起始索引映射
    batch_starts = {
        'A': 0,    # 0-44
        'B': 45,   # 45-89
        'C': 90,   # 90-134
        'D': 135,  # 135-179
        'E': 180,  # 180-224
        'F': 225   # 225-265 (41題)
    }

    batch_name = args.batch
    start_idx = batch_starts[batch_name]

    # 根據實際 prioritized 清單長度調整 batch_size
    analysis_file = Path(__file__).parent.parent / 'MISSING_ANSWERS_ANALYSIS.json'
    analysis = load_json(analysis_file)
    total_prioritized = len(analysis['prioritized'])

    # 計算實際可用題數
    remaining = total_prioritized - start_idx
    batch_size = min(args.size, remaining)

    if batch_name == 'F':
        batch_size = remaining  # F 取剩餘所有題目

    print("="*60)
    print(f"📋 生成 266 題 Batch {batch_name} 題目清單")
    print("="*60)

    output = generate_batch_questions(batch_name, start_idx, batch_size)

    if output:
        # 儲存檔案
        base_dir = Path(__file__).parent.parent
        output_file = base_dir / f'266_batch_{batch_name.lower()}_questions.json'
        save_json(output, output_file)

        print(f"\n✅ Batch {batch_name} 題目清單已生成")
        print(f"📁 檔案: {output_file}")
        print(f"\n📊 統計:")
        print(f"  總題數: {output['summary']['total']}")
        print(f"  優先級範圍: {output['priority_range']}")
        print(f"\n  按考科:")
        for subject, count in output['summary']['by_subject'].items():
            print(f"    {subject}: {count} 題")
        print(f"\n  關鍵字 (前 5):")
        for keyword, count in list(output['summary']['by_keywords'].items())[:5]:
            print(f"    {keyword}: {count} 題")
        print("="*60)
    else:
        print("❌ 生成失敗")
        sys.exit(1)

if __name__ == '__main__':
    main()
