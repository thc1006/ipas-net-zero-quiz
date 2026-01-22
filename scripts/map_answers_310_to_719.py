#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
將 310 題的驗證答案映射到 719 題資料集
基於 DATASET_ANALYSIS_REPORT.json 的對應關係
"""

import json
import sys
from pathlib import Path
from datetime import datetime

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

def map_answers(q310_data, q719_data, analysis_report):
    """將 310 題答案映射到 719 題"""

    matches = analysis_report['matches']['text_match']

    print(f"📝 開始映射 {len(matches)} 組答案...")

    # 建立 310 題的答案索引
    q310_answers = {item['id']: item for item in q310_data}

    # 統計
    stats = {
        'total_matches': len(matches),
        'updated': 0,
        'conflicts': 0,
        'already_correct': 0
    }

    updates = []

    # 處理 gist_items
    for item in q719_data.get('gist_items', []):
        idx = item.get('index')

        # 尋找對應的匹配
        match = next((m for m in matches if m['q719_index'] == idx), None)

        if match:
            q310_id = match['q310_id']
            q310_item = q310_answers.get(q310_id)

            if q310_item:
                old_answer = item.get('answer')
                new_answer = q310_item['answer']

                if old_answer != new_answer:
                    item['answer'] = new_answer

                    # 如果 310 題有 explanation，也更新
                    if 'explanation' in q310_item and q310_item['explanation']:
                        item['explanation'] = q310_item['explanation']

                    updates.append({
                        'q719_index': idx,
                        'q310_id': q310_id,
                        'old_answer': old_answer,
                        'new_answer': new_answer,
                        'status': 'updated'
                    })

                    if old_answer is not None:
                        stats['conflicts'] += 1
                    else:
                        stats['updated'] += 1
                else:
                    stats['already_correct'] += 1

    # 處理 our_unique_items
    for item in q719_data.get('our_unique_items', []):
        idx = item.get('index')

        match = next((m for m in matches if m['q719_index'] == idx), None)

        if match:
            q310_id = match['q310_id']
            q310_item = q310_answers.get(q310_id)

            if q310_item:
                old_answer = item.get('answer')
                new_answer = q310_item['answer']

                if old_answer != new_answer:
                    item['answer'] = new_answer

                    if 'explanation' in q310_item and q310_item['explanation']:
                        item['explanation'] = q310_item['explanation']

                    updates.append({
                        'q719_index': idx,
                        'q310_id': q310_id,
                        'old_answer': old_answer,
                        'new_answer': new_answer,
                        'status': 'updated'
                    })

                    if old_answer is not None:
                        stats['conflicts'] += 1
                    else:
                        stats['updated'] += 1
                else:
                    stats['already_correct'] += 1

    return q719_data, stats, updates

def main():
    base_dir = Path(__file__).parent.parent

    print("="*60)
    print("🔄 310 題答案映射到 719 題")
    print("="*60)

    # 載入資料
    print("\n📥 載入資料...")
    q310_data = load_json(base_dir / 'quiz-app' / 'src' / 'data' / 'questions.json')
    q719_data = load_json(base_dir / 'quiz-app' / 'src' / 'data' / 'integrated_dataset.json')
    analysis_report = load_json(base_dir / 'DATASET_ANALYSIS_REPORT.json')

    print(f"✅ 310 題資料: {len(q310_data)} 題")
    print(f"✅ 719 題資料: {analysis_report['summary']['q719_total']} 題")

    # 執行映射
    print("\n🔄 執行答案映射...")
    updated_719, stats, updates = map_answers(q310_data, q719_data, analysis_report)

    # 儲存更新後的 719 題資料集
    output_file = base_dir / 'quiz-app' / 'src' / 'data' / 'integrated_dataset_updated.json'
    save_json(updated_719, output_file)

    # 儲存更新日誌
    update_log = {
        'timestamp': datetime.now().isoformat(),
        'stats': stats,
        'updates': updates
    }
    log_file = base_dir / 'ANSWER_MAPPING_LOG.json'
    save_json(update_log, log_file)

    # 輸出統計
    print("\n" + "="*60)
    print("📊 映射統計")
    print("="*60)
    print(f"總匹配數: {stats['total_matches']}")
    print(f"✅ 新增答案: {stats['updated']}")
    print(f"⚠️  答案衝突（已覆蓋）: {stats['conflicts']}")
    print(f"✓  答案已正確: {stats['already_correct']}")
    print(f"\n📁 更新檔案: {output_file}")
    print(f"📁 更新日誌: {log_file}")
    print("="*60)

    # 計算剩餘無答案題數
    remaining_no_answer = analysis_report['summary']['unmatched_no_answer']
    print(f"\n🎯 下一步: 還有 {remaining_no_answer} 題需要找答案")

if __name__ == '__main__':
    main()
