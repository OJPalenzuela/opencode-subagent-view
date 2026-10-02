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

function SubagentGlance(props: {
  readonly context: Context;
  readonly sessionID: string;
  readonly tick: () => number;
}) {
  const [now, setNow] = createSignal(Date.now());

  createEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    onCleanup(() => clearInterval(timer));
  });

  // `permission.list()` is a cache read the host only fills for the session you
  // are in, so without this a subagent blocked on a permission would answer
  // "none": neither marked `⚠` nor ranked first on a session where the panel was
  // never opened. One ask per session per generation, shared with the panel.
  createEffect(() => {
    const sessionID = props.sessionID;
    ensureSessions(props.context, [
      sessionID,
      ...collectSubagents(safeList(props.context), sessionID).map((row) => row.id),
    ]);
  });

  // Reactive on purpose: `tick()` re-arms the memo on every coalesced data
  // event, which is what turns a newly spawned subagent into a line.
  const rows = createMemo(() => {
    props.tick();
    return topRows(
      collectSubagents(
        safeList(props.context),
        props.sessionID,
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
    render: (input) => <SubagentGlance context={context} sessionID={input.sessionID} tick={tick} />,
  });
}