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
import { ensureMessages, ensureSessions, rowPercent } from "./context.js";
import type { ModelInfoLike } from "./context.js";
import type { State } from "./format.js";
import { finite } from "./format.js";
import {
  collectSubagents,
  counts,
  headerSegments,
  LABEL_COLUMN,
  orderRows,
  rowCapacity,
  rowParts,
  rowWindow,
  visibleRows,
} from "./subagents.js";
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
/** Label line plus meta line: a row without a meta line wastes its second. */
const ROW_LINES = 2;
/** The scrolling container is a sibling of the header and the hint, not a parent. */
const CHROME_LINES = 0;
/** Rows to show before the first layout pass reports a height. */
const FALLBACK_ROWS = 10;

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

/**
 * The counts header — `● 2 run · ✓ 1 done · ✕ 0 err` — one colour per count.
 *
 * Exported and shared with the sidebar widget rather than copied into it: both
 * surfaces count the same rows with the same selector, and a second copy of this
 * markup is exactly how the two would drift apart.
 */
export function SubagentHeader(props: {
  readonly context: Context;
  readonly rows: readonly SubagentRow[];
}) {
  const segments = createMemo(() => headerSegments(counts(props.rows)));

  return (
    <box flexDirection="row">
      <For each={segments()}>
        {(segment, index) => (
          <>
            <Show when={index() > 0}>
              <text fg={resolveFg(props.context, SUBDUED_TOKEN, SUBDUED_FALLBACK)}> · </text>
            </Show>
            <text fg={resolveFg(props.context, segment.token, segment.fallback)}>{segment.text}</text>
          </>
        )}
      </For>
    </box>
  );
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
  const [viewport, setViewport] = createSignal<{ height: number }>();

  createEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    onCleanup(() => clearInterval(timer));
  });

  // Reactive on purpose: `tick()` re-arms the memo on every coalesced data
  // event, `now()` keeps the elapsed clocks ticking.
  const rows = createMemo(() => {
    props.tick();
    now();
    // One model list for every row; each row's percentage comes from its own
    // session's message cache, which the sync effect below asks for. A row whose
    // data is missing shows no percentage rather than a wrong one.
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
      contextPercent: rowPercent(context, models, row.id),
    }));
  });

  // The rows are the panel, so their sessions must have their pending permission
  // requests and their messages cached before the first read: the host only loads
  // the transcript of the session you are in, so a row for a subagent you have
  // not opened has nothing to read otherwise. Both helpers ask once per session
  // per generation and never reject, so one session cannot take the rest down.
  createEffect(() => {
    const sessionID = panel.sessionID;
    const ids = [sessionID, ...collectSubagents(safeList(context), sessionID).map((row) => row.id)];
    for (const id of ids) ensureMessages(context, id);
    ensureSessions(context, ids);
  });

  // `list()` is a cache read: a request asked after the panel opened would stay
  // invisible without syncing the session the event names.
  const stopPermission = context.data.on("permission.asked", (event) => {
    const sessionID = event.data?.sessionID;
    if (!sessionID) return;
    void safeSync(context, sessionID).then(() => props.tick());
  });
  onCleanup(stopPermission);

  // ponytail: `viewport()` is read while this memo recomputes, which happens on
  // a data tick, not on a resize: a pure terminal resize with no data event
  // leaves the window stale until the next tick. Upgrade path: a host resize
  // signal feeding `tick()`.
  // A missing ref or a height yoga has not computed yet means "not measured":
  // show a plausible window instead of one row, and re-read on the next tick.
  const capacity = createMemo(() => {
    const height = viewport()?.height;
    return typeof height === "number" && height > 0
      ? rowCapacity(height, ROW_LINES, CHROME_LINES)
      : FALLBACK_ROWS;
  });

  // `rowWindow` moves the window by the minimum amount from where it already
  // was, so it needs the previous start. A closure variable, not a signal: the
  // value is written while the memo recomputes and read on the next one, and a
  // signal would either loop or lag a render behind.
  let from = 0;
  const view = createMemo(() => {
    const window = rowWindow(rows().length, Math.max(0, cursor()), capacity(), from);
    from = window.start;
    return window;
  });
  const shown = createMemo(() => rows().slice(view().start, view().end));

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

  const rowFg = (row: SubagentRow, state: State, index: number) => {
    if (index === Math.min(cursor(), lastIndex())) {
      return resolveFg(context, SELECTED_TOKEN, SELECTED_FALLBACK);
    }
    if (row.needsPermission) return resolveFg(context, WARNING_TOKEN, WARNING_FALLBACK);
    const marker = MARKERS[state];
    return resolveFg(context, marker.token, marker.fallback);
  };

  return (
    <box flexDirection="column">
      <SubagentHeader context={context} rows={rows()} />
      <Show
        when={rows().length > 0}
        fallback={<text fg={subdued()}>No subagents in this session</text>}
      >
        {/* The only scrolling container: header, fallback and hint stay outside
            it, and `maxHeight`/`overflow` clip when a measurement is stale. */}
        <box
          ref={setViewport}
          flexDirection="column"
          flexShrink={1}
          maxHeight="100%"
          overflow="hidden"
        >
          <For each={shown()}>
            {(row, index) => {
              const parts = () => rowParts(row, now(), sized);
              // `shown()` is a slice, so the row's own index is what decides
              // the highlight, not its position inside the slice.
              const at = () => view().start + index();
              const fg = () => rowFg(row, parts().state, at());
              // The panel publishes its own width, so it wraps to what it really
              // has instead of the sidebar's constant. A missing, zero or
              // nonsensical measurement omits the option and takes the default.
              const measured = finite(panel.width);
              const available = measured === undefined ? undefined : measured - LABEL_COLUMN;
              const sized = available !== undefined && available > 0 ? { labelWidth: available } : undefined;
              return (
                <box flexDirection="column">
                  {/* One node per wrapped label line, all in the row's color. */}
                  <For each={parts().label}>
                    {(line) => <text fg={fg()}>{line}</text>}
                  </For>
                  <Show when={parts().meta !== ""}>
                    <text fg={subdued()}>{parts().meta}</text>
                  </Show>
                </box>
              );
            }}
          </For>
        </box>
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