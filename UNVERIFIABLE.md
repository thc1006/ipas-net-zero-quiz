# 無法取得一手證據的題目（UNVERIFIABLE）

> 產生於 **2026-07-13**。
>
> 兩輪共派 **19 個 AI 代理**、蒐證 **173 題**，契約寫死：
> **只准交「一手來源 URL + 該頁面上的逐字引文」，找不到就回報找不到，禁止用「我知道」填空。**
> 每一筆引文都由 `tools/verify_agent_quotes.py` 抓回原網頁逐字比對。
>
> **34 題拿不到可驗證的一手證據。** 這份檔案逐題列出它們，以及**為什麼**。

## ⚠️ 「無法查證」不是一件事，是六件

混在一起講就沒有行動價值 —— 有些是能力邊界，有些**現在就能解決**，
還有一些代表**題目本身有問題**。

| | 類別 | 題數 | 這代表什麼 | 該怎麼辦 |
| :---: | --- | ---: | --- | --- |
| **A** | **標準本文付費** | 8 | ISO / PAS 的正文在付費牆後。iso.org 只給摘要 | **買標準才驗得了。** 這是真正的能力邊界 |
| **B** | **純算術題** | 2 | 沒有任何網頁可以當「來源」—— 答案是算出來的 | **✅ 現在就能解決**：進計算題手算回歸表 |
| **C** | **一手來源不會這樣寫** | 14 | 概念題／主觀排序。法規與標準不會寫「最常見的挑戰是…」 | ⚠️ **這類題目本身可能就有問題** —— 它在考一個沒有權威依據的斷言 |
| **D** | **來源擋爬蟲** | 8 | 代理讀得到（Incapsula／Cloudflare／JS postback），**我的驗證工具複驗不了** | 需人工開瀏覽器確認。**「我抓不到」≠「它是假的」** |
| **E** | **證據衝突** | 2 | 不同的一手來源給出不同答案 | 記錄爭議，**不動答案** |
| **F** | **選項可能全錯** | 0 | 一手來源顯示四個選項沒有一個對 | 🚨 **最該處理的** —— 這是壞掉的題目 |

## ✅ 這一輪已經解決的（不再列在下面）

| 題 | 原本的問題 | 怎麼解決的 |
| --- | --- | --- |
| `S_VOCUS_02-q010` | 選項寫「CFP 數據收集原則＝透明性、完整性、準確性、**可比性**」—— **ISO 14067 §5 根本沒有「可比性」這一項** | 我自己抓 iPAS 公版教材 PDF 逐條核對：§5 是 5.6 相關性／5.7 完整性／**5.8 一致性**／5.9 連貫性／5.10 準確度／5.11 透明度／5.12 避免重複計算。**整份教材「可比性」出現 0 次、「一致性」出現 16 次。** 選項已改為「一致性」（答案字母不變） |
| `S_VOCUS_03-q012` | 代理說 iPAS 教材對「闡釋階段目的」給出不同答案，找不到依據 | **代理過度保守了。** 教材明文寫「闡釋階段應包括以下步驟：…(b) 進行考量完整性、敏感度分析及**一致性**的評估」—— 答案有據。已補逐字依據 |
| `gist[10]`、`gist[493]` | 純算術題，代理回報「找不到一手來源」 | **那是完全正確的行為** —— 算術題沒有網頁可以當來源。已進 `CALC_ANSWERS` 手算回歸表，由 CI 逐題核對 |

---

## B. 純算術題 —— ✅ **現在就能解決**（2 題）

這些題目的答案是**算出來的**，不是查來的。**沒有任何網頁可以當它的「來源」。**

代理誠實回報「找不到一手來源」是**完全正確**的行為 —— 錯的是把它們歸為「無法查證」。
它們**完全可以驗證**，只是用算術而不是用引文。

**處置：進 `dataset-integrity.test.ts` 的 `CALC_ANSWERS` 手算回歸表。**

### `gist[10]`

