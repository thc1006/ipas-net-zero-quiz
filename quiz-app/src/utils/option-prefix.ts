// 偵測選項中冗餘的共同前綴關鍵字（例如題幹已說「GRI 準則」，每個選項又重複
// 以「GRI ...」開頭）。讓 UI 把這個前綴 dim 化降低視覺噪音。
//
// 設計：保守取「所有選項的第一個 whitespace-separated 詞」作為 prefix，
// 並僅當該詞同時出現在 stem 才視為冗餘（否則可能是必要 disambiguation）。

/**
 * 找出選項中冗餘的共同首字（首詞）。
 *
 * @returns 共同前綴字串（不含 trailing whitespace），若無則 null。
 */
export function findRedundantPrefix(
  stem: string,
  optionTexts: readonly string[],
): string | null {
  if (optionTexts.length < 2) return null;

  // 取每個選項的第一個 non-whitespace token
  const firstWords = optionTexts.map((t) => {
    const m = t.match(/^(\S+)/);
    return m ? m[1] : null;
  });

  // 任一選項無法 match（空字串 / 開頭 whitespace） → 不算共享
  if (firstWords.some((w) => w === null)) return null;

  const candidate = firstWords[0]!;
  if (candidate.length < 2) return null; // 單字元 prefix 不 dim 避免過度

  const allShare = firstWords.every((w) => w === candidate);
  if (!allShare) return null;

  // 僅當 stem 包含此 token 才算冗餘（否則可能是必要 marker）
  if (!stem.includes(candidate)) return null;

  return candidate;
}
