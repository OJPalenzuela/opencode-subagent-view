// src/tui.tsx
import { createComponent as _$createComponent4 } from "@opentui/solid";
import { effect as _$effect4 } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { insert as _$insert4 } from "@opentui/solid";
import { setProp as _$setProp4 } from "@opentui/solid";
import { createElement as _$createElement4 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { Show as Show4, createEffect as createEffect3, createMemo as createMemo4, createSignal as createSignal3, onCleanup as onCleanup3 } from "solid-js";

// src/format.ts
var STATE = {
  RUNNING: "running",
  IDLE: "idle",
  DONE: "done",
  ERROR: "error",
  INTERRUPTED: "interrupted",
  UNKNOWN: "unknown"
};
var OUTCOME_STATE = {
  succeeded: STATE.DONE,
  failed: STATE.ERROR,
  interrupted: STATE.INTERRUPTED
};
var DEFAULT_LABEL = "subagent";
var SEPARATOR = " \xB7 ";
var TOKEN_UNITS = [
  { size: 1e9, suffix: "B" },
  { size: 1e6, suffix: "M" },
  { size: 1e3, suffix: "k" }
];
function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function pad2(value) {
  return String(value).padStart(2, "0");
}
function formatDuration(ms) {
  const total = Math.max(0, Math.floor((finite(ms) ?? 0) / 1e3));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return hours > 0 ? `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`;
}
function formatCost(usd) {
  const value = finite(usd);
  if (value === void 0 || value < 0) return "$0.00";
  return `$${value.toFixed(2)}`;
}
function formatTokens(n) {
  const total = Math.max(0, Math.floor(finite(n) ?? 0));
  let index = TOKEN_UNITS.findIndex((unit2) => total >= unit2.size);
  if (index < 0) return String(total);
  if (index > 0 && Number((total / TOKEN_UNITS[index].size).toFixed(1)) >= 1e3) index -= 1;
  const unit = TOKEN_UNITS[index];
  return `${(total / unit.size).toFixed(1)}${unit.suffix}`;
}
function formatExactTokens(n) {
  return Math.max(0, Math.round(finite(n) ?? 0)).toLocaleString("en-US");
}
function formatPercent(percent) {
  return String(Math.round(finite(percent) ?? 0));
}
function deriveState(session, status) {
  const outcome = session.outcome;
  if (outcome !== void 0) return OUTCOME_STATE[outcome] ?? STATE.UNKNOWN;
  if (status === "running") return STATE.RUNNING;
  return status === "idle" ? STATE.IDLE : STATE.UNKNOWN;
}
function elapsedMs(session, now) {
  const created = finite(session.time?.created);
  if (created === void 0) return void 0;
  const end = session.outcome !== void 0 ? finite(session.time?.idle) ?? finite(session.time?.updated) ?? now : now;
  return end - created;
}
function formatModel(model) {
  const id = model?.id;
  if (!id) return void 0;
  const provider = model?.providerID;
  const qualified = provider && !id.startsWith(`${provider}/`) ? `${provider}/${id}` : id;
  return model?.variant ? `${qualified} (${model.variant})` : qualified;
}
var GENERIC_AGENT = "code";
function rowLabel(session) {
  const title = session.title?.trim() ?? "";
  const named = session.agent?.trim() ?? "";
  const agent = named === GENERIC_AGENT ? "" : named;
  if (title === "") return agent !== "" ? agent : DEFAULT_LABEL;
  if (agent === "") return title;
  return title.toLowerCase().includes(agent.toLowerCase()) ? title : `${title} (${agent})`;
}
function buildSummary(session, now, status) {
  const parts = [];
  const model = formatModel(session.model);
  if (model !== void 0) parts.push(model);
  const elapsed = elapsedMs(session, now);
  if (elapsed !== void 0) parts.push(`\u23F1 ${formatDuration(elapsed)}`);
  const tokens = session.tokens;
  const tokenTotal3 = tokens ? (finite(tokens.input) ?? 0) + (finite(tokens.output) ?? 0) : 0;
  if (tokenTotal3 > 0) parts.push(`${formatTokens(tokenTotal3)} tok`);
  const cost = finite(session.cost);
  if (cost !== void 0 && cost > 0) parts.push(formatCost(cost));
  const percent = finite(session.contextPercent);
  if (percent !== void 0) parts.push(`${formatPercent(percent)}% ctx`);
  const label = rowLabel(session);
  return {
    state: deriveState(session, status),
    label,
    parts,
    text: parts.join(SEPARATOR)
  };
}

// src/context.ts
function idOf(model, id) {
  return model?.id === id || model?.modelID === id;
}
function findModelInfo(models, ref) {
  if (!Array.isArray(models) || models.length === 0) return void 0;
  const id = ref?.id;
  if (typeof id !== "string" || id === "") return void 0;
  const provider = ref?.providerID;
  if (typeof provider === "string" && provider !== "") {
    const exact = models.find((model) => model?.providerID === provider && idOf(model, id));
    if (exact) return exact;
  }
  return models.find((model) => idOf(model, id));
}
function lastRequest(messages) {
  if (!Array.isArray(messages)) return void 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "assistant") continue;
    if (typeof message.tokens !== "object" || message.tokens === null) continue;
    return message;
  }
  return void 0;
}
function contextUsage(messages, limit) {
  const max = finite(limit);
  if (max === void 0 || max <= 0) return void 0;
  const request = lastRequest(messages);
  const tokens = request?.tokens;
  if (!tokens) return void 0;
  const used = (finite(tokens.input) ?? 0) + (finite(tokens.output) ?? 0) + (finite(tokens.reasoning) ?? 0) + (finite(tokens.cache?.read) ?? 0) + (finite(tokens.cache?.write) ?? 0);
  return { used, limit: max, percent: Math.round(used / max * 100) };
}
function usagePercent(models, messages) {
  return contextUsage(messages, findModelInfo(models, lastRequest(messages)?.model)?.limit?.context)?.percent;
}
var SYNCED_MESSAGES = /* @__PURE__ */ new Set();
function ensureMessages(context, sessionID) {
  if (!sessionID || SYNCED_MESSAGES.has(sessionID)) return;
  SYNCED_MESSAGES.add(sessionID);
  try {
    void context.data.session.message.sync(sessionID).catch(() => {
      SYNCED_MESSAGES.delete(sessionID);
    });
  } catch {
    SYNCED_MESSAGES.delete(sessionID);
  }
}
var SYNCED_PERMISSIONS = /* @__PURE__ */ new Set();
function ensureSessions(context, sessionIDs) {
  for (const sessionID of sessionIDs) {
    if (!sessionID || SYNCED_PERMISSIONS.has(sessionID)) continue;
    SYNCED_PERMISSIONS.add(sessionID);
    try {
      void context.data.session.permission.sync(sessionID).catch(() => {
        SYNCED_PERMISSIONS.delete(sessionID);
      });
    } catch {
      SYNCED_PERMISSIONS.delete(sessionID);
    }
  }
}
function resetSyncGuards() {
  SYNCED_MESSAGES.clear();
  SYNCED_PERMISSIONS.clear();
}
function rowPercent(context, models, sessionID) {
  if (!sessionID) return void 0;
  try {
    return usagePercent(models, context.data.session.message.list(sessionID) ?? []);
  } catch {
    return void 0;
  }
}