> 某公司 2023 年能源使用情況如下：柴油 25 公噸（每公噸產生 3150 kg CO₂e）；汽油 15 公噸（每公噸產生 2360 kg CO₂e）；天然氣 30 公噸（每公噸產生 2720 kg CO₂e）。請問該公司 2023 年使用這三種能源共產生多少二氧化碳排放量？

| | |
| --- | --- |
| **題庫答案** | 195 750 kg CO₂e |
| **為什麼驗不了** | 此題為純算術計算題（非查證外部事實），不存在可查證的一手來源網頁。獨立驗算：25×3150=78750；15×2360=35400；30×2720=81600；加總=195750 kg CO2e，與題庫答案D及其計算式相符，但此為計算驗證而非一手來源引文，故依規則標記為NO_PRIMARY_SOURCE。 |

### `gist[493]`

> 一家航空公司年度航空燃油消耗量為250,000公升，航空燃油排放係數為2.75 kgCO2e/公升。請計算其直接溫室氣體排放量。

| | |
| --- | --- |
| **題庫答案** | 687.5 tCO2e |
| **為什麼驗不了** | 此題為純算術換算題，非需外部一手來源佐證的事實題：250,000公升 × 2.75 kgCO2e/公升 = 687,500 kgCO2e = 687.5 tCO2e，與題庫答案D在數學上一致。但因找不到可逐字引用的網頁作為『來源』，依規則誠實標記為NO_PRIMARY_SOURCE，僅以此計算作為輔助說明，不代表答案有誤。 |

---

## C. 一手來源不會這樣寫 —— ⚠️ **題目本身可能有問題**（14 題）

這一類最值得停下來想。代理查遍法規、標準、公版教材，就是找不到逐字支持答案的原文 ——
**因為法規和標準根本不會寫「最常見的挑戰是…」「最終目的是…」這種話。**

這代表這些題目在考一個**沒有權威依據的斷言**。它們可能：

- 出自某本教科書或講義的整理（而不是規範本身）
- 是命題者自己的歸納
- 有多個「都說得通」的答案

**它們不一定是錯的 —— 但它們的「正確性」沒有可查證的依據。**
如果 iPAS 真的這樣出題，那就照公版教材；如果不是，這些題目該重寫或移除。

<details><summary>逐題列出</summary>

### `S_VOCUS_01-q006`

> 盤查資料收集需包含下列哪一項？

| | |
| --- | --- |
| **題庫答案** | 製程流程圖 |
| **為什麼驗不了** | 查閱iPAS官方考科2教材及環境部相關法規，均未找到將「盤查資料收集需包含下列哪一項」與「製程流程圖」明確逐字對應的一手來源條文，僅有「依據流程圖與單元過程間之流動」等鬆散相關文字，不足以逐字驗證，故誠實回報找不到一手來源。 |

### `S_VOCUS_02-q011`

> 在數據收集時，最常見的挑戰是？

| | |
| --- | --- |
| **題庫答案** | 供應鏈資料缺口 |
| **為什麼驗不了** | GHG Protocol Product Standard 有討論 data gap（資料缺口）與其填補方式，但沒有任何一手來源將『供應鏈資料缺口』評定為『數據收集時最常見的挑戰』；這類主觀排序性陳述在正式標準文件中未見，找不到可逐字引用的一手依據。 |

### `S_VOCUS_02-q019`

> CFP 計算的最終目的為？

| | |
| --- | --- |
| **題庫答案** | 提升企業永續管理與供應鏈透明度 |
| **為什麼驗不了** | 查詢環境部產品碳足跡管理要點（GL007755）、自願性產品碳足跡核定標示及管理辦法（GL007934）及產品碳足跡資訊網介紹頁（moenv.gov.tw/information-service/thematic-website/2943.html）等一手來源，僅找到「供民眾選購參考」「協助業者進行產品碳足跡資訊之資訊透明」等表述，未見任何一手來源明確以「提升企業永續管理與供應鏈透明度」作為CFP計算之最終目的的逐字陳述，證據不足以支持或推翻答案A，誠實回報找不到。 |

