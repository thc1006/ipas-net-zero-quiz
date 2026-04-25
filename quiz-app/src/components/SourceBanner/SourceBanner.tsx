// SourceBanner — 練習池題目的「閱讀題目前」整合式來源說明 + 信任提示
// 比 SourceBadge chip 更顯眼，目的是讓使用者在作答前對題目來源有明確認知。
//
// 顯示策略：
// - 主題庫題（無 provenance）：不顯示
// - external_mock：藍底，提示「非官方模擬題」
// - ai_generated：黃底，提示「AI 產題已驗證；以官方教材為最終依據」
// - 帶 quality_flag：紅邊警示
import type { PracticePoolSourceType, PracticePoolQualityFlag } from '../../types/practicePool';
import './SourceBanner.css';

interface SourceBannerProps {
  sourceType: PracticePoolSourceType;
  qualityFlags?: PracticePoolQualityFlag[];
  /** primary-source URL 數量，0 不顯示 */
  sourceCount?: number;
}

const SOURCE_META: Record<
  PracticePoolSourceType,
  { tone: string; icon: string; label: string; hint: string }
> = {
  external_mock: {
    tone: 'mock',
    icon: 'menu_book',
    label: '模擬題',
    hint: '公開模擬題（非官方歷屆，iPAS 不公開歷屆）。',
  },
  ai_generated: {
    tone: 'ai',
    icon: 'auto_awesome',
    label: 'AI 產題',
    hint: '由 LLM 依環境部 / CBAM / ISO 等法規產生，並經獨立驗證代理 cross-check 通過。請以官方教材為最終依據。',
  },
};

const FLAG_HINT: Partial<Record<PracticePoolQualityFlag, string>> = {
  time_sensitive: '時效性 — 答案會隨時間變動（如 RE100 名單），建議查最新官方資料',
  ambiguous: '爭議 — 不同教材可能給出不同答案，請參考多方來源',
  low_confidence: '低信心 — 自動驗證信心較低，建議多方核對',
};

export function SourceBanner({
  sourceType,
  qualityFlags = [],
  sourceCount = 0,
}: SourceBannerProps): JSX.Element {
  const meta = SOURCE_META[sourceType];
  const flagsToShow = qualityFlags.filter((f): f is keyof typeof FLAG_HINT => f in FLAG_HINT);
  const hasFlag = flagsToShow.length > 0;

  return (
    <aside
      className={`source-banner source-banner--${meta.tone} ${hasFlag ? 'source-banner--flagged' : ''}`}
      data-testid="source-banner"
      role="note"
      aria-label={`本題為${meta.label}`}
    >
      <span className="material-icons source-banner__icon" aria-hidden="true">
        {meta.icon}
      </span>
      <div className="source-banner__body">
        <span className="source-banner__label">本題為「{meta.label}」</span>
        <p className="source-banner__hint">
          {meta.hint}
          {sourceCount > 0 && (
            <span className="source-banner__sources">
              （附 {sourceCount} 條 primary-source URL，見下方參考來源）
            </span>
          )}
        </p>
        {hasFlag && (
          <ul className="source-banner__flags">
            {flagsToShow.map((f) => (
              <li key={f} className={`source-banner__flag source-banner__flag--${f}`}>
                <span className="material-icons sm" aria-hidden="true">warning</span>
                <span>{FLAG_HINT[f]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

export default SourceBanner;
