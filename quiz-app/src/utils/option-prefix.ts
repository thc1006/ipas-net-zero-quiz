// 偵測選項中冗餘的共同前綴關鍵字（例如題幹已說「GRI 準則」，每個選項又重複
// 以「GRI ...」開頭）。讓 UI 把這個前綴 dim 化降低視覺噪音。
//
// 設計：找最長共同 starting string，trim 結尾分隔符（半形 + CJK 標點 + 空白），
// 必須出現在 stem 才視為冗餘。

/** trim 用的分隔字元集：半形 whitespace + CJK 標點 + 半形標點 */
const TRIM_SEP_RE = /[\s、，；。：（）「」『』,;.:()[\]{}!?！？]+$/;

/** 找出兩字串的最長共同 starting string */
function commonStartingString(a: string, b: string): string {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return a.slice(0, i);
}

/**
 * 找出選項中冗餘的共同前綴。
 *
 * @returns 共同前綴字串（已 trim 結尾分隔符），若無則 null。
 *
 * 演算法：
 * 1. 從第一個選項開始，跟其他每個選項算 commonStartingString
 * 2. 取所有 pairwise 結果的最短 = 全體共同 prefix
 * 3. trim 結尾分隔符（避免「GRI 」勾留 trailing space）
 * 4. ≥2 字元 AND stem 包含此 prefix → 回傳；否則 null
 *
 * 處理 CJK punctuation：例「GRI、環境」「GRI、社會」commonStartingString 是
 * 「GRI、」trim 後得「GRI」。
 */
export function findRedundantPrefix(
  stem: string,
  optionTexts: readonly string[],
): string | null {
  if (optionTexts.length < 2) return null;
  if (optionTexts.some((t) => t.length === 0)) return null;

  // 任一選項以分隔符開頭 → 視為破壞共享（避免空 prefix）
  if (optionTexts.some((t) => /^[\s、，；。：（）「」『』,;.:!?！？]/.test(t))) return null;

  // pairwise 求最長共同 starting string
  let common = optionTexts[0];
  for (let i = 1; i < optionTexts.length; i++) {
    common = commonStartingString(common, optionTexts[i]);
    if (common.length === 0) return null;
  }

  // trim trailing 分隔符
  const trimmed = common.replace(TRIM_SEP_RE, '');
  if (trimmed.length < 2) return null;

  // 整選項 == prefix → 該選項沒剩餘內容，不適合 dim
  if (optionTexts.some((t) => t === trimmed || t === common)) return null;

  // 必須出現在 stem 才算冗餘（防止選項是必要 disambiguation marker）
  if (!stem.includes(trimmed)) return null;

  return trimmed;
}
