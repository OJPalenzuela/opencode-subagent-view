/**
 * Keymap command ids registered by this plugin. The id is the keymap registry
 * key: a duplicate lets one command shadow another, so the set must stay
 * unique — asserted by `commands.test.ts`.
 */
export const COMMAND_IDS = {
  openPanel: "subagent-view.panel.open",
  nextRow: "subagent-view.panel.next",
  previousRow: "subagent-view.panel.previous",
  enterRow: "subagent-view.panel.enter",
  toggleCompleted: "subagent-view.panel.completed",
  toggleFullscreen: "subagent-view.panel.fullscreen",
  closePanel: "subagent-view.panel.close",
} as const;
