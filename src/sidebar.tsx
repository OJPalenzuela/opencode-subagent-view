/**
 * `sidebar.content`: the panel's header and the panel's rows, capped at three
 * subagents, in the space under the sidebar's own sections.
 *
 * There is no format of its own here on purpose. The header is the panel's own
 * `SubagentHeader` component and every line is `rowParts`, the row the panel
 * draws, so the two surfaces cannot disagree about what a subagent looks like.
 * The only difference is room: three rows instead of a scrollable list, and no
 * cost segment (`{ cost: false }`). `/subagents` is the detailed view.
 *
 * Reads follow the panel: the same defensive wrappers, the same coalesced `tick`,
 * and a half-synced data layer degrades to fewer lines, never to an exception
 * inside a render.
 *
 * What is synced is exactly what is ranked or rendered. Every descendant's
 * pending permissions, because the `⚠` and the permission-first order both come
 * from `permission.list()`; the three displayed rows' transcripts, because
 * `NN% ctx` is on the row now and cannot be computed without them. Both go
 * through the shared once-per-generation helpers.
 */

import type { Context } from "@opencode/plugin/tui/context";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ensureMessages, ensureSessions, rowPercent } from "./context.js";
import type { ModelInfoLike } from "./context.js";
import { SubagentHeader } from "./panel.js";
import {
  collectSubagents,
  drawsSidebarRows,
  rowParts,
  stateOf,
  topRows,
} from "./subagents.js";
import type { PermissionLookup, StatusLookup, SubagentRow, SubagentSession } from "./subagents.js";
import { MARKERS, resolveFg, SUBDUED_FALLBACK, SUBDUED_TOKEN } from "./theme.js";

const ELAPSED_TICK_MS = 1_000;

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

/** Structural subset of the host route: only what a session id needs. */
interface RouteLike {
  readonly type?: string;
  readonly sessionID?: string;
}