// src/alerts.ts
var EXECUTION_OUTCOMES = {
  "session.execution.succeeded": "succeeded",
  "session.execution.failed": "failed",
  "session.execution.interrupted": "interrupted"
};
function executionOutcome(type) {
  return Object.hasOwn(EXECUTION_OUTCOMES, type) ? EXECUTION_OUTCOMES[type] : void 0;
}
function isSubagentSession(record) {
  if (typeof record !== "object" || record === null) return false;
  const parentID = record.parentID;
  return typeof parentID === "string" && parentID.trim() !== "";
}
function tokenTotal(session) {
  const tokens = session.tokens;
  if (!tokens) return void 0;
  return (finite(tokens.input) ?? 0) + (finite(tokens.output) ?? 0);
}
function finishedRow(sessionID, session, outcome, depth) {
  return {
    id: sessionID,
    label: rowLabel(session),
    model: session.model?.id,
    tokens: tokenTotal(session),
    cost: finite(session.cost),
    time: session.time,
    outcome,
    status: void 0,
    needsPermission: false,
    isCurrent: false,
    depth: Math.max(1, depth)
  };
}
function seenExecution(seen, sessionID, eventID) {
  const previous = seen.get(sessionID);
  seen.set(sessionID, eventID ?? "");
  return eventID === void 0 || eventID === "" || previous !== eventID;
}
function finishedMessage(row, now) {
  const parts = [row.outcome];
  const elapsed = elapsedMs(row, now);
  if (elapsed !== void 0) parts.push(`\u23F1 ${formatDuration(elapsed)}`);
  if (row.tokens !== void 0 && row.tokens > 0) parts.push(`${formatTokens(row.tokens)} tok`);
  if (row.cost !== void 0 && row.cost > 0) parts.push(formatCost(row.cost));
  return parts.join(" \xB7 ");
}

// src/commands.ts
var COMMAND_IDS = {
  openPanel: "subagent-view.panel.open",
  nextRow: "subagent-view.panel.next",
  previousRow: "subagent-view.panel.previous",
  enterRow: "subagent-view.panel.enter",
  toggleCompleted: "subagent-view.panel.completed",
  toggleFullscreen: "subagent-view.panel.fullscreen",
  closePanel: "subagent-view.panel.close"
};

// src/footer.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createMemo, Show } from "solid-js";

