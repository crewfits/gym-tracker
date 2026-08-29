import { describe, expect, it } from "vitest";
import { duplicatePhoneOutcome, type PhoneDuplicate } from "./member-rules";

const duplicate: PhoneDuplicate = { id: "member", member_code: "MEM-00001", name: "Member", is_archived: false };

describe("duplicate phone recovery", () => {
  it("routes an archived duplicate to reactivation", () => expect(duplicatePhoneOutcome({ ...duplicate, is_archived: true })).toBe("reactivate"));
  it("rejects a current duplicate", () => expect(duplicatePhoneOutcome(duplicate)).toBe("reject"));
  it("allows a phone that is not already assigned", () => expect(duplicatePhoneOutcome(null)).toBe("allow"));
});
