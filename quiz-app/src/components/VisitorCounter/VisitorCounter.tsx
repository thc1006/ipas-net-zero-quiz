// 訪客計數器元件
// 以 Abacus (jasoncameron.dev) 為主，counterapi.dev 為備援；皆失敗時不顯示。
import { useEffect, useState } from 'react';
import './VisitorCounter.css';

interface VisitorCounterProps {
  /** 命名空間（用於區分不同網站） */
  namespace?: string;
  /** 計數器 key */
  counterKey?: string;
}

type Provider = 'abacus' | 'counterapi';

interface ProviderResult {
  count: number;
  provider: Provider;
}

async function fromAbacus(ns: string, key: string, bump: boolean): Promise<ProviderResult> {
  const endpoint = bump ? 'hit' : 'get';
  const url = `https://abacus.jasoncameron.dev/${endpoint}/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) {
    // 首次呼叫 get 會是 404，改用 hit 建立並遞增
    if (endpoint === 'get' && res.status === 404) {
      return fromAbacus(ns, key, true);
    }
    throw new Error(`abacus ${res.status}`);
  }
  const data = (await res.json()) as { value?: number };
  if (typeof data.value !== 'number') throw new Error('abacus malformed');
  return { count: data.value, provider: 'abacus' };
}

async function fromCounterApi(ns: string, key: string, bump: boolean): Promise<ProviderResult> {
  const endpoint = bump ? 'up' : 'get';
  const url = `https://api.counterapi.dev/v1/${encodeURIComponent(ns)}/${encodeURIComponent(key)}/${endpoint}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`counterapi ${res.status}`);
  const data = (await res.json()) as { count?: number };
  if (typeof data.count !== 'number') throw new Error('counterapi malformed');
  return { count: data.count, provider: 'counterapi' };
}

export function VisitorCounter({
  namespace = 'thc1006-ipas-nz',
  counterKey = 'visits',
}: VisitorCounterProps) {
  const [count, setCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const sessionKey = `visited-${namespace}-${counterKey}`;
    const visitedThisSession = sessionStorage.getItem(sessionKey) === 'true';
    const shouldBump = !visitedThisSession;

    const run = async () => {
      try {
        const result = await fromAbacus(namespace, counterKey, shouldBump).catch(() =>
          fromCounterApi(namespace, counterKey, shouldBump)
        );
        setCount(result.count);
        if (shouldBump) sessionStorage.setItem(sessionKey, 'true');
      } catch {
        // 所有計數服務皆失敗：不顯示假數字，直接隱藏元件
        setCount(null);
      } finally {
        setIsLoading(false);
      }
    };

    const timer = setTimeout(run, 100);
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

  if (count === null) return null;

  return (
    <span className="visitor-counter" aria-label={`訪客人次：${count}`}>
      <span className="counter-icon">👥</span>
      <span className="count">{count.toLocaleString()}</span>
      <span className="label">人次</span>
    </span>
  );
}

export default VisitorCounter;
