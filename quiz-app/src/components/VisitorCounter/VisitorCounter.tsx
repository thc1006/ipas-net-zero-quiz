// 訪客計數器元件
// 使用免費的計數器 API（可選用多種服務）
import { useEffect, useState } from 'react';
import './VisitorCounter.css';

interface VisitorCounterProps {
  /** 計數器 ID（用於區分不同網站） */
  siteId?: string;
}

/**
 * 訪客計數器
 * 使用 localStorage 模擬計數（GitHub Pages 無後端）
 * 實際部署時可替換為真實計數器服務
 */
export function VisitorCounter({ siteId = 'ipas-quiz' }: VisitorCounterProps) {
  const [count, setCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 簡易計數邏輯（使用 localStorage 模擬）
    // 實際部署時可替換為 CountAPI、Visitor Badge 等服務
    const storageKey = `visitor-count-${siteId}`;
    const lastVisitKey = `last-visit-${siteId}`;

    const updateCount = () => {
      try {
        // 取得目前計數
        const currentCount = parseInt(localStorage.getItem(storageKey) || '0', 10);
        const lastVisit = localStorage.getItem(lastVisitKey);
        const now = new Date().toDateString();

        // 如果是今天第一次訪問，增加計數
        if (lastVisit !== now) {
          const newCount = currentCount + 1;
          localStorage.setItem(storageKey, String(newCount));
          localStorage.setItem(lastVisitKey, now);
          setCount(newCount);
        } else {
          setCount(currentCount);
        }
      } catch {
        // localStorage 不可用時的處理
        setCount(null);
      } finally {
        setIsLoading(false);
      }
    };

    // 稍微延遲以避免閃爍
    const timer = setTimeout(updateCount, 100);
    return () => clearTimeout(timer);
  }, [siteId]);

  if (isLoading) {
    return (
      <span className="visitor-counter loading" aria-label="載入中">
        <span className="material-icons sm">people</span>
        <span className="count">...</span>
      </span>
    );
  }

  if (count === null) {
    return null;
  }

  return (
    <span className="visitor-counter" aria-label={`訪客人次：${count}`}>
      <span className="material-icons sm">people</span>
      <span className="count">{count.toLocaleString()}</span>
      <span className="label">人次</span>
    </span>
  );
}

export default VisitorCounter;
