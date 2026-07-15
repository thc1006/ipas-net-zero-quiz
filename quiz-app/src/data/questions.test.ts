// 題庫資料模組測試
import { describe, it, expect } from 'vitest';
import {
  stats,
  allQuestions,
  subject1Questions,
  subject2Questions,
  questionsWithAnswer,
  getQuestionsBySubject,
  getRandomQuestions,
  getQuestionById,
  searchQuestions,
  getSimilarQuestions,
} from './questions';

describe('題庫資料模組', () => {
  describe('stats 統計資料', () => {
    it('應該有正確的總題數', () => {
      // 更新：移除有問題的題目後，總數從 719 → 648（PR #41 等批次）；
      // 再於 issue #85 因 gist-282 AR6「10 次方」題幹為 AR6 訛誤、上游 gist 本身無答案 key
      // 而移除，總數 648 → 647。
      // 2026-07-13：647 → 799。2026-01-23 的清理是把 CHU 來源「雙欄錯置」的題目直接刪掉，
      // 而非修復；那批錯置把成對的題目黏在一起，170 題被壓成 77 個壞掉的 item。
      // 現已改由來源 PDF（本身帶答案 key）以分欄擷取重建，救回這些只以合併形態存在過的題目。
      //
      // 799 → 782：移除 17 題「同一道題目、不同 item」的重複（原始 gist 尾段
      // index 538–569 重複了前段 index 4–206，main 上早就有）。實測影響：跑真實的
      // getRandomQuestions() 2000 次，9.3% 的「40題/考科一」考卷會出現同一題兩次。
      //
      // 782 → 783：CBAM 罰則原本把「季末餘額不足」和「非授權之人輸入貨物」混成一題
      // （gist[313]），但前者根本沒有倍數罰則、3–5 倍是後者。已拆成兩題，各自對應
      // Art 26(2) 與 Art 26(1)，故 +1。
      //
      // 783 → 780：依**官方評鑑內容**把 21 題 CBAM / ISO 14068-1 / PAS 2060 從考科2 移回
      // 考科1（115 年度 iPAS 簡章 §2.5：L11202 國際碳稅關貿政策(如 CBAM 等)、
      // L11205 ISO 14068-1 碳中和標準 均屬科目一；科目二只涵蓋 L121 ISO 14064-1 與
      // L122 ISO 14067，不含任何政策/貿易內容）。
      // 搬完之後，其中 3 題與**原本就在考科1、且來源明確標示為考科1**的題目撞成同科重複
      // （gist[27]/[36]/[45]），移除那 3 個重複的 item，故 -3。
      //
      // 這 3 組撞號本身就是最強的佐證：同一道 CBAM 題早就以「考科1」的身分存在了，
      // 先前把它的另一份放進考科2，本來就是錯的。
      //
      // 780 → 778：兩題的題幹開頭殘留著來源網站（yamol）的「【已刪除】NN.」——
      // 那是 yamol 自己的下架標記與站內題號。清掉那串殘留之後才發現：
      // **它們就是 yamol 的重複題**（與 q052 / q067 題幹、選項、答案完全相同，
      // yamol 正是因為重複才把它們下架）。
      //
      // 也就是說，那串殘留一直在**遮住重複** —— 題幹看起來不一樣，去重就抓不到。
      // 而它同時還跟考古題 .md 的墓碑慣例「【已刪除】」撞名。一個垃圾字串，兩個坑。
      expect(stats.total).toBe(773);
    });

    it('考科一和考科二題數加總應等於總題數', () => {
      expect(stats.subject1 + stats.subject2).toBe(stats.total);
    });

    it('gist 和 unique 題數加總應等於總題數', () => {
      expect(stats.gistCount + stats.uniqueCount).toBe(stats.total);
    });

    it('有答案的題目數應為正數', () => {
      expect(stats.withAnswer).toBeGreaterThan(0);
    });
  });

  describe('allQuestions 轉換結果', () => {
    it('轉換後題目數應等於總題數', () => {
      expect(allQuestions.length).toBe(stats.total);
    });

    it('每題應有必要欄位', () => {
      const sample = allQuestions[0];
      expect(sample).toHaveProperty('id');
      expect(sample).toHaveProperty('stem');
      expect(sample).toHaveProperty('options');
      expect(sample).toHaveProperty('subject');
      expect(sample).toHaveProperty('sourceType');
      expect(sample).toHaveProperty('hasAnswer');
    });

    it('每題應有四個選項', () => {
      const sampleSize = Math.min(50, allQuestions.length);
      for (let i = 0; i < sampleSize; i++) {
        expect(allQuestions[i].options.length).toBe(4);
      }
    });

    it('選項 key 應為 A/B/C/D', () => {
      const sample = allQuestions[0];
      const keys = sample.options.map((o) => o.key);
      expect(keys).toContain('A');
      expect(keys).toContain('B');
      expect(keys).toContain('C');
      expect(keys).toContain('D');
    });
  });

  describe('subject1Questions / subject2Questions', () => {
    it('考科一題目數應正確', () => {
      expect(subject1Questions.length).toBe(stats.subject1);
    });

    it('考科二題目數應正確', () => {
      expect(subject2Questions.length).toBe(stats.subject2);
    });

    it('所有考科一題目的 subject 應為 考科1', () => {
      subject1Questions.forEach((q) => {
        expect(q.subject).toBe('考科1');
      });
    });

    it('所有考科二題目的 subject 應為 考科2', () => {
      subject2Questions.forEach((q) => {
        expect(q.subject).toBe('考科2');
      });
    });
  });

  describe('questionsWithAnswer', () => {
    it('有答案題目數應等於 stats.withAnswer', () => {
      expect(questionsWithAnswer.length).toBe(stats.withAnswer);
    });

    it('所有有答案的題目 hasAnswer 應為 true', () => {
      questionsWithAnswer.forEach((q) => {
        expect(q.hasAnswer).toBe(true);
        expect(q.answer).not.toBeNull();
      });
    });
  });

  describe('getQuestionsBySubject', () => {
    it('取得全部題目', () => {
      const result = getQuestionsBySubject('all');
      expect(result.length).toBe(stats.total);
    });

    it('取得考科一題目', () => {
      const result = getQuestionsBySubject('考科1');
      expect(result.length).toBe(stats.subject1);
    });

    it('取得考科二題目', () => {
      const result = getQuestionsBySubject('考科2');
      expect(result.length).toBe(stats.subject2);
    });
  });

  describe('getRandomQuestions', () => {
    it('應回傳指定數量的題目', () => {
      const result = getRandomQuestions(10);
      expect(result.length).toBe(10);
    });

    it('應回傳隨機順序（多次呼叫結果不同）', () => {
      const result1 = getRandomQuestions(50).map((q) => q.id);
      const result2 = getRandomQuestions(50).map((q) => q.id);
      // 50 題隨機抽取，兩次結果完全相同的機率極低
      expect(result1).not.toEqual(result2);
    });

    it('限定考科時應只回傳該考科題目', () => {
      const result = getRandomQuestions(20, '考科1');
      result.forEach((q) => {
        expect(q.subject).toBe('考科1');
      });
    });

    it('onlyWithAnswer 時應只回傳有答案的題目', () => {
      const result = getRandomQuestions(20, 'all', true);
      result.forEach((q) => {
        expect(q.hasAnswer).toBe(true);
      });
    });

    it('要求數量超過可用題目時應回傳全部可用題目（且不含重複內容）', () => {
      const result = getRandomQuestions(10000);

      // 已不再等於 stats.total：'all' 模式會把兩科合進同一個池子，而有少數題目
      // 考科一與考科二各有一份（資料上必須兩份都留著，否則只考一科的考生會少一題）。
      // getRandomQuestions 會依「內容」去重，所以合併後的池子會比 stats.total 少幾題。
      const sig = (q: (typeof result)[number]) =>
        q.stem.replace(/\s+/g, '') +
        '||' +
        q.options
          .map((o) => o.text.replace(/\s+/g, ''))
          .sort()
          .join('|');

      // 沒有任何一題重複出現
      expect(new Set(result.map(sig)).size).toBe(result.length);
      // 且確實把整個（去重後的）題庫都拿出來了
      expect(result.length).toBe(new Set(allQuestions.map(sig)).size);
      expect(result.length).toBeLessThanOrEqual(stats.total);
    });

    it('抽出的考卷不應出現內容相同的題目（實際跑 200 份）', () => {
      const sig = (q: { stem: string; options: { text: string }[] }) =>
        q.stem.replace(/\s+/g, '') +
        '||' +
        q.options
          .map((o) => o.text.replace(/\s+/g, ''))
          .sort()
          .join('|');
      for (const subject of ['考科1', '考科2', 'all'] as const) {
        for (let i = 0; i < 200; i++) {
          const paper = getRandomQuestions(40, subject, true);
          const sigs = paper.map(sig);
          expect(new Set(sigs).size).toBe(sigs.length);
        }
      }
    });
  });

  describe('getQuestionById', () => {
    it('應能找到存在的題目', () => {
      const firstQuestion = allQuestions[0];
      const result = getQuestionById(firstQuestion.id);
      expect(result).toBeDefined();
      expect(result?.id).toBe(firstQuestion.id);
    });

    it('找不到時應回傳 undefined', () => {
      const result = getQuestionById('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('searchQuestions', () => {
    it('應能搜尋到包含關鍵字的題目', () => {
      // 使用一個常見的關鍵字
      const result = searchQuestions('碳');
      expect(result.length).toBeGreaterThan(0);
      result.forEach((q) => {
        expect(q.stem.toLowerCase()).toContain('碳');
      });
    });

    it('空關鍵字應回傳空陣列', () => {
      const result = searchQuestions('');
      expect(result).toEqual([]);
    });

    it('找不到結果應回傳空陣列', () => {
      const result = searchQuestions('xyzabc123不存在的關鍵字');
      expect(result).toEqual([]);
    });
  });

  describe('getSimilarQuestions', () => {
    it('應回傳相似題目（不包含自己）', () => {
      const question = allQuestions[0];
      const result = getSimilarQuestions(question.id, 5);
      // 結果不應包含原題目
      result.forEach((q) => {
        expect(q.id).not.toBe(question.id);
      });
    });

    it('應限制回傳數量', () => {
      const question = allQuestions[0];
      const result = getSimilarQuestions(question.id, 3);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('找不到題目時應回傳空陣列', () => {
      const result = getSimilarQuestions('non-existent-id');
      expect(result).toEqual([]);
    });
  });
});

// UI 顯示的來源連結，必須把兩個欄位都收進來。
//
// 先前 questions.ts 只讀 `metadata.sources`，於是由來源 PDF 重建的 230 題
// —— 它們的來源放在結構化的 `source.url` —— **明明有指向原始 PDF 的連結，
// 卻永遠不會顯示出來**。學生本來可以點進去看原題，卻看不到。
//
// 更糟的是 README 一度宣稱「每題附一手來源連結」。實際上 UI 只顯示得出 279/780 題，
// 而「每題」是 780。這個賣點有一半是因為 UI 沒讀而落空的。
describe('來源連結：UI 必須同時看 metadata.sources 與 source.url', () => {
  it('有 source.url 的還原題，UI 拿得到它的來源', () => {
    const restored = allQuestions.filter((q) => q.id.startsWith('S_CHU'));
    expect(restored.length, '找不到還原題 —— 這條測試在空轉').toBeGreaterThan(100);
    const withSources = restored.filter((q) => (q.sources ?? []).length > 0);
    expect(
      withSources.length,
      '還原題的 source.url 沒有被帶進 UI —— 那些連結等於不存在'
    ).toBe(restored.length);
  });

  it('sources 只收 http(s) URL，且不重複', () => {
    for (const q of allQuestions) {
      for (const u of q.sources ?? []) {
        expect(u, `${q.id} 的來源不是 http(s)：${u}`).toMatch(/^https?:\/\//);
      }
      const s = q.sources ?? [];
      expect(new Set(s).size, `${q.id} 的來源有重複`).toBe(s.length);
    }
  });

  it('gist 題目的 source 是字串 "gist"，不得被誤當成 URL', () => {
    const bad = allQuestions.filter((q) => (q.sources ?? []).some((u) => u === 'gist'));
    expect(bad.map((q) => q.id)).toEqual([]);
  });
});