function usableSessionID(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The session the widget describes: the slot's own id when it has one, else the
 * router's.
 *
 * Observed in the live TUI: `sidebar.content` declares a `sessionID` but does not
 * reliably populate it. Do not "simplify" the fallback away — an empty id is not
 * a harmless default. `collectSubagents` resolves no root from one and returns
 * zero rows on *every* call, which is indistinguishable from "this session has no
 * subagents", so the widget drew nothing at all while `/subagents` listed the
 * same subagents correctly.
 *
 * `undefined` means no session anywhere, and then there is no tree to report:
 * render nothing, which is correct rather than a silent failure.
 */
export function resolveSidebarSession(
  slotSessionID: unknown,
  readRoute: () => unknown,
): string | undefined {
  const fromSlot = usableSessionID(slotSessionID);
  if (fromSlot !== undefined) return fromSlot;
  try {
    const route = readRoute() as RouteLike | undefined;
    return route?.type === "session" ? usableSessionID(route.sessionID) : undefined;
  } catch {
    // A dead router is as good as no session: draw nothing.
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

const PREFS_KEY = "sidebar";
/** Expanded by default: a collapsed widget reads as a broken one. */
const SIDEBAR_TITLE = "Subagents";

interface SidebarPrefs {
  // Not `readonly`: `setPrefs` mutates a draft, so a readonly field rejects it.
  expanded: boolean;
}

function SubagentGlance(props: {
  readonly context: Context;
  /** The slot's declared id: guaranteed by the type, not by the runtime. */
  readonly slotSessionID: string;
  readonly tick: () => number;
}) {
  const [now, setNow] = createSignal(Date.now());
  // Same shape and key style as the panel's own prefs: persisted, so a collapse
  // survives a restart.
  const [prefs, setPrefs] = props.context.storage.store<SidebarPrefs>(PREFS_KEY, {
    initial: { expanded: true },
  });
  const toggle = () => {
    void setPrefs((draft) => {
      draft.expanded = !draft.expanded;
    }).catch(() => {});
  };

  // Deliberately a plain call and not a `createMemo`: the SDK documents
  // `panel.current()` and `tabs.list()` as "reactive when read in a Solid
  // computation" and says nothing of the sort for `router.current()`, so a cached
  // computation would keep whatever it computed at mount and go stale on the
  // first session switch — the same silent-nothing bug one level up. Both readers
  // below already re-run on every tick, which is enough.
  const sessionID = () =>
    resolveSidebarSession(props.slotSessionID, () => props.context.ui.router.current());

  createEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    onCleanup(() => clearInterval(timer));
  });

  // Reactive on purpose: `tick()` re-arms the memo on every coalesced data
  // event, which is what turns a newly spawned subagent into a line.
  // Every descendant: the header counts them and the ranking orders them.
  const all = createMemo(() => {
    props.tick();
    const id = sessionID();
    // Stopping here keeps "no session" distinct from "no subagents", which is
    // the exact distinction this widget failed to make when it first shipped.
    if (id === undefined) return [];
    return collectSubagents(
      safeList(props.context),
      id,
      safeStatusLookup(props.context),
      safePermissionLookup(props.context),
    );
  });

  // The three that get drawn, each carrying the one panel field a row needs and
  // this widget does not have on the record.
  const rows = createMemo(() => {
    const models = safeModels(props.context);
    return topRows(all()).map((row) => ({
      ...row,
      contextPercent: rowPercent(props.context, models, row.id),
    }));
  });

  // Permissions for every descendant, because the ranking reads them all: an
  // unwarmed row would answer "no permission pending" and sort below a running
  // one. Transcripts for the displayed rows only, because `NN% ctx` is the only
  // thing that needs them, and three rows are not thirty.
  //
  // `tick()` is read here on purpose, and it is the whole reason this effect is
  // not one-shot: a subagent spawned after the widget mounted is invisible to a
  // plain cache read, and the only signal that it exists is the data event its
  // creation raises — which bumps the shared tick. Re-running on every tick is
  // cheap because both helpers skip any id they already synced this generation,
  // so a repeat costs one `Set` lookup per id.
  createEffect(() => {
    props.tick();
    const id = sessionID();
    if (id === undefined) return;
    ensureSessions(props.context, [id, ...all().map((row) => row.id)]);
    for (const row of rows()) ensureMessages(props.context, row.id);
  });

  // State color, from the same `MARKERS` entry the row's marker comes from.
  const fg = (row: SubagentRow) => {
    const marker = MARKERS[stateOf(row, now())];
    return resolveFg(props.context, marker.token, marker.fallback);
  };

  const subdued = () => resolveFg(props.context, SUBDUED_TOKEN, SUBDUED_FALLBACK);

  // No subagents means no widget at all — not even a collapsed one, which in a
  // session that never spawned anything is indistinguishable from a broken
  // widget. With rows present the header always draws; only the rows collapse.
  const expanded = () => prefs.expanded;
  const open = () => drawsSidebarRows(expanded(), all().length > 0);

  return (
    <Show when={open()}>
      <box flexDirection="column">
        <SubagentHeader
          context={props.context}
          rows={all()}
          title={SIDEBAR_TITLE}
          expanded={expanded()}
          onToggle={toggle}
        />
        <Show when={expanded()}>
          <For each={rows()}>
            {(row: SubagentRow) => {
              // `cost: false` and `model: false`: the sidebar is the narrow surface, so it
              // spends its two label lines on the task and its one meta line on the metrics.
              const parts = () => rowParts(row, now(), { cost: false, model: false });
              return (
                <box flexDirection="column">
                  {/* One node per wrapped label line, all in the row's color. */}
                  <For each={parts().label}>
                    {(line) => <text fg={fg(row)}>{line}</text>}
                  </For>
                  <Show when={parts().meta !== ""}>
                    <text fg={subdued()}>{parts().meta}</text>
                  </Show>
                </box>
              );
            }}
          </For>
        </Show>
      </box>
    </Show>
  );
}

export function registerSidebar(context: Context, tick: () => number): () => void {
  return context.ui.slot({
    append: "sidebar.content",
    render: (input) => (
      <SubagentGlance context={context} slotSessionID={input.sessionID} tick={tick} />
    ),
  });
}