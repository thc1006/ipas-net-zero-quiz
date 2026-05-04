// 每題作答統計（Refs #64）— React 端讀取 + 跨 tab 同步
//
// 動機：QuestionCard / ResultPage 原本 mount 時讀一次 localStorage，
// 若使用者另開分頁清除 stats 或完成另一份 quiz，當前分頁不會更新。
// 透過 `storage` 事件（瀏覽器只在「其他 tab」改 storage 時觸發）即時同步。
import { useEffect, useState } from 'react';
import { loadStats, type QuestionStat } from '../utils/question-stats-storage';

const STORAGE_KEY = 'ipas-question-stats';

/** Returns the full stats dict; refreshes when another tab updates storage. */
export function useAllQuestionStats(): Record<string, QuestionStat> {
  const [stats, setStats] = useState<Record<string, QuestionStat>>(() => loadStats());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      // e.key === null：另一 tab 呼叫 localStorage.clear()
      // e.key === STORAGE_KEY：另一 tab 改了我們這支 key
      if (e.key === STORAGE_KEY || e.key === null) {
        setStats(loadStats());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return stats;
}
