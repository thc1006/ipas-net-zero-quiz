// 題庫結構完整性 gate
//
// 起因：@weiyunghsu 回報考科二 253–289「題目與選項錯置」。追下去發現成因是來源 PDF 為雙欄
// 排版，轉純文字時左右欄交錯，把鄰題的文字插進題幹、選項重複或缺漏，連頁首頁尾
// （'ML (2024.08.16 整理)'、'考科 1 …-模擬試題'）都被吃進選項裡。實際受影響的是 83 題
// （考科一 324–362 也中，回報者只看到一半）。
//
// 重點是：這一整類壞法 100% 可以機器測出來 —— 選項不是 4 個、key 重複、答案不在選項裡、
// 文字裡有換行或 PDF 頁首頁尾。人工逐題看是看不完的，所以把它變成 gate。
//
// 另外釘住「修正必須真的被套用」：_correction_note 掛上去但 answer 沒改，正是坎昆那題
// （gist[304]）能默默錯到線上的原因。
import { describe, it, expect } from 'vitest';
import datasetRaw from './integrated_dataset.json';

interface Opt {
  key: string;
  text: string;
}
interface Item {
  index?: number;
  item_id?: string;
  stem: string;
  options: Opt[];
  answer?: string | null;
  explanation?: string | null;
  exam_subject?: string;
  quality_flags?: string[];
  _correction_note?: string;
  source?: { url?: string };
  metadata?: { prior_answer?: string; sources?: string[]; valid_as_of?: string };
}

const DS = datasetRaw as unknown as {
  meta: Record<string, unknown>;
  gist_items: Item[];
  our_unique_items: Item[];
};

const ALL: Item[] = [...DS.gist_items, ...DS.our_unique_items];
const who = (it: Item) => it.item_id ?? `gist[${it.index}]`;

