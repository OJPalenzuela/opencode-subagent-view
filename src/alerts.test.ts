import { describe, expect, it } from "vitest";
import { createCompletionTracker, finishedMessage } from "./alerts.js";
import type { FinishedSubagent } from "./alerts.js";
import type { SubagentRow } from "./subagents.js";

const T0 = 1_700_000_000_000;

function row(overrides: Partial<SubagentRow> = {}): SubagentRow {
  return {
    id: "ses_x",
    label: "explore",
    needsPermission: false,
    isCurrent: false,
    depth: 1,
    ...overrides,
  };
}

/** A row the tracker would have returned: terminal outcome guaranteed. */
function finished(overrides: Partial<FinishedSubagent> = {}): FinishedSubagent {
  return { ...row(), outcome: "succeeded", ...overrides };
}

/** A tree of three subagents, none of them finished yet. */
function threeRunning(): SubagentRow[] {
  return [
    row({ id: "ses_a", label: "explore", status: "running" }),
    row({ id: "ses_b", label: "review", status: "running" }),
    row({ id: "ses_c", label: "plan" }),
  ];
}

function ids(rows: readonly SubagentRow[]): string[] {
  return rows.map((r) => r.id);
}

describe("createCompletionTracker priming", () => {
  it("fires nothing on the first snapshot, even when rows already finished", () => {
    const tracker = createCompletionTracker();
    const rows = [row({ id: "ses_a", outcome: "succeeded" }), row({ id: "ses_b", outcome: "failed" })];
    expect(tracker.update(rows)).toEqual([]);
  });

  it("keeps priming while the tree is still empty", () => {
    const tracker = createCompletionTracker();
    expect(tracker.update([])).toEqual([]);
    expect(tracker.update([row({ id: "ses_a", outcome: "succeeded" })])).toEqual([]);
    // Only now is the baseline armed.
    expect(tracker.update([row({ id: "ses_b", outcome: "failed" })])).toHaveLength(1);
  });

  it("does not storm after a reload on a tree that is already done", () => {
    const finished = [
      row({ id: "ses_a", outcome: "succeeded" }),
      row({ id: "ses_b", outcome: "failed" }),
      row({ id: "ses_c", outcome: "interrupted" }),
    ];
    const reloaded = createCompletionTracker();
    reloaded.update(finished);
    expect(reloaded.update(finished)).toEqual([]);
    expect(reloaded.update(finished)).toEqual([]);
  });
});

describe("createCompletionTracker transitions", () => {
  it("fires exactly once when a row reaches a terminal outcome", () => {
    const tracker = createCompletionTracker();
    tracker.update(threeRunning());

    const fired = tracker.update([
      threeRunning()[0]!,
      row({ id: "ses_b", label: "review", outcome: "succeeded" }),
      threeRunning()[2]!,
    ]);
    expect(ids(fired)).toEqual(["ses_b"]);
    expect(fired[0]?.label).toBe("review");
    expect(fired[0]?.outcome).toBe("succeeded");
  });

  it("fires nothing when the same rows come back unchanged", () => {
    const tracker = createCompletionTracker();
    const rows = threeRunning();
    tracker.update(rows);
    const done = [rows[0]!, row({ id: "ses_b", label: "review", outcome: "failed" }), rows[2]!];
    expect(ids(tracker.update(done))).toEqual(["ses_b"]);
    expect(tracker.update(done)).toEqual([]);
    expect(tracker.update(done)).toEqual([]);
  });

  it("fires a row that finished between two refreshes", () => {
    const tracker = createCompletionTracker();
    tracker.update(threeRunning());
    const fired = tracker.update([
      threeRunning()[0]!,
      row({ id: "ses_new", label: "docs", outcome: "interrupted" }),
    ]);
    expect(ids(fired)).toEqual(["ses_new"]);
    expect(fired[0]?.outcome).toBe("interrupted");
  });

  it("never re-fires a terminal row when its data changes", () => {
    const tracker = createCompletionTracker();
    tracker.update(threeRunning());
    const first = tracker.update([row({ id: "ses_b", label: "review", outcome: "succeeded", tokens: 10 })]);
    expect(ids(first)).toEqual(["ses_b"]);

    const later = tracker.update([
      row({ id: "ses_b", label: "review renamed", outcome: "succeeded", tokens: 999_999, cost: 1.5 }),
    ]);
    expect(later).toEqual([]);
  });

  it("returns every newly finished row in input order", () => {
    const tracker = createCompletionTracker();
    tracker.update(threeRunning());
    const fired = tracker.update([
      row({ id: "ses_c", label: "plan", outcome: "failed" }),
      row({ id: "ses_a", label: "explore", outcome: "succeeded" }),
      row({ id: "ses_b", label: "review", outcome: "interrupted" }),
    ]);
    expect(ids(fired)).toEqual(["ses_c", "ses_a", "ses_b"]);
  });

  it("forgets rows that leave the tree", () => {
    const tracker = createCompletionTracker();
    tracker.update(threeRunning());
    tracker.update([row({ id: "ses_b", label: "review", outcome: "succeeded" })]);
    expect(tracker.update([])).toEqual([]);
    // Gone from the map, so it is a new row again rather than a memory leak.
    expect(ids(tracker.update([row({ id: "ses_b", label: "review", outcome: "succeeded" })]))).toEqual([
      "ses_b",
    ]);
  });

  it("survives partial rows and skips unusable ids", () => {
    const tracker = createCompletionTracker();
    tracker.update([row({ id: "ses_run" })]);
    const partial = [
      undefined,
      row({}),
      { id: "", label: "blank" },
      { label: "no id", outcome: "failed" },
      row({ id: "ses_ok", outcome: "succeeded" }),
    ] as unknown as SubagentRow[];

    expect(() => tracker.update(partial)).not.toThrow();
    expect(ids(tracker.update(partial))).toEqual([]);
  });

  it("still reports a real row out of a batch of partial ones", () => {
    const tracker = createCompletionTracker();
    tracker.update([row({ id: "ses_run" })]);
    const partial = [
      undefined,
      { id: "", label: "blank" },
      row({ id: "ses_ok", outcome: "failed" }),
    ] as unknown as SubagentRow[];

    expect(ids(tracker.update(partial))).toEqual(["ses_ok"]);
  });

  it("ignores an outcome it does not know", () => {
    const tracker = createCompletionTracker();
    tracker.update(threeRunning());
    // A server this build predates: the string is outside `Outcome`.
    const bogus = { ...row({ id: "ses_b" }), outcome: "exploded" } as unknown as SubagentRow;
    expect(tracker.update([bogus])).toEqual([]);
    // The real outcome later still fires.
    expect(ids(tracker.update([row({ id: "ses_b", outcome: "failed" })]))).toEqual(["ses_b"]);
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
    expect(finishedMessage(finished({ outcome: "interrupted" }), T0)).toBe("interrupted");
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