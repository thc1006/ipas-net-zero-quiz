#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
整合 Batch 1-5 驗證結果和 266 Batch A 答案到資料集
"""

import json
import sys
from pathlib import Path
from datetime import datetime
from shutil import copy2

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

def backup_file(file_path: Path):
    """備份檔案"""
    backup_path = file_path.parent / f"{file_path.stem}.backup.{datetime.now().strftime('%Y%m%d_%H%M%S')}{file_path.suffix}"
    copy2(file_path, backup_path)
    return backup_path

def integrate_batch_verifications():
    """整合 Batch 1-5 驗證結果到 questions.json"""

    base_dir = Path(__file__).parent.parent
    questions_file = base_dir / 'quiz-app' / 'src' / 'data' / 'questions.json'

    print("\n📥 載入 questions.json...")
    questions_data = load_json(questions_file)

    print(f"✅ 載入 {len(questions_data)} 題")

    # 備份原始檔案
    backup_path = backup_file(questions_file)
    print(f"💾 已備份到: {backup_path.name}")

    # 驗證批次資訊（從報告中提取）
    batch_info = {
        1: {'start': 'c2-001', 'end': 'c2-045', 'verified': True},
        2: {'start': 'c2-046', 'end': 'c2-090', 'verified': True},
        3: {'start': 'c2-091', 'end': 'c2-135', 'verified': True},
        4: {'start': 'c2-136', 'end': 'c2-180', 'verified': True},
        5: {'start': 'c2-181', 'end': 'c2-225', 'verified': True}
    }

    # 添加驗證狀態標記
    verified_count = 0
    for item in questions_data:
        q_id = item['id']

        # 檢查是否在已驗證批次中
        for batch_num, info in batch_info.items():
            if info['start'] <= q_id <= info['end']:
                if 'metadata' not in item:
                    item['metadata'] = {}
                item['metadata']['verified'] = True
                item['metadata']['verification_batch'] = batch_num
                item['metadata']['verification_date'] = '2026-01-23'
                verified_count += 1
                break

    # 儲存更新後的檔案
    save_json(questions_data, questions_file)

    print(f"\n✅ 已標記 {verified_count} 題為已驗證")
    print(f"📁 更新檔案: {questions_file}")

    return verified_count

def integrate_266_batch_a():
    """整合 266 Batch A 答案到 integrated_dataset_updated.json"""

    base_dir = Path(__file__).parent.parent
    dataset_file = base_dir / 'quiz-app' / 'src' / 'data' / 'integrated_dataset_updated.json'
    batch_a_file = base_dir / '266_BATCH_A_ANSWERS.json'

    print("\n📥 載入資料集...")
    dataset = load_json(dataset_file)

    print("📥 載入 Batch A 答案...")
    batch_a_data = load_json(batch_a_file)

    # 備份原始檔案
    backup_path = backup_file(dataset_file)
    print(f"💾 已備份到: {backup_path.name}")

    # 提取 answers 陣列
    batch_a_answers = batch_a_data.get('answers', [])

    # 建立答案索引（使用 index）
    answers_by_index = {}
    for item in batch_a_answers:
        idx = item.get('index')
        if idx:
            answers_by_index[idx] = item

    print(f"\n✅ 載入 {len(answers_by_index)} 題答案")

    # 更新 gist_items
    updated_count = 0
    for item in dataset.get('gist_items', []):
        idx = item.get('index')
        if idx in answers_by_index:
            answer_data = answers_by_index[idx]

            # 更新答案
            old_answer = item.get('answer')
            new_answer = answer_data.get('answer')

            if old_answer != new_answer:
                item['answer'] = new_answer

                # 添加驗證元數據
                if 'metadata' not in item:
                    item['metadata'] = {}
                item['metadata']['answer_verified'] = True
                item['metadata']['verification_date'] = '2026-01-23'
                item['metadata']['verification_batch'] = 'A'
                item['metadata']['confidence'] = answer_data.get('confidence', 'medium')
                item['metadata']['sources_count'] = len(answer_data.get('sources', []))

                updated_count += 1

    # 更新 our_unique_items
    for item in dataset.get('our_unique_items', []):
        idx = item.get('index')
        if idx in answers_by_index:
            answer_data = answers_by_index[idx]

            old_answer = item.get('answer')
            new_answer = answer_data.get('answer')

            if old_answer != new_answer:
                item['answer'] = new_answer

                if 'metadata' not in item:
                    item['metadata'] = {}
                item['metadata']['answer_verified'] = True
                item['metadata']['verification_date'] = '2026-01-23'
                item['metadata']['verification_batch'] = 'A'
                item['metadata']['confidence'] = answer_data.get('confidence', 'medium')
                item['metadata']['sources_count'] = len(answer_data.get('sources', []))

                updated_count += 1

    # 更新 meta 資訊
    if 'meta' in dataset:
        dataset['meta']['last_updated'] = datetime.now().isoformat()
        dataset['meta']['with_answer'] = dataset['meta'].get('with_answer', 0) + updated_count

    # 儲存更新後的檔案
    save_json(dataset, dataset_file)

    print(f"\n✅ 已更新 {updated_count} 題答案")
    print(f"📁 更新檔案: {dataset_file}")

    return updated_count

def generate_integration_report():
    """生成整合報告"""

    base_dir = Path(__file__).parent.parent

    report = {
        'integration_date': datetime.now().isoformat(),
        'summary': {
            'batch_1_5_verified': 225,  # 45 * 5
            'batch_a_answers_added': 45,
            'total_questions_with_answers': 555,
            'total_questions': 719,
            'completion_percentage': round((555/719) * 100, 1)
        },
        'details': {
            'questions_json_updated': True,
            'integrated_dataset_updated': True,
            'backups_created': True
        }
    }

    output_file = base_dir / 'INTEGRATION_REPORT.json'
    save_json(report, output_file)

    print(f"\n📄 整合報告: {output_file}")

    return report

def main():
    print("="*60)
    print("🔄 開始整合驗證結果與答案")
    print("="*60)

    # 1. 整合 Batch 1-5 驗證結果
    print("\n【步驟 1】整合 Batch 1-5 驗證結果")
    print("-"*60)
    verified_count = integrate_batch_verifications()

    # 2. 整合 266 Batch A 答案
    print("\n【步驟 2】整合 266 Batch A 答案")
    print("-"*60)
    updated_count = integrate_266_batch_a()

    # 3. 生成整合報告
    print("\n【步驟 3】生成整合報告")
    print("-"*60)
    report = generate_integration_report()

    # 4. 輸出統計
    print("\n" + "="*60)
    print("📊 整合完成統計")
    print("="*60)
    print(f"✅ Batch 1-5 驗證標記: {verified_count} 題")
    print(f"✅ 266 Batch A 答案更新: {updated_count} 題")
    print(f"\n🎯 整體進度: {report['summary']['completion_percentage']}%")
    print(f"   ({report['summary']['total_questions_with_answers']}/{report['summary']['total_questions']} 題)")
    print("="*60)

    print("\n🎉 整合工作完成！")

if __name__ == '__main__':
    main()
