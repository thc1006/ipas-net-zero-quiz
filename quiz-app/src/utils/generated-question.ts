// 「AI 生成相似題」的題幹是不是和原題很像（#148）。
//
// 結果頁把 AI 產的題目放在原題那張錯題卡裡。模型回一道題幹很像、答案卻不同的題目時，學員可能以為原題的
// 答案變了。prompt 已經要求換情境、不要沿用原題的句子，但模型不一定照做，所以畫面上再比一次：很像時多一句
// 提醒，內容照樣顯示。比對只看字面，抓不到換句話說的改寫，所以畫面上的說明不能因為沒有提醒就說兩題無關。
import { stemSimilarity } from './question-identity';

/**
 * 題幹相似度（stemSimilarity，正規化後字元二元組的 Dice）到這個值就提醒。
 *
 * 2026-11-01 拿主題庫與練習池 1137 道題幹兩兩比對（題幹正規化後相同的不算；選項文字也先用 normalizeText 的同一套
 *   規則正規化再比相不相同）：
 *   - 誤報：沒有任何選項文字相同的 644,216 對裡，有 437 對到 0.5（0.07%）；只看 Dice 0.3 以上、
 *     字面本來就相近的 3,118 對，是 14%。誤報的代價是多一句提醒。
 *   - 漏報：正解文字相同、四個選項至少三個相同的 39 對（大多是同一題換句話說，也有只是共用年份或數字
 *     選項的不同題）有 24 對低於 0.5。改寫幅度大的（gist-150 與 gist-315，Dice 0.23），字面比對抓不到。
 *   - q006 的五種寫法：拿掉英文註記改「錯誤」（0.642）、加引號改「錯誤」（0.585）、前面加一大段情境
 *     （0.545）會提醒；只留後半句（0.344）、換成「有關溫室氣體盤查的…」（0.254）不會。
 * 0.55 起會漏掉前面加一大段情境的寫法；0.45 的誤報多五成（648 對），漏報與 q006 的結果都沒有變好。所以取 0.5。
 */
export const ECHO_SIMILARITY_LIMIT = 0.5;

/** 去掉 Markdown 的標題、引用、清單記號與粗體斜體記號（* 與 _）：判斷標籤時，「**題目：**」「__題目__：」與「題目：」一樣 */
function plain(line: string): string {
  return line.replace(/[*_]{1,3}/g, '').replace(/^[#>\-\s]+/u, '').trim();
}

/**
 * 新題目的標籤：「題目：」「新題目：」「新的題目：」「題幹:」「題目 1：」「題目（新）：」「新題目如下：」「【題目】」「【新題】」
 * 「Question:」「New question:」，前面可以有編號。標籤後面沒有冒號時，那一行只能有標籤（「### 新題目」）。
 */
const LABEL =
  /^(?:\d+\s*[.、)）]\s*)?(?:【(?:新題目|新題|題目|題幹)】|(?:新的題目|新題目|題目|題幹|new question|question)(?:\s*\d+|（新）|如下)?\s*(?:[:：]|$))\s*/iu;
/** 引用或複述原題的行：「原題：」「原題目」「參考原題：」「【原題】」「原題問的是…」「Original question:」。這一行不是新題目 */
const ORIGINAL = /^(?:\d+\s*[.、)）]\s*)?(?:【原題目?】|參考原題|原題|original question)/iu;
/** 只有引用原題標籤的一行（「### 原題」「**原題目：**」）：底下那一段都是引用 */
const ORIGINAL_ONLY = /^(?:\d+\s*[.、)）]\s*)?(?:【原題目?】|參考原題目?|原題目?|original question)\s*[:：]?$/iu;
/**
 * 只看回覆的前這麼多字。prompt 要的回覆是一道題，幾百字；模型失控或惡意的長回覆不該讓畫面卡住，
 * 題幹也一定在前面。
 */
