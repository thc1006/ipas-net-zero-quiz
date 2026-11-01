// 回報問題與討論區的網址：問題回報開 GitHub issue（.github/ISSUE_TEMPLATE 的範本），討論在 GitHub Discussions。
// 網址都由 app-meta 的 REPO_URL 組出來，不另外寫死。
//
// GitHub Issue Forms 支援以 query string 預填文字欄位（input、textarea）：
//   /issues/new?template=<file>.yml&<field_id>=<encoded value>
// 詳見：https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository
// 預填的欄位 id 要在範本裡真的有，src/report-links.test.ts 會對照範本檢查。
import { APP_VERSION, REPO_URL } from '../data/app-meta';

const ISSUE_NEW_BASE = `${REPO_URL}/issues/new`;
const TEMPLATE = 'question-feedback.yml';
const BUG_TEMPLATE = 'site-bug.yml';
const STEM_MAX_CHARS = 100;

/**
 * 錯誤訊息最多帶幾個字（code point）。GitHub 沒有公布網址上限，超過會回 414；每個字都要 4 個位元組時，
 * 200 個字編碼後約 2400 個字元，整個網址仍在 4096 以內。
 */
export const ERROR_MAX_CHARS = 200;

/** 回報問題：GitHub 開新 issue 的範本選單（網站問題、題目回報，也列出討論區的連結） */
export const REPORT_URL = `${ISSUE_NEW_BASE}/choose`;

/** 討論區：GitHub Discussions（使用問題、讀書討論、功能建議） */
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`;

export interface QuestionFeedbackContext {
  /** 題目 ID（gist-XXX / pool-XXX / item_id） */
  questionId: string;
  /** 題幹原文；會截斷至 STEM_MAX_CHARS 字 + 省略號 */
  stem: string;
  /** 回報來源頁；'quiz'（測驗中）或 'result'（結果頁錯題列表） */
  fromPage: 'quiz' | 'result';
}

/**
 * 把題幹截斷到 max 字。中文 1 char = 1 字元，已足夠定位題目。
 */
function truncateStem(stem: string, max = STEM_MAX_CHARS): string {
  const trimmed = stem.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + '…';
}

/**
 * 生成 GitHub Issue 預填表單的 URL。
 * Caller 用 `<a href={url} target="_blank" rel="noopener noreferrer">` 開新分頁，
 * 不打斷使用者作答 / 看結果頁。
 */
export function buildFeedbackUrl(ctx: QuestionFeedbackContext): string {
  const params = new URLSearchParams();
  params.set('template', TEMPLATE);
  params.set('q_id', ctx.questionId);
  params.set('q_stem', truncateStem(ctx.stem));
  params.set('from_page', ctx.fromPage);
  return `${ISSUE_NEW_BASE}?${params.toString()}`;
}

/**
 * 網站問題範本的預填網址：帶入網站版本，有錯誤訊息時帶它的第一行。
 * 只帶第一行、最多 ERROR_MAX_CHARS 個字：堆疊與元件樹不進網址，使用者送出前也看得到、改得了這一欄。
 * errorMessage 是 unknown：被 throw 的不一定是 Error，message 可能是任何東西，不是字串就不帶。
 */
export function buildBugReportUrl({ errorMessage }: { errorMessage?: unknown } = {}): string {
  const params = new URLSearchParams();
  params.set('template', BUG_TEMPLATE);
  params.set('app_version', APP_VERSION);
  const text = typeof errorMessage === 'string' ? errorMessage : '';
  const firstLine = text.trim().split(/\r\n|\r|\n/, 1)[0].trim();
  if (firstLine) {
    const chars = Array.from(firstLine);
    params.set(
      'error_message',
      chars.length <= ERROR_MAX_CHARS ? firstLine : chars.slice(0, ERROR_MAX_CHARS).join('') + '…'
    );
  }
  return `${ISSUE_NEW_BASE}?${params.toString()}`;
}