### `S_YAMOL_023-q067`

> 透過製程地圖的每個步驟，查看哪些環節的碳排放較高，我們稱此環節為什麼，依據此結果作為未來企業實行減排策略?

| | |
| --- | --- |
| **題庫答案** | 關鍵熱點 |
| **為什麼驗不了** | 查閱iPAS官方考科2教材(ipas.org.tw)及中華大學公版教材(usr.chu.edu.tw)，僅在LCA闡釋階段找到「鑑別重大議題(找出熱點)」一句，未見任何一手來源將「製程地圖中排碳較高的環節」明確定名為「關鍵熱點」，故無法逐字驗證此題答案，誠實回報找不到一手來源。 |

### `gist[235]`

> 組織進行外部查證前，應先完成什麼程序？

| | |
| --- | --- |
| **題庫答案** | 內部查證 |
| **為什麼驗不了** | 已查證「溫室氣體排放量盤查登錄及查驗管理辦法」全文17條，未出現「內部查證」一詞，也未規定外部查驗前應先完成內部查證程序；iPAS教材(usr.chu.edu.tw)雖有描述ISO14064-1:2018下「內部查證」之目的與程序，但未見逐字條文明確規定「外部查證前應先完成內部查證」此一順序要求，故無法確認一手來源逐字支持答案D。 |

### `gist[245]`

> 在活動數據檢核中，關於物料規格或濃度的說明，哪項是正確的？

| | |
| --- | --- |
| **題庫答案** | 各項物料均須清楚說明濃度、成分或化學反應式 |
| **為什麼驗不了** | 查閱環境部113年版《溫室氣體排放量盤查作業指引》(全文)、《溫室氣體查驗指引》、tmts.tw盤查實務教材、usr.chu.edu.tw盤查方法教材，均未見『各項物料均須清楚說明濃度、成分或化學反應式』這句話或對應的活動數據檢核清單條文；查驗指引中『活動數據』查核項目談的是乾濕基狀態、度量衡單位、量測儀器校驗，並非此措辭。找不到可逐字比對的一手來源，誠實回報。 |

### `gist[32]`

> 碳中和聲明的準確性和真實性應該由誰進行驗證？

| | |
| --- | --- |
| **題庫答案** | 獨立第三方 |
| **為什麼驗不了** | 嘗試多個一手來源（BSI PAS 2060 各版頁面、ISO 14068-1 iso.org產品頁）皆未能找到逐字提及『獨立第三方(independent third party)驗證』要求的原文句子；BSI頁面僅提到可驗證性(verifiable)與BSI Kitemark驗證服務，PAS 2060本身已於2025年起被BSI停止提供並由ISO 14068-1取代，找不到可逐字引用的一手來源文字，故誠實回報找不到。 |

### `gist[367]`

> TCFD 建議的氣候風險中，投資人最關注哪一項？

| | |
| --- | --- |
| **題庫答案** | 現金流風險 |
| **為什麼驗不了** | 查閱fsb-tcfd.org/recommendations/整頁內容，以及TCFD 2017正式報告全文（assets.bbhub.io/company/sites/60/2021/10/FINAL-2017-TCFD-Report.pdf，逐頁以PyMuPDF擷取後搜尋investor/cash flow等關鍵字），皆找不到任何逐字陳述「投資人在TCFD建議的氣候風險中最關注現金流風險」。報告中僅泛稱氣候風險可能反映在income statement、cash flow statement、balance sh… |

### `gist[382]`

> 產品碳足跡計算中排放係數相乘的活動數據為？

| | |
| --- | --- |
| **題庫答案** | 生產使用量 |
| **為什麼驗不了** | 查閱了環保署2010年版「產品與服務碳足跡計算指引」（PAS 2050基礎）及iPAS公版教材「產品碳足跡管理與盤查」(usr.chu.edu.tw)，均未找到明確以「領用量／生產使用量／原料採購量／回收量」四個選項逐字對照定義活動數據的條文或段落，故無法確認一手來源逐字支持或推翻答案B。 |

