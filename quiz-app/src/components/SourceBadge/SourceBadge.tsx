// 練習池題目來源徽章。
// 對 ai_generated 題顯示「AI 產題」並符合 EU AI Act Art.50（2026-08-02 起）揭露要求。
//
// 這裡原本對使用者說「本題…**已通過獨立驗證**」。**那是一句假話，而且很危險。**
//
// 「獨立驗證」指的是 provenance.verify_verdict = CONFIRMED，
// 而那個判定是 `adversarial_subagent` 下的 —— **用 AI 去驗 AI 產的題**。
// 2026-07 這一輪拿 law.moj.gov.tw 的逐字原文逐條對，在練習池找到 13 個實質缺陷，
// **13 個當初全部被判 CONFIRMED**：
//   - 引號裡憑空捏造的法條原文（氣候法 §35、§60 的假「15% 上限」）
//   - 捏造的法規名稱（《高碳洩漏風險行業認定辦法》根本不存在）
//   - 條號掛錯（碳費辦法 §5→§8、§6→§9、§9→§10）
//   - §32 的六款基金來源說成七款，還多編一款
//   - 民國 106 年換算成 2016 年
//   - 一題有兩個正解
//
// 一句假的保證**比沒有保證更糟** —— 它讓使用者放下戒心，
// 而 EU AI Act Art.50 的立法目的正好相反。
// 文案改成：說清楚「哪些是機器可驗證的」「哪些不是」。
import './SourceBadge.css';
import type {
  PracticePoolSourceType,
  PracticePoolQualityFlag,
  DataQualityFlag,
} from '../../types/practicePool';

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

// 對**資料層詞彙**窮舉（Record 而非 Partial<Record>）—— 這是刻意的：
// 詞彙新增一個旗標卻忘了給說明，tsc 會當場擋下，而不是讓它在畫面上安靜消失。
// 先前是 Partial 且只寫了三個，於是 duplicate_topic 與所有失效型旗標
// （disputed / retired 等）標了等於沒標：題目離開計分池，使用者卻看不到任何說明。
// runtime-only 的 unmapped_subject 刻意不在這裡 —— 它是內部推導的分類狀態，
// 不是題目品質問題，不該對使用者出徽章。
const FLAG_LABEL: Record<DataQualityFlag, string> = {
  time_sensitive: '時效',
  low_confidence: '低信心',
  duplicate_topic: '主題重複',
  ambiguous: '爭議',
  disputed: '題目有爭議',
  disputed_answer: '答案有爭議',
  multiple_correct: '多重正解',
  unverifiable_evidence: '依據待查證',
  retired: '已退場',
};

export function SourceBadge({ sourceType, qualityFlags = [], compact = false }: SourceBadgeProps) {
  const meta = SOURCE_LABEL[sourceType];
  const isAI = sourceType === 'ai_generated';
  const title = isAI
    ? 'AI 產題：本題由語言模型產生。解析中「」括起來的法條原文已由 CI 逐字比對；' +
      '但「條號有沒有掛錯」「有沒有捏造機構名稱」機器驗不出來，我們也確實抓到過。' +
      '請以法規原文與官方教材為最終依據。（依 EU AI Act Art.50 揭露）'
    : '模擬題：來自第三方公開模擬題（vocus / HackMD / yamol 等），非官方歷屆試題，' +
      '其答案卡本身也可能有誤。';

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
