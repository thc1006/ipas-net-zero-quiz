// 題目回報：生成 GitHub Issue 預填 URL（Refs #63）
//
// GitHub Issue Forms 支援以 query string 預填欄位值：
//   /issues/new?template=<file>.yml&<field_id>=<encoded value>
// 詳見：https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository

const ISSUE_NEW_BASE =
  'https://github.com/thc1006/ipas-net-zero-quiz/issues/new';
const TEMPLATE = 'question-feedback.yml';
const STEM_MAX_CHARS = 100;

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
