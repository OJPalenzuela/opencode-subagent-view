/**
 * Completion alerts for finished subagents.
 *
 * Alerts are raised per **execution**, driven by the server's own
 * `session.execution.*` events. That is strictly better than the poll this
 * replaced, and the reason is one specific behaviour: OpenCode can re-run a
 * subagent session, emitting `session.execution.started` again on the *same* id
 * while the record keeps its previous `outcome`. A tracker keyed on the outcome
 * field therefore sees nothing change on a re-run and stays silent forever —
 * exactly the bug this module exists to not have.
 *
 * The server's event is the identity of a run, so the history-vs-news question
 * that needed a `startedAt` priming heuristic disappears: a completion that
 * happened before the plugin loaded produced no event this generation could
 * miss, and one that happens after it always does.
 *
 * Everything here is pure and TUI-free, so every rule is unit tested without a
 * host. The subscription lives in `src/tui.tsx`.
 */

import { elapsedMs, finite, formatCost, formatDuration, formatTokens, rowLabel } from "./format.js";
import type { Outcome, SessionLike } from "./format.js";
import type { SubagentRow } from "./subagents.js";

/** A row that has reached a terminal outcome. */
export interface FinishedSubagent extends SubagentRow {
  readonly outcome: Outcome;
}

/** The execution events worth alerting on, and the outcome each one means. */
const EXECUTION_OUTCOMES = {
  "session.execution.succeeded": "succeeded",
  "session.execution.failed": "failed",
  "session.execution.interrupted": "interrupted",
} as const satisfies Record<string, Outcome>;

/** The parts of an execution event envelope the alert path reads. */
export interface ExecutionEventLike {
  readonly id?: string;
  readonly data?: { readonly sessionID?: string };
}

/**
 * The outcome a terminal execution event reports, or `undefined` for a
 * non-terminal or unrecognized one — which is the signal to stay silent.
 */
export function executionOutcome(type: string): Outcome | undefined {
  return Object.hasOwn(EXECUTION_OUTCOMES, type)
    ? EXECUTION_OUTCOMES[type as keyof typeof EXECUTION_OUTCOMES]
    : undefined;
}

/**
 * Whether a record is a subagent session, and so worth alerting on.
 *
 * A subagent is a session with a parent; the root session has none and must never
 * announce itself. An empty or blank `parentID` is not a parent.
 *
 * This replaces comparing `session.root()` of the event against the routed
 * session's, for two reasons. It is pure, so the filter is unit tested with no
 * host harness — the root comparison needed a live `Context` and could only be
 * inspected. And it does not lose a late arrival: an execution finishing while the
 * user is looking at another tree still alerts, which root-scoping dropped.
 */
export function isSubagentSession(record: unknown): boolean {
  if (typeof record !== "object" || record === null) return false;
  const parentID = (record as { readonly parentID?: unknown }).parentID;
  return typeof parentID === "string" && parentID.trim() !== "";
}

/**
 * Input + output, the same total the status line and the panel rows show.
 *
 * Reasoning and cache counters are deliberately left out, exactly as
 * `toRow` sums it: `NN% ctx` needs them, a "how many tokens" number does not, and
 * the two surfaces agreeing on one total is worth more than a bigger number here.
 */
function tokenTotal(session: SessionLike): number | undefined {
  const tokens = session.tokens;
  if (!tokens) return undefined;
  return (finite(tokens.input) ?? 0) + (finite(tokens.output) ?? 0);
}

/**
 * The row `finishedMessage` consumes, from a session record plus the outcome the
 * event reported. The event is the authority on the outcome, so it overrides
 * whatever the record still says — the whole point of the change.
 */
export function finishedRow(
  sessionID: string,
  session: SessionLike,
  outcome: Outcome,
  depth: number,
): FinishedSubagent {
  return {
    id: sessionID,
    label: rowLabel(session),
    model: session.model?.id,
    tokens: tokenTotal(session),
    cost: finite(session.cost),
    time: session.time,
    outcome,
    status: undefined,
    needsPermission: false,
    isCurrent: false,
    depth: Math.max(1, depth),
  };
}

/**
 * Whether this event is new for its session, remembering it either way.
 *
 * Event ids are unique, so a repeat of the same id is the same execution being
 * delivered twice, not a second run. A missing id is treated as new: a blank id
 * must not be able to swallow a real alert.
 */
export function seenExecution(seen: Map<string, string>, sessionID: string, eventID?: string): boolean {
  const previous = seen.get(sessionID);
  seen.set(sessionID, eventID ?? "");
  return eventID === undefined || eventID === "" || previous !== eventID;
}

/**
 * `succeeded · ⏱ 02:34 · 12.4k tok · $0.04`. Every segment is dropped when its
 * data is missing, so the outcome word is always the first thing read. Unchanged
 * by execution scoping: only *when* an alert fires moved, never what it says.
 */
export function finishedMessage(row: FinishedSubagent, now: number): string {
  const parts: string[] = [row.outcome];

  const elapsed = elapsedMs(row, now);
  if (elapsed !== undefined) parts.push(`⏱ ${formatDuration(elapsed)}`);

  if (row.tokens !== undefined && row.tokens > 0) parts.push(`${formatTokens(row.tokens)} tok`);
  if (row.cost !== undefined && row.cost > 0) parts.push(formatCost(row.cost));

  return parts.join(" · ");
}