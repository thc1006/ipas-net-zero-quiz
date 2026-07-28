// Quiz progress storage 單元測試
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  saveProgress,
  loadProgress,
  clearProgress,
  formatRelativeTime,
} from './quiz-progress-storage';
import type { QuizState } from '../hooks/useQuiz';
import { allQuestions } from '../data/questions';

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
      expect(parsed.version).toBe(2);
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
      expect(loaded?.version).toBe(2);
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

  // #106：主題庫題最小化為 id、練習池題保留完整物件；載入時重建。
  describe('最小化持久化（#106）', () => {
    it('主題庫題目序列化為 id 字串，載入後由題庫重建完整內容', () => {
      const realQ = allQuestions[0];
      saveProgress(
        makeState({
          questions: [realQ] as QuizState['questions'],
          currentIndex: 0,
        })
      );
      // localStorage 內只存 id 字串（payload 最小化，不含 stem/options/...）
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(parsed.state.questions[0]).toBe(realQ.id);
      // 載入後重建為與題庫一致的完整題目
      const loaded = loadProgress();
      expect(loaded?.state.questions[0]).toEqual(realQ);
    });

    it('非主題庫題目（id 不在題庫，如練習池）保留完整物件', () => {
      saveProgress(makeState()); // fakeQuestions：id q-0..q-9 不在題庫
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(typeof parsed.state.questions[0]).toBe('object');
      expect(parsed.state.questions[0].id).toBe('q-0');
      // 載入後物件原樣返回
      const loaded = loadProgress();
      expect(loaded?.state.questions[0].id).toBe('q-0');
    });

    it('混合題組：主題庫題存 id、其餘存物件，載入後題數與內容都正確', () => {
      const realQ = allQuestions[0];
      const poolQ = fakeQuestions[0]; // id q-0，不在題庫
      saveProgress(
        makeState({
          questions: [realQ, poolQ] as QuizState['questions'],
          currentIndex: 1,
        })
      );
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(parsed.state.questions[0]).toBe(realQ.id); // 主題庫 → 字串
      expect(typeof parsed.state.questions[1]).toBe('object'); // 練習池 → 物件
      const loaded = loadProgress();
      expect(loaded?.state.questions).toHaveLength(2);
      expect(loaded?.state.questions[0]).toEqual(realQ);
      expect(loaded?.state.questions[1].id).toBe('q-0');
      expect(loaded?.state.currentIndex).toBe(1);
    });

    it('v2 payload 內 id 已從題庫移除 → 放棄 resume（回 null 並清掉）', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          savedAt: 0,
          state: {
            isActive: true,
            questions: ['__id_that_does_not_exist__'],
            currentIndex: 0,
            answers: [],
            startTime: 123,
            config: fakeConfig,
          },
        })
      );
      expect(loadProgress()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('payload 內含非法題目元素（null）→ 放棄 resume（回 null 並清掉）', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          savedAt: 0,
          state: {
            isActive: true,
            questions: [null],
            currentIndex: 0,
            answers: [],
            startTime: 123,
            config: fakeConfig,
          },
        })
      );
      expect(loadProgress()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('v2 payload 重建成功但 currentIndex 越界 → 語意檢查在重建後擋下（回 null 並清掉）', () => {
      // 拆分 isValidEnvelope / isValidState 的重點：語意檢查必須跑在**重建後**的完整
      // state 上。此案 id 可重建（1 題）但 currentIndex 越界，須被 isValidState 擋下。
      const realQ = allQuestions[0];
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          savedAt: 0,
          state: {
            isActive: true,
            questions: [realQ.id], // 可重建
            currentIndex: 5, // 但越界（>= 1）
            answers: [],
            startTime: 123,
            config: fakeConfig,
          },
        })
      );
      expect(loadProgress()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('answers 含非法元素（null）→ 擋下（回 null 並清掉，避免 finishQuiz 對 null 取值 crash）', () => {
      const realQ = allQuestions[0];
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          savedAt: 0,
          state: {
            isActive: true,
            questions: [realQ.id], // 題目可正常重建
            currentIndex: 0,
            answers: [null], // 但 answers 有 null 元素
            startTime: 123,
            config: fakeConfig,
          },
        })
      );
      expect(loadProgress()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('v1（全物件）payload 仍可載入（向後相容）', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          savedAt: 0,
          state: makeState({ currentIndex: 2 }),
        })
      );
      const loaded = loadProgress();
      expect(loaded?.version).toBe(1);
      expect(loaded?.state.currentIndex).toBe(2);
      expect(loaded?.state.questions).toHaveLength(10);
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
