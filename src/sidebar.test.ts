import { describe, expect, it } from "vitest";
import { resolveSidebarSession } from "./sidebar.js";

/** Minimal stand-in for the host router route: no TUI, no data layer. */
function route(value: unknown): () => unknown {
  return () => value;
}

const THROWS = () => {
  throw new Error("router gone");
};

describe("resolveSidebarSession", () => {
  it("prefers the session id the slot input carries", () => {
    expect(resolveSidebarSession("ses_slot", route({ type: "session", sessionID: "ses_route" }))).toBe(
      "ses_slot",
    );
  });

  it("falls back to the router when the slot id is empty or missing", () => {
    const current = route({ type: "session", sessionID: "ses_route" });
    expect(resolveSidebarSession("", current)).toBe("ses_route");
    expect(resolveSidebarSession(undefined, current)).toBe("ses_route");
    expect(resolveSidebarSession(null, current)).toBe("ses_route");
    expect(resolveSidebarSession(42, current)).toBe("ses_route");
  });

  it("never reads the router when the slot id is usable", () => {
    expect(resolveSidebarSession("ses_slot", THROWS)).toBe("ses_slot");
  });

  it("yields undefined on a route that is not a session", () => {
    expect(resolveSidebarSession("", route({ type: "home" }))).toBeUndefined();
    expect(resolveSidebarSession("", route({ type: "plugin" }))).toBeUndefined();
    expect(resolveSidebarSession("", route(undefined))).toBeUndefined();
  });

  it("yields undefined when a non-session route still carries a session id", () => {
    expect(resolveSidebarSession("", route({ type: "home", sessionID: "ses_route" }))).toBeUndefined();
  });

  it("yields undefined for a session route with no usable id", () => {
    expect(resolveSidebarSession("", route({ type: "session", sessionID: "" }))).toBeUndefined();
    expect(resolveSidebarSession("", route({ type: "session" }))).toBeUndefined();
  });

  it("yields undefined instead of throwing when the router throws", () => {
    expect(resolveSidebarSession("", THROWS)).toBeUndefined();
  });

  it("never throws, whatever it is handed", () => {
    for (const value of [undefined, null, "", 0, false, {}, [], () => {}]) {
      expect(() => resolveSidebarSession(value, route({ type: "session", sessionID: "ses_route" }))).not.toThrow();
      expect(() => resolveSidebarSession("", route(value))).not.toThrow();
    }
  });
});