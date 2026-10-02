/**
 * `sidebar.content`: the few subagents that need you, one line each, in the
 * space under the sidebar's own sections.
 *
 * This is the glance, not the panel. It shows the head of the panel's own
 * ordering — permission-pending first, then running, then the most recent — and
 * stops at three lines, because `/subagents` is where the rest of the detail
 * lives. Same defensive reads and the same coalesced `tick` as the panel: a
 * half-synced data layer degrades to fewer lines, never to an exception inside
 * a render.
 *
 * What is synced is exactly what the ranking depends on: the widget's `⚠` and
 * its first-ranked slot both read `permission.list()`, so it asks once per
 * generation for the session and its subagents, the same ask the panel makes.
 * Transcripts and the model list are not, because the one segment they feed —
 * `NN% ctx` — does not exist in a three-line glance; paying for every
 * subagent's messages to draw a line that has no context on it would be the
 * expensive kind of wrong.
 */

import type { Context } from "@opencode/plugin/tui/context";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ensureSessions } from "./context.js";
import { collectSubagents, sidebarLine, stateOf, topRows } from "./subagents.js";
import type { PermissionLookup, StatusLookup, SubagentRow, SubagentSession } from "./subagents.js";
import { MARKERS, resolveFg } from "./theme.js";

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

function SubagentGlance(props: {
  readonly context: Context;
  /** The slot's declared id: guaranteed by the type, not by the runtime. */
  readonly slotSessionID: string;
  readonly tick: () => number;
}) {
  const [now, setNow] = createSignal(Date.now());

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

  // `permission.list()` is a cache read the host only fills for the session you
  // are in, so without this a subagent blocked on a permission would answer
  // "none": neither marked `⚠` nor ranked first on a session where the panel was
  // never opened.
  //
  // `tick()` is read here on purpose, and it is the whole reason this effect is
  // not one-shot: a subagent spawned after the widget mounted is invisible to a
  // plain cache read, and the only signal that it exists is the data event its
  // creation raises — which bumps the shared tick. Re-running on every tick is
  // cheap because `ensureSessions` skips any id it already synced this
  // generation, so a repeat costs one `Set` lookup per id.
  createEffect(() => {
    props.tick();
    const id = sessionID();
    // No session resolved: there is no cache to warm.
    if (id === undefined) return;
    ensureSessions(props.context, [
      id,
      ...collectSubagents(safeList(props.context), id).map((row) => row.id),
    ]);
  });

  // Reactive on purpose: `tick()` re-arms the memo on every coalesced data
  // event, which is what turns a newly spawned subagent into a line.
  const rows = createMemo(() => {
    props.tick();
    const id = sessionID();
    // Stopping here keeps "no session" distinct from "no subagents", which is
    // the exact distinction this widget failed to make when it shipped.
    if (id === undefined) return [];
    return topRows(
      collectSubagents(
        safeList(props.context),
        id,
        safeStatusLookup(props.context),
        safePermissionLookup(props.context),
      ),
    );
  });

  const line = (row: SubagentRow) => sidebarLine(row, now());

  // State color, from the same `MARKERS` entry the line's marker comes from.
  const fg = (row: SubagentRow) => {
    const marker = MARKERS[stateOf(row, now())];
    return resolveFg(props.context, marker.token, marker.fallback);
  };

  // No subagents means no widget: a placeholder here would leave a permanent
  // empty block in every session that has never spawned one.
  return (
    <Show when={rows().length > 0}>
      <box flexDirection="column">
        <For each={rows()}>
          {(row: SubagentRow) => <text fg={fg(row)}>{line(row)}</text>}
        </For>
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