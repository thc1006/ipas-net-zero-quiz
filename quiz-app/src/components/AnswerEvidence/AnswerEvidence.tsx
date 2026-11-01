// 「答案依據」共用呈現。
//
// 為什麼要抽出來：QuestionCard 有引文＋出處連結，ResultPage 起初只印裸引文 ——
// 使用者複習錯題時反而最需要核對「憑什麼」，卻連來源都看不到。
// 兩個頁面各自手刻，很快就會長成兩種可信度不同的東西。
import { prettifySourceUrl } from '../../utils/source-label';
import './AnswerEvidence.css';

export interface AnswerEvidenceProps {
  evidence?: {
    quote: string;
    url: string;
    authority?: string;
    /**
     * 官方題目：這一題的引文裡有官方 PDF 上的這一題時（不一定是上面顯示的這一則），PDF 印的答案（公告試題的答案欄、
     * 參考樣題的「解答」）與題目出處（哪一場或哪一版、哪一科、第幾題）。顯示在引文的出處連結下面，連結跟著它的引文
     */
    official?: { kind: 'exam' | 'sample'; answer: string; reference: string };
  };
  /** 結果頁的錯題卡空間較窄，用較小的樣式 */
  compact?: boolean;
}

export function AnswerEvidence({ evidence, compact = false }: AnswerEvidenceProps) {
  if (!evidence) return null;

  // 一手來源才敢叫「答案依據」。次級來源（新聞、整理文章）只標「參考引文」——
  // 標題本身就是一種承諾，不該對不同等級的證據講同樣的話。
  const isPrimary = evidence.authority !== 'secondary';
  const label = isPrimary ? '答案依據' : '參考引文';

  return (
    <div
      className={`answer-evidence${compact ? ' answer-evidence--compact' : ''}`}
      aria-label={label}
    >
      <div className="answer-evidence__header">
        <span className="material-icons sm" aria-hidden="true">
          format_quote
        </span>
        <span>{label}</span>
        {!isPrimary && <span className="answer-evidence__grade">次級來源</span>}
      </div>
      <blockquote className="answer-evidence__quote">{evidence.quote}</blockquote>
      <a
        className="answer-evidence__link source-link"
        href={evidence.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {prettifySourceUrl(evidence.url)}
      </a>
      {/* 官方答案說的是這一題，不是上面那一則引文：放在引文的連結後面，連結才不會看起來是官方答案的出處 */}
      {evidence.official && (
        <p className="answer-evidence__official-answer">
          {evidence.official.kind === 'sample' ? '參考樣題的解答' : '官方公告的參考答案'}
          ：({evidence.official.answer})（{evidence.official.reference}）
        </p>
      )}
    </div>
  );
}

export default AnswerEvidence;
