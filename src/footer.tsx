/**
 * `prompt.footer.status`: a live subagent count for the current session's root.
 *
 * This slot renders alongside the composer, so it is up while a session is
 * open, and its input already carries the session id — no router read and no
 * guessing which session to describe. The counts come from the same selector the
 * panel uses, and a counter that would report nothing renders nothing instead
 * of leaving a blank line in the footer.
 */

import type { Context } from "@opencode/plugin/tui/context";
import { createMemo, Show } from "solid-js";
import { collectSubagents, counts, footerText } from "./subagents.js";
import type { SubagentSession } from "./subagents.js";
import { resolveFg, SUBDUED_FALLBACK, SUBDUED_TOKEN } from "./theme.js";

function safeList(context: Context): SubagentSession[] {
  try {
    return (context.data.session.list() ?? []) as SubagentSession[];
  } catch {
    return [];
  }
}

function SubagentCounter(props: {
  readonly context: Context;
  readonly sessionID: string | undefined;
  readonly tick: () => number;
}) {
  const text = createMemo(() => {
    props.tick();
    const sessionID = props.sessionID;
    // No session in the slot input: nothing to count, and picking one would
    // report a session the user is not looking at.
    if (sessionID === undefined) return undefined;
    return footerText(counts(collectSubagents(safeList(props.context), sessionID)));
  });

  return (
    <Show when={text()}>
      <text fg={resolveFg(props.context, SUBDUED_TOKEN, SUBDUED_FALLBACK)}>{text()}</text>
    </Show>
  );
}

export function registerFooter(context: Context, tick: () => number): () => void {
  return context.ui.slot({
    // Additive: several claims at one anchor coexist in plugin enable order, so
    // this stacks with the status line when `slot` is also `prompt.footer.status`.
    append: "prompt.footer.status",
    render: (input) => <SubagentCounter context={context} sessionID={input.sessionID} tick={tick} />,
  });
}