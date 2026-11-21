import { describe, expect, it } from "vitest";
import { MemberFilterError, memberFilterRpcArgs, parseMemberFilters, serializeMemberFilters } from "./member-filters";

describe("member directory filters", () => {
  it("round trips combined criteria and preserves them in the database contract", () => {
    const input = new URLSearchParams("field=name&q=Arun&records=all&membership=active&membership=expiring&payment=due&attendance=no_this_week&qr=shared&plan=Monthly&expiry=custom&from=2026-11-01&to=2026-11-30&sort=name&order=asc&page=3");
    const filters = parseMemberFilters(input);
    expect(parseMemberFilters(serializeMemberFilters(filters))).toEqual(filters);
    expect(memberFilterRpcArgs(filters, "2026-11-21", 10)).toMatchObject({ p_field: "name", p_membership: ["active", "expiring"], p_payment: "due", p_attendance: "no_this_week", p_page: 3 });
  });
  it("translates existing dashboard attendance links without losing their active roster restriction", () => {
    expect(parseMemberFilters(new URLSearchParams("status=slipping"))).toMatchObject({ attendance: "no_this_week", membership: ["active", "expiring"] });
  });
  it("rejects malformed and unsupported filters instead of broadening results", () => {
    for (const query of ["payment=unknown", "membership=active&membership=bogus", "expiry=custom&from=2026-02-30&to=2026-03-01", "expiry=custom&from=2026-12-01&to=2026-11-01", "field=name&field=phone"]) {
      expect(() => parseMemberFilters(new URLSearchParams(query))).toThrow(MemberFilterError);
    }
  });
});
