/**
 * Theme resolution shared by the status line and the subagent panel.
 *
 * Theme tokens resolve to either a hex string or an RGBA buffer depending on
 * the theme, and any token can be missing, so every read falls back to a hex
 * constant instead of throwing.
 */

import type { Context } from "@opencode/plugin/tui/context";
import type { State } from "./format.js";

export const SUBDUED_TOKEN = "text.subdued";
export const SUBDUED_FALLBACK = "#546e7a";
export const WARNING_TOKEN = "text.feedback.warning.default";
export const WARNING_FALLBACK = "#ffcb6b";
export const SELECTED_TOKEN = "text.action.primary.selected";
export const SELECTED_FALLBACK = "#82aaff";

/**
 * Marker glyph per state, paired with the theme token used to color it, and
 * `bracketed` — the panel row's form. All three live in one entry so a bracket
 * and its color can never come from different states.
 */
export const MARKERS = {
  running: { glyph: "●", bracketed: "[ ]", token: WARNING_TOKEN, fallback: WARNING_FALLBACK },
  idle: { glyph: "◌", bracketed: "[◌]", token: SUBDUED_TOKEN, fallback: SUBDUED_FALLBACK },
  done: { glyph: "✓", bracketed: "[✓]", token: "text.feedback.success.default", fallback: "#c3e88d" },
  error: { glyph: "✕", bracketed: "[✕]", token: "text.feedback.error.default", fallback: "#f07178" },
  interrupted: { glyph: "⊘", bracketed: "[⊘]", token: SUBDUED_TOKEN, fallback: SUBDUED_FALLBACK },
  unknown: { glyph: "○", bracketed: "[○]", token: SUBDUED_TOKEN, fallback: SUBDUED_FALLBACK },
} as const satisfies Record<State, { glyph: string; bracketed: string; token: string; fallback: string }>;

export const PERMISSION_GLYPH = "⚠";
export const CURRENT_GLYPH = "›";

function colorToHex(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const buffer = (value as { buffer?: unknown } | undefined)?.buffer;
  if (!Array.isArray(buffer)) return undefined;
  const pair = (channel: unknown) =>
    Math.max(0, Math.min(255, Math.round(Number(channel) || 0)))
      .toString(16)
      .padStart(2, "0");
  return `#${pair(buffer[0])}${pair(buffer[1])}${pair(buffer[2])}`;
}

export function resolveFg(context: Context, tokenPath: string, fallback: string): string {
  try {
    const value = tokenPath
      .split(".")
      .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], context.theme);
    return colorToHex(value) ?? fallback;
  } catch {
    return fallback;
  }
}