// src/theme.ts
var SUBDUED_TOKEN = "text.subdued";
var SUBDUED_FALLBACK = "#546e7a";
var WARNING_TOKEN = "text.feedback.warning.default";
var WARNING_FALLBACK = "#ffcb6b";
var SELECTED_TOKEN = "text.action.primary.selected";
var SELECTED_FALLBACK = "#82aaff";
var MARKERS = {
  running: { glyph: "\u25CF", bracketed: "[ ]", token: WARNING_TOKEN, fallback: WARNING_FALLBACK },
  idle: { glyph: "\u25CC", bracketed: "[\u25CC]", token: SUBDUED_TOKEN, fallback: SUBDUED_FALLBACK },
  done: { glyph: "\u2713", bracketed: "[\u2713]", token: "text.feedback.success.default", fallback: "#c3e88d" },
  error: { glyph: "\u2715", bracketed: "[\u2715]", token: "text.feedback.error.default", fallback: "#f07178" },
  interrupted: { glyph: "\u2298", bracketed: "[\u2298]", token: SUBDUED_TOKEN, fallback: SUBDUED_FALLBACK },
  unknown: { glyph: "\u25CB", bracketed: "[\u25CB]", token: SUBDUED_TOKEN, fallback: SUBDUED_FALLBACK }
};
var PERMISSION_GLYPH = "\u26A0";
var CURRENT_GLYPH = "\u203A";
function colorToHex(value) {
  if (typeof value === "string") return value;
  const buffer = value?.buffer;
  if (!Array.isArray(buffer)) return void 0;
  const pair = (channel) => Math.max(0, Math.min(255, Math.round(Number(channel) || 0))).toString(16).padStart(2, "0");
  return `#${pair(buffer[0])}${pair(buffer[1])}${pair(buffer[2])}`;
}
function resolveFg(context, tokenPath, fallback) {
  try {
    const value = tokenPath.split(".").reduce((acc, key) => acc?.[key], context.theme);
    return colorToHex(value) ?? fallback;
  } catch {
    return fallback;
  }
}

