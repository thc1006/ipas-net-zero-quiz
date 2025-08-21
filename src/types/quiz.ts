export interface QuizQuestion {
  id: string;
  subject: string;
  question: string;
  options: {
    A: string;
    B: string;
    C: string;
    D: string;
  };
  answer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
}

export interface QuizAnswer {
  questionId: string;
  selectedOption: 'A' | 'B' | 'C' | 'D';
  isCorrect: boolean;
  timeSpent?: number;
}

export interface QuizResults {
  totalQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  score: number;
  answers: QuizAnswer[];
  subjects: Record<string, { correct: number; total: number }>;
}

export type QuizMode = 'quiz' | 'review' | 'results';