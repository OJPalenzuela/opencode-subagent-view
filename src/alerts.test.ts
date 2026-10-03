import { describe, expect, it } from "vitest";
import {
  executionOutcome,
  finishedMessage,
  finishedRow,
  isSubagentSession,
  seenExecution,
} from "./alerts.js";
import type { ExecutionEventLike, FinishedSubagent } from "./alerts.js";
import type { SessionLike } from "./format.js";

const T0 = 1_700_000_000_000;

/** A session record as the data layer returns it. */
function record(overrides: Partial<SessionLike> = {}): SessionLike {
  return {
    agent: "explore",
    model: { id: "claude-sonnet-4-6" },
    tokens: { input: 9_000, output: 3_400 },
    cost: 0.04,
    time: { created: T0, updated: T0 + 154_000 },
    ...overrides,
  };
}

/** A row the tracker would have returned: terminal outcome guaranteed. */
function finished(overrides: Partial<FinishedSubagent> = {}): FinishedSubagent {
  return {
    id: "ses_x",
    label: "explore",
    needsPermission: false,
    isCurrent: false,
    depth: 1,
    time: { created: T0, updated: T0 },
    outcome: "succeeded",
    ...overrides,
  };
}

describe("executionOutcome", () => {
  it("maps each terminal execution event to its outcome", () => {
    expect(executionOutcome("session.execution.succeeded")).toBe("succeeded");
    expect(executionOutcome("session.execution.failed")).toBe("failed");
    expect(executionOutcome("session.execution.interrupted")).toBe("interrupted");
  });

  it("returns undefined for a non-terminal event and for an unknown one", () => {
    expect(executionOutcome("session.execution.started")).toBeUndefined();
    expect(executionOutcome("session.updated")).toBeUndefined();
    expect(executionOutcome("")).toBeUndefined();
  });
});

describe("finishedRow", () => {
  it("builds the row `finishedMessage` consumes from a record plus an outcome", () => {
    const row = finishedRow("ses_a", record({ agent: "general", title: "F4 context usage percent" }), "succeeded", 1);
    expect(row.id).toBe("ses_a");
    expect(row.label).toBe("F4 context usage percent (general)");
    expect(row.outcome).toBe("succeeded");
    expect(row.tokens).toBe(12_400);
    expect(row.cost).toBe(0.04);
    expect(row.model).toBe("claude-sonnet-4-6");
    expect(row.needsPermission).toBe(false);
    expect(row.isCurrent).toBe(false);
    expect(row.depth).toBe(1);
  });

  it("falls back to the agent alone, then to the default label", () => {
    expect(finishedRow("ses_a", record({ agent: "review" }), "failed", 2).label).toBe("review");
    expect(finishedRow("ses_a", record({ agent: undefined }), "failed", 1).label).toBe("subagent");
  });

  it("sums input and output only, like every other surface's token total", () => {
    // The public `SessionTokens` carries input/output; the wider record may also
    // carry reasoning and cache counters, which must not be counted here either.
    const wider = {
      input: 1_000,
      output: 200,
      reasoning: 300,
      cache: { read: 400, write: 500 },
    };
    const row = finishedRow(
      "ses_a",
      record({ tokens: { input: wider.input, output: wider.output } }),
      "succeeded",
      1,
    );
    expect(row.tokens).toBe(1_200);
    expect(Object.values(wider).length).toBeGreaterThan(2);
  });

  it("keeps the record's own terminal time so the elapsed clock freezes", () => {
    const row = finishedRow(
      "ses_a",
      record({ tokens: undefined, cost: undefined, time: { created: T0, updated: T0 + 900_000 } }),
      "succeeded",
      1,
    );
    expect(finishedMessage(row, T0 + 3_600_000)).toBe("succeeded · ⏱ 15:00");
  });

  it("still renders when the record carries nothing but an id", () => {
    const row = finishedRow("ses_a", {}, "interrupted", 1);
    expect(row.tokens).toBeUndefined();
    expect(finishedMessage(row, T0)).toBe("interrupted");
  });
});

describe("isSubagentSession", () => {
  it("accepts a record that carries a real parent id", () => {
    expect(isSubagentSession({ parentID: "ses_root" })).toBe(true);
  });

  it("rejects an empty-string parent, which is not a parent", () => {
    expect(isSubagentSession({ parentID: "" })).toBe(false);
    expect(isSubagentSession({ parentID: "   " })).toBe(false);
  });

  it("rejects a record with no parent at all: a root session never alerts", () => {
    expect(isSubagentSession({})).toBe(false);
    expect(isSubagentSession({ parentID: undefined })).toBe(false);
  });

  it("rejects a record that is not an object", () => {
    for (const value of [undefined, null, "", 0, false, "ses_root", 42]) {
      expect(isSubagentSession(value)).toBe(false);
    }
  });

  it("is what keeps a root session from ever producing an alert row", () => {
    // The guard the old root comparison used to provide, now provable without a
    // host: a root record is rejected, so `finishedRow` is never reached for it.
    const root = { title: "root session" };
    expect(isSubagentSession(root)).toBe(false);
    const child = { parentID: "ses_root", title: "root session" };
    expect(isSubagentSession(child)).toBe(true);
    if (isSubagentSession(child)) {
      expect(finishedRow("ses_a", child, "succeeded", 1).label).toBe("root session");
    }
  });
});

