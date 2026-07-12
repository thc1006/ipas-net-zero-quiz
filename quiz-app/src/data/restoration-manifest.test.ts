// 還原憑證（restoration manifest）—— 讓「159 題都正確還原」這個宣稱可以被獨立驗證。
//
// 問題：repo 裡原本的測試只驗「總題數對不對、選項結構對不對、答案字母在不在選項裡」。
// 這些都證明不了「每一道還原題確實對應到來源 PDF 的哪一頁、哪一欄、第幾題、
// answer key 是什麼」。也就是說，那個宣稱光看 repo 內容是無法重現的。
//
// manifest 固定了這條證據鏈：
//   item_id -> source_document(+sha256) / page / column / question_no / answer_key
//              + raw_pdf_text_sha256（PDF 原文，一個字都沒動）
//              + canonical_source_text_sha256（套用已列明的修正之後）
//              + dataset_text_sha256（repo 裡的文字）
//              + transformations[]（動了什麼、憑什麼動）
//
// 三個 hash 必須分開記，否則就是自己驗自己 —— 只記一個（而且從 dataset 算）的話，
// 驗證等於拿 dataset-hash 比 dataset-hash，永遠相等。
//
// 而只記 canonical、不記 raw（舊版的做法）則是把「我們動過手腳」藏起來：
// 舊欄位叫 pdf_text_sha256、宣稱是「PDF 裡的文字」，實際存的卻是「套用修正之後」的文字。
// S_CHU_06 第 37 題的選項標號在 PDF 原文是 (A)(B)(B)(C)，我們改成了 (A)(B)(C)(D)。
// 結果任何人拿原始 PDF 重算都會對不上，而且看不出為什麼。
// 一條只有作者本人重算才對得上的證據鏈，不是證據鏈。
//
// 分工：
//   CI（這支測試）    不下載 PDF。只驗 manifest ↔ dataset 一致 —— 有人偷改還原題的文字，
//                     dataset_text_sha256 就對不上，當場被抓。離線、秒級。
//   人工（可重現）    `python tools/restore_from_source_pdf.py --verify`
//                     會重新下載 PDF、比對 sha256、重跑分欄擷取，逐題核對頁碼／欄位／
//                     題號／answer key／文字。實測 159/159 相符。
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import datasetRaw from './integrated_dataset.json';
import manifestRaw from './restoration-manifest.json';

interface Opt {
  key: string;
  text: string;
}
interface DsItem {
  item_id: string;
  stem: string;
  options: Opt[];
  answer?: string | null;
  exam_subject?: string;
  source?: { source_id?: string };
}
interface AnswerOverride {
  corrected_answer: string;
  reason: string;
  evidence: string;
  decided_on: string;
}
interface Entry {
  item_id: string;
  answer_override?: AnswerOverride | null;
  source_id: string;
  source_document: string;
  source_sha256: string;
  page: number;
  column: 'left' | 'right';
  source_question_number: number;
  answer_key: string;
  raw_pdf_text_sha256: string;
  canonical_source_text_sha256: string;
  transformations: { fix: string; evidence: string }[];
  dataset_text_sha256: string;
  matches_source: boolean;
  dataset_answer: string | null;
}

interface Disposition {
  source_id: string;
  source_question_number: number;
  status: string;
  item_id?: string;
  duplicate_of?: { source_id?: string; source_question_number?: number; dataset_item?: string };
  answers_agree?: boolean;
  evidence?: string;
}

const DS = datasetRaw as unknown as { our_unique_items: DsItem[] };
const MAN = manifestRaw as unknown as {
  _meta: {
    restored_count: number;
    source_question_total: number;
    disposition_summary: Record<string, number>;
    answer_conflicts: string[];
    sources: Record<string, { sha256: string; exam_subject: string }>;
  };
  entries: Entry[];
  dispositions: Disposition[];
};

// 來源 PDF 各自的總題數 —— 對帳的分母。
const EXPECTED_SOURCE_COUNT: Record<string, number> = { S_CHU_06: 100, S_CHU_07: 70 };

// 必須與 tools/restore_from_source_pdf.py 的 normalized_text_sha256() 完全一致：
// 空白全剝掉，選項依 key 排序 —— 只認內容，不認排版。
const textHash = (stem: string, options: Opt[]): string => {
  const payload =
    stem.replace(/\s+/g, '') +
    '||' +
    [...options]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((o) => `${o.key}:${o.text.replace(/[ \t\r\n]+/g, '')}`)
      .join('|');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
};

