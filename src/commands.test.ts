import { describe, expect, it } from "vitest";
import { COMMAND_IDS } from "./commands.js";

describe("COMMAND_IDS", () => {
  it("registers every keymap command id exactly once", () => {
    const ids = Object.values(COMMAND_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("namespaces every command id to the plugin", () => {
    for (const id of Object.values(COMMAND_IDS)) {
      expect(id.startsWith("subagent-view.")).toBe(true);
    }
  });
});