// src/subagents.ts
var FINISHED = /* @__PURE__ */ new Set([
  STATE.DONE,
  STATE.ERROR,
  STATE.INTERRUPTED
]);
function lookup(read, id, fallback) {
  if (!read) return fallback;
  try {
    return read(id) ?? fallback;
  } catch {
    return fallback;
  }
}
function byId(sessions) {
  const map = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    if (session && typeof session.id === "string" && session.id !== "") map.set(session.id, session);
  }
  return map;
}
function rootOf(index, currentSessionID) {
  const seen = /* @__PURE__ */ new Set();
  let rootID = currentSessionID;
  let cursor = currentSessionID;
  while (cursor !== void 0 && cursor !== "" && index.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    rootID = cursor;
    cursor = index.get(cursor)?.parentID;
  }
  return rootID;
}
function tokenTotal2(session) {
  const tokens = session.tokens;
  if (!tokens) return void 0;
  return (finite(tokens.input) ?? 0) + (finite(tokens.output) ?? 0);
}
function toRow(session, depth, currentSessionID, getStatus, needsPermission) {
  return {
    id: session.id,
    label: rowLabel(session),
    model: session.model?.id,
    tokens: tokenTotal2(session),
    cost: finite(session.cost),
    time: session.time,
    outcome: session.outcome,
    status: lookup(getStatus, session.id, void 0),
    needsPermission: lookup(needsPermission, session.id, false),
    isCurrent: session.id === currentSessionID,
    depth
  };
}
function collectSubagents(sessions, currentSessionID, getStatus, needsPermission) {
  const index = byId(sessions);
  const children = /* @__PURE__ */ new Map();
  for (const session of index.values()) {
    const parentID = session.parentID;
    if (parentID === void 0 || parentID === "" || !index.has(parentID)) continue;
    const bucket = children.get(parentID);
    if (bucket) bucket.push(session);
    else children.set(parentID, [session]);
  }
  const rootID = rootOf(index, currentSessionID);
  const seen = /* @__PURE__ */ new Set([rootID]);
  const rows = [];
  let level = children.get(rootID) ?? [];
  for (let depth = 1; level.length > 0; depth += 1) {
    const next = [];
    for (const session of level) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      rows.push(toRow(session, depth, currentSessionID, getStatus, needsPermission));
      next.push(...children.get(session.id) ?? []);
    }
    level = next;
  }
  return rows;
}
function stateOf(row, _now) {
  return deriveState(row, row.status);
}
function rankOf(row) {
  if (row.needsPermission) return 0;
  return stateOf(row) === STATE.RUNNING ? 1 : 2;
}
function activityOf(row) {
  return finite(row.time?.updated) ?? 0;
}
function orderRows(rows) {
  return [...rows].sort((a, b) => rankOf(a) - rankOf(b) || activityOf(b) - activityOf(a));
}
function visibleRows(rows, showCompleted) {
  if (showCompleted) return [...rows];
  return rows.filter((row) => !FINISHED.has(stateOf(row)));
}
var SIDEBAR_LIMIT = 3;
function topRows(rows) {
  return orderRows(rows).slice(0, SIDEBAR_LIMIT);
}
function rowWindow(total, cursor, capacity, from = 0) {
  if (total <= 0) return { start: 0, end: 0 };
  const size = Math.min(Math.max(1, finite(capacity) ?? 0), total);
  const at = Math.min(Math.max(0, finite(cursor) ?? 0), total - 1);
  const last = total - size;
  let start = Math.min(Math.max(0, finite(from) ?? 0), last);
  if (at < start) start = at;
  else if (at >= start + size) start = at - size + 1;
  return { start, end: start + size };
}
function rowCapacity(height, linesPerRow, chromeLines) {
  const perRow = Math.max(1, finite(linesPerRow) ?? 1);
  const chrome = Math.max(0, finite(chromeLines) ?? 0);
  const usable = Math.max(0, (finite(height) ?? 0) - chrome);
  return Math.max(1, Math.floor(usable / perRow));
}
function counts(rows) {
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
var INDENT = "  ";
var SEPARATOR2 = " \xB7 ";
var LABEL_WIDTH = 29;
var LABEL_INDENT = "    ";
var LABEL_LABEL_LINES = 2;
function columns(chars) {
  return chars.length;
}
function wrapLabel(value, width, maxLines, indent) {
  const chars = Array.from(value.replace(/\s+/g, " ").trim());
  if (chars.length === 0) return [""];
  if (!(width >= 1) || !(maxLines >= 2)) return [chars.join("")];
  const lines = [];
  let rest = chars;
  while (columns(rest) > width && lines.length < maxLines - 1) {
    let cut = 0;
    for (let index = width - 1; index > 0; index -= 1) {
      if (rest[index] === " ") {
        cut = index;
        break;
      }
    }
    if (cut === 0) break;
    lines.push(rest.slice(0, cut).join(""));
    rest = rest.slice(cut + 1);
  }
  const last = rest.length > width ? `${rest.slice(0, width - 1).join("")}\u2026` : rest.join("");
  return [...lines, last].map((line, index) => index === 0 ? line : `${indent}${line}`);
}
var LABEL_COLUMN = 6;
function headerSegment(noun, state, count) {
  const marker = MARKERS[state];
  return { text: `${marker.glyph} ${count} ${noun}`, token: marker.token, fallback: marker.fallback };
}
function rowParts(row, now, options) {
  const state = stateOf(row, now);
  const depth = Math.max(0, row.depth - 1);
  const current = row.isCurrent ? CURRENT_GLYPH : " ";
  const label = row.model && options?.model !== false ? `${row.label}${SEPARATOR2}${row.model}` : row.label;
  const pending = row.needsPermission ? ` ${PERMISSION_GLYPH}` : "";
  const marker = `${current} ${MARKERS[state].bracketed} ${INDENT.repeat(depth)}`;
  const wrapped = wrapLabel(label, options?.labelWidth ?? LABEL_WIDTH, LABEL_LABEL_LINES, LABEL_INDENT);
  const last = wrapped.length - 1;
  const labelLines = wrapped.map(
    (line, index) => `${index === 0 ? marker : ""}${line}${index === last ? pending : ""}`
  );
  const elapsed = elapsedMs(row, now);
  const tokenCount = finite(row.tokens);
  const head = [
    elapsed === void 0 ? "" : `\u23F1 ${formatDuration(elapsed)}`,
    tokenCount === void 0 || tokenCount <= 0 ? "" : `${formatExactTokens(tokenCount)} tok`
  ].filter((part) => part !== "").join("  ");
  const rest = [];
  if (row.cost !== void 0 && row.cost > 0 && options?.cost !== false) rest.push(formatCost(row.cost));
  const percent = finite(row.contextPercent);
  if (percent !== void 0) rest.push(`${formatPercent(percent)}% ctx`);
  const segments = head === "" ? rest : [head, ...rest];
  const metaLine = segments.length === 0 ? "" : `${" ".repeat(LABEL_COLUMN + INDENT.length * depth)}\u21B3 ${segments.join(SEPARATOR2)}`;
  return { state, label: labelLines, meta: metaLine };
}
var TITLE_EXPANDED = "\u25BE";
var TITLE_COLLAPSED = "\u25B8";
function headerTitle(title, expanded) {
  const text = title.trim();
  if (text === "") return "";
  return `${expanded ? TITLE_EXPANDED : TITLE_COLLAPSED} ${text}`;
}
function drawsSidebarWidget(hasRows) {
  return hasRows;
}
function headerSegments(total) {
  return [
    headerSegment("run", STATE.RUNNING, total.running),
    headerSegment("done", STATE.DONE, total.done),
    headerSegment("err", STATE.ERROR, total.failed)
  ];
}
function headerLine(total) {
  return headerSegments(total).map((segment) => segment.text).join(SEPARATOR2);
}
function footerText(total) {
  return total.running + total.done + total.failed > 0 ? headerLine(total) : void 0;
}

// src/footer.tsx
function safeList(context) {
  try {
    return context.data.session.list() ?? [];
  } catch {
    return [];
  }
}
function SubagentCounter(props) {
  const text = createMemo(() => {
    props.tick();
    const sessionID = props.sessionID;
    if (sessionID === void 0) return void 0;
    return footerText(counts(collectSubagents(safeList(props.context), sessionID)));
  });
  return _$createComponent(Show, {
    get when() {
      return text();
    },
    get children() {
      var _el$ = _$createElement("text");
      _$insert(_el$, text);
      _$effect((_$p) => _$setProp(_el$, "fg", resolveFg(props.context, SUBDUED_TOKEN, SUBDUED_FALLBACK), _$p));
      return _el$;
    }
  });
}
function registerFooter(context, tick) {
  return context.ui.slot({
    // Additive: several claims at one anchor coexist in plugin enable order, so
    // this stacks with the status line when `slot` is also `prompt.footer.status`.
    append: "prompt.footer.status",
    render: (input) => _$createComponent(SubagentCounter, {
      context,
      get sessionID() {
        return input.sessionID;
      },
      tick
    })
  });
}

// src/panel.tsx
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { createEffect, createMemo as createMemo2, createSignal, For, onCleanup, Show as Show2 } from "solid-js";
var PANEL_NAME = "subagent-view.panel";
var PREFS_KEY = "panel";
var ELAPSED_TICK_MS = 1e3;
var ROW_LINES = 2;
var CHROME_LINES = 0;
var FALLBACK_ROWS = 10;
function safeList2(context) {
  try {
    return context.data.session.list() ?? [];
  } catch {
    return [];
  }
}
function safeStatusLookup(context) {
  return (sessionID) => {
    try {
      return context.data.session.status(sessionID);
    } catch {
      return void 0;
    }
  };
}
function safePermissionLookup(context) {
  return (sessionID) => {
    try {
      return (context.data.session.permission.list(sessionID) ?? []).length > 0;
    } catch {
      return false;
    }
  };
}
function safeSync(context, sessionID) {
  try {
    return context.data.session.permission.sync(sessionID).catch(() => {
    });
  } catch {
    return Promise.resolve();
  }
}
function safeModels(context) {
  try {
    return context.data.location.model.list() ?? [];
  } catch {
    return [];
  }
}
function SubagentHeader(props) {
  const segments = createMemo2(() => headerSegments(counts(props.rows)));
  const title = () => headerTitle(props.title ?? "", props.expanded !== false);
  const selected = () => resolveFg(props.context, SELECTED_TOKEN, SELECTED_FALLBACK);
  return (() => {
    var _el$ = _$createElement2("box"), _el$3 = _$createElement2("box");
    _$insertNode(_el$, _el$3);
    _$setProp2(_el$, "flexDirection", "column");
    _$insert2(_el$, _$createComponent2(Show2, {
      get when() {
        return title() !== "";
      },
      get children() {
        var _el$2 = _$createElement2("text");
        _$insert2(_el$2, title);
        _$effect2((_p$) => {
          var _v$ = selected(), _v$2 = props.onToggle;
          _v$ !== _p$.e && (_p$.e = _$setProp2(_el$2, "fg", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$2, "onMouseDown", _v$2, _p$.t));
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$2;
      }
    }), _el$3);
    _$setProp2(_el$3, "flexDirection", "row");
    _$insert2(_el$3, _$createComponent2(For, {
      get each() {
        return segments();
      },
      children: (segment, index) => [_$createComponent2(Show2, {
        get when() {
          return index() > 0;
        },
        get children() {
          var _el$4 = _$createElement2("text");
          _$insertNode(_el$4, _$createTextNode(` \xB7 `));
          _$effect2((_$p) => _$setProp2(_el$4, "fg", resolveFg(props.context, SUBDUED_TOKEN, SUBDUED_FALLBACK), _$p));
          return _el$4;
        }
      }), (() => {
        var _el$6 = _$createElement2("text");
        _$insert2(_el$6, () => segment.text);
        _$effect2((_$p) => _$setProp2(_el$6, "fg", resolveFg(props.context, segment.token, segment.fallback), _$p));
        return _el$6;
      })()]
    }));
    return _el$;
  })();
}
function SubagentPanel(props) {
  const {
    context,
    panel
  } = props;
  const initialPrefs = {
    showCompleted: true
  };
  const [prefs, setPrefs] = context.storage.store(PREFS_KEY, {
    initial: initialPrefs
  });
  const [cursor, setCursor] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  const [viewport, setViewport] = createSignal();
  createEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    onCleanup(() => clearInterval(timer));
  });
  const rows = createMemo2(() => {
    props.tick();
    now();
    const models = safeModels(context);
    const collected = orderRows(visibleRows(collectSubagents(safeList2(context), panel.sessionID, safeStatusLookup(context), safePermissionLookup(context)), prefs.showCompleted));
    return collected.map((row) => ({
      ...row,
      contextPercent: rowPercent(context, models, row.id)
    }));
  });
  createEffect(() => {
    const sessionID = panel.sessionID;
    const ids = [sessionID, ...collectSubagents(safeList2(context), sessionID).map((row) => row.id)];
    for (const id of ids) ensureMessages(context, id);
    ensureSessions(context, ids);
  });
  const stopPermission = context.data.on("permission.asked", (event) => {
    const sessionID = event.data?.sessionID;
    if (!sessionID) return;
    void safeSync(context, sessionID).then(() => props.tick());
  });
  onCleanup(stopPermission);
  const capacity = createMemo2(() => {
    const height = viewport()?.height;
    return typeof height === "number" && height > 0 ? rowCapacity(height, ROW_LINES, CHROME_LINES) : FALLBACK_ROWS;
  });
  let from = 0;
  const view = createMemo2(() => {
    const window = rowWindow(rows().length, Math.max(0, cursor()), capacity(), from);
    from = window.start;
    return window;
  });
  const shown = createMemo2(() => rows().slice(view().start, view().end));
  const lastIndex = () => Math.max(0, rows().length - 1);
  const selected = () => rows()[Math.min(Math.max(0, cursor()), lastIndex())];
  const move = (delta) => setCursor((value) => Math.min(Math.max(0, value + delta), lastIndex()));
  const guarded = (run) => () => {
    if (!panel.focused) return false;
    run();
  };
  context.keymap.layer(() => ({
    mode: "global",
    priority: 100,
    enabled: () => panel.focused,
    commands: [{
      id: COMMAND_IDS.nextRow,
      title: "Next subagent",
      bind: "j",
      run: guarded(() => move(1))
    }, {
      id: COMMAND_IDS.previousRow,
      title: "Previous subagent",
      bind: "k",
      run: guarded(() => move(-1))
    }, {
      id: COMMAND_IDS.enterRow,
      title: "Open the selected subagent session",
      bind: "enter",
      run: guarded(() => {
        const row = selected();
        if (!row) return;
        context.ui.router.navigate({
          type: "session",
          sessionID: row.id
        });
      })
    }, {
      id: COMMAND_IDS.toggleCompleted,
      title: "Toggle completed subagents",
      bind: "c",
      run: guarded(() => {
        void setPrefs((draft) => {
          draft.showCompleted = !draft.showCompleted;
        }).catch(() => {
        });
      })
    }, {
      id: COMMAND_IDS.toggleFullscreen,
      title: "Toggle full screen panel",
      bind: "f",
      run: guarded(() => panel.toggleFullscreen())
    }, {
      id: COMMAND_IDS.closePanel,
      title: "Close the subagents panel",
      bind: "escape",
      run: guarded(() => panel.close())
    }]
  }));
  const subdued = () => resolveFg(context, SUBDUED_TOKEN, SUBDUED_FALLBACK);
  const rowFg = (row, state, index) => {
    if (index === Math.min(cursor(), lastIndex())) {
      return resolveFg(context, SELECTED_TOKEN, SELECTED_FALLBACK);
    }
    if (row.needsPermission) return resolveFg(context, WARNING_TOKEN, WARNING_FALLBACK);
    const marker = MARKERS[state];
    return resolveFg(context, marker.token, marker.fallback);
  };
  return (() => {
    var _el$7 = _$createElement2("box"), _el$9 = _$createElement2("text");
    _$insertNode(_el$7, _el$9);
    _$setProp2(_el$7, "flexDirection", "column");
    _$insert2(_el$7, _$createComponent2(SubagentHeader, {
      context,
      get rows() {
        return rows();
      }
    }), _el$9);
    _$insert2(_el$7, _$createComponent2(Show2, {
      get when() {
        return rows().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$1 = _$createElement2("text");
          _$insertNode(_el$1, _$createTextNode(`No subagents in this session`));
          _$effect2((_$p) => _$setProp2(_el$1, "fg", subdued(), _$p));
          return _el$1;
        })();
      },
      get children() {
        var _el$8 = _$createElement2("box");
        _$use(setViewport, _el$8);
        _$setProp2(_el$8, "flexDirection", "column");
        _$setProp2(_el$8, "flexShrink", 1);
        _$setProp2(_el$8, "maxHeight", "100%");
        _$setProp2(_el$8, "overflow", "hidden");
        _$insert2(_el$8, _$createComponent2(For, {
          get each() {
            return shown();
          },
          children: (row, index) => {
            const parts = () => rowParts(row, now(), sized);
            const at = () => view().start + index();
            const fg = () => rowFg(row, parts().state, at());
            const measured = finite(panel.width);
            const available = measured === void 0 ? void 0 : measured - LABEL_COLUMN;
            const sized = available !== void 0 && available > 0 ? {
              labelWidth: available
            } : void 0;
            return (() => {
              var _el$11 = _$createElement2("box");
              _$setProp2(_el$11, "flexDirection", "column");
              _$insert2(_el$11, _$createComponent2(For, {
                get each() {
                  return parts().label;
                },
                children: (line) => (() => {
                  var _el$13 = _$createElement2("text");
                  _$insert2(_el$13, line);
                  _$effect2((_$p) => _$setProp2(_el$13, "fg", fg(), _$p));
                  return _el$13;
                })()
              }), null);
              _$insert2(_el$11, _$createComponent2(Show2, {
                get when() {
                  return parts().meta !== "";
                },
                get children() {
                  var _el$12 = _$createElement2("text");
                  _$insert2(_el$12, () => parts().meta);
                  _$effect2((_$p) => _$setProp2(_el$12, "fg", subdued(), _$p));
                  return _el$12;
                }
              }), null);
              return _el$11;
            })();
          }
        }));
        return _el$8;
      }
    }), _el$9);
    _$insertNode(_el$9, _$createTextNode(`j/k move \xB7 enter open \xB7 c completed \xB7 f fullscreen \xB7 esc close`));
    _$effect2((_$p) => _$setProp2(_el$9, "fg", subdued(), _$p));
    return _el$7;
  })();
}
function registerPanel(context, tick) {
  return context.ui.slot({
    append: "session.panel",
    render: (panel) => _$createComponent2(Show2, {
      get when() {
        return panel.name === PANEL_NAME;
      },
      get children() {
        return _$createComponent2(SubagentPanel, {
          context,
          panel,
          tick
        });
      }
    })
  });
}

