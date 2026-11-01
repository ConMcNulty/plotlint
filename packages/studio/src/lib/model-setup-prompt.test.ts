import { describe, expect, it } from "vitest";
import { shouldPromptModelSetup } from "./model-setup-prompt";

const dashboard = { page: "dashboard" } as const;

describe("shouldPromptModelSetup", () => {
  it("prompts when the service list loaded and nothing is connected", () => {
    expect(shouldPromptModelSetup({ services: [], dismissed: false, route: dashboard })).toBe(true);
    expect(shouldPromptModelSetup({
      services: [{ connected: false }, { connected: false }],
      dismissed: false,
      route: dashboard,
    })).toBe(true);
  });

  it("stays quiet once any provider is connected", () => {
    expect(shouldPromptModelSetup({
      services: [{ connected: false }, { connected: true }],
      dismissed: false,
      route: dashboard,
    })).toBe(false);
  });

  it("stays quiet while loading or when the service list failed to load", () => {
    expect(shouldPromptModelSetup({ services: null, dismissed: false, route: dashboard })).toBe(false);
  });

  it("stays quiet after the user dismisses it", () => {
    expect(shouldPromptModelSetup({ services: [], dismissed: true, route: dashboard })).toBe(false);
  });

  it("stays quiet when the user is already on the model settings pages", () => {
    expect(shouldPromptModelSetup({ services: [], dismissed: false, route: { page: "services" } })).toBe(false);
    expect(shouldPromptModelSetup({
      services: [],
      dismissed: false,
      route: { page: "service-detail", serviceId: "openai" },
    })).toBe(false);
  });
});
