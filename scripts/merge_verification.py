#!/usr/bin/env python3
"""
淨零碳排放驗證結果整合腳本

功能：將多個 Batch 驗證結果合併，生成統一的驗證矩陣
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Any
from datetime import datetime

# 專案根目錄
PROJECT_ROOT = Path(__file__).parent.parent
VERIFICATION_OUTPUT_DIR = PROJECT_ROOT / "verification-output"
QUESTIONS_DATA_DIR = PROJECT_ROOT / "quiz-app" / "src" / "data"


def load_batch_results(batch_num: int) -> Dict[str, Any]:
    """讀取指定 Batch 的驗證結果"""
    batch_file = VERIFICATION_OUTPUT_DIR / f"BATCH_{batch_num}_RESULTS.json"

    if not batch_file.exists():
        print(f"警告: {batch_file} 不存在")
        return {}

    with open(batch_file, "r", encoding="utf-8") as f:
        return json.load(f)


def merge_all_batches() -> Dict[str, Any]:
    """合併所有 Batch 的驗證結果"""
    merged_data = {
        "timestamp": datetime.now().isoformat(),
        "batches": {},
        "summary": {
            "total_verified": 0,
            "total_correct": 0,
            "total_questionable": 0,
            "total_errors": 0,
            "correct_rate": 0.0,
        },
        "issues": [],
    }

    # 遍歷所有 6 個 Batch
    for batch_num in range(1, 7):
        batch_data = load_batch_results(batch_num)
        if batch_data:
            merged_data["batches"][f"batch_{batch_num}"] = batch_data

            # 累計統計數字
            verified = batch_data.get("verified", [])
            questionable = batch_data.get("questionable", [])
            errors = batch_data.get("errors", [])

            merged_data["summary"]["total_verified"] += len(verified)
            merged_data["summary"]["total_correct"] += len(verified)
            merged_data["summary"]["total_questionable"] += len(questionable)
            merged_data["summary"]["total_errors"] += len(errors)

            # 收集所有問題
            merged_data["issues"].extend(errors)
            merged_data["issues"].extend(
                [{"type": "questionable", "data": item} for item in questionable]
            )

    # 計算正確率
    total = merged_data["summary"]["total_verified"]
    if total > 0:
        correct = merged_data["summary"]["total_correct"]
        merged_data["summary"]["correct_rate"] = round(100 * correct / total, 2)

    return merged_data


def generate_verification_matrix() -> List[Dict[str, Any]]:
    """生成驗證矩陣 (用於匯出 CSV/JSON)"""
    matrix = []

    for batch_num in range(1, 7):
        batch_data = load_batch_results(batch_num)
        if not batch_data:
            continue

        # 取得該 Batch 的題號範圍
        start_id = (batch_num - 1) * 45 + 1
        batch_start = f"c2-{start_id:03d}"

        verified = batch_data.get("verified", [])
        for item in verified:
            matrix.append({
                "question_id": item.get("id"),
                "batch": batch_num,
                "status": "✅ 確認正確",
                "confidence": "🟢 高",
                "sources_count": len(item.get("sources", [])),
                "notes": item.get("notes", ""),
            })

        questionable = batch_data.get("questionable", [])
        for item in questionable:
            matrix.append({
                "question_id": item.get("id"),
                "batch": batch_num,
                "status": "⚠️ 需澄清",
                "confidence": "🟡 中",
                "sources_count": len(item.get("sources", [])),
                "notes": item.get("recommendation", ""),
            })

        errors = batch_data.get("errors", [])
        for item in errors:
            matrix.append({
                "question_id": item.get("id"),
                "batch": batch_num,
                "status": "❌ 有誤",
                "confidence": "🔴 低",
                "sources_count": 0,
                "notes": item.get("correction", ""),
            })

    return matrix


def save_merged_results(merged_data: Dict[str, Any]):
    """保存合併結果"""
    # 確保輸出目錄存在
    VERIFICATION_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 保存完整的合併 JSON
    output_file = VERIFICATION_OUTPUT_DIR / "VERIFICATION_MERGED_RESULTS.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(merged_data, f, ensure_ascii=False, indent=2)
    print(f"✅ 已保存合併結果: {output_file}")

    # 保存驗證矩陣
    matrix = generate_verification_matrix()
    matrix_file = VERIFICATION_OUTPUT_DIR / "VERIFICATION_MATRIX.json"
    with open(matrix_file, "w", encoding="utf-8") as f:
        json.dump(matrix, f, ensure_ascii=False, indent=2)
    print(f"✅ 已保存驗證矩陣: {matrix_file}")

    # 保存簡化的統計
    stats_file = VERIFICATION_OUTPUT_DIR / "VERIFICATION_STATS.json"
    with open(stats_file, "w", encoding="utf-8") as f:
        json.dump(merged_data["summary"], f, ensure_ascii=False, indent=2)
    print(f"✅ 已保存統計資訊: {stats_file}")


def main():
    """主程式"""
    print("🔄 開始合併所有 Batch 驗證結果...")

    merged_data = merge_all_batches()
    save_merged_results(merged_data)

    # 輸出摘要
    print("\n📊 驗證結果摘要:")
    print(f"  - 總驗證題數: {merged_data['summary']['total_verified']}")
    print(f"  - 確認正確: {merged_data['summary']['total_correct']}")
    print(f"  - 需要澄清: {merged_data['summary']['total_questionable']}")
    print(f"  - 確認有誤: {merged_data['summary']['total_errors']}")
    print(f"  - 正確率: {merged_data['summary']['correct_rate']}%")

    if merged_data["issues"]:
        print(f"\n⚠️  發現 {len(merged_data['issues'])} 個需要處理的項目")
    else:
        print("\n✅ 全部題目驗證無誤")


if __name__ == "__main__":
    main()
