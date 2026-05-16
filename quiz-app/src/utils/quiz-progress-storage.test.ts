// Quiz progress storage 單元測試
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  saveProgress,
  loadProgress,
  clearProgress,
  formatRelativeTime,
} from './quiz-progress-storage';
import type { QuizState } from '../hooks/useQuiz';

const STORAGE_KEY = 'ipas-quiz-in-progress';

// test-setup.ts mock 了 localStorage 為 vi.fn()（getItem 回 undefined）；
// 此檔需真實 localStorage 行為（與 HomePage.test.tsx 同 pattern）
function installRealLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        store.set(k, v);
      },
      removeItem: (k: string): void => {
        store.delete(k);
      },
      clear: (): void => {
        store.clear();
      },
      key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
      get length(): number {
        return store.size;
      },
    },
    writable: true,
    configurable: true,
  });
}

beforeAll(() => {
  installRealLocalStorage();
});

// 使用真實 shape 的 config + questions 才能通過新加深的 isValidPayload 檢查
// （isActive=true 時要求 startTime: number、config: object、currentIndex 在 questions 範圍內）
const fakeConfig: QuizState['config'] = {
  mode: 'practice',
  subject: 'all',
  questionCount: 10,
  shuffleQuestions: false,
  shuffleOptions: false,
  showAnswerImmediately: true,
};
const fakeQuestions = Array.from({ length: 10 }, (_, i) => ({
  id: `q-${i}`,
  stem: `題目 ${i}`,
  options: [],
  answer: null,
  subject: '考科1',
})) as unknown as QuizState['questions'];

function makeState(overrides: Partial<QuizState> = {}): QuizState {
  return {
    isActive: true,
    questions: fakeQuestions,
    currentIndex: 0,
    answers: [],
    startTime: Date.now(),
    config: fakeConfig,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('quiz-progress-storage', () => {
  describe('saveProgress', () => {
    it('isActive=true 時寫入 localStorage', () => {
      saveProgress(makeState({ isActive: true }));
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });

    it('isActive=false 時 no-op（不覆寫既有資料）', () => {
      saveProgress(makeState({ isActive: true, currentIndex: 3 }));
      const before = localStorage.getItem(STORAGE_KEY);
      saveProgress(makeState({ isActive: false }));
      expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    });

    it('payload 含 version + savedAt + state', () => {
      saveProgress(makeState());
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = JSON.parse(raw!);
      expect(parsed.version).toBe(1);
      expect(typeof parsed.savedAt).toBe('number');
      expect(parsed.state).toBeDefined();
    });
  });

  describe('loadProgress', () => {
    it('無資料時回 null', () => {
      expect(loadProgress()).toBeNull();
    });

    it('合法資料正確載入', () => {
      const state = makeState({ currentIndex: 5 });
      saveProgress(state);
      const loaded = loadProgress();
      expect(loaded?.state.currentIndex).toBe(5);
      expect(loaded?.version).toBe(1);
    });

    it('壞掉的 JSON 回 null 不 throw', () => {
      localStorage.setItem(STORAGE_KEY, 'not-json{{{');
      expect(loadProgress()).toBeNull();
    });

    it('shape 不符（version 不對）回 null 並清掉', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 999, savedAt: 0, state: {} })
      );
      expect(loadProgress()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('缺欄位（無 state.questions）回 null 並清掉', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, savedAt: 0, state: { isActive: true } })
      );
      expect(loadProgress()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('clearProgress', () => {
    it('清掉既有資料', () => {
      saveProgress(makeState());
      clearProgress();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('無資料時 idempotent 不 throw', () => {
      expect(() => clearProgress()).not.toThrow();
    });
  });

  describe('formatRelativeTime', () => {
    const NOW = 1_700_000_000_000;

    it('< 1 分鐘 → 剛才', () => {
      expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('剛才');
    });

    it('1–59 分鐘', () => {
      expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分鐘前');
      expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59 分鐘前');
    });

    it('1–23 小時', () => {
      expect(formatRelativeTime(NOW - 3 * 60 * 60_000, NOW)).toBe('3 小時前');
    });

    it('≥ 24 小時 → N 天前', () => {
      expect(formatRelativeTime(NOW - 2 * 24 * 60 * 60_000, NOW)).toBe('2 天前');
    });

    it('未來時間（時鐘 skew）clamp 為 0', () => {
      expect(formatRelativeTime(NOW + 5000, NOW)).toBe('剛才');
    });
  });
});
