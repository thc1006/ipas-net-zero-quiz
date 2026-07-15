// 來源的權威性分級 —— 主題庫與練習池「共用」。
//
// 為什麼需要這個：
//
// 標了 time_sensitive 的題目必須至少有一條「一手權威來源」，否則季排程去檢查一個
// 部落格還活著，**根本無法告訴你法規有沒有改**。這條規則本身沒問題，問題出在實作：
//
// 原本它是 dataset-integrity.test.ts 裡的一條 regex，長這樣：
//     /law\.moj\.gov\.tw|moenv\.gov\.tw|…|usr\.chu\.edu\.tw/
//
// 那不是「權威來源」的定義，只是一張**剛好蓋住主題庫**的名單。把它套到練習池上，
// 它認不得 taxation-customs.ec.europa.eu（歐盟執委會關稅總署，CBAM 的主管機關）、
// www.sec.gov、ghgprotocol.org、www.efrag.org、www.ndc.gov.tw ——
// 全都是不折不扣的一手來源，卻被當成「不權威」，會誤殺 59 題。
//
// **真正的問題是它的失敗模式：認不得的東西一律「默默當成不權威」。**
// 一個會安靜給出錯誤答案的分類器，比一個會大聲失敗的分類器危險得多。
//
// 所以這裡改成：每一個網域都必須被**明確分類**。
// 沒被分類的網域會讓 CI 變紅（見 source-authority.test.ts），
// 逼下一個加題目的人回來寫一行「這是誰、為什麼算／不算一手來源」。

export type Authority = 'primary' | 'secondary';

export interface HostRule {
  /** 比對 URL 的 host（尾綴比對：'iso.org' 也會命中 'www.iso.org'） */
  readonly host: string;
  /** 這是誰 —— 給下一個讀的人看的，不是註解 */
  readonly who: string;
}

/**
 * 一手來源 ＝ **事實的「出處」（source of record）**，不是轉述。
 *
 * 判準只有一個，而且是可操作的：
 *     **這題問的事實如果變了，這一頁的內容會不會跟著變？**
 *   會 → PRIMARY（它就是那個事實的發布者）
 *   不會 → SECONDARY（它只是在轉述；它掛掉，事實不會變）
 *
 * 這個判準必須**照著套**，不能憑「感覺哪個網站比較官方」。我第一版就是憑感覺，錯了三個：
 *
 *   - `trec.org.tw` 被我寫成「台灣再生能源推動聯盟 —— 民間團體」。
 *     它其實是**經濟部標準檢驗局「國家再生能源憑證中心」官網 —— T-REC 的發證機關本身**。
 *   - `support.ecovadis.com` 被我寫成「廠商文件」。
 *     但問的是「EcoVadis 的獎牌規則」—— EcoVadis 改規則，這一頁就會變。它就是出處。
 *   - `pr.tsmc.com` 被我寫成「單一企業的自我揭露」。
 *     但問的是「台積電宣布了什麼」—— 台積電改承諾，這一頁就會變。它就是出處。
 *
 * 反過來，`csr.cw.com.tw`（天下 CSR 報導台積電）就**不是**出處：
 * 台積電改承諾，天下不一定跟著改；天下關站，台積電的承諾也不會變。
 */
