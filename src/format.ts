/**
 * Pure formatting helpers for the subagent status line.
 *
 * No TUI imports on purpose: this module is unit tested in isolation and is the
 * only place that decides what the one-line status bar says.
 */

/** Lifecycle state of the subagent session being displayed. */
const STATE = {
  RUNNING: "running",
  DONE: "done",
  ERROR: "error",
  INTERRUPTED: "interrupted",
  UNKNOWN: "unknown",
} as const;

export type State = (typeof STATE)[keyof typeof STATE];

/** Terminal outcome reported by the server, once the subagent finished. */
const OUTCOME_STATE = {
  succeeded: STATE.DONE,
  failed: STATE.ERROR,
  interrupted: STATE.INTERRUPTED,
} as const;

export type Outcome = keyof typeof OUTCOME_STATE;

export type SessionStatus = "idle" | "running";

export const DEFAULT_LABEL = "subagent";

export interface SessionModel {
  readonly id: string;
  readonly providerID?: string;
}

export interface SessionTokens {
  readonly input: number;
  readonly output: number;
}

export interface SessionTime {
  readonly created: number;
  readonly updated: number;
  readonly idle?: number;
}

/**
 * Structural subset of `SessionInfo` from the v2 data layer. Every field is
 * optional so partial/legacy records degrade instead of throwing.
 */
export interface SessionLike {
  readonly parentID?: string;
  readonly agent?: string;
  readonly title?: string;
  readonly outcome?: Outcome;
  readonly model?: SessionModel;
  readonly tokens?: SessionTokens;
  readonly time?: SessionTime;
}

export interface Summary {
  readonly state: State;
  readonly label: string;
  readonly parts: string[];
  readonly text: string;
}

const SEPARATOR = " · ";

interface TokenUnit {
  readonly size: number;
  readonly suffix: string;
}

/** Descending by size: the first entry at or below the count wins. */
const TOKEN_UNITS: readonly TokenUnit[] = [
  { size: 1e9, suffix: "B" },
  { size: 1e6, suffix: "M" },
  { size: 1e3, suffix: "k" },
];

function finite(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `mm:ss`, widening to `hh:mm:ss` past one hour. Negatives clamp to zero. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor((finite(ms) ?? 0) / 1e3));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * Compact token count: `999`, `1.2k`, `12.4k`, `1.2M`, `1.0B`.
 *
 * One decimal can round up across a unit boundary, so the unit is promoted
 * instead of printing a lying suffix: 999_999 -> `1.0M`, never `1000.0k`.
 * ponytail: `B` is the top tier; counts >= 1e12 stay in `B` (add a `T` tier if
 * real sessions ever get there).
 */
export function formatTokens(n: number): string {
  const total = Math.max(0, Math.floor(finite(n) ?? 0));
  let index = TOKEN_UNITS.findIndex((unit) => total >= unit.size);
  if (index < 0) return String(total);
  if (index > 0 && Number((total / TOKEN_UNITS[index].size).toFixed(1)) >= 1000) index -= 1;
  const unit = TOKEN_UNITS[index];
  return `${(total / unit.size).toFixed(1)}${unit.suffix}`;
}

function deriveState(session: SessionLike, status: SessionStatus | undefined): State {
  const outcome = session.outcome;
  if (outcome !== undefined) return OUTCOME_STATE[outcome] ?? STATE.UNKNOWN;
  return status === "running" ? STATE.RUNNING : STATE.UNKNOWN;
}

/**
 * Elapsed wall time. While the subagent runs it tracks `now`; once an `outcome`
 * is present the clock freezes at `time.idle ?? time.updated`.
 */
function elapsedMs(session: SessionLike, now: number): number | undefined {
  const created = finite(session.time?.created);
  if (created === undefined) return undefined;
  const end = session.outcome !== undefined
    ? finite(session.time?.idle) ?? finite(session.time?.updated) ?? now
    : now;
  return end - created;
}

/** Build the label, the ordered segments and the joined one-line text. */
export function buildSummary(
  session: SessionLike,
  now: number,
  status?: SessionStatus,
): Summary {
  const parts: string[] = [];

  const modelID = session.model?.id;
  if (modelID) parts.push(modelID);

  const elapsed = elapsedMs(session, now);
  if (elapsed !== undefined) parts.push(`⏱ ${formatDuration(elapsed)}`);

  const tokens = session.tokens;
  const tokenTotal = tokens
    ? (finite(tokens.input) ?? 0) + (finite(tokens.output) ?? 0)
    : 0;
  if (tokenTotal > 0) parts.push(`${formatTokens(tokenTotal)} tok`);

  const label = session.agent?.trim() || session.title?.trim() || DEFAULT_LABEL;

  return {
    state: deriveState(session, status),
    label,
    parts,
    text: parts.join(SEPARATOR),
  };
}