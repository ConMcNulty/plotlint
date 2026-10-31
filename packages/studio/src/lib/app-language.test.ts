import { describe, expect, it } from "vitest";
import { getAppLanguage, tr } from "./app-language";

describe("app language", () => {
  it("defaults to English until a project chooses Chinese", () => {
    expect(getAppLanguage()).toBe("en");
    expect(tr("重试", "Retry")).toBe("Retry");
  });
});
