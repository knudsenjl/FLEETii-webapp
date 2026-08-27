import { describe, expect, it } from "vitest";
import { boardProfileId, boardProfileLabel, narrowProfilesForVehicle, profileMatchesVehicle, sortBoardProfiles } from "./twoHireProfiles";

describe("boardProfileId", () => {
  it("reads the confirmed real 'id' field", () => {
    expect(boardProfileId({ id: "abc-123" })).toBe("abc-123");
  });

  it("falls back to 'profileId' when 'id' is absent", () => {
    expect(boardProfileId({ profileId: "xyz-789" })).toBe("xyz-789");
  });

  it("returns an empty string when neither field is present", () => {
    expect(boardProfileId({ title: "Fiat 500" })).toBe("");
  });
});

describe("boardProfileLabel", () => {
  it("reads the confirmed real 'title' field", () => {
    expect(boardProfileLabel({ title: "Mercedes-Benz_GLE_W167-ImmoBreakout" })).toBe("Mercedes-Benz_GLE_W167-ImmoBreakout");
  });

  it("falls back to 'name' when 'title' is absent", () => {
    expect(boardProfileLabel({ name: "Some Name" })).toBe("Some Name");
  });

  it("falls back to the id when no label field is present", () => {
    expect(boardProfileLabel({ id: "abc-123" })).toBe("abc-123");
  });

  it("falls back to the raw JSON as a last resort", () => {
    expect(boardProfileLabel({ foo: "bar" })).toBe(JSON.stringify({ foo: "bar" }));
  });

  it("appends the year range when modelYearRange is present", () => {
    expect(boardProfileLabel({ title: "Mercedes-Benz_GLE_W167-ImmoBreakout", modelYearRange: [2011, 2019] })).toBe(
      "Mercedes-Benz_GLE_W167-ImmoBreakout (2011-2019)",
    );
  });

  it("appends the year range even when falling back to the id", () => {
    expect(boardProfileLabel({ id: "abc-123", modelYearRange: [2018, 2022] })).toBe("abc-123 (2018-2022)");
  });

  it("does not append anything when modelYearRange is absent/malformed", () => {
    expect(boardProfileLabel({ title: "Golf" })).toBe("Golf");
    expect(boardProfileLabel({ title: "Golf", modelYearRange: [2020] })).toBe("Golf");
    expect(boardProfileLabel({ title: "Golf", modelYearRange: null })).toBe("Golf");
  });
});

describe("sortBoardProfiles", () => {
  it("sorts by makerName first", () => {
    const profiles = [{ makerName: "VOLKSWAGEN", modelName: "Golf" }, { makerName: "AUDI", modelName: "A3" }];
    expect(sortBoardProfiles(profiles).map((p) => p.makerName)).toEqual(["AUDI", "VOLKSWAGEN"]);
  });

  it("sorts by modelName within the same maker, ignoring bracketed annotations", () => {
    const profiles = [
      { makerName: "RENAULT", modelName: "Trafic" },
      { makerName: "RENAULT", modelName: "Clio (58L)(Breakout)" },
      { makerName: "RENAULT", modelName: "Clio (44L)(Breakout)" },
    ];
    // Both "Clio" variants tie on the annotation-stripped model name, so they
    // stay adjacent (relative order between exact ties isn't asserted here),
    // and both sort before "Trafic".
    const sorted = sortBoardProfiles(profiles).map((p) => p.modelName);
    expect(sorted[2]).toBe("Trafic");
    expect(new Set(sorted.slice(0, 2))).toEqual(new Set(["Clio (58L)(Breakout)", "Clio (44L)(Breakout)"]));
  });

  it("sorts by the first model year within the same maker+model", () => {
    const profiles = [
      { makerName: "OPEL", modelName: "Combo", modelYearRange: [2018, 2022] },
      { makerName: "OPEL", modelName: "Combo", modelYearRange: [2012, 2017] },
    ];
    expect(sortBoardProfiles(profiles).map((p) => p.modelYearRange)).toEqual([
      [2012, 2017],
      [2018, 2022],
    ]);
  });

  it("sorts a profile with no parseable year after ones that have one", () => {
    const profiles = [
      { makerName: "OPEL", modelName: "Combo" },
      { makerName: "OPEL", modelName: "Combo", modelYearRange: [2012, 2017] },
    ];
    expect(sortBoardProfiles(profiles).map((p) => p.modelYearRange ?? null)).toEqual([[2012, 2017], null]);
  });

  it("does not mutate the input array", () => {
    const profiles = [{ makerName: "VOLKSWAGEN" }, { makerName: "AUDI" }];
    const original = [...profiles];
    sortBoardProfiles(profiles);
    expect(profiles).toEqual(original);
  });

  it("returns an empty array unchanged", () => {
    expect(sortBoardProfiles([])).toEqual([]);
  });
});

