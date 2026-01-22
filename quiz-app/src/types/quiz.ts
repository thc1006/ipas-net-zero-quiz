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
}

/** 統一的題目格式（用於測驗邏輯） */
export interface QuizQuestion {
  id: string;
  stem: string;
  options: QuizOption[];
  answer: string | null;
  subject: ExamSubject;
  sourceType: 'gist' | 'unique';
  year?: number | null;
  hasAnswer: boolean;
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
  showAnswerImmediately: boolean;
}

/** 答題紀錄 */
export interface AnswerRecord {
  questionId: string;
  selectedAnswer: string | null;
  correctAnswer: string | null;
  isCorrect: boolean | null;
  timeSpent: number;
  timestamp: number;
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
