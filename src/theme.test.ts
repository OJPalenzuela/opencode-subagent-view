import { describe, expect, it } from "vitest";
import { STATE } from "./format.js";
import type { State } from "./format.js";
import { MARKERS } from "./theme.js";

const STATES: readonly State[] = Object.values(STATE);

describe("MARKERS", () => {
  it("has exactly one entry per state and no extras", () => {
    expect(Object.keys(MARKERS).sort()).toEqual([...STATES].sort());
  });

  it("gives every state a distinct glyph", () => {
    const glyphs = STATES.map((state) => MARKERS[state].glyph);
    expect(new Set(glyphs).size).toBe(STATES.length);
  });

  it("gives every state a token and a hex fallback", () => {
    for (const state of STATES) {
      expect(MARKERS[state].token).not.toBe("");
      expect(MARKERS[state].fallback).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("brackets the panel marker of every state, one distinct form each", () => {
    expect(STATES.map((state) => MARKERS[state].bracketed)).toEqual(["[ ]", "[◌]", "[✓]", "[✕]", "[⊘]", "[○]"]);
  });
});
