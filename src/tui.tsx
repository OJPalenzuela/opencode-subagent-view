/**
 * OpenCode v2 TUI plugin: live stats for the subagent session you are inside,
 * plus the `/subagents` panel listing every subagent of the root session, a
 * count on the home footer, and an alert when a subagent finishes.
 *
 * When the routed session is a subagent session (`parentID` set), this renders a
 * single line above the composer — state dot, agent label, model, elapsed time,
 * token usage, cost and context-window occupancy — and keeps it current from two
 * sources: a one-second tick for the clock and a coalesced data listener for
 * record changes. The same refresh signal feeds the `subagent-view.panel`
 * contribution, the footer counter and the completion alerts.
 */

import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import type { JSX } from "@opentui/solid";
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { buildSummary } from "./format.js";
import type { SessionLike, SessionStatus } from "./format.js";
import { usagePercent } from "./context.js";
import type { MessageLike, ModelInfoLike } from "./context.js";
import { createCompletionTracker, finishedMessage } from "./alerts.js";
import type { CompletionTracker, FinishedSubagent } from "./alerts.js";
import { COMMAND_IDS } from "./commands.js";
import { registerFooter } from "./footer.js";
import { PANEL_NAME, registerPanel } from "./panel.js";
import { collectSubagents } from "./subagents.js";
import type { SubagentSession } from "./subagents.js";
import { MARKERS, resolveFg, SUBDUED_FALLBACK, SUBDUED_TOKEN } from "./theme.js";

const PLUGIN_ID = "subagent-view";
const ELAPSED_TICK_MS = 1_000;
const REFRESH_COALESCE_MS = 200;

/** Sessions already asked for their messages, for this plugin generation. */
const SYNCED_MESSAGES = new Set<string>();

const SLOT_DEFAULT = "session.composer.top";
const SLOT_FOOTER = "prompt.footer.status";

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

function safeList(context: Context): SubagentSession[] {
  try {
    return (context.data.session.list() ?? []) as SubagentSession[];
  } catch {
    return [];
  }
}

/** The provider's model collection; carries the context limit, no `get` on it. */
function safeModels(context: Context): ModelInfoLike[] {
  try {
    return context.data.location.model.list() ?? [];
  } catch {
    return [];
  }
}

/**
 * The session's loaded messages. A cache read: an empty list means "not synced
 * for this session yet", which the caller renders as no segment rather than 0%.
 */
function safeMessages(context: Context, sessionID: string | undefined): MessageLike[] {
  if (!sessionID) return [];
  try {
    return (context.data.session.message.list(sessionID) ?? []) as MessageLike[];
  } catch {
    return [];
  }
}

/** The session the router is on, or `undefined` on `home` and `plugin` routes. */
function currentSession(context: Context): string | undefined {
  try {
    const route = context.ui.router.current();
    return route.type === "session" ? route.sessionID : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Announce every subagent that finished since the last refresh.
 *
 * Fire and forget: the alert must never block a refresh, and both the read and
 * the notify are swallowed because the alert path is decoration on top of the
 * status line, never a reason to fail a render. Focus filtering is the host's
 * job (`when: "blurred"`), so there is no focus detection here.
 *
 * ponytail: one alert per finished subagent with no burst cap — a burst is
 * genuinely that many subagents finishing. Add a cap if bursts prove annoying.
 */
function announceFinished(
  context: Context,
  tracker: CompletionTracker,
  sessionID: string,
  now: number,
): void {
  let finished: FinishedSubagent[];
  try {
    finished = tracker.update(collectSubagents(safeList(context), sessionID));
  } catch {
    return;
  }

  for (const row of finished) {
    try {
      void context.attention
        .notify({
          title: row.label,
          message: finishedMessage(row, now),
          sound: { name: "subagent_done", when: "blurred" },
          notification: { when: "blurred" },
        })
        .catch(() => {});
    } catch {
      // An unavailable attention layer must not break a refresh.
    }
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

  // Messages live in their own cache, so `session.sync` above does not fill
  // them. Syncing on every refresh would be a request per tick, so each session
  // is asked for exactly once per plugin generation; after that the data layer
  // keeps it current itself. The host TUI already loads the transcript of the
  // session you are in, so this is a backstop for a session opened headless.
  createEffect(() => {
    const sessionID = props.sessionID;
    if (!sessionID || SYNCED_MESSAGES.has(sessionID)) return;
    SYNCED_MESSAGES.add(sessionID);
    try {
      void props.context.data.session.message.sync(sessionID).catch(() => {});
    } catch {
      // A session whose messages cannot be loaded simply has no `NN% ctx`.
    }
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
      {
        ...record(),
        // `undefined` until both lists hold a usable pair, which is what drops
        // the segment instead of printing a misleading `0% ctx`.
        contextPercent: usagePercent(
          safeModels(props.context),
          safeMessages(props.context, props.sessionID),
        ),
      },
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

/**
 * Owns the global keymap layer that opens the panel. It lives inside a component
 * because `keymap.layer` scopes its commands to the calling owner.
 */
function PanelCommand(props: { readonly context: Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: COMMAND_IDS.openPanel,
        title: "Subagents panel",
        slash: { name: "subagents" },
        palette: true,
        run: () => {
          props.context.ui.panel.open(PANEL_NAME);
        },
      },
    ],
  }));
  return null;
}

export default Plugin.define({
  id: PLUGIN_ID,
  setup(context) {
    const [tick, setTick] = createSignal(0);
    let lastRefreshAt = 0;
    const tracker = createCompletionTracker();

    const requestRefresh = () => {
      const stamp = Date.now();
      if (stamp - lastRefreshAt < REFRESH_COALESCE_MS) return;
      lastRefreshAt = stamp;
      setTick((value) => value + 1);

      // Alerts cover the subagents of the session you are in. One tracker for
      // the whole generation, so switching roots loses nothing: a subagent that
      // finished after the plugin started is announced when you come back,
      // and one that finished before it started stays history.
      const sessionID = currentSession(context);
      if (sessionID === undefined) return;
      announceFinished(context, tracker, sessionID, stamp);
    };

    const stopEvents = context.data.listen(requestRefresh);
    // `limit.context` lives on the model list, and `location.model.list()` is a
    // cache read that stays empty until the collection is synced. Without this
    // the `NN% ctx` segment would silently never appear, in the line and in the
    // panel alike. One sync per generation is enough; the data layer keeps the
    // collection current afterwards.
    try {
      void context.data.location.model.sync().catch(() => {});
    } catch {
      // No model list means no context segment, never an error.
    }
    const release = resolveSlot(context.options.slot) === SLOT_FOOTER
      ? context.ui.slot({
        append: SLOT_FOOTER,
        render: (input) => renderStatus(context, input.sessionID, tick),
      })
      : context.ui.slot({
        append: SLOT_DEFAULT,
        render: (input) => renderStatus(context, input.sessionID, tick),
      });
    const releasePanel = registerPanel(context, tick);
    const releaseFooter = registerFooter(context, tick);
    const releaseCommand = context.ui.slot({
      append: "app",
      render: () => <PanelCommand context={context} />,
    });

    return () => {
      stopEvents?.();
      release?.();
      releasePanel?.();
      releaseFooter?.();
      releaseCommand?.();
    };
  },
});