import { describe, expect, it } from "vitest";
import { buildSummary, formatDuration, formatTokens } from "./format.js";
import type { SessionLike } from "./format.js";

const T0 = 1_700_000_000_000;

function session(overrides: Partial<SessionLike> = {}): SessionLike {
  return {
    parentID: "ses_parent",
    agent: "explore",
    model: { id: "claude-sonnet-4-6", providerID: "anthropic" },
    tokens: { input: 9_000, output: 3_400 },
    time: { created: T0, updated: T0 + 2_500 },
    ...overrides,
  };
}

describe("formatDuration", () => {
  it("renders zero as 00:00", () => {
    expect(formatDuration(0)).toBe("00:00");
  });

  it("renders sub-minute durations as mm:ss", () => {
    expect(formatDuration(999)).toBe("00:00");
    expect(formatDuration(59_999)).toBe("00:59");
    expect(formatDuration(60_000)).toBe("01:00");
    expect(formatDuration(154_000)).toBe("02:34");
  });

  it("switches to hh:mm:ss at one hour", () => {
    expect(formatDuration(3_599_000)).toBe("59:59");
    expect(formatDuration(3_600_000)).toBe("01:00:00");
    expect(formatDuration(4_143_000)).toBe("01:09:03");
  });

  it("clamps negatives and non-numbers to 00:00", () => {
    expect(formatDuration(-1)).toBe("00:00");
    expect(formatDuration(-60_000)).toBe("00:00");
    expect(formatDuration(Number.NaN)).toBe("00:00");
  });
});

describe("formatTokens", () => {
  it("keeps values below one thousand verbatim", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(7)).toBe("7");
    expect(formatTokens(999)).toBe("999");
  });

  it("compacts thousands with one decimal", () => {
    expect(formatTokens(1_000)).toBe("1.0k");
    expect(formatTokens(1_200)).toBe("1.2k");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(999_400)).toBe("999.4k");
  });

  it("compacts millions", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_200_000)).toBe("1.2M");
  });

  it("promotes the unit instead of rounding across it", () => {
    expect(formatTokens(999_999)).toBe("1.0M");
    expect(formatTokens(999_999_999)).toBe("1.0B");
    expect(formatTokens(1e9)).toBe("1.0B");
    expect(formatTokens(1_000_000_000)).toBe("1.0B");
  });

  it("does not promote below the rounding boundary", () => {
    expect(formatTokens(999_949)).toBe("999.9k");
    expect(formatTokens(999_000)).toBe("999.0k");
  });

  it("caps at the B tier for absurd counts", () => {
    expect(formatTokens(1e12)).toBe("1000.0B");
  });

  it("clamps negatives and non-numbers to 0", () => {
    expect(formatTokens(-1)).toBe("0");
    expect(formatTokens(-1_200)).toBe("0");
    expect(formatTokens(Number.NaN)).toBe("0");
  });
});

describe("buildSummary state", () => {
  it("maps every outcome to its state", () => {
    expect(buildSummary(session({ outcome: "succeeded" }), T0).state).toBe("done");
    expect(buildSummary(session({ outcome: "failed" }), T0).state).toBe("error");
    expect(buildSummary(session({ outcome: "interrupted" }), T0).state).toBe("interrupted");
  });

  it("uses status when there is no outcome", () => {
    expect(buildSummary(session(), T0, "running").state).toBe("running");
    expect(buildSummary(session(), T0, "idle").state).toBe("unknown");
    expect(buildSummary(session(), T0).state).toBe("unknown");
  });

  it("prefers outcome over status", () => {
    expect(buildSummary(session({ outcome: "succeeded" }), T0, "running").state).toBe("done");
  });
});

describe("buildSummary label", () => {
  it("prefers agent, then title, then a constant fallback", () => {
    expect(buildSummary(session({ agent: "explore", title: "Find TODOs" }), T0).label).toBe("explore");
    expect(buildSummary(session({ agent: undefined, title: "Find TODOs" }), T0).label).toBe("Find TODOs");
    expect(buildSummary(session({ agent: undefined, title: undefined }), T0).label).toBe("subagent");
    expect(buildSummary(session({ agent: "  ", title: "Find TODOs" }), T0).label).toBe("Find TODOs");
  });
});

describe("buildSummary parts", () => {
  it("renders model, elapsed and tokens in order", () => {
    const summary = buildSummary(session(), T0 + 154_000);
    expect(summary.parts).toEqual(["claude-sonnet-4-6", "⏱ 02:34", "12.4k tok"]);
    expect(summary.text).toBe("claude-sonnet-4-6 · ⏱ 02:34 · 12.4k tok");
  });

  it("sums input and output tokens only", () => {
    const summary = buildSummary(
      session({ tokens: { input: 800, output: 199 } }),
      T0,
    );
    expect(summary.parts).toContain("999 tok");
  });

  it("omits missing and zero segments", () => {
    const summary = buildSummary(
      { time: { created: T0, updated: T0 } },
      T0 + 1_000,
    );
    expect(summary.parts).toEqual(["⏱ 00:01"]);
    expect(summary.text).toBe("⏱ 00:01");
  });

  it("omits a non-positive token total", () => {
    const summary = buildSummary(session({ tokens: { input: 0, output: 0 } }), T0);
    expect(summary.parts.some((part) => part.endsWith("tok"))).toBe(false);
  });

  it("keeps elapsed ticking while running", () => {
    expect(buildSummary(session(), T0 + 60_000).text).toContain("⏱ 01:00");
  });

  it("freezes elapsed at time.idle once the outcome is set", () => {
    const frozen = session({
      outcome: "succeeded",
      time: { created: T0, updated: T0 + 900_000, idle: T0 + 40_000 },
    });
    expect(buildSummary(frozen, T0 + 3_600_000).text).toContain("⏱ 00:40");
  });

  it("falls back to time.updated when idle is absent", () => {
    const frozen = session({ outcome: "failed", time: { created: T0, updated: T0 + 90_000 } });
    expect(buildSummary(frozen, T0 + 3_600_000).text).toContain("⏱ 01:30");
  });
});

describe("buildSummary resilience", () => {
  it("never throws on an empty session", () => {
    const summary = buildSummary({}, T0, "idle");
    expect(summary.state).toBe("unknown");
    expect(summary.label).toBe("subagent");
    expect(summary.parts).toEqual([]);
    expect(summary.text).toBe("");
  });

  it("ignores a time.created in the future", () => {
    expect(buildSummary(session(), T0 - 5_000).text).toContain("⏱ 00:00");
  });
});