describe("profileMatchesVehicle", () => {
  it("matches when maker/model/year all align", () => {
    const profile = { makerName: "Volkswagen", modelName: "Golf", modelYearRange: [2018, 2022] };
    expect(profileMatchesVehicle(profile, { brand: "Volkswagen", model: "Golf", model_year: "2020" })).toBe(true);
  });

  it("matches leniently regardless of case/separator style", () => {
    const profile = { makerName: "Mercedes-Benz" };
    expect(profileMatchesVehicle(profile, { brand: "MERCEDES_BENZ", model: "", model_year: "" })).toBe(true);
  });

  it("does not exclude on missing profile fields (passes rather than excludes)", () => {
    const profile = { title: "Testprofil" };
    expect(profileMatchesVehicle(profile, { brand: "Volkswagen", model: "Golf", model_year: "2020" })).toBe(true);
  });

  it("rejects a genuine maker mismatch", () => {
    const profile = { makerName: "Volkswagen" };
    expect(profileMatchesVehicle(profile, { brand: "Toyota", model: "", model_year: "" })).toBe(false);
  });

  it("rejects when the vehicle's year falls outside the profile's modelYearRange", () => {
    const profile = { modelYearRange: [2018, 2020] };
    expect(profileMatchesVehicle(profile, { brand: "", model: "", model_year: "2023" })).toBe(false);
  });

  it("matches on year-range overlap when the vehicle's own year is itself a range", () => {
    const profile = { modelYearRange: [2018, 2020] };
    expect(profileMatchesVehicle(profile, { brand: "", model: "", model_year: "2014-2025" })).toBe(true);
  });

  // Real production examples (2hire's own board-profiles catalog dump,
  // 2026-08-27 — 453 profiles, 40 makers) — underscores as word separators,
  // and "(...)" annotations describing the physical device/size variant
  // rather than the vehicle's actual model.
  it("ignores a trailing '(Breakout)' annotation on modelName", () => {
    const profile = { makerName: "NISSAN", modelName: "GLE (Breakout)" };
    expect(profileMatchesVehicle(profile, { brand: "Nissan", model: "GLE", model_year: "" })).toBe(true);
  });

  it("ignores multiple stacked annotations, e.g. '(GPS)(Breakout)'", () => {
    const profile = { makerName: "NISSAN", modelName: "Qashqai (GPS)(Breakout)" };
    expect(profileMatchesVehicle(profile, { brand: "Nissan", model: "Qashqai", model_year: "" })).toBe(true);
  });

  it("ignores a size annotation, e.g. '(44L)', regardless of which size", () => {
    const profileSmall = { makerName: "RENAULT", modelName: "Clio (44L)(Breakout)" };
    const profileLarge = { makerName: "RENAULT", modelName: "Clio (58L)(Breakout)" };
    expect(profileMatchesVehicle(profileSmall, { brand: "Renault", model: "Clio", model_year: "" })).toBe(true);
    expect(profileMatchesVehicle(profileLarge, { brand: "Renault", model: "Clio", model_year: "" })).toBe(true);
  });

  it("treats '_' as a word separator, so MERCEDES_BENZ matches Mercedes-Benz", () => {
    const profile = { makerName: "MERCEDES_BENZ", modelName: "GLE" };
    expect(profileMatchesVehicle(profile, { brand: "Mercedes-Benz", model: "GLE", model_year: "" })).toBe(true);
  });

  it("still rejects a genuine model mismatch after annotation-stripping", () => {
    const profile = { makerName: "NISSAN", modelName: "Qashqai (GPS)(Breakout)" };
    expect(profileMatchesVehicle(profile, { brand: "Nissan", model: "Juke", model_year: "" })).toBe(false);
  });

  it("keeps a real hyphen inside a model name as a word separator, not noise (e.g. 'CR-V', 'Kona-e')", () => {
    const crv = { makerName: "HONDA", modelName: "CR-V" };
    expect(profileMatchesVehicle(crv, { brand: "Honda", model: "CR-V", model_year: "" })).toBe(true);
    // "Kona" alone still counts as a match for "Kona-e" (shorter side fully
    // contained in the longer) — narrowProfilesForVehicle relies on this to
    // avoid excluding a plausible variant just because the exact suffix
    // wasn't typed.
    const konaE = { makerName: "HYUNDAI", modelName: "Kona-e" };
    expect(profileMatchesVehicle(konaE, { brand: "Hyundai", model: "Kona", model_year: "" })).toBe(true);
  });

  it("does not confuse distinct alphanumeric model codes, e.g. Fiat 500 vs 500X", () => {
    const the500 = { makerName: "FIAT", modelName: "500" };
    const the500X = { makerName: "FIAT", modelName: "500X" };
    expect(profileMatchesVehicle(the500, { brand: "Fiat", model: "500X", model_year: "" })).toBe(false);
    expect(profileMatchesVehicle(the500X, { brand: "Fiat", model: "500", model_year: "" })).toBe(false);
  });
});

