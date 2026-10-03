/**
 * OpenCode v2 TUI plugin: live stats for the subagent session you are inside,
 * plus the `/subagents` panel listing every subagent of the root session, the
 * top few of them in the sidebar, a count on the home footer, and an alert when
 * a subagent finishes.
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
import { buildSummary, rowLabel } from "./format.js";
import type { SessionLike, SessionStatus } from "./format.js";
import { ensureMessages, resetSyncGuards, rowPercent } from "./context.js";
import type { ModelInfoLike } from "./context.js";
import { executionOutcome, finishedMessage, finishedRow, isSubagentSession, seenExecution } from "./alerts.js";
import { COMMAND_IDS } from "./commands.js";
import { registerFooter } from "./footer.js";
import { PANEL_NAME, registerPanel } from "./panel.js";
import { registerSidebar } from "./sidebar.js";
import { MARKERS, resolveFg, SUBDUED_FALLBACK, SUBDUED_TOKEN } from "./theme.js";

const PLUGIN_ID = "subagent-view";
const ELAPSED_TICK_MS = 1_000;
const REFRESH_COALESCE_MS = 200;

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

/** The provider's model collection; carries the context limit, no `get` on it. */
function safeModels(context: Context): ModelInfoLike[] {
  try {
    return context.data.location.model.list() ?? [];
  } catch {
    return [];
  }
}

/** The terminal execution events, each paired with the outcome it reports. */
const EXECUTION_EVENTS = [
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
] as const;

/**
 * Announce one finished execution, if it belongs to a subagent.
 *
 * The event is the identity of a run, so this fires per execution rather than
 * per outcome change: OpenCode can re-run a subagent on the same session id and a
 * tracker keyed on the record's `outcome` would stay silent for every re-run.
 *
 * Any subagent alerts, in any tree: the filter is the record's own `parentID`,
 * which is pure and testable, and it does not drop a subagent that finished while
 * the user was looking elsewhere. A root session has no parent and so can never
 * announce its own turn.
 *
 * Fire and forget: the alert never blocks anything, and both the reads and the
 * notify are swallowed because this path is decoration on top of the status line,
 * never a reason to fail. Focus filtering is the host's job (`when: "blurred"`),
 * so there is no focus detection here.
 *
 * ponytail: one alert per finished execution with no burst cap — a burst is
 * genuinely that many subagents finishing. Add a cap if bursts prove annoying.
 */
function announceExecution(
  context: Context,
  seen: Map<string, string>,
  type: string,
  event: { readonly id?: string; readonly data?: { readonly sessionID?: string } },
): void {
  const outcome = executionOutcome(type);
  if (outcome === undefined) return;

  const sessionID = event?.data?.sessionID;
  if (!sessionID) return;

  try {
    const record = safeGet(context, sessionID);
    // A record that has not caught up with the event, or one the data layer
    // cannot produce right now, is skipped rather than alerted on blind.
    if (!record) return;
    // The root-session invariant, and the only scope filter there is: no
    // `parentID`, so this is a root session finishing its own turn.
    if (!isSubagentSession(record)) return;

    // A repeated delivery of the same event is not a second run.
    if (!seenExecution(seen, sessionID, event?.id)) return;

    void context.attention
      .notify({
        title: rowLabel(record),
        message: finishedMessage(finishedRow(sessionID, record, outcome, 1), Date.now()),
        sound: { name: "subagent_done", when: "blurred" },
        notification: { when: "blurred" },
      })
      .catch(() => {});
  } catch {
    // An unavailable attention layer must not break the event handler.
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
  // them; `ensureMessages` asks once per plugin generation and the data layer
  // keeps them current afterwards. The panel asks the same way for its own rows.
  createEffect(() => {
    ensureMessages(props.context, props.sessionID);
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
        contextPercent: rowPercent(props.context, safeModels(props.context), props.sessionID),
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
    // One last-notified event id per session, so a redelivered event cannot
    // alert twice while a genuine re-run — a different id on the same session —
    // always can.
    const seenExecutions = new Map<string, string>();

    const requestRefresh = () => {
      const stamp = Date.now();
      if (stamp - lastRefreshAt < REFRESH_COALESCE_MS) return;
      lastRefreshAt = stamp;
      setTick((value) => value + 1);
    };

    const stopEvents = context.data.listen(requestRefresh);

    // Alerts are event-driven, so they are subscribed here rather than derived
    // from a refresh: a subagent re-run on the same session id re-emits
    // `execution.started` and finishes again with a new terminal event, which is
    // the announcement the old outcome-diffing tracker could never produce.
    const stopExecutions = EXECUTION_EVENTS.map((type) =>
      context.data.on(type, (event) => {
        try {
          announceExecution(context, seenExecutions, type, event);
        } catch {
          // An alert must never take the event stream down.
        }
      }),
    );
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
    const releaseSidebar = registerSidebar(context, tick);
    const releaseCommand = context.ui.slot({
      append: "app",
      render: () => <PanelCommand context={context} />,
    });

    return () => {
      stopEvents?.();
      for (const stop of stopExecutions) stop?.();
      release?.();
      releasePanel?.();
      releaseFooter?.();
      releaseSidebar?.();
      releaseCommand?.();
      // The sync guards are module state that outlives this setup: clearing them
      // here means a re-`setup()` in the same process syncs again instead of
      // inheriting stale marks and never warming a cache.
      resetSyncGuards();
    };
  },
});