export const MAX_REPLY_CHARS = 20_000;
/** 答案、解析：題幹到這裡為止 */
const AFTER_STEM = /^(?:正確答案|答案|解析)\s*[:：]/u;

/**
 * 選項的代號（先 NFKC，全形字母與標點當成半形）：字母 A 到 D（大小寫都算），可加「選項」、括號，後面接標點或空格；
 * 或數字 1 到 4，寫成「(1)」或「1.」「1、」。
 */
function optionKey(line: string): { letter: number } | { number: number } | null {
  const t = line.normalize('NFKC');
  const m = /^(?:選項\s*)?\(?([A-Da-d])(?:\)|[.、:：]|\s)/u.exec(t);
  if (m) return { letter: 'abcd'.indexOf(m[1].toLowerCase()) };
  const n = /^(?:\(([1-4])\)|([1-4])[.、)])/u.exec(t);
  if (n) return { number: Number(n[1] ?? n[2]) };
  return null;
}

/**
 * 回覆裡每一組選項的頭尾行號（start 是 A 或 1 那一行，end 是最後一個選項那一行）。字母要從 A 開始、下一個非空行接 B，
 * 再往下接 C、D；數字要 1、2、3、4 連著四個非空行。選項之間可以空行。只有一行「A.」或「A、B 兩家公司…」這種題幹開頭，
 * 都不算選項。原題與新題各附一組選項時，兩組都要認得：只認第一組，新題的題幹會一路連進它的選項。
 */
function optionBlocks(lines: string[]): { start: number; end: number }[] {
  const key = lines.map(optionKey);
  const filled = lines.map((_, k) => k).filter((k) => lines[k] !== '');
  const at = (n: number, kind: 'letter' | 'number', v: number): boolean => {
    const k = key[filled[n]];
    return !!k && kind in k && (k as Record<string, number>)[kind] === v;
  };
  const blocks: { start: number; end: number }[] = [];
  for (let n = 0; n < filled.length; n++) {
    let len = 0;
    if (at(n, 'letter', 0) && at(n + 1, 'letter', 1)) {
      len = 2;
      while (len < 4 && at(n + len, 'letter', len)) len++;
    } else if ([0, 1, 2, 3].every((d) => at(n + d, 'number', d + 1))) {
      len = 4;
    }
    if (len) {
      blocks.push({ start: filled[n], end: filled[n + len - 1] });
      n += len - 1;
    }
  }
  return blocks;
}

/**
 * 四個選項寫在同一行（「(A) 甲 (B) 乙 (C) 丙 (D) 丁」）時，從每一個選項代號切成一行，前面的題幹自成一行。
 * 先 NFKC。代號寫成「(A)」或「A.」「A、」「A:」（可加「選項」），前面是行首或不是英數字的字；要有 A 與 B、
 * 同一種寫法、照順序、每兩個代號中間都有字，才算選項。「A、B、C 三家公司」（中間沒有字）、「A、B 兩家」（寫法不同）
 * 都不切。數字（1 到 4）也一樣，但要四個都在，而且後面沒有同一種寫法的 5 以上（題幹裡列的步驟）。沒有切就回傳原本那一行。
 */
