#!/usr/bin/env python3
"""
題庫更新腳本

功能：根據驗證結果自動更新 questions.json
"""

import json
from pathlib import Path
from typing import Dict, List, Any

# 專案路徑
PROJECT_ROOT = Path(__file__).parent.parent
QUESTIONS_FILE = PROJECT_ROOT / "quiz-app" / "src" / "data" / "questions.json"
CORRECTIONS_FILE = PROJECT_ROOT / "verification-output" / "CORRECTIONS.json"
BACKUP_DIR = PROJECT_ROOT / "backups"


def load_corrections() -> Dict[str, Any]:
    """讀取修正清單"""
    if not CORRECTIONS_FILE.exists():
        print(f"⚠️  修正清單不存在: {CORRECTIONS_FILE}")
        return {}

    with open(CORRECTIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def load_questions() -> List[Dict[str, Any]]:
    """讀取原始題庫"""
    with open(QUESTIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def backup_questions():
    """備份原始題庫"""
    from datetime import datetime

    BACKUP_DIR.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = BACKUP_DIR / f"questions_backup_{timestamp}.json"

    with open(QUESTIONS_FILE, "r", encoding="utf-8") as src:
        with open(backup_file, "w", encoding="utf-8") as dst:
            dst.write(src.read())

    print(f"✅ 已備份原始題庫: {backup_file}")
    return backup_file


def apply_corrections(questions: List[Dict], corrections: Dict) -> List[Dict]:
    """應用修正到題庫"""
    updated_count = 0

    for q_id, updates in corrections.items():
        # 查找對應題目
        for q in questions:
            if q.get("id") == q_id:
                # 應用修正
                if "options" in updates:
                    q["options"].update(updates["options"])
                if "answer" in updates:
                    q["answer"] = updates["answer"]
                if "explanation" in updates:
                    q["explanation"] = updates["explanation"]
                if "explanation_append" in updates:
                    q["explanation"] += "\n" + updates["explanation_append"]

                # 添加驗證標記
                if "verified_at" not in q:
                    q["verified_at"] = {}
                q["verified_at"]["correction_applied"] = True

                updated_count += 1
                print(f"  ✏️  已修正: {q_id}")
                break

    return questions, updated_count


def validate_json(questions: List[Dict]) -> bool:
    """驗證 JSON 結構完整性"""
    required_fields = {"id", "subject", "question", "options", "answer", "explanation"}

    for q in questions:
        if not required_fields.issubset(set(q.keys())):
            print(f"❌ 題目 {q.get('id')} 缺少必要欄位")
            return False

        # 驗證選項
        if not isinstance(q["options"], dict) or len(q["options"]) != 4:
            print(f"❌ 題目 {q.get('id')} 選項格式錯誤")
            return False

        # 驗證答案
        if q["answer"] not in q["options"]:
            print(f"❌ 題目 {q.get('id')} 答案選項不存在")
            return False

    return True


def save_updated_questions(questions: List[Dict]):
    """保存更新後的題庫"""
    with open(QUESTIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)
    print(f"✅ 已保存更新題庫: {QUESTIONS_FILE}")


def main():
    """主程式"""
    print("🔄 開始更新題庫...")

    # 備份原始題庫
    backup_questions()

    # 讀取修正清單
    corrections = load_corrections()
    if not corrections:
        print("ℹ️  沒有修正項目，略過")
        return

    # 讀取題庫
    questions = load_questions()
    print(f"📚 已讀取 {len(questions)} 題")

    # 應用修正
    print("\n📝 應用修正:")
    questions, updated_count = apply_corrections(questions, corrections)

    # 驗證結構
    print("\n✓ 驗證結構完整性...")
    if not validate_json(questions):
        print("❌ 驗證失敗，中止更新")
        return

    # 保存更新
    save_updated_questions(questions)

    print(f"\n✅ 更新完成 (共修正 {updated_count} 題)")


if __name__ == "__main__":
    main()
