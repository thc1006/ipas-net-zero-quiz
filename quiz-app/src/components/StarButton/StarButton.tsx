// 星號按鈕（Discussion #1）：題卡與結果頁錯題卡共用。
// 名稱固定，狀態交給 aria-pressed；實心與空心是不同的圖形，不只靠顏色。用 SVG：圖示字型被擋時，
// material-icons 會變成一串文字壓到旁邊的旗標。
// 星號狀態不可以放進任何元件的 key：AnkiDroid 就是這樣讓按星號時選的答案被重設。
import { useReview } from '../../hooks/useReview';
import { isStarred, setStar } from '../../utils/review-storage';
import './StarButton.css';

interface StarButtonProps {
  questionId: string;
  /** 同一頁有好幾顆時要分得出題目（結果頁的錯題卡） */
  label?: string;
}

export function StarButton({ questionId, label = '加星號' }: StarButtonProps) {
  const starred = isStarred(useReview(), questionId);
  return (
    <button
      type="button"
      className="star-button"
      aria-pressed={starred}
      aria-label={label}
      onClick={() => setStar(questionId, !starred)}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <path
          d="M12 2.6l2.9 6.2 6.8.8-5 4.6 1.3 6.7-6-3.3-6 3.3 1.3-6.7-5-4.6 6.8-.8z"
          fill={starred ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export default StarButton;