export const PRIMARY: readonly HostRule[] = [
  // ── 我國主管機關與法規 ──────────────────────────────────────────
  { host: 'law.moj.gov.tw', who: '全國法規資料庫（法務部）—— 法條原文' },
  { host: 'moenv.gov.tw', who: '環境部（含 cfp/oaout/ghgregistry/data 子網域）' },
  { host: 'cca.gov.tw', who: '環境部氣候變遷署 —— 碳費、盤查、階段管制目標' },
  { host: 'fsc.gov.tw', who: '金融監督管理委員會 —— 上市櫃永續揭露' },
  { host: 'ndc.gov.tw', who: '國家發展委員會 —— 2050 淨零路徑、12 項關鍵戰略' },
  { host: 'moeaea.gov.tw', who: '經濟部能源署 —— 電力排放係數、再生能源' },
  { host: 'ey.gov.tw', who: '行政院 —— 政策核定與公報' },
  // 主管機關**自己的**法規查詢系統，與 law.moj.gov.tw 同一類。
  // 「資料中心設置作業要點」的 PUE 條文就住在這裡 —— 而題庫原本只掛了 ey.gov.tw 的**首頁**。
  // 一個首頁不是證據。
  { host: 'law.moda.gov.tw', who: '數位發展部法規查詢系統 —— 資料中心設置作業要點等' },
  // ⚠️ 網域是 .org.tw，但頁尾寫著「Copyright ©2011-2026 **經濟部國際貿易署**版權所有」
  // —— 著作權人是機關本身，這就是官網。**不要用網域字尾判斷權威性。**
  // 這兩題（CBAM 納管產品查詢）原本掛的是 **EUR-Lex 的歐盟法規**：
  // 我抓回全文 273,630 字，「Taiwan」0 次 —— 引錯了國家。真正的依據一直在這裡。
  { host: 'greentrade.org.tw', who: '綠色貿易資訊網（經濟部國際貿易署）—— CBAM 納管產品查詢' },
  { host: 'moi.gov.tw', who: '內政部 —— 建築物太陽光電設置標準（會銜機關）' },
  { host: 'abri.gov.tw', who: '內政部建築研究所 —— 綠建築與建築碳足跡' },
  { host: 'twse.com.tw', who: '臺灣證券交易所（含 cgc 公司治理中心）' },
  { host: 'tpex.org.tw', who: '證券櫃檯買賣中心' },
  { host: 'tcx.com.tw', who: '臺灣碳權交易所 —— 減量額度交易' },
  { host: 'trec.org.tw', who: '經濟部標準檢驗局 國家再生能源憑證中心 —— T-REC 的發證機關' },
  { host: 'ipas.org.tw', who: 'iPAS 經濟部產業人才能力鑑定 —— 考科範圍的唯一權威' },

  // ── 國際標準與規範的制定者 ──────────────────────────────────────
  { host: 'iso.org', who: 'ISO（含 committee.iso.org）—— ISO 14064／14067／14068' },
  { host: 'bsigroup.com', who: 'BSI —— PAS 2060 的發布與撤回' },
  { host: 'ifrs.org', who: 'IFRS 基金會／ISSB —— IFRS S1・S2' },
  { host: 'ghgprotocol.org', who: 'GHG Protocol —— Scope 1/2/3 的定義來源' },
  { host: 'iaasb.org', who: 'IAASB —— ISAE 3410／ISSA 5000 確信準則' },
  { host: 'efrag.org', who: 'EFRAG —— ESRS 的技術建議機構' },
  { host: 'fsb-tcfd.org', who: 'TCFD —— 氣候相關財務揭露架構' },
  { host: 'sciencebasedtargets.org', who: 'SBTi（含 files. 子網域）—— 科學基礎減量目標' },
  { host: 'globalreporting.org', who: 'GRI 全球永續性報告協會 —— GRI 準則之制定機構' },
  { host: 'cdp.net', who: 'CDP —— 揭露問卷與評分方法' },
  { host: 'environdec.com', who: 'EPD International —— EPD 制度的營運者' },
  { host: 'there100.org', who: 'RE100 國際倡議 —— RE100 規則與會員名單' },
  { host: 're100.org.tw', who: 'RE100 臺灣（綠色和平協力）—— RE100 在台推動' },
  { host: 'globalmethanepledge.org', who: '全球甲烷承諾 —— 承諾文本本身' },
  { host: 'ecovadis.com', who: 'EcoVadis —— 其評級與獎牌規則的發布者（規則改了這裡就會變）' },

  // ── 企業自我揭露 ────────────────────────────────────────────────
  // 對「這家企業承諾了什麼」而言，企業自己的公告**就是**出處 ——
  // 它改承諾，這一頁就會變。媒體報導同一件事則是轉述（見 SECONDARY 的 csr.cw.com.tw）。
  { host: 'pr.tsmc.com', who: '台積電新聞稿 —— 對「台積電宣布了什麼」而言即為出處' },

  // ── 國際組織與條約機構 ──────────────────────────────────────────
  { host: 'unfccc.int', who: 'UNFCCC —— 巴黎協定、NDC、COP 決議' },
  { host: 'treaties.un.org', who: '聯合國條約集 —— 條約原文與批准狀態' },
  { host: 'ipcc.ch', who: 'IPCC —— AR5／AR6 的 GWP 值' },
  { host: 'iea.org', who: '國際能源總署 —— 能源與排放統計' },
  { host: 'icao.int', who: 'ICAO —— CORSIA' },
  { host: 'cop28.com', who: 'COP28 主辦國官網 —— UAE Consensus 文本' },
  { host: 'cop30.br', who: 'COP30 主辦國官網' },

  // ── 歐盟 ────────────────────────────────────────────────────────
  // 註：eur-lex 是法律原文，ec.europa.eu 各總署是**主管機關**（CBAM 的實施細則、
  // 過渡期指引都發布在 taxation-customs 上）。原本的 regex 只認 eur-lex，
  // 把執委會本身當成「不權威」—— 那是說不通的。
  { host: 'eur-lex.europa.eu', who: '歐盟法律公報 —— Regulation 原文' },
  { host: 'ec.europa.eu', who: '歐盟執委會（含 taxation-customs／climate／finance 各總署）' },
  { host: 'europarl.europa.eu', who: '歐洲議會 —— 立法進度（Omnibus 改了這一頁就會變）' },

  // ── 其他國家主管機關 ────────────────────────────────────────────
  { host: 'sec.gov', who: '美國證券交易委員會 —— 氣候揭露規則' },

  // ── 公版教材 ────────────────────────────────────────────────────
  // 中華大學版是 iPAS 淨零碳規劃管理師的公版教材，159 題的重建來源即為其 PDF。
  // 它不是「規範制定者」，但它是**這場考試的命題依據**，對考科內容而言是一手的。
  { host: 'usr.chu.edu.tw', who: '中華大學 —— iPAS 淨零碳規劃管理師公版教材（重建來源 PDF）' },
];

