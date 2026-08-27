// 「這題能不能計分」只能有一個定義。
//
// 起因：抽題、作答、計分分母、錯題匯出、統計各自寫 `q.hasAnswer`。今天五處一致，
// 但只要有人新增一種「這題有問題」的旗標而漏改其中一處，就會出現
// 「考試模式排除了、練習模式卻出現」或「分母排除了、錯題匯出仍判錯」這種不一致。
//
// 現況（2026-08-27）：兩個題庫都沒有 answer=null，也沒有任何爭議類旗標 ——
// 所以這支現在的行為與 `q.hasAnswer` 完全相同。它存在是為了讓**下一次**有題目被判爭議時，
// 標上旗標就自動離開計分池，而不必依賴某個人記得同時把答案撤掉。

/**
 * 帶這些旗標的題目一律不計分。
 *
 * 判準：旗標代表「這題目前無法給出唯一且站得住的答案」。
 * `time_sensitive`（內容會過期，但現在是對的）與 `low_confidence`
 * （練習池的品質提示，UI 已有徽章）**不在此列** —— 它們是提醒，不是失效。
 */
export const SCORE_BLOCKING_FLAGS = [
  'ambiguous',
  'disputed',
  'disputed_answer',
  'multiple_correct',
  'unverifiable_evidence',
  'retired',
] as const;

export type ScoreBlockingFlag = (typeof SCORE_BLOCKING_FLAGS)[number];

const BLOCKING = new Set<string>(SCORE_BLOCKING_FLAGS);

export interface ScorableQuestion {
  answer?: string | null;
  hasAnswer?: boolean;
  qualityFlags?: string[];
}

/** 這題是否可以進入計分（抽題、分母、對錯判定都用這一支）。 */
export function isQuestionScorable(question: ScorableQuestion): boolean {
  const hasAnswer =
    question.hasAnswer ?? (question.answer !== null && question.answer !== undefined);
  if (!hasAnswer) return false;
  return !(question.qualityFlags ?? []).some((flag) => BLOCKING.has(flag));
}

/** 這題為什麼不能計分（給 gate 與除錯用的可讀理由）。 */
export function whyNotScorable(question: ScorableQuestion): string | null {
  if (isQuestionScorable(question)) return null;
  const hasAnswer =
    question.hasAnswer ?? (question.answer !== null && question.answer !== undefined);
  if (!hasAnswer) return '沒有標準答案';
  const hit = (question.qualityFlags ?? []).filter((flag) => BLOCKING.has(flag));
  return `帶有不可計分旗標：${hit.join('、')}`;
}
