// 加強練習池抽題分佈預覽
// 啟用後讓使用者看到「下一場測驗的抽題範圍」實際組成（主題庫 + 模擬 + AI 產題）
import { POOL_BY_SUBJECT } from '../../data/practice-pool-counts';
import type { ExamSubject } from '../../types/quiz';
import './PracticePoolHistogram.css';

interface PracticePoolHistogramProps {
  /** 主題庫題數（已套用 subject filter） */
  mainBankCount: number;
  /** 使用者選的科目 */
  subject: ExamSubject | 'all';
}

interface Row {
  label: string;
  count: number;
  cls: string;
}

export function PracticePoolHistogram({
  mainBankCount,
  subject,
}: PracticePoolHistogramProps): JSX.Element {
  // POOL_BY_SUBJECT 目前只有 '考科1' / '考科2' / 'all'；未來新增 subject
  // 若忘了補常數，fallback 到 all 全集（避免 runtime crash）
  const poolCounts = POOL_BY_SUBJECT[subject] ?? POOL_BY_SUBJECT.all;
  const rows: Row[] = [
    { label: '主題庫', count: mainBankCount, cls: 'main' },
    { label: '模擬題', count: poolCounts.externalMock, cls: 'mock' },
    { label: 'AI 產題', count: poolCounts.aiGenerated, cls: 'ai' },
  ];
  const total = rows.reduce((s, r) => s + r.count, 0);
  const maxCount = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div className="pool-histogram" data-testid="pool-histogram">
      <p className="pool-histogram__title">
        本次抽題範圍（已套用考科 filter）
      </p>
      <ul className="pool-histogram__rows">
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
          return (
            <li key={r.label} className={`pool-histogram__row pool-histogram__row--${r.cls}`}>
              <span className="pool-histogram__label">{r.label}</span>
              <span className="pool-histogram__count">{r.count}</span>
              <div className="pool-histogram__bar-track" aria-hidden="true">
                <div
                  className="pool-histogram__bar"
                  style={{ width: `${(r.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="pool-histogram__pct">{pct}%</span>
            </li>
          );
        })}
      </ul>
      <p className="pool-histogram__total">
        共 <strong>{total}</strong> 題池中抽出本場測驗
      </p>
    </div>
  );
}

export default PracticePoolHistogram;
