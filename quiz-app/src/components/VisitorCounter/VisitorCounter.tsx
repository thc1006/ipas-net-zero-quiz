// 訪客計數器元件
// 使用 CountAPI 替代服務進行真實計數
import { useEffect, useState } from 'react';
import './VisitorCounter.css';

interface VisitorCounterProps {
  /** 命名空間（用於區分不同網站） */
  namespace?: string;
  /** 計數器 key */
  counterKey?: string;
}

/**
 * 訪客計數器
 * 使用 api.counterapi.dev 進行真實計數
 */
export function VisitorCounter({
  namespace = 'thc1006-ipas-nz',
  counterKey = 'visits',
}: VisitorCounterProps) {
  const [count, setCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const sessionKey = `visited-${namespace}-${counterKey}`;
    const hasVisitedThisSession = sessionStorage.getItem(sessionKey);

    const fetchCount = async () => {
      try {
        // 使用 counterapi.dev (CountAPI 的替代服務)
        const endpoint = hasVisitedThisSession ? 'get' : 'up';
        const url = `https://api.counterapi.dev/v1/${namespace}/${counterKey}/${endpoint}`;

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Counter API error');
        }

        const data = await response.json();
        setCount(data.count);

        // 標記本次 session 已訪問，避免重複計數
        if (!hasVisitedThisSession) {
          sessionStorage.setItem(sessionKey, 'true');
        }
      } catch {
        // API 失敗時使用備用方案（localStorage 模擬）
        console.warn('Counter API unavailable, using local fallback');
        setError(true);
        fallbackCount();
      } finally {
        setIsLoading(false);
      }
    };

    // localStorage 備用計數
    const fallbackCount = () => {
      try {
        const storageKey = `visitor-count-${namespace}`;
        const currentCount = parseInt(localStorage.getItem(storageKey) || '1000', 10);

        if (!hasVisitedThisSession) {
          const newCount = currentCount + 1;
          localStorage.setItem(storageKey, String(newCount));
          sessionStorage.setItem(sessionKey, 'true');
          setCount(newCount);
        } else {
          setCount(currentCount);
        }
      } catch {
        setCount(null);
      }
    };

    // 稍微延遲避免閃爍
    const timer = setTimeout(fetchCount, 100);
    return () => clearTimeout(timer);
  }, [namespace, counterKey]);

  if (isLoading) {
    return (
      <span className="visitor-counter loading" aria-label="載入中">
        <span className="counter-icon">👥</span>
        <span className="count">...</span>
      </span>
    );
  }

  if (count === null) {
    return null;
  }

  return (
    <span
      className={`visitor-counter ${error ? 'fallback' : ''}`}
      aria-label={`訪客人次：${count}`}
      title={error ? '計數器服務暫時無法連線' : undefined}
    >
      <span className="counter-icon">👥</span>
      <span className="count">{count.toLocaleString()}</span>
      <span className="label">人次</span>
    </span>
  );
}

export default VisitorCounter;