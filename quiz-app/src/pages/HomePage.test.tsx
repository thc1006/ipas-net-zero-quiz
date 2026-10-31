// HomePage component test — practice mode indicator + start callback
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { HomePage } from './HomePage';
import { allQuestions, getSourceCandidates } from '../data/questions';
import { officialSessions, sampleEditions } from '../utils/question-source';

// 現有資料每個考科、每一場都有官方題，「範圍內一題都沒有」只能讓抽題範圍落空來測。
// 預設照常回傳（其他測試不受影響），sourceEmpty.value 為 true 時才回傳空陣列；sourceLimit.value 是數字時
// 只回傳前幾題（範圍很小的情境，真資料最小的範圍也有 48 題）。
const sourceEmpty = vi.hoisted(() => ({ value: false }));
const sourceLimit = vi.hoisted(() => ({ value: null as number | null }));
vi.mock('../data/questions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/questions')>();
  return {
    ...actual,
    getSourceCandidates: (...args: Parameters<typeof actual.getSourceCandidates>) => {
      if (sourceEmpty.value) return [];
      const picked = actual.getSourceCandidates(...args);
      return sourceLimit.value === null ? picked : picked.slice(0, sourceLimit.value);
    },
  };
});


// 還原真實 localStorage 行為（test-setup.ts 把它 mock 成空函式）
function installRealLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => { store.set(k, v); },
      removeItem: (k: string): void => { store.delete(k); },
      clear: (): void => { store.clear(); },
      key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
      get length(): number { return store.size; },
    },
    writable: true,
    configurable: true,
  });
}

beforeAll(() => { installRealLocalStorage(); });

afterEach(() => {
  cleanup();
  localStorage.clear();
  sourceEmpty.value = false;
  sourceLimit.value = null;
});