### `gist[420]`

> 下列何者不是 COP28 提出的全球能源轉型策略？

| | |
| --- | --- |
| **題庫答案** | 公共電力淨零聯盟 |
| **為什麼驗不了** | cop28.com confirms 'Global Renewables and Energy Efficiency Pledge' (A) and secondary sources confirm 'Oil and Gas Decarbonization Charter' (B) and 'Coal Transition Accelerator' (C) were real COP28 initiatives, but cop28.com's own pages are largely 404 now and… |

### `pool-em-ipas_vocus_mock-005`

> 企業為了應對國際供應鏈的淨零要求，常使用國際自願碳市場的碳權，此類碳權主要適用於哪兩項應用目的？

| | |
| --- | --- |
| **題庫答案** | 企業ESG自願承諾；供應鏈碳中和要求 |
| **為什麼驗不了** | 查找sciencebasedtargets.org、cdp.net等一手來源後，僅找到SBTi明確表示碳權『不應作為供應鏈減碳之替代』的相關聲明（與題幹『供應鏈碳中和要求』之敘述方向不完全一致），未能在允許清單內任何一手來源上找到逐字支持『國際自願碳市場碳權主要適用於企業ESG自願承諾與供應鏈碳中和要求』此一具體敘述的原文，故誠實回報找不到一手來源，不予判定。 |

### `pool-em-ipas_vocus_mock-011`

> 關於碳費與排放交易制度的比較，下列何者論述正確？

| | |
| --- | --- |
| **題庫答案** | 碳費制度的價格具確定性，但減量效果不確定；排放交易制度的減量效果確定，但價格不確定 |
| **為什麼驗不了** | 查《氣候變遷因應法》第28條（碳費費率審議）、第32/33條（溫室氣體管理基金，確認碳費收入專款專用而非入一般國庫、由中央主管機關即環境部而非財政機關主管）、環境部氣候變遷署碳費專區與常見問答頁，均未見選項A所述「碳費價格確定但減量效果不確定；排放交易減量效果確定但價格不確定」這組價格/數量確定性對比的逐字表述——此為經濟學教科書常見比較（OECD、Congress.gov 等二手/國際機構分析可見），但白名單一手來源中找不到逐字對應段落，故誠實回報找不到，不代'選項A就是錯的'。 |

### `pool-em-ipas_vocus_mock-028`

> 企業希望自動偵測 HVAC 異常並預測能耗，應導入何種系統？

| | |
| --- | --- |
| **題庫答案** | EMIS（能源資訊管理系統） |
| **為什麼驗不了** | 多次檢索一手來源清單內網域（moeaea.gov.tw、iso.org等），均未找到針對『EMIS能源資訊管理系統可自動偵測HVAC異常並預測能耗』此一具體技術情境之逐字說明頁面，僅有選單中出現EMIS系統名稱、無定義性內容可逐字引用，故回報找不到一手來源。 |

### `pool-em-ipas_vocus_mock-029`

> 科技公司欲快速達成 RE100 初期目標，但尚無長期購電準備時，最適合採用何種綠電工具？

| | |
| --- | --- |
| **題庫答案** | T-REC 憑證購買 |
| **為什麼驗不了** | 已查閱國家再生能源憑證中心trec.org.tw之相關頁面，確認T-REC被RE100認可為可填報之EAC，但找不到該網站或there100.org上有逐字比較『T-REC較CPPA更適合快速達成RE100初期目標、無需長期購電準備』此一具體論點的段落；相關比較文字僅見於部落格/顧問公司等非一手來源，依契約規則不採計，故回報找不到一手來源。 |

</details>

---

## A. 標準本文付費 —— 買了才驗得了（8 題）

ISO 14040 / 14044 / 14064-1 / 14067 / 50001、PAS 2060 的**正文**都在付費牆後。
`iso.org` 只公開摘要（Scope 段落），`bsigroup.com` 只有行銷頁。

**這是真正的能力邊界，不是疏漏。** 唯一的解法是買標準 ——
或者接受這些題目的答案只能靠 iPAS 公版教材（它本身就是二手轉述）。

