// src/tui.tsx
import { createComponent as _$createComponent3 } from "@opentui/solid";
import { effect as _$effect3 } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { insert as _$insert3 } from "@opentui/solid";
import { setProp as _$setProp3 } from "@opentui/solid";
import { createElement as _$createElement3 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { Show as Show3, createEffect as createEffect2, createMemo as createMemo3, createSignal as createSignal2, onCleanup as onCleanup2 } from "solid-js";

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
function buildSummary(session, now, status) {
  const parts = [];
  const model = formatModel(session.model);
  if (model !== void 0) parts.push(model);
  const elapsed = elapsedMs(session, now);
  if (elapsed !== void 0) parts.push(`\u23F1 ${formatDuration(elapsed)}`);
  const tokens = session.tokens;
  const tokenTotal2 = tokens ? (finite(tokens.input) ?? 0) + (finite(tokens.output) ?? 0) : 0;
  if (tokenTotal2 > 0) parts.push(`${formatTokens(tokenTotal2)} tok`);
  const cost = finite(session.cost);
  if (cost !== void 0 && cost > 0) parts.push(formatCost(cost));
  const label = session.agent?.trim() || session.title?.trim() || DEFAULT_LABEL;
  return {
    state: deriveState(session, status),
    label,
    parts,
    text: parts.join(SEPARATOR)
  };
}

// src/alerts.ts
var ALERTED = /* @__PURE__ */ new Set(["succeeded", "failed", "interrupted"]);
var SEPARATOR2 = " \xB7 ";
function alertedOutcome(row) {
  return row.outcome !== void 0 && ALERTED.has(row.outcome) ? row.outcome : void 0;
}
function finishedMessage(row, now) {
  const parts = [row.outcome];
  const elapsed = elapsedMs(row, now);
  if (elapsed !== void 0) parts.push(`\u23F1 ${formatDuration(elapsed)}`);
  if (row.tokens !== void 0 && row.tokens > 0) parts.push(`${formatTokens(row.tokens)} tok`);
  if (row.cost !== void 0 && row.cost > 0) parts.push(formatCost(row.cost));
  return parts.join(SEPARATOR2);
}
function createCompletionTracker() {
  let seen = /* @__PURE__ */ new Map();
  let armed = false;
  return {
    update(rows) {
      const finished = [];
      let snapshot;
      for (const row of rows) {
        if (typeof row?.id !== "string" || row.id === "") continue;
        const next = snapshot ?? /* @__PURE__ */ new Map();
        snapshot = next;
        const outcome = alertedOutcome(row);
        const previous = seen.get(row.id);
        next.set(row.id, outcome ?? previous);
        if (outcome !== void 0 && previous === void 0 && armed) {
          finished.push({ ...row, outcome });
        }
      }
      seen = snapshot ?? /* @__PURE__ */ new Map();
      if (snapshot !== void 0 && snapshot.size > 0) armed = true;
      return finished;
    }
  };
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
  running: { glyph: "\u25CF", token: WARNING_TOKEN, fallback: WARNING_FALLBACK },
  idle: { glyph: "\u25CC", token: SUBDUED_TOKEN, fallback: SUBDUED_FALLBACK },
  done: { glyph: "\u2713", token: "text.feedback.success.default", fallback: "#c3e88d" },
  error: { glyph: "\u2715", token: "text.feedback.error.default", fallback: "#f07178" },
  interrupted: { glyph: "\u2298", token: SUBDUED_TOKEN, fallback: SUBDUED_FALLBACK },
  unknown: { glyph: "\u25CB", token: SUBDUED_TOKEN, fallback: SUBDUED_FALLBACK }
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
function tokenTotal(session) {
  const tokens = session.tokens;
  if (!tokens) return void 0;
  return (finite(tokens.input) ?? 0) + (finite(tokens.output) ?? 0);
}
function toRow(session, depth, currentSessionID, getStatus, needsPermission) {
  return {
    id: session.id,
    label: session.agent?.trim() || session.title?.trim() || DEFAULT_LABEL,
    model: session.model?.id,
    tokens: tokenTotal(session),
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
function rowLine(row, now) {
  const parts = [];
  if (row.model) parts.push(row.model);
  const elapsed = elapsedMs(row, now);
  if (elapsed !== void 0) parts.push(`\u23F1 ${formatDuration(elapsed)}`);
  if (row.tokens !== void 0 && row.tokens > 0) parts.push(`${formatTokens(row.tokens)} tok`);
  if (row.cost !== void 0 && row.cost > 0) parts.push(formatCost(row.cost));
  const current = row.isCurrent ? CURRENT_GLYPH : " ";
  const glyph = MARKERS[stateOf(row, now)].glyph;
  const indent = INDENT.repeat(Math.max(0, row.depth - 1));
  const meta = parts.length > 0 ? ` \xB7 ${parts.join(" \xB7 ")}` : "";
  const pending = row.needsPermission ? ` ${PERMISSION_GLYPH}` : "";
  return `${current} ${glyph} ${indent}${row.label}${meta}${pending}`;
}
function headerLine(total) {
  return `Subagents  ${total.running} run \xB7 ${total.done} done \xB7 ${total.failed} err`;
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
import { effect as _$effect2 } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { createEffect, createMemo as createMemo2, createSignal, For, onCleanup, Show as Show2 } from "solid-js";
var PANEL_NAME = "subagent-view.panel";
var PREFS_KEY = "panel";
var ELAPSED_TICK_MS = 1e3;
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
  createEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    onCleanup(() => clearInterval(timer));
  });
  const rows = createMemo2(() => {
    props.tick();
    now();
    return orderRows(visibleRows(collectSubagents(safeList2(context), panel.sessionID, safeStatusLookup(context), safePermissionLookup(context)), prefs.showCompleted));
  });
  createEffect(() => {
    const sessionID = panel.sessionID;
    const ids = [sessionID, ...collectSubagents(safeList2(context), sessionID).map((row) => row.id)];
    void Promise.allSettled(ids.map((id) => safeSync(context, id)));
  });
  const stopPermission = context.data.on("permission.asked", (event) => {
    const sessionID = event.data?.sessionID;
    if (!sessionID) return;
    void safeSync(context, sessionID).then(() => props.tick());
  });
  onCleanup(stopPermission);
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
  const header = () => headerLine(counts(rows()));
  const rowFg = (row, index) => {
    if (index === Math.min(cursor(), lastIndex())) {
      return resolveFg(context, SELECTED_TOKEN, SELECTED_FALLBACK);
    }
    if (row.needsPermission) return resolveFg(context, WARNING_TOKEN, WARNING_FALLBACK);
    const marker = MARKERS[stateOf(row)];
    return resolveFg(context, marker.token, marker.fallback);
  };
  return (() => {
    var _el$ = _$createElement2("box"), _el$2 = _$createElement2("text"), _el$3 = _$createElement2("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$3);
    _$setProp2(_el$, "flexDirection", "column");
    _$insert2(_el$2, header);
    _$insert2(_el$, _$createComponent2(Show2, {
      get when() {
        return rows().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$5 = _$createElement2("text");
          _$insertNode(_el$5, _$createTextNode(`No subagents in this session`));
          _$effect2((_$p) => _$setProp2(_el$5, "fg", subdued(), _$p));
          return _el$5;
        })();
      },
      get children() {
        return _$createComponent2(For, {
          get each() {
            return rows();
          },
          children: (row, index) => (() => {
            var _el$7 = _$createElement2("text");
            _$insert2(_el$7, () => rowLine(row, now()));
            _$effect2((_$p) => _$setProp2(_el$7, "fg", rowFg(row, index()), _$p));
            return _el$7;
          })()
        });
      }
    }), _el$3);
    _$insertNode(_el$3, _$createTextNode(`j/k move \xB7 enter open \xB7 c completed \xB7 f fullscreen \xB7 esc close`));
    _$effect2((_p$) => {
      var _v$ = resolveFg(context, SELECTED_TOKEN, SELECTED_FALLBACK), _v$2 = subdued();
      _v$ !== _p$.e && (_p$.e = _$setProp2(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$3, "fg", _v$2, _p$.t));
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
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

// src/tui.tsx
var PLUGIN_ID = "subagent-view";
var ELAPSED_TICK_MS2 = 1e3;
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
function safeList3(context) {
  try {
    return context.data.session.list() ?? [];
  } catch {
    return [];
  }
}
function currentSession(context) {
  try {
    const route = context.ui.router.current();
    return route.type === "session" ? route.sessionID : void 0;
  } catch {
    return void 0;
  }
}
function announceFinished(context, tracker, sessionID, now) {
  let finished;
  try {
    finished = tracker.update(collectSubagents(safeList3(context), sessionID));
  } catch {
    return;
  }
  for (const row of finished) {
    try {
      void context.attention.notify({
        title: row.label,
        message: finishedMessage(row, now),
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
}
function SubagentStatus(props) {
  const [now, setNow] = createSignal2(Date.now());
  createEffect2(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS2);
    onCleanup2(() => clearInterval(timer));
  });
  createEffect2(() => {
    const sessionID = props.sessionID;
    if (!sessionID) return;
    props.context.data.session.sync(sessionID).catch(() => {
    });
  });
  const record = createMemo3(() => {
    props.tick();
    return safeGet(props.context, props.sessionID);
  });
  const isSubagent = createMemo3(() => {
    now();
    return Boolean(record()?.parentID);
  });
  const summary = createMemo3(() => buildSummary(record() ?? {}, now(), safeStatus(props.context, props.sessionID)));
  const marker = () => MARKERS[summary().state];
  return _$createComponent3(Show3, {
    get when() {
      return isSubagent();
    },
    get children() {
      var _el$ = _$createElement3("box"), _el$2 = _$createElement3("text"), _el$3 = _$createElement3("text"), _el$4 = _$createTextNode2(` `), _el$5 = _$createElement3("text");
      _$insertNode2(_el$, _el$2);
      _$insertNode2(_el$, _el$3);
      _$insertNode2(_el$, _el$5);
      _$setProp3(_el$, "flexDirection", "row");
      _$insert3(_el$2, () => marker().glyph);
      _$insertNode2(_el$3, _el$4);
      _$insert3(_el$3, () => summary().label, null);
      _$insert3(_el$5, (() => {
        var _c$ = _$memo(() => !!summary().text);
        return () => _c$() ? ` ${summary().text}` : "";
      })());
      _$effect3((_p$) => {
        var _v$ = resolveFg(props.context, marker().token, marker().fallback), _v$2 = resolveFg(props.context, SUBDUED_TOKEN, SUBDUED_FALLBACK);
        _v$ !== _p$.e && (_p$.e = _$setProp3(_el$2, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp3(_el$5, "fg", _v$2, _p$.t));
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
  return _$createComponent3(SubagentStatus, {
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
    const [tick, setTick] = createSignal2(0);
    let lastRefreshAt = 0;
    let tracker = createCompletionTracker();
    let trackedSession = "";
    const requestRefresh = () => {
      const stamp = Date.now();
      if (stamp - lastRefreshAt < REFRESH_COALESCE_MS) return;
      lastRefreshAt = stamp;
      setTick((value) => value + 1);
      const sessionID = currentSession(context);
      if (sessionID === void 0) return;
      if (sessionID !== trackedSession) {
        tracker = createCompletionTracker();
        trackedSession = sessionID;
      }
      announceFinished(context, tracker, sessionID, stamp);
    };
    const stopEvents = context.data.listen(requestRefresh);
    const release = resolveSlot(context.options.slot) === SLOT_FOOTER ? context.ui.slot({
      append: SLOT_FOOTER,
      render: (input) => renderStatus(context, input.sessionID, tick)
    }) : context.ui.slot({
      append: SLOT_DEFAULT,
      render: (input) => renderStatus(context, input.sessionID, tick)
    });
    const releasePanel = registerPanel(context, tick);
    const releaseFooter = registerFooter(context, tick);
    const releaseCommand = context.ui.slot({
      append: "app",
      render: () => _$createComponent3(PanelCommand, {
        context
      })
    });
    return () => {
      stopEvents?.();
      release?.();
      releasePanel?.();
      releaseFooter?.();
      releaseCommand?.();
    };
  }
});
export {
  tui_default as default
};
