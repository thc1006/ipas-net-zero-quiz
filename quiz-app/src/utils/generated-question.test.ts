// #148：「AI 生成相似題」只拿到原題的題幹，模型可能回一道題幹很像、答案卻不同的題目，
// 又顯示在原題那張錯題卡裡，學員就會以為原題的答案是另一個。
import { describe, it, expect } from 'vitest';
import { stemSimilarity } from './question-identity';
import { ECHO_SIMILARITY_LIMIT, MAX_REPLY_CHARS, echoOfOriginal, generatedStem } from './generated-question';
import bankRaw from '../data/integrated_dataset.json';
import poolRaw from '../data/practice_pool.json';

type Stemmed = { stem: string; options: unknown[] };
const BANK = bankRaw as unknown as { gist_items: Stemmed[]; our_unique_items: Stemmed[] };
const POOL = poolRaw as unknown as { items: Stemmed[] };

const Q006 =
  '依據 ISO14064-1：2018 之規範，關於「不確定性（Uncertainty）」與「誤差（Error）」，下列敘述何者正確？';

describe('stemSimilarity：正規化之後的字元二元組 Dice 係數', () => {
  it('標點、全半形、空白不算差異（沿用 normalizeText）', () => {
    expect(stemSimilarity('碳洩漏 (Carbon Leakage) 是指？', '碳洩漏（Carbon Leakage）是指？')).toBe(1);
    expect(stemSimilarity('', '')).toBe(0);
    expect(stemSimilarity('碳', '碳')).toBe(1);
    expect(stemSimilarity('碳', '氮')).toBe(0);
  });

  // 數值是題庫裡真的題幹對算出來的
  it('題庫裡的實例', () => {
    expect(
      stemSimilarity('在進行組織溫室氣體盤查時，下列哪種滅火器不需要列入盤查？', '進行組織溫室氣體盤查時，以下何種滅火器不需列入？')
    ).toBeCloseTo(0.6957, 4);
    expect(stemSimilarity('什麼是綠色行銷？', '什麼是綠色物流？')).toBeCloseTo(0.6667, 4);
    expect(stemSimilarity('什麼是碳足跡標籤？', '什麼是碳足跡標籤(Carbon footprint label)？')).toBeCloseTo(0.4118, 4);
  });
});