<details><summary>逐題列出</summary>

### `S_VOCUS_01-q015`

> LCA 的衝擊評估階段主要用於？

| | |
| --- | --- |
| **題庫答案** | 評估不同排放對環境影響 |
| **為什麼驗不了** | ISO 14044:2006與ISO 14040:2006官網摘要（iso.org/standard/38498.html、iso.org/standard/37456.html）僅列出「the life cycle impact assessment (LCIA) phase」為LCA階段之一，並未在公開可見的摘要文字中說明該階段之具體用途（即評估不同排放對環境影響）。標準全文為付費內容，無法取得逐字定義，故誠實回報找不到一手來源可逐字佐證其定義。 |

### `S_VOCUS_02-q004`

> 功能單位 (Functional Unit) 的作用是？

| | |
| --- | --- |
| **題庫答案** | 提供比較基準 |
| **為什麼驗不了** | 在允許的一手來源清單中（iso.org 僅提供付費牆前的摘要頁、GHG Protocol Product Standard 全文、cfp.moenv.gov.tw 的多份 PCR 文件）都找不到逐字陳述『功能單位的作用是提供比較基準』的句子；GHG Protocol Product Standard 甚至明說其比較功能需要額外規範（ISO 14044 comparative assertions 不受本標準支持），無法找到可逐字引用的一手依據，誠實回報找不到。 |

### `S_VOCUS_02-q006`

> LCA 清單盤查 (LCI) 的核心內容是？

| | |
| --- | --- |
| **題庫答案** | 收集原料、能源投入與排放數據 |
| **為什麼驗不了** | iso.org 的 ISO 14040/14044 頁面僅提供不含逐條定義的摘要（僅列出 LCI 階段名稱，未描述其核心內容），GHG Protocol Product Standard 與 cfp.moenv.gov.tw 的 PCR 文件也沒有逐字陳述『LCI 核心內容為收集原料、能源投入與排放數據』的句子，找不到可逐字引用的一手依據。 |

### `gist[452]`

> 企業碳中和管理計畫應包含哪些要求？

| | |
| --- | --- |
| **題庫答案** | 完整策略與實施細節 |
| **為什麼驗不了** | PAS 2060 全文與 ISO 14068-1 全文均為付費標準文件；iso.org 網頁對自動化擷取回傳403 Forbidden無法存取，bsigroup.com官方頁面僅有簡短行銷文字未逐字說明碳中和管理計畫應包含的具體要求項目，找不到可逐字引用的一手來源頁面，故誠實回報為NO_PRIMARY_SOURCE。 |

### `pool-em-ipas_vocus_mock-025`

> 某工廠能源盤查結果：空壓系統占 28%、冷凍空調 25%、馬達負載 15%。在資源有限需先提升能源效率的情境下，最合理之優先做法為？

| | |
| --- | --- |
| **題庫答案** | 實施空壓系統洩漏檢測與改善 |
| **為什麼驗不了** | ISO 50001:2018為付費標準，iso.org官方OBP線上預覽僅提供目錄與極少數條文片段，未涵蓋第6.3節「能源查核／重大能源使用(SEU)」之實質條文內容，無法取得一手來源逐字條文以驗證本題（空壓系統洩漏檢測應優先處理之判斷）。 |

### `pool-em-ipas_vocus_mock-026`

> 某企業導入 ISO 50001 後，年度產量下降但能源使用量上升。判斷其能源績效是否真實下降，應先檢查何項？

| | |
| --- | --- |
| **題庫答案** | EnB（能源基準）設定是否合理 |
| **為什麼驗不了** | 同上，ISO 50001:2018第6.5節（能源績效指標EnPI）與第6.6節（能源基準EnB）之實質條文同樣在iso.org付費牆之後，OBP免費預覽未涵蓋，無法取得一手來源逐字條文以驗證本題（產量下降但能源使用量上升時應先檢查EnB是否合理）。 |

### `pool-em-ipas_vocus_mock-054`

