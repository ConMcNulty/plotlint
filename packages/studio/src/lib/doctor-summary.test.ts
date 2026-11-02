import { describe, expect, it } from "vitest";
import { doctorAllPassed, doctorLlmState, type DoctorChecks } from "./doctor-summary";

const healthy: DoctorChecks = {
  inkosJson: true,
  projectEnv: false,
  globalEnv: false,
  booksDir: true,
  llmConfigured: true,
  llmConnected: true,
  bookCount: 0,
};

describe("doctor summary", () => {
  it("passes with a reachable model even when no .env file exists", () => {
    expect(doctorAllPassed(healthy)).toBe(true);
  });

  it("fails and reports no key when no model is set up", () => {
    const checks = { ...healthy, llmConfigured: false, llmConnected: false };
    expect(doctorLlmState(checks)).toBe("no-key");
    expect(doctorAllPassed(checks)).toBe(false);
  });

  it("never passes on a connectivity result when no key is set up", () => {
    const checks = { ...healthy, llmConfigured: false, llmConnected: true };
    expect(doctorLlmState(checks)).toBe("no-key");
    expect(doctorAllPassed(checks)).toBe(false);
  });

  it("fails when the model is set up but unreachable", () => {
    const checks = { ...healthy, llmConnected: false };
    expect(doctorLlmState(checks)).toBe("failed");
    expect(doctorAllPassed(checks)).toBe(false);
  });

  it("fails without inkos.json or the books folder", () => {
    expect(doctorAllPassed({ ...healthy, inkosJson: false })).toBe(false);
    expect(doctorAllPassed({ ...healthy, booksDir: false })).toBe(false);
  });
});
