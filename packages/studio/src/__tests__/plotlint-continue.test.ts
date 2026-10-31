import { describe, expect, it, vi } from "vitest";
import { MAX_BEFORE, cleanContinuation, continuationMessages, continueText, parseContinueBody } from "../api/plotlint-continue.js";

describe("ghost text continuation", () => {
  it("validates the body and trims long context", () => {
    expect(parseContinueBody(null)).toBe("body must be a JSON object");
    expect(parseContinueBody({ bookId: "b" })).toBe("before must be a string");
    const parsed = parseContinueBody({ bookId: "b", before: "x".repeat(MAX_BEFORE + 10), after: 3 });
    expect(parsed).toBe("after must be a string");
    const ok = parseContinueBody({ bookId: "b", before: `${"x".repeat(MAX_BEFORE)}end` });
    expect(typeof ok === "object" && ok.before.length).toBe(MAX_BEFORE);
    expect(typeof ok === "object" && ok.before.endsWith("end")).toBe(true);
    expect(typeof ok === "object" && ok.after).toBe("");
  });

  it("sends the text around the cursor", () => {
    const messages = continuationMessages({ before: "Mira walked", after: "She stopped." });
    expect(messages[0]!.content).toContain("lead naturally into the text that follows");
    expect(messages[1]!.content).toContain("Mira walked");
    expect(messages[1]!.content).toContain("She stopped.");
    expect(continuationMessages({ before: "Mira", after: "" })[1]!.content).not.toContain("after the cursor");
  });

  it("cleans the reply into text to insert at the cursor", () => {
    expect(cleanContinuation("to the pier.", "Mira walked")).toBe(" to the pier.");
    expect(cleanContinuation("\"to the pier.\"\nExtra line", "Mira walked")).toBe(" to the pier.");
    expect(cleanContinuation(", slowly.", "Mira walked")).toBe(", slowly.");
    expect(cleanContinuation("to the pier.", "Mira walked ")).toBe("to the pier.");
    expect(cleanContinuation("Mira walked to the pier", "Then Mira walked")).toBe(" to the pier");
    expect(cleanContinuation("向码头走去。", "米拉")).toBe("向码头走去。");
    expect(cleanContinuation("   ", "Mira")).toBeNull();
    const long = cleanContinuation(`${"word ".repeat(20)}end. ${"more ".repeat(30)}`, "Mira");
    expect(long!.length).toBeLessThanOrEqual(161);
    expect(long!.endsWith(".")).toBe(true);
  });

  it("asks the model only when there is text before the cursor", async () => {
    const complete = vi.fn(async () => "to the pier.");
    expect(await continueText({ before: "  ", after: "" }, complete)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect(await continueText({ before: "Mira walked", after: "" }, complete)).toBe(" to the pier.");
  });
});
