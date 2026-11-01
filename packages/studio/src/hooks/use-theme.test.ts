import { describe, expect, it } from "vitest";
import { readStoredTheme, resolveThemePreference } from "./use-theme";

describe("resolveThemePreference", () => {
  it("keeps a stored manual theme", () => {
    expect(resolveThemePreference({ storedTheme: "dark" })).toBe("dark");
    expect(resolveThemePreference({ storedTheme: "light" })).toBe("light");
  });

  it("defaults to light when no manual theme is stored", () => {
    expect(resolveThemePreference({ storedTheme: null })).toBe("light");
  });
});

describe("readStoredTheme", () => {
  it("accepts only light and dark values from storage", () => {
    expect(readStoredTheme({ getItem: () => "light" })).toBe("light");
    expect(readStoredTheme({ getItem: () => "dark" })).toBe("dark");
    expect(readStoredTheme({ getItem: () => "auto" })).toBeNull();
    expect(readStoredTheme({ getItem: () => null })).toBeNull();
  });
});
