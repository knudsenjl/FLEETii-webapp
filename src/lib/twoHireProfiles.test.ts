import { describe, expect, it } from "vitest";
import { boardProfileId, boardProfileLabel, profileMatchesVehicle, sortBoardProfilesByLabel } from "./twoHireProfiles";

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
    expect(boardProfileLabel({ title: "Fiat 500 2019-2020" })).toBe("Fiat 500 2019-2020");
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
});

describe("sortBoardProfilesByLabel", () => {
  it("sorts profiles alphabetically by label", () => {
    const profiles = [{ title: "VW Golf" }, { title: "Audi A3" }, { title: "BMW 1-serie" }];
    expect(sortBoardProfilesByLabel(profiles).map(boardProfileLabel)).toEqual(["Audi A3", "BMW 1-serie", "VW Golf"]);
  });

  it("does not mutate the input array", () => {
    const profiles = [{ title: "VW Golf" }, { title: "Audi A3" }];
    const original = [...profiles];
    sortBoardProfilesByLabel(profiles);
    expect(profiles).toEqual(original);
  });

  it("returns an empty array unchanged", () => {
    expect(sortBoardProfilesByLabel([])).toEqual([]);
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
});