function splitOneLineOptions(line: string): string[] {
  const t = line.normalize('NFKC');
  const marks: { at: number; end: number; key: string; form: string }[] = [];
  const re = /(^|[^A-Za-z0-9])((?:選項\s*)?(?:\(([A-Da-d1-9])\)|([A-Da-d1-9])([.、:])))/gu;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const at = m.index + m[1].length;
    marks.push({ at, end: at + m[2].length, key: (m[3] ?? m[4]).toLowerCase(), form: m[3] ? '()' : m[5] });
    re.lastIndex = at + m[2].length;
  }
  for (const keys of ['abcd', '1234']) {
    const need = keys === 'abcd' ? 2 : 4;
    for (let i = 0; i < marks.length; i++) {
      if (marks[i].key !== keys[0]) continue;
      const run = [marks[i]];
      // 遇到下一個同一種寫法的 A（或 1）就換它當開頭：每個代號最多被每一種寫法看一次，長的一行也不會變成平方的時間
      const sameStart = (r: (typeof marks)[number]) => r.key === keys[0] && r.form === marks[i].form;
      for (let j = i + 1; j < marks.length && run.length < 4 && !sameStart(marks[j]); j++) {
        const prev = run[run.length - 1];
        if (marks[j].key === keys[run.length] && marks[j].form === marks[i].form && t.slice(prev.end, marks[j].at).trim()) {
          run.push(marks[j]);
        }
      }
      if (run.length < need) continue;
      // 數字後面還有同一種寫法的 5、6……：那是題幹裡列的步驟，不是四個選項
      if (keys === '1234' && marks.some((r) => r.at > run[3].at && r.form === marks[i].form && /^[5-9]$/u.test(r.key))) continue;
      const cuts = run.map((r) => r.at);
      // NFKC 沒有改變長度時切原文（全形標點照原樣）；長度變了（例如「㎡」）才切 NFKC 之後的字
      const src = t.length === line.length ? line : t;
      const parts = [src.slice(0, cuts[0]), ...cuts.map((c, k) => src.slice(c, cuts[k + 1] ?? src.length))];
      return parts.map((x) => x.trim()).filter((x) => x !== '');
    }
  }
  return [line];
}

/**
 * 回覆裡 AI 新題目的題幹。選項、答案、解析都不算，裡面常有原題的片段（標準名稱、選項文字），拿來比只會誤報。
 *   1. prompt 要求的格式（第一行是「題目：」接題幹）以及其他題目標籤（LABEL）：取標籤後面的字，連同下面的行，
 *      到空行、選項、答案、解析、引用原題或下一個標籤之前為止（題幹分成兩行時一起算）。
 *   2. 沒有標籤：從第一組不是引用的選項往上取一段，到空行、引用原題的那一行、上一組選項、Markdown 標題或回覆開頭為止。
 *   3. 也沒有選項：取第一個非空、不是引用原題的行。
 * 只看前 MAX_REPLY_CHARS 字；四個選項寫在同一行時，先切成一行一個（splitOneLineOptions）。每一組選項都認得（optionBlocks）。
 * 引用原題的行（ORIGINAL）一律不算題幹；只有引用標籤的一行（「### 原題」）底下那一段，到空行、下一個 Markdown 標題，
 * 或原題底下另起的題目標籤為止，也都是引用。緊接在引用標籤下的「題目：」是原題自己的標籤，不算新題目。緊接在引用後面的
 * 那一組選項是原題的選項，也算引用。
 *
 * 已知取錯的情形：
 *   - 沒有標籤、開場白緊接在題幹上面（沒有空行）：開場白會跟題幹算成同一段。照抄原題時兩行合起來仍然很像
 *     （q006 加一句開場白在 0.8 以上），開場白很長時相似度會被沖淡。
 *   - 有標籤、題幹後面緊接提示或說明（沒有空行，也不是「答案：」「解析：」開頭）：會連進題幹，相似度被沖淡
 *     （q006 接一段 60 多字的說明，降到 0.64）。
 *   - 選項只寫了一行、或字母不是從 A 接 B（例如從 B 開始）、數字不是 1 到 4 連著四行：不算選項，會連進題幹。
 *     從 B 開始的照抄，相似度被沖淡到門檻以下的情形，題庫 1137 題裡有 248 題（2026-11-01 實測）。
 *   - 沒有標籤也沒有選項：開場白會被當成題幹。
 *   - 題幹分成幾行，一行「A：…」或「A 公司…」接一行「B：…」或「B 公司…」（對話、分行列舉）：會被當成選項，
 *     取到的不是題幹（題庫的題幹都只有一行）。
 *   - 只有引用標籤的一行（「原題：」）、底下是原題、再下面緊接新題目或照抄的題幹，中間沒有空行也沒有題目標籤：
 *     整段都算引用，取不到題幹，不會提醒。
 *   - 「題目」以外的標籤（例如「練習題：」）不認得，走第 2 或第 3 條。
 * 題庫 1137 題的照抄回覆寫成 generated-question.test.ts 的全庫測試，每一題都取到題幹原文：選項一行一個的 15 種寫法、
 * 用每一題自己的選項文字寫在同一行的 3 種寫法（都分有標籤、沒有標籤），以及先引用原題（連同選項）再照抄的 4 種回覆。
 */
