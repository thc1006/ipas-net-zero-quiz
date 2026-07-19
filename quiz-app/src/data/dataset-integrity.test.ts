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
import poolRaw from './practice_pool.json';
import {
  checkFlags,
  formatFlagViolations,
  type FlaggedItem,
} from '../utils/quality-flags';
import { hasPrimarySource } from '../utils/source-authority';

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
const POOL = poolRaw as unknown as { items: { id: string; answer: string | null }[] };

// ── 官方答案卡：把 120 個「已跟官方答案對過」的答案釘死 ────────────────
//
// iPAS 公版教材的範例題 PDF **直接印答案卡**。`tools/answer_key_crosscheck.py`
// 把題庫的答案逐題拿去跟官方答案卡比對過了 —— 這是本專案**第一個能機械驗證
// 「答案」（而不是「引用」）的檢查**。32 個錯答案在此之前全靠人一題一題挖。
//
// 那支工具要抓 PDF，**CI 不跑它**（我們刻意不讓 CI 下載/解析 PDF）。
//    所以線上驗一次、把結果凍進資料，再由**這一道離線 gate 守一輩子**：
//    **只要有人改動這 120 題的答案，CI 就紅。**（跟釘法條 sha256 同一個模式。）
//
// 比對必須**按文字、不按字母**：題庫把選項順序打散、文字也改寫過。
//    我親手踩過 —— 教材印 (D)、題庫標 (A)，我差點宣告它是錯答案，
//    但教材的 (D) 就是題庫的 (A)。**字母是排版，文字才是內容。**
interface AnswerKeyCheck {
  verdict: string;
  answer: string;
  source: string;
  key_text: string;
}
const akc = (it: Item): AnswerKeyCheck | undefined =>
  (it.metadata as unknown as { answer_key_check?: AnswerKeyCheck })?.answer_key_check;

// ── evidence.supports_option：這筆引文**確立了哪個選項是答案** ──────────
//
// 定義（過去它同時有四種意思，所以先把定義釘死）：
//   **「在『本題庫的選項編號』下，這筆引文所確立的正解。」**
//
// 它**不是**下列任何一種：
//   ✗ 來源文件上的字母 —— 題庫把選項**打散過、也改寫過文字**。
//     gist[50] 標 C，因為來源 PDF 上是 (C)「新增核能發電」；但在題庫裡它是 (B)。
//   ✗ 「引文肯定了哪個選項」—— 對「何者**錯誤**」的題目，那**正好是答案的反面**。
//     gist[374] 標 D（引文肯定的那個真敘述），但答案是 C（那個假敘述）。
//   ✗ 'N/A' / 'none' / '' —— **一個沒有指向任何選項的標籤，不該存在。**
//     引文釘不住答案就**不要寫這個欄位**，不要塞垃圾值假裝有。
//
// **這道 gate 紅了的時候，不要改 `answer` 去遷就 `supports_option`。**
//    `answer` 是內容，`supports_option` 只是標籤 —— 而**過去 5 次不一致，5 次都是標籤錯**。
//    先去把那筆引文讀完。改錯方向會把 5 個正確答案改成錯的。
describe('evidence.supports_option 必須真的指向本題的答案', () => {
  const evOf = (it: Item) =>
    (it.metadata as unknown as { evidence?: { supports_option?: string }[] })?.evidence?.[0];

  it('若有 supports_option，它必須是本題**存在的**選項代號', () => {
    const bad = ALL.filter((it) => {
      const s = evOf(it)?.supports_option;
      return s !== undefined && !it.options.some((o) => o.key === s);
    }).map((it) => `${who(it)}: supports_option=${JSON.stringify(evOf(it)?.supports_option)}`);
    expect(bad, "不是選項代號的值（'N/A' / 'none' / ''）請直接刪掉這個欄位").toEqual([]);
  });

  it('supports_option 必須等於 answer —— 除非那是有記錄的刻意偏離', () => {
    // S_CHU_06-q094：引文（來源答案卡）確實支持 D，而我們**刻意**採 C，
    // 依據寫在 restoration-manifest.json 的 answer_override 裡。
    // 這個不一致是**故意留在資料裡的**，不是疏漏 —— 把它藏起來才是問題。
    const OVERRIDDEN = new Set(['S_CHU_06-q094']);
    const bad = ALL.filter((it) => {
      const s = evOf(it)?.supports_option;
      if (s === undefined || OVERRIDDEN.has(who(it))) return false;
      return s !== it.answer;
    }).map(
      (it) =>
        `${who(it)}: 引文標 ${evOf(it)?.supports_option}，但答案是 ${it.answer}。` +
        `先讀那筆引文 —— **不要改 answer 去遷就標籤**（過去 5 次不一致，5 次都是標籤錯）`
    );
    expect(bad).toEqual([]);
  });

  it('答案為 null（多重正解）的題目不該有 supports_option —— 沒有答案可以「支持」', () => {
    const bad = ALL.filter((it) => !it.answer && evOf(it)?.supports_option !== undefined).map(who);
    expect(bad).toEqual([]);
  });

  it('這條測試不能空轉 —— 必須真的有一批帶 supports_option 的引文', () => {
    expect(ALL.filter((it) => evOf(it)?.supports_option).length).toBeGreaterThan(500);
  });

  // **上面那道 gate 有一個它自己擋不住的漏洞，突變測試證實過：**
  //    把 `supports_option` 和 `answer` **一起**改成同一個錯的值 —— 兩邊「一致」了，gate 變綠。
  //    而 gist[374] 之類的題目沒有官方答案卡可對，於是**沒有任何閘門攔得住**。
  //
  //    所以這 5 題（它們的 supports_option **曾經全部標錯過**）多釘一個錨點：
  //    `answer_pinned` —— 而且它帶著**人看得懂的理由**。
  //    要偷偷改動它們，就得連這段理由一起改掉；那在 code review 裡藏不住。
  //
  //    誠實地說：**沒有任何離線 gate 擋得住一個「三個地方一起改」的人。**
  //    gate 能做的是讓**無心的漂移**變得不可能，並且讓有心的改動**留下痕跡**。
  it('answer_pinned：曾經標錯過的那批，答案不准再無聲地變', () => {
    const pinned = ALL.map((it) => ({
      it,
      p: (it.metadata as unknown as { answer_pinned?: { answer: string; why: string } })
        ?.answer_pinned,
    })).filter((x) => x.p);
    expect(pinned.length, 'answer_pinned 一筆都沒有 —— 這條測試在空轉').toBeGreaterThan(0);
    const bad = pinned
      .filter(({ it, p }) => it.answer !== p!.answer)
      .map(({ it, p }) => `${who(it)}: 現在=${it.answer}，但已釘死在 ${p!.answer}（${p!.why.slice(0, 40)}…）`);
    expect(bad, '有題目的答案偏離了已釘死的判斷').toEqual([]);
    for (const { it, p } of pinned) {
      expect(p!.why?.length, `${who(it)} 的 answer_pinned 沒寫理由 —— 那就只是一句宣稱`).toBeGreaterThan(20);
    }
  });
});