> 依 ISO 14064-1:2018 §6.4，組織盤查報告中應將「生物源 CO2 排放與移除（biogenic CO2）」如何處理？

| | |
| --- | --- |
| **題庫答案** | 在報告中分別量化並單獨揭露，不計入總量 |
| **為什麼驗不了** | ISO 14064-1:2018 clause 6.4 (biogenic CO2 reporting) is paywalled. ISO's own product page (iso.org/standard/66453.html) exposes only a generic abstract that never mentions "biogenic" anywhere (confirmed by full-text search of the fetched page), and the OBP pre… |

### `pool-em-ipas_vocus_mock-056`

> 在計算產品碳足跡時，為何不能直接使用組織溫室氣體盤查的電力排碳係數？

| | |
| --- | --- |
| **題庫答案** | 組織盤查的電力排碳係數僅計算發電過程中燃燒的排放，而產品碳足跡需包含從原料開採到電網輸配整個生命週期 |
| **為什麼驗不了** | 題庫答案 C 是一個複合主張（組織盤查電力排碳係數僅算發電燃燒排放 + 產品碳足跡需含原料開採到輸配電的完整生命週期）。我只找到一手來源證實前半段：moenv 電力排碳係数公告 PDF（ghgregistry.moenv.gov.tw/Upload/News3/00001339_001.pdf）載明「適用範圍：因應溫室氣體盤查量化作業，作為計算購買及使用公用售電業電力所需間接承擔燃料燃燒溫室氣體排放量之依據」，且另一份年度電力排放係数公告提及線損（輸配電損失）是被『扣除』而非涵蓋在內，這與題庫『組織盤查係数僅算燃燒… |

</details>

---

## D. 來源擋爬蟲 —— 我的工具複驗不了（8 題）

代理**讀得到**這些頁面（有些甚至重放了 ASP.NET 的 `__doPostBack`），
但我的驗證工具 `tools/verify_agent_quotes.py` 抓不到內容：
unfccc.int 的 Incapsula、sciencebasedtargets.org 的 Cloudflare、JS 動態載入的政府 FAQ。

**「我抓不到」不等於「它是假的」。**
（`gist[322]` 那次不同 —— WebFetch **渲染得出頁面**並確認沒有那句話，捏造成立。）

**處置：這些題目的證據沒有寫進題庫**（寧可留白，不要寫一個沒被驗證的「證據」）。
要確認的話，人工開瀏覽器點進去看。

<details><summary>逐題列出</summary>

### `gist[304]`

> 坎昆協議規定附件一國家 MRV 範圍，下列何者正確？

| | |
| --- | --- |
| **題庫答案** | 與目標相關基線資料計算 |
| 代理找到的來源 | `https://unfccc.int/resource/docs/2010/cop16/eng/07a01.pdf` |
| 代理摘出的引文 | Also decides to establish a process for international assessment of emissions and removals related to quantifi… |
| **為什麼驗不了** | 原引用之 unfccc.int 專題頁遭 Incapsula 阻擋，Wayback Machine 亦無存檔，改直接查坎昆協議正式決議文 Decision 1/CP.16（FCCC/CP/2010/7/Add.1，經 web.archive.org 存檔確認與網址 07a01.pdf 相符）。第44段確立附件一國家之量化全經濟體減量目標須經『international assessment』（IAR）審查；第60、63段明定 ICA（international consultations and analysis）… |

### `gist[322]`

> 京都議定書彈性減量機制不包括以下哪項？

| | |
| --- | --- |
| **題庫答案** | ESI |
| 代理找到的來源 | `https://unfccc.int/process/the-kyoto-protocol/mechanisms` |
| 代理摘出的引文 | The Kyoto Protocol introduced three market-based mechanisms, thereby creating what is now known as the carbon … |
| **為什麼驗不了** | UNFCCC官方頁面明確列出京都議定書僅有三項機制：Clean development mechanism (CDM)、Joint implementation (JI)、Emissions trading (ET)，並無「ESI」，支持選項D為題庫答案。 |

