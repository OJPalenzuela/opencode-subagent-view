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
import { elapsedMs, formatCost, formatDuration, formatTokens } from "./format.js";
import { collectSubagents, counts, orderRows, stateOf, visibleRows } from "./subagents.js";
import type {
  PermissionLookup,
  StatusLookup,
  SubagentRow,
  SubagentSession,
} from "./subagents.js";
import {
  CURRENT_GLYPH,
  MARKERS,
  PERMISSION_GLYPH,
  resolveFg,
  SELECTED_FALLBACK,
  SELECTED_TOKEN,
  SUBDUED_FALLBACK,
  SUBDUED_TOKEN,
  WARNING_FALLBACK,
  WARNING_TOKEN,
} from "./theme.js";

export const PANEL_NAME = "subagent-view.panel";
const PLUGIN_ID = "subagent-view";
const PREFS_KEY = "panel";
const ELAPSED_TICK_MS = 1_000;
const INDENT = "  ";
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

/** `› ● explore · model · ⏱ 02:34 · 12.4k tok · $0.04 ⚠` */
function rowLine(row: SubagentRow, now: number): string {
  const parts: string[] = [];
  if (row.model) parts.push(row.model);

  const elapsed = elapsedMs(row, now);
  if (elapsed !== undefined) parts.push(`⏱ ${formatDuration(elapsed)}`);

  if (row.tokens !== undefined && row.tokens > 0) parts.push(`${formatTokens(row.tokens)} tok`);
  if (row.cost !== undefined && row.cost > 0) parts.push(formatCost(row.cost));

  const current = row.isCurrent ? CURRENT_GLYPH : " ";
  const glyph = MARKERS[stateOf(row, now)].glyph;
  const indent = INDENT.repeat(Math.max(0, row.depth - 1));
  const meta = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
  const pending = row.needsPermission ? ` ${PERMISSION_GLYPH}` : "";

  return `${current} ${glyph} ${indent}${row.label}${meta}${pending}`;
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
    return orderRows(
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
        id: `${PLUGIN_ID}.panel.next`,
        title: "Next subagent",
        bind: "j",
        run: guarded(() => move(1)),
      },
      {
        id: `${PLUGIN_ID}.panel.previous`,
        title: "Previous subagent",
        bind: "k",
        run: guarded(() => move(-1)),
      },
      {
        id: `${PLUGIN_ID}.panel.open`,
        title: "Open the selected subagent session",
        bind: "enter",
        run: guarded(() => {
          const row = selected();
          if (!row) return;
          context.ui.router.navigate({ type: "session", sessionID: row.id });
        }),
      },
      {
        id: `${PLUGIN_ID}.panel.completed`,
        title: "Toggle completed subagents",
        bind: "c",
        run: guarded(() => {
          void setPrefs((draft) => {
            draft.showCompleted = !draft.showCompleted;
          }).catch(() => {});
        }),
      },
      {
        id: `${PLUGIN_ID}.panel.fullscreen`,
        title: "Toggle full screen panel",
        bind: "f",
        run: guarded(() => panel.toggleFullscreen()),
      },
      {
        id: `${PLUGIN_ID}.panel.close`,
        title: "Close the subagents panel",
        bind: "escape",
        run: guarded(() => panel.close()),
      },
    ],
  }));

  const subdued = () => resolveFg(context, SUBDUED_TOKEN, SUBDUED_FALLBACK);

  const header = () => {
    const total = counts(rows());
    return `Subagents  ${total.running} run · ${total.done} done · ${total.failed} err`;
  };

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