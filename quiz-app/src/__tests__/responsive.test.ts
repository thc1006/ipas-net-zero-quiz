// 響應式 CSS 規則存在性測試
//
// vitest 在 jsdom 下無法真正驗證渲染後的視覺效果（沒有 layout engine），
// 但我們可以保護「重要 mobile @media 規則不被意外刪除」這層安全網。
//
// 測試策略：讀取 CSS 檔案內容，斷言：
// 1. 關鍵元件 CSS 都有 ≤640px 的 @media block
// 2. mobile block 內含 mobile-first 慣例（單欄、tap target、收緊 padding）
//
// 真正的視覺回歸測試交給 Playwright e2e（後續 PR 加 mobile viewport snapshot）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readCss(relPath: string): string {
  return readFileSync(resolve(__dirname, '..', relPath), 'utf-8');
}

interface MobileExpectation {
  file: string;
  /** 至少要有這個 max-width 的 @media block */
  mobileBreakpoint: number;
  /** mobile block 內必須出現的字串（substring match） */
  mustContain: string[];
}

const MOBILE_RULES: MobileExpectation[] = [
  {
    file: 'pages/HomePage.css',
    mobileBreakpoint: 640,
    mustContain: ['practice-pool-tip', 'config-grid', 'stats-badges'],
  },
  {
    file: 'pages/ResultPage.css',
    mobileBreakpoint: 640,
    mustContain: ['stats-section', 'action-section', 'wrong-answers'],
  },
  {
    file: 'pages/QuizPage.css',
    mobileBreakpoint: 640,
    mustContain: ['quiz-page'],
  },
  {
    file: 'pages/SettingsPage.css',
    mobileBreakpoint: 640,
    mustContain: ['settings-page'],
  },
  {
    file: 'components/Header/Header.css',
    mobileBreakpoint: 640,
    mustContain: ['header-container'],
  },
  {
    file: 'components/QuestionCard/QuestionCard.css',
    mobileBreakpoint: 640,
    mustContain: ['question-card'],
  },
];

describe('responsive CSS guard — ≤640px breakpoint exists with required rules', () => {
  for (const rule of MOBILE_RULES) {
    it(`${rule.file} has @media (max-width: ${rule.mobileBreakpoint}px) block`, () => {
      const css = readCss(rule.file);
      const re = new RegExp(`@media\\s*\\(max-width:\\s*${rule.mobileBreakpoint}px\\)\\s*{`);
      expect(css, `Missing ≤${rule.mobileBreakpoint}px breakpoint in ${rule.file}`).toMatch(re);
    });

    it(`${rule.file} mobile block addresses key selectors: ${rule.mustContain.join(', ')}`, () => {
      const css = readCss(rule.file);
      const blockRe = new RegExp(
        `@media\\s*\\(max-width:\\s*${rule.mobileBreakpoint}px\\)\\s*{([\\s\\S]*?)(?:^}|^@media|$(?![\\r\\n]))`,
        'm',
      );
      const match = css.match(blockRe);
      expect(match, `Could not extract mobile block from ${rule.file}`).not.toBeNull();
      const block = match![1];
      for (const sel of rule.mustContain) {
        expect(block, `Mobile block in ${rule.file} missing rule for ".${sel}"`).toContain(sel);
      }
    });
  }

  it('global tap-target rule exists (button min-height for accessibility)', () => {
    const css = readCss('styles/global.css');
    expect(css).toMatch(/button[^{]*{[^}]*min-height/);
  });
});