describe('HomePage', () => {
  it('renders title and stats badges', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.getByText(/淨零碳備考神器/)).toBeInTheDocument();
    // 考科一 / 考科二 出現多次（select option + badge），用 getAllByText
    expect(screen.getAllByText(/考科一/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/考科二/).length).toBeGreaterThan(0);
  });

  // 這個站練的是初級能力鑑定（官方公告試題的標題就是「淨零碳規劃管理師-初級能力鑑定」），
  // 首頁副標原本只寫證照名稱、沒寫等級。
  // 斷言綁在副標元素上：getByText 會在整個 DOM 找，字串藏在別處、副標維持舊字也照樣通過。
  it('副標在證照名稱後標出等級（初級）', () => {
    const { container } = render(<HomePage onStartQuiz={() => {}} />);
    const subtitle = container.querySelector('.hero-subtitle');
    expect(subtitle).toBeVisible();
    expect(subtitle?.textContent?.trim()).toBe('iPAS 淨零碳規劃管理師（初級）考古題線上測驗');
  });

  it('does NOT show practice-pool indicator when disabled', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByText(/加強練習池啟用中/)).toBeNull();
  });

  it('shows practice-pool indicator when enabled', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.getByText(/加強練習池啟用中/)).toBeInTheDocument();
  });

  it('calls onStartQuiz with current config when 開始測驗 clicked', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const startBtn = screen.getByRole('button', { name: /開始測驗/ });
    fireEvent.click(startBtn);
    expect(onStartQuiz).toHaveBeenCalledOnce();
    const config = onStartQuiz.mock.calls[0][0];
    expect(config).toHaveProperty('mode');
    expect(config).toHaveProperty('subject');
    expect(config).toHaveProperty('questionCount');
  });

  // === 加強練習池入口（clickable badge）===

  it('shows clickable opt-in badge on disabled state', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const optInBtn = screen.getByRole('button', { name: '啟用加強練習池' });
    expect(optInBtn).toBeInTheDocument();
    // 應顯示題數（154，與 practice_pool.json _meta.totals.total 同步）
    expect(optInBtn.textContent).toMatch(/154/);
  });

  it('clicking opt-in badge opens PracticeOptInDialog (first-time flow)', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const optInBtn = screen.getByRole('button', { name: '啟用加強練習池' });
    fireEvent.click(optInBtn);
    // dialog 出現（aria-labelledby 指向 optin-title）
    expect(screen.getByRole('dialog', { name: /啟用加強練習池/ })).toBeInTheDocument();
  });

  it('accepting dialog enables practice mode + persists opt-in', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '啟用加強練習池' }));
    fireEvent.click(screen.getByRole('button', { name: /我已了解/ }));
    expect(localStorage.getItem('practice-pool-enabled')).toBe('1');
    expect(localStorage.getItem('practice-pool-ai-opt-in')).toBe('1');
    // dialog 關閉、原 opt-in badge 消失
    expect(screen.queryByRole('dialog', { name: /啟用加強練習池/ })).toBeNull();
  });

  it('once opted-in but disabled: clicking re-enables without re-opening dialog', () => {
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    localStorage.setItem('practice-pool-enabled', '0');
    render(<HomePage onStartQuiz={() => {}} />);
    const optInBtn = screen.getByRole('button', { name: '啟用加強練習池' });
    fireEvent.click(optInBtn);
    expect(localStorage.getItem('practice-pool-enabled')).toBe('1');
    // 沒重開 dialog
    expect(screen.queryByRole('dialog', { name: /啟用加強練習池/ })).toBeNull();
  });

  it('clicking enabled-state badge disables practice mode', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const enabledBadge = screen.getByRole('button', { name: /停用加強練習池/ });
    fireEvent.click(enabledBadge);
    expect(localStorage.getItem('practice-pool-enabled')).toBe('0');
  });

  // === 首次自動彈窗 + 永久持續 tip card ===

  it('first visit (no seen flag, no opt-in) auto-opens disclosure dialog', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.getByRole('dialog', { name: /啟用加強練習池/ })).toBeInTheDocument();
  });

  it('declining first-visit dialog records seen flag (no re-popup)', () => {
    const { unmount } = render(<HomePage onStartQuiz={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /暫不啟用/ }));
    expect(localStorage.getItem('practice-pool-disclosure-seen')).toBe('1');
    unmount();
    // 第二次進首頁，dialog 不再自動彈
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByRole('dialog', { name: /啟用加強練習池/ })).toBeNull();
  });

  it('does NOT auto-popup if already opted-in', () => {
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByRole('dialog', { name: /啟用加強練習池/ })).toBeNull();
  });

  it('does NOT auto-popup if seen flag already set', () => {
    localStorage.setItem('practice-pool-disclosure-seen', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByRole('dialog', { name: /啟用加強練習池/ })).toBeNull();
  });

  it('tip card always renders (never silently disappears) — disabled state', () => {
    localStorage.setItem('practice-pool-disclosure-seen', '1'); // 不彈 dialog
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    expect(tip).toBeInTheDocument();
    expect(tip.textContent).toMatch(/54.*模擬.*100.*AI/);
    expect(tip.className).not.toMatch(/practice-pool-tip--enabled/);
  });

  it('tip card switches to enabled state (no disappearance) when practice mode is on', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    // 改用 modifier class 標記狀態，不再 unmount
    expect(tip.className).toMatch(/practice-pool-tip--enabled/);
    expect(tip.textContent).toMatch(/已啟用/);
    // CTA 變成停用按鈕（用 within 限定在 tip card 內，避免跟 badge 撞）
    expect(within(tip).getByRole('button')).toHaveTextContent(/停用加強練習/);
  });

  it('tip card CTA opens dialog (when not yet seen, !opted-in)', () => {
    localStorage.setItem('practice-pool-disclosure-seen', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const cta = screen.getByRole('button', { name: /了解並啟用/ });
    fireEvent.click(cta);
    expect(screen.getByRole('dialog', { name: /啟用加強練習池/ })).toBeInTheDocument();
  });

  it('tip card CTA disables practice mode when enabled', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    fireEvent.click(within(tip).getByRole('button'));
    expect(localStorage.getItem('practice-pool-enabled')).toBe('0');
  });

  // === 抽題分布 disclosure（progressive disclosure 預設收摺）===

  it('啟用練習池時，抽題分布預設為收摺（details not open）', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    const details = tip.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.hasAttribute('open')).toBe(false);
    // summary 文字存在、可被使用者點擊
    expect(within(tip).getByText(/查看抽題分布/)).toBeInTheDocument();
  });

  it('點擊 summary 會展開 details，histogram 變為 open 狀態', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    const details = tip.querySelector('details') as HTMLDetailsElement;
    const summary = tip.querySelector('summary') as HTMLElement;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
  });

  it('未啟用練習池時不渲染 details disclosure', () => {
    localStorage.setItem('practice-pool-disclosure-seen', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    expect(tip.querySelector('details')).toBeNull();
  });

  // === Config 控制元件 onChange handlers (補覆蓋) ===

  it('subject select change updates config.subject', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const select = screen.getByLabelText(/考科範圍/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '考科1' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(onStartQuiz.mock.calls[0][0].subject).toBe('考科1');
  });

  it('mode select change updates config.mode + showAnswerImmediately', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const select = screen.getByLabelText(/測驗模式/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'exam' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    const cfg = onStartQuiz.mock.calls[0][0];
    expect(cfg.mode).toBe('exam');
    expect(cfg.showAnswerImmediately).toBe(false);
  });

  it('count input change updates config.questionCount (clamped 1-100)', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(onStartQuiz.mock.calls[0][0].questionCount).toBe(25);
  });

  it('count input below minimum (0): 開始測驗 disabled', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    const startBtn = screen.getByRole('button', { name: /開始測驗/ });
    fireEvent.change(input, { target: { value: '0' } });
    expect(input.value).toBe('0');
    expect(startBtn).toBeDisabled();
    fireEvent.click(startBtn);
    expect(onStartQuiz).not.toHaveBeenCalled();
  });

  it('count input empty: 開始測驗 disabled', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    const startBtn = screen.getByRole('button', { name: /開始測驗/ });
    fireEvent.change(input, { target: { value: '' } });
    expect(startBtn).toBeDisabled();
  });

  it('count input clamps over-max to 100', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(onStartQuiz.mock.calls[0][0].questionCount).toBe(100);
  });

  it('count input over-max syncs displayed value to 100 on blur', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500' } });
    expect(input.value).toBe('500');
    fireEvent.blur(input);
    expect(input.value).toBe('100');
  });

  it('count input rejects decimals and trailing text (button disabled)', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    const startBtn = screen.getByRole('button', { name: /開始測驗/ });

    fireEvent.change(input, { target: { value: '1.5' } });
    expect(startBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '12abc' } });
    expect(startBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '-5' } });
    expect(startBtn).toBeDisabled();

    fireEvent.click(startBtn);
    expect(onStartQuiz).not.toHaveBeenCalled();
  });

  it('count input invalid → aria-invalid=true and hint is a polite live region', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const hintId = input.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    const hint = document.getElementById(hintId!);
    expect(hint).not.toBeNull();
    // 常駐 live region：role=status + aria-live=polite，避免 role 切換時 SR 不可靠 announce
    expect(hint?.getAttribute('role')).toBe('status');
    expect(hint?.getAttribute('aria-live')).toBe('polite');
    expect(hint?.textContent).toMatch(/才能開始測驗/);
  });

  it('count input invalid → valid: aria-invalid recovers to false', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: '20' } });
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByRole('button', { name: /開始測驗/ })).not.toBeDisabled();
  });

  it('count input blur normalizes leading zeros', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const input = screen.getByLabelText(/題數/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '050' } });
    fireEvent.blur(input);
    expect(input.value).toBe('50');
  });

  it('shuffle checkbox toggles config.shuffleQuestions', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const cb = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.change(cb, { target: { checked: true } });
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(onStartQuiz.mock.calls[0][0].shuffleQuestions).toBe(true);
  });

  // === Resume hint（Refs #71）===
  // 註：questions 佔位需為「合理 shape」的物件（含 id/stem/options）—— loadProgress
  // （#106 重建）會拒絕含 null/垃圾/缺欄位的 payload（避免 resume 時 crash）。
  // 這些 fixture 寫在 legacy v1 key 上，順帶驗證 v2 loader 對舊 key 的回退讀取；
  // hint 只讀 questions.length / answers.length，佔位內容不影響斷言。

  it('localStorage 無進度時不顯示 resume hint', () => {
    render(<HomePage onStartQuiz={() => {}} onResumeQuiz={() => {}} />);
    expect(screen.queryByTestId('resume-hint')).toBeNull();
  });

  it('localStorage 有有效進度時顯示 resume hint + 繼續測驗 link', () => {
    localStorage.setItem(
      'ipas-quiz-in-progress',
      JSON.stringify({
        version: 1,
        savedAt: Date.now() - 5 * 60_000, // 5 分鐘前
        state: {
          isActive: true,
          questions: new Array(20).fill({ id: 'x', stem: '題', options: [] }),
          currentIndex: 7,
          answers: new Array(7).fill({ questionId: 'x' }),
          startTime: Date.now(),
          config: { mode: 'practice', subject: 'all', questionCount: 10, shuffleQuestions: false, showAnswerImmediately: true },
        },
      })
    );
    render(<HomePage onStartQuiz={() => {}} onResumeQuiz={() => {}} />);
    const hint = screen.getByTestId('resume-hint');
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toMatch(/已答 7 \/ 20 題/);
    expect(hint.textContent).toMatch(/分鐘前/);
    expect(within(hint).getByRole('button', { name: /繼續測驗/ })).toBeInTheDocument();
  });

  it('點擊「繼續測驗」呼叫 onResumeQuiz', () => {
    localStorage.setItem(
      'ipas-quiz-in-progress',
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        state: {
          isActive: true,
          questions: new Array(10).fill({ id: 'x', stem: '題', options: [] }),
          currentIndex: 3,
          answers: new Array(3).fill({ questionId: 'x' }),
          startTime: Date.now(),
          config: { mode: 'practice', subject: 'all', questionCount: 10, shuffleQuestions: false, showAnswerImmediately: true },
        },
      })
    );
    const onResume = vi.fn();
    render(<HomePage onStartQuiz={() => {}} onResumeQuiz={onResume} />);
    fireEvent.click(screen.getByRole('button', { name: /繼續測驗/ }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('未提供 onResumeQuiz prop 時即使有進度也不顯示 hint（避免悬空 link）', () => {
    localStorage.setItem(
      'ipas-quiz-in-progress',
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        state: {
          isActive: true,
          questions: new Array(5).fill({ id: 'x', stem: '題', options: [] }),
          currentIndex: 1,
          answers: [],
          startTime: Date.now(),
          config: { mode: 'practice', subject: 'all', questionCount: 10, shuffleQuestions: false, showAnswerImmediately: true },
        },
      })
    );
    render(<HomePage onStartQuiz={() => {}} />);
    expect(screen.queryByTestId('resume-hint')).toBeNull();
  });
});