const RESTORED = DS.our_unique_items.filter((i) =>
  (i.source?.source_id ?? '').startsWith('S_CHU')
);
const BY_ID = new Map(MAN.entries.map((e) => [e.item_id, e]));

describe('restoration manifest', () => {
  it('manifest 與 dataset 的還原題一一對應', () => {
    const dsIds = RESTORED.map((i) => i.item_id).sort();
    const manIds = MAN.entries.map((e) => e.item_id).sort();
    expect(manIds).toEqual(dsIds);
    expect(MAN._meta.restored_count).toBe(MAN.entries.length);
    expect(MAN.entries.length).toBeGreaterThan(0);
  });

  // 防竄改的核心：有人偷改還原題的文字，這條就會掛。
  it('每題的 dataset_text_sha256 必須等於 repo 裡「現在」的文字 hash', () => {
    const bad = RESTORED.filter((it) => {
      const e = BY_ID.get(it.item_id);
      return !e || e.dataset_text_sha256 !== textHash(it.stem, it.options);
    }).map((it) => it.item_id);
    expect(
      bad,
      `這些還原題的文字已被改動，但 manifest 沒有同步更新。\n` +
        `若是刻意修改，請重跑：python tools/restore_from_source_pdf.py --emit\n` +
        `（該指令會重新下載 PDF 並比對，確保修改是有憑據的）\n${bad.join('\n')}`
    ).toEqual([]);
  });

  // 這一條是「repo 內容 == 來源 PDF 內容」的宣稱本身。
  // --emit 時由 tools 腳本實際比對 PDF 後寫入；這裡把它釘住，不允許偷偷改成 false。
  it('每題都必須標記 matches_source=true（repo 文字 == PDF 文字）', () => {
    const bad = MAN.entries.filter((e) => !e.matches_source).map((e) => e.item_id);
    expect(bad).toEqual([]);
  });

  // 預設一律以**來源 PDF 自己印的 answer key** 為錨點。隨便推翻它，整條證據鏈就沒有意義了
  // ——「這題我覺得應該是 C」不是理由。實際上還發生過反過來的情況：一題 ISO 14064-1
  // 強制揭露題，我們原本教 C、PDF 印 D，查證後是 **PDF 對、我們錯**。
  //
  // 但「以來源為準」不等於「明知有錯還照抄」。差別在於：偏離必須被**記錄下來、附上一手依據**，
  // 而不是安靜地改掉。這跟 transformations 是同一套規矩 —— **不允許沒被記錄的偏離**。
  it('每題的 answer 必須等於 PDF 的 answer key —— 除非有列明依據的 answer_override', () => {
    const bad = RESTORED.filter((it) => {
      const e = BY_ID.get(it.item_id);
      if (!e) return true;
      if (e.dataset_answer !== it.answer) return true;          // manifest 與 dataset 自己就對不上
      if (e.answer_key === it.answer) return false;             // 與來源一致 -> 正常
      // 與來源不一致 -> 必須有 override，且 override 說的就是現在這個答案
      return !e.answer_override || e.answer_override.corrected_answer !== it.answer;
    }).map(
      (it) =>
        `${it.item_id}: dataset=${it.answer} PDF_key=${BY_ID.get(it.item_id)?.answer_key}` +
        `（要偏離來源的答案卡，必須在 ANSWER_OVERRIDES 列明一手依據）`
    );
    expect(bad).toEqual([]);
  });

  it('每一筆 answer_override 都必須附上理由與一手依據，且真的與來源不同', () => {
    const overrides = MAN.entries.filter((e) => e.answer_override);
    // 前提：真的存在 override，否則下面在空轉
    expect(overrides.length, '沒有任何 answer_override —— 這條測試在空轉').toBeGreaterThan(0);
    for (const e of overrides) {
      const o = e.answer_override!;
      expect(o.reason, `${e.item_id} 的 override 沒寫理由`).toBeTruthy();
      expect(o.evidence, `${e.item_id} 的 override 沒附一手依據`).toBeTruthy();
      expect(o.decided_on, `${e.item_id} 的 override 沒記日期`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        o.corrected_answer,
        `${e.item_id} 的 override 更正答案與來源相同 —— 那不是 override`
      ).not.toBe(e.answer_key);
    }
  });

  // override 是刻意極小的清單。它一旦變大，就代表我們開始習慣性推翻來源 ——
  // 那時候該檢討的是「來源選錯了」，不是「再多加一筆例外」。
  it('answer_override 必須是極少數（超過 5 筆代表來源本身有問題，該重新檢討）', () => {
    const n = MAN.entries.filter((e) => e.answer_override).length;
    expect(n, `目前有 ${n} 筆 override —— 太多了，該檢討的是來源的選擇`).toBeLessThanOrEqual(5);
  });

  it('每題都要有可追溯的來源座標（PDF sha256 / 頁碼 / 欄位 / 題號）', () => {
    const bad = MAN.entries.filter(
      (e) =>
        !/^[0-9a-f]{64}$/.test(e.source_sha256) ||
        !/^https?:\/\//.test(e.source_document) ||
        !Number.isInteger(e.page) ||
        e.page < 1 ||
        (e.column !== 'left' && e.column !== 'right') ||
        !Number.isInteger(e.source_question_number) ||
        e.source_question_number < 1 ||
        !/^[A-D]$/.test(e.answer_key) ||
        !/^[0-9a-f]{64}$/.test(e.raw_pdf_text_sha256) ||
        !/^[0-9a-f]{64}$/.test(e.canonical_source_text_sha256)
    ).map((e) => e.item_id);
    expect(bad).toEqual([]);
  });

  it('同一份 PDF 的同一題號不得對應到兩個 item', () => {
    const seen = new Map<string, string[]>();
    for (const e of MAN.entries) {
      const k = `${e.source_id}#${e.source_question_number}`;
      seen.set(k, [...(seen.get(k) ?? []), e.item_id]);
    }
    const dups = [...seen.entries()].filter(([, v]) => v.length > 1);
    expect(dups).toEqual([]);
  });

  it('item_id 必須與來源座標一致（S_CHU_06-q037 ⇔ S_CHU_06 第 37 題）', () => {
    const bad = MAN.entries.filter(
      (e) => e.item_id !== `${e.source_id}-q${String(e.source_question_number).padStart(3, '0')}`
    ).map((e) => e.item_id);
    expect(bad).toEqual([]);
  });

  it('exam_subject 必須與來源 PDF 的考科一致', () => {
    const bad = RESTORED.filter((it) => {
      const e = BY_ID.get(it.item_id);
      if (!e) return true;
      return it.exam_subject !== MAN._meta.sources[e.source_id]?.exam_subject;
    }).map((it) => it.item_id);
    expect(bad).toEqual([]);
  });

  it('左右欄都有題目 —— 分欄擷取確實有效（否則等於整份只讀了一欄）', () => {
    const left = MAN.entries.filter((e) => e.column === 'left').length;
    const right = MAN.entries.filter((e) => e.column === 'right').length;
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 對帳：來源 PDF 的**每一題**都必須有交代
//
// 舊版 manifest 只報「restored_count: 159」，從來沒說另外 11 題去哪了。
// 產生 manifest 的程式是這樣寫的：
//
//     if item_id not in by_item:
//         continue          # 這一題與 gist 主庫重複，還原時已去重
//
// 那行註解是**斷言**，不是驗證 —— 它把「dataset 裡沒有」直接等同於「一定是重複題」。
// 真的在還原過程中掉了一題，這行也會安靜地把它說成重複，而且沒有人會知道。
//
// 實際稽核 170 題的結果：
//   8 題  確實是 PDF 自己重印的（normalized hash 完全相同）
//   3 題  是主庫已有的題目（題幹幾乎相同）
//   其中 1 題（S_CHU_07#13）的**答案與主庫互相矛盾** —— 我們把來源題當重複丟掉，
//         卻留下了一個錯的答案在教（主庫答 C，來源答案卡是 D；D 才是對的）。
//         這正是「靜默去重」會造成的實質傷害，而不只是紀錄不完整。
//
// 一份只講「我留下了什麼」而不講「我丟掉了什麼、為什麼」的憑證，
// 沒辦法證明「沒有東西被弄丟」—— 而那正是這份 manifest 唯一要證明的事。
describe('還原對帳：來源的每一題都要有交代', () => {
  it('disposition 覆蓋來源全部 170 題，一題不多一題不少', () => {
    const total = Object.values(EXPECTED_SOURCE_COUNT).reduce((a, b) => a + b, 0);
    expect(MAN._meta.source_question_total).toBe(total);
    expect(MAN.dispositions).toHaveLength(total);
  });

  it.each(Object.entries(EXPECTED_SOURCE_COUNT))(
    '%s 的題號必須完整覆蓋 1..%s（沒有跳號、沒有重複）',
    (srcId, expected) => {
      const nums = MAN.dispositions
        .filter((d) => d.source_id === srcId)
        .map((d) => d.source_question_number)
        .sort((a, b) => a - b);
      expect(nums).toEqual(Array.from({ length: expected }, (_, i) => i + 1));
    }
  );

  it('絕不可有 UNACCOUNTED —— 那代表題目真的掉了，不是「重複所以刪掉」', () => {
    const lost = MAN.dispositions.filter((d) => d.status === 'UNACCOUNTED');
    expect(lost, `這些來源題交代不出去向：${lost.map((d) => `${d.source_id}#${d.source_question_number}`).join(', ')}`).toEqual([]);
  });

  it('每一筆非 restored 的 disposition 都必須有證據（不能只是斷言「應該是重複」）', () => {
    const dropped = MAN.dispositions.filter((d) => d.status !== 'restored');
    expect(dropped.length).toBeGreaterThan(0); // 否則這條測試在空轉
    for (const d of dropped) {
      expect(d.evidence, `${d.source_id}#${d.source_question_number} 沒有 evidence`).toBeTruthy();
      expect(d.duplicate_of, `${d.source_id}#${d.source_question_number} 沒有指出重複對象`).toBeTruthy();
    }
  });

  it('restored 的 disposition 數必須等於 entries 數', () => {
    const restored = MAN.dispositions.filter((d) => d.status === 'restored');
    expect(restored).toHaveLength(MAN.entries.length);
    expect(MAN._meta.restored_count).toBe(MAN.entries.length);
  });

  it('各 status 加總必須等於 170（沒有被重複計數或漏算）', () => {
    const sum = Object.values(MAN._meta.disposition_summary).reduce((a, b) => a + b, 0);
    expect(sum).toBe(MAN._meta.source_question_total);
  });

  // 這是本輪真正抓到的那個錯：來源答案卡與主庫教的答案不一致
  // （S_CHU_07#13：主庫教 C，來源答案卡是 D —— D 才是對的）。
  // 已用 ISO 14064-1:2018 §9.3.1(g) + normative Annex E 裁決，主庫已更正。
  //
  // 這條測試的第一版**自己就是個假把關**：
  //
  //     const conflicts = MAN.dispositions.filter((d) => d.answers_agree === false);
  //
  // 它的鑑別力 100% 押在 answers_agree 這個**選填**欄位上，而當時沒有任何一條測試
  // 要求它必須存在、必須是 boolean。兩種靜默失效（都實測過，22/22 全綠）：
  //   欄位消失（工具哪天不再輸出）  -> undefined === false 恆為 false -> 選不到 -> 綠
  //   型別跑掉（寫成字串 'false'）  -> 'false' === false 恆為 false -> 綠
  // 後者最惡毒：一個**真實存在、而且已經被如實記錄下來**的答案衝突，被 gate 直接無視。
  //
  // 而 `expect(MAN._meta.answer_conflicts).toEqual([])` 也擋不住 —— 那是產生 manifest 的
  // 同一支腳本自己寫的自陳陣列，腳本不寫就是空的。**自己驗自己。**
  //
  // 守一個錯誤的把關，自己卻抓不到錯，是這整輪工作最不該犯的錯。
  it('不得存在未解決的答案衝突（來源答案卡 vs 主庫答案）', () => {
    const crossBank = MAN.dispositions.filter((d) => d.status === 'duplicate_in_dataset');

    // 前提：沒有這種 disposition 的話，下面全都是空轉。
    expect(
      crossBank.length,
      '沒有任何 duplicate_in_dataset —— 這條測試在空轉，鑑別力是零'
    ).toBeGreaterThan(0);

    // answers_agree 必須真的存在、而且真的是 boolean。
    for (const d of crossBank) {
      expect(
        typeof d.answers_agree,
        `${d.source_id}#${d.source_question_number} 的 answers_agree 必須是 boolean，` +
          `實際是 ${JSON.stringify(d.answers_agree)}`
      ).toBe('boolean');
    }

    // 用 !== true 而不是 === false：任何「不是明確說一致」的值都算沒交代。
    const conflicts = crossBank.filter((d) => d.answers_agree !== true);
    expect(
      conflicts.map((d) => `${d.source_id}#${d.source_question_number}`),
      '來源 PDF 自己印的答案與主庫教的答案不一致 —— 必須用一手文件裁決，不可放著'
    ).toEqual([]);

    expect(MAN._meta.answer_conflicts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 「我們動過哪些手腳」必須是公開的
//
// 舊版只存一個 pdf_text_sha256，欄位名宣稱是「PDF 裡的文字」，實際存的卻是
// **套用修正之後**的文字：S_CHU_06 第 37 題的選項標號在 PDF 原文是 (A)(B)(B)(C)，
// 我們改成了 (A)(B)(C)(D)（有憑據 —— 同一份 PDF 的第 86 題是同一道題且標號正確）。
//
// 修正本身沒問題，問題是**沒有留下痕跡**：manifest 上的 hash 既不是 PDF 的文字，
// 也沒有任何欄位說明中間做過什麼。任何人拿原始 PDF 重算都會對不上，且看不出原因。
// 一條只有作者本人重算才對得上的證據鏈，不是證據鏈 —— 它只是一份自說自話的宣稱。
//
// 現在拆成三個 hash + transformations[]，並在這裡把不變式釘死：
//   raw ≠ canonical  ⟺  transformations 非空
// 有差異卻沒列明 = 藏起來的手腳；列明了卻沒差異 = 記錄與事實不符。兩種都擋。
describe('來源文字的轉換必須全部列明', () => {
  it('每題都要有 raw / canonical / dataset 三個 hash', () => {
    const bad = MAN.entries.filter(
      (e) =>
        !/^[0-9a-f]{64}$/.test(e.raw_pdf_text_sha256) ||
        !/^[0-9a-f]{64}$/.test(e.canonical_source_text_sha256) ||
        !/^[0-9a-f]{64}$/.test(e.dataset_text_sha256)
    ).map((e) => e.item_id);
    expect(bad).toEqual([]);
  });

  it('raw ≠ canonical ⟺ transformations 非空（不允許沒被記錄的轉換）', () => {
    const bad = MAN.entries
      .filter((e) => {
        const differs = e.raw_pdf_text_sha256 !== e.canonical_source_text_sha256;
        const declared = (e.transformations ?? []).length > 0;
        return differs !== declared;
      })
      .map((e) => {
        const differs = e.raw_pdf_text_sha256 !== e.canonical_source_text_sha256;
        return `${e.item_id}: raw≠canonical=${differs} 但 transformations ${
          (e.transformations ?? []).length > 0 ? '有' : '沒有'
        }列明`;
      });
    expect(
      bad,
      '有差異卻沒列明＝藏起來的手腳；列明了卻沒差異＝記錄與事實不符'
    ).toEqual([]);
  });

  it('每一筆 transformation 都必須附上憑據（不能只寫「改了」）', () => {
    // `for (const t of []) expect(...)` 迴圈零次執行就是綠的 —— 把所有 transformations
    // 清空，這條會靜默通過（實測過）。先斷言「真的有東西可以檢查」，否則它只是在空轉。
    const all = MAN.entries.flatMap((e) => e.transformations ?? []);
    expect(all.length, '沒有任何 transformation —— 這條測試在空轉').toBeGreaterThan(0);

    for (const e of MAN.entries) {
      for (const t of e.transformations ?? []) {
        expect(t.fix, `${e.item_id} 的 transformation 沒寫改了什麼`).toBeTruthy();
        expect(t.evidence, `${e.item_id} 的 transformation 沒附憑據`).toBeTruthy();
      }
    }
  });

  // 這條確保上面兩條不是在空轉：確實存在「有被修正過」的題目。
  it('S_CHU_06-q037 就是那個被修正過的題目（選項標號 A,B,B,C -> A,B,C,D）', () => {
    const e = MAN.entries.find((x) => x.item_id === 'S_CHU_06-q037');
    expect(e).toBeDefined();
    expect(e!.transformations).toHaveLength(1);
    expect(e!.transformations[0].fix).toMatch(/lettering/i);
    expect(e!.transformations[0].evidence).toMatch(/Q86/);
    // 它必須真的和 PDF 原文不同 —— 否則這個「修正」根本沒發生
    expect(e!.raw_pdf_text_sha256).not.toBe(e!.canonical_source_text_sha256);
  });

  it('dataset 的文字必須等於 canonical（套用修正後的來源），不是等於 raw', () => {
    const bad = MAN.entries
      .filter((e) => e.dataset_text_sha256 !== e.canonical_source_text_sha256)
      .map((e) => e.item_id);
    expect(bad).toEqual([]);
    // 而且 matches_source 這個旗標必須誠實反映上面那件事
    expect(MAN.entries.filter((e) => !e.matches_source)).toEqual([]);
  });
});