// src/sidebar.tsx
import { effect as _$effect3 } from "@opentui/solid";
import { insert as _$insert3 } from "@opentui/solid";
import { createComponent as _$createComponent3 } from "@opentui/solid";
import { setProp as _$setProp3 } from "@opentui/solid";
import { createElement as _$createElement3 } from "@opentui/solid";
import { createEffect as createEffect2, createMemo as createMemo3, createSignal as createSignal2, For as For2, onCleanup as onCleanup2, Show as Show3 } from "solid-js";
var ELAPSED_TICK_MS2 = 1e3;
function safeList3(context) {
  try {
    return context.data.session.list() ?? [];
  } catch {
    return [];
  }
}
function safeStatusLookup2(context) {
  return (sessionID) => {
    try {
      return context.data.session.status(sessionID);
    } catch {
      return void 0;
    }
  };
}
function safePermissionLookup2(context) {
  return (sessionID) => {
    try {
      return (context.data.session.permission.list(sessionID) ?? []).length > 0;
    } catch {
      return false;
    }
  };
}
function usableSessionID(value) {
  return typeof value === "string" && value !== "" ? value : void 0;
}
function resolveSidebarSession(slotSessionID, readRoute) {
  const fromSlot = usableSessionID(slotSessionID);
  if (fromSlot !== void 0) return fromSlot;
  try {
    const route = readRoute();
    return route?.type === "session" ? usableSessionID(route.sessionID) : void 0;
  } catch {
    return void 0;
  }
}
function safeModels2(context) {
  try {
    return context.data.location.model.list() ?? [];
  } catch {
    return [];
  }
}
var PREFS_KEY2 = "sidebar";
var SIDEBAR_TITLE = "Subagents";
function SubagentGlance(props) {
  const [now, setNow] = createSignal2(Date.now());
  const [prefs, setPrefs] = props.context.storage.store(PREFS_KEY2, {
    initial: {
      expanded: true
    }
  });
  const toggle = () => {
    void setPrefs((draft) => {
      draft.expanded = !draft.expanded;
    }).catch(() => {
    });
  };
  const sessionID = () => resolveSidebarSession(props.slotSessionID, () => props.context.ui.router.current());
  createEffect2(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS2);
    onCleanup2(() => clearInterval(timer));
  });
  const all = createMemo3(() => {
    props.tick();
    const id = sessionID();
    if (id === void 0) return [];
    return collectSubagents(safeList3(props.context), id, safeStatusLookup2(props.context), safePermissionLookup2(props.context));
  });
  const rows = createMemo3(() => {
    const models = safeModels2(props.context);
    return topRows(all()).map((row) => ({
      ...row,
      contextPercent: rowPercent(props.context, models, row.id)
    }));
  });
  createEffect2(() => {
    props.tick();
    const id = sessionID();
    if (id === void 0) return;
    ensureSessions(props.context, [id, ...all().map((row) => row.id)]);
    for (const row of rows()) ensureMessages(props.context, row.id);
  });
  const fg = (row) => {
    const marker = MARKERS[stateOf(row, now())];
    return resolveFg(props.context, marker.token, marker.fallback);
  };
  const subdued = () => resolveFg(props.context, SUBDUED_TOKEN, SUBDUED_FALLBACK);
  const expanded = () => prefs.expanded;
  const open = () => drawsSidebarWidget(all().length > 0);
  return _$createComponent3(Show3, {
    get when() {
      return open();
    },
    get children() {
      var _el$ = _$createElement3("box");
      _$setProp3(_el$, "flexDirection", "column");
      _$insert3(_el$, _$createComponent3(SubagentHeader, {
        get context() {
          return props.context;
        },
        get rows() {
          return all();
        },
        title: SIDEBAR_TITLE,
        get expanded() {
          return expanded();
        },
        onToggle: toggle
      }), null);
      _$insert3(_el$, _$createComponent3(Show3, {
        get when() {
          return expanded();
        },
        get children() {
          return _$createComponent3(For2, {
            get each() {
              return rows();
            },
            children: (row) => {
              const parts = () => rowParts(row, now(), {
                cost: false,
                model: false
              });
              return (() => {
                var _el$2 = _$createElement3("box");
                _$setProp3(_el$2, "flexDirection", "column");
                _$insert3(_el$2, _$createComponent3(For2, {
                  get each() {
                    return parts().label;
                  },
                  children: (line) => (() => {
                    var _el$4 = _$createElement3("text");
                    _$insert3(_el$4, line);
                    _$effect3((_$p) => _$setProp3(_el$4, "fg", fg(row), _$p));
                    return _el$4;
                  })()
                }), null);
                _$insert3(_el$2, _$createComponent3(Show3, {
                  get when() {
                    return parts().meta !== "";
                  },
                  get children() {
                    var _el$3 = _$createElement3("text");
                    _$insert3(_el$3, () => parts().meta);
                    _$effect3((_$p) => _$setProp3(_el$3, "fg", subdued(), _$p));
                    return _el$3;
                  }
                }), null);
                return _el$2;
              })();
            }
          });
        }
      }), null);
      return _el$;
    }
  });
}
function registerSidebar(context, tick) {
  return context.ui.slot({
    append: "sidebar.content",
    render: (input) => _$createComponent3(SubagentGlance, {
      context,
      get slotSessionID() {
        return input.sessionID;
      },
      tick
    })
  });
}

