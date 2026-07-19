// 訪客計數器元件
// 以 Abacus (jasoncameron.dev) 為主，counterapi.dev 為備援；皆失敗時不顯示。
import { useEffect, useRef, useState } from 'react';
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

/**
 * 模組級別：同一 app 生命週期內已 bump 或正在 bump 的 key。
 * 用於防 React 18 strict mode useEffect 雙觸發導致遠端計數 +2；
 * 並補充 sessionStorage（跨頁面 reload 生效）的 in-memory 快速查驗。
 */
const inflightOrBumpedKeys = new Set<string>();

function isAbortError(err: unknown): boolean {
  return (err as { name?: string })?.name === 'AbortError';
}

async function fromAbacus(
  ns: string,
  key: string,
  bump: boolean,
  signal: AbortSignal
): Promise<ProviderResult> {
  const endpoint = bump ? 'hit' : 'get';
  const url = `https://abacus.jasoncameron.dev/${endpoint}/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    if (endpoint === 'get' && res.status === 404) {
      // 首次 get 找不到 key → 轉 hit 建立；僅允許一次遞迴避免 stack 過深
      return fromAbacus(ns, key, true, signal);
    }
    throw new Error(`abacus ${res.status}`);
  }
  const data = (await res.json()) as { value?: number };
  if (typeof data.value !== 'number') throw new Error('abacus malformed');
  return { count: data.value, provider: 'abacus' };
}

async function fromCounterApi(
  ns: string,
  key: string,
  bump: boolean,
  signal: AbortSignal
): Promise<ProviderResult> {
  const endpoint = bump ? 'up' : 'get';
  const url = `https://api.counterapi.dev/v1/${encodeURIComponent(ns)}/${encodeURIComponent(key)}/${endpoint}`;
  const res = await fetch(url, { signal });
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
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    // deps 變更時重設 loading 旗標，避免顯示舊 count
    setIsLoading(true);

    const inflightKey = `${namespace}:${counterKey}`;
    const sessionKey = `visited-${namespace}-${counterKey}`;
    const visitedThisSession = sessionStorage.getItem(sessionKey) === 'true';
    const alreadyBumpedInApp = inflightOrBumpedKeys.has(inflightKey);
    // strict-mode 雙觸發時：第一次 effect 加 inflightKey；第二次 effect 看到 Set 裡已有
    // key，改走 get 只讀值，不 bump
    const shouldBump = !visitedThisSession && !alreadyBumpedInApp;
    if (shouldBump) inflightOrBumpedKeys.add(inflightKey);

    const ac = new AbortController();

    const run = async () => {
      try {
        const result = await fromAbacus(namespace, counterKey, shouldBump, ac.signal).catch(
          (err) => {
            if (isAbortError(err)) throw err;
            return fromCounterApi(namespace, counterKey, shouldBump, ac.signal);
          }
        );
        if (!isMountedRef.current) return;
        setCount(result.count);
        if (shouldBump) sessionStorage.setItem(sessionKey, 'true');
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        if (isMountedRef.current) setCount(null);
      } finally {
        if (isMountedRef.current) setIsLoading(false);
      }
    };

    const timer = setTimeout(run, 100);
    return () => {
      isMountedRef.current = false;
      clearTimeout(timer);
      ac.abort();
    };
  }, [namespace, counterKey]);

  if (isLoading) {
    return (
      <span className="visitor-counter loading" aria-label="載入中">
        <span className="counter-icon"></span>
        <span className="count">...</span>
      </span>
    );
  }

  if (count === null) return null;

  return (
    <span className="visitor-counter" aria-label={`訪客人次：${count}`}>
      <span className="counter-icon"></span>
      <span className="count">{count.toLocaleString()}</span>
      <span className="label">人次</span>
    </span>
  );
}

export default VisitorCounter;