describe("seenExecution", () => {
  it("reports a new event id and remembers it", () => {
    const seen = new Map<string, string>();
    expect(seenExecution(seen, "ses_a", "evt_1")).toBe(true);
    expect(seenExecution(seen, "ses_a", "evt_1")).toBe(false);
    expect(seen.get("ses_a")).toBe("evt_1");
  });

  it("reports a different id for the same session as new again", () => {
    const seen = new Map<string, string>();
    expect(seenExecution(seen, "ses_a", "evt_1")).toBe(true);
    expect(seenExecution(seen, "ses_a", "evt_2")).toBe(true);
    expect(seen.get("ses_a")).toBe("evt_2");
  });

  it("keeps one id per session, independently", () => {
    const seen = new Map<string, string>();
    expect(seenExecution(seen, "ses_a", "evt_1")).toBe(true);
    expect(seenExecution(seen, "ses_b", "evt_1")).toBe(true);
    expect(seenExecution(seen, "ses_a", "evt_1")).toBe(false);
    expect(seenExecution(seen, "ses_b", "evt_1")).toBe(false);
  });

  it("treats a missing or empty event id as new rather than swallowing the alert", () => {
    const seen = new Map<string, string>();
    expect(seenExecution(seen, "ses_a", undefined)).toBe(true);
    expect(seenExecution(seen, "ses_a", "")).toBe(true);
  });

  it("alerts again on a re-run of the same session, which is a new event id", () => {
    // The bug this replaced: the same session id re-run by the server, so the
    // record's `outcome` never changes and an outcome-diffing tracker is silent
    // forever. A new event id is a new execution, and must announce again.
    const seen = new Map<string, string>();
    expect(seenExecution(seen, "ses_a", "evt_run1")).toBe(true);
    expect(seenExecution(seen, "ses_a", "evt_run1")).toBe(false);
    expect(seenExecution(seen, "ses_a", "evt_run2")).toBe(true);
    expect(seenExecution(seen, "ses_a", "evt_run2")).toBe(false);
    expect(seenExecution(seen, "ses_a", "evt_run3")).toBe(true);
  });

  it("reads the session id straight off the event envelope", () => {
    const event = (sessionID?: string): ExecutionEventLike => ({
      id: "evt_1",
      data: sessionID === undefined ? undefined : { sessionID },
    });
    expect(event("ses_a").data?.sessionID).toBe("ses_a");
    expect(event(undefined).data).toBeUndefined();
  });
});

describe("finishedMessage", () => {
  const METRICS = {
    tokens: 12_400,
    cost: 0.04,
    time: { created: T0, updated: T0 + 154_000 },
  };

  it("renders the documented success message", () => {
    expect(finishedMessage(finished({ ...METRICS }), T0 + 154_000)).toBe(
      "succeeded · ⏱ 02:34 · 12.4k tok · $0.04",
    );
  });

  it("names the actual outcome", () => {
    expect(finishedMessage(finished({ outcome: "failed", ...METRICS }), T0 + 154_000)).toBe(
      "failed · ⏱ 02:34 · 12.4k tok · $0.04",
    );
    expect(finishedMessage(finished({ outcome: "interrupted", ...METRICS }), T0 + 154_000)).toBe(
      "interrupted · ⏱ 02:34 · 12.4k tok · $0.04",
    );
  });

  it("drops the cost segment when there is none", () => {
    const metrics = { tokens: 12_400, time: { created: T0, updated: T0 + 154_000 } };
    expect(finishedMessage(finished({ ...metrics }), T0 + 154_000)).toBe(
      "succeeded · ⏱ 02:34 · 12.4k tok",
    );
  });

  it("keeps the outcome alone when no metric is available", () => {
    expect(finishedMessage(finished({ outcome: "interrupted", time: undefined }), T0)).toBe("interrupted");
  });

  it("omits zeroed or missing metrics", () => {
    const zeroed = { tokens: 0, cost: 0, time: { created: T0, updated: T0 } };
    expect(finishedMessage(finished({ ...zeroed }), T0)).toBe("succeeded · ⏱ 00:00");
  });

  it("freezes the clock on the finished row, ignoring `now`", () => {
    const done = finished({ time: { created: T0, updated: T0 + 5_000, idle: T0 + 9_000 } });
    expect(finishedMessage(done, T0 + 600_000)).toBe("succeeded · ⏱ 00:09");
  });
});