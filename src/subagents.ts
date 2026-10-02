/**
 * Pure selectors for the subagent panel.
 *
 * No TUI imports and no plugin context: lookups are injected as parameters and
 * every field degrades to `undefined` instead of throwing, so the data layer can
 * be mid-invalidation while the panel re-renders.
 */

import { DEFAULT_LABEL, STATE, deriveState, elapsedMs, finite, formatCost, formatDuration, formatTokens } from "./format.js";
import type { Outcome, SessionLike, SessionStatus, SessionTime, State } from "./format.js";
import { CURRENT_GLYPH, MARKERS, PERMISSION_GLYPH } from "./theme.js";

/** `SessionLike` plus the identity and cost the panel needs. */
export interface SubagentSession extends SessionLike {
  readonly id: string;
  readonly cost?: number;
}

/** One panel line. `time` is the raw record so elapsed and recency agree. */
export interface SubagentRow {
  readonly id: string;
  readonly label: string;
  readonly model?: string;
  /** Input + output, the same total the status line shows. */
  readonly tokens?: number;
  readonly cost?: number;
  readonly time?: SessionTime;
  readonly outcome?: Outcome;
  readonly status?: SessionStatus;
  readonly needsPermission: boolean;
  readonly isCurrent: boolean;
  /** 1 for a direct child of the root session, 2 for a grandchild. */
  readonly depth: number;
}

export interface SubagentCounts {
  readonly running: number;
  readonly done: number;
  /** Failed *and* interrupted: both are terminal but not successful. */
  readonly failed: number;
}

export type StatusLookup = (sessionID: string) => SessionStatus | undefined;
export type PermissionLookup = (sessionID: string) => boolean;

const FINISHED: ReadonlySet<State> = new Set<State>([
  STATE.DONE,
  STATE.ERROR,
  STATE.INTERRUPTED,
]);

/** Injected lookups may throw (the data layer can be invalidated mid-read). */
function lookup<Value>(read: ((id: string) => Value) | undefined, id: string, fallback: Value): Value {
  if (!read) return fallback;
  try {
    return read(id) ?? fallback;
  } catch {
    return fallback;
  }
}

function byId(sessions: readonly SubagentSession[]): Map<string, SubagentSession> {
  const map = new Map<string, SubagentSession>();
  for (const session of sessions) {
    if (session && typeof session.id === "string" && session.id !== "") map.set(session.id, session);
  }
  return map;
}

/**
 * Walk `parentID` up to the topmost session present in the list. A missing
 * parent or a cycle stops the walk, leaving the current session as the root.
 */
function rootOf(index: ReadonlyMap<string, SubagentSession>, currentSessionID: string): string {
  const seen = new Set<string>();
  let rootID = currentSessionID;
  let cursor: string | undefined = currentSessionID;
  while (cursor !== undefined && cursor !== "" && index.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    rootID = cursor;
    cursor = index.get(cursor)?.parentID;
  }
  return rootID;
}

function tokenTotal(session: SubagentSession): number | undefined {
  const tokens = session.tokens;
  if (!tokens) return undefined;
  return (finite(tokens.input) ?? 0) + (finite(tokens.output) ?? 0);
}

function toRow(
  session: SubagentSession,
  depth: number,
  currentSessionID: string,
  getStatus?: StatusLookup,
  needsPermission?: PermissionLookup,
): SubagentRow {
  return {
    id: session.id,
    label: session.agent?.trim() || session.title?.trim() || DEFAULT_LABEL,
    model: session.model?.id,
    tokens: tokenTotal(session),
    cost: finite(session.cost),
    time: session.time,
    outcome: session.outcome,
    status: lookup(getStatus, session.id, undefined),
    needsPermission: lookup(needsPermission, session.id, false),
    isCurrent: session.id === currentSessionID,
    depth,
  };
}

/**
 * Every descendant of the current session's root, breadth first so children
 * always follow their parent. The root itself is never included.
 */
