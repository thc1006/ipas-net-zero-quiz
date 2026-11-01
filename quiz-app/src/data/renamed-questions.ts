// 題目改過 id 時，舊 id 對到現在的 id。
//
// 使用者的進度與作答統計存在 localStorage，不會跟著題庫改名。對應表從題庫的 metadata.renamed_from 算出來，
// 不另外維護。獨立成一個模組：作答統計讀取失敗會清掉資料，而不少測試 mock 掉 data/questions，
// 放在那裡的話 mock 少一個 export 就會把統計洗掉。
import rawData from './integrated_dataset.json';
import type { MainBankItemMetadata, QuizDataset } from '../types/quiz';

const { gist_items, our_unique_items } = rawData as QuizDataset;

const items: [id: string, metadata: MainBankItemMetadata | undefined][] = [
  ...gist_items.map((q): [string, MainBankItemMetadata | undefined] => [`gist-${q.index}`, q.metadata]),
  ...our_unique_items.map((q): [string, MainBankItemMetadata | undefined] => [q.item_id, q.metadata]),
];

/** 第二次改 id 時，把原本的 renamed_from 放進新紀錄的 previous：每一代舊 id 都還存在使用者的瀏覽器裡 */
interface RenameChain {
  item_id: string;
  previous?: RenameChain;
}

export function currentIdsByOldId(
  renamed: [id: string, renamedFrom: RenameChain | undefined][]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [id, renamedFrom] of renamed) {
    for (let old = renamedFrom; old; old = old.previous) map.set(old.item_id, id);
  }
  return map;
}

const currentIdByOldId = currentIdsByOldId(items.map(([id, metadata]) => [id, metadata?.renamed_from]));

/** 舊 id 轉成現在的 id；其他 id（現行題目、練習池、已經刪掉的題目）原樣返回 */
export function currentQuestionId(id: string): string {
  return currentIdByOldId.get(id) ?? id;
}