// src/tui.tsx
var PLUGIN_ID = "subagent-view";
var ELAPSED_TICK_MS3 = 1e3;
var REFRESH_COALESCE_MS = 200;
var SLOT_DEFAULT = "session.composer.top";
var SLOT_FOOTER = "prompt.footer.status";
function safeGet(context, sessionID) {
  if (!sessionID) return void 0;
  try {
    return context.data.session.get(sessionID);
  } catch {
    return void 0;
  }
}
function safeStatus(context, sessionID) {
  if (!sessionID) return void 0;
  try {
    return context.data.session.status(sessionID);
  } catch {
    return void 0;
  }
}
function safeModels3(context) {
  try {
    return context.data.location.model.list() ?? [];
  } catch {
    return [];
  }
}
var EXECUTION_EVENTS = ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"];
function announceExecution(context, seen, type, event) {
  const outcome = executionOutcome(type);
  if (outcome === void 0) return;
  const sessionID = event?.data?.sessionID;
  if (!sessionID) return;
  try {
    const record = safeGet(context, sessionID);
    if (!record) return;
    if (!isSubagentSession(record)) return;
    if (!seenExecution(seen, sessionID, event?.id)) return;
    void context.attention.notify({
      title: rowLabel(record),
      message: finishedMessage(finishedRow(sessionID, record, outcome, 1), Date.now()),
      sound: {
        name: "subagent_done",
        when: "blurred"
      },
      notification: {
        when: "blurred"
      }
    }).catch(() => {
    });
  } catch {
  }
}
function SubagentStatus(props) {
  const [now, setNow] = createSignal3(Date.now());
  createEffect3(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS3);
    onCleanup3(() => clearInterval(timer));
  });
  createEffect3(() => {
    const sessionID = props.sessionID;
    if (!sessionID) return;
    props.context.data.session.sync(sessionID).catch(() => {
    });
  });
  createEffect3(() => {
    ensureMessages(props.context, props.sessionID);
  });
  const record = createMemo4(() => {
    props.tick();
    return safeGet(props.context, props.sessionID);
  });
  const isSubagent = createMemo4(() => {
    now();
    return Boolean(record()?.parentID);
  });
  const summary = createMemo4(() => buildSummary({
    ...record(),
    // `undefined` until both lists hold a usable pair, which is what drops
    // the segment instead of printing a misleading `0% ctx`.
    contextPercent: rowPercent(props.context, safeModels3(props.context), props.sessionID)
  }, now(), safeStatus(props.context, props.sessionID)));
  const marker = () => MARKERS[summary().state];
  return _$createComponent4(Show4, {
    get when() {
      return isSubagent();
    },
    get children() {
      var _el$ = _$createElement4("box"), _el$2 = _$createElement4("text"), _el$3 = _$createElement4("text"), _el$4 = _$createTextNode2(` `), _el$5 = _$createElement4("text");
      _$insertNode2(_el$, _el$2);
      _$insertNode2(_el$, _el$3);
      _$insertNode2(_el$, _el$5);
      _$setProp4(_el$, "flexDirection", "row");
      _$insert4(_el$2, () => marker().glyph);
      _$insertNode2(_el$3, _el$4);
      _$insert4(_el$3, () => summary().label, null);
      _$insert4(_el$5, (() => {
        var _c$ = _$memo(() => !!summary().text);
        return () => _c$() ? ` ${summary().text}` : "";
      })());
      _$effect4((_p$) => {
        var _v$ = resolveFg(props.context, marker().token, marker().fallback), _v$2 = resolveFg(props.context, SUBDUED_TOKEN, SUBDUED_FALLBACK);
        _v$ !== _p$.e && (_p$.e = _$setProp4(_el$2, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp4(_el$5, "fg", _v$2, _p$.t));
        return _p$;
      }, {
        e: void 0,
        t: void 0
      });
      return _el$;
    }
  });
}
function resolveSlot(value) {
  return value === SLOT_FOOTER ? SLOT_FOOTER : SLOT_DEFAULT;
}
function renderStatus(context, sessionID, tick) {
  return _$createComponent4(SubagentStatus, {
    context,
    sessionID: sessionID ?? "",
    tick
  });
}
function PanelCommand(props) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: COMMAND_IDS.openPanel,
      title: "Subagents panel",
      slash: {
        name: "subagents"
      },
      palette: true,
      run: () => {
        props.context.ui.panel.open(PANEL_NAME);
      }
    }]
  }));
  return null;
}
var tui_default = Plugin.define({
  id: PLUGIN_ID,
  setup(context) {
    const [tick, setTick] = createSignal3(0);
    let lastRefreshAt = 0;
    const seenExecutions = /* @__PURE__ */ new Map();
    const requestRefresh = () => {
      const stamp = Date.now();
      if (stamp - lastRefreshAt < REFRESH_COALESCE_MS) return;
      lastRefreshAt = stamp;
      setTick((value) => value + 1);
    };
    const stopEvents = context.data.listen(requestRefresh);
    const stopExecutions = EXECUTION_EVENTS.map((type) => context.data.on(type, (event) => {
      try {
        announceExecution(context, seenExecutions, type, event);
      } catch {
      }
    }));
    try {
      void context.data.location.model.sync().catch(() => {
      });
    } catch {
    }
    const release = resolveSlot(context.options.slot) === SLOT_FOOTER ? context.ui.slot({
      append: SLOT_FOOTER,
      render: (input) => renderStatus(context, input.sessionID, tick)
    }) : context.ui.slot({
      append: SLOT_DEFAULT,
      render: (input) => renderStatus(context, input.sessionID, tick)
    });
    const releasePanel = registerPanel(context, tick);
    const releaseFooter = registerFooter(context, tick);
    const releaseSidebar = registerSidebar(context, tick);
    const releaseCommand = context.ui.slot({
      append: "app",
      render: () => _$createComponent4(PanelCommand, {
        context
      })
    });
    return () => {
      stopEvents?.();
      for (const stop of stopExecutions) stop?.();
      release?.();
      releasePanel?.();
      releaseFooter?.();
      releaseSidebar?.();
      releaseCommand?.();
      resetSyncGuards();
    };
  }
});
export {
  tui_default as default
};
