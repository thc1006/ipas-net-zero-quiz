// 官方題目在畫面上的稱呼。official_exam 由 tools/import_official_exam.py 寫入題庫，
// 場次是「民國年-梯次」（115-01；梯次從 01 起算，schema 與 validator 都擋 00）；official_sample 由
// tools/import_official_sample.py 寫入，版次是民國年（114）。科目是 iPAS 的科目代號（L11 第一科、L12 第二科）。
// 兩支匯入工具用同一套詞彙寫出每一題官方引文的 note；同目錄的 official-exam.test.ts 拿題庫逐題對帳兩邊。
import type { OfficialExam, OfficialSample } from '../types/quiz';

const CHINESE_ORDINAL = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const SUBJECT_NAME: Record<string, string> = { L11: '第一科', L12: '第二科' };

/** 場次「115-01」在畫面上的說法：「115 年第一次」 */
export function sessionLabel(session: string): string {
  const [year, round] = session.split('-');
  const n = Number(round);
  const ordinal = CHINESE_ORDINAL[n - 1];
  return ordinal ? `${year} 年第${ordinal}次` : `${year} 年第 ${n} 次`;
}

function session(o: OfficialExam): string {
  return sessionLabel(o.session);
}

/** 題卡上的標籤：「115 年第一次官方公告試題」 */
export function officialExamLabel(o: OfficialExam): string {
  return `${session(o)}官方公告試題`;
}

/** 題目在那一份 PDF 上的位置：「第一科第 5 題」 */
export function officialExamPlace(o: OfficialExam | OfficialSample): string {
  const subject = SUBJECT_NAME[o.subject];
  return subject
    ? `${subject}第 ${o.question_number} 題`
    : `${o.subject} 第 ${o.question_number} 題`;
}

/** 完整出處：「115 年第一次公告試題第一科第 5 題」 */
export function officialExamReference(o: OfficialExam): string {
  return `${session(o)}公告試題${officialExamPlace(o)}`;
}

/** 參考樣題的版次「114」在出處裡的說法：「參考樣題（114 年版）」 */
export function sampleEditionLabel(edition: string): string {
  return `參考樣題（${edition} 年版）`;
}

/** 題卡上的標籤：「官方參考樣題（114 年版）」 */
export function officialSampleLabel(s: OfficialSample): string {
  return `官方${sampleEditionLabel(s.edition)}`;
}

/** 完整出處：「參考樣題（114 年版）第一科第 4 題」 */
export function officialSampleReference(s: OfficialSample): string {
  return `${sampleEditionLabel(s.edition)}${officialExamPlace(s)}`;
}