// 來源 PDF 的頁首/頁尾，絕對不該出現在題幹或選項裡
const PDF_FURNITURE = [/ML\s*\(?\s*2024\.08\.16/, /模擬試題/, /商研院/];

describe('題庫結構完整性', () => {
  it('題庫非空', () => {
    expect(ALL.length).toBeGreaterThan(0);
  });

  it('每題恰好 4 個選項，key 為 A/B/C/D 且不重複', () => {
    const bad = ALL.filter((it) => {
      const keys = it.options.map((o) => o.key);
      return keys.length !== 4 || keys.join('') !== 'ABCD';
    }).map((it) => `${who(it)}: [${it.options.map((o) => o.key).join(',')}]`);
    expect(bad).toEqual([]);
  });

  it('answer 必須是選項 key 之一', () => {
    const bad = ALL.filter((it) => it.answer && !it.options.some((o) => o.key === it.answer)).map(
      (it) => `${who(it)}: answer=${it.answer}`
    );
    expect(bad).toEqual([]);
  });

  it('題幹與選項不得含換行（雙欄擷取殘留）', () => {
    const bad = ALL.filter((it) =>
      [it.stem, ...it.options.map((o) => o.text)].some((t) => t.includes('\n'))
    ).map(who);
    expect(bad).toEqual([]);
  });

  it('題幹與選項不得含 PDF 頁首頁尾', () => {
    const bad = ALL.filter((it) =>
      [it.stem, ...it.options.map((o) => o.text)].some((t) =>
        PDF_FURNITURE.some((re) => re.test(t))
      )
    ).map(who);
    expect(bad).toEqual([]);
  });

  it('題幹與選項不得為空白', () => {
    const bad = ALL.filter(
      (it) => !it.stem.trim() || it.options.some((o) => !o.text.trim())
    ).map(who);
    expect(bad).toEqual([]);
  });

  // 這條就是坎昆那題漏掉的原因：註記寫了「答案應為 C」，answer 卻還是 D。
  it('有 _correction_note 的題目，必須真的改過答案（prior_answer 存在且與現答案不同）', () => {
    const bad = DS.gist_items
      .filter((it) => it._correction_note)
      .filter((it) => !it.metadata?.prior_answer || it.metadata.prior_answer === it.answer)
      .map((it) => `${who(it)}: answer=${it.answer} prior=${it.metadata?.prior_answer ?? 'MISSING'}`);
    expect(bad).toEqual([]);
  });

  it('meta 統計與實際題數一致', () => {
    expect(DS.meta.total_questions).toBe(ALL.length);
    expect(DS.meta.gist_questions).toBe(DS.gist_items.length);
    expect(DS.meta.our_unique_questions).toBe(DS.our_unique_items.length);
    expect(DS.meta.with_answer).toBe(ALL.filter((it) => it.answer).length);
  });

  // meta 不得對「查證範圍」說謊。
  //
  // 原本寫 `content_verified_as_of: "2026-07-13"` —— 下游會理解成「整份 783 題都查證到
  // 這一天」。實際上本輪只實查了 103 題（CBAM/NDC/碳費/碳中和），12 題沿用 2026-01-23，
  // 另外 668 題連 time_sensitive 都沒標、根本沒碰過。
  //
  // 改成 content_review{...}，並用這條測試把數字釘死在「資料實際長什麼樣」上：
  // reverified_count 必須等於資料裡 valid_as_of == last_review_date 的題數。
  // 這樣就算有人改了 meta 卻沒改資料（或反過來），都會當場被抓到 —— meta 不可能說謊。
  describe('content_review：查證範圍不得被誇大', () => {
    const cr = DS.meta.content_review as unknown as {
      last_review_date: string;
      scope: string[];
      reverified_count: number;
      total_questions: number;
      time_sensitive_count: number;
      carried_over_count: number;
      known_unresolved: { id: string; resolved?: boolean }[];
      note: string;
    };

    it('不得再出現會被誤讀為「整份題庫已查證」的 content_verified_as_of', () => {
      expect(DS.meta).not.toHaveProperty('content_verified_as_of');
    });

    it('reverified_count 必須等於資料裡實際重查過的題數', () => {
      const actual = ALL.filter(
        (it) => it.metadata?.valid_as_of === cr.last_review_date
      ).length;
      expect(cr.reverified_count).toBe(actual);
    });

    it('time_sensitive_count / total_questions 必須與資料一致', () => {
      expect(cr.total_questions).toBe(ALL.length);
      expect(cr.time_sensitive_count).toBe(
        ALL.filter((it) => (it.quality_flags ?? []).includes('time_sensitive')).length
      );
    });

    it('carried_over_count 必須等於「標了 time_sensitive 但本輪沒重查」的題數', () => {
      const actual = ALL.filter(
        (it) =>
          (it.quality_flags ?? []).includes('time_sensitive') &&
          it.metadata?.valid_as_of !== undefined &&
          it.metadata?.valid_as_of !== cr.last_review_date
      ).length;
      expect(cr.carried_over_count).toBe(actual);
    });

    it('本輪查證的題數必須「少於」總題數 —— 否則就是在宣稱全庫已查證', () => {
      expect(cr.reverified_count).toBeLessThan(cr.total_questions);
      expect(cr.note).toMatch(/不是「整份題庫已查證/);
      expect(cr.note).toMatch(/valid_as_of/); // 必須指出以每題的 valid_as_of 為準
    });

    it('known_unresolved 必須列出仍未解決的事項', () => {
      const open = cr.known_unresolved.filter((u) => !u.resolved);
      expect(open.length).toBeGreaterThan(0);
      expect(open.map((u) => u.id)).toContain('PAS_2060_withdrawal_date');
      expect(open.map((u) => u.id)).toContain('ifrs_issb_tcfd_not_reverified');
    });
  });

  it('AR6「次方成長」偽造題不得再出現（issue #85 迴歸防護）', () => {
    const bad = ALL.filter((it) => /次方/.test(it.stem) && /AR6/.test(it.stem)).map(who);
    expect(bad).toEqual([]);
  });

  // 抽題是依 id 洗牌的，不會抽到同一個 item 兩次 —— 但同一道題目若存在於兩個不同的
  // item，同一份考卷就會出現兩次。原始 gist 帶了 17 組這種重複（尾段 index 538–569
  // 重複前段 4–206），實測 9.3% 的「40題/考科一」考卷會撞到。已移除，這裡釘住。
  //
  // 只管「同科內」：跨科重複（考科一與考科二各一份）刻意保留 —— 資料上兩份都得在，
  // 否則只考一科的考生會少一題；「全部」模式的重複由 questions.ts 的 dedupeByContent
  // 在抽題時處理。
  it('同一考科內不得有內容完全相同的題目（題幹 + 選項集合）', () => {
    const sig = (it: Item) =>
      it.stem.replace(/\s+/g, '') +
      '||' +
      it.options
        .map((o) => o.text.replace(/\s+/g, ''))
        .sort()
        .join('|');
    const seen = new Map<string, string[]>();
    for (const it of ALL) {
      // 分隔符不能省：沒有它，'考科1' + sig 理論上可能與 '考科' + '1sig' 撞在一起
      const k = `${it.exam_subject} ${sig(it)}`;
      seen.set(k, [...(seen.get(k) ?? []), who(it)]);
    }
    const dups = [...seen.values()].filter((v) => v.length > 1);
    expect(dups).toEqual([]);
  });

  // quarterly workflow 只 curl「有 source URL」的題目。沒有 URL 的 time_sensitive 題目
  // 對它完全隱形 —— 修正前 569 題裡有 535 題（94%）就是這樣被漏掉的。
  // 標了 time_sensitive 卻沒附來源，等於宣稱「這題會過期」又不給任何方式去驗證。
  //
  // URL 的取法必須和 workflow 的 jq 一致（source.url 或 metadata.sources[] 皆可），
  // 否則這個測試會對「覆蓋率」說謊。
  const sourceUrls = (it: Item): string[] =>
    [it.source?.url, ...(it.metadata?.sources ?? [])].filter(
      (u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)
    );

  it('標為 time_sensitive 的題目必須附來源 URL（否則 quarterly workflow 看不到）', () => {
    const bad = ALL.filter((it) => (it.quality_flags ?? []).includes('time_sensitive'))
      .filter((it) => sourceUrls(it).length === 0)
      .map(who);
    expect(bad).toEqual([]);
  });

  // valid_as_of 是「內容查證到哪一天」，不是「這個檔案何時被改過」。
  // 未重新查證的題目必須誠實沿用它原本的日期 —— 謊報成今天比沒有這個欄位更糟。
  it('time_sensitive 題目應帶 valid_as_of，標示內容查證到哪一天', () => {
    const bad = ALL.filter((it) => (it.quality_flags ?? []).includes('time_sensitive'))
      .filter((it) => !it.metadata?.valid_as_of)
      .map(who);
    expect(bad).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 拆分出來的題目必須同科
//
// 背景：原本有一題「CBAM 未於期間購買憑證，罰款倍數為？」把三件不同的事混為一談 ——
//   Art 26(1) 授權申報人未繳交憑證 -> 按每張憑證處以與 EU ETS 超額排放相同之罰鍰
//   Art 26(2) 非授權之人輸入 CBAM 貨物 -> 處 26(1) 罰鍰之 3–5 倍
//   Art 22(3) 每季帳戶餘額不足     -> 無倍數，1 個月內補足
// 拆成兩題（26(1) / 26(2)）之後，兩題一度分屬不同考科 —— 同一份考卷永遠只看得到其中一題，
// 拆題想製造的「對照」完全消失。
//
// 考科的依據是**官方評鑑內容**，不是社群整理的考古題文件：
//   115 年度 iPAS 簡章 §2.5：
//     L11 淨零碳規劃管理基礎概論（科目一）
//       L11202 國際碳稅關貿政策(如 CBAM 等)      <- CBAM 在這裡
//       L11205 ISO 14068-1 碳中和標準
//     L12 淨零碳盤查規範與程序概要（科目二）
//       L121 ISO 14064-1:2018 組織型溫室氣體盤查
//       L122 ISO 14067:2018 標準與規範
//   => 科目二只有 ISO 14064-1 與 ISO 14067，**沒有任何政策/貿易內容**。CBAM 一定是考科1。
//
// 先前曾因為「原始考古題 .md 把母題放在考科二段落底下」而把它們改成考科2 —— 那是錯的。
// 那份 .md 是社群整理的文件，它的「考科二」段落裡同時還有 ISO 14068-1（官方 L11205，
// 科目一）與巴黎協定的題目，明顯是貼錯位置的產物，不能拿來當考科歸屬的依據。
describe('CBAM 罰則：拆分出的對照題必須同科，且必須是考科1', () => {
  // 注意：不能用「題幹含 第 26(1) 條」來認人 —— 26(2) 那題的題幹裡也寫著
  // 「其罰鍰為第 26(1) 條罰鍰的幾倍？」，兩題都會命中。
  // 要認的是「這題在考哪一條」，也就是開頭「依 … 第 26(N) 條，」那個 N。
  const asks = (it: Item, n: 1 | 2) =>
    new RegExp(`^依 Regulation \\(EU\\) 2023/956 第 26\\(${n}\\) 條`).test(it.stem);

  const penalty = ALL.filter(
    (it) =>
      /Regulation \(EU\) 2023\/956/.test(it.stem) && (asks(it, 1) || asks(it, 2))
  );

  it('Art 26(1) 與 26(2) 兩題都存在', () => {
    expect(penalty).toHaveLength(2);
    expect(penalty.filter((it) => asks(it, 1))).toHaveLength(1);
    expect(penalty.filter((it) => asks(it, 2))).toHaveLength(1);
  });

  it('兩題必須在同一考科，且必須是考科1（官方 L11202：CBAM 屬科目一）', () => {
    // 前提：只剩一題時 `new Set([一個值]).size` 也是 1 —— 沒有這行，刪掉其中一題會
    // 讓這條測試**靜默變綠**（實測過）。空轉的把關不是把關。
    expect(penalty.length, 'CBAM 罰則題不足兩題 —— 這條測試在空轉').toBe(2);

    const subjects = new Set(penalty.map((it) => it.exam_subject));
    expect(
      subjects.size,
      `Art 26(1)/26(2) 分屬不同考科：${penalty
        .map((it) => `${who(it)}=${it.exam_subject}`)
        .join(', ')}`
    ).toBe(1);

    // 只釘「同科」是不夠的 —— 兩題一起搬到錯的那一科，這條照樣綠。
    // 官方評鑑內容 L11202 把 CBAM 明確放在科目一，所以要釘死「就是考科1」。
    expect(
      [...subjects][0],
      'CBAM 屬官方評鑑內容 L11202（科目一：淨零碳規劃管理基礎概論）。' +
        '科目二只涵蓋 ISO 14064-1 與 ISO 14067，不含政策/貿易內容。'
    ).toBe('考科1');
  });

  it('兩題的罰則規則不得互相抄錯（只有 26(2) 是 3–5 倍）', () => {
    const a1 = penalty.find((it) => asks(it, 1))!;
    const a2 = penalty.find((it) => asks(it, 2))!;
    const ansText = (it: Item) =>
      it.options.find((o) => o.key === it.answer)?.text ?? '';

    // 26(2)（非授權之人輸入 CBAM 貨物）的正解＝ 26(1) 罰鍰的 3–5 倍
    expect(ansText(a2)).toMatch(/3\s*[–-]\s*5\s*倍/);

    // 26(1)（授權申報人未繳交憑證）的正解＝按每張憑證處以與 EU ETS 超額排放
    // 相同之罰鍰；它**不是**倍數罰則。這兩者被混為一談，正是原本那題教錯的地方。
    expect(ansText(a1)).toMatch(/ETS|超額排放/);
    expect(ansText(a1)).not.toMatch(/倍/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// meta 不可以說謊（續）
//
// meta.corrections_applied 原本寫 8 —— 而實際上 prior_answer 有 14 題、其中
// prior_answer != answer 的有 12 題、_correction_note 有 3 題。**8 對應不到任何一個數字。**
// 它是 meta 裡唯一沒有 cannot-lie gate 的計數器，而這整輪工作的主軸就是「meta 不可以說謊」。
// 宣告在 types/quiz.ts，從來沒有被計算過，也從來沒有被斷言過。
//
// 另外還有兩題的 prior_answer == answer（宣稱「改過答案」，實際上答案根本沒變）。
// 那等於在證據鏈上記了一筆沒發生過的更正。
describe('meta.corrections_applied 必須等於資料實算', () => {
  const withPrior = ALL.filter((it) => it.metadata?.prior_answer != null);
  const realCorrections = withPrior.filter((it) => it.metadata!.prior_answer !== it.answer);

  it('prior_answer 不得等於現在的答案（那是一筆沒發生過的更正）', () => {
    const noop = withPrior
      .filter((it) => it.metadata!.prior_answer === it.answer)
      .map((it) => `${who(it)}: prior=${it.metadata!.prior_answer} answer=${it.answer}`);
    expect(
      noop,
      'prior_answer == answer 代表「宣稱改過答案，其實沒改」—— 證據鏈上不該有這種紀錄'
    ).toEqual([]);
  });

  it('corrections_applied 必須等於 prior_answer != answer 的題數', () => {
    // 前提：真的有更正紀錄，否則下面是空轉
    expect(realCorrections.length, '沒有任何更正紀錄 —— 這條測試在空轉').toBeGreaterThan(0);
    expect(
      (DS.meta as Record<string, unknown>).corrections_applied,
      `meta 宣稱 ${(DS.meta as Record<string, unknown>).corrections_applied}，` +
        `實際 prior_answer != answer 的有 ${realCorrections.length} 題`
    ).toBe(realCorrections.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 考科歸屬必須依「官方評鑑內容」，不是依社群整理的考古題文件
//
// 115 年度 iPAS 簡章 §2.5：
//   L11 淨零碳規劃管理基礎概論（科目一）
//     L11202 國際碳稅關貿政策(如 CBAM 等)
//     L11205 ISO 14068-1 碳中和標準
//   L12 淨零碳盤查規範與程序概要（科目二）
//     L121 ISO 14064-1:2018 組織型溫室氣體盤查
//     L122 ISO 14067:2018 標準與規範
//
// 也就是說：**科目二只涵蓋 ISO 14064-1 與 ISO 14067**，不含任何政策/貿易/碳中和標準。
// CBAM、ISO 14068-1、PAS 2060 出現在考科2，就是錯置。
//
// 先前曾把 CBAM 題改成考科2，理由是「原始考古題 .md 把它們放在考科二段落」——
// 那份 .md 是社群整理的文件，同一段落裡還混著 ISO 14068-1（官方 L11205，科目一）
// 的題目，明顯是貼錯位置的產物。**社群文件的段落不能拿來當考科歸屬的依據。**
describe('考科歸屬：科目二只有 ISO 14064-1 與 ISO 14067', () => {
  const S1_ONLY = /CBAM|碳邊境|ISO\s*14068|PAS\s*2060/i;

  it('考科2 不得出現 CBAM / ISO 14068-1 / PAS 2060 的題目（官方 L11202、L11205 屬科目一）', () => {
    const misfiled = ALL.filter(
      (it) => it.exam_subject === '考科2' && S1_ONLY.test(it.stem)
    ).map((it) => `${who(it)}: ${it.stem.slice(0, 40)}`);
    expect(
      misfiled,
      '這些題目的主題屬官方科目一（L11202 國際碳稅關貿政策 / L11205 ISO 14068-1 碳中和標準）'
    ).toEqual([]);
  });

  it('這條測試不是空轉：CBAM / ISO 14068 / PAS 2060 的題目確實存在（且都在考科1）', () => {
    const s1 = ALL.filter((it) => S1_ONLY.test(it.stem));
    expect(s1.length, '題庫裡沒有任何 CBAM/ISO 14068/PAS 2060 題 —— 上一條在空轉').toBeGreaterThan(10);
    expect(new Set(s1.map((it) => it.exam_subject))).toEqual(new Set(['考科1']));
  });
});