describe("narrowProfilesForVehicle", () => {
  const catalog = [
    { id: "1", makerName: "VOLKSWAGEN", modelName: "Golf (Breakout)", modelYearRange: [2018, 2020] },
    { id: "2", makerName: "VOLKSWAGEN", modelName: "Golf (Breakout)", modelYearRange: [2021, 2023] },
    { id: "3", makerName: "VOLKSWAGEN", modelName: "Polo (Breakout)", modelYearRange: [2018, 2023] },
    { id: "4", makerName: "TOYOTA", modelName: "Corolla (Breakout)", modelYearRange: [2018, 2023] },
  ];

  it("narrows down to a single unique match when maker+model+year all pin down one profile", () => {
    const result = narrowProfilesForVehicle(catalog, { brand: "Volkswagen", model: "Golf", model_year: "2019" });
    expect(result.map(boardProfileId)).toEqual(["1"]);
  });

  it("narrows to maker+model when year doesn't align with any of them (falls back a level)", () => {
    const result = narrowProfilesForVehicle(catalog, { brand: "Volkswagen", model: "Golf", model_year: "1990" });
    expect(new Set(result.map(boardProfileId))).toEqual(new Set(["1", "2"]));
  });

  it("narrows to maker only when model doesn't match anything under that maker (falls back a level)", () => {
    const result = narrowProfilesForVehicle(catalog, { brand: "Volkswagen", model: "Tiguan", model_year: "" });
    expect(new Set(result.map(boardProfileId))).toEqual(new Set(["1", "2", "3"]));
  });

  it("falls back to the full input list when even maker doesn't match anything", () => {
    const result = narrowProfilesForVehicle(catalog, { brand: "Skoda", model: "", model_year: "" });
    expect(result).toEqual(catalog);
  });

  it("falls back to the full input list when brand/model/year are all blank", () => {
    const result = narrowProfilesForVehicle(catalog, { brand: "", model: "", model_year: "" });
    expect(result).toEqual(catalog);
  });
});
