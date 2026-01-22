#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析 719 題與 310 題的對應關係
找出重疊、獨特題目，以及缺失答案的題目
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Set

# Windows 編碼修正
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

def load_json(file_path: Path) -> any:
    """載入 JSON 檔案"""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def normalize_question(text: str) -> str:
    """正規化題目文字（移除空白、標點差異）"""
    return ''.join(text.split()).lower()

def extract_310_questions(data: List[Dict]) -> Dict[str, Dict]:
    """從 310 題資料集提取題目（使用 ID 作為 key）"""
    questions = {}
    for item in data:
        questions[item['id']] = {
            'id': item['id'],
            'subject': item['subject'],
            'question': item['question'],
            'answer': item['answer'],
            'normalized': normalize_question(item['question'])
        }
    return questions

def extract_719_questions(data: Dict) -> Dict[int, Dict]:
    """從 719 題資料集提取題目（使用 index 作為 key）"""
    questions = {}

    # Gist items
    for item in data.get('gist_items', []):
        idx = item.get('index', item.get('number', len(questions) + 1))
        questions[idx] = {
            'index': idx,
            'number': item.get('number', idx),
            'subject': item.get('exam_subject', item.get('original_section', '未知')),
            'question': item.get('stem', ''),
            'answer': item.get('answer'),
            'source': 'gist',
            'normalized': normalize_question(item.get('stem', ''))
        }

    # Our unique items
    for item in data.get('our_unique_items', []):
        idx = item.get('index', item.get('number', len(questions) + 1))
        questions[idx] = {
            'index': idx,
            'number': item.get('number', idx),
            'subject': item.get('exam_subject', item.get('original_section', '未知')),
            'question': item.get('stem', ''),
            'answer': item.get('answer'),
            'source': 'our_unique',
            'normalized': normalize_question(item.get('stem', ''))
        }

    return questions

def find_matches(q310: Dict[str, Dict], q719: Dict[int, Dict]) -> Dict:
    """找出 310 題與 719 題的對應關係"""

    matches = {
        'exact_id_match': [],  # ID 完全匹配（如果 719 有 ID 欄位）
        'text_match': [],      # 題目文字匹配
        'no_match_310': [],    # 310 題中無法在 719 找到的
        'no_match_719': []     # 719 題中無法在 310 找到的
    }

    # 建立 719 題的正規化文字索引
    q719_normalized = {v['normalized']: k for k, v in q719.items()}

    # 檢查 310 題在 719 中的匹配
    matched_310 = set()
    matched_719 = set()

    for q310_id, q310_item in q310.items():
        normalized = q310_item['normalized']

        if normalized in q719_normalized:
            q719_index = q719_normalized[normalized]
            matches['text_match'].append({
                'q310_id': q310_id,
                'q719_index': q719_index,
                'q310_answer': q310_item['answer'],
                'q719_answer': q719[q719_index]['answer'],
                'answer_status': 'match' if q310_item['answer'] == q719[q719_index]['answer']
                                else 'conflict' if q719[q719_index]['answer']
                                else 'need_update'
            })
            matched_310.add(q310_id)
            matched_719.add(q719_index)
        else:
            matches['no_match_310'].append({
                'id': q310_id,
                'question': q310_item['question'][:100]
            })

    # 找出 719 中未匹配的題目
    for q719_index, q719_item in q719.items():
        if q719_index not in matched_719:
            matches['no_match_719'].append({
                'index': q719_index,
                'subject': q719_item['subject'],
                'question': q719_item['question'][:100],
                'has_answer': q719_item['answer'] is not None,
                'source': q719_item['source']
            })

    return matches

def analyze_missing_answers(matches: Dict, q719: Dict[int, Dict]) -> Dict:
    """分析缺失答案的題目"""

    missing_answers = {
        'matched_need_update': [],  # 719 中有對應但缺答案的
        'unmatched_no_answer': [],  # 719 中無對應且無答案的
        'unmatched_has_answer': []  # 719 中無對應但有答案的
    }

    # 已匹配但需要更新答案的
    for match in matches['text_match']:
        if match['answer_status'] == 'need_update':
            q719_index = match['q719_index']
            missing_answers['matched_need_update'].append({
                'q719_index': q719_index,
                'q310_id': match['q310_id'],
                'question': q719[q719_index]['question'][:100],
                'q310_answer': match['q310_answer']
            })

    # 未匹配的題目
    for item in matches['no_match_719']:
        if not item['has_answer']:
            missing_answers['unmatched_no_answer'].append(item)
        else:
            missing_answers['unmatched_has_answer'].append(item)

    return missing_answers

def main():
    base_dir = Path(__file__).parent.parent

    # 載入資料
    print("📥 載入資料集...")
    q310_data = load_json(base_dir / 'quiz-app' / 'src' / 'data' / 'questions.json')
    q719_data = load_json(base_dir / 'quiz-app' / 'src' / 'data' / 'integrated_dataset.json')

    # 提取題目
    print("🔍 提取題目...")
    q310 = extract_310_questions(q310_data)
    q719 = extract_719_questions(q719_data)

    print(f"✅ 310 題資料: {len(q310)} 題")
    print(f"✅ 719 題資料: {len(q719)} 題")

    # 找出對應關係
    print("\n🔗 分析對應關係...")
    matches = find_matches(q310, q719)

    # 分析缺失答案
    print("📊 分析缺失答案...")
    missing = analyze_missing_answers(matches, q719)

    # 生成報告
    report = {
        'summary': {
            'q310_total': len(q310),
            'q719_total': len(q719),
            'text_matched': len(matches['text_match']),
            'no_match_310': len(matches['no_match_310']),
            'no_match_719': len(matches['no_match_719']),
            'matched_need_update': len(missing['matched_need_update']),
            'unmatched_no_answer': len(missing['unmatched_no_answer']),
            'unmatched_has_answer': len(missing['unmatched_has_answer'])
        },
        'matches': matches,
        'missing_answers': missing
    }

    # 儲存報告
    output_file = base_dir / 'DATASET_ANALYSIS_REPORT.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 報告已儲存: {output_file}")

    # 輸出摘要
    print("\n" + "="*60)
    print("📊 分析摘要")
    print("="*60)
    print(f"310 題總數: {report['summary']['q310_total']}")
    print(f"719 題總數: {report['summary']['q719_total']}")
    print(f"\n✅ 文字匹配: {report['summary']['text_matched']} 題")
    print(f"   - 需要更新答案: {report['summary']['matched_need_update']} 題")
    print(f"\n❌ 310 中無法在 719 找到: {report['summary']['no_match_310']} 題")
    print(f"❌ 719 中無法在 310 找到: {report['summary']['no_match_719']} 題")
    print(f"   - 無答案: {report['summary']['unmatched_no_answer']} 題")
    print(f"   - 有答案: {report['summary']['unmatched_has_answer']} 題")

    # 計算需要處理的總數
    total_need_answer = (
        report['summary']['matched_need_update'] +
        report['summary']['unmatched_no_answer']
    )
    print(f"\n🎯 需要找答案的題目總數: {total_need_answer} 題")
    print("="*60)

if __name__ == '__main__':
    main()