// #128 只出官方題目：放在既有的「測驗設定」裡，不在首頁另加按鈕
describe('題目來源（只出官方題目）', () => {
  const sourceSelect = () => screen.getByLabelText('題目來源') as HTMLSelectElement;
  const lastConfig = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0];

  it('選單列出全部題目、全部官方題目、每一場公告試題與每一版參考樣題（新到舊）', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const options = Array.from(sourceSelect().options).map((o) => [o.value, o.textContent]);
    const sessions = officialSessions(allQuestions);
    const editions = sampleEditions(allQuestions);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(editions).toEqual(['114']);
    expect(options).toEqual([
      ['all', '全部題目'],
      ['official', '全部官方題目'],
      ...sessions.map((s) => [`exam:${s}`, expect.stringMatching(/^1\d\d 年第.+次公告試題$/)]),
      ['sample:114', '參考樣題（114 年版）'],
    ]);
  });

  it('預設是全部題目：開始時不是官方模式，也不顯示官方題數', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    expect(sourceSelect().value).toBe('all');
    expect(screen.queryByText(/，不會混入其他來源的題目/)).toBeNull();
    // 說明是空的，就不要讓螢幕閱讀器去念一段空白的描述
    expect(sourceSelect().hasAttribute('aria-describedby')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(lastConfig(onStartQuiz).questionSource ?? 'all').toBe('all');
  });

  it('選全部官方題目：開始時帶 questionSource，並說明可出的題數', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    fireEvent.change(sourceSelect(), { target: { value: 'official' } });
    const n = getSourceCandidates('all', 'official').length;
    expect(
      screen.getByText(`可出 ${n} 題官方題目（公告試題與參考樣題），不會混入其他來源的題目。`)
    ).toBeInTheDocument();
    const describedBy = sourceSelect().getAttribute('aria-describedby');
    expect(document.getElementById(describedBy ?? '')?.textContent).toContain(`可出 ${n} 題官方題目`);
    // 加強練習池沒有啟用時，不說「這個模式不會混入」（那一句只在啟用時才有意義）
    expect(screen.queryByText('加強練習池在這個模式不會混入。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(lastConfig(onStartQuiz).questionSource).toBe('official');
  });

  it('說明用的稱呼跟著來源換：某一場是官方公告試題、某一版是參考樣題', () => {
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    const [session] = officialSessions(allQuestions);
    fireEvent.change(sourceSelect(), { target: { value: `exam:${session}` } });
    const exams = getSourceCandidates('all', `exam:${session}`).length;
    expect(screen.getByText(`可出 ${exams} 題官方公告試題，不會混入其他來源的題目。`)).toBeInTheDocument();
    fireEvent.change(sourceSelect(), { target: { value: 'sample:114' } });
    const samples = getSourceCandidates('all', 'sample:114').length;
    expect(samples).toBe(10);
    expect(screen.getByText(`可出 ${samples} 題參考樣題，不會混入其他來源的題目。`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(lastConfig(onStartQuiz).questionSource).toBe('sample:114');
  });

  it('可與考科組合：換考科時可出的題數跟著變', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    fireEvent.change(sourceSelect(), { target: { value: 'official' } });
    fireEvent.change(screen.getByLabelText('考科範圍'), { target: { value: '考科1' } });
    const n = getSourceCandidates('考科1', 'official').length;
    expect(n).toBeLessThan(getSourceCandidates('all', 'official').length);
    expect(
      screen.getByText(`可出 ${n} 題官方題目（公告試題與參考樣題），不會混入其他來源的題目。`)
    ).toBeInTheDocument();
  });

  it('題數多於官方題時，開始前就明確告知實際會出幾題', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const [session] = officialSessions(allQuestions);
    fireEvent.change(sourceSelect(), { target: { value: `exam:${session}` } });
    fireEvent.change(screen.getByLabelText('考科範圍'), { target: { value: '考科2' } });
    fireEvent.change(screen.getByLabelText('題數'), { target: { value: '100' } });
    const n = getSourceCandidates('考科2', `exam:${session}`).length;
    expect(n).toBeLessThan(100);
    expect(screen.getByText(`題數設定是 100 題，但只有 ${n} 題官方公告試題，本次會出 ${n} 題。`)).toBeInTheDocument();
    // 剛好等於可出的題數就不算不夠，不提醒
    fireEvent.change(screen.getByLabelText('題數'), { target: { value: String(n) } });
    expect(screen.queryByText(/^題數設定是/)).toBeNull();
    fireEvent.change(screen.getByLabelText('題數'), { target: { value: String(n + 1) } });
    expect(screen.getByText(`題數設定是 ${n + 1} 題，但只有 ${n} 題官方公告試題，本次會出 ${n} 題。`)).toBeInTheDocument();
  });

  it('加強練習池啟用時，說明這個模式不會混入練習題', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    fireEvent.change(sourceSelect(), { target: { value: 'official' } });
    expect(screen.getByText('加強練習池在這個模式不會混入。')).toBeInTheDocument();
  });

  it('加強練習池啟用時，練習池提示卡不再說會混入，也不顯示主題庫加練習池的抽題分布', () => {
    localStorage.setItem('practice-pool-enabled', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    expect(within(tip).getByText(/下一場測驗會額外混入/)).toBeInTheDocument();
    expect(within(tip).getByText(/查看抽題分布/)).toBeInTheDocument();

    fireEvent.change(sourceSelect(), { target: { value: 'official' } });
    expect(within(tip).queryByText(/下一場測驗會額外混入/)).toBeNull();
    expect(within(tip).getByText(/目前的題目來源只出官方題目，這一場不會混入練習池/)).toBeInTheDocument();
    fireEvent.change(sourceSelect(), { target: { value: 'sample:114' } });
    expect(within(tip).getByText(/目前的題目來源只出參考樣題，這一場不會混入練習池/)).toBeInTheDocument();
    expect(within(tip).queryByText(/查看抽題分布/)).toBeNull();

    fireEvent.change(sourceSelect(), { target: { value: 'all' } });
    expect(within(tip).getByText(/下一場測驗會額外混入/)).toBeInTheDocument();
    expect(within(tip).getByText(/查看抽題分布/)).toBeInTheDocument();
  });

  it('加強練習池已同意但還沒啟用：提示卡不說「啟用後下一場會混入」', () => {
    localStorage.setItem('practice-pool-ai-opt-in', '1');
    render(<HomePage onStartQuiz={() => {}} />);
    const tip = screen.getByTestId('practice-pool-tip');
    expect(within(tip).getByText(/啟用後下一場練習會混入/)).toBeInTheDocument();

    fireEvent.change(sourceSelect(), { target: { value: 'official' } });
    expect(within(tip).queryByText(/啟用後下一場練習會混入/)).toBeNull();
    expect(within(tip).getByText(/目前的題目來源只出官方題目，啟用後這一場也不會混入/)).toBeInTheDocument();
  });

  it('題數不合法時不出現「題數不夠」的提醒（題數那一格自己會報錯）', () => {
    // 範圍只有 1 題：不合法的題數若被當成 2 以上的任何數（例如上限 100 或預設的 20），這裡就會冒出提醒。
    // 範圍比 100 大時，題數最多 100，這個提醒怎麼樣都不會出現，測不出來
    sourceLimit.value = 1;
    render(<HomePage onStartQuiz={() => {}} />);
    fireEvent.change(sourceSelect(), { target: { value: 'official' } });
    for (const value of ['', 'abc', '0']) {
      fireEvent.change(screen.getByLabelText('題數'), { target: { value } });
      expect(screen.queryByText(/^題數設定是/)).toBeNull();
      expect(
        screen.getByText('可出 1 題官方題目（公告試題與參考樣題），不會混入其他來源的題目。')
      ).toBeInTheDocument();
    }
    // 對照：合法的題數多於 1 題就提醒（上面沒有提醒，不是因為這個範圍永遠不會提醒）
    fireEvent.change(screen.getByLabelText('題數'), { target: { value: '2' } });
    expect(screen.getByText('題數設定是 2 題，但只有 1 題官方題目，本次會出 1 題。')).toBeInTheDocument();
  });

  // 螢幕閱讀器只會念「內容改變了的」live region：它必須一直在畫面上，空的也在
  it('題目來源的說明是一直存在的 live region（role=status、polite、atomic）', () => {
    render(<HomePage onStartQuiz={() => {}} />);
    const hint = document.getElementById('source-hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toBe('');
    expect(hint).toHaveAttribute('role', 'status');
    expect(hint).toHaveAttribute('aria-live', 'polite');
    expect(hint).toHaveAttribute('aria-atomic', 'true');
    fireEvent.change(sourceSelect(), { target: { value: 'official' } });
    expect(document.getElementById('source-hint')).toBe(hint);
    expect(hint!.textContent).toMatch(/^可出 \d+ 題官方題目/);
  });

  it('範圍內一題官方題都沒有：說明無法開始、開始按鈕停用；換回全部題目就能開始', () => {
    sourceEmpty.value = true;
    const onStartQuiz = vi.fn();
    render(<HomePage onStartQuiz={onStartQuiz} />);
    fireEvent.change(sourceSelect(), { target: { value: 'official' } });
    expect(screen.getByText('這個範圍沒有官方題目，無法開始。')).toBeInTheDocument();
    expect(screen.queryByText(/^可出 /)).toBeNull();
    const start = screen.getByRole('button', { name: /開始測驗/ });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(onStartQuiz).not.toHaveBeenCalled();

    fireEvent.change(sourceSelect(), { target: { value: 'all' } });
    expect(start).toBeEnabled();
    expect(screen.queryByText('這個範圍沒有官方題目，無法開始。')).toBeNull();
    fireEvent.click(start);
    expect(onStartQuiz).toHaveBeenCalledTimes(1);
  });
});