export function generatedStem(content: string): string | null {
  const raw: string[] = [];
  const lines: string[] = [];
  for (const r of content.slice(0, MAX_REPLY_CHARS).split('\n')) {
    for (const piece of splitOneLineOptions(plain(r))) {
      raw.push(r);
      lines.push(piece);
    }
  }
  const blocks = optionBlocks(lines);
  const blockAt = new Map(blocks.map((b) => [b.start, b]));
  const inBlock = lines.map(() => false);
  for (const b of blocks) for (let k = b.start; k <= b.end; k++) inBlock[k] = true;
  // 引用原題的行，連同底下的段落與緊接著的那一組選項，都是引用
  const quoted = lines.map(() => false);
  for (let i = 0; i < lines.length; i++) {
    if (!ORIGINAL.test(lines[i])) continue;
    quoted[i] = true;
    let k = i + 1;
    if (ORIGINAL_ONLY.test(lines[i])) {
      // 到空行、下一個標題，或原題底下另起的「題目：」為止（緊接在引用標籤下的「題目：」是原題自己的標籤）
      for (; k < lines.length && lines[k] !== '' && !/^\s*#/u.test(raw[k]); k++) {
        if (k > i + 1 && LABEL.test(lines[k])) break;
        quoted[k] = true;
      }
    }
    const b = blockAt.get(k);
    if (b) for (; k <= b.end; k++) quoted[k] = true;
    i = k - 1; // 掃過的行不再回頭看：整段只走一次
  }
  const ends = (k: number) =>
    lines[k] === '' || blockAt.has(k) || AFTER_STEM.test(lines[k]) || quoted[k] || LABEL.test(lines[k]);
  const at = lines.findIndex((l, k) => LABEL.test(l) && !quoted[k]);
  if (at !== -1) {
    const first = lines[at].replace(LABEL, '').trim();
    let k = at + 1;
    if (!first) while (k < lines.length && lines[k] === '') k++;
    const parts = first ? [first] : [];
    for (; k < lines.length && !ends(k); k++) parts.push(lines[k]);
    return parts.length ? parts.join('') : null;
  }
  // 引用的那一組選項上一行一定也是引用，往上找不到東西，自然換下一組
  for (const { start } of blocks) {
    let k = start;
    // 往上到空行、引用、上一組選項或 Markdown 標題（標題是段落名稱，不是題幹）為止
    while (k > 0 && lines[k - 1] !== '' && !quoted[k - 1] && !inBlock[k - 1] && !/^\s*#/u.test(raw[k - 1])) k--;
    if (k < start) return lines.slice(k, start).join('');
  }
  return lines.find((l, k) => l !== '' && !quoted[k]) ?? null;
}

/** AI 新題目的題幹與原題的相似度到 ECHO_SIMILARITY_LIMIT 時，回傳相似度與那個題幹；否則 null */
export function echoOfOriginal(
  originalStem: string,
  content: string
): { similarity: number; stem: string } | null {
  const stem = generatedStem(content);
  if (stem === null) return null;
  const similarity = stemSimilarity(originalStem, stem);
  return similarity >= ECHO_SIMILARITY_LIMIT ? { similarity, stem } : null;
}