describe('官方答案卡：對過的答案不准再被改動', () => {
  const meta = DS.meta.answer_key_check as { confirmed: number; population: number } | undefined;
  const checked = ALL.filter((it) => akc(it));

  it('meta.answer_key_check.confirmed 必須等於資料裡實際蓋章的題數', () => {
    expect(meta, 'meta.answer_key_check 不見了').toBeDefined();
    expect(checked.length, '蓋章題數與 meta 不符').toBe(meta!.confirmed);
    expect(meta!.confirmed, '一題都沒對過 —— 這條測試在空轉').toBeGreaterThan(0);
    expect(meta!.confirmed).toBeLessThanOrEqual(meta!.population);
  });

  it('每一題的 answer 都必須仍等於官方答案卡確認過的那個答案', () => {
    const drifted = checked
      .filter((it) => it.answer !== akc(it)!.answer)
      .map((it) => `${who(it)}: 現在=${it.answer} 但官方答案卡確認的是=${akc(it)!.answer}`);
    expect(drifted, '有題目的答案偏離了官方答案卡').toEqual([]);
  });

  it('蓋章必須留下可回溯的證據（答案卡出處與原文）', () => {
    const bad = checked
      .filter((it) => {
        const a = akc(it)!;
        return (
          a.verdict !== 'agrees_with_official_key' ||
          !/^https:\/\/usr\.chu\.edu\.tw\/.*\.pdf$/.test(a.source ?? '') ||
          !(a.key_text ?? '').trim()
        );
      })
      .map(who);
    expect(bad, 'answer_key_check 缺出處或答案卡原文 —— 那就只是一句宣稱').toEqual([]);
  });
});

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
  // 原本寫 `content_verified_as_of: "2026-07-13"` —— 下游會理解成「整份題庫都查證到
  // 這一天」。實際上只實查了一部分（實查題數＝reverified_count，由下方 gate 釘死在資料上），
  // 其餘題連 time_sensitive 都沒標、根本沒碰過。
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
      not_reviewed_this_round_count: number;
      known_unresolved: { id: string; resolved?: boolean }[];
      note: string;
    };

    it('不得再出現會被誤讀為「整份題庫已查證」的 content_verified_as_of', () => {
      expect(DS.meta).not.toHaveProperty('content_verified_as_of');
    });

    // **`>=`，不是 `===`。** 這裡原本寫 `=== last_review_date`，
    // 而那個寫法有一個很醜的失敗模式：**一題查得越新，分數越低。**
    //
    // gist[520] 在 last_review_date（07-13）複查過。隔天我又查了一次，
    // 而且**抓出它的答案是錯的**（B→C），於是 valid_as_of 變成 07-14 ——
    // `=== last` 不成立，它就從「本輪已重查」掉出去，還被歸進「積欠未查」那一堆。
    // 「我今天重查並修好了它」被記成「我沒查它」。
    //
    // 同一條規則在 tools/sync_derived_counts.py 有第二份實作 —— 兩邊要一起改。
    // （ISO 日期字串的字典序 == 時序。）
    it('reverified_count 必須等於資料裡實際重查過的題數', () => {
      const actual = ALL.filter(
        (it) => (it.metadata?.valid_as_of ?? '') >= cr.last_review_date
      ).length;
      expect(cr.reverified_count).toBe(actual);
    });

    it('time_sensitive_count / total_questions 必須與資料一致', () => {
      expect(cr.total_questions).toBe(ALL.length);
      expect(cr.time_sensitive_count).toBe(
        ALL.filter((it) => (it.quality_flags ?? []).includes('time_sensitive')).length
      );
    });

    // 「積欠」= time_sensitive 而且 valid_as_of **早於**本輪 —— 一樣是 `<`，不是 `!==`。
    // 缺 valid_as_of 的一律算積欠（`'' < last`），與 sync_derived_counts.py 逐字對齊。
    it('carried_over_count 必須等於「標了 time_sensitive 但本輪沒重查」的題數', () => {
      const actual = ALL.filter(
        (it) =>
          (it.quality_flags ?? []).includes('time_sensitive') &&
          (it.metadata?.valid_as_of ?? '') < cr.last_review_date
      ).length;
      expect(cr.carried_over_count).toBe(actual);
    });

    it('本輪查證的題數必須「少於」總題數 —— 否則就是在宣稱全庫已查證', () => {
      expect(cr.reverified_count).toBeLessThan(cr.total_questions);
      expect(cr.note).toMatch(/不是「整份題庫已查證/);
      expect(cr.note).toMatch(/valid_as_of/); // 必須指出以每題的 valid_as_of 為準
    });

    // not_reviewed_this_round_count 曾凍在舊快照 680，正確值是 total - reverified。
    // 沒有這條 gate、sync 也沒算它，於是它一路漂成假的精確數字。現在由公式釘死。
    it('not_reviewed_this_round_count 必須等於 total - reverified（不得是過期快照）', () => {
      expect(cr.not_reviewed_this_round_count).toBe(cr.total_questions - cr.reverified_count);
    });

    it('known_unresolved 必須列出仍未解決的事項', () => {
      const open = cr.known_unresolved.filter((u) => !u.resolved);
      expect(open.length).toBeGreaterThan(0);
      expect(open.map((u) => u.id)).toContain('PAS_2060_withdrawal_date');
      // 這裡原本 `toContain('ifrs_issb_tcfd_not_reverified')` —— 那把**過期的 unresolved 狀態釘死**：
      // 11 題早已於 2026-07-20 補查證（content_reverified_2026_07=true、carried_over=0），頂層事項卻被
      // 測試要求維持 open，於是 CI 全綠仍放過了「治理敘述與資料自相矛盾」。改為要求它已 resolved。
      const ifrs = cr.known_unresolved.find((u) => u.id === 'ifrs_issb_tcfd_not_reverified');
      expect(ifrs?.resolved, 'IFRS 那批已於 2026-07-20 補查證，此事項應標 resolved').toBe(true);
    });

    // 治理過期防護（#100 的教訓）：一個「仍 open」的 known_unresolved 事項，不得宣稱
    // 「某批題本輪未重查 / content_reverified_2026_07=false」，卻在資料裡對不到任何真的未重查的題。
    // 這正是舊 toContain 沒守住、反而幫倒忙釘死的那個洞。
    it('open 的 known_unresolved 不得宣稱「未重查」卻與資料矛盾（治理 split-brain）', () => {
      const open = cr.known_unresolved.filter((u) => !u.resolved);
      const unreverified = ALL.filter(
        (it) =>
          (it as unknown as { metadata?: { content_reverified_2026_07?: boolean } }).metadata
            ?.content_reverified_2026_07 === false
      ).length;
      const claiming = open.filter((u) =>
        /本輪未重查|尚未重(新)?查證|content_reverified_2026_07\s*[=:]\s*false|沿用\s*valid_as_of=2026-01-23/.test(
          (u as { detail?: string }).detail ?? ''
        )
      );
      if (claiming.length > 0) {
        expect(
          unreverified,
          `${claiming.map((u) => u.id).join(',')} 仍 open 宣稱有題未重查，但資料裡 content_reverified_2026_07=false 的題數為 ${unreverified} —— 治理敘述已過期`
        ).toBeGreaterThan(0);
      }
    });

    // 治理 metadata 與題目現況的交叉一致性：一旦某未解事項標了 resolved_for_scoring
    // （代表它提到的題目「已救回、可計分」），那些題目就**必須真的有答案**。
    // 若日後有人把其中一題重新撤成 null，或有人刪掉題目答案卻沒回頭改頂層摘要，
    // 這條會當場紅 —— 專治「頂層說已解決、個別題卻是 null」的 split-brain。
    it('resolved_for_scoring 的事項，其提及的題目必須真的可計分（answer 非 null）', () => {
      const byIndex = new Map(ALL.map((it) => [it.index, it]));
      const poolById = new Map(POOL.items.map((i) => [i.id, i]));
      const entries = cr.known_unresolved as unknown as {
        id: string;
        detail?: string;
        resolved_for_scoring?: boolean;
      }[];
      const scoped = entries.filter((u) => u.resolved_for_scoring);
      expect(scoped.length, '沒有任何 resolved_for_scoring 事項 —— 這條在空轉').toBeGreaterThan(0);
      const bad: string[] = [];
      let checked = 0;
      for (const u of scoped) {
        const detail = u.detail ?? '';
        for (const m of detail.matchAll(/gist\[(\d+)\]/g)) {
          const q = byIndex.get(Number(m[1]));
          if (q) {
            checked++;
            if (q.answer == null) bad.push(`${u.id}: gist[${m[1]}] 仍為 null`);
          }
        }
        for (const m of detail.matchAll(/pool-[A-Za-z0-9_-]+/g)) {
          const q = poolById.get(m[0]);
          if (q) {
            checked++;
            if (q.answer == null) bad.push(`${u.id}: ${m[0]} 仍為 null`);
          }
        }
      }
      expect(checked, 'resolved_for_scoring 事項裡沒對到任何題目 id —— 交叉檢查在空轉').toBeGreaterThan(0);
      expect(
        bad,
        '頂層 known_unresolved 標了 resolved_for_scoring，個別題卻仍是 null（治理 split-brain）'
      ).toEqual([]);
    });

    // 頂層「誠實 metadata」不得再內嵌會漂的過期快照數字（例：103/783、422 題完全沒有來源、
    // 351/773）。這些一律改為指向被 gate/sync 守住的欄位或自動生成的 VERIFICATION-GAPS.md。
    it('content_review.note / metadata_honesty_note 不得內嵌會漂的過期快照數字', () => {
      const blob =
        JSON.stringify(cr.note) + JSON.stringify(DS.meta.metadata_honesty_note);
      expect(blob, '出現過期總題數 783（現為 773）').not.toMatch(/783/);
      expect(
        blob,
        '誠實 note 不應硬編「N 題完全沒有來源 URL」的快照 —— 請指向 VERIFICATION-GAPS.md'
      ).not.toMatch(/\d+\s*題[^。，]{0,8}完全沒有來源\s*URL/);
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
    // 正規化必須夠狠：**只剝空白是不夠的**。
    //
    // 實測抓到的漏網之魚：
    //   「2024 年 1‑3 月」vs「2024年1–3月」 —— 連字號是不同的 Unicode 字元（U+2011 / U+2013）
    //   「「混合法」」    vs「“混合法”」   —— 中文引號 vs 西文引號
    // 兩組都是同一道題、同一個答案，只因為標點與全形/半形不同就溜過去了。
    //
    // 只要題幹有任何一點雜訊，重複就抓不到 —— 這正是「【已刪除】90.」那串來源殘留
    // 能一直遮住兩題重複的原因。所以這裡用 NFKC + 剝掉所有非文數字。
    // 不可以用 /[\s\W_]+/：JS 的 \W 是 [^A-Za-z0-9_]，**中文字全部符合 \W**
    //    —— 那會把題幹的中文整段刪光，剩下的空殼互相「重複」，爆出一堆假警報。
    //    （Python 的 \W 是 Unicode-aware，行為完全不同 —— 我就是這樣被騙的。）
    //    用 Unicode property escape：剝標點(\p{P})、分隔(\p{Z})與空白，保留 CJK。
    //
    // **絕對不可以連 \p{S}（符號）一起剝**。× ÷ + − = 都是 \p{S}，
    //    而題庫裡有公式題：
    //      A. 排放量 = 活動數據 × 排放係數 × GWP
    //      B. 排放量 = 活動數據 + 排放係數 + GWP
    //      C. 排放量 = 活動數據 ÷ 排放係數 × GWP
    //    四個選項的差別**只在運算子**。剝掉 \p{S} 之後它們會塌成同一個字串 ——
    //    於是「公式題的答案差在運算子」這種錯誤，就會被判成「同一個答案」而放行。
    //    我第一版就是這樣寫的：親手做了一個會漏掉公式題錯誤的把關。
    const norm = (t: string) =>
      (t ?? '').normalize('NFKC').replace(/[\p{P}\p{Z}\s_]+/gu, '').toLowerCase();
    const sig = (it: Item) =>
      norm(it.stem) + '||' + it.options.map((o) => norm(o.text)).sort().join('|');
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

// ─────────────────────────────────────────────────────────────────────────────
// 同一道題，不能有兩個不同的正解
//
// 這一類錯誤**先前完全沒有任何 gate 在看**。去重只管「內容完全相同」，
// 而真正危險的是「題幹幾乎相同、選項集合相同，但答案不同」——
// 那代表其中一題正在教錯的東西，而且兩題都會被抽進同一份考卷。
//
// 實測抓到兩組：
//   gist[183] / gist[358]（第二階段現場查證）—— 一題把「SRRA 缺失改善之覆核」
//     列為**錯誤選項**，另一題說它**就是正解**。直接互相矛盾。
//   gist[140] / gist[296]（何者不是歐盟碳邊境管制項目）—— 同樣四個選項
//     （CBAM / ETS / CCTS / CORSIA），一題答 CCTS、一題答 CORSIA。
//     查證後發現**題目本身是壞的**：CORSIA 是 ICAO 的國際航空機制、
//     CCTS 是印度的碳信用交易制度 —— 兩個都不是歐盟的，這題有兩個正確答案。

// ─────────────────────────────────────────────────────────────────────────────
// 同一道題，不能有兩個不同的正解
//
// 這一類錯誤**先前完全沒有任何 gate 在看**。去重只管「內容完全相同」，
// 而真正危險的是：**同一個題幹出現兩次，卻教了不同的答案** ——
// 兩題都會被抽進同一份考卷，使用者會看到自相矛盾的題庫。
//
// 難點在於：大部分這種組合其實是**同一個答案的不同寫法**
// （「減排行動計畫」vs「減排行動計劃」、「5.20 %」vs「5.2 %」、
//   「工廠使用化石燃料的排放」vs「工廠使用化石燃料排放」）。
//
// 我不用「答案文字相似度門檻」來自動判斷 —— 實測相似度分布是
//   0.000（真衝突）／0.400／0.667／0.743／0.800…（全是同義改寫），
// 0.400 離 0.000 太近，門檻訂在中間就是憑感覺，遲早誤判。
//
// 改用這個 repo 一貫的規矩：**任何「同題幹、不同答案文字」的組合，
// 都必須被明確登記過** —— 沒登記就 fail。想新增一組？先看過它，寫下理由。
const KNOWN_ANSWER_VARIANTS: ReadonlyArray<{ pair: [string, string]; why: string }> = [
  { pair: ['gist[21]', 'gist[552]'], why: '「減排行動計畫」vs「減排行動計劃」—— 畫/劃 異體字' },
  { pair: ['gist[28]', 'gist[438]'], why: '差一個「的」' },
  { pair: ['gist[30]', 'gist[331]'], why: '同一句話的長短版（歐盟啟動 CBAM 主要宣稱是為了解決碳洩漏問題 / CBAM 主宣稱為解決碳洩漏）' },
  { pair: ['gist[44]', 'gist[566]'], why: '差一個「的」' },
  { pair: ['gist[134]', 'gist[262]'], why: '「5.20 %」vs「5.2 %」—— 同一個數字' },
  { pair: ['gist[215]', 'gist[423]'], why: '差一個「的」' },
  { pair: ['S_CHU_06-q014', 'S_CHU_06-q077'], why: '碳中和＝排放量等於「碳抵換量」/「碳移除量」—— 同義' },
  { pair: ['S_CHU_06-q030', 'S_CHU_06-q079'], why: '「適應氣候變遷的行動」vs「適應氣候變遷影響的行動」—— 同義' },
  {
    pair: ['gist[183]', 'gist[358]'],
    why:
      '兩題**都對，不是矛盾**。依 iPAS 公版教材的階段工作分類，第二階段現場查證的明列項目' +
      '同時包含「第二階段活動數據實際抽樣」與「數據品質管理」；而「SRRA 缺失改善之覆核」' +
      '屬**第一階段**。兩題的選項組不同，各自只含一個第二階段項目 —— gist[183] 是抽樣、' +
      'gist[358] 是數據品質管理。（gist[358] 原本答 SRRA 覆核，那才是錯的，已更正。）',
  },
  { pair: ['S_CHU_06-q060', 'S_CHU_06-q078'], why: '來源 PDF 同一題問了兩次、選項組不同；兩個答案都在描述「減緩」—— 同義。（q060 的選項本身是同義反覆，那是來源的問題）' },
];

describe('同一道題不得有兩個不同的正解', () => {
  // 不能用 \W —— JS 的 \W 是 [^A-Za-z0-9_]，**中文字全部符合 \W**，會把題幹刪光。
  // （Python 的 \W 是 Unicode-aware，行為完全不同 —— 我就是這樣被騙出 52 組假重複的。）
  const norm = (t: string) =>
    (t ?? '').normalize('NFKC').replace(/[\p{P}\p{Z}\s_]+/gu, '').toLowerCase();
  const answerText = (it: Item) =>
    norm(it.options.find((o) => o.key === it.answer)?.text ?? '');

  const allowed = new Set(
    KNOWN_ANSWER_VARIANTS.map((v) => [...v.pair].sort().join('||'))
  );

  // 只看「有答案」的題目：刻意排除計分的（answer=null + ambiguous）不列入
  const answered = ALL.filter((it) => it.answer != null);
  const byStem = new Map<string, Item[]>();
  for (const it of answered) {
    const k = `${it.exam_subject}||${norm(it.stem)}`;
    byStem.set(k, [...(byStem.get(k) ?? []), it]);
  }

  const unreviewed: string[] = [];
  for (const g of byStem.values()) {
    if (g.length < 2) continue;
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        if (answerText(g[i]) === answerText(g[j])) continue; // 答案文字完全相同 -> 沒問題
        const key = [who(g[i]), who(g[j])].sort().join('||');
        if (!allowed.has(key)) {
          unreviewed.push(
            `${who(g[i])}(${g[i].answer}) vs ${who(g[j])}(${g[j].answer}) :: ${g[i].stem.slice(0, 34)}`
          );
        }
      }
    }
  }

  it('同題幹但答案不同的組合，必須全部被登記過（沒登記＝沒人看過）', () => {
    expect(
      unreviewed,
      '這些題目的題幹相同、答案卻不同 —— 要嘛其中一題是錯的，要嘛只是措辭不同。' +
        '兩種都必須有人親自看過並記錄：同義的登記進 KNOWN_ANSWER_VARIANTS，' +
        '真衝突的就修掉或標 ambiguous 排除計分。**不允許沒人看過就放行。**'
    ).toEqual([]);
  });

  it('登記清單不得有殘留（列了卻已不存在的組合 = 記錄與事實不符）', () => {
    const ids = new Set(ALL.map(who));
    const stale = KNOWN_ANSWER_VARIANTS.filter(
      (v) => !ids.has(v.pair[0]) || !ids.has(v.pair[1])
    ).map((v) => v.pair.join(' / '));
    expect(stale, '登記清單裡有已經不存在的題目').toEqual([]);
  });

  it('每一筆登記都必須寫理由', () => {
    expect(KNOWN_ANSWER_VARIANTS.length).toBeGreaterThan(0);
    for (const v of KNOWN_ANSWER_VARIANTS) {
      expect(v.why, `${v.pair.join('/')} 沒寫理由`).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 選項不得有兩個完全相同（那題就不可作答了）
//
// 正規化**不可以剝掉 \p{S}（數學符號）**。題庫裡有公式題：
//     A. 排放量 = 活動數據 × 排放係數 × GWP
//     B. 排放量 = 活動數據 + 排放係數 + GWP
//     C. 排放量 = 活動數據 ÷ 排放係數 × GWP
// 四個選項的差別**只在運算子**。剝掉符號之後它們會塌成同一個字串，
// 於是這條 gate 會誤報「四個選項完全相同」——
// 我第一版掃描就是這樣，被自己的正規化騙了。
describe('同一題內不得有兩個完全相同的選項', () => {
  const norm = (t: string) =>
    (t ?? '').normalize('NFKC').replace(/[\p{P}\p{Z}\s_]+/gu, '').toLowerCase();

  it('選項兩兩不得相同（相同就代表這題不可作答）', () => {
    const bad: string[] = [];
    for (const it of ALL) {
      const seen = new Map<string, string>();
      for (const o of it.options) {
        const n = norm(o.text);
        if (!n) continue;
        const prev = seen.get(n);
        if (prev) bad.push(`${who(it)}: ${prev} == ${o.key} 「${o.text.slice(0, 30)}」`);
        else seen.set(n, o.key);
      }
    }
    expect(bad, '同一題裡有兩個一模一樣的選項 —— 這題根本無法作答').toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 計算題的算術
//
// 這 22 題是可以純機械驗算的，而且**已經逐題手算核對過**。
//
// 為什麼不寫解析器而是把算式寫死：我寫過三版解析器，**三版都出錯**
// （漏掉中間的排放係數、被「AR5」裡的 5 卡住 GWP 的 regex、
//   把「200 噸稻草 × 5 kgCH₄/噸」誤讀成「200 噸 × GWP」）。
// **一個比資料還容易出錯的檢查，只會製造假警報。**
// 所以這裡把每一題的算式與正解寫出來當回歸表：
// 有人改了題目的數字或答案，這條就會紅，逼他重新驗算一次。
const CALC_ANSWERS: ReadonlyArray<{
  id: string;
  expect: string;
  math: string;
  /** 題幹裡必須出現的輸入數字 —— 沒有這個，改了題幹的數字而不動答案就抓不到 */
  inputs: string[];
}> = [
  { id: 'gist[479]', expect: '6,108 tCO2e',   math: '12,000,000 kWh × 0.509 kgCO2e/kWh ÷ 1000', inputs: ['12,000,000', '0.509'] },
  { id: 'gist[480]', expect: '1,175 tCO2e',   math: '50 kg SF₆ × GWP 23,500 ÷ 1000', inputs: ['50', '23,500'] },
  { id: 'gist[481]', expect: '2,650 tCO2e',   math: '50 車 × 80,000 km × 0.25 L/km × 2.65 kgCO2e/L ÷ 1000', inputs: ['50', '80,000', '0.25', '2.65'] },
  { id: 'gist[482]', expect: '70,000 tCO2e',  math: '70,000 噸 CO₂（本身即 tCO2e）', inputs: ['70,000'] },
  { id: 'gist[483]', expect: '520 tCO2e',     math: '100 噸 = 100,000 kg × 5.2 kgCO2e/kg ÷ 1000', inputs: ['100', '5.2'] },
  { id: 'gist[484]', expect: '10 tCO2e',      math: '100,000 kg × 0.1 kgCO2e/kg ÷ 1000', inputs: ['100,000', '0.1'] },
  { id: 'gist[485]', expect: '3,000 tCO2e',   math: '120 噸 CH₄ × GWP 25', inputs: ['120', '25'] },
  { id: 'gist[486]', expect: '140 tCO2e',     math: '40 噸 = 40,000 kg × 3.5 kgCO2e/kg ÷ 1000', inputs: ['40', '3.5'] },
  { id: 'gist[487]', expect: '2,250 tCO2e',   math: '90 噸 CH₄ × GWP 25', inputs: ['90', '25'] },
  { id: 'gist[488]', expect: '60,000 tCO2e',  math: '60,000 噸 CO₂（本身即 tCO2e）', inputs: ['60,000'] },
  { id: 'gist[489]', expect: '25 tCO2e',      math: '200 噸稻草 × 5.0 kgCH₄/噸 = 1,000 kg = 1 t CH₄ × GWP 25', inputs: ['200', '5.0', '25'] },
  { id: 'gist[490]', expect: '1,600 tCO2e',   math: '8,000,000 kWh × 0.2 kgCO2e/kWh ÷ 1000', inputs: ['8,000,000', '0.2'] },
  { id: 'gist[491]', expect: '162 tCO2e',     math: '45 噸 = 45,000 kg × 3.6 kgCO2e/kg ÷ 1000', inputs: ['45', '3.6'] },
  { id: 'gist[492]', expect: '160 tCO2e',     math: '50 噸 = 50,000 kg × 3.2 kgCO2e/kg ÷ 1000', inputs: ['50', '3.2'] },
  { id: 'gist[493]', expect: '687.5 tCO2e',   math: '250,000 L × 2.75 kgCO2e/L ÷ 1000', inputs: ['250,000', '2.75'] },
  // 蒐證代理誠實回報 gist[10] / gist[493]「找不到一手來源」—— **那是完全正確的行為**：
  // 純算術題的答案是「算出來的」，**沒有任何網頁可以當它的來源**。
  //
  // 但「找不到來源」不等於「無法查證」。它們**完全可以驗證**，只是用算術而不是引文。
  // 錯的是把它們歸進「無法查證」那一堆 —— 所以搬到這裡，用手算釘住。
  { id: 'gist[10]',  expect: '195 750 kg CO₂e',
    math: '柴油 25×3150=78,750 + 汽油 15×2360=35,400 + 天然氣 30×2720=81,600 → 195,750 kg',
    inputs: ['25', '3150', '15', '2360', '30', '2720'] },
  { id: 'gist[494]', expect: '1,410 tCO2e',   math: '60 kg SF₆ × GWP 23,500 ÷ 1000', inputs: ['60', '23,500'] },
  { id: 'gist[495]', expect: '318 tCO2e',     math: '120,000 L 柴油 × 2.65 kgCO2e/L ÷ 1000', inputs: ['120,000', '2.65'] },
  { id: 'gist[496]', expect: '554.25 tCO2e',  math: '75 kg PFC-14 × GWP 7,390 ÷ 1000', inputs: ['75', '7,390'] },
  { id: 'gist[497]', expect: '32.4 tCO2e',    math: '180,000 kg × 0.18 kgCO2e/kg ÷ 1000', inputs: ['180,000', '0.18'] },
  { id: 'gist[498]', expect: '30 tCO2e',      math: '200,000 kg × 0.15 kgCO2e/kg ÷ 1000', inputs: ['200,000', '0.15'] },
  {
    id: 'S1-p02-q004',
    expect: '502,100 公斤',
    math:
      '多來源加總：電力 500,000 kWh × 0.527 = 263,500 kg；柴油 20,000 L × 2.68 = 53,600 kg；' +
      '天然氣 100,000 m³ × 1.85 = 185,000 kg。合計 502,100 kg',
    inputs: ['500,000', '0.527', '20,000', '2.68', '100,000', '1.85'],
  },
];

describe('計算題的標準答案必須與算式相符（逐題手算核對過）', () => {
  const byId = new Map(ALL.map((it) => [who(it), it]));

  it.each(CALC_ANSWERS)('$id：$math = $expect', ({ id, expect: want }) => {
    const it = byId.get(id);
    expect(it, `${id} 不存在 —— 題目被刪了或 index 變了，這條回歸表已失效`).toBeDefined();
    const chosen = it!.options.find((o) => o.key === it!.answer)?.text ?? '';
    // 只比數字，避免 tCO2e / tCO₂e 這種寫法差異造成假警報
    const digits = (s: string) => s.replace(/[^\d.]/g, '');
    expect(
      digits(chosen),
      `${id} 的標準答案是「${chosen}」，但算式算出來是「${want}」`
    ).toBe(digits(want));
  });

  // 只釘答案是不夠的：有人把題幹的「120,000 公升」偷改成「150,000 公升」而不動答案，
  // 答案就從對的變成錯的，而回歸表完全看不見（實測：這個變異抓不到）。
  // 所以連**輸入數字**也一起釘住 —— 題幹的數字一改，這條就紅。
  it.each(CALC_ANSWERS)('$id 的題幹必須仍含算式用到的輸入數字', ({ id, inputs, math }) => {
    const it2 = byId.get(id);
    expect(it2, `${id} 不存在`).toBeDefined();
    const stem = it2!.stem.normalize('NFKC');
    for (const n of inputs) {
      expect(
        stem.includes(n),
        `${id} 的題幹已經沒有「${n}」了 —— 題目數字被改過，但答案沒跟著重算。算式：${math}`
      ).toBe(true);
    }
  });

  it('回歸表沒有遺漏題目（新增計算題必須一起手算並登記）', () => {
    const calc = ALL.filter((it) => /請計算|試計算/.test(it.stem));
    const listed = new Set(CALC_ANSWERS.map((c) => c.id));
    const missing = calc.filter((it) => !listed.has(who(it))).map(who);
    expect(
      missing,
      '這些計算題不在回歸表裡 —— 新增計算題時必須手算一次並登記，不能默默放行'
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 解析（explanation）—— 使用者真的會讀的內容，卻**從來沒有任何 gate 看過它**
//
// 實掃結果：341 題有解析，其中 **276 題（81%）的句尾帶著「[1, 2, 3, 4, 5]」**
// 這種引用編號 —— 那是產生解析時的殘留，**使用者在畫面上會直接看到**。
// 而那些編號指向一份從來沒被帶進來的來源清單：239 題根本沒有任何 sources，
// 有 sources 的 37 題裡也有 29 題的編號超出來源數量（引用到 [5] 但只有 1 條來源）。
// 也就是說它們不是引用，是**純雜訊**。已全部清除。
describe('解析（explanation）的品質', () => {
  const withExp = ALL.filter((it) => (it.explanation ?? '').trim());

  it('不得殘留引用編號（[1, 2, 3] 這種）—— 使用者會直接看到', () => {
    expect(withExp.length, '沒有任何解析 —— 這組測試在空轉').toBeGreaterThan(100);
    const bad = withExp
      .filter((it) => /\[\s*\d+(?:\s*,\s*\d+)*\s*\]/.test(it.explanation!))
      .map((it) => `${who(it)}: …${it.explanation!.slice(-40)}`);
    expect(bad).toEqual([]);
  });

  // 解析如果明白寫「答案為 C」，那個 C 就必須真的是答案。
  // 改了答案卻忘了改解析，使用者會讀到自相矛盾的東西 —— 比沒有解析更糟。
  it('解析點名的答案字母，必須與實際答案一致', () => {
    const bad: string[] = [];
    for (const it of withExp) {
      if (!it.answer) continue;
      const named = new Set(
        [...it.explanation!.matchAll(/(?:答案\s*[為是:：]?\s*|正解\s*[為是:：]?\s*|故\s*選\s*|應選\s*)\(?([A-D])\)?(?![\w])/g)].map(
          (m) => m[1]
        )
      );
      if (named.size > 0 && !(named.size === 1 && named.has(it.answer))) {
        bad.push(`${who(it)}: 答案是 ${it.answer}，解析卻說 ${[...named].join('/')}`);
      }
    }
    expect(bad, '解析與答案互相矛盾').toEqual([]);
  });

  // 解析裡引用的 URL，必須也登記在來源欄位裡 ——
  // 否則季排程的連結檢查看不到它，那條網址死掉也沒有人會知道（又一次「安靜地少報」）。
  it('解析裡的 URL 必須也登記在來源欄位（否則季排程看不到它）', () => {
    const bad: string[] = [];
    for (const it of withExp) {
      const inExp = it.explanation!.match(/https?:\/\/[^\s;，,、）)】\]]+/g) ?? [];
      if (inExp.length === 0) continue;
      const md = it.metadata as unknown as { sources?: string[] } | undefined;
      const declared = new Set([
        ...(md?.sources ?? []),
        ...(typeof it.source === 'object' && it.source?.url ? [it.source.url] : []),
      ]);
      for (const u of inExp) {
        if (!declared.has(u)) bad.push(`${who(it)}: 解析引用 ${u.slice(0, 50)} 但沒登記在 sources`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 改過答案，就必須留下理由
//
// 原本的 gate 只有一個方向：「有 _correction_note 就必須真的改過答案」。
// **反過來沒有人管** —— 答案可以被改掉而不留任何理由。
//
// 而且「為什麼改」這件事散在三個不同的欄位名：
//   _correction_note / metadata.verification_source / metadata.answer_correction_reason
// 欄位名不統一，就沒有任何 gate 管得住它 —— 誰都可以改答案，只要不碰那三個欄位。
//
// 這裡不強迫統一欄位（那要動 15 題的既有資料），但**強制至少要有其中一個**。
describe('改過答案就必須留下理由', () => {
  const corrected = ALL.filter(
    (it) => (it.metadata as unknown as { prior_answer?: string })?.prior_answer != null
  );

  it('每一題被更正的答案，都必須有可追溯的理由', () => {
    expect(corrected.length, '沒有任何答案更正 —— 這條測試在空轉').toBeGreaterThan(0);
    const md = (it: Item) =>
      it.metadata as unknown as {
        verification_source?: string;
        answer_correction_reason?: string;
        prior_answer?: string;
      };
    const bad = corrected
      .filter(
        (it) =>
          !(it._correction_note ?? '').trim() &&
          !(md(it)?.verification_source ?? '').trim() &&
          !(md(it)?.answer_correction_reason ?? '').trim()
      )
      .map(
        (it) =>
          `${who(it)}: ${md(it)?.prior_answer} -> ${it.answer}，但沒有 _correction_note / ` +
          `verification_source / answer_correction_reason 任何一個`
      );
    expect(bad, '答案被改掉卻沒有留下理由 —— 這正是「沒被記錄的偏離」').toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// quality_flags 的一致性
//
// 這裡的結構性危險：**季排程只檢查標了 time_sensitive 的題目**。
// 該標而沒標的題目，它的來源就算失效、法規就算修訂，**也不會有任何人知道** ——
// 又一次「安靜地少報」。
describe('quality_flags 的一致性', () => {
  const md = (it: Item) =>
    it.metadata as unknown as {
      prior_answer?: string;
      sources?: string[];
      valid_as_of?: string;
    };
  const flags = (it: Item) => new Set(it.quality_flags ?? []);
  const urls = (it: Item) => {
    const out = [...(md(it)?.sources ?? [])];
    const s = (it as unknown as { source?: unknown }).source;
    if (s && typeof s === 'object' && typeof (s as { url?: unknown }).url === 'string') {
      out.push((s as { url: string }).url);
    }
    return out.filter((u) => /^https?:\/\//.test(u));
  };

  // 答案曾被更正 —— 那通常代表「答案會隨時間變」，就該標 time_sensitive。
  //
  // 但不是每個更正都是「時間」造成的：有些是我們本來就抄錯了
  // （術語定義、歷史條約、鎖定版本的標準條文 —— 那些不會再變）。
  //
  // 我第一版是用一個 regex 把特定題幹寫死當例外 —— 那是**特殊處理，不是準則**，
  // 而且下一個人加題目時完全不知道那個 regex 在保護什麼。
  // 改成明確登記：每一筆例外都要寫下「為什麼這題的答案不會再變」。
  const CORRECTED_BUT_STABLE: ReadonlyArray<{ id: string; why: string }> = [
    {
      id: 'gist[105]',
      why:
        '2026-07-19 改題幹救回為單一正解。原題問「碳中和宣告」如何四捨五入，但該規則不在碳中和' +
        '宣告指引、而住在產品碳足跡制度。改題幹到規則實際所在之制度（自願性產品碳足跡核定標示及' +
        '管理辦法 §4(3)：四捨五入取至整數位），答案＝四捨五入取至整數位。法規條文寫死、不隨時間變',
    },
    {
      id: 'gist[137]',
      why:
        '（已標 time_sensitive，此處不需例外）2026-07-19 改題幹救回為單一正解：原題問「政府指引的' +
        '更新機制」（現行指引無此機制），改測 ISO 14068-1:2023「碳中和管理計畫」之「評估與修訂」' +
        '（Clause 9.3）機制。因 ISO 14068-1:2023 官方已標為待修訂、預計由 ISO/FDIS 14068 取代，故標 time_sensitive',
    },
    {
      id: 'gist[420]',
      why:
        '2026-07-19 改題幹救回為單一正解。原選項 D「公共電力淨零聯盟」＝真實 COP28 聯盟 UNEZA、' +
        '「何者不是」無解，且 C 有「脫碳/脫煤」誤植並與 COP23 之 PPCA 混淆。已把 C 換成非 COP28 的' +
        '「清潔發展機制（CDM，京都議定書第 12 條）」，答案＝CDM。制度歸屬（京都 vs COP28）為事實、不隨時間變',
    },
    {
      id: 'gist[373]',
      why:
        '**答案由 D 更正為 B。** 模擬題答案卡 583537684.pdf Q32 明示答案為 (B)「必要文件為清冊與報告書」' +
        '為錯誤敘述（ISO 14067 之必要輸出為 CFP 研究報告，並未將「清冊+報告書」定為兩份必要文件）。' +
        '原答案 D 為答案卡誤置；並修正誤標之來源 696336508.pdf（實為 ISO 14064-1 盤查教材）。' +
        '這是答案卡逐字＋標準條文，不隨時間變（使用者最終裁定）',
    },
    {
      id: 'gist[341]',
      why:
        '2026-07-19 改題幹救回為單一正解。原題以「以上皆是」作答但含假敘述（自願碳市場明確成熟）→無單解。' +
        '改寫為「下列關於 COP28 何者錯誤？」：三項真實 COP28 成果（全球盤點轉型脫離化石燃料、首日啟動' +
        '損失與損害基金、三倍再生能源承諾）為誘答，唯一錯誤敘述「COP28 通過巴黎協定第 6.4 條方法學/碳移除' +
        '標準」（實際遭否決、延至 COP29 方採納）為答案。COP28 之議定成果為史實、不隨時間變',
    },
    {
      id: 'S_CHU_07-q030',
      why:
        '「直接監測法 vs 質量平衡法的區別」—— 量化方法學的定義，不隨時間變。' +
        '原答案錯，是因為**來源 PDF（214245506.pdf）本身壞掉**：它的選項 (C) 整欄位移一題，' +
        '連答案卡一起錯。已改依同一份模擬卷的乾淨版本（190841777.pdf，答案印在每題右欄）',
    },
    {
      id: 'S_CHU_07-q034',
      why:
        '「組織邊界外取得的數據 = 次級數據」—— LCA 的基本定義，不隨時間變。' +
        '同上，來源 PDF 的 (C) 欄位移導致選項與答案卡一起錯',
    },
    { id: 'gist[1]', why: '題幹鎖定「ISO 14064-1:2018」—— 版本寫死，條文不會再變。原答案是抄錯了' },
    { id: 'gist[46]', why: 'MRV 三個字母的原始定義（UNFCCC 2007 峇里路線圖），是術語詞源，不隨時間變' },
    { id: 'gist[29]', why: '（已標 time_sensitive —— CBAM 規則持續被 Omnibus 修正，此處不需例外）' },
    {
      id: 'gist[304]',
      why:
        '坎昆協議 Decision 1/CP.16（2010）§40(a) 的附件一國家報告義務 —— 歷史條約，不變。' +
        '注意：本題被更正過**兩次**（D → C → A）。第一次只對了一半（正確排除了 ICA，' +
        '卻落在沒有文字依據的 C）；第二次比對決議全文（baseline / base year 各 0 次）才定案為 A',
    },
    { id: 'gist[358]', why: '公版教材的查證階段工作項目分類 —— 原答案選錯了項目，不是教材變了' },
    { id: 'gist[408]', why: '題幹鎖定「ISO 14064-1:2018」§9.3.1 —— 版本寫死，不會再變' },
    {
      id: 'gist[140]',
      why:
        '（已標 time_sensitive，此處不需例外）2026-07-19 改題幹翻正為單一正解 CBAM：原題「何者不是' +
        '歐盟碳邊境」因 CCTS（印度）與 CORSIA（ICAO）皆非歐盟而有兩正解（#93），改問「對進口高碳' +
        '產品課碳成本、防碳洩漏之機制」後唯 CBAM 符合。CBAM 規則仍受 Omnibus 修正，續標 time_sensitive',
    },
    {
      id: 'gist[296]',
      why:
        '（已標 time_sensitive，此處不需例外）與 gist[140] 同題型：2026-07-19 改題幹翻正為單一正解 ' +
        'CBAM（原兩正解 CCTS/CORSIA 皆非歐盟，#93）。CBAM 規則受 Omnibus 修正，續標 time_sensitive',
    },
    { id: 'gist[325]', why: '（已標 time_sensitive，此處不需例外）', },
    { id: 'S_CHU_06-q094', why: 'ISO 14064-1 對 base year 的定義 —— 定義，不隨時間變' },
    {
      id: 'S_VOCUS_03-q004',
      why:
        'ISO 14067:2018 §6.3.5 的數據品質清單（摘自 CNS 14044 §4.2.3.6.2）—— ' +
        '版本寫死的標準條文，不隨時間變。原答案「準確度」不在該清單裡（清單裡的是「精密度」）',
    },
    {
      id: 'gist[529]',
      why:
        '選項整組還原（見 metadata.options_replaced）—— 原選項的 B（捕捉）與 C（封存／利用）' +
        '都是 CCUS 涵蓋的過程，題目有兩個正解。已依公版教材模擬題 C 的 Q24 答案卡還原。' +
        '抄錄錯誤不隨時間變',
    },
    {
      id: 'gist[532]',
      why:
        '選項整組還原（見 metadata.options_replaced）—— 原選項 A 與 D 都是「不正確的敘述」，' +
        '而題目問「何者不正確」，兩個都能選。已依公版教材範例題答案卡還原。抄錄錯誤不隨時間變',
    },
    {
      id: 'gist[345]',
      why:
        'iPAS 公版教材範例題 Q12 與本題選項及順序完全相同，答案卡印 (A) 碳捕捉封存 —— ' +
        '原答案抄錯了。而且題幹問的是降低「大氣中」既有的 CO₂ 濃度，減排只是停止增加、' +
        '移除才能降低 —— 這是概念本身，不隨時間變',
    },
    {
      id: 'gist[395]',
      why:
        '公版教材的質量平衡表把「投入量＝主要原物料投入總量」與' +
        '「產出量＝標的產品產量＋製程廢棄物的產出量」分列 —— 原答案把產出側的廢棄物' +
        '算進了投入側。這是投入／產出的定義區分，不隨時間變',
    },
    {
      id: 'gist[255]',
      why:
        'ISO 14067:2018 §7.2 的「應分別記錄」清單 —— 版本寫死的標準條文，不隨時間變。' +
        '(b) 化石排放與 (e) 航空器運輸排放是兩個獨立項目，原答案把後者併進了前者',
    },
    {
      id: 'gist[258]',
      why:
        '2026-07-19 改題幹救回為單一正解。原題 A（溝通，ISO 14067 明文排除）與 C（標籤設計，未涵蓋）' +
        '皆「不包括」→兩正解。已把 C 換成 ISO 14067 有定義的「功能單位」，答案＝溝通的要求。' +
        'ISO 14067:2018 Scope 明文排除 CFP 溝通 —— 版本寫死的標準條文，不隨時間變',
    },
    {
      id: 'gist[61]',
      why:
        '2026-07-19 改題幹救回為單一正解。原題 B（國家）與 C（個人生活方式）皆非碳中和主體範圍→兩正解。' +
        '已把 C 換成 ISO 14068-1 明文列舉的主體「建築」，答案＝國家。ISO 14068-1:2023 Scope 明示' +
        '主體＝組織＋產品、不適用於領域（含國家）—— 標準定義，不隨時間變',
    },
    {
      id: 'gist[14]',
      why:
        '這題不是「答案過時」，是**選項整組抄錯**（見 metadata.options_replaced）—— ' +
        '原本四個選項全是「十二項關鍵戰略」，沒有一個是治理基礎，導致題目有四個正解。' +
        '已依 iPAS 公版教材範例題 Q47 還原官方選項與答案卡。抄錄錯誤不隨時間變',
    },
  ];

  it('答案曾被更正的題目，要嘛標 time_sensitive，要嘛登記「為什麼不會再變」', () => {
    const stable = new Set(CORRECTED_BUT_STABLE.map((c) => c.id));
    const corrected = ALL.filter((it) => md(it)?.prior_answer != null);
    expect(corrected.length, '沒有任何答案更正 —— 這條測試在空轉').toBeGreaterThan(0);
    const bad = corrected
      .filter((it) => !flags(it).has('time_sensitive'))
      .filter((it) => !stable.has(who(it)))
      .map((it) => `${who(it)}: ${md(it)!.prior_answer} -> ${it.answer}｜${it.stem.slice(0, 30)}`);
    expect(
      bad,
      '答案已經被改過一次了，卻既沒標 time_sensitive、也沒登記「為什麼不會再變」——' +
        '季排程完全看不到這一題，它下次再變也不會有人知道'
    ).toEqual([]);
  });

  // **「我已經把那句錯誤敘述移除了」是一句可以被證偽的宣稱 —— 那就去證偽它。**
  //
  // 第五輪的寫回程式做的是**字串手術**：`ex.replace(claim, '')`。
  // 而它在 `claim` 對不上時**靜靜地什麼都沒做**，然後照樣把更正註腳貼上去 ——
  // 結果是：**錯誤的句子還在，下面卻跟著一段「本題解析已更正：那句話是錯的」。**
  // 同一則解析自己跟自己打架。
  //
  // 第六輪的**對抗式覆核**（契約寫死「你的工作是證明我改錯了」）抓到 6 題，
  // 其中 4 題正是這一種：mock-014、mock-046、ifrs2026-005、ifrs2026-006。
  //
  // **一個會靜靜 no-op 的寫回程式，就是這個錯的來源。**
  // 這道 gate 把那個 no-op 變成紅燈：說了移除，就必須真的移除。
  it('explanation_audit 宣稱移除的錯誤敘述，必須真的已經不在解析裡', () => {
    const bad: string[] = [];
    for (const it of ALL) {
      const md = it.metadata as unknown as {
        explanation_audit?: { verdict?: string; removed_claims?: string[] };
      };
      const a = md?.explanation_audit;
      if (!a?.removed_claims?.length) continue;
      for (const c of a.removed_claims) {
        if (c && (it.explanation ?? '').includes(c)) {
          bad.push(
            `${who(it)}：explanation_audit 說移除了「${c.slice(0, 28)}…」，` +
              `但那句話**還在解析裡** —— 於是解析會跟自己的更正註腳互相矛盾`
          );
        }
      }
    }
    expect(bad, '宣稱移除了錯誤敘述，實際上沒有移除').toEqual([]);
  });

  // **一筆沒有記錄 URL 的「驗證紀錄」，不是驗證紀錄。**
  //
  // 這是這個 pilot 最隱蔽的一次自我欺騙：
  // 第一、二輪的寫回程式只存了 `quote`，**沒存 `url`**。於是 137 筆 evidence 變成
  //   「這句話已經機械驗證逐字存在於某一頁上」—— **但沒有人知道是哪一頁。**
  //
  // README 宣稱第 ① 級是「我們把來源網頁抓回來，**逐字確認那句話真的在上面**」。
  // 對那 137 題，**那句話無法從資料裡被重驗** —— 一句**無法被推翻的保證，就是一句沒有價值的保證**。
  //
  // 而且它造成了實害：後來我建解析稽核的批次時寫了 `evidence.url or sources[0]`，
  // 於是把「對著 ipcc.ch 驗過的引文」配上「vocus 的網址」餵給 71 個代理，
  // 並在契約裡對它們說「這段引文已機械驗證存在於該頁」—— **那是一句假話**，
  // 而且是**一個代理發現並回報給我的**。
  //
  // 137 筆已全部逐題回頭比對來源、補回 url（每一段引文都確實在該題某個來源上找到了）。
  // 這道 gate 確保它不會再發生。
  it('每一筆 evidence 都必須記錄它是在哪一個 URL 上驗證的', () => {
    const bad: string[] = [];
    for (const it of ALL) {
      const md = it.metadata as unknown as {
        evidence?: { url?: string | null; quote?: string }[] | { url?: string | null };
      };
      const ev = md?.evidence;
      if (!ev) continue;
      const list = Array.isArray(ev) ? ev : [ev];
      for (const e of list) {
        if (!e.url) {
          bad.push(
            `${who(it)}：evidence 沒有 url —— 「已機械驗證」這句話無法被重驗，也就無法被推翻`
          );
        }
      }
    }
    expect(bad, 'evidence 缺少 url').toEqual([]);
  });

  // 改答案是「偏離」，**把整組選項換掉是更大的偏離** —— 那等於換了一題。
  //
  // gist[14] 是第一個：社群共筆保留了 iPAS 官方題幹（「何者非屬治理基礎？」），
  // 卻把四個選項換成了自然碳匯／綠色金融／碳捕捉封存／淨零綠生活 ——
  // 這四項**全部都是「十二項關鍵戰略」**，沒有一項是治理基礎，
  // 於是「何者非屬治理基礎」這個問句有**四個正確答案**，題目實質無解。
  //
  // 這種題不能靠改答案救（改成哪一個都對），只能還原官方選項。
  // 但「還原」和「竄改」在資料上長得一模一樣 —— 差別只在**有沒有留下可查證的登記**。
  // 所以：換過選項就必須有 options_replaced，而且裡面每一格都要填。
  it('選項被整組換掉的題目，必須留下 options_replaced（原選項、原答案、依據、理由）', () => {
    const replaced = ALL.filter(
      (it) => (it.metadata as unknown as { options_replaced?: unknown })?.options_replaced
    );
    expect(replaced.length, '沒有任何 options_replaced —— 這條測試在空轉').toBeGreaterThan(0);

    for (const it of replaced) {
      const r = (it.metadata as unknown as {
        options_replaced: {
          on?: string;
          prior_options?: { key: string; text: string }[];
          prior_answer?: string;
          source_url?: string;
          why?: string;
        };
      }).options_replaced;
      const id = who(it);

      expect(r.on, `${id}: options_replaced 沒寫日期`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.why, `${id}: options_replaced 沒寫理由 —— 沒有理由的換選項就是竄改`).toBeTruthy();
      expect(r.why!.length, `${id}: 理由太短，說不清楚為什麼原選項不能用`).toBeGreaterThan(30);

      // 依據必須是**一手來源**。拿社群共筆去「還原」另一份社群共筆，等於沒有還原。
      expect(r.source_url, `${id}: options_replaced 沒寫依據 URL`).toBeTruthy();
      expect(
        hasPrimarySource([r.source_url!]),
        `${id}: 還原選項的依據 ${r.source_url} 不是一手來源`
      ).toBe(true);

      // 原選項要留著，而且必須真的不一樣 —— 否則這個登記是假的
      expect(r.prior_options?.length, `${id}: 沒留下原本的選項`).toBeGreaterThan(0);
      expect(r.prior_answer, `${id}: 沒留下原本的答案`).toBeTruthy();
      const before = JSON.stringify(r.prior_options);
      const after = JSON.stringify(it.options);
      expect(before, `${id}: prior_options 與現在的選項一模一樣 —— 這個登記沒有意義`).not.toBe(
        after
      );
    }
  });

  it('CORRECTED_BUT_STABLE 的每一筆都要寫理由，且題目必須真的存在', () => {
    const ids = new Set(ALL.map(who));
    for (const c of CORRECTED_BUT_STABLE) {
      expect(c.why, `${c.id} 沒寫理由`).toBeTruthy();
      expect(ids.has(c.id), `${c.id} 不存在 —— 登記清單有殘留`).toBe(true);
    }
  });

  // 剩下四條規則（未知 flag／time_sensitive 缺一手來源／valid_as_of 前後一致）
  // 已經抽到 utils/quality-flags.ts，與練習池共用。
  //
  // 為什麼要抽：這個檔案**只 import integrated_dataset.json**，
  // 所以規則寫在這裡，就一題練習池都守不到 —— 「守了一半」。
  // question-integrity.ts 開頭那段註解早就警告過同一件事，我讀過它，然後又犯了一次。
  //
  // PRIMARY 也一起搬走了。它原本是一條 regex，失敗模式是「認不得就默默當成不權威」，
  // 因此把 taxation-customs.ec.europa.eu（CBAM 的主管機關）、sec.gov、ghgprotocol.org
  // 全判成非權威。現在改成必須逐一分類，認不得就讓 CI 紅。
  it('quality_flags 規則全數通過（與練習池共用同一套規則）', () => {
    const stable = new Set(CORRECTED_BUT_STABLE.map((c) => c.id));
    const items: FlaggedItem[] = ALL.map((it) => ({
      id: who(it),
      flags: it.quality_flags ?? [],
      sourceUrls: urls(it),
      validAsOf: md(it)?.valid_as_of ?? null,
      priorAnswer: md(it)?.prior_answer ?? null,
    }));
    const ts = items.filter((i) => i.flags.includes('time_sensitive'));
    expect(ts.length, '沒有任何 time_sensitive 題 —— 這條測試在空轉').toBeGreaterThan(50);

    const vs = checkFlags(items, stable);
    expect(
      vs.length === 0 ? '' : `\n${formatFlagViolations(vs)}\n`,
      '主題庫違反了 quality_flags 規則'
    ).toBe('');
  });
});
