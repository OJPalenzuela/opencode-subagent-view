// src/tui.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

// src/format.ts
var STATE = {
  RUNNING: "running",
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
  return status === "running" ? STATE.RUNNING : STATE.UNKNOWN;
}
function elapsedMs(session, now) {
  const created = finite(session.time?.created);
  if (created === void 0) return void 0;
  const end = session.outcome !== void 0 ? finite(session.time?.idle) ?? finite(session.time?.updated) ?? now : now;
  return end - created;
}
function buildSummary(session, now, status) {
  const parts = [];
  const modelID = session.model?.id;
  if (modelID) parts.push(modelID);
  const elapsed = elapsedMs(session, now);
  if (elapsed !== void 0) parts.push(`\u23F1 ${formatDuration(elapsed)}`);
  const tokens = session.tokens;
  const tokenTotal = tokens ? (finite(tokens.input) ?? 0) + (finite(tokens.output) ?? 0) : 0;
  if (tokenTotal > 0) parts.push(`${formatTokens(tokenTotal)} tok`);
  const label = session.agent?.trim() || session.title?.trim() || DEFAULT_LABEL;
  return {
    state: deriveState(session, status),
    label,
    parts,
    text: parts.join(SEPARATOR)
  };
}

// src/tui.tsx
var PLUGIN_ID = "subagent-view";
var ELAPSED_TICK_MS = 1e3;
var REFRESH_COALESCE_MS = 200;
var SUBDUED_TOKEN = "text.subdued";
var SUBDUED_FALLBACK = "#546e7a";
var SLOT_DEFAULT = "session.composer.top";
var SLOT_FOOTER = "prompt.footer.status";
var MARKERS = {
  running: {
    glyph: "\u25CF",
    token: "text.feedback.warning.default",
    fallback: "#ffcb6b"
  },
  done: {
    glyph: "\u2713",
    token: "text.feedback.success.default",
    fallback: "#c3e88d"
  },
  error: {
    glyph: "\u2715",
    token: "text.feedback.error.default",
    fallback: "#f07178"
  },
  interrupted: {
    glyph: "\u2298",
    token: SUBDUED_TOKEN,
    fallback: SUBDUED_FALLBACK
  },
  unknown: {
    glyph: "\u25CB",
    token: SUBDUED_TOKEN,
    fallback: SUBDUED_FALLBACK
  }
};
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
function SubagentStatus(props) {
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    onCleanup(() => clearInterval(timer));
  });
  createEffect(() => {
    const sessionID = props.sessionID;
    if (!sessionID) return;
    props.context.data.session.sync(sessionID).catch(() => {
    });
  });
  const record = createMemo(() => {
    props.tick();
    return safeGet(props.context, props.sessionID);
  });
  const isSubagent = createMemo(() => {
    now();
    return Boolean(record()?.parentID);
  });
  const summary = createMemo(() => buildSummary(record() ?? {}, now(), safeStatus(props.context, props.sessionID)));
  const marker = () => MARKERS[summary().state];
  return _$createComponent(Show, {
    get when() {
      return isSubagent();
    },
    get children() {
      var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("text"), _el$4 = _$createTextNode(` `), _el$5 = _$createElement("text");
      _$insertNode(_el$, _el$2);
      _$insertNode(_el$, _el$3);
      _$insertNode(_el$, _el$5);
      _$setProp(_el$, "flexDirection", "row");
      _$insert(_el$2, () => marker().glyph);
      _$insertNode(_el$3, _el$4);
      _$insert(_el$3, () => summary().label, null);
      _$insert(_el$5, (() => {
        var _c$ = _$memo(() => !!summary().text);
        return () => _c$() ? ` ${summary().text}` : "";
      })());
      _$effect((_p$) => {
        var _v$ = resolveFg(props.context, marker().token, marker().fallback), _v$2 = resolveFg(props.context, SUBDUED_TOKEN, SUBDUED_FALLBACK);
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "fg", _v$2, _p$.t));
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
  return _$createComponent(SubagentStatus, {
    context,
    sessionID: sessionID ?? "",
    tick
  });
}
var tui_default = Plugin.define({
  id: PLUGIN_ID,
  setup(context) {
    const [tick, setTick] = createSignal(0);
    let lastRefreshAt = 0;
    const requestRefresh = () => {
      const stamp = Date.now();
      if (stamp - lastRefreshAt < REFRESH_COALESCE_MS) return;
      lastRefreshAt = stamp;
      setTick((value) => value + 1);
    };
    const stopEvents = context.data.listen(requestRefresh);
    const release = resolveSlot(context.options.slot) === SLOT_FOOTER ? context.ui.slot({
      append: SLOT_FOOTER,
      render: (input) => renderStatus(context, input.sessionID, tick)
    }) : context.ui.slot({
      append: SLOT_DEFAULT,
      render: (input) => renderStatus(context, input.sessionID, tick)
    });
    return () => {
      stopEvents?.();
      release?.();
    };
  }
});
export {
  tui_default as default
};