### `gist[46]`

> 在 MRV 機制中，MRV 的各字母代表什麼意思？

| | |
| --- | --- |
| **題庫答案** | 可測量（Measurable）、可報告（Reportable）、可查證（Verifiable） |
| 代理找到的來源 | `https://unfccc.int/resource/docs/2007/cop13/eng/06a01.pdf` |
| 代理摘出的引文 | Nationally appropriate mitigation actions by developing country Parties in the context of sustainable developm… |
| **為什麼驗不了** | unfccc.int 直接連線遭 Incapsula 阻擋（回傳空白挑戰頁），改以 web.archive.org 存檔同一網址確認逐字內容；存檔文件標頭為 FCCC/CP/2007/6/Add.1，與網址檔名 06a01.pdf（文件6之Add.1）相符。峇里行動計畫第1(b)(ii)段原文使用形容詞型『measurable, reportable and verifiable』（可測量、可報告、可查證），對應選項A，而非選項B/D之名詞型 Measurement/Monitoring, Reporting, V… |

### `pool-em-ipas_vocus_mock-010`

> 我國政府在2030年前，將投入約9,000億元以推動淨零轉型，預計此行動可帶動民間多少兆元的投資資金？

| | |
| --- | --- |
| **題庫答案** | 4兆元 |
| 代理找到的來源 | `https://ncsd.ndc.gov.tw/_ofu/FileDatabase/107f672b-759e-4d00-9976-f76a16ae868e/%E8%87%BA%E7%81%A` |
| 代理摘出的引文 | 至2030年帶動民間投資約4兆元以上 |
| **為什麼驗不了** | 國發會《臺灣2050淨零排放路徑及策略總說明》簡報（ncsd.ndc.gov.tw 主辦，PDF 第32頁圖表）明白標示「政府投入帶動民間投資」為「至2030年帶動民間投資約4兆元以上」，確認選項 C（4兆元）。此文字為 PDF 內嵌圖片文字，以 PyMuPDF 轉圖後親眼確認，非 OCR 臆測。 |

### `pool-em-ipas_vocus_mock-018`

> 我國 2025 年版國家溫室氣體清冊報告（NIR），在計算溫室氣體當量換算時，主要採用哪個國際組織的第幾次評估報告之 GWP 值？

| | |
| --- | --- |
| **題庫答案** | IPCC，第五次評估報告 |
| 代理找到的來源 | `https://service.cca.gov.tw/File/Get/cca/zh-tw/WLnRH8D3WOg121m` |
| 代理摘出的引文 | 資料來源：IPCC, Climate Change, the Fifth Assessment Report, 2014. |
| **為什麼驗不了** | 此檔案為2025年中華民國國家溫室氣體排放清冊報告（cca.gov.tw 官網該報告頁面直接連結）之「表3.2.4 各類溫室氣體溫暖化潛勢」，資料來源標明IPCC第五次評估報告（2014），二氧化碳/甲烷/氧化亞氮GWP值分別為1/28/265，確認選項C（IPCC第五次評估報告）。 |

### `pool-em-ipas_vocus_mock-027`

> 企業不願負擔節能設備前期投資但希望降低電費，最合適的合作模式為？

| | |
| --- | --- |
| **題庫答案** | 採用 ESCO 的 EPC 績效保證合約 |
| 代理找到的來源 | `https://ea01.moeaea.gov.tw/e0409/Page/Classroom.aspx` |
| 代理摘出的引文 | 所謂的節能效益分享型，主要是進行節能改善專案時，由ESCO提供專案所需要的資金以及全過程的服務 |
| **為什麼驗不了** | 經濟部能源署「能源技術服務業資訊網」節能績效保證Q&A「新手教室」第5則（該頁面內容以ASP.NET postback動態載入，經模擬postback請求取得），逐字說明節能效益分享型(Share Savings)合約由ESCO出資並提供全過程服務，業主無須負擔前期投資，正對應題目情境（企業不願負擔前期投資但希望降低電費），此為EPC（能源績效保證契約）之一種型態，與題庫答案B（ESCO的EPC績效保證合約）相符。 |

