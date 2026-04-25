// 練習池題目來源徽章。
// 對 ai_generated 題顯示「AI 產題」並符合 EU AI Act Art.50（2026-08-02 起）揭露要求。
import './SourceBadge.css';
import type { PracticePoolSourceType, PracticePoolQualityFlag } from '../../types/practicePool';

interface SourceBadgeProps {
  sourceType: PracticePoolSourceType;
  qualityFlags?: PracticePoolQualityFlag[];
  /** 顯示完整描述 vs 縮寫 */
  compact?: boolean;
}

const SOURCE_LABEL: Record<PracticePoolSourceType, { text: string; icon: string; tone: string }> = {
  external_mock: { text: '模擬題', icon: 'menu_book', tone: 'mock' },
  ai_generated: { text: 'AI 產題', icon: 'auto_awesome', tone: 'ai' },
};

const FLAG_LABEL: Partial<Record<PracticePoolQualityFlag, string>> = {
  time_sensitive: '時效',
  ambiguous: '爭議',
  low_confidence: '低信心',
};

export function SourceBadge({ sourceType, qualityFlags = [], compact = false }: SourceBadgeProps) {
  const meta = SOURCE_LABEL[sourceType];
  const isAI = sourceType === 'ai_generated';
  const title = isAI
    ? 'AI 產題：本題由語言模型基於法規與標準產生，已通過獨立驗證。依 EU AI Act Art.50 揭露。'
    : '模擬題：來自第三方公開模擬題（vocus / HackMD / yamol 等），非官方歷屆試題。';

  return (
    <span className={`source-badge tone-${meta.tone}`} title={title} aria-label={title}>
      <span className="material-icons sm" aria-hidden="true">
        {meta.icon}
      </span>
      {!compact && <span className="badge-text">{meta.text}</span>}
      {qualityFlags
        .filter((f): f is keyof typeof FLAG_LABEL => f in FLAG_LABEL)
        .map((f) => (
          <span key={f} className={`flag-chip flag-${f}`}>
            {FLAG_LABEL[f]}
          </span>
        ))}
    </span>
  );
}

export default SourceBadge;