describe('generatedStem：只取 AI 新題目的題幹', () => {
  const NEW = '某水泥廠在年度盤查時發現流量計讀值長期偏高 2%，下列處理方式何者最恰當？';
  const OPTS = 'A. 不必處理\nB. 以校正結果修正讀值\nC. 改用估計值\nD. 刪除該月資料\n正確答案：B\n解析：系統誤差應依校正結果修正。';

  // prompt 要求的格式：第一行是「題目：」接題幹
  it('照 prompt 的格式：取「題目：」後面的題幹', () => {
    expect(generatedStem(`題目：${NEW}\n${OPTS}`)).toBe(NEW);
  });

  it('題目標籤的各種寫法', () => {
    for (const label of ['題目：', '**題目**：', '**題目：** ', '__題目__：', '題幹:', '新題目：', '新的題目：', '1. 新題目：',
      '### 題目：', '題目 1：', '題目（新）：', '【題目】', '【新題】', 'Question: ', '**Question:** ', 'New question: ']) {
      expect(generatedStem(`好的，以下是新題。\n${label}${NEW}\n${OPTS}`), label).toBe(NEW);
    }
  });

  it('只有標籤的一行（「**題目：**」「### 新題目」「新題目如下：」「### Question」）：取下面的題幹', () => {
    for (const label of ['題目：', '**題目：**', '__題目：__', '### 新題目', '1. **新題目**', '新題目如下：', '### 新的題目', '### Question', '【題目】']) {
      expect(generatedStem(`${label}\n\n${NEW}\n${OPTS}`), label).toBe(NEW);
    }
  });

  it('沒有冒號的標籤（「### 新題目」）：下面的題幹不像題目、前面又有開場白時，也靠它找到題幹', () => {
    expect(generatedStem('好的，以下是新題。\n### 新題目\n敏感度分析通常用於：\nA. 甲\nB. 乙')).toBe('敏感度分析通常用於：');
    expect(generatedStem('好的，以下是新題。\n**新題目**\n敏感度分析通常用於：\nA. 甲\nB. 乙')).toBe('敏感度分析通常用於：');
  });

  it('題幹分成兩行：連到選項之前的每一行一起算', () => {
    expect(generatedStem(`題目：依據 ISO14064-1：2018 之規範，\n關於「不確定性（Uncertainty）」與「誤差（Error）」，下列敘述何者正確？\n${OPTS}`)).toBe(Q006);
    // 第二行才照抄原題：兩行一起比，照樣提醒
    const c = `題目：某水泥廠查驗時發現流量計讀值偏高。\n${Q006}\n${OPTS}`;
    expect(generatedStem(c)).toBe(`某水泥廠查驗時發現流量計讀值偏高。${Q006}`);
    expect(echoOfOriginal(Q006, c)).not.toBeNull();
  });

  // 模型引用原題時用的標籤：那一行與它底下的原題都不是新題目
  it.each([
    ['參考原題：', `參考原題：${Q006}\n新題目如下：\n${NEW}\n${OPTS}`],
    ['【原題】', `【原題】${Q006}\n【新題】${NEW}\n${OPTS}`],
    ['### 原題目', `### 原題目\n${Q006}\n### 新的題目\n${NEW}\n${OPTS}`],
    ['Original question:', `Original question: ${Q006}\nNew question: ${NEW}\n${OPTS}`],
    ['原題目：', `原題目：${Q006}\n新的題目：${NEW}\n${OPTS}`],
    ['原題問的是', `原題問的是「${Q006}」，以下換一個情境：\n${NEW}\n${OPTS}`],
    ['原題：（沒有新題標籤）', `原題：${Q006}\n\n${NEW}\n${OPTS}`],
  ])('引用原題（%s）不算新題目', (_label, content) => {
    expect(generatedStem(content)).toBe(NEW);
    expect(echoOfOriginal(Q006, content)).toBeNull();
  });

  // 原題寫在同一行的引用，後面直接接新題目（沒有新題的標籤）：往上找到引用那一行就停
  it.each([['參考原題：'], ['【原題】'], ['Original question: '], ['原題：']])('引用（%s）之後直接接新題目與選項', (label) => {
    const content = `${label}${Q006}\n${NEW}\n${OPTS}`;
    expect(generatedStem(content)).toBe(NEW);
    expect(echoOfOriginal(Q006, content)).toBeNull();
  });

  it('標籤後面的題幹到空行、選項、答案、解析、引用原題或下一個題目標籤為止', () => {
    expect(generatedStem(`題目：${NEW}\n\n補充說明一句。\n${OPTS}`)).toBe(NEW);
    expect(generatedStem(`題目：${NEW}\n答案：B`)).toBe(NEW);
    expect(generatedStem(`題目：${NEW}\n正確答案：B`)).toBe(NEW);
    expect(generatedStem(`題目：${NEW}\n解析：說明`)).toBe(NEW);
    expect(generatedStem(`題目：${NEW}\n原題：${Q006}`)).toBe(NEW);
    expect(echoOfOriginal(Q006, `題目：${NEW}\n原題：${Q006}`)).toBeNull();
    expect(generatedStem(`題目：${NEW}\n題目：另一題？`)).toBe(NEW);
  });

  // 不照格式、沒有標籤：取第一個選項上面那一段（往上到空行或引用原題的那一行為止）
  it.each([
    ['開場白有「下列」', `好的，下列是一道新的練習題：\n${Q006}\n${OPTS}`],
    ['開場白有「哪」', `我出一題，看看你知道哪個觀念：\n${Q006}\n${OPTS}`],
    ['開場白是問句', `想再練習一題嗎？\n${Q006}\n${OPTS}`],
    ['英文開場白後空一行', `Sure! Here is a new question:\n\n${Q006}\n${OPTS}`],
    ['開場白後空一行', `好的，以下是一道新的練習題。\n\n${Q006}\n${OPTS}`],
  ])('沒有標籤的照抄：%s，照樣提醒', (_name, content) => {
    expect(generatedStem(content)).toContain(Q006);
    expect(echoOfOriginal(Q006, content)).not.toBeNull();
  });

  it('沒有標籤、題幹以冒號結尾、最後還問「需要我再出一題嗎？」：取選項上面的題幹', () => {
    const c = '碳費的計算公式為：\nA. 排放量×費率\nB. 甲\n正確答案：A\n需要我再出一題嗎？';
    expect(generatedStem(c)).toBe('碳費的計算公式為：');
    expect(echoOfOriginal('碳費的計算公式為：', c)).not.toBeNull();
  });

  // 選項的寫法（審查實測：全形、小寫、字母後空格、「選項A：」、(1) 以前在有標籤時被併進題幹）
  const FORMS: [string, (k: number) => string][] = [
    ['A.', (k) => `${'ABCD'[k]}. 選項${k}`],
    ['A、', (k) => `${'ABCD'[k]}、選項${k}`],
    ['(A)', (k) => `(${'ABCD'[k]}) 選項${k}`],
    ['（A）', (k) => `（${'ABCD'[k]}）選項${k}`],
    ['A）', (k) => `${'ABCD'[k]}）選項${k}`],
    ['A：', (k) => `${'ABCD'[k]}：選項${k}`],
    ['Ａ．', (k) => `${'ＡＢＣＤ'[k]}．選項${k}`],
    ['（Ａ）', (k) => `（${'ＡＢＣＤ'[k]}）選項${k}`],
    ['A 空格', (k) => `${'ABCD'[k]} 選項${k}`],
    ['a.', (k) => `${'abcd'[k]}. 選項${k}`],
    ['選項A：', (k) => `選項${'ABCD'[k]}：選項${k}`],
    ['(1)', (k) => `(${k + 1}) 選項${k}`],
    ['1.', (k) => `${k + 1}. 選項${k}`],
    ['- **A.**', (k) => `- **${'ABCD'[k]}.** 選項${k}`],
    ['A. 之間空行', (k) => `${k ? '\n' : ''}${'ABCD'[k]}. 選項${k}`],
  ];
  it.each(FORMS)('選項寫成「%s」：有標籤、沒有標籤都停在選項之前', (_name, opt) => {
    const opts = [0, 1, 2, 3].map(opt).join('\n');
    expect(generatedStem(`題目：${NEW}\n${opts}\n正確答案：A`)).toBe(NEW);
    expect(generatedStem(`開場白。\n\n${NEW}\n${opts}\n正確答案：A`)).toBe(NEW);
  });

  // 全庫：題庫每一題的題幹原文接四個選項，照抄回覆就要取到題幹原文、提醒一定出現（審查實測全形選項時漏 411 題）
  it.each(FORMS)('全庫 1137 題，選項寫成「%s」：有標籤、沒有標籤都取到題幹原文', (_name, opt) => {
    const items = [...BANK.gist_items, ...BANK.our_unique_items, ...POOL.items].filter((q) => q.options.length > 0);
    expect(items.length).toBeGreaterThan(1000);
    const opts = [0, 1, 2, 3].map(opt).join('\n');
    const missed = { labelled: [] as string[], unlabelled: [] as string[] };
    for (const q of items) {
      if (echoOfOriginal(q.stem, `題目：${q.stem}\n${opts}\n正確答案：A`)?.similarity !== 1) missed.labelled.push(q.stem);
      if (echoOfOriginal(q.stem, `${q.stem}\n${opts}\n正確答案：A`)?.similarity !== 1) missed.unlabelled.push(q.stem);
    }
    expect(missed).toEqual({ labelled: [], unlabelled: [] });
  });

  // 四個選項寫在同一行（審查實測：有標籤時 1137 題只有 726 題提醒）。用每一題自己的選項文字
  const ONE_LINE: [string, (key: string, text: string) => string][] = [
    ['(A) 文字 (B) 文字', (k, t) => `(${k}) ${t}`],
    ['A. 文字 B. 文字', (k, t) => `${k}. ${t}`],
    ['（Ａ）文字（Ｂ）文字', (k, t) => `（${String.fromCharCode(k.charCodeAt(0) + 0xfee0)}）${t}`],
  ];
  it.each(ONE_LINE)('全庫 1137 題，四個選項寫在同一行「%s」：有標籤、沒有標籤都取到題幹原文', (_name, opt) => {
    const items = [...BANK.gist_items, ...BANK.our_unique_items, ...POOL.items].filter((q) => q.options.length > 0);
    const missed = { labelled: [] as string[], unlabelled: [] as string[] };
    for (const q of items) {
      const line = (q.options as { key: string; text: string }[]).map((o) => opt(o.key, o.text)).join(' ');
      if (echoOfOriginal(q.stem, `題目：${q.stem}\n${line}\n正確答案：A`)?.similarity !== 1) missed.labelled.push(q.stem);
      if (echoOfOriginal(q.stem, `${q.stem}\n${line}\n正確答案：A`)?.similarity !== 1) missed.unlabelled.push(q.stem);
    }
    expect(missed).toEqual({ labelled: [], unlabelled: [] });
  });

  it('同一行的選項：從第一個選項代號切開；代號要同一種寫法、A 在 B 前面、中間有字', () => {
    expect(generatedStem(`題目：${NEW}(A) 甲 (B) 乙 (C) 丙 (D) 丁`)).toBe(NEW);
    expect(generatedStem(`題目：${NEW}\n(A) 甲 (B) 乙 (C) 丙 (D) 丁`)).toBe(NEW);
    expect(generatedStem(`${NEW}\nA. 甲 B. 乙 C. 丙 D. 丁\n答案：A`)).toBe(NEW);
    // 不是選項：題幹裡的「A、B、C 三家公司」（代號中間沒有字）、「A、B 兩家」（寫法不同）、只有 A 沒有 B
    // 「(A) 類與 B. 類」（寫法不同）、「TypeA. 與 TypeB.」（代號前面是英文字母）也不切
    for (const stem of ['A、B、C 三家公司都依 ISO 14064-1 盤查，下列何者正確？', 'A、B 兩家公司的差別為何？', '(A) 類排放源指的是哪一種？',
      '(A) 類排放與 B. 類排放的差別為何？', '下列何者是 TypeA. 與 TypeB. 的差別？', 'A、 B、 C 三家公司都依 ISO 14064-1 盤查，下列何者正確？',
      '下列何者屬於 (A) 類排放源？']) {
      expect(generatedStem(`題目：${stem}\n${OPTS}`), stem).toBe(stem);
    }
  });

  // 回覆先引用原題（連同它的選項），再出新題（PR #160 審查：以前只認第一組選項，新題的題幹連進自己的選項，或取到原題的選項 A）
  const QUOTED_FIRST: [string, (stem: string, opts: string) => string][] = [
    ['原題：題幹＋選項／空行／題目：照抄＋選項', (stem, opts) => `原題：${stem}\n${opts}\n\n題目：${stem}\n${opts}\n正確答案：A`],
    ['### 原題 一段／### 新題目 照抄', (stem, opts) => `### 原題\n${stem}\n${opts}\n\n### 新題目\n${stem}\n${opts}\n正確答案：A`],
    ['原題：題幹＋選項／空行／沒有標籤的照抄', (stem, opts) => `原題：${stem}\n${opts}\n\n${stem}\n${opts}\n正確答案：A`],
    ['原題目：題幹／空行／沒有標籤的照抄', (stem, opts) => `原題目：${stem}\n\n${stem}\n${opts}\n正確答案：A`],
  ];
  it.each(QUOTED_FIRST)('全庫 1137 題，先引用原題再照抄（%s）：每一題都取到照抄的題幹', (_name, mk) => {
    const items = [...BANK.gist_items, ...BANK.our_unique_items, ...POOL.items].filter((q) => q.options.length > 0);
    const missed = items.filter((q) => {
      const opts = (q.options as { key: string; text: string }[]).map((o) => `${o.key}. ${o.text}`).join('\n');
      return echoOfOriginal(q.stem, mk(q.stem, opts))?.similarity !== 1;
    });
    expect(missed.map((q) => q.stem)).toEqual([]);
  });

  it('先引用原題（連同選項），新題只把「正確」改成「錯誤」：題幹含「正確」的題目都會提醒', () => {
    const items = [...BANK.gist_items, ...BANK.our_unique_items, ...POOL.items].filter(
      (q) => q.options.length > 0 && q.stem.includes('正確')
    );
    expect(items.length).toBeGreaterThan(100);
    const missed = items.filter((q) => {
      const opts = (q.options as { key: string; text: string }[]).map((o) => `${o.key}. ${o.text}`).join('\n');
      return !echoOfOriginal(q.stem, `原題：${q.stem}\n${opts}\n\n題目：${q.stem.replace('正確', '錯誤')}\n${opts}\n正確答案：A`);
    });
    expect(missed.map((q) => q.stem)).toEqual([]);
  });

  // 引用段落在空行、標題停下：後面沒有題目標籤時，靠這兩條才找得到新題目
  it('「### 原題」那一段在空行或下一個標題停下（後面沒有題目標籤）', () => {
    expect(generatedStem(`### 原題\n${Q006}\n\n${NEW}\n${OPTS}`)).toBe(NEW);
    expect(generatedStem(`### 原題\n${Q006}\n## 練習\n${NEW}\n${OPTS}`)).toBe(NEW);
    expect(echoOfOriginal(Q006, `### 原題\n${Q006}\n\n${NEW}\n${OPTS}`)).toBeNull();
  });

  it('單一星號的斜體標籤、Markdown 引用的「> 原題：」', () => {
    expect(generatedStem(`*題目*：${NEW}\n${OPTS}`)).toBe(NEW);
    const c = `> 原題：${Q006}\n${NEW}\n${OPTS}`;
    expect(generatedStem(c)).toBe(NEW);
    expect(echoOfOriginal(Q006, c)).toBeNull();
  });

  // 題幹本身以「A、B」開頭不是選項：選項要從 A 接 B（或 1 到 4）連著出現才算
  it('題幹以「A、B 兩家公司」開頭：不當成選項', () => {
    const stem = 'A、B 兩家公司都依 ISO 14064-1 盤查，下列敘述何者正確？';
    expect(generatedStem(`${stem}\nA. 甲\nB. 乙\nC. 丙\nD. 丁`)).toBe(stem);
    expect(generatedStem(`題目：${stem}\nA. 甲\nB. 乙`)).toBe(stem);
    expect(generatedStem(`題目：\n${stem}\nA. 甲\nB. 乙`)).toBe(stem);
    // 只出現一行「A.」、後面沒有「B.」：不算選項，照樣連進題幹
    expect(generatedStem(`題目：${NEW}\nA. 只有一行`)).toBe(`${NEW}A. 只有一行`);
    // 數字要 1 到 4 連著四行
    expect(generatedStem(`題目：${NEW}\n1. 第一點\n2. 第二點`)).toBe(`${NEW}1. 第一點2. 第二點`);
    expect(generatedStem(`題目：${NEW}\n1. 第一點\n2. 第二點\n3. 第三點`)).toBe(`${NEW}1. 第一點2. 第二點3. 第三點`);
  });

  // 引用原題的標題自成一行，底下那一段（到空行或下一個標題）都是引用，裡面的「題目：」不是新題目
  it('「### 原題」底下的「題目：」是引用，不是新題目', () => {
    const c = `### 原題\n題目：${Q006}\n\n### 新題目\n${NEW}\n${OPTS}`;
    expect(generatedStem(c)).toBe(NEW);
    expect(echoOfOriginal(Q006, c)).toBeNull();
    const c2 = `**原題目：**\n題目：${Q006}\n### 新題目\n${NEW}\n${OPTS}`;
    expect(generatedStem(c2)).toBe(NEW);
    // 引用那一段裡，原題底下又出現「題目：」（沒有空行隔開）：那是新題目，引用到這裡為止
    expect(generatedStem(`**原題目：**\n${Q006}\n題目：${NEW}\n${OPTS}`)).toBe(NEW);
    expect(echoOfOriginal(Q006, `**原題目：**\n${Q006}\n題目：${NEW}\n${OPTS}`)).toBeNull();
    expect(echoOfOriginal(Q006, `**原題目：**\n某舊題。\n題目：${Q006}\n${OPTS}`)?.similarity).toBe(1);
    // 引用那一段到空行為止：空行後面的「題目：」是新題目
    expect(generatedStem(`### 原題\n題目：${Q006}\n\n題目：${NEW}\n${OPTS}`)).toBe(NEW);
  });

  it('沒有標籤也沒有選項：取第一個不是引用原題的非空行', () => {
    expect(generatedStem(`\n\n${NEW}`)).toBe(NEW);
    expect(generatedStem(`原題：${Q006}\n${NEW}`)).toBe(NEW);
  });

  it('空回覆沒有題幹', () => {
    expect(generatedStem('')).toBeNull();
    expect(generatedStem('題目：\n')).toBeNull();
  });
});

