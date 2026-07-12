// 題目結構完整性 —— 主題庫與練習池「共用」的規則。
//
// 為什麼要共用：dataset-integrity.test.ts 原本只 import integrated_dataset.json，
// 所以那道 gate 只守得住主題庫。實測把一筆「雙欄錯置」樣式的髒資料塞進 practice_pool
// （3 個選項、內嵌換行、PDF 頁首頁尾、answer 根本不在選項裡、sources 不是 URL、
// 標了 time_sensitive 卻沒有可驗證來源），**全套 475 條測試沒有任何一條抓到**。
//
// 也就是說：這個專案宣稱建了防雙欄錯置的 gate，但同樣的錯誤可以完整走進加強練習池。
// 規則抽在這裡，兩邊一起套，才不會再出現「守了一半」的情況。
//
// 這些規則對現有資料是零破壞的（主題庫 783 題 + 練習池 157 題全數通過），
// 所以可以當成硬性 gate 而非警告。

/** 兩個題庫都能映射到的最小共同形狀 */
export interface IntegrityQuestion {
  id: string;
  stem: string;
  options: { key: string; text: string }[];
  /** null 代表刻意不給答案（必須同時標 'ambiguous'，見下方規則） */
  answer: string | null | undefined;
  qualityFlags: string[];
  /** 所有可驗證的來源 URL（主題庫取 source.url + metadata.sources；練習池取 sources） */
  sourceUrls: string[];
}

export interface Violation {
  id: string;
  rule: string;
  detail: string;
}

/**
 * 來源 PDF 的頁首/頁尾。這正是雙欄錯置留下的指紋 —— 它們絕不該出現在題幹或選項裡。
 * 注意：只比對「頁面裝飾」字樣，不要比對正常會出現在題目中的字（例如「商研院」單獨
 * 出現在某題選項裡是合法的），所以綁定到實際的頁尾格式。
 */
const PDF_FURNITURE: readonly RegExp[] = [
  /ML\s*\(?\s*2024\.08\.16/,
  /淨零碳規劃管理基礎概論\s*-\s*模擬試題/,
  /溫室氣體盤查規範與程序概要\s*-\s*模擬試題/,
  /\(\s*商研院\s*2024\.08\s*\)/,
];

const EXPECTED_KEYS = ['A', 'B', 'C', 'D'] as const;

const isHttpUrl = (u: unknown): u is string =>
  typeof u === 'string' && /^https?:\/\//.test(u);

/** 對單一題目跑完所有共用規則，回傳所有違規（不是遇到第一個就停）。 */
export function checkQuestion(q: IntegrityQuestion): Violation[] {
  const v: Violation[] = [];
  const push = (rule: string, detail: string) => v.push({ id: q.id, rule, detail });

  // 1) 恰好四個選項，key 為 A/B/C/D，不重複、不亂序
  const keys = q.options.map((o) => o.key);
  if (keys.length !== 4 || keys.join('') !== EXPECTED_KEYS.join('')) {
    push('options_shape', `期望 A,B,C,D，實際 [${keys.join(',')}]`);
  }

  // 2) 答案必須落在選項裡。唯一例外：明確標 'ambiguous' 的題目「必須」沒有答案
  //    —— 題庫不能對互斥命題同時給出確定答案；標了瑕疵卻照常計分是最糟的組合。
  const ambiguous = q.qualityFlags.includes('ambiguous');
  const hasAnswer = q.answer !== null && q.answer !== undefined && q.answer !== '';
  if (ambiguous && hasAnswer) {
    push('ambiguous_must_have_no_answer', `標了 ambiguous 卻仍有答案 ${q.answer}`);
  }
  if (!ambiguous && !hasAnswer) {
    push('missing_answer', '沒有答案，且未標 ambiguous');
  }
  if (hasAnswer && !keys.includes(q.answer as string)) {
    push('answer_not_in_options', `answer=${q.answer}，選項只有 [${keys.join(',')}]`);
  }

  // 3) 題幹/選項不得含換行 —— 這是雙欄擷取沒清乾淨的殘留
  const texts = [q.stem, ...q.options.map((o) => o.text)];
  if (texts.some((t) => /[\r\n]/.test(t))) {
    push('embedded_newline', '題幹或選項含換行');
  }

  // 4) 題幹/選項不得含 PDF 頁首頁尾
  const hit = PDF_FURNITURE.find((re) => texts.some((t) => re.test(t)));
  if (hit) {
    push('pdf_furniture', `含來源 PDF 的頁面裝飾：${hit.source}`);
  }

  // 5) 題幹與每個選項都不得為空白
  if (!q.stem.trim()) push('empty_stem', '題幹為空');
  if (q.options.some((o) => !o.text.trim())) push('empty_option', '有選項為空');

  // 6) 所有來源都必須是 http(s) URL（否則 quarterly workflow 根本 curl 不了）
  const bad = q.sourceUrls.filter((u) => !isHttpUrl(u));
  if (bad.length) {
    push('source_not_url', `非 http(s) 來源：${bad.join(', ')}`);
  }

  // 7) 標了 time_sensitive 就必須至少有一條可驗證的 URL。
  //    標「這題會過期」卻不給任何驗證途徑，等於沒標 —— quarterly workflow 只看得到有 URL 的題目。
  if (q.qualityFlags.includes('time_sensitive') && !q.sourceUrls.some(isHttpUrl)) {
    push('time_sensitive_without_source', 'time_sensitive 但沒有任何 http(s) 來源 URL');
  }

  return v;
}

/** 對一批題目跑規則，回傳全部違規。 */
export function checkAll(qs: IntegrityQuestion[]): Violation[] {
  return qs.flatMap(checkQuestion);
}

/** 把違規整理成一眼可讀的字串，測試失敗時直接指到問題題目。 */
export function formatViolations(vs: Violation[]): string {
  return vs.map((x) => `  [${x.rule}] ${x.id} — ${x.detail}`).join('\n');
}
