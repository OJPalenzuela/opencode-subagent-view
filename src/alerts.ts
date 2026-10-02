/**
 * Completion alerts for finished subagents.
 *
 * The tracker is the whole state machine: it holds the last outcome seen per
 * subagent and reports the rows that just crossed into a terminal state. It is
 * pure and TUI-free so every rule below is unit tested without a host.
 *
 * The first snapshot is a baseline, never an announcement. A plugin reload or a
 * TUI restart must not replay subagents that finished before it started, so a
 * snapshot is only armed once it knows about at least one row.
 *
 * Callers pass rows already filtered to the root's subagents, so this never
 * walks the session tree, and a partial row is skipped rather than fatal.
 */

import { elapsedMs, formatCost, formatDuration, formatTokens } from "./format.js";
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

/**
 * Feed it the root's subagent rows on every refresh; get back the ones that
 * just finished. One instance per plugin generation, so the baseline lives as
 * long as the plugin does.
 *
 * Memory is bounded because only the current rows are carried forward, and the
 * input is trusted to be pre-filtered: this never walks the session tree.
 */
export interface CompletionTracker {
  /** Rows of the current root, returns the ones that just finished. */
  update(rows: readonly SubagentRow[]): FinishedSubagent[];
}

export function createCompletionTracker(): CompletionTracker {
  let seen: ReadonlyMap<string, Outcome | undefined> = new Map();
  let armed = false;

  return {
    update(rows) {
      const finished: FinishedSubagent[] = [];
      let snapshot: Map<string, Outcome | undefined> | undefined;

      for (const row of rows) {
        if (typeof row?.id !== "string" || row.id === "") continue;
        // Rebuilt per call instead of pruned: rows that left the tree fall out
        // on their own.
        const next = snapshot ?? new Map();
        snapshot = next;

        const outcome = alertedOutcome(row);
        const previous = seen.get(row.id);
        // A row that lost its outcome keeps the recorded one, so the outcome
        // can never announce itself twice.
        next.set(row.id, outcome ?? previous);

        if (outcome !== undefined && previous === undefined && armed) {
          finished.push({ ...row, outcome });
        }
      }

      seen = snapshot ?? new Map();
      // The first snapshot that knows a row is the baseline. Announcing it
      // would turn every reload into a burst of stale alerts.
      if (snapshot !== undefined && snapshot.size > 0) armed = true;

      return finished;
    },
  };
}