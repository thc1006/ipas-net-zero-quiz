// quality_flags 的一致性規則 —— 主題庫與練習池「共用」。
//
// 為什麼抽出來：上一輪我在 dataset-integrity.test.ts 裡加了五道 quality_flags 的 gate，
// 但那個檔案**只 import integrated_dataset.json**。也就是說，那五道 gate
// **一題練習池都守不到**。
//
// 諷刺的是，question-integrity.ts 開頭那段註解早就警告過同一件事
// （「這個專案宣稱建了防雙欄錯置的 gate，但同樣的錯誤可以完整走進加強練習池」）——
// 我讀過它，然後又犯了一次。規則抽在這裡，兩邊一起套，才不會再出現「守了一半」。
//
// 這裡守的結構性危險：**季排程只檢查標了 time_sensitive 的題目。**
// 該標而沒標的題目，它的來源就算失效、法規就算修訂，**也不會有任何人知道** ——
// 「安靜地少報」。

import { hasPrimarySource, hostOf } from './source-authority';

export const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'time_sensitive',
  'ambiguous',
  'low_confidence',
  'duplicate_topic',
]);

/** 兩個題庫都能映射到的最小形狀。 */
export interface FlaggedItem {
  id: string;
  flags: readonly string[];
  sourceUrls: readonly string[];
  /** 內容查證到哪一天 */
  validAsOf?: string | null;
  /** 曾經被更正的答案（沒改過就是 null） */
  priorAnswer?: string | null;
}

export interface FlagCheckOptions {
  /**
   * validAsOf 這個欄位是不是「只有 time_sensitive 才該有」。
   *
   * 兩個題庫的語意不同，不能混為一談：
   *   - 主題庫 `metadata.valid_as_of` ——「這題的時效性內容查證到哪一天」，
   *     只標在 time_sensitive 題目上。沒標 time_sensitive 卻有這個欄位，
   *     會讓人以為查證過，但季排程根本不會去看它 → 要擋。
   *   - 練習池 `provenance.verified_date` ——「這題是什麼時候被驗過的」，
   *     每一題都有，本來就不限 time_sensitive → 不能擋。
   *
   * 我第一版把主題庫的規則直接套到練習池，結果 29 題全部誤報。
   */
  validAsOfOnlyForTimeSensitive?: boolean;
}

export interface FlagViolation {
  id: string;
  rule: string;
  detail: string;
}

/**
 * @param stableIds 「答案被改過，但不會再變」的登記清單。
 *   有些更正不是時間造成的（術語定義、歷史條約、鎖定版本的標準條文）——
 *   那些不該被迫標 time_sensitive，但**必須逐筆登記理由**，不能默默略過。
 */
export function checkFlags(
  items: readonly FlaggedItem[],
  stableIds: ReadonlySet<string> = new Set(),
  opts: FlagCheckOptions = {}
): FlagViolation[] {
  const { validAsOfOnlyForTimeSensitive = true } = opts;
  const v: FlagViolation[] = [];
  const push = (id: string, rule: string, detail: string) => v.push({ id, rule, detail });

  for (const it of items) {
    const flags = new Set(it.flags);
    const ts = flags.has('time_sensitive');

    // 1) 打錯字的 flag 等於沒有 flag —— 它不會觸發任何檢查，卻讓人以為標過了
    for (const f of it.flags) {
      if (!KNOWN_FLAGS.has(f)) push(it.id, 'unknown_flag', `未知的 flag「${f}」`);
    }

    // 2) time_sensitive 必須有至少一條「一手權威」來源。
    //    只有社群站是沒有意義的：季排程去檢查 vocus 還活著，
    //    無法告訴你環境部的指引有沒有改。
    if (ts && !hasPrimarySource(it.sourceUrls)) {
      const hosts = it.sourceUrls.map(hostOf).filter(Boolean).join(', ') || '（無來源）';
      push(it.id, 'time_sensitive_without_primary_source', `來源只有 ${hosts}`);
    }

    // 3) time_sensitive 必須有 valid_as_of —— 否則無從判斷「查證到哪一天」
    if (ts && !it.validAsOf) {
      push(it.id, 'time_sensitive_without_valid_as_of', '標了 time_sensitive 卻沒有 valid_as_of');
    }

    // 4) 反過來：沒標 time_sensitive 就不該有 valid_as_of。
    //    否則它看起來像「查證過」，但季排程根本不會去看它。
    //    （只對主題庫成立 —— 練習池的 verified_date 每題都有，見 FlagCheckOptions。）
    if (validAsOfOnlyForTimeSensitive && !ts && it.validAsOf) {
      push(
        it.id,
        'valid_as_of_without_time_sensitive',
        `valid_as_of=${it.validAsOf} 但沒標 time_sensitive —— 季排程看不到這題`
      );
    }

    // 5) 答案曾被更正 == 這題的答案「證明過會變」。
    //    要嘛標 time_sensitive，要嘛登記「為什麼不會再變」。
    if (it.priorAnswer != null && !ts && !stableIds.has(it.id)) {
      push(
        it.id,
        'corrected_but_unwatched',
        `答案已從 ${it.priorAnswer} 改過一次，卻既沒標 time_sensitive、也沒登記「為什麼不會再變」`
      );
    }
  }
  return v;
}

export const formatFlagViolations = (vs: readonly FlagViolation[]): string =>
  vs.map((x) => `  [${x.rule}] ${x.id} — ${x.detail}`).join('\n');
