// 稽核修正回歸測試 —— 鎖定審核過的答案，避免被誤改回去。
//
// **這個檔案曾經整個守錯對象，長達好幾個月。**
//
// 原本每一條斷言都寫成 `byId('c2-190')`，而 `byId` 讀的是 `questions.json` ——
// **一個 app 從來不會載入的檔案**（真正出貨的資料模組 `questions.ts` 讀的是
// `integrated_dataset.json`）。
//
// 也就是說：這些以**真實使用者回報**命名的回歸測試（`c2-190` 來自 discussion #1、
// `c2-074` 來自 issue #82），宣稱「避免被誤改回去」，
// **但出貨資料裡的答案就算被改成錯的，它們也照樣全綠。**
// 突變測試證實過：把出貨端的 c2-190 / c2-006 / c2-132 / c2-074 答案通通改錯，四條全部 GREEN。
//
// 而且那個舊檔已經漂了 —— 它與出貨資料有 **8 題答案不一致**，
// 每一題的 `prior_answer` 都對得上它，也就是說它保存的是**更正前的錯答案**。
//
// **一句假的保證比沒有保證更糟**：這些測試看起來像是有人在守，其實沒有。
// `questions.json` 已刪除（它 0 條來源、93% 的解析帶著捏造的引用編號，見 meta.metadata_honesty_note）。
// 現在每一條斷言都打在**出貨的那一份資料**上。
import { describe, it, expect } from 'vitest';
import datasetRaw from './integrated_dataset.json';

interface DatasetItem {
  index?: number;
  item_id?: string;
  stem: string;
  answer: string | null;
  options: { key: string; text: string }[];
  metadata?: { original_id?: string; sources?: string[]; prior_answer?: string };
  explanation?: string;
}

const DS = datasetRaw as unknown as {
  gist_items: DatasetItem[];
  our_unique_items: DatasetItem[];
};
const ALL = [...DS.gist_items, ...DS.our_unique_items];

/** 依舊 pipeline 的題號（c2-190 之類）找到**出貨資料**裡的那一題。 */
const live = (id: string) =>
  ALL.find((q) => q.metadata?.original_id === id || q.item_id === id);

const byIndex = (idx: number) => DS.gist_items.find((g) => g.index === idx);

/** 出貨資料的 options 是陣列，不是 Record —— 取某個字母的選項文字。 */
const opt = (q: DatasetItem | undefined, key: string) =>
  q?.options.find((o) => o.key === key)?.text;

describe('回歸測試守的是「出貨的那一份資料」', () => {
  // 這一條是元測試：如果哪天 live() 對不到題（例如 original_id 被改名），
  // 底下所有 `expect(live('c2-190')?.answer)` 都會變成 `expect(undefined)` ——
  // **那不會讓測試變綠，但會讓失敗訊息變得莫名其妙。** 先在這裡明確擋掉。
  const PINNED = ['c2-190', 'c2-006', 'c2-132', 'c1-038', 'c1-040', 'c2-086', 'c2-074'];
  it('每一個被釘住的題號都必須在出貨資料裡找得到', () => {
    for (const id of PINNED) {
      expect(live(id), `${id} 在 integrated_dataset.json 裡找不到 —— 回歸測試會變成空轉`).toBeDefined();
    }
  });
});

