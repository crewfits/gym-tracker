export type PhoneDuplicate = { id: string; member_code: string; name: string; is_archived: boolean };
export type DuplicatePhoneOutcome = "allow" | "reactivate" | "reject";

export function duplicatePhoneOutcome(duplicate: PhoneDuplicate | null): DuplicatePhoneOutcome {
  if (!duplicate) return "allow";
  return duplicate.is_archived ? "reactivate" : "reject";
}
