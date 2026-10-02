/**
 * Completion alerts for finished subagents.
 *
 * The tracker is the whole state machine: it holds the last outcome seen per
 * subagent and reports the rows that just crossed into a terminal state. It is
 * pure and TUI-free so every rule below is unit tested without a host.
 *
 * A subagent that finished after the plugin started is news; one that finished
 * before it started is history. That single rule is why a reload stays silent
 * and why a completion missed while the tree was empty is still announced.
 *
 * Callers pass rows already filtered to the root's subagents, so this never
 * walks the session tree, and a partial row is skipped rather than fatal.
 */

import { elapsedMs, finite, formatCost, formatDuration, formatTokens } from "./format.js";
import type { Outcome } from "./format.js";
import type { SubagentRow } from "./subagents.js";

/** A row that has reached a terminal outcome and has not been reported yet. */
export interface FinishedSubagent extends SubagentRow {
  readonly outcome: Outcome;
}

/** The three outcomes worth alerting on. Anything else stays non-terminal. */
const ALERTED: ReadonlySet<Outcome> = new Set<Outcome>(["succeeded", "failed", "interrupted"]);

const SEPARATOR = " · ";

function alertedOutcome(row: SubagentRow): Outcome | undefined {
  return row.outcome !== undefined && ALERTED.has(row.outcome) ? row.outcome : undefined;
}

/** When the row stopped, or `undefined` if it never reported a time. */
function endedAt(row: SubagentRow): number | undefined {
  return finite(row.time?.idle) ?? finite(row.time?.updated);
}

/**
 * `succeeded · ⏱ 02:34 · 12.4k tok · $0.04`. Every segment is dropped when its
 * data is missing, so the outcome word is always the first thing read.
 */
export function finishedMessage(row: FinishedSubagent, now: number): string {
  const parts: string[] = [row.outcome];

  const elapsed = elapsedMs(row, now);
  if (elapsed !== undefined) parts.push(`⏱ ${formatDuration(elapsed)}`);

  if (row.tokens !== undefined && row.tokens > 0) parts.push(`${formatTokens(row.tokens)} tok`);
  if (row.cost !== undefined && row.cost > 0) parts.push(formatCost(row.cost));

  return parts.join(SEPARATOR);
}

/** Rows of the current root come in, rows that just finished come out. */
export interface CompletionTracker {
  update(rows: readonly SubagentRow[]): FinishedSubagent[];
}

export interface CompletionTrackerOptions {
  /** When the plugin started. Injectable so the clock rule is testable. */
  readonly startedAt?: number;
}

/**
 * Feed it the root's subagent rows on every refresh; get back the ones that
 * just finished. One instance per plugin generation.
 *
 * "Finished before I started looking?" is not answerable from row data, so it
 * is answered by the row's own terminal time against `startedAt`: older is
 * history and stays silent, which is what stops a reload from replaying old
 * completions. The id memory only handles the rest — real transitions, and the
 * repeat sightings that a transient empty or partial refresh produces.
 *
 * ponytail: `seen` grows with distinct subagent ids per plugin generation
 * (kilobytes even after thousands of subagents). Add an eviction policy if that
 * ever matters.
 */
export function createCompletionTracker(options: CompletionTrackerOptions = {}): CompletionTracker {
  const startedAt = options.startedAt ?? Date.now();
  const seen = new Map<string, Outcome | undefined>();

  return {
    update(rows) {
      const finished: FinishedSubagent[] = [];

      for (const row of rows) {
        if (typeof row?.id !== "string" || row.id === "") continue;

        const outcome = alertedOutcome(row);
        const previous = seen.get(row.id);
        // Never rebuilt from the current rows: a snapshot that lost a row must
        // not forget it. A row that lost its outcome keeps the recorded one.
        seen.set(row.id, outcome ?? previous);
        if (outcome === undefined) continue;

        const ended = endedAt(row);
        const isNews = previous !== undefined
          // A recorded outcome that changes is a real transition.
          ? previous !== outcome
          // First sighting: only news, never history.
          : ended !== undefined && ended >= startedAt;

        if (isNews) finished.push({ ...row, outcome });
      }

      return finished;
    },
  };
}