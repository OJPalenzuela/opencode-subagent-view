import { describe, expect, it } from "vitest";
import { contextUsage, ensureMessages, findModelInfo, rowPercent, usagePercent } from "./context.js";
import type { MessageCache, MessageLike, MessageTokens, ModelInfoLike } from "./context.js";

function info(id: string, providerID: string, limit: number, modelID = id): ModelInfoLike {
  return { id, modelID, providerID, limit: { context: limit } };
}

/** Minimal stand-in for the host message cache: no TUI, no data layer. */
function host(
  message: Partial<MessageCache["data"]["session"]["message"]> = {},
): MessageCache {
  return {
    data: {
      session: {
        message: { list: () => [], sync: () => Promise.resolve(), ...message },
      },
    },
  };
}

function assistant(tokens?: MessageTokens): MessageLike {
  return {
    type: "assistant",
    model: { id: "claude-sonnet-4-6", providerID: "anthropic" },
    tokens,
  };
}

const MODELS: ModelInfoLike[] = [
  info("claude-sonnet-4-6", "anthropic", 200_000),
  info("gpt-5", "openai", 400_000),
  // Same bare id under two providers: only the provider can disambiguate.
  info("shared", "anthropic", 100_000),
  info("shared", "openai", 300_000),
  // `id` carries the provider prefix while `modelID` stays bare.
  info("openai/gpt-5-mini", "openai", 128_000, "gpt-5-mini"),
];

describe("findModelInfo", () => {
  it("resolves by provider and id", () => {
    expect(findModelInfo(MODELS, { id: "claude-sonnet-4-6", providerID: "anthropic" })?.limit?.context).toBe(
      200_000,
    );
    expect(findModelInfo(MODELS, { id: "shared", providerID: "openai" })?.limit?.context).toBe(300_000);
  });

  it("resolves against the modelID field when the id differs", () => {
    const found = findModelInfo(MODELS, { id: "gpt-5-mini", providerID: "openai" });
    expect(found?.id).toBe("openai/gpt-5-mini");
    expect(found?.limit?.context).toBe(128_000);
  });

  it("falls back to the id alone when the provider is unknown", () => {
    expect(findModelInfo(MODELS, { id: "claude-sonnet-4-6", providerID: "mystery" })?.limit?.context).toBe(
      200_000,
    );
    expect(findModelInfo(MODELS, { id: "shared" })?.limit?.context).toBe(100_000);
  });

  it("returns undefined when nothing matches", () => {
    expect(findModelInfo(MODELS, { id: "nope", providerID: "anthropic" })).toBeUndefined();
    expect(findModelInfo(MODELS, { id: "nope" })).toBeUndefined();
  });

  it("returns undefined for partial arguments instead of throwing", () => {
    expect(findModelInfo(undefined, { id: "gpt-5", providerID: "openai" })).toBeUndefined();
    expect(findModelInfo([], { id: "gpt-5", providerID: "openai" })).toBeUndefined();
    expect(findModelInfo(MODELS, undefined)).toBeUndefined();
    expect(findModelInfo(MODELS, {})).toBeUndefined();
    expect(findModelInfo(MODELS, { id: "" })).toBeUndefined();
    expect(findModelInfo(MODELS, { id: 7 } as never)).toBeUndefined();
  });

  it("ignores entries that are not records", () => {
    const list = [null, undefined, { id: "gpt-5", providerID: "openai", limit: { context: 7 } }];
    expect(findModelInfo(list as ModelInfoLike[], { id: "gpt-5", providerID: "openai" })?.limit?.context).toBe(7);
    expect(findModelInfo(list as ModelInfoLike[], { id: "other" })).toBeUndefined();
  });
});

