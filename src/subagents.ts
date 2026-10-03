/**
 * Pure selectors for the subagent panel.
 *
 * No TUI imports and no plugin context: lookups are injected as parameters and
 * every field degrades to `undefined` instead of throwing, so the data layer can
 * be mid-invalidation while the panel re-renders.
 */

import {
  STATE,
  deriveState,
  elapsedMs,
  finite,
  formatCost,
  formatDuration,
  formatExactTokens,
  formatPercent,
  rowLabel,
} from "./format.js";
import type { Outcome, SessionLike, SessionStatus, SessionTime, State } from "./format.js";
import { CURRENT_GLYPH, MARKERS, PERMISSION_GLYPH } from "./theme.js";

/** `SessionLike` plus the row identity the panel needs. */
export interface SubagentSession extends SessionLike {
  readonly id: string;
}

/** One panel line. `time` is the raw record so elapsed and recency agree. */
export interface SubagentRow {
  readonly id: string;
  readonly label: string;
  readonly model?: string;
  /** Input + output, the same total the status line shows. */
  readonly tokens?: number;
  readonly cost?: number;
  /**
   * Context-window occupancy of this session's most recent request. Computed by
   * the panel from that session's message list and rendered last; missing means
   * "not computable yet", so nothing is rendered for it.
   */
  readonly contextPercent?: number;
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
    label: rowLabel(session),
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

/** How many subagents the sidebar widget lists before `/subagents` takes over. */
export const SIDEBAR_LIMIT = 3;

/**
 * The head of the panel's own ordering, for a widget with no room to scroll.
 *
 * `orderRows` decides the ranking — permission-pending first, then running, then
 * the most recent activity — so the sidebar and the panel cannot disagree about
 * which subagent matters most. It is idempotent, so re-ordering already ordered
 * rows changes nothing.
 */
export function topRows(rows: readonly SubagentRow[]): SubagentRow[] {
  return orderRows(rows).slice(0, SIDEBAR_LIMIT);
}

/** Half-open range `[start, end)` of the rows currently shown. */
export interface RowWindow {
  readonly start: number;
  readonly end: number;
}

/**
 * The slice of rows that fits in `capacity`, keeping the cursor inside it.
 *
 * Scroll anchor: the window follows the cursor and moves by the minimum amount
 * necessary — `from` is where it sat last time, so a `j`/`k` step that stays
 * inside the window leaves the visible rows untouched and the list only shifts
 * once the cursor would otherwise leave the panel.
 *
 * `total <= 0` is an empty window; a capacity below one still shows one row,
 * because a panel that fits nothing would hide the cursor it is there to move.
 */
export function rowWindow(total: number, cursor: number, capacity: number, from = 0): RowWindow {
  if (total <= 0) return { start: 0, end: 0 };
  const size = Math.min(Math.max(1, finite(capacity) ?? 0), total);
  const at = Math.min(Math.max(0, finite(cursor) ?? 0), total - 1);
  const last = total - size;
  let start = Math.min(Math.max(0, finite(from) ?? 0), last);
  if (at < start) start = at;
  else if (at >= start + size) start = at - size + 1;
  return { start, end: start + size };
}

/**
 * How many rows fit in `height` lines: the chrome comes off first, then what is
 * left is divided by the lines one row takes. Both costs are parameters rather
 * than constants because the panel spends two lines per row only while the row
 * carries a meta line, and the chrome is whatever this panel happens to draw
 * around the list. Floors, never below one row.
 */
export function rowCapacity(height: number, linesPerRow: number, chromeLines: number): number {
  const perRow = Math.max(1, finite(linesPerRow) ?? 1);
  const chrome = Math.max(0, finite(chromeLines) ?? 0);
  const usable = Math.max(0, (finite(height) ?? 0) - chrome);
  return Math.max(1, Math.floor(usable / perRow));
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
const SEPARATOR = " · ";
/**
 * Label columns available to the wrapped text: the sidebar row is 34 columns
 * wide and the marker, its brackets and the gap take 5. A constant, not an
 * option, because the `sidebar.content` slot publishes no width to measure.
 */
export const LABEL_WIDTH = 29;
/** Continuation lines line up under the label, not under the marker. */
export const LABEL_INDENT = "    ";
/** A label gets one continuation line, as the reference sidebar does. */
const LABEL_LABEL_LINES = 2;

/** Columns, counted in code points so a cut never lands mid-character. */
function columns(chars: readonly string[]): number {
  return chars.length;
}

/**
 * A label as at most `maxLines` lines, each at most `width` columns, every line
 * after the first prefixed with `indent`.
 *
 * Whitespace runs collapse and the ends are trimmed first, so the width is spent
 * on content. Greedy: while the remainder still overflows and there is room for
 * another line, it is cut at the last space that fits — never mid-word, so a
 * single word longer than the width becomes its own line. Whatever is left for
 * the final line is ellipsized if it still overflows, which is also how content
 * past `maxLines` is dropped.
 *
 * A non-positive `width` or fewer than two lines cannot be wrapped at all, so
 * both return the text on one line, intact.
 *
 * ponytail: columns are code points, not terminal cells, so wide CJK and emoji
 * are under-counted and such a label can overflow its line. Upgrade path: a
 * per-character width table (`characterWidth`) the way the reference plugin
 * counts, called from `columns`.
 */
export function wrapLabel(
  value: string,
  width: number,
  maxLines: number,
  indent: string,
): string[] {
  const chars = Array.from(value.replace(/\s+/g, " ").trim());
  if (chars.length === 0) return [""];
  if (!(width >= 1) || !(maxLines >= 2)) return [chars.join("")];

  const lines: string[] = [];
  let rest = chars;
  while (columns(rest) > width && lines.length < maxLines - 1) {
    // The last space strictly inside the width; the text is trimmed, so index 0
    // is never a space and this always makes progress.
    let cut = 0;
    for (let index = width - 1; index > 0; index -= 1) {
      if (rest[index] === " ") {
        cut = index;
        break;
      }
    }
    // No space to cut at: keep the whole word rather than splitting it.
    if (cut === 0) break;
    lines.push(rest.slice(0, cut).join(""));
    rest = rest.slice(cut + 1);
  }

  const last = rest.length > width ? `${rest.slice(0, width - 1).join("")}…` : rest.join("");
  return [...lines, last].map((line, index) => (index === 0 ? line : `${indent}${line}`));
}
/**
 * Columns the label starts at — `› ` plus `[x] ` — so the meta line lands
 * directly under the label of the same row. Also what a caller must subtract from
 * its own width to know how many columns the label text itself may use.
 */
export const LABEL_COLUMN = 6;

/**
 * A row as two lines instead of one string: the panel needs separate nodes to
 * give the label its state color and the metrics a single subdued one.
 *
 * `state` is what the label line is colored from, returned by the same call
 * that built the line so the two cannot disagree.
 */
export interface RowParts {
  readonly state: State;
  /** One entry per line: the marker line, then one per wrapped continuation. */
  readonly label: readonly string[];
  /** `""` when the row has no metric at all, so the panel prints one line. */
  readonly meta: string;
}

/**
 * The knobs a caller has on a row. The panel and the sidebar render the same row,
 * and every difference between them is room: the sidebar is narrow and shows
 * three lines, so it wraps tighter and asks for the row without its cost or
 * model; the panel knows its own width and passes it in.
 *
 * Both fields default to today's behaviour, so a caller that says nothing gets
 * the row exactly as it was.
 */
export interface RowPartsOptions {
  /** Render the cost segment. Default `true`. */
  readonly cost?: boolean;
  /** Render the model on the label line. Default `true`. */
  readonly model?: boolean;
  /** Columns the label may use before it wraps. Default `LABEL_WIDTH`. */
  readonly labelWidth?: number;
}

/** One header count plus the token that colors it. */
export interface HeaderSegment {
  readonly text: string;
  readonly token: string;
  readonly fallback: string;
}

function headerSegment(noun: string, state: State, count: number): HeaderSegment {
  const marker = MARKERS[state];
  return { text: `${marker.glyph} ${count} ${noun}`, token: marker.token, fallback: marker.fallback };
}

/**
 * The row's label lines — a state-colored `› [✓] explore · model`, wrapped to
 * `LABEL_WIDTH` with continuations indented — and a subdued
 * `↳ ⏱ 02:34  19,212 tok · $0.04 · 37% ctx` metrics line indented under the
 * label. The permission marker stays on the label: it is a state signal, not a
 * metric, and it rides at the end of the **last** label line so it cannot be
 * pushed off the row by a wrap.
 */
export function rowParts(row: SubagentRow, now: number, options?: RowPartsOptions): RowParts {
  const state = stateOf(row, now);
  const depth = Math.max(0, row.depth - 1);

  const current = row.isCurrent ? CURRENT_GLYPH : " ";
  // `model: false` drops the model segment and nothing else: a narrow row that
  // wraps still names the subagent, it just cannot also name its model.
  const label = row.model && options?.model !== false
    ? `${row.label}${SEPARATOR}${row.model}`
    : row.label;
  const pending = row.needsPermission ? ` ${PERMISSION_GLYPH}` : "";
  const marker = `${current} ${MARKERS[state].bracketed} ${INDENT.repeat(depth)}`;
  // `??` keeps an explicit width, including a nonsensical one: `wrapLabel` already
  // degrades a non-positive width to one unwrapped line rather than throwing, and
  // re-deciding the default here would hide that from its own tests.
  const wrapped = wrapLabel(label, options?.labelWidth ?? LABEL_WIDTH, LABEL_LABEL_LINES, LABEL_INDENT);
  const last = wrapped.length - 1;
  const labelLines = wrapped.map((line, index) =>
    `${index === 0 ? marker : ""}${line}${index === last ? pending : ""}`,
  );

  const elapsed = elapsedMs(row, now);
  // `finite` first: `NaN <= 0` and `Infinity > 0` are both true/false in ways
  // that would let a non-finite count reach the formatter and print `0 tok`.
  const tokenCount = finite(row.tokens);
  // Elapsed and tokens lead the line and carry the wider gap; whatever else
  // exists joins with the shared separator.
  const head = [
    elapsed === undefined ? "" : `⏱ ${formatDuration(elapsed)}`,
    tokenCount === undefined || tokenCount <= 0 ? "" : `${formatExactTokens(tokenCount)} tok`,
  ].filter((part) => part !== "").join("  ");

  const rest: string[] = [];
  // `cost: false` drops one segment and nothing else, so a row that had nothing
  // but a cost ends up with no meta line at all.
  if (row.cost !== undefined && row.cost > 0 && options?.cost !== false) rest.push(formatCost(row.cost));
  // Last segment, same position as the status line's: occupancy is the
  // freshest number on the row.
  const percent = finite(row.contextPercent);
  if (percent !== undefined) rest.push(`${formatPercent(percent)}% ctx`);

  // `↳` leads the line, so the first segment carries it whether it is the head
  // or a cost/occupancy the row has no clock or tokens for.
  const segments = head === "" ? rest : [head, ...rest];
  const metaLine = segments.length === 0
    ? ""
    : `${" ".repeat(LABEL_COLUMN + INDENT.length * depth)}↳ ${segments.join(SEPARATOR)}`;

  return { state, label: labelLines, meta: metaLine };
}

/** Arrow glyphs for a collapsible header title, as the reference plugin uses. */
const TITLE_EXPANDED = "▾";
const TITLE_COLLAPSED = "▸";

/**
 * A collapsible header's title line: `▾ Subagents` open, `▸ Subagents` closed.
 *
 * No title means no title line at all — the counts stand alone, which is how the
 * panel renders it, and returning `""` rather than a lone arrow keeps a caller
 * from drawing a clickable nothing.
 */
export function headerTitle(title: string, expanded: boolean): string {
  const text = title.trim();
  if (text === "") return "";
  return `${expanded ? TITLE_EXPANDED : TITLE_COLLAPSED} ${text}`;
}

/**
 * Whether the sidebar draws its subagent rows: only when the user has it open
 * *and* there is something to show.
 *
 * Both halves matter, and in this order. With no subagents there is no widget at
 * all rather than a collapsed one — a collapsed header in a session that never
 * spawned anything is indistinguishable from the widget being broken, which is
 * exactly the confusion this sidebar has already caused.
 */
export function drawsSidebarRows(expanded: boolean, hasRows: boolean): boolean {
  return expanded && hasRows;
}

/** Header counts as three separately colored segments: `● 2 run`, `✓ 1 done`, `✕ 0 err`. */
export function headerSegments(total: SubagentCounts): HeaderSegment[] {
  return [
    headerSegment("run", STATE.RUNNING, total.running),
    headerSegment("done", STATE.DONE, total.done),
    headerSegment("err", STATE.ERROR, total.failed),
  ];
}

/** `headerLine`: the counts the panel colors and the footer prints, as one string. */
export function headerLine(total: SubagentCounts): string {
  return headerSegments(total)
    .map((segment) => segment.text)
    .join(SEPARATOR);
}

/**
 * `headerLine`, or `undefined` when the root has no subagent to report — the
 * footer says exactly what the panel header says rather than a second shape.
 *
 * A permanent counter is acceptable here because it only appears for sessions
 * that actually spawned subagents, and it restates counts the panel already
 * shows instead of adding new information.
 */
export function footerText(total: SubagentCounts): string | undefined {
  return total.running + total.done + total.failed > 0 ? headerLine(total) : undefined;
}