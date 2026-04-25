// SourceBreakdown — ResultPage 顯示「按題目來源分組的正確率」
// 讓使用者識別「我的主題庫真實水準」 vs 池題練習表現
import type { AnswerRecord } from '../../types/quiz';
import './SourceBreakdown.css';

/** 池題正確率低於此 threshold (%) 顯示 ⚠ 偏低警示。主題庫不適用。 */
export const LOW_ACCURACY_THRESHOLD_PCT = 60;

interface SourceBreakdownProps {
  answers: AnswerRecord[];
  /** 自訂 low-accuracy threshold；預設 60 (%) */
  lowAccuracyThresholdPct?: number;
}

interface Group {
  key: 'main_bank' | 'external_mock' | 'ai_generated';
  label: string;
  cls: string;
  total: number;
  correct: number;
}

export function computeBreakdown(answers: AnswerRecord[]): Group[] {
  const groups: Record<string, { total: number; correct: number }> = {
    main_bank: { total: 0, correct: 0 },
    external_mock: { total: 0, correct: 0 },
    ai_generated: { total: 0, correct: 0 },
  };

  for (const a of answers) {
    if (a.isCorrect === null) continue; // 跳過無答案題（exam mode skip）
    const cat = a.sourceCategory ?? 'main_bank';
    if (!groups[cat]) continue;
    groups[cat].total += 1;
    if (a.isCorrect) groups[cat].correct += 1;
  }

  const meta: Group[] = [
    { key: 'main_bank', label: '主題庫', cls: 'main', total: 0, correct: 0 },
    { key: 'external_mock', label: '模擬題', cls: 'mock', total: 0, correct: 0 },
    { key: 'ai_generated', label: 'AI 產題', cls: 'ai', total: 0, correct: 0 },
  ];

  return meta
    .map((m) => ({ ...m, total: groups[m.key].total, correct: groups[m.key].correct }))
    .filter((m) => m.total > 0);
}

export function SourceBreakdown({
  answers,
  lowAccuracyThresholdPct = LOW_ACCURACY_THRESHOLD_PCT,
}: SourceBreakdownProps): JSX.Element | null {
  const groups = computeBreakdown(answers);

  // 只有「主題庫」一組（沒啟用練習池或練習池沒抽到）→ 不顯示（避免冗餘）
  if (groups.length <= 1) return null;

  return (
    <section className="source-breakdown" aria-label="按題目來源的正確率">
      <h3 className="source-breakdown__title">分項正確率</h3>
      <ul className="source-breakdown__rows">
        {groups.map((g) => {
          const pct = g.total > 0 ? Math.round((g.correct / g.total) * 100) : 0;
          const lowAccuracy = pct < lowAccuracyThresholdPct && g.key !== 'main_bank';
          return (
            <li
              key={g.key}
              className={`source-breakdown__row source-breakdown__row--${g.cls}${
                lowAccuracy ? ' source-breakdown__row--low' : ''
              }`}
            >
              <span className="source-breakdown__label">{g.label}</span>
              <span className="source-breakdown__count">
                <strong>{g.correct}</strong> / {g.total}
              </span>
              <div className="source-breakdown__bar-track" aria-hidden="true">
                <div
                  className="source-breakdown__bar"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="source-breakdown__pct">{pct}%</span>
              {lowAccuracy && (
                <span className="source-breakdown__note" aria-label="正確率偏低提示">
                  ⚠ 偏低
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {groups.some((g) => g.key === 'main_bank') && (
        <p className="source-breakdown__hint">
          ➜ 主題庫正確率代表你的真實 iPAS 模擬考水準；模擬 / AI 產題僅作補充練習。
        </p>
      )}
    </section>
  );
}

export default SourceBreakdown;
