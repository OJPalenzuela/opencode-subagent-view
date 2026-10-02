/**
 * The `subagent-view.panel` session panel: every subagent of the current
 * session's root, one line each, navigable with the keyboard.
 *
 * The panel owns nothing but its presentation. Reads follow the same shape as
 * the status line — a coalesced `tick` signal plus a one-second clock — because
 * the data layer is not reactive on its own. Everything is wrapped in safe
 * reads: a half-synced data layer must degrade, never throw inside a render.
 */

import type { Context, PanelInput } from "@opencode/plugin/tui/context";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { COMMAND_IDS } from "./commands.js";
import { usagePercent } from "./context.js";
import type { MessageLike, ModelInfoLike } from "./context.js";
import { collectSubagents, counts, headerLine, orderRows, rowLine, stateOf, visibleRows } from "./subagents.js";
import type {
  PermissionLookup,
  StatusLookup,
  SubagentRow,
  SubagentSession,
} from "./subagents.js";
import {
  MARKERS,
  resolveFg,
  SELECTED_FALLBACK,
  SELECTED_TOKEN,
  SUBDUED_FALLBACK,
  SUBDUED_TOKEN,
  WARNING_FALLBACK,
  WARNING_TOKEN,
} from "./theme.js";

export const PANEL_NAME = "subagent-view.panel";
const PREFS_KEY = "panel";
const ELAPSED_TICK_MS = 1_000;
const HINT = "j/k move · enter open · c completed · f fullscreen · esc close";

interface Prefs {
  showCompleted: boolean;
}

function safeList(context: Context): SubagentSession[] {
  try {
    return (context.data.session.list() ?? []) as SubagentSession[];
  } catch {
    return [];
  }
}

function safeStatusLookup(context: Context): StatusLookup {
  return (sessionID) => {
    try {
      return context.data.session.status(sessionID);
    } catch {
      return undefined;
    }
  };
}

function safePermissionLookup(context: Context): PermissionLookup {
  return (sessionID) => {
    try {
      return (context.data.session.permission.list(sessionID) ?? []).length > 0;
    } catch {
      return false;
    }
  };
}

function safeSync(context: Context, sessionID: string): Promise<void> {
  try {
    return context.data.session.permission.sync(sessionID).catch(() => {});
  } catch {
    return Promise.resolve();
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

/** That session's loaded messages; empty when the host has not loaded them. */
function safeMessages(context: Context, sessionID: string): MessageLike[] {
  try {
    return (context.data.session.message.list(sessionID) ?? []) as MessageLike[];
  } catch {
    return [];
  }
}

function SubagentPanel(props: {
  readonly context: Context;
  readonly panel: PanelInput;
  readonly tick: () => number;
}) {
  const { context, panel } = props;
  const initialPrefs: Prefs = { showCompleted: true };
  const [prefs, setPrefs] = context.storage.store(PREFS_KEY, { initial: initialPrefs });
  const [cursor, setCursor] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());

  createEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    onCleanup(() => clearInterval(timer));
  });

  // Reactive on purpose: `tick()` re-arms the memo on every coalesced data
  // event, `now()` keeps the elapsed clocks ticking.
  const rows = createMemo(() => {
    props.tick();
    now();
    // One model list for every row. Messages are read from the cache the host
    // already filled for the sessions it has loaded, never requested here: a
    // row whose data is missing shows no percentage rather than a wrong one.
    const models = safeModels(context);
    const collected = orderRows(
      visibleRows(
        collectSubagents(
          safeList(context),
          panel.sessionID,
          safeStatusLookup(context),
          safePermissionLookup(context),
        ),
        prefs.showCompleted,
      ),
    );
    return collected.map((row) => ({
      ...row,
      contextPercent: usagePercent(models, safeMessages(context, row.id)),
    }));
  });

  // The rows are the panel, so their sessions must have their pending
  // permission requests cached before the first read. `Promise.allSettled`
  // keeps one failing session from taking the rest of the panel down.
  createEffect(() => {
    const sessionID = panel.sessionID;
    const ids = [sessionID, ...collectSubagents(safeList(context), sessionID).map((row) => row.id)];
    void Promise.allSettled(ids.map((id) => safeSync(context, id)));
  });

  // `list()` is a cache read: a request asked after the panel opened would stay
  // invisible without syncing the session the event names.
  const stopPermission = context.data.on("permission.asked", (event) => {
    const sessionID = event.data?.sessionID;
    if (!sessionID) return;
    void safeSync(context, sessionID).then(() => props.tick());
  });
  onCleanup(stopPermission);

  const lastIndex = () => Math.max(0, rows().length - 1);
  const selected = () => rows()[Math.min(Math.max(0, cursor()), lastIndex())];

  const move = (delta: number) => setCursor((value) => Math.min(Math.max(0, value + delta), lastIndex()));

  const guarded = (run: () => void) => () => {
    if (!panel.focused) return false;
    run();
  };

  context.keymap.layer(() => ({
    mode: "global",
    priority: 100,
    enabled: () => panel.focused,
    commands: [
      {
        id: COMMAND_IDS.nextRow,
        title: "Next subagent",
        bind: "j",
        run: guarded(() => move(1)),
      },
      {
        id: COMMAND_IDS.previousRow,
        title: "Previous subagent",
        bind: "k",
        run: guarded(() => move(-1)),
      },
      {
        id: COMMAND_IDS.enterRow,
        title: "Open the selected subagent session",
        bind: "enter",
        run: guarded(() => {
          const row = selected();
          if (!row) return;
          context.ui.router.navigate({ type: "session", sessionID: row.id });
        }),
      },
      {
        id: COMMAND_IDS.toggleCompleted,
        title: "Toggle completed subagents",
        bind: "c",
        run: guarded(() => {
          void setPrefs((draft) => {
            draft.showCompleted = !draft.showCompleted;
          }).catch(() => {});
        }),
      },
      {
        id: COMMAND_IDS.toggleFullscreen,
        title: "Toggle full screen panel",
        bind: "f",
        run: guarded(() => panel.toggleFullscreen()),
      },
      {
        id: COMMAND_IDS.closePanel,
        title: "Close the subagents panel",
        bind: "escape",
        run: guarded(() => panel.close()),
      },
    ],
  }));

  const subdued = () => resolveFg(context, SUBDUED_TOKEN, SUBDUED_FALLBACK);

  const header = () => headerLine(counts(rows()));

  const rowFg = (row: SubagentRow, index: number) => {
    if (index === Math.min(cursor(), lastIndex())) {
      return resolveFg(context, SELECTED_TOKEN, SELECTED_FALLBACK);
    }
    if (row.needsPermission) return resolveFg(context, WARNING_TOKEN, WARNING_FALLBACK);
    const marker = MARKERS[stateOf(row)];
    return resolveFg(context, marker.token, marker.fallback);
  };

  return (
    <box flexDirection="column">
      <text fg={resolveFg(context, SELECTED_TOKEN, SELECTED_FALLBACK)}>{header()}</text>
      <Show
        when={rows().length > 0}
        fallback={<text fg={subdued()}>No subagents in this session</text>}
      >
        <For each={rows()}>
          {(row, index) => <text fg={rowFg(row, index())}>{rowLine(row, now())}</text>}
        </For>
      </Show>
      <text fg={subdued()}>{HINT}</text>
    </box>
  );
}

export function registerPanel(context: Context, tick: () => number): () => void {
  return context.ui.slot({
    append: "session.panel",
    render: (panel) => (
      <Show when={panel.name === PANEL_NAME}>
        <SubagentPanel context={context} panel={panel} tick={tick} />
      </Show>
    ),
  });
}