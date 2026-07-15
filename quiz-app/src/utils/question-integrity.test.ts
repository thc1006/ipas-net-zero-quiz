// question-integrity 的規則級測試。
//
// 為什麼一定要有這支：bank-integrity.test.ts 只斷言「真實資料通過所有規則」。
// 真實資料是乾淨的，所以每條規則「推入違規」的那個分支從來沒被執行過
// （Codecov：question-integrity.ts 76.92%，12 行未覆蓋，全都是 push(...) 那幾行）。
//
// 也就是說：如果某條規則的 regex 打錯字、或條件寫反，它會**永遠不觸發**，
// 而 bank-integrity 照樣全綠 —— 一道抓不到東西的 gate，就是裝飾。
//
// 所以每條規則都要兩面測：
//   1. 餵髒資料 -> 斷言「這條規則」確實會炸（而且是它，不是別條）
//   2. 餵乾淨資料 -> 斷言它不會誤報
import { describe, it, expect } from 'vitest';
import { checkQuestion, checkAll, formatViolations, type IntegrityQuestion } from './question-integrity';

/** 一道完全乾淨的題目 —— 所有規則都應該放行 */
const good = (over: Partial<IntegrityQuestion> = {}): IntegrityQuestion => ({
  id: 'test-001',
  stem: '依 ISO 14064-1:2018，使用階段的間接排放屬於哪一類別？',
  options: [
    { key: 'A', text: '類別 3' },
    { key: 'B', text: '類別 4' },
    { key: 'C', text: '類別 5' },
    { key: 'D', text: '類別 6' },
  ],
  answer: 'C',
  qualityFlags: [],
  sourceUrls: ['https://www.iso.org/standard/66453.html'],
  ...over,
});

const rules = (q: IntegrityQuestion) => checkQuestion(q).map((v) => v.rule);

describe('question-integrity — 乾淨資料不得誤報', () => {
  it('完全乾淨的題目 -> 0 violations', () => {
    expect(checkQuestion(good())).toEqual([]);
  });

  it('沒有 sources 但也沒標 time_sensitive -> 放行（只有標了才強制要求來源）', () => {
    expect(checkQuestion(good({ sourceUrls: [] }))).toEqual([]);
  });

  it('標了 time_sensitive 且有 http 來源 -> 放行', () => {
    expect(checkQuestion(good({ qualityFlags: ['time_sensitive'] }))).toEqual([]);
  });

  it('標了 ambiguous 且沒有答案 -> 放行（這正是排除計分的正確做法）', () => {
    expect(checkQuestion(good({ qualityFlags: ['ambiguous'], answer: null }))).toEqual([]);
  });

  it('選項文字含「模擬試題」「商研院」等字但不是頁首頁尾格式 -> 不得誤報', () => {
    // 規則綁定的是實際的頁面裝飾格式，不是這些字本身 ——
    // 否則正常題目只要提到「商研院」就會被誤殺。
    const q = good({
      stem: '下列何者為商研院所發布之模擬試題的正確用途？',
      options: [
        { key: 'A', text: '作為官方歷屆試題' },
        { key: 'B', text: '作為練習參考' },
        { key: 'C', text: '作為法規依據' },
        { key: 'D', text: '以上皆是' },
      ],
      answer: 'B',
    });
    expect(rules(q)).not.toContain('pdf_furniture');
  });
});