### `pool-em-ipas_vocus_mock-048`

> COP30（2025 年聯合國氣候變化綱要公約締約方大會）之主辦城市與舉辦時間為？

| | |
| --- | --- |
| **題庫答案** | 巴西貝倫（Belém），2025 年 11 月 |
| 代理找到的來源 | `https://unfccc.int/cop30` |
| 代理摘出的引文 | UN Climate Change Conference - Belém, November 2025 UN Climate Change Conference - Belém, November 2025 10 Nov… |
| **為什麼驗不了** | Direct fetch of unfccc.int/cop30 (both WebFetch and curl) was blocked by Incapsula bot protection, so I retrieved the identical page via the Wayback Machine snapshot (web.archive.org/web/20260706140432/`https://unfccc.int/cop30`) and verified the text programm… |

### `pool-em-ipas_vocus_mock-049`

> UNFCCC 框架下「共同但有區別之責任及各自能力（CBDR-RC）」原則之核心精神為？

| | |
| --- | --- |
| **題庫答案** | 已開發國家以技術與資金協助開發中國家，並承擔較大歷史責任 |
| 代理找到的來源 | `https://unfccc.int/resource/docs/convkp/conveng.pdf` |
| 代理摘出的引文 | The Parties should protect the climate system for the benefit of present and future generations of humankind, … |
| **為什麼驗不了** | Direct curl/WebFetch to this PDF was blocked by Incapsula, so I retrieved it via the Wayback Machine (web.archive.org/web/20260709022810/`https://unfccc.int/resource/docs/convkp/conveng.pdf`), which mirrors the official unfccc.int convention PDF; opened and co… |

</details>

---

## E. 證據衝突 —— 記錄爭議，不動答案（2 題）

不同的一手來源給出不同答案。**在拿到決定性依據前，不改答案。**

### `S_VOCUS_03-q004`

> ISO 14067 要求數據品質包含：代表性、完整性與：

| | |
| --- | --- |
| **題庫答案** | 準確性 |
| 代理找到的來源 | `https://environment.ec.europa.eu/system/files/2021-12/Annexes%201%20to%202.pdf` |
| 代理摘出的引文 | Data quality – characteristics of data that relate to their ability to satisfy stated requirements. Data quali… |
| **為什麼驗不了** | ISO 14067官方摘要（iso.org/standard/71206.html）自述其原則「in a manner consistent with International Standards on life cycle assessment (ISO 14040 and ISO 14044)」，即以ISO 14040/14044為基礎。歐盟執委會Commission Recommendation (EU) 2021/2279 附件（Product Environmental Footprint Method… |

### `pool-em-ipas_vocus_mock-007`

> 關於 ISO 14068-1 碳中和標準與 PAS 2060 的差異，下列敘述何者正確？

| | |
| --- | --- |
| **題庫答案** | （無答案） |
| **為什麼驗不了** | bank_answer 已為 null（已排除計分）。查 bsigroup.com/en-US 官方 PAS 2060 頁面，全文無 'withdraw' 字樣，找不到 BSI 對 PAS 2060:2014 官方撤回日期的一手聲明；網路上流傳的 2025-11-30 / 2025-01-01 等日期僅見於 page.bsigroup.com（行銷信）與 tunley-environmental.com 等二手來源，不算數。維持題庫現狀（不計分）是正確處置，找不到一手來源可以推翻或確認。 |

---

## 這份清單「不」包含什麼

**主題庫還有 393 題完全沒有來源** —— 但它們**不在這份清單裡**，因為它們
**還沒有被嘗試查證**（只抽樣了 40 題）。「還沒查」和「查不到」是兩件事。

那 40 題的抽樣結果：**29 題引文驗證通過，錯誤 0 題**，
點估計錯誤率 **0%**、95% 信賴上界約 **10%**（rule of three）。

完整的缺口盤點見 [`VERIFICATION-GAPS.md`](VERIFICATION-GAPS.md)。
