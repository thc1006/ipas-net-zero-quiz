// 題庫資料型別定義
// 對應 data/out/integrated_dataset.json 結構

import type { PracticePoolQualityFlag } from './practicePool';

/** 選項 */
export interface QuizOption {
  key: 'A' | 'B' | 'C' | 'D';
  text: string;
}

/**
 * 主庫題目共用 metadata（PR #68 加 sources + sources_verified_date；
 * Refs #69 — 改為明列欄位、移除 `[k: string]: unknown` 索引簽章使型別更嚴）
 */
export interface MainBankItemMetadata {
  answer_verified?: boolean;
  verification_date?: string;
  verification_source?: string;
  original_id?: string;
  confidence?: string;
  /** 該題對應的 primary-source URL 陣列（PR #68 起寫入；季度 workflow 會 curl 驗） */
  sources?: string[];
  /** sources 上次 curl 驗 200 OK 的日期（YYYY-MM-DD） */
  sources_verified_date?: string;
}

/** 來源資訊 */
export interface QuizSource {
  source_id?: string;
  url?: string;
  publisher?: string;
  authority?: string;
  evidence?: {
    page?: number;
    quote?: string;
  };
}

/** 考科分類 */
export type ExamSubject = '考科1' | '考科2';

/** Gist 題目格式 */
export interface GistQuestion {
  index: number;
  number: number;
  stem: string;
  options: QuizOption[];
  answer: string | null;
  source: string;
  original_section: string;
  exam_subject: ExamSubject;
  explanation?: string;
  /** 品質旗標（PR #68 起部分主庫題目寫入 'time_sensitive' 等；Refs #69） */
  quality_flags?: PracticePoolQualityFlag[];
  metadata?: MainBankItemMetadata;
}

/** 補充題目格式 */
export interface UniqueQuestion {
  item_id: string;
  year: number | null;
  year_confidence?: string;
  credential?: string;
  level?: string | null;
  topic_tags?: string[];
  question_type?: string;
  stem: string;
  options: QuizOption[];
  answer: string | null;
  explanation?: string | null;
  source?: QuizSource;
  alt_sources?: string[];
  evidence_quote?: string;
  notes?: string;
  exam_subject: ExamSubject;
  subject_confidence?: number;
  _quality_score?: number;
  /** 品質旗標（PR #68 起部分主庫題目寫入 'time_sensitive' 等；Refs #69） */
  quality_flags?: PracticePoolQualityFlag[];
  metadata?: MainBankItemMetadata;
}

/** 統一的題目格式（用於測驗邏輯） */
export interface QuizQuestion {
  id: string;
  stem: string;
  options: QuizOption[];
  answer: string | null;
  subject: ExamSubject;
  sourceType: 'gist' | 'unique' | 'practice_pool';
  year?: number | null;
  hasAnswer: boolean;
  /** Curl 實測通過的引用 URL（來自 metadata.sources），UI 渲染為「參考來源」 */
  sources?: string[];
  /** 解析文字（給 AI helper 與 UI 參考），可能為空 */
  explanation?: string | null;
  /** 練習池題目專屬：UI 用以渲染來源徽章；主題庫題不帶 */
  provenance?: {
    source_type: 'external_mock' | 'ai_generated';
    source_origin?: string;
    verified_date?: string;
    verify_verdict?: string;
  };
  /** 練習池題目品質旗標（時效 / 爭議 / 低信心 / 等） */
  qualityFlags?: PracticePoolQualityFlag[];
}

/** 題庫資料集 */
export interface QuizDataset {
  meta: {
    title: string;
    generated_at: string;
    sources: string[];
    total_questions: number;
    gist_questions: number;
    our_unique_questions: number;
    corrections_applied: number;
    by_subject: {
      考科1: number;
      考科2: number;
    };
    with_answer: number;
  };
  gist_items: GistQuestion[];
  our_unique_items: UniqueQuestion[];
}

/** 測驗模式 */
export type QuizMode = 'practice' | 'exam' | 'review';

/** 測驗配置 */
export interface QuizConfig {
  mode: QuizMode;
  subject: ExamSubject | 'all';
  questionCount: number;
  shuffleQuestions: boolean;
  // shuffleOptions 已移除（2026-07）。它是一段**不可達、零測試、而且啟用會壞掉**的死碼：
  //   - HomePage 從來沒有它的開關，預設 false，**沒有任何使用者能打開它**
  //   - 每一個測試都寫死 shuffleOptions: false，`true` 那條分支一行都沒跑過
  //   - 它洗的是 {key,text} 物件陣列，但 QuestionCard 直接印 option.key 當字母
  //     —— 真的啟用，畫面會變成「C. … A. … D. … B. …」
  //
  // 而且它本來也不該存在：主題庫是從來源 PDF 分欄重建的，選項順序有證據鏈
  // （--verify 逐題比對），執行期洗牌會讓畫面上的題目與已驗證的來源不一致。
  // 練習池原本的答案偏斜（永遠選 B 得 60 分）已在資料層重排解決（χ²=0.02）。
  /** 是否將加強練習池題目混入抽題範圍（須使用者已 opt-in） */
  includePracticePool?: boolean;
  showAnswerImmediately: boolean;
}

/** 答題來源分類 — ResultPage 用來分組統計，主題庫 vs 模擬 vs AI 產題 */
export type AnswerSourceCategory = 'main_bank' | 'external_mock' | 'ai_generated';

/** 答題紀錄 */
export interface AnswerRecord {
  questionId: string;
  selectedAnswer: string | null;
  correctAnswer: string | null;
  isCorrect: boolean | null;
  timeSpent: number;
  timestamp: number;
  /**
   * 題目來源分類（記錄當下從題目推導，避免 ResultPage 反查時找不到 pool 題目）
   * 'main_bank' = 主題庫；'external_mock' / 'ai_generated' = 練習池
   */
  sourceCategory?: AnswerSourceCategory;
}

/** 測驗結果 */
export interface QuizResult {
  config: QuizConfig;
  startTime: number;
  endTime: number;
  totalTime: number;
  answers: AnswerRecord[];
  score: number;
  totalAnswerable: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
}

/** 無障礙設定 */
export interface AccessibilitySettings {
  darkMode: boolean;
  highContrast: boolean;
  cvdMode: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  fontSize: 'normal' | 'large' | 'xlarge';
}

/** 應用程式狀態 */
export interface AppState {
  currentView: 'home' | 'quiz' | 'result' | 'settings';
  quizConfig: QuizConfig | null;
  currentQuestionIndex: number;
  answers: AnswerRecord[];
  quizResult: QuizResult | null;
  accessibility: AccessibilitySettings;
}
