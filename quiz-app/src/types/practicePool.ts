// 加強練習池（practice pool）型別
// 對應 src/data/practice_pool.json 的 schema
// 此池獨立於主題庫；只在使用者明確開啟「加強練習」模式時提供。

import type { QuizOption, ExamSubject } from './quiz';

/** 來源類型：external_mock 為第三方公開模擬題、ai_generated 為 LLM 代理產生 */
export type PracticePoolSourceType = 'external_mock' | 'ai_generated';

/** 題目難度（代理估算） */
export type PracticePoolDifficulty = 'easy' | 'medium' | 'hard';

/** 驗證代理結論 */
export type PracticePoolVerdict =
  | 'CONFIRMED'
  | 'AMBIGUOUS'
  | 'TIME_SENSITIVE'
  | 'OUTDATED_SOURCE'
  | 'HALLUCINATED'
  | 'REFUTED'
  | 'DUPLICATE';

/** AI 產題時的模型與生成資訊（用於合規揭露 / 審計） */
export interface AIMetadata {
  /** 若模型身份未確認，使用 'unspecified' */
  model_family: string;
  generation_date: string;
  /** 1 = 第一輪原始產題；2 = 經人工/代理重寫 */
  verifier_round: number;
}

/** 共用 provenance 欄位 */
interface ProvenanceBase {
  /** 來源批次識別（vocus_hackmd_yamol、industry_round1 等） */
  source_origin: string;
  /** YYYY-MM-DD */
  verified_date: string;
  verifier: string;
  verify_verdict: PracticePoolVerdict;
  /**
   * 曾經下過、之後被推翻的結論。
   *
   * 為什麼要留：verify_verdict 被降級（例如 CONFIRMED -> AMBIGUOUS）時，如果直接覆寫，
   * 就看不出「這題曾被判定為已確認」這件事，也看不出我們的驗證流程曾經誤判。
   * 保留它，下一輪 review 才知道這裡出過錯、不要再照抄同一個結論。
   */
  prior_verify_verdict?: PracticePoolVerdict;
  /** 上游檔的原始 ID（如有） */
  original_id: string;
}

/** Discriminated union — ai_generated 強制帶 ai_metadata */
export type PracticePoolProvenance =
  | (ProvenanceBase & { source_type: 'external_mock' })
  | (ProvenanceBase & {
      source_type: 'ai_generated';
      ai_metadata: AIMetadata;
    });

/**
 * 提示型旗標：內容有需要留意之處，但答案仍站得住 —— **照常計分**，UI 出徽章提醒。
 */
export const ADVISORY_QUALITY_FLAGS = [
  'time_sensitive',
  'low_confidence',
  'duplicate_topic',
] as const;

/**
 * 失效型旗標：這題目前給不出唯一且站得住的答案 —— **一律不計分**（見 utils/scorable.ts）。
 *
 * 這份清單同時是資料檔的合法值與計分的阻斷條件，兩者必須是同一份 ——
 * 先前 schema 白名單只認 4 個旗標，而 scorable 阻斷 6 個，交集只有 ambiguous。
 * 結果是：照著「標上旗標就自動離開計分池」去標 disputed，schema 會判該題非法、CI 直接紅。
 */
export const BLOCKING_QUALITY_FLAGS = [
  'ambiguous',
  'disputed',
  'disputed_answer',
  'multiple_correct',
  'unverifiable_evidence',
  'retired',
] as const;

/** 資料檔（practice_pool.json / integrated_dataset.json）裡可以出現的旗標 */
export const DATA_QUALITY_FLAGS = [
  ...ADVISORY_QUALITY_FLAGS,
  ...BLOCKING_QUALITY_FLAGS,
] as const;
export type DataQualityFlag = (typeof DATA_QUALITY_FLAGS)[number];

/**
 * 只在 runtime 產生、資料檔不會有的旗標。
 * subject 無法明確映射時由 toQuizQuestion 注入；filter 時可排除。
 */
export type RuntimeOnlyQualityFlag = 'unmapped_subject';

/** UI 渲染徽章用的 quality flags（資料檔的 + runtime 才有的） */
export type PracticePoolQualityFlag = DataQualityFlag | RuntimeOnlyQualityFlag;

/** 練習池 subject 可能值：official ExamSubject、自由字串（如 vocus 講師原文「考科一：…」）、或 null（無分類） */
export type PracticePoolSubject = ExamSubject | string | null;

/** 加強練習單題 */
export interface PracticePoolItem {
  id: string;
  stem: string;
  options: QuizOption[];
  answer: string | null;
  explanation: string;
  /** 考科類別；toQuizQuestion 會嘗試映射，無法映射時於 qualityFlags 加 unmapped_subject */
  subject: PracticePoolSubject;
  topic_tags: string[];
  difficulty: PracticePoolDifficulty;
  provenance: PracticePoolProvenance;
  /** Curl 實測通過的引用 URL */
  sources: string[];
  /** 資料檔旗標；runtime-only 的 unmapped_subject 不會出現在這裡 */
  quality_flags: DataQualityFlag[];
}

/** 練習池檔案頂層 */
export interface PracticePool {
  _meta: {
    version: string;
    generated_at: string;
    description: string;
    source_types: PracticePoolSourceType[];
    compliance: {
      eu_ai_act_art50_effective: string;
      ai_generated_disclosure: string;
    };
    totals: {
      external_mock: number;
      ai_generated: number;
      total: number;
    };
    policy: string;
  };
  items: PracticePoolItem[];
}