describe('echoOfOriginal：AI 新題目的題幹是不是和原題很像', () => {
  it(`只看回覆的前 ${MAX_REPLY_CHARS} 字`, () => {
    const pad = '說明。\n'.repeat(Math.ceil(MAX_REPLY_CHARS / 4));
    expect(echoOfOriginal(Q006, `題目：${Q006}\n\n${pad}`)?.similarity).toBe(1);
    expect(echoOfOriginal(Q006, `${pad}\n題目：${Q006}`)).toBeNull();
    // 上限本身也要夠大：開場白 18000 字之後的照抄仍然要提醒
    expect(echoOfOriginal(Q006, `${'說明。\n'.repeat(4500)}\n題目：${Q006}`)?.similarity).toBe(1);
  });

  it('沒有標籤：第一組選項上面沒有題幹時，從下一組選項往上找，到上一組選項為止', () => {
    const fresh = '某水泥廠在年度盤查時發現流量計讀值長期偏高 2%，下列處理方式何者最恰當？';
    expect(generatedStem(`A. 例一\nB. 例二\n${fresh}\nA. 甲\nB. 乙`)).toBe(fresh);
  });

  it('引用的原題附了四個選項、新題目沒有選項：四個選項都算引用', () => {
    const fresh = '某水泥廠在年度盤查時發現流量計讀值長期偏高 2%，下列處理方式何者最恰當？';
    expect(generatedStem(`原題：${Q006}\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n\n${fresh}`)).toBe(fresh);
  });

  it('相似度剛好 0.5 也提醒（>=，不是 >）', () => {
    // 「甲乙丙丁戊」與「甲乙丙子丑」：四個二元組裡共有兩個，Dice = 4 / 8
    expect(stemSimilarity('甲乙丙丁戊', '甲乙丙子丑')).toBe(0.5);
    expect(echoOfOriginal('甲乙丙丁戊', '題目：甲乙丙子丑')?.similarity).toBe(0.5);
  });

  // 審查量到病態輸入要好幾秒（每一行都是「原題」、一整行重複「A.x 」）。只看前 MAX_REPLY_CHARS 字，掃描也只走一次
  it.each([
    ['每一行都是「原題」', '原題\n'.repeat(20_000)],
    ['一整行重複「A.x 」', 'A.x '.repeat(25_000)],
    ['一整行重複「(A)x(C)y」', '(A)x(C)y'.repeat(12_500)],
    ['一行一個「A. x」', 'A. x\n'.repeat(20_000)],
  ])('病態的長回覆（%s）在 60 毫秒內算完', (_name, content) => {
    // 線性的寫法在這台機器上都在 10 毫秒以內；平方的寫法即使只看前 MAX_REPLY_CHARS 字，最慢的一種也要 150 毫秒左右
    echoOfOriginal(Q006, content); // 先跑一次，不把第一次編譯 regex 的時間算進去
    const t0 = performance.now();
    echoOfOriginal(Q006, content);
    expect(performance.now() - t0).toBeLessThan(60);
  });

  it('門檻是 0.5', () => {
    expect(ECHO_SIMILARITY_LIMIT).toBe(0.5);
    const flag = (original: string, stem: string) => echoOfOriginal(original, `題目：${stem}`) !== null;
    expect(flag('什麼是綠色行銷？', '什麼是綠色物流？')).toBe(true); // 0.667
    expect(flag('什麼是碳足跡標籤？', '什麼是碳足跡標籤(Carbon footprint label)？')).toBe(false); // 0.412
  });

  // 審查重現的誤報：新題目的題幹與原題不像，但選項有一行是原題裡的標準名稱。以前每一行都比，這一行就讓整題被當成照抄
  it('只比題幹：選項、答案、解析裡有原題的片段，不算', () => {
    const content =
      '題目：某工廠導入新的監測設備後，盤查人員發現電力數據有偏差，下列何者正確處理？\nA. ISO 14064-1:2018\nB. 修正數據\n答案：B\n' +
      `解析：${Q006}`;
    expect(echoOfOriginal(Q006, content)).toBeNull();
  });

  it('審查列出的不同題目（兩個「應包括」）不提醒', () => {
    expect(echoOfOriginal('碳中和管理計畫書中，碳抵換規劃應包括：', '題目：碳中和主體說明應包括：')).toBeNull();
  });

  it.each([
    ['依據 ISO 14064-1:2018，關於不確定性與誤差，下列敘述何者錯誤？', 0.642],
    ['依據ISO 14064-1:2018，關於「不確定性」與「誤差」的敘述，下列何者錯誤？', 0.585],
    [
      '某工廠委託第三方查驗機構進行年度溫室氣體盤查查驗，查驗人員到現場檢視鍋爐燃料用量、流量計校正紀錄與排放係數的選用依據，'
        + '並與廠內的盤查小組討論數據品質管理的作法。依據 ISO14064-1：2018 之規範，關於「不確定性（Uncertainty）」與「誤差（Error）」，下列敘述何者錯誤？',
      0.545,
    ],
  ])('q006 的這種寫法會提醒：%s', (stem, dice) => {
    expect(stemSimilarity(Q006, stem)).toBeCloseTo(dice, 3);
    const echo = echoOfOriginal(Q006, `題目：${stem}\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n正確答案：C`);
    expect(echo).toEqual({ similarity: stemSimilarity(Q006, stem), stem });
  });

  // 已知抓不到：只看字面，換句話說的改寫比不出來。所以畫面上的說明不能因為沒有提醒就說兩題無關
  it.each([
    ['關於不確定性與誤差，下列何者正確？', 0.344],
    ['有關溫室氣體盤查的不確定性與誤差，下列何者正確？', 0.254],
  ])('q006 的這種寫法抓不到（已知）：%s', (stem, dice) => {
    expect(stemSimilarity(Q006, stem)).toBeCloseTo(dice, 3);
    expect(echoOfOriginal(Q006, `題目：${stem}`)).toBeNull();
  });

  it('換了情境的新題目不提醒', () => {
    const content = '1. 新題目：某工廠用流量計量測燃料用量，送校後發現讀值一直偏高 2%。下列處理方式何者最恰當？\nA. 不必處理';
    expect(echoOfOriginal(Q006, content)).toBeNull();
  });

  it('沒有題幹的回覆不提醒', () => {
    expect(echoOfOriginal(Q006, '')).toBeNull();
  });
});