describe('question-integrity — 每條規則都必須「抓得到」', () => {
  it('options_shape：只有 3 個選項', () => {
    const q = good({ options: good().options.slice(0, 3), answer: 'A' });
    expect(rules(q)).toContain('options_shape');
  });

  it('options_shape：key 重複（A,B,B,C）', () => {
    const q = good({
      options: [
        { key: 'A', text: 'a' },
        { key: 'B', text: 'b' },
        { key: 'B', text: 'b2' },
        { key: 'C', text: 'c' },
      ],
      answer: 'A',
    });
    expect(rules(q)).toContain('options_shape');
  });

  it('options_shape：key 亂序（B,A,C,D）', () => {
    const q = good({
      options: [
        { key: 'B', text: 'b' },
        { key: 'A', text: 'a' },
        { key: 'C', text: 'c' },
        { key: 'D', text: 'd' },
      ],
      answer: 'A',
    });
    expect(rules(q)).toContain('options_shape');
  });

  it('answer_not_in_options：answer=Z', () => {
    const q = good({ answer: 'Z' });
    expect(rules(q)).toContain('answer_not_in_options');
  });

  it('missing_answer：沒有答案又沒標 ambiguous', () => {
    expect(rules(good({ answer: null }))).toContain('missing_answer');
    expect(rules(good({ answer: undefined }))).toContain('missing_answer');
    expect(rules(good({ answer: '' }))).toContain('missing_answer');
  });

  // 這條是本次修正的核心之一：標了瑕疵卻照常計分，是最糟的組合。
  it('ambiguous_must_have_no_answer：標了 ambiguous 卻仍有答案', () => {
    const q = good({ qualityFlags: ['ambiguous'], answer: 'C' });
    expect(rules(q)).toContain('ambiguous_must_have_no_answer');
  });

  it('embedded_newline：題幹含 \\n', () => {
    expect(rules(good({ stem: '第一行\n第二行' }))).toContain('embedded_newline');
  });

  it('embedded_newline：選項含裸 \\r（這正是主題庫漏掉 6 題的成因）', () => {
    // 先前的清理只檢查 '\n'，裸 \r（0x0d）完全溜過去：'與利害關\r 係人溝通'
    const q = good({
      options: [
        { key: 'A', text: '與利害關\r 係人溝通' },
        { key: 'B', text: 'b' },
        { key: 'C', text: 'c' },
        { key: 'D', text: 'd' },
      ],
      answer: 'A',
    });
    expect(rules(q)).toContain('embedded_newline');
  });

  it('pdf_furniture：題幹含 PDF 頁尾 ML (2024.08.16 整理)', () => {
    expect(rules(good({ stem: '什麼是碳足跡？ ML (2024.08.16 整理)' }))).toContain('pdf_furniture');
  });

  it('pdf_furniture：選項含 PDF 頁首「淨零碳規劃管理基礎概論-模擬試題」', () => {
    const q = good({
      options: [
        { key: 'A', text: 'a' },
        { key: 'B', text: 'b 考科 1 淨零碳規劃管理基礎概論-模擬試題' },
        { key: 'C', text: 'c' },
        { key: 'D', text: 'd' },
      ],
      answer: 'A',
    });
    expect(rules(q)).toContain('pdf_furniture');
  });

  it('pdf_furniture：選項含「(商研院 2024.08)」', () => {
    const q = good({
      options: [
        { key: 'A', text: 'a (商研院 2024.08)' },
        { key: 'B', text: 'b' },
        { key: 'C', text: 'c' },
        { key: 'D', text: 'd' },
      ],
      answer: 'A',
    });
    expect(rules(q)).toContain('pdf_furniture');
  });

  it('empty_stem / empty_option', () => {
    expect(rules(good({ stem: '   ' }))).toContain('empty_stem');
    const q = good({
      options: [
        { key: 'A', text: '' },
        { key: 'B', text: 'b' },
        { key: 'C', text: 'c' },
        { key: 'D', text: 'd' },
      ],
      answer: 'B',
    });
    expect(rules(q)).toContain('empty_option');
  });

  it('source_not_url：sources 不是 http(s)', () => {
    expect(rules(good({ sourceUrls: ['not-a-url'] }))).toContain('source_not_url');
    expect(rules(good({ sourceUrls: ['ftp://example.com/x.pdf'] }))).toContain('source_not_url');
    expect(rules(good({ sourceUrls: ['file:///etc/passwd'] }))).toContain('source_not_url');
  });

  // 標了「這題會過期」卻不給任何驗證途徑 = 沒標。quarterly workflow 只看得到有 URL 的題目
  // —— 修正前 569 題裡有 535 題（94%）就是這樣對它完全隱形的。
  it('time_sensitive_without_source：標了時效性卻沒有可驗證 URL', () => {
    expect(rules(good({ qualityFlags: ['time_sensitive'], sourceUrls: [] })))
      .toContain('time_sensitive_without_source');
  });

  it('一題可以同時違反多條規則，全部都要列出（不是遇到第一個就停）', () => {
    const poison: IntegrityQuestion = {
      id: 'poison',
      stem: 'ISO14064 主要是規範什麼？ 體避免影響全球氣候嚴重暖化\nML (2024.08.16 整理)',
      options: [
        { key: 'A', text: '組織層級溫室氣體排放量盤查與查證' },
        { key: 'B', text: '產品碳足跡盤查與查證\n考科 1 淨零碳規劃管理基礎概論-模擬試題' },
        { key: 'C', text: '倫敦議定書' },
      ],
      answer: 'Z',
      qualityFlags: ['time_sensitive'],
      sourceUrls: ['not-a-url'],
    };
    const got = rules(poison);
    // 這正是雙欄錯置產物的指紋 —— 6 條規則要同時亮起來
    expect(got).toEqual(
      expect.arrayContaining([
        'options_shape',
        'answer_not_in_options',
        'embedded_newline',
        'pdf_furniture',
        'source_not_url',
        'time_sensitive_without_source',
      ])
    );
  });
});

