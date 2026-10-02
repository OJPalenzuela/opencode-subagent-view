/**
 * Pure context-window math.
 *
 * No TUI imports: the model list is injected as a parameter and the plugin
 * context is only read through the structural subset `MessageCache`, so a fake
 * object is enough to test against. A partial list degrades to `undefined`
 * instead of throwing, so this stays unit testable in isolation.
 *
 * Every shape below is a structural subset of the v2 data layer types
 * (`ModelRef`, `ModelInfo`, `TokenUsageInfo`, `SessionMessageInfo`). Only the
 * fields this feature reads are declared, and all of them are optional, so a
 * record the host has not filled in yet is not a crash.
 */

import { finite } from "./format.js";

/** Structural subset of `ModelRef`: what identifies a model. */
export interface ModelRefLike {
  readonly id?: string;
  readonly providerID?: string;
}

/** Structural subset of `ModelInfo`: what a context limit needs. */
export interface ModelInfoLike {
  readonly id?: string;
  /** Same model, unprefixed. Present on every entry; `id` may carry a prefix. */
  readonly modelID?: string;
  readonly providerID?: string;
  readonly limit?: { readonly context?: number };
}

/** Structural subset of `TokenUsageInfo`; every counter is optional here. */
export interface MessageTokens {
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cache?: { readonly read?: number; readonly write?: number };
}

/** Structural subset of `SessionMessageInfo`, assistant or not. */
export interface MessageLike {
  readonly type?: string;
  readonly model?: ModelRefLike;
  readonly tokens?: MessageTokens;
}

export interface ContextUsage {
  readonly used: number;
  readonly limit: number;
  /** Whole percent, unclamped: an over-long session must be able to read `128`. */
  readonly percent: number;
}

/** An entry answers to either of its two id fields. */
function idOf(model: ModelInfoLike | undefined | null, id: string): boolean {
  return model?.id === id || model?.modelID === id;
}

/**
 * Resolve the `ModelInfo` behind a `ModelRef`.
 *
 * The model collection is a list with no `get`, so this scans it: provider plus
 * id first, because two providers can publish the same bare id, then the id
 * alone for a provider the collection does not carry. Anything missing on
 * either side resolves to `undefined` rather than throwing.
 */
export function findModelInfo(
  models: readonly ModelInfoLike[] | undefined,
  ref: ModelRefLike | undefined,
): ModelInfoLike | undefined {
  if (!Array.isArray(models) || models.length === 0) return undefined;
  const id = ref?.id;
  if (typeof id !== "string" || id === "") return undefined;

  const provider = ref?.providerID;
  if (typeof provider === "string" && provider !== "") {
    const exact = models.find((model) => model?.providerID === provider && idOf(model, id));
    if (exact) return exact;
  }
  return models.find((model) => idOf(model, id));
}

/** Last assistant message that carries tokens — the most recent real request. */
function lastRequest(
  messages: readonly MessageLike[] | undefined,
): MessageLike | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "assistant") continue;
    if (typeof message.tokens !== "object" || message.tokens === null) continue;
    return message;
  }
  return undefined;
}

/**
 * Context occupancy of the most recent request, as `{ used, limit, percent }`.
 *
 * The host's own context formula is not observable through the plugin API, so
 * this sums the last assistant message's own counters (input + cache read +
 * cache write + output + reasoning) against the model's declared context limit:
 * it measures what the *latest* request put in the window, not the cumulative
 * session total, which grows monotonically and would report nonsense. Compaction
 * and provider-side prompt caching shift the real figure a little.
 *
 * ponytail: `used / limit.context` is an approximation, not the host's number —
 * swap it for the host's formula (a token-count endpoint, or a field on
 * `SessionInfo`) the moment either becomes observable through the plugin API.
 *
 * The percentage is deliberately unclamped: a session that genuinely overflowed
 * should read `128`, not a reassuring lie.
 */
export function contextUsage(
  messages: readonly MessageLike[] | undefined,
  limit: number | undefined,
): ContextUsage | undefined {
  const max = finite(limit);
  if (max === undefined || max <= 0) return undefined;

  const request = lastRequest(messages);
  const tokens = request?.tokens;
  if (!tokens) return undefined;

  const used =
    (finite(tokens.input) ?? 0) +
    (finite(tokens.output) ?? 0) +
    (finite(tokens.reasoning) ?? 0) +
    (finite(tokens.cache?.read) ?? 0) +
    (finite(tokens.cache?.write) ?? 0);

  return { used, limit: max, percent: Math.round((used / max) * 100) };
}

/**
 * Whole-percent occupancy for a session, from the same model list both call
 * sites already hold. The ref comes from the most recent request rather than
 * from the session record, so the usage and the limit it is divided by always
 * describe one and the same request even if the session changed model.
 *
 * `undefined` means "not computable yet": no messages loaded, no tokens on
 * them, or a model the collection does not carry. Callers must render nothing
 * rather than a zero.
 */
export function usagePercent(
  models: readonly ModelInfoLike[] | undefined,
  messages: readonly MessageLike[] | undefined,
): number | undefined {
  return contextUsage(messages, findModelInfo(models, lastRequest(messages)?.model)?.limit?.context)?.percent;
}

/** The two host calls a context segment needs, as a structural subset of `Context`. */
export interface MessageCache {
  readonly data: {
    readonly session: {
      readonly message: {
        readonly list: (sessionID: string) => readonly MessageLike[] | undefined;
        readonly sync: (sessionID: string) => Promise<unknown>;
      };
    };
  };
}

/** Sessions already asked for their messages, for this plugin generation. */
const SYNCED_MESSAGES = new Set<string>();

/**
 * Ask for one session's messages, at most once per plugin generation.
 *
 * Messages live in their own cache, so `session.sync` does not fill them, and the
 * host only loads the transcript of the session you are in — a panel row for a
 * subagent you never opened has nothing to read otherwise. Syncing per refresh
 * tick would be a request per tick, so the guard is a module-level Set; after the
 * first ask the data layer keeps the cache current itself. Both a synchronous
 * throw and a rejected promise are swallowed: a session whose messages cannot be
 * loaded simply has no `NN% ctx`.
 */
export function ensureMessages(context: MessageCache, sessionID: string | undefined): void {
  if (!sessionID || SYNCED_MESSAGES.has(sessionID)) return;
  SYNCED_MESSAGES.add(sessionID);
  try {
    void context.data.session.message.sync(sessionID).catch(() => {});
  } catch {
    // No messages, no segment — never an error.
  }
}

/**
 * A row's `contextPercent`, from the model list every caller already holds and
 * that session's message cache. One place, so the line and a panel row can never
 * disagree; `undefined` when the data is not computable, exactly as
 * `usagePercent` documents.
 */
export function rowPercent(
  context: MessageCache,
  models: readonly ModelInfoLike[] | undefined,
  sessionID: string | undefined,
): number | undefined {
  if (!sessionID) return undefined;
  try {
    return usagePercent(models, context.data.session.message.list(sessionID) ?? []);
  } catch {
    return undefined;
  }
}
