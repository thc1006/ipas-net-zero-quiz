// 根目錄的白名單。
//
// 這個 repo 的根目錄被清乾淨過一次（2026-01-23 的 f1f6f67「chore: clean up root directory
// structure」，刪掉 PHASE_2_PROGRESS_TRACKER.md、PHASE_2_LAUNCH_SUMMARY.md、
// PHASE_2_VERIFICATION_PLAN.md 等），八個月後又長出五個專案 .md、一個生成的 JSON、
// 一個沒被追蹤的 scratchpad 檔，以及一個 AGPL 專案不需要的 NOTICE。
//
// 純文字規約攔不住這件事 —— 寫在 AGENTS.md 裡也一樣。所以做成會擋人的檢查：
// 想在根目錄加檔案，就必須改這份白名單，而改白名單會在 code review 裡被看到。
//
// 判準來自 GitHub Docs 與社群共識：根目錄只放 README、LICENSE、設定檔與標準檔；
// 專案文件放 docs/，社群健康檔（CONTRIBUTING／CODE_OF_CONDUCT／SECURITY）可放 .github/。
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');

/** 允許出現在 repo 根目錄的項目。新增前請先問：它不能放 docs/ 或 .github/ 嗎？ */
const ALLOWED = new Set([
  'README.md',
  'AGENTS.md',
  'LICENSE',
  'LICENSES',
  '.gitignore',
  '.gitattributes',
  '.markdownlint.jsonc',
  'codecov.yml',
  'platform.config.json',
  'quiz-app',
  'schemas',
  'tools',
  'docs',
  '.git',
  '.github',
]);

/** 不進版控、但常出現在工作目錄的東西（不列入判斷） */
const IGNORED = [/^\.ruff_cache$/, /^scratchpad_/, /^node_modules$/, /^\.venv$/, /^__pycache__$/];

describe('repo 根目錄必須保持乾淨', () => {
  const entries = readdirSync(root).filter((n) => !IGNORED.some((re) => re.test(n)));

  it('這條 gate 不能空轉：根目錄確實掃得到東西', () => {
    expect(entries.length).toBeGreaterThan(8);
  });

  it('根目錄不得出現白名單以外的項目', () => {
    const unexpected = entries.filter((n) => !ALLOWED.has(n));
    expect(
      unexpected,
      '根目錄多了東西。先問它能不能放 docs/（專案文件）或 .github/（社群健康檔）；' +
        '真的必須在根目錄，才把它加進這份白名單'
    ).toEqual([]);
  });

  it('專案文件不得散在根目錄（必須在 docs/）', () => {
    const strayDocs = entries.filter(
      (n) => n.endsWith('.md') && !['README.md', 'AGENTS.md'].includes(n)
    );
    expect(
      strayDocs,
      '根目錄只留 README.md 與 AGENTS.md（兩者都是工具與慣例會去找的標準檔）。' +
        '其餘 .md 放 docs/ —— 這個 repo 的根目錄已經因此被清過一次'
    ).toEqual([]);
  });

  it('docs/ 裡確實有那些搬過去的文件（確認上面兩條不是靠刪檔通過）', () => {
    const docs = readdirSync(resolve(root, 'docs'));
    for (const f of [
      'CONTENT-CURRENCY.md',
      'DATA-PROVENANCE.md',
      'VERIFICATION-GAPS.md',
      'evidence-manifest.json',
    ]) {
      expect(docs, `docs/ 裡找不到 ${f}`).toContain(f);
    }
    expect(statSync(resolve(root, 'docs')).isDirectory()).toBe(true);
  });
});
