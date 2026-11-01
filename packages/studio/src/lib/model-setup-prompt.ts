import type { HashRoute } from "../hooks/use-hash-route";

export interface ModelServiceStatus {
  readonly connected: boolean;
}

/**
 * Decide whether to show the first-run "set up an AI model" popup.
 *
 * Only prompts once the service list actually loaded (a failed fetch must not
 * nag), when no provider is connected, and when the user is not already on the
 * model settings pages.
 */
export function shouldPromptModelSetup(input: {
  readonly services: ReadonlyArray<ModelServiceStatus> | null;
  readonly dismissed: boolean;
  readonly route: HashRoute;
}): boolean {
  if (input.dismissed) return false;
  if (input.services === null) return false;
  if (input.route.page === "services" || input.route.page === "service-detail") return false;
  return !input.services.some((service) => service.connected);
}