export function collectSubagents(
  sessions: readonly SubagentSession[],
  currentSessionID: string,
  getStatus?: StatusLookup,
  needsPermission?: PermissionLookup,
): SubagentRow[] {
  const index = byId(sessions);
  const children = new Map<string, SubagentSession[]>();
  for (const session of index.values()) {
    const parentID = session.parentID;
    if (parentID === undefined || parentID === "" || !index.has(parentID)) continue;
    const bucket = children.get(parentID);
    if (bucket) bucket.push(session);
    else children.set(parentID, [session]);
  }

  const rootID = rootOf(index, currentSessionID);
  const seen = new Set<string>([rootID]);
  const rows: SubagentRow[] = [];

  let level = children.get(rootID) ?? [];
  for (let depth = 1; level.length > 0; depth += 1) {
    const next: SubagentSession[] = [];
    for (const session of level) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      rows.push(toRow(session, depth, currentSessionID, getStatus, needsPermission));
      next.push(...(children.get(session.id) ?? []));
    }
    level = next;
  }
  return rows;
}

/**
 * Same `State` model as the status line: an `outcome` wins over `status`.
 * `now` is accepted for call-site parity with `buildSummary`; state does not
 * depend on the clock.
 */
export function stateOf(row: SubagentRow, _now?: number): State {
  return deriveState(row, row.status);
}

/** Permission-pending first, then running, then everything else by recency. */
function rankOf(row: SubagentRow): number {
  if (row.needsPermission) return 0;
  return stateOf(row) === STATE.RUNNING ? 1 : 2;
}

function activityOf(row: SubagentRow): number {
  return finite(row.time?.updated) ?? 0;
}

export function orderRows(rows: readonly SubagentRow[]): SubagentRow[] {
  return [...rows].sort((a, b) => rankOf(a) - rankOf(b) || activityOf(b) - activityOf(a));
}

export function visibleRows(rows: readonly SubagentRow[], showCompleted: boolean): SubagentRow[] {
  if (showCompleted) return [...rows];
  return rows.filter((row) => !FINISHED.has(stateOf(row)));
}

export function counts(rows: readonly SubagentRow[]): SubagentCounts {
  let running = 0;
  let done = 0;
  let failed = 0;
  for (const row of rows) {
    switch (stateOf(row)) {
      case STATE.RUNNING:
        running += 1;
        break;
      case STATE.DONE:
        done += 1;
        break;
      case STATE.ERROR:
      case STATE.INTERRUPTED:
        failed += 1;
        break;
      default:
        break;
    }
  }
  return { running, done, failed };
}

const INDENT = "  ";

/** `› ● explore · model · ⏱ 02:34 · 12.4k tok · $0.04 ⚠` */
export function rowLine(row: SubagentRow, now: number): string {
  const parts: string[] = [];
  if (row.model) parts.push(row.model);

  const elapsed = elapsedMs(row, now);
  if (elapsed !== undefined) parts.push(`⏱ ${formatDuration(elapsed)}`);

  if (row.tokens !== undefined && row.tokens > 0) parts.push(`${formatTokens(row.tokens)} tok`);
  if (row.cost !== undefined && row.cost > 0) parts.push(formatCost(row.cost));

  const current = row.isCurrent ? CURRENT_GLYPH : " ";
  const glyph = MARKERS[stateOf(row, now)].glyph;
  const indent = INDENT.repeat(Math.max(0, row.depth - 1));
  const meta = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
  const pending = row.needsPermission ? ` ${PERMISSION_GLYPH}` : "";

  return `${current} ${glyph} ${indent}${row.label}${meta}${pending}`;
}

/** Header counts line: `Subagents  2 run · 1 done · 0 err`. */
export function headerLine(total: SubagentCounts): string {
  return `Subagents  ${total.running} run · ${total.done} done · ${total.failed} err`;
}