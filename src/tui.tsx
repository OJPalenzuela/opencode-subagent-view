/**
 * OpenCode v2 TUI plugin: live stats for the subagent session you are inside.
 *
 * When the routed session is a subagent session (`parentID` set), this renders a
 * single line above the composer — state dot, agent label, model, elapsed time
 * and token usage — and keeps it current from two sources: a one-second tick for
 * the clock and a coalesced data listener for record changes.
 */

import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import type { JSX } from "@opentui/solid";
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { buildSummary } from "./format.js";
import type { SessionLike, SessionStatus, State } from "./format.js";

const PLUGIN_ID = "subagent-view";
const ELAPSED_TICK_MS = 1_000;
const REFRESH_COALESCE_MS = 200;
const SUBDUED_TOKEN = "text.subdued";
const SUBDUED_FALLBACK = "#546e7a";

const SLOT_DEFAULT = "session.composer.top";
const SLOT_FOOTER = "prompt.footer.status";

/** Marker glyph per state, paired with the theme token used to color it. */
const MARKERS = {
  running: { glyph: "●", token: "text.feedback.warning.default", fallback: "#ffcb6b" },
  done: { glyph: "✓", token: "text.feedback.success.default", fallback: "#c3e88d" },
  error: { glyph: "✕", token: "text.feedback.error.default", fallback: "#f07178" },
  interrupted: { glyph: "⊘", token: SUBDUED_TOKEN, fallback: SUBDUED_FALLBACK },
  unknown: { glyph: "○", token: SUBDUED_TOKEN, fallback: SUBDUED_FALLBACK },
} as const satisfies Record<State, { glyph: string; token: string; fallback: string }>;

function colorToHex(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const buffer = (value as { buffer?: unknown } | undefined)?.buffer;
  if (!Array.isArray(buffer)) return undefined;
  const pair = (channel: unknown) =>
    Math.max(0, Math.min(255, Math.round(Number(channel) || 0)))
      .toString(16)
      .padStart(2, "0");
  return `#${pair(buffer[0])}${pair(buffer[1])}${pair(buffer[2])}`;
}

function resolveFg(context: Context, tokenPath: string, fallback: string): string {
  try {
    const value = tokenPath
      .split(".")
      .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], context.theme);
    return colorToHex(value) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Read a live record defensively: the data layer can be mid-invalidation. */
function safeGet(context: Context, sessionID: string | undefined): SessionLike | undefined {
  if (!sessionID) return undefined;
  try {
    return context.data.session.get(sessionID) as SessionLike | undefined;
  } catch {
    return undefined;
  }
}

function safeStatus(context: Context, sessionID: string | undefined): SessionStatus | undefined {
  if (!sessionID) return undefined;
  try {
    return context.data.session.status(sessionID);
  } catch {
    return undefined;
  }
}

/**
 * Always mounted. Its internal gate re-evaluates on every refresh tick, on a
 * session switch, and at least once per second, so a record that was not cached
 * on first evaluation flips the line on without navigating away.
 */
function SubagentStatus(props: {
  readonly context: Context;
  readonly sessionID: string;
  readonly tick: () => void;
}) {
  const [now, setNow] = createSignal(Date.now());

  createEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    onCleanup(() => clearInterval(timer));
  });

  // Unconditional: this is what makes the record exist, so it must not sit
  // behind the gate that depends on it.
  createEffect(() => {
    const sessionID = props.sessionID;
    if (!sessionID) return;
    props.context.data.session.sync(sessionID).catch(() => {});
  });

  // Reactive on purpose. A bare `session.get()` read inside the JSX `when`
  // compiles to a zero-dependency memo that latches its first answer; reading
  // `tick` here is what re-arms it whenever the data layer reports a change.
  const record = createMemo(() => {
    props.tick();
    return safeGet(props.context, props.sessionID);
  });

  const isSubagent = createMemo(() => {
    now(); // backstop: re-check at least once per second even if no event arrives
    return Boolean(record()?.parentID);
  });

  const summary = createMemo(() =>
    buildSummary(
      record() ?? {},
      now(),
      safeStatus(props.context, props.sessionID),
    )
  );

  const marker = () => MARKERS[summary().state];

  return (
    <Show when={isSubagent()}>
      <box flexDirection="row">
        <text fg={resolveFg(props.context, marker().token, marker().fallback)}>{marker().glyph}</text>
        <text> {summary().label}</text>
        <text fg={resolveFg(props.context, SUBDUED_TOKEN, SUBDUED_FALLBACK)}>
          {summary().text ? ` ${summary().text}` : ""}
        </text>
      </box>
    </Show>
  );
}

function resolveSlot(value: unknown): typeof SLOT_DEFAULT | typeof SLOT_FOOTER {
  return value === SLOT_FOOTER ? SLOT_FOOTER : SLOT_DEFAULT;
}

/** Shared slot body. The subagent check lives inside the component, not here. */
function renderStatus(
  context: Context,
  sessionID: string | undefined,
  tick: () => number,
): JSX.Element {
  return <SubagentStatus context={context} sessionID={sessionID ?? ""} tick={tick} />;
}

export default Plugin.define({
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
    const release = resolveSlot(context.options.slot) === SLOT_FOOTER
      ? context.ui.slot({
        append: SLOT_FOOTER,
        render: (input) => renderStatus(context, input.sessionID, tick),
      })
      : context.ui.slot({
        append: SLOT_DEFAULT,
        render: (input) => renderStatus(context, input.sessionID, tick),
      });

    return () => {
      stopEvents?.();
      release?.();
    };
  },
});