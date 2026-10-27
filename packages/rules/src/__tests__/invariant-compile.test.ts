import { describe, expect, it } from "vitest";
import { compileInvariant, extractJson, invariantPrompt, invariantSlug, parseCompiledReply, type CompileMessage } from "../index.js";

/** A fake model that returns the given replies in turn and records what it was asked. */
function fakeModel(...replies: string[]) {
  const calls: CompileMessage[][] = [];
  const complete = async (messages: ReadonlyArray<CompileMessage>) => {
    calls.push([...messages]);
    const reply = replies[calls.length - 1];
    if (reply === undefined) throw new Error("no more replies");
    return reply;
  };
  return { complete, calls };
}

const mira = {
  id: "mira-captain-identity",
  check: { kind: "not-before", fact: { subject: "Mira", kind: "knowledge", object: { contains: ["captain"] } }, chapter: 20 },
};

describe("compiling invariants", () => {
  it("compiles a clean reply and explains it from the check", async () => {
    const model = fakeModel(JSON.stringify(mira));
    const compiled = await compileInvariant("Mira must not learn the captain's identity before chapter 20", model.complete, { names: ["Mira", "Captain Voss"], lastChapter: 12 });
    expect(compiled).toEqual({
      id: "mira-captain-identity",
      check: mira.check,
      explanation: "Fails when a fact whose subject is \"Mira\", of kind knowledge and whose object contains \"captain\" is in force before chapter 20.",
      attempts: 1,
    });
    const user = model.calls[0]!.at(-1)!.content;
    expect(user).toContain("Rule: \"Mira must not learn the captain's identity before chapter 20\"");
    expect(user).toContain("Mira, Captain Voss");
    expect(user).toContain("Chapters written so far: 12");
  });

  it("reads JSON out of reasoning blocks, fences and prose", () => {
    const reply = `<think>maybe { "id": "wrong" }</think>Here you go:\n\`\`\`json\n${JSON.stringify(mira)}\n\`\`\`\nDone.`;
    expect(extractJson(reply)).toBe(JSON.stringify(mira));
    expect(extractJson("{\"a\": \"}\"} trailing")).toBe("{\"a\": \"}\"}");
    expect(extractJson("no json")).toBeNull();
  });

  it("repairs slips with one reading: underscores, string numbers, the finale, a bare string list, a bare check", () => {
    const result = parseCompiledReply(JSON.stringify({
      kind: "Text_Not_Before", text: { contains: "inside the vault" }, chapter: "finale",
    }));
    expect(result).toEqual({ ok: true, check: { kind: "text-not-before", text: { contains: ["inside the vault"] }, chapter: "last" } });
    expect(parseCompiledReply(JSON.stringify({ id: "x", check: { kind: "not_after", fact: { kind: "world_rule" }, chapter: "12" } })))
      .toEqual({ ok: true, id: "x", check: { kind: "not-after", fact: { kind: "world_rule" }, chapter: 12 } });
  });

  it("reports what is wrong with an invalid check", () => {
    const result = parseCompiledReply(JSON.stringify({ id: "x", check: { kind: "not-before", fact: { subject: "Mira" } } }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/chapter/u);
    expect(parseCompiledReply("{ nope }")).toMatchObject({ ok: false, error: expect.stringMatching(/does not parse/u) });
  });

  it("asks the model to fix an invalid reply, once, then gives up", async () => {
    const model = fakeModel("{\"check\": {\"kind\": \"sometimes\"}}", JSON.stringify(mira));
    const compiled = await compileInvariant("Mira must not learn the captain's identity before chapter 20", model.complete);
    expect(compiled.attempts).toBe(2);
    expect(model.calls[1]!.at(-1)!.content).toMatch(/could not be used: the check is not valid/u);

    const failing = fakeModel("nothing", "still nothing");
    await expect(compileInvariant("x", failing.complete)).rejects.toThrow(/after 2 attempts: the reply has no JSON object/u);
  });

  it("compiles what it cannot check to unsupported, and slugs an id when the model gives none or a bad one", async () => {
    const model = fakeModel(JSON.stringify({ id: "Tomas Never Lies", check: { kind: "unsupported", reason: "Lying is a judgment." } }));
    const compiled = await compileInvariant("Tomas never lies", model.complete);
    expect(compiled).toMatchObject({ id: "tomas-never-lies", check: { kind: "unsupported" }, explanation: "Not checked: Lying is a judgment." });
  });

  it("slugs ids on word boundaries", () => {
    expect(invariantSlug("Mira must not learn the captain's identity before chapter 20")).toBe("mira-must-not-learn-the-captains-identity-before");
    expect(invariantSlug("林远不能死")).toBe("invariant");
  });

  it("describes the whole language in the system prompt", () => {
    const system = invariantPrompt("x")[0]!.content;
    for (const kind of ["never", "not-before", "not-after", "requires-before", "text-not-before", "unsupported"]) expect(system).toContain(`"${kind}"`);
  });
});
