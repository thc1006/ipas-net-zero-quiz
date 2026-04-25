// 偵測選項中冗餘的共同前綴關鍵字（例如題幹已說「GRI 準則」，每個選項又重複
// 以「GRI ...」開頭）。讓 UI 把這個前綴 dim 化降低視覺噪音。
//
// 設計：保守取「所有選項的第一個 whitespace-separated 詞」作為 prefix，
// 並僅當該詞同時出現在 stem 才視為冗餘（否則可能是必要 disambiguation）。

/**
 * 找出選項中冗餘的共同前綴（一或多個 whitespace-separated 詞）。
 *
 * @returns 共同前綴字串（不含 trailing whitespace），若無則 null。
 *
 * 演算法：
 * 1. 把每個選項拆 token（splitting on \s+）
 * 2. 從左找最長共同 token 序列（multi-token）
 * 3. 整段 join 後若 ≥2 字元 AND stem 包含該整段 → 回傳；否則 null
 */
export function findRedundantPrefix(
  stem: string,
  optionTexts: readonly string[],
): string | null {
  if (optionTexts.length < 2) return null;

  // 拆每個選項為 token 陣列；以 leading whitespace 為偏離信號 → reject
  const tokenized = optionTexts.map((t) => {
    if (/^\s/.test(t)) return null; // leading whitespace → 視為破壞共享
    return t.split(/\s+/).filter((tok) => tok.length > 0);
  });
  if (tokenized.some((toks) => toks === null || toks.length === 0)) return null;

  const tokens0 = tokenized[0] as string[];

  // 找最長共同 token 序列
  let commonLen = 0;
  for (let i = 0; i < tokens0.length; i++) {
    const tok = tokens0[i];
    const allMatch = tokenized.every((toks) => (toks as string[])[i] === tok);
    if (!allMatch) break;
    commonLen = i + 1;
  }
  if (commonLen === 0) return null;

  // 不能整個選項都是 prefix（commonLen === tokens.length 表示某選項只有 prefix 本身）
  // 若任一選項長度等於 commonLen，說明該選項只有 prefix 沒其他內容 → 不適合 dim
  if (tokenized.some((toks) => (toks as string[]).length === commonLen)) return null;

  const prefix = tokens0.slice(0, commonLen).join(' ');
  if (prefix.length < 2) return null; // 太短不 dim
  if (!stem.includes(prefix)) return null; // 必須出現在 stem 才算冗餘

  return prefix;
}
