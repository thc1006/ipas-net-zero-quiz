#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析 266 題無答案題目的主題分布與難度
建立尋找答案的優先順序策略
"""

import json
import sys
from pathlib import Path
from collections import Counter

# Windows 編碼修正
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

def load_json(file_path: Path):
    """載入 JSON 檔案"""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def analyze_missing_questions(q719_data, analysis_report):
    """分析無答案題目的分布"""

    missing_indices = [item['index'] for item in analysis_report['missing_answers']['unmatched_no_answer']]

    print(f"📊 分析 {len(missing_indices)} 題無答案題目...")

    missing_questions = []

    # 從 gist_items 收集
    for item in q719_data.get('gist_items', []):
        if item.get('index') in missing_indices:
            missing_questions.append({
                'index': item['index'],
                'number': item.get('number'),
                'subject': item.get('exam_subject', '未知'),
                'question': item.get('stem', '')[:100],
                'source': 'gist'
            })

    # 從 our_unique_items 收集
    for item in q719_data.get('our_unique_items', []):
        if item.get('index') in missing_indices:
            missing_questions.append({
                'index': item['index'],
                'number': item.get('number'),
                'subject': item.get('exam_subject', '未知'),
                'question': item.get('stem', '')[:100],
                'source': 'our_unique'
            })

    # 主題統計
    subject_counter = Counter(q['subject'] for q in missing_questions)
    source_counter = Counter(q['source'] for q in missing_questions)

    # 按主題分組
    by_subject = {}
    for q in missing_questions:
        subject = q['subject']
        if subject not in by_subject:
            by_subject[subject] = []
        by_subject[subject].append(q)

    return missing_questions, subject_counter, source_counter, by_subject

def identify_keywords(question_text):
    """識別題目關鍵字（簡單版本）"""
    keywords = []

    # ISO 標準
    if 'ISO' in question_text or '14064' in question_text or '14067' in question_text:
        keywords.append('ISO標準')

    # GHG 相關
    if 'GHG' in question_text or '溫室氣體' in question_text or '排放' in question_text:
        keywords.append('GHG排放')

    # 盤查相關
    if '盤查' in question_text or '查證' in question_text or '驗證' in question_text:
        keywords.append('盤查驗證')

    # 碳足跡
    if '碳足跡' in question_text or 'CFP' in question_text or 'PCF' in question_text:
        keywords.append('碳足跡')

    # 國際協議
    if '巴黎協定' in question_text or 'COP' in question_text or 'UNFCCC' in question_text:
        keywords.append('國際協議')

    # Scope
    if 'Scope' in question_text or '範疇' in question_text:
        keywords.append('排放範疇')

    # 淨零
    if '淨零' in question_text or 'Net Zero' in question_text or '碳中和' in question_text:
        keywords.append('淨零目標')

    return keywords if keywords else ['其他']

def prioritize_questions(missing_questions):
    """建立尋找答案的優先順序"""

    prioritized = []

    for q in missing_questions:
        keywords = identify_keywords(q['question'])

        # 計算優先級分數
        priority_score = 0

        # ISO 標準題優先（基礎知識）
        if 'ISO標準' in keywords:
            priority_score += 10

        # 排放範疇題優先（核心概念）
        if '排放範疇' in keywords:
            priority_score += 8

        # GHG 排放題
        if 'GHG排放' in keywords:
            priority_score += 7

        # 盤查驗證題
        if '盤查驗證' in keywords:
            priority_score += 6

        # 碳足跡題
        if '碳足跡' in keywords:
            priority_score += 5

        # 國際協議題
        if '國際協議' in keywords:
            priority_score += 4

        # 淨零目標題
        if '淨零目標' in keywords:
            priority_score += 3

        prioritized.append({
            **q,
            'keywords': keywords,
            'priority_score': priority_score
        })

    # 按優先級排序
    prioritized.sort(key=lambda x: x['priority_score'], reverse=True)

    return prioritized

def main():
    base_dir = Path(__file__).parent.parent

    print("="*60)
    print("🔍 分析 266 題無答案題目")
    print("="*60)

    # 載入資料
    print("\n📥 載入資料...")
    q719_data = load_json(base_dir / 'quiz-app' / 'src' / 'data' / 'integrated_dataset.json')
    analysis_report = load_json(base_dir / 'DATASET_ANALYSIS_REPORT.json')

    # 分析無答案題目
    missing_questions, subject_counter, source_counter, by_subject = analyze_missing_questions(
        q719_data, analysis_report
    )

    # 建立優先順序
    print("\n🎯 建立答案尋找優先順序...")
    prioritized = prioritize_questions(missing_questions)

    # 生成報告
    report = {
        'summary': {
            'total_missing': len(missing_questions),
            'by_subject': dict(subject_counter),
            'by_source': dict(source_counter)
        },
        'by_subject': {
            subject: [{'index': q['index'], 'question': q['question']}
                     for q in questions]
            for subject, questions in by_subject.items()
        },
        'prioritized': prioritized,  # 所有題目，已按優先級排序
        'keyword_distribution': {}
    }

    # 關鍵字統計
    all_keywords = []
    for q in prioritized:
        all_keywords.extend(q['keywords'])
    keyword_counter = Counter(all_keywords)
    report['keyword_distribution'] = dict(keyword_counter)

    # 儲存報告
    output_file = base_dir / 'MISSING_ANSWERS_ANALYSIS.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # 輸出統計
    print("\n" + "="*60)
    print("📊 無答案題目統計")
    print("="*60)
    print(f"\n總題數: {len(missing_questions)}")

    print("\n📚 按考科分布:")
    for subject, count in subject_counter.most_common():
        print(f"  {subject}: {count} 題")

    print("\n📦 按來源分布:")
    for source, count in source_counter.most_common():
        source_name = 'Gist' if source == 'gist' else '獨特題目'
        print(f"  {source_name}: {count} 題")

    print("\n🏷️  關鍵字分布:")
    for keyword, count in keyword_counter.most_common(10):
        print(f"  {keyword}: {count} 題")

    print(f"\n📁 報告已儲存: {output_file}")
    print("="*60)

    # 優先處理建議
    print("\n🎯 優先處理建議 (前 10 題):")
    print("-"*60)
    for i, q in enumerate(prioritized[:10], 1):
        print(f"\n{i}. [優先級: {q['priority_score']}] {q['subject']}")
        print(f"   問題: {q['question']}")
        print(f"   關鍵字: {', '.join(q['keywords'])}")

if __name__ == '__main__':
    main()