/**
 * 明確判定為「非一手」的來源。
 *
 * 這些**不是壞來源**（很多內容是對的），只是**它們變不變，跟規定變不變無關**。
 * 季排程去檢查它們還活著，得不到任何關於法規的資訊。
 */
export const SECONDARY: readonly HostRule[] = [
  { host: 'vocus.cc', who: '方格子 —— 個人部落格平台' },
  { host: 'yamol.tw', who: '阿摩線上測驗 —— 社群共筆題庫' },
  { host: 'csr.cw.com.tw', who: '天下 CSR —— 媒體' },
  { host: 'netzero.cna.com.tw', who: '中央社淨零 —— 媒體' },
  { host: 'smartmachinery.tw', who: '智慧機械推動辦公室 —— 產業推廣網站' },
  { host: 'km.twenergy.org.tw', who: '能源知識庫 —— 轉載彙整' },
  { host: 'nzb.bers.tw', who: '低碳建築聯盟 —— 民間協會' },
  // 能源署委外的入口網。它**轉載**統計，不是統計的發布者 ——
  // 它掛掉，能源署的數字不會變；它還活著，也不代表數字沒更新。
  { host: 're.org.tw', who: '再生能源資訊網 —— 能源署委外之入口網，轉載而非發布' },
  { host: 'assets.bbhub.io', who: 'Bloomberg CDN —— TCFD 報告的寄存處，非發布機構' },
  { host: 'github.com', who: 'GitHub discussion —— 討論串' },
  { host: 'cna.com.tw', who: '中央社 —— 媒體（用於查證碳交所平台啟用日等有明確日期的事件報導）' },
  // 百科全書：轉述既有事實、非發布者。用於 COP30 地點等無爭議事實，且官方頁（unfccc.int）
  // 本輪被限流抓不到時的可即時重驗替代來源。
  { host: 'wikipedia.org', who: '維基百科（含各語系子網域）—— 二手彙整，非事實發布者' },
];

const matches = (host: string, rule: string) => host === rule || host.endsWith(`.${rule}`);

/** 回傳這個 host 的權威分級；**認不得就回 null** —— 絕不默默當成 secondary。 */
export function classifyHost(host: string): Authority | null {
  const h = host.toLowerCase();
  if (PRIMARY.some((r) => matches(h, r.host))) return 'primary';
  if (SECONDARY.some((r) => matches(h, r.host))) return 'secondary';
  return null;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** 這條 URL 是不是一手權威來源。 */
export function isPrimarySource(url: string): boolean {
  const h = hostOf(url);
  return h != null && classifyHost(h) === 'primary';
}

/** 這批 URL 裡有沒有任何一條一手來源。 */
export function hasPrimarySource(urls: readonly string[]): boolean {
  return urls.some(isPrimarySource);
}