describe('audit corrections regression', () => {
  describe('c2-190 一級數據佔上游排放（discussion #1）', () => {
    const q = live('c2-190');
    it('出貨資料的答案必須是 B（10%，不是 20%）', () => {
      expect(q?.answer).toBe('B');
    });
    it('選項 B 的文字含 10', () => {
      expect(opt(q, 'B')).toContain('10');
    });
    it('解析含 10%', () => {
      expect(q?.explanation).toContain('10%');
    });
    it('解析不得再出現「（原環境部）」這個時序錯置', () => {
      expect(q?.explanation).not.toContain('（原環境部）');
    });
    it('來源仍保留當初據以更正的 vocus 引用', () => {
      const sources = q?.metadata?.sources ?? [];
      expect(sources.some((u) => u.includes('vocus.cc'))).toBe(true);
    });
  });

  describe('c2-006 溫管辦法主導查驗員', () => {
    const q = live('c2-006');
    it('出貨資料的答案必須是 C（6 年）', () => {
      expect(q?.answer).toBe('C');
    });
    it('解析引的是 §8（不是 §14）', () => {
      expect(q?.explanation).toContain('第 8 條');
    });
  });

  describe('c2-132 CDP 揭露範疇', () => {
    const q = live('c2-132');
    it('出貨資料的答案必須是 A（土壤，不是塑膠）', () => {
      expect(q?.answer).toBe('A');
    });
    it('選項 A 是「土壤」', () => {
      expect(opt(q, 'A')).toBe('土壤');
    });
  });

  describe('CBAM Omnibus dates (Reg 2025/2083)', () => {
    it('c1-038 憑證繳交期限：選項 C → 9 月 30 日', () => {
      expect(opt(live('c1-038'), 'C')).toMatch(/9\s*月\s*30\s*日/);
    });
    it('c1-040 首次申報：選項 B → 2027 年 9 月 30 日', () => {
      expect(opt(live('c1-040'), 'B')).toMatch(/2027\s*年\s*9\s*月\s*30\s*日/);
    });
  });

  describe('NDC 3.0 update', () => {
    it('c2-086 選項 B → 28 % ± 2 %', () => {
      expect(opt(live('c2-086'), 'B')).toMatch(/28\s*%\s*±\s*2\s*%/);
    });
  });

  describe('SF6 GWP AR5 (23,500)', () => {
    const sf6_50 = byIndex(480);
    const sf6_60 = byIndex(494);
    it('gist[480] 50kg SF6 answer D = 1,175 tCO2e', () => {
      const optD = sf6_50?.options.find((o) => o.key === 'D')?.text;
      expect(optD).toMatch(/1[,\s]?175\s*tCO2e/);
    });
    it('gist[494] 60kg SF6 answer D = 1,410 tCO2e', () => {
      const optD = sf6_60?.options.find((o) => o.key === 'D')?.text;
      expect(optD).toMatch(/1[,\s]?410\s*tCO2e/);
    });
  });

  describe('Cat 4/5 stem fix', () => {
    const q = byIndex(179);
    it('gist[179] stem mentions Category 5 (not 4) for use phase', () => {
      expect(q?.stem).toContain('Category 5');
    });
  });

  describe('threshold law source correction', () => {
    const q = byIndex(150);
    it('gist[150] explanation cites 公告 (not §5)', () => {
      expect(q?.explanation).toContain('1139101260');
    });
  });

  describe('c2-006 / gist[88] citation accuracy', () => {
    const q = byIndex(89);
    it('gist[89] explanation cites §56 (1500 元 cap)', () => {
      expect(q?.explanation).toContain('第 56 條');
    });
  });

  describe('c2-074 巴黎協定 enriched explanation (issue #82)', () => {
    const q = live('c2-074');
    it('出貨資料的答案必須是 B（2016 年生效）', () => {
      expect(q?.answer).toBe('B');
    });
    it('解析帶 COP21 / UN Treaty Collection / 2015 年 12 月 12 日 任一關鍵字', () => {
      expect(q?.explanation).toMatch(/COP21|UN Treaty Collection|2015 年 12 月 12 日/);
    });
    it('解析不應再含 [1, 2, 3, 4] 這種捏造的引用編號', () => {
      expect(q?.explanation).not.toMatch(/\[1, ?2, ?3, ?4\]/);
    });
    it('來源含 UN Treaty Collection URL', () => {
      const sources = q?.metadata?.sources ?? [];
      // 用 hostname 比對而非 substring — 避免把 'evil.com/treaties.un.org' 誤認為 UN
      // CodeQL: js/incomplete-url-substring-sanitization
      expect(
        sources.some((u) => {
          try {
            const host = new URL(u).hostname;
            return host === 'treaties.un.org' || host.endsWith('.treaties.un.org');
          } catch {
            return false;
          }
        })
      ).toBe(true);
    });
  });

  describe('c2-089 AR6「10次方」偽造題已移除 (issue #85)', () => {
    it('c2-089 不應出現於出貨資料（AR6 無此敘述，已移除）', () => {
      expect(live('c2-089')).toBeUndefined();
    });
    it('gist[282] 不應出現於 integrated_dataset.json', () => {
      expect(byIndex(282)).toBeUndefined();
    });
  });

  // 這條修正 @henrychen-bot 早在 2025-10 就回報了，_correction_note 也掛上去了，
  // 但 answer 欄位從來沒被改過 —— 線上 App 一直發送錯的 D，explanation 甚至還在替 D 辯護。
  // 沒有測試釘住，是它能默默漏掉的唯一原因。現在釘住。
  //
  // 2026-07-14：**這題被改了第二次（D → C → A）。**
  //
  // @henrychen-bot 的核心指認是**對的**：ICA 是非附件一國家的機制，附件一國家走 IAR。
  // Decision 1/CP.16 §44 逐字寫著 "a process for international assessment of emissions
  // and removals related to quantified economy-wide emission reduction targets" —— B、D 確實都錯。
  //
  // 但那個推論**只走了一半**：排除掉 B、D 之後，它選了 C（與目標相關基線資料計算），
  // 而 C 在一手來源裡**沒有任何文字依據** —— 我把 1/CP.16 全文（31 頁、90,592 字）抓下來，
  // 搜尋 baseline / base year，**各 0 次**。
  // §40(a) 逐字要求的是 "information on mitigation actions ... and emission reductions
  // achieved" —— 那就是選項 A（強化減緩行動報告：項目與成果）。
  //
  // 教訓：**「排除了錯的」不等於「找到了對的」。** 上一版的測試把「答案是 C」釘死，
  // 卻從來沒有人拿決議原文去驗證 C —— 一道釘住錯誤答案的回歸測試，
  // 比沒有測試更難拆，因為它看起來像是有人驗證過。
  //
  // 取證註記：unfccc.int 對直接抓取回 212 bytes 的 Incapsula 擋頁，而 PyMuPDF 會把那段 HTML
  // 默默解成「1 頁 0 字」的 PDF —— 若不查 Content-Type，會得到一個**假的**「baseline 出現 0 次」。
  // 真正的全文是改用瀏覽器型抓取取得後，才在本機以 PyMuPDF 解出並逐字比對的。
  describe('坎昆協議 MRV：附件一國家的報告義務 (@henrychen-bot 回報，2026-07 二次更正)', () => {
    const g = byIndex(304);

    it('答案應為 A —— §40(a) 要求報告「減緩行動與已達成之減量成果」', () => {
      expect(g?.answer).toBe('A');
    });

    it('explanation 不得再宣稱附件一國家「接受 ICA」', () => {
      // 舊的錯誤 explanation：「坎昆協議規定，附件一國家應每兩年更新其排放報告，並接受國際諮商與分析（ICA）。」
      expect(g?.explanation).not.toMatch(/附件一國家.{0,12}接受.{0,6}(ICA|國際諮商與分析)/);
    });

    it('explanation 應說明附件一國家走 IAR（@henrychen-bot 指認正確的那一半）', () => {
      expect(g?.explanation).toMatch(/IAR|國際評估/);
    });

    it('explanation 不得再替沒有依據的 C（基線資料）背書', () => {
      // 舊的 explanation 寫「附件一國家之 MRV 須提報與其量化全經濟體減量目標相關之基線資料，故選 C」
      // —— 決議全文查無 baseline / base year。
      expect(g?.explanation).not.toMatch(/須提報.{0,20}基線資料.{0,8}故選/);
    });

    it('保留 prior_answer 以標示此題已被修正過', () => {
      // 記最近一次的前值（C）；完整的 D → C → A 歷程在 _correction_note 裡
      expect(g?.metadata?.prior_answer).toBe('C');
    });
  });

  // 內容時效性修正（2026-07-13）。Reg (EU) 2025/2083 修正 Reg (EU) 2023/956。
  // 背景與未解事項見 CONTENT-CURRENCY.md。
  //
  // 這一組刻意「不只鎖答案字母」。上一版只驗「答案含 50、不含 80、explanation 有法規編號」，
  // 結果把一段法律上不精確的敘述永久鎖死：題幹寫「每季提前購買比例」，但第 22(2) 條課予的
  // 是「每季末帳戶中應『持有』」的義務；而且該義務自 2027 年才適用、計算基礎有兩種。
  // 只鎖字母的測試永遠不會發現這種錯。所以改鎖【行為人 / 義務或違規行為 / 法條 / 罰則】。
  describe('CBAM Art 22(2)：每季末帳戶餘額義務（80% → 50%）', () => {
    it('gist[312] 答案 50%，且題幹必須把義務本身講對', () => {
      const q = byIndex(312);
      expect(q?.answer).toBe('B');
      expect(q?.options.find((o) => o.key === 'B')?.text).toContain('50');

      const stem = q?.stem ?? '';
      expect(stem).toContain('22(2)'); // 法條
      expect(stem).toContain('2027'); // 適用起始年
      expect(stem).toMatch(/每季末/); // 時點
      expect(stem).toMatch(/持有/); // 義務是「持有」而非「購買」
      expect(stem).toMatch(/授權\s*CBAM\s*申報人/); // 行為人
      expect(stem).not.toMatch(/提前購買/); // 不得再出現錯誤敘述
    });

    it('gist[312] explanation 必須說明預設值只是兩種計算基礎之一', () => {
      const e = byIndex(312)?.explanation ?? '';
      expect(e).toMatch(/2025\/2083/);
      expect(e).toMatch(/Annex\s*IV|預設值/); // (a) 基礎
      expect(e).toMatch(/前一年|已繳交之憑證/); // (b) 基礎
      expect(e).toMatch(/2027/);
    });

    it('gist[439] 必須限定於 Art 22(2)(a)，且不得宣稱預設值是唯一方法', () => {
      const q = byIndex(439);
      expect(q?.answer).toBe('C');
      const c = q?.options.find((o) => o.key === 'C')?.text ?? '';
      expect(c).toContain('50');
      expect(c).not.toContain('80');

      expect(q?.stem).toMatch(/22\(2\)\(a\)/); // 明確限定到 (a) 款
      const e = q?.explanation ?? '';
      expect(e).toMatch(/兩種|其中之一/); // 說明還有別的基礎
      expect(e).toMatch(/前一年|已繳交之憑證/); // (b) 基礎
    });
  });

  // 原本 gist[313] 把「季末餘額不足」和「非授權之人輸入貨物」混成一題，答案給 3–5 倍。
  // 事實上：季末餘額不足（Art 22(3)）根本沒有倍數罰則，只是通知後 1 個月內補足；
  // 3–5 倍是 Art 26(2)，行為人是「非授權之人」、行為是「輸入貨物」。
  // 已拆成兩題，各自鎖定【行為人 + 違規行為 + 法條 + 罰則】。
  describe('CBAM Art 26：罰則必須區分行為人與違規行為', () => {
    it('gist[313] = Art 26(2)：非授權之人輸入貨物 → 3–5 倍', () => {
      const q = byIndex(313);
      expect(q?.answer).toBe('D');
      expect(q?.options.find((o) => o.key === 'D')?.text).toMatch(/3.*5\s*倍/);

      const stem = q?.stem ?? '';
      expect(stem).toContain('26(2)'); // 法條
      expect(stem).toMatch(/非授權/); // 行為人
      expect(stem).toMatch(/輸入/); // 違規行為
      expect(stem).not.toMatch(/未於期間購買憑證/); // 舊的指涉不明敘述

      const e = q?.explanation ?? '';
      expect(e).toMatch(/26\(1\)/); // 要點出與 26(1) 的差異
      expect(e).toMatch(/22\(3\)|1\s*個月/); // 也要點出季末餘額不足沒有倍數罰則
    });

    it('Art 26(1)：授權申報人未繳交憑證 → ETS 超額排放罰鍰，不是 3–5 倍', () => {
      // 注意：不能只比對 /授權\s*CBAM\s*申報人/ —— 「非授權 CBAM 申報人」是它的超集，
      // 會誤抓到 Art 26(2) 那題（gist[313]）。行為人必須是「授權」而「非」非授權。
      const q = DS.gist_items.find(
        (g) =>
          /26\(1\)/.test(g.stem) &&
          !/非授權/.test(g.stem) &&
          /授權\s*CBAM\s*申報人/.test(g.stem) &&
          /未.*繳交/.test(g.stem)
      );
      expect(q, 'Art 26(1) 的題目必須存在').toBeDefined();

      const correct = q?.options.find((o) => o.key === q?.answer)?.text ?? '';
      expect(correct).toMatch(/2003\/87\/EC|ETS|超額排放/); // 罰則本體
      expect(correct).toMatch(/每一張憑證/); // 計算單位
      expect(correct).not.toMatch(/3.*5\s*倍/); // 絕不是 3–5 倍

      expect(q?.stem).toMatch(/未.*繳交/); // 違規行為
      expect(q?.explanation).toMatch(/26\(2\)/); // 要點出與 26(2) 的差異
    });

    it('全庫不得再把「季末餘額／購買憑證」與「3–5 倍」綁在同一題', () => {
      const bad = DS.gist_items
        .filter((g) => /3.*5\s*倍/.test(g.options.map((o) => o.text).join()))
        .filter((g) => /購買憑證|帳戶餘額|每季末/.test(g.stem))
        .map((g) => `gist[${g.index}]`);
      expect(bad).toEqual([]);
    });
  });
});
