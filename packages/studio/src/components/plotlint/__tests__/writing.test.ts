// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TFunction } from "../../../hooks/use-i18n";
import { ManuscriptEditor } from "../ManuscriptEditor";
import type { LintDiagnostic, LintResponse } from "../lint-client";
import { countWords, sceneIdsIn, sceneMarkers, sceneOf, scenesCited, writingStats } from "../writing-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const emptyRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= emptyRect;

const TEXT = "# Chapter 3\n\nMira walked to the pier. She didn't stop.\n\n* * *\n\nThe tide was out.";

describe("writing stats", () => {
  it("counts prose words, not headings or breaks, and CJK characters one each", () => {
    expect(countWords("# Chapter 3\n\nMira didn't stop.\n\n* * *\n")).toBe(3);
    expect(countWords("他走了。Mira ran")).toBe(5);
  });

  it("counts each scene and finds the scene at an offset", () => {
    const stats = writingStats(TEXT, 3);
    expect(stats.scenes.map((scene) => [scene.id, scene.words])).toEqual([["ch3.s1", 8], ["ch3.s2", 4]]);
    expect(stats.words).toBe(12);
    expect(sceneOf(stats, TEXT.indexOf("tide"))?.id).toBe("ch3.s2");
    expect(sceneOf(stats, 0)?.id).toBe("ch3.s1");
  });

  it("puts one marker on each cited scene with the worst severity", () => {
    const stats = writingStats(TEXT, 3);
    const findings = [
      { summary: "Scene does not turn.", evidence: ["ch3.s2: no outcome"], severity: "note" as const },
      { summary: "No goal in 4 of 5 scenes.", evidence: ["ch3.s2: no goal", "ch4.s1: no goal"], severity: "warning" as const },
      { summary: "Mira is dead.", evidence: [], severity: "error" as const },
    ];
    expect(scenesCited(findings[1]!, 3)).toEqual([2]);
    expect(sceneIdsIn(findings[1]!)).toEqual(["ch3.s2", "ch4.s1"]);
    expect(sceneMarkers(findings, stats, 3)).toEqual([{
      id: "ch3.s2", offset: TEXT.indexOf("* * *"), severity: "warning", count: 2, title: "Scene does not turn.\nNo goal in 4 of 5 scenes.",
    }]);
  });
});

describe("ManuscriptEditor writing aids", () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  it("shows word counts, toggles focus mode and marks scenes with findings", async () => {
    const t = ((key: string) => key) as TFunction;
    const finding = {
      ruleId: "structure/scene-turn", layer: "structure", severity: "note", confidence: "judged", chapter: 3,
      summary: "Scene does not turn.", evidence: ["ch3.s2: no outcome"], fingerprint: "f1",
    } as unknown as LintDiagnostic;
    const lint = async (): Promise<LintResponse> => ({ sourceId: "chapter:3", diagnostics: [finding], ranges: null, suppressed: 0, stateMissing: false });
    const navigation = { stateAt: async (offset: number) => ({ chapter: 3, offset, entities: [], stateMissing: false }), definition: async () => null };
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(ManuscriptEditor, { bookId: "b", chapterNumber: 3, initialText: TEXT, t, lint, navigation, continuation: async () => null }));
    });
    expect(container.querySelector("[data-testid=chapter-words]")!.textContent).toBe("12 writing.words");
    expect(container.querySelector("[data-testid=scene-words]")!.textContent).toBe("writing.scene 1/2 · 8 writing.words");

    const marker = container.querySelector<HTMLElement>("[data-scene-marker]");
    expect(marker?.dataset.sceneMarker).toBe("ch3.s2");
    expect(marker?.title).toBe("Scene does not turn.");
    expect(container.querySelector("[data-testid=problems-panel] [data-scenes~='ch3.s2']")).not.toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>("[data-testid=focus-toggle]")!;
    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".ProseMirror.pl-focus")).not.toBeNull();
    expect(window.localStorage.getItem("plotlint.focusMode")).toBe("on");
    await act(async () => { toggle.click(); });
    expect(container.querySelector(".ProseMirror.pl-focus")).toBeNull();

    const ghost = container.querySelector<HTMLButtonElement>("[data-testid=ghost-toggle]")!;
    expect(ghost.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { ghost.click(); });
    expect(ghost.getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem("plotlint.ghostText")).toBe("on");
  });
});
