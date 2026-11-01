// 題庫資料模組測試
import { describe, it, expect } from 'vitest';
import { isQuestionScorable } from '../utils/scorable';
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
  dataset,
  withOfficialAnswer,
  getSourceCandidates,
} from './questions';
import { byPaperOrder, officialSessions, sampleEditions } from '../utils/question-source';
import { contentSignature } from '../utils/question-identity';
import manifestRaw from './restoration-manifest.json';

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
      //
      // 781 → 881：匯入 iPAS 官網公告的 115 年第一次公告試題，第一科、第二科各 50 題
      // （S_IPAS_115_01_L11／L12：題幹、選項、答案取自官方 PDF，每題帶 official_exam）。
      //
      // 881 → 979：匯入 115 年第二次公告試題，第一科 50 題、第二科 48 題（第二科第 9、15 題要讀圖，
      // 題庫還不支援圖片，不收錄，restoration-manifest 記為 not_imported_figure）。
      //
      // 979 → 983：補齊 iPAS 參考樣題（114 年版）的 10 題（#128）。題庫原本有其中 5 題（S1-p01-q004 等，改名為
      // S_IPAS_SAMPLE_114_L11／L12 加題號），另收 4 題；第一科第 2 題就是主庫的 gist[287]，不重複收錄，在它身上標
      // official_sample。
      expect(stats.total).toBe(983);
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
    // meta.with_answer 的定義是「有答案」（tools/sync_derived_counts.py 只看 answer 真值），
    // 而 questionsWithAnswer 現在的定義是「可計分」＝有答案且不帶阻斷旗標。
    // 今天兩者相等（主題庫無阻斷旗標），但直接斷言相等，會在有人第一次把某題標成
    // disputed 時炸出一條看不懂的失敗 —— 而且他重跑 sync_derived_counts.py 也修不好，
    // 因為那支工具算的是另一個量。所以把兩者的關係寫明白。
    it('可計分題數 = 有答案題數 − 帶阻斷旗標的題數', () => {
      // 刻意跟「實算」對，不跟 meta.with_answer 對：meta 是由 sync_derived_counts.py
      // 產生的，資料剛改完但還沒重跑時它是舊的 —— 拿它當基準會讓這條測試在
      // 「你只是還沒 sync」的時候紅，訊息卻在講可計分數，把人指向錯的地方。
      // meta 與資料的對帳由 dataset-integrity 的 meta.with_answer 那條負責。
      const answered = allQuestions.filter((q) => q.answer).length;
      const blockedButAnswered = allQuestions.filter(
        (q) => q.answer && !isQuestionScorable(q)
      );
      expect(questionsWithAnswer.length).toBe(answered - blockedButAnswered.length);
      expect(questionsWithAnswer.length).toBeLessThanOrEqual(answered);
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

    // 三種考科範圍各抽 200 份，共 600 次真實抽題，CI 上約 4 秒。
    // Vitest 2 的逾時管不到同步測試；Vitest 3 起同步測試也照預設 5 秒算逾時，
    // 開 coverage 又平行跑的時候會被誤判。所以給明確的上限，斷言本身不變。
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
    }, 30_000);
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
  it('有 source.url 的還原題與官方公告試題，UI 拿得到它的來源', () => {
    const restored = allQuestions.filter((q) => /^S_(CHU|IPAS)_/.test(q.id));
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

describe('官方公告試題帶進執行期', () => {
  const raw = new Map(dataset.our_unique_items.map((q) => [q.item_id, q]));
  const official = allQuestions.filter((q) => q.officialExam);

  it('題庫裡每一題官方公告試題都帶著標記，其他題目都沒有', () => {
    const expected = dataset.our_unique_items.filter((q) => q.official_exam).map((q) => q.item_id);
    expect(expected.length, '題庫裡沒有官方公告試題 —— 這條測試在空轉').toBeGreaterThan(0);
    expect(official.map((q) => q.id).sort()).toEqual([...expected].sort());
    for (const q of official) expect(q.officialExam).toEqual(raw.get(q.id)!.official_exam);
  });
});

describe('參考樣題帶進執行期', () => {
  it('題庫裡每一題參考樣題（含主庫配對的那一題）都帶著標記，其他題目都沒有', () => {
    const raw = new Map<string, unknown>([
      ...dataset.gist_items.map((g) => [`gist-${g.index}`, g.official_sample] as const),
      ...dataset.our_unique_items.map((q) => [q.item_id, q.official_sample] as const),
    ]);
    const expected = [...raw].filter(([, marker]) => marker).map(([id]) => id);
    expect(expected.length, '題庫裡沒有參考樣題：這條測試在空轉').toBeGreaterThan(0);
    expect(expected.some((id) => id.startsWith('gist-')), '沒有主庫配對的參考樣題：這條測試的 gist 那一半在空轉').toBe(
      true
    );
    const runtime = allQuestions.filter((q) => q.officialSample);
    expect(runtime.map((q) => q.id).sort()).toEqual([...expected].sort());
    for (const q of runtime) expect(q.officialSample).toEqual(raw.get(q.id));
  });
});

describe('官方題目的答案依據帶出官方答案', () => {
  const raw = new Map(dataset.our_unique_items.map((q) => [q.item_id, q]));
  const rawGist = new Map(dataset.gist_items.map((g) => [`gist-${g.index}`, g]));
  const official = allQuestions.filter((q) => q.officialExam);
  // 參考樣題包含主庫配對的那一題（gist）：它的出處只寫 'gist'，官方 PDF 的網址要從 manifest 拿
  const samples = allQuestions.filter((q) => q.officialSample);
  const SAMPLE_PDF = (
    manifestRaw as unknown as { _meta: { sources: Record<string, { url: string }> } }
  )._meta.sources;

  // 預期值直接從原始資料算：pickEvidence 挑中的那一則（第一則支持正解、夠長的引文），
  // 它的**原始**網址是不是就是這一題的**原始** source.url —— 不經過任何網址正規化，與實作各自獨立。
  // 出處的預期值直接從原始欄位組，不經過 utils/official-exam.ts：「115 年第一次公告試題第一科第 5 題」
  const expectedReference = (o: { session: string; subject: string; question_number: number }): string => {
    const [year, round] = o.session.split('-');
    return `${year} 年第${'一二三四'[Number(round) - 1]}次公告試題第${o.subject === 'L11' ? '一' : '二'}科第 ${o.question_number} 題`;
  };
  const pickedIsFrom = (
    q: { answer: string | null; metadata?: (typeof dataset.our_unique_items)[number]['metadata'] },
    url: string | undefined
  ): boolean => {
    const picked = (q.metadata?.evidence ?? []).find(
      (e) => e.supports_option === q.answer && (e.quote ?? '').trim().length >= 8
    );
    return picked !== undefined && url !== undefined && picked.url === url;
  };
  const pickedIsItsOwnSource = (q: (typeof dataset.our_unique_items)[number]): boolean =>
    pickedIsFrom(q, q.source?.url);
  // 這一題的引文裡有沒有官方 PDF 上的那一題（支持正解、夠長的引文），不管它是不是畫面挑中的那一則
  const carries = (
    q: { answer: string | null; metadata?: (typeof dataset.our_unique_items)[number]['metadata'] },
    url: string | undefined
  ): boolean =>
    url !== undefined &&
    (q.metadata?.evidence ?? []).some(
      (e) => e.supports_option === q.answer && (e.quote ?? '').trim().length >= 8 && e.url === url
    );

  // #148：以前只在畫面挑中的依據就是官方 PDF 那一題時才帶出官方答案。題目另有法條或《巴黎協定》的引文時，
  // 那一則排在前面、被挑中，「官方公告的參考答案」那一行就不見了（115 年第一次的 4 題）
  it('官方公告試題一律帶出答案欄的選項與題目位置，答案依據是法條或《巴黎協定》時也帶', () => {
    for (const q of official) {
      const expected = carries(raw.get(q.id)!, raw.get(q.id)!.source?.url)
        ? { kind: 'exam', answer: q.answer, reference: expectedReference(q.officialExam!) }
        : undefined;
      expect(q.evidence?.official, q.id).toEqual(expected);
    }
    const scorable = official.filter((q) => q.hasAnswer);
    expect(scorable.filter((q) => !q.evidence?.official).map((q) => q.id), '有答案的官方題沒有帶出官方答案').toEqual([]);
    const otherFirst = scorable.filter((q) => !pickedIsItsOwnSource(raw.get(q.id)!));
    expect(otherFirst.length, '沒有答案依據是別的引文的官方題：這條測試的 #148 那一半在空轉').toBeGreaterThan(0);
  });

  it('參考樣題也一樣：引文裡有樣題 PDF 那一題時，帶出「解答」印的選項與題目位置；主庫配對的那一題也帶', () => {
    expect(samples.length, '題庫裡沒有參考樣題：這條測試在空轉').toBeGreaterThan(0);
    const twins = samples.filter((q) => rawGist.has(q.id));
    expect(twins.length, '沒有主庫配對的參考樣題：這條測試的 gist 那一半在空轉').toBeGreaterThan(0);
    for (const q of samples) {
      const o = q.officialSample!;
      const pdf = SAMPLE_PDF[`S_IPAS_SAMPLE_${o.edition}_${o.subject}`]?.url;
      const expected = carries(raw.get(q.id) ?? rawGist.get(q.id)!, pdf)
        ? {
            kind: 'sample',
            answer: q.answer,
            reference: `參考樣題（${o.edition} 年版）第${o.subject === 'L11' ? '一' : '二'}科第 ${o.question_number} 題`,
          }
        : undefined;
      expect(q.evidence?.official, q.id).toEqual(expected);
    }
    expect(samples.filter((q) => q.evidence?.official).length).toBeGreaterThan(0);
    expect(
      twins.filter((q) => q.evidence?.official).map((q) => q.id),
      '主庫配對的那一題沒有帶出答案'
    ).toEqual(twins.map((q) => q.id));
  });

  // 主庫配對的那一題（gist）沒有 source.url 可比，認的是參考樣題匯入工具寫的那一則引文（generated_by）：
  // data/official-sample.test.ts 拿 manifest 核對過它的網址就是樣題 PDF
  it('主庫配對的那一題：引文裡有匯入工具寫的那一則才帶；引文沒有標記、標記是別的工具，都不帶', () => {
    const g = dataset.gist_items.find((x) => x.official_sample)!;
    const own = g.metadata!.evidence!.find(
      (e) => e.generated_by === 'tools/import_official_sample.py'
    )!;
    const evidence = { quote: own.quote!, url: own.url! };
    const expected = {
      kind: 'sample',
      answer: g.answer,
      reference: `參考樣題（114 年版）第一科第 ${g.official_sample!.question_number} 題`,
    };
    expect(withOfficialAnswer(g, evidence)?.official).toEqual(expected);
    // 畫面挑中的是別的引文（例如法條）也帶：官方答案說的是這一題，不是那一則引文（#148）
    expect(withOfficialAnswer(g, { ...evidence, url: 'https://law.moj.gov.tw/x' })?.official).toEqual(expected);
    const relabel = (generated_by: string | undefined) => ({
      ...g,
      metadata: {
        ...g.metadata,
        evidence: g.metadata!.evidence!.map((e) => (e.generated_by ? { ...e, generated_by } : e)),
      },
    });
    expect(withOfficialAnswer(relabel(undefined), evidence)?.official).toBeUndefined();
    expect(
      withOfficialAnswer(relabel('tools/import_official_exam.py'), evidence)?.official
    ).toBeUndefined();
    expect(
      withOfficialAnswer({ ...g, official_sample: undefined }, evidence)?.official
    ).toBeUndefined();
  });

  // 出處與引文都不是 https（safeEvidenceUrl 兩邊都給 undefined）：「沒有網址」不能等於「同一個網址」
  it('出處與引文的網址都不是 https，就不帶', () => {
    const q = raw.get(official[0].id)!;
    const http = q.source!.url!.replace(/^https:/, 'http:');
    const plain = {
      ...q,
      source: { ...q.source, url: http },
      metadata: { ...q.metadata, evidence: q.metadata!.evidence!.map((e) => ({ ...e, url: http })) },
    };
    const evidence = { quote: '畫面挑中的引文', url: 'https://law.moj.gov.tw/x' };
    expect(withOfficialAnswer(plain, evidence)?.official).toBeUndefined();
    expect(withOfficialAnswer(q, evidence)?.official?.answer).toBe(q.answer);
  });

  it('官方 PDF 那一則不支持正解、或引文太短，就不帶', () => {
    const q = raw.get(official[0].id)!;
    const evidence = { quote: '畫面挑中的引文', url: 'https://law.moj.gov.tw/x' };
    const withOwn = (change: Record<string, unknown>) => ({
      ...q,
      metadata: {
        ...q.metadata,
        evidence: q.metadata!.evidence!.map((e) => (e.url === q.source!.url ? { ...e, ...change } : e)),
      },
    });
    expect(withOfficialAnswer(withOwn({}), evidence)?.official?.answer).toBe(q.answer);
    const other = ['A', 'B', 'C', 'D'].find((k) => k !== q.answer)!;
    expect(withOfficialAnswer(withOwn({ supports_option: other }), evidence)?.official).toBeUndefined();
    expect(withOfficialAnswer(withOwn({ quote: '太短' }), evidence)?.official).toBeUndefined();
    // 長度的邊界：8 個字算（與 pickEvidence 同一條），7 個字不算
    expect(withOfficialAnswer(withOwn({ quote: '一二三四五六七八' }), evidence)?.official?.answer).toBe(q.answer);
    expect(withOfficialAnswer(withOwn({ quote: '一二三四五六七' }), evidence)?.official).toBeUndefined();
    expect(withOfficialAnswer(q, undefined)).toBeUndefined();
  });

  // #148 回報的那一題：答案照 PDF 是 B，原本沒有解析、依據只有官方題目本身
  it('115 年第一次第二科第 6 題：有匯入工具寫的解析，答案依據是 GUM 的誤差定義，也寫出官方答案 B', () => {
    const q = getQuestionById('S_IPAS_115_01_L12-q006')!;
    expect(q.answer).toBe('B');
    expect(q.explanation).toMatch(/誤差應予以修正/);
    const metadata = raw.get(q.id)!.metadata as Record<string, unknown>;
    expect(metadata.explanation_source).toMatchObject({ generated_by: 'tools/import_official_exam.py' });
    expect(q.evidence?.url).toBe('https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf');
    expect(q.evidence?.quote).toMatch(/^B\.2\.19 error \(of measurement\)/);
    // 法條（第 2 條查驗的定義、第 9 條）只撐解析的最後一句，排在 GUM 後面、官方題目前面
    const urls = (raw.get(q.id)!.metadata?.evidence ?? []).map((e) => e.url);
    expect(urls.slice(-3, -1)).toEqual([
      'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=O0020102&flno=2',
      'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=O0020102&flno=9',
    ]);
    expect(q.evidence?.official).toEqual({ kind: 'exam', answer: 'B', reference: '115 年第一次公告試題第二科第 6 題' });
  });

  it('每一份官方來源都至少有一題帶出官方答案（不讓一整場安靜地消失）', () => {
    const sessions = new Set(official.map((q) => `${q.officialExam!.session} ${q.officialExam!.subject}`));
    expect(sessions.size, '題庫裡沒有官方公告試題 —— 這條測試在空轉').toBeGreaterThan(0);
    for (const s of sessions) {
      const withAnswer = official.filter(
        (q) => `${q.officialExam!.session} ${q.officialExam!.subject}` === s && q.evidence?.official
      );
      expect(withAnswer.length, `${s} 沒有任何一題帶出官方答案`).toBeGreaterThan(0);
    }
  });

  it('其他題目的答案依據不帶官方答案', () => {
    // 這一條擋得住「拿掉 official_exam 的判斷」，靠的是有非官方題的依據就出自它自己的出處（例如樣題 PDF 上
    // 的那一題）—— 沒有這種題目，拿掉判斷也一樣綠。
    const ownSource = dataset.our_unique_items.filter(
      (q) => !q.official_exam && !q.official_sample && pickedIsItsOwnSource(q)
    );
    expect(ownSource.length, '沒有依據出自自己出處的非官方題 —— 這條測試在空轉').toBeGreaterThan(0);
    const bad = allQuestions
      .filter((q) => !q.officialExam && !q.officialSample && q.evidence?.official)
      .map((q) => q.id);
    expect(bad).toEqual([]);
  });

  it('同一個上傳資料夾裡的其他文件（教材、另一科的公告試題）不算這一題的官方 PDF', () => {
    // 官網把教材、參考樣題、各科的公告試題放在同一個上傳資料夾：只比網站或資料夾，教材引文底下就會
    // 冒出「官方公告的參考答案」。
    const q = raw.get(official[0].id)!;
    const own = q.source!.url!;
    const folder = own.slice(0, own.lastIndexOf('/') + 1);
    for (const url of [`${folder}%E8%80%83%E7%A7%911%E6%95%99%E6%9D%90.pdf`, `${folder}115-01-L12.pdf`]) {
      const moved = {
        ...q,
        metadata: { ...q.metadata, evidence: q.metadata!.evidence!.map((e) => ({ ...e, url })) },
      };
      expect(withOfficialAnswer(moved, { quote: '同一個資料夾裡的另一份文件', url })?.official, url).toBeUndefined();
    }
  });

  it('網址寫法不同（中文未編碼、主機名大寫）也認得出是同一份官方 PDF', () => {
    const q = raw.get(official[0].id)!;
    const encoded = 'https://www.ipas.org.tw/%E5%85%AC%E5%91%8A.pdf';
    const evidence = { quote: '官方公告試題的題幹與選項', url: encoded };
    const withOwnUrl = (url: string) => ({
      ...q,
      source: { ...q.source, url: 'https://WWW.ipas.org.tw/公告.pdf' },
      metadata: {
        ...q.metadata,
        evidence: q.metadata!.evidence!.map((e) => (e.url === q.source!.url ? { ...e, url } : e)),
      },
    });
    expect(withOfficialAnswer(withOwnUrl(encoded), evidence)?.official?.answer).toBe(q.answer);
    expect(withOfficialAnswer(withOwnUrl('https://www.ipas.org.tw/公告.pdf'), evidence)?.official?.answer).toBe(q.answer);
    expect(withOfficialAnswer({ ...withOwnUrl(encoded), official_exam: undefined }, evidence)?.official).toBeUndefined();
    expect(withOfficialAnswer(withOwnUrl('https://law.moj.gov.tw/x'), evidence)?.official).toBeUndefined();
  });

  it('參考樣題的標記換成公告試題的標記，帶出的就是公告試題的說法（兩種不會混用）', () => {
    const q = raw.get(samples.find((x) => raw.has(x.id))!.id)!;
    const evidence = { quote: '參考樣題的題幹與選項', url: q.source!.url! };
    expect(withOfficialAnswer(q, evidence)?.official?.kind).toBe('sample');
    const exam = { session: '115-01', exam_date: '2026-05-16', subject: 'L11', question_number: 3 };
    expect(withOfficialAnswer({ ...q, official_sample: undefined, official_exam: exam }, evidence)?.official).toEqual({
      kind: 'exam',
      answer: q.answer,
      reference: '115 年第一次公告試題第一科第 3 題',
    });
    expect(withOfficialAnswer({ ...q, official_sample: undefined }, evidence)?.official).toBeUndefined();
  });
});

// #128 只出官方題目：抽題範圍只含帶官方標記、考科相符、有標準答案的題目，照原卷順序。
describe('getSourceCandidates（只出官方題目時的抽題範圍）', () => {
  const official = allQuestions.filter((q) => (q.officialExam || q.officialSample) && isQuestionScorable(q));
  const keyOf = (q: (typeof allQuestions)[number]) => {
    const o = q.officialExam ?? q.officialSample!;
    return `${q.officialExam?.session ?? `sample ${q.officialSample!.edition}`}|${o.subject}|${o.question_number}`;
  };

  it('全部考科：每一題都帶官方標記、有標準答案、不重複，照原卷順序，一題不漏', () => {
    const got = getSourceCandidates('all', 'official');
    expect(got.length).toBeGreaterThan(0);
    expect(got.filter((q) => (!q.officialExam && !q.officialSample) || !isQuestionScorable(q))).toEqual([]);
    expect(got.filter((q) => q.officialSample).length, '參考樣題沒有進官方題目的範圍').toBeGreaterThan(0);
    expect(new Set(got.map(contentSignature)).size).toBe(got.length);
    expect(got.map(keyOf)).toEqual([...got].sort(byPaperOrder).map(keyOf));
    expect(new Set(got.map((q) => q.id))).toEqual(new Set(official.map((q) => q.id)));
  });

  it('可與考科組合：只出考科一的官方題', () => {
    const got = getSourceCandidates('考科1', 'official');
    expect(got.length).toBeGreaterThan(0);
    expect(
      got.filter((q) => q.subject !== '考科1' || (q.officialExam ?? q.officialSample)?.subject !== 'L11')
    ).toEqual([]);
    expect(got.length).toBe(official.filter((q) => q.subject === '考科1').length);
  });

  it('只出某一場、某一科', () => {
    for (const session of officialSessions(allQuestions)) {
      for (const subject of ['考科1', '考科2'] as const) {
        const got = getSourceCandidates(subject, `exam:${session}`);
        const want = official.filter((q) => q.officialExam?.session === session && q.subject === subject);
        expect(got.length).toBeGreaterThan(0);
        expect(got.map((q) => q.id)).toEqual([...want].sort(byPaperOrder).map((q) => q.id));
      }
    }
  });

  it('只出某一版參考樣題、某一科', () => {
    expect(sampleEditions(allQuestions).length).toBeGreaterThan(0);
    for (const edition of sampleEditions(allQuestions)) {
      for (const subject of ['考科1', '考科2'] as const) {
        const got = getSourceCandidates(subject, `sample:${edition}`);
        const want = official.filter((q) => q.officialSample?.edition === edition && q.subject === subject);
        expect(got.length).toBeGreaterThan(0);
        expect(got.map((q) => q.id)).toEqual([...want].sort(byPaperOrder).map((q) => q.id));
      }
    }
  });

  it('認不得的場次或版次一題都不出（不退回全部題目）', () => {
    expect(getSourceCandidates('all', 'exam:999-01')).toEqual([]);
    expect(getSourceCandidates('all', 'sample:999')).toEqual([]);
  });
});
