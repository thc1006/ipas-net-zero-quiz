// 「不用會，也能猜對」—— 選項本身洩漏答案的程度。
//
// 為什麼要量它：一個備考工具最糟糕的失敗，不是「答案錯了」，而是
// **使用者靠著出題的破綻答對，然後以為自己會了**。分數被灌水，而他什麼都沒學到。
//
// 最常見的破綻是**長度**：正解為了把話講完整，往往寫得比誘答長一大截。
// 實測（2026-07-14）：
//
//   練習池 AI 產題      「無腦選最長」得分率 = **66.7%**   ← 亂猜是 25%
//   主題庫 重建題                              58.8%
//   主題庫 gist（社群考古題）                    45.9%
//   練習池 公開模擬題                            43.4%
//
// **AI 產題把「正解比每個誘答都長 2.2 倍以上」的比例推到 30.3%，
//   而社群考古題只有 0.2% —— 150 倍。這是生成時的指紋，不是統計波動。**
//
// ⚠️ 這個檢查抓不到「答案是錯的」—— 它抓的是另一種病：**題目出得太爛，
//    以至於答案對不對已經不重要了。** 兩種病要分開看。
//
// ⚠️ 這裡是**唯一一份實作**。README 上的數字由 gate 直接對著資料算出來比對，
//    不另外存一個 meta 數字 —— **兩份實作一定會漂。**

export interface LeakItem {
  answer?: string | null;
  options: { key: string; text: string }[];
}

/** 比較長度用的正規化：剝掉標點與空白，只算實際的字。 */
const len = (t: string): number => t.replace(/[\p{P}\p{Z}\s]+/gu, '').length;

/**
 * 「無腦選最長」的得分率 —— 完全不看題目、每題直接挑最長的選項，能對幾成？
 *
 * 25% = 沒有洩漏（等同亂猜）。越高，代表選項的長度越洩漏答案。
 */
export function longestOptionScore(items: readonly LeakItem[]): { hit: number; n: number } {
  let hit = 0;
  let n = 0;
  for (const it of items) {
    if (!it.answer || (it.options?.length ?? 0) < 4) continue;
    n += 1;
    let best = it.options[0];
    for (const o of it.options) {
      if (len(o.text) > len(best.text)) best = o;
    }
    if (best.key === it.answer) hit += 1;
  }
  return { hit, n };
}

/**
 * 「正解比**每一個**誘答都長 ratio 倍以上」的題數 —— 最露骨的那一種。
 * 這種題目，使用者不看內容就能答對。
 */
export function blatantLengthTells(items: readonly LeakItem[], ratio = 2.2, minLen = 25): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (!it.answer || (it.options?.length ?? 0) < 4) continue;
    const ans = it.options.find((o) => o.key === it.answer);
    if (!ans) continue;
    const a = len(ans.text);
    if (a < minLen) continue;
    const longestOther = Math.max(...it.options.filter((o) => o.key !== it.answer).map((o) => len(o.text)));
    if (a >= ratio * longestOther) out.push(it.answer);
  }
  return out;
}
