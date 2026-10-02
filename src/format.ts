/**
 * Pure formatting helpers for the subagent status line.
 *
 * No TUI imports on purpose: this module is unit tested in isolation and is the
 * only place that decides what the one-line status bar says.
 */

/** Lifecycle state of the subagent session being displayed. */
const STATE = {
  RUNNING: "running",
  IDLE: "idle",
  DONE: "done",
  ERROR: "error",
  INTERRUPTED: "interrupted",
  UNKNOWN: "unknown",
} as const;

/** Re-exported so callers switch on named states instead of bare strings. */
export { STATE };

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
  readonly variant?: string;
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
  /** USD already spent. Zero and non-finite values render as no segment. */
  readonly cost?: number;
  /**
   * Context-window occupancy of the session's most recent request, already
   * computed by the caller (`src/context.ts` owns the math). Missing means
   * "not computable yet", so no segment is rendered rather than a `0`.
   */
  readonly contextPercent?: number;
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

export { finite };

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

/** USD with two decimals: `$0.00`, `$0.04`, `$12.30`. Non-numbers clamp to zero. */
export function formatCost(usd: number): string {
  const value = finite(usd);
  if (value === undefined || value < 0) return "$0.00";
  return `$${value.toFixed(2)}`;
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

/**
 * Exact token count with thousands separators: `0`, `999`, `19,212`,
 * `1,234,567`. For the panel row, which has a line of its own for the metrics and
 * so no reason to abbreviate; the status line keeps the compact `formatTokens`.
 *
 * The locale is pinned so the separators never follow the host's locale.
 */
export function formatExactTokens(n: number): string {
  return Math.max(0, Math.round(finite(n) ?? 0)).toLocaleString("en-US");
}

/**
 * Whole percent, no decimals: `0`, `37`, `128`. Halfway rounds up, and
 * non-numbers read as `0` like the other formatters do.
 *
 * Nothing is clamped: a session that genuinely overflowed its context window
 * should say so instead of showing a reassuring `100`.
 */
export function formatPercent(percent: number): string {
  return String(Math.round(finite(percent) ?? 0));
}

/** Narrowest shape that decides a state: satisfied by records and rows alike. */
interface OutcomeCarrier {
  readonly outcome?: Outcome;
}

/**
 * `outcome` wins: it is the server's verdict and the only source of a terminal
 * state. Without it the live `status` is authoritative, so an `idle` session is
 * reported as idle instead of being lumped in with unknown. Only a missing
 * status — or an outcome string this build does not know — is `unknown`.
 */
function deriveState(session: OutcomeCarrier, status: SessionStatus | undefined): State {
  const outcome = session.outcome;
  if (outcome !== undefined) return OUTCOME_STATE[outcome] ?? STATE.UNKNOWN;
  if (status === "running") return STATE.RUNNING;
  return status === "idle" ? STATE.IDLE : STATE.UNKNOWN;
}

export { deriveState };

/**
 * Elapsed wall time. While the subagent runs it tracks `now`; once an `outcome`
 * is present the clock freezes at `time.idle ?? time.updated`.
 */
function elapsedMs(session: OutcomeCarrier & { readonly time?: SessionTime }, now: number): number | undefined {
  const created = finite(session.time?.created);
  if (created === undefined) return undefined;
  const end = session.outcome !== undefined
    ? finite(session.time?.idle) ?? finite(session.time?.updated) ?? now
    : now;
  return end - created;
}

export { elapsedMs };

/**
 * `anthropic/claude-sonnet-4-6`, or `claude-sonnet-4-6` without a provider,
 * plus the variant when present. Ids that already carry the provider are left
 * alone so the prefix is never printed twice.
 */
export function formatModel(model: SessionModel | undefined): string | undefined {
  const id = model?.id;
  if (!id) return undefined;
  const provider = model?.providerID;
  const qualified = provider && !id.startsWith(`${provider}/`) ? `${provider}/${id}` : id;
  return model?.variant ? `${qualified} (${model.variant})` : qualified;
}

/** The one record a label is made of: the task title and the agent name. */
export interface RowLabelLike {
  readonly agent?: string;
  readonly title?: string;
}

/** An agent name that names no kind of subagent, so it is noise in a label. */
const GENERIC_AGENT = "code";

/**
 * What a subagent is called, for every surface that shows one: the task it was
 * given, plus the agent that ran it.
 *
 * Subagents of one agent share its name, so the agent alone cannot tell two of
 * them apart and the title — the only thing that can — is what distinguishes a
 * row from its sibling. Precedence:
 *
 * - `title (agent)` when both exist and the title does not already name the
 *   agent. Containment is a plain case-insensitive substring, so "rerun" does
 *   not count as naming `general` while "generalization" does.
 * - The title alone when it already names the agent, or when there is no usable
 *   agent — which includes the literal `code`, the generic name that
 *   distinguishes nothing.
 * - The agent alone when there is no title, and `DEFAULT_LABEL` when neither
 *   survives.
 *
 * Lives here, not next to the panel selectors, so the status line and the panel
 * rows can share it without one importing the other.
 */
export function rowLabel(session: RowLabelLike): string {
  const title = session.title?.trim() ?? "";
  const named = session.agent?.trim() ?? "";
  const agent = named === GENERIC_AGENT ? "" : named;

  if (title === "") return agent !== "" ? agent : DEFAULT_LABEL;
  if (agent === "") return title;
  return title.toLowerCase().includes(agent.toLowerCase()) ? title : `${title} (${agent})`;
}

/** Build the label, the ordered segments and the joined one-line text. */
export function buildSummary(
  session: SessionLike,
  now: number,
  status?: SessionStatus,
): Summary {
  const parts: string[] = [];

  const model = formatModel(session.model);
  if (model !== undefined) parts.push(model);

  const elapsed = elapsedMs(session, now);
  if (elapsed !== undefined) parts.push(`⏱ ${formatDuration(elapsed)}`);

  const tokens = session.tokens;
  const tokenTotal = tokens
    ? (finite(tokens.input) ?? 0) + (finite(tokens.output) ?? 0)
    : 0;
  if (tokenTotal > 0) parts.push(`${formatTokens(tokenTotal)} tok`);

  // Same gate as tokens: a spent-less session gets no `$0.00` filler.
  const cost = finite(session.cost);
  if (cost !== undefined && cost > 0) parts.push(formatCost(cost));

  // Last segment: occupancy is the freshest number, so it reads at the end.
  const percent = finite(session.contextPercent);
  if (percent !== undefined) parts.push(`${formatPercent(percent)}% ctx`);

  const label = rowLabel(session);

  return {
    state: deriveState(session, status),
    label,
    parts,
    text: parts.join(SEPARATOR),
  };
}