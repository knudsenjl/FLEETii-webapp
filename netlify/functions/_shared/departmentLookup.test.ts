import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { findActiveDepartmentId, findRequestedDepartment } from "./departmentLookup.js";

type Row = { department_id: string; name: string; costumer_id: string | null };

/** Minimal stand-in for the query-builder chains findRequestedDepartment uses (.eq filters, then .maybeSingle() or .limit().returns()). */
function fakeAdmin(rows: Row[]): SupabaseClient {
  const builder = (filtered: Row[]) => {
    const project = (r: Row) => ({ department_id: r.department_id, costumer_id: r.costumer_id });
    const chain = {
      select: () => chain,
      eq: (column: keyof Row, value: string) => builder(filtered.filter((r) => r[column] === value)),
      maybeSingle: async () => ({ data: filtered[0] ? project(filtered[0]) : null, error: null }),
      limit: (n: number) => ({ returns: async () => ({ data: filtered.slice(0, n).map(project), error: null }) }),
    };
    return chain;
  };
  return { from: () => builder(rows) } as unknown as SupabaseClient;
}

const rows: Row[] = [
  { department_id: "d-alpha-salg", name: "Salg", costumer_id: "alpha" },
  { department_id: "d-beta-salg", name: "Salg", costumer_id: "beta" },
  { department_id: "d-alpha-lager", name: "Lager", costumer_id: "alpha" },
];

describe("findRequestedDepartment", () => {
  it("resolves by id when one is given, regardless of name", async () => {
    const result = await findRequestedDepartment(fakeAdmin(rows), { departmentId: "d-beta-salg", departmentName: "Lager", costumerId: "alpha" });
    expect(result.department).toEqual({ department_id: "d-beta-salg", costumer_id: "beta" });
  });

  it("scopes a name lookup to the given costumer, so a name shared by two costumers still resolves", async () => {
    const result = await findRequestedDepartment(fakeAdmin(rows), { departmentId: null, departmentName: "Salg", costumerId: "beta" });
    expect(result.department).toEqual({ department_id: "d-beta-salg", costumer_id: "beta" });
  });

  it("treats a name matching several departments (no costumer to scope by) as not found, never picking one", async () => {
    const result = await findRequestedDepartment(fakeAdmin(rows), { departmentId: null, departmentName: "Salg", costumerId: null });
    expect(result.department).toBeNull();
  });

  it("resolves an unambiguous name without a costumer scope", async () => {
    const result = await findRequestedDepartment(fakeAdmin(rows), { departmentId: null, departmentName: "Lager", costumerId: null });
    expect(result.department).toEqual({ department_id: "d-alpha-lager", costumer_id: "alpha" });
  });

  it("returns null when neither id nor name is given", async () => {
    const result = await findRequestedDepartment(fakeAdmin(rows), { departmentId: null, departmentName: null, costumerId: "alpha" });
    expect(result.department).toBeNull();
  });
});

/** Stand-in for the user_departments lookup findActiveDepartmentId makes: `grants` is the set of "userId departmentId" pairs that exist. */
function fakeGrants(grants: string[]): SupabaseClient {
  const chain = (filters: Record<string, string>) => ({
    select: () => chain(filters),
    eq: (column: string, value: string) => chain({ ...filters, [column]: value }),
    maybeSingle: async () => ({
      data: grants.includes(`${filters.user_id} ${filters.department_id}`) ? { department_id: filters.department_id } : null,
      error: null,
    }),
  });
  return { from: () => chain({}) } as unknown as SupabaseClient;
}

describe("findActiveDepartmentId (mirrors the DB's current_department_id())", () => {
  it("uses the home department when nothing is selected", async () => {
    await expect(findActiveDepartmentId(fakeGrants([]), { userId: "u", departmentId: "home", activeDepartmentId: null })).resolves.toBe("home");
  });

  it("uses the selected department when it's still granted", async () => {
    const admin = fakeGrants(["u home", "u other"]);
    await expect(findActiveDepartmentId(admin, { userId: "u", departmentId: "home", activeDepartmentId: "other" })).resolves.toBe("other");
  });

  it("falls back to the home department when the selected one is no longer granted", async () => {
    const admin = fakeGrants(["u home"]);
    await expect(findActiveDepartmentId(admin, { userId: "u", departmentId: "home", activeDepartmentId: "revoked" })).resolves.toBe("home");
  });
});