describe('question-integrity — 批次與輸出', () => {
  it('checkAll 會把每一題的違規都收集起來', () => {
    const vs = checkAll([good(), good({ id: 'bad-1', answer: 'Z' })]);
    expect(vs.map((v) => v.id)).toEqual(['bad-1']);
    expect(vs[0].rule).toBe('answer_not_in_options');
  });

  it('formatViolations 產生可讀輸出（測試失敗時要能直接指到問題題目）', () => {
    const s = formatViolations(checkAll([good({ id: 'bad-2', answer: 'Z' })]));
    expect(s).toContain('bad-2');
    expect(s).toContain('answer_not_in_options');
  });
});

// 來源「網站」的殘留 —— 跟 PDF 頁首頁尾是不同的一類。
//
// 實際踩到的：兩題的題幹開頭是「【已刪除】90. 根據台灣環境部碳足跡計算指引…」。
// 「【已刪除】」是 yamol 的頁面標題（該站自己把題目下架了）、「90.」是 yamol 的題號 ——
// 都是來源站的**站內狀態**，不是題目內容。
//
// 造成兩個實際傷害：
//   1. 使用者在畫面上直接看到「【已刪除】90.」這串垃圾
//   2. 在考古題 .md 裡，它跟我們的墓碑慣例「【已刪除】」**撞名**，
//      於是那 2 題被誤算成已刪除 —— 「可用題數」少報了 2 題
//
// 原本的 gate 只擋 PDF 的頁首頁尾（商研院、模擬試題），
// **完全沒想到「來源是網站」的情況**。這條補上。
describe('source_site_residue：題幹不得含來源網站的介面文字', () => {
  const base = {
    id: 'x',
    options: [
      { key: 'A', text: 'a' },
      { key: 'B', text: 'b' },
      { key: 'C', text: 'c' },
      { key: 'D', text: 'd' },
    ],
    answer: 'A',
    qualityFlags: [] as string[],
    sourceUrls: [] as string[],
  };
  const rules = (stem: string) =>
    checkQuestion({ ...base, stem }).map((v) => v.rule);

  it('題幹含「【已刪除】」→ 報錯（那是來源站的下架標記，且與墓碑慣例撞名）', () => {
    expect(rules('【已刪除】90. 根據碳足跡計算指引，一級數據佔比需達多少？')).toContain(
      'source_site_residue'
    );
  });

  it('題幹開頭殘留來源站的題號（「105. …」）→ 報錯', () => {
    expect(rules('105. 透過製程地圖查看哪些環節碳排放較高，稱為什麼？')).toContain(
      'source_site_residue'
    );
  });

  it('乾淨的題幹不得誤報', () => {
    expect(rules('根據碳足跡計算指引，一級數據佔上游排放比需達多少％？')).not.toContain(
      'source_site_residue'
    );
  });

  // 題幹裡「正常出現的數字」不可以被當成題號誤殺
  it.each([
    '2050 年淨零排放路徑的四大轉型策略為何？',
    '第 26(2) 條的罰鍰是幾倍？',
    'ISO 14064-1:2018 的六大類別中，何者屬於類別 4？',
    '113 年 2 月 5 日環境部公告採用哪一版 GWP？',
  ])('正常題幹不得誤報：%s', (stem) => {
    expect(rules(stem)).not.toContain('source_site_residue');
  });
});
