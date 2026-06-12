import type { ConversationRecord } from "./types";

export function replaceRecordInPlace(records: ConversationRecord[], replacement: ConversationRecord): ConversationRecord[] {
  return records.map((record) => record.id === replacement.id ? replacement : record);
}

export function removeRecordById(records: ConversationRecord[], id: string): ConversationRecord[] {
  return records.filter((record) => record.id !== id);
}