describe("contextUsage", () => {
  const full: MessageTokens = {
    input: 10,
    output: 5,
    reasoning: 2,
    cache: { read: 20, write: 15 },
  };

  it("reads the last assistant message, not the first", () => {
    const usage = contextUsage([assistant({ input: 10 }), assistant({ input: 40 })], 100);
    expect(usage).toEqual({ used: 40, limit: 100, percent: 40 });
  });

  it("sums input, output, reasoning and both cache counters", () => {
    expect(contextUsage([assistant(full)], 100)).toEqual({ used: 52, limit: 100, percent: 52 });
  });

  it("defaults every optional token field to zero", () => {
    expect(contextUsage([assistant({ input: 10 })], 100)).toEqual({ used: 10, limit: 100, percent: 10 });
    expect(contextUsage([assistant({})], 100)).toEqual({ used: 0, limit: 100, percent: 0 });
    expect(contextUsage([assistant({ cache: {} })], 100)?.used).toBe(0);
  });

  it("treats non-finite token fields as zero", () => {
    const usage = contextUsage([assistant({ input: Number.NaN, output: 10 })], 100);
    expect(usage?.used).toBe(10);
  });

  it("ignores non-assistant entries and assistant entries without tokens", () => {
    const messages: MessageLike[] = [
      assistant({ input: 10 }),
      { type: "user" },
      { type: "compaction" },
      { type: "assistant" },
      assistant({ input: 60 }),
    ];
    expect(contextUsage(messages, 100)?.used).toBe(60);

    expect(contextUsage([assistant({ input: 10 }), { type: "user" }], 100)?.used).toBe(10);
  });

  it("does not clamp a percentage above the limit", () => {
    expect(contextUsage([assistant({ input: 128 })], 100)?.percent).toBe(128);
  });

  it("returns undefined for a missing, zero, negative or non-finite limit", () => {
    const messages = [assistant({ input: 10 })];
    for (const limit of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(contextUsage(messages, limit)).toBeUndefined();
    }
  });

  it("returns undefined when there is no usable message", () => {
    expect(contextUsage([], 100)).toBeUndefined();
    expect(contextUsage(undefined, 100)).toBeUndefined();
    expect(contextUsage([{ type: "user" }, { type: "assistant" }], 100)).toBeUndefined();
  });

  it("never throws on partial data", () => {
    expect(contextUsage([{ type: "assistant", tokens: null } as never], 100)).toBeUndefined();
    expect(contextUsage([null as never], 100)).toBeUndefined();
  });
});

describe("usagePercent", () => {
  const messages: MessageLike[] = [
    assistant({ input: 74_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }),
  ];

  it("resolves the model of the most recent request", () => {
    expect(usagePercent(MODELS, messages)).toBe(37);
  });

  it("returns undefined without a usable message or a known model", () => {
    expect(usagePercent(MODELS, [])).toBeUndefined();
    expect(usagePercent(undefined, messages)).toBeUndefined();
    expect(usagePercent([], messages)).toBeUndefined();
    expect(
      usagePercent([info("gpt-5", "openai", 400_000)], [
        { type: "assistant", model: { id: "unknown", providerID: "openai" }, tokens: { input: 1 } },
      ]),
    ).toBeUndefined();
  });
});

describe("rowPercent", () => {
  const loaded = host({ list: () => [assistant({ input: 74_000 })] });

  it("produces a percentage for a row whose session is loaded", () => {
    expect(rowPercent(loaded, MODELS, "ses_row")).toBe(37);
  });

  it("returns undefined when the row's data is unusable", () => {
    expect(rowPercent(host(), MODELS, "ses_empty")).toBeUndefined();
    expect(rowPercent(loaded, [], "ses_row")).toBeUndefined();
    expect(rowPercent(loaded, MODELS, undefined)).toBeUndefined();
    expect(
      rowPercent(
        host({
          list: () => {
            throw new Error("cache invalidated");
          },
        }),
        MODELS,
        "ses_broken",
      ),
    ).toBeUndefined();
  });
});

describe("ensureMessages", () => {
  it("asks once per session, independently, and never throws on a rejection", () => {
    const asked: string[] = [];
    const context = host({
      sync: (sessionID) => {
        asked.push(sessionID);
        return Promise.reject(new Error("no such session"));
      },
    });

    ensureMessages(context, "ses_a");
    ensureMessages(context, "ses_a");
    expect(asked).toEqual(["ses_a"]);

    ensureMessages(context, "ses_b");
    expect(asked).toEqual(["ses_a", "ses_b"]);
  });

  it("does not throw when the sync throws synchronously", () => {
    const context = host({
      sync: () => {
        throw new Error("data layer gone");
      },
    });
    expect(() => ensureMessages(context, "ses_throw")).not.toThrow();
    expect(() => ensureMessages(context, undefined)).not.toThrow();
  });
});
