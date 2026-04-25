// 題庫資料型別定義
// 對應 data/out/integrated_dataset.json 結構

/** 選項 */
export interface QuizOption {
  key: 'A' | 'B' | 'C' | 'D';
  text: string;
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
  metadata?: {
    sources?: string[];
    sources_verified_date?: string;
    [k: string]: unknown;
  };
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
  metadata?: {
    sources?: string[];
    sources_verified_date?: string;
    [k: string]: unknown;
  };
}

/** 注意：此處用 type-only import 避免循環依賴 */
import type { PracticePoolQualityFlag } from './practicePool';

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
  shuffleOptions: boolean;
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
