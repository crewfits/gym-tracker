import { describe, expect, it } from "vitest";
import { duplicatePhoneOutcome, type PhoneDuplicate } from "./member-rules";

const duplicate: PhoneDuplicate = { id: "member", member_code: "MEM-00001", name: "Member", is_archived: false };

describe("duplicate phone recovery", () => {
  it("routes an archived duplicate to reactivation", () => expect(duplicatePhoneOutcome({ ...duplicate, is_archived: true }, false)).toBe("reactivate"));
  it("rejects a current duplicate without shared-phone confirmation", () => expect(duplicatePhoneOutcome(duplicate, false)).toBe("reject"));
  it("allows an explicitly shared phone", () => expect(duplicatePhoneOutcome(duplicate, true)).toBe("allow"));
});
