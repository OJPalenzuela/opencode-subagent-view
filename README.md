# opencode-subagent-view

When you are inside a subagent's session in the OpenCode v2 TUI, the interface
stops telling you what that subagent is doing — no model, no token usage, no
clock. This plugin adds one live line above the composer for exactly that case:
state dot, agent name, model, elapsed time and tokens, e.g.

```
● explore · claude-sonnet-4-6 · ⏱ 02:34 · 12.4k tok
```

It renders nothing in root sessions, so it stays out of the way everywhere else.

## Requirements

- OpenCode **v2** (TUI plugin API `@opencode/plugin` `>=2`)
- Node.js `>= 22.13`

## Install

### With the OpenCode CLI

```sh
# from npm
opencode plugin add opencode-subagent-view

# or directly from the repository
opencode plugin add github:OJPalenzuela/opencode-subagent-view
```

`opencode plugin add` installs the package into the global OpenCode config and
registers it. To pass plugin `options`, use the config-file form below.

### From a local checkout

Build once, then point OpenCode at the repository directory in
`~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-subagent-view",
      "options": {}
    }
  ]
}
```

Restart the TUI after editing the config.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `slot` | `"session.composer.top"` | Where the line is rendered. Also accepts `"prompt.footer.status"`. Any other value falls back to the default. |

```json
"options": { "slot": "prompt.footer.status" }
```

## How it works

| Concern | Behaviour |
|---------|-----------|
| Elapsed clock | 1-second tick; frozen at `time.idle` once the session reports an `outcome` |
| Record changes | `data.listen` with ~200 ms coalescing, so event bursts render once |
| Session switch | `data.session.sync(sessionID)` on change |
| State markers | `●` running, `✓` done, `✕` failed, `⊘` interrupted, `○` unknown |
| Partial data | Missing model/tokens/time are omitted; nothing throws |

> Whether both slots are actually published inside a *subagent* session view is
> TUI-runtime behaviour that cannot be checked from a shell. Confirm the line
> appears where you expect it in the live TUI, and try the other `slot` value if
> it does not.

## Development

```bash
pnpm install && pnpm build   # emit dist/tui.js
pnpm test                    # unit tests for the formatting helpers
pnpm typecheck               # tsc --noEmit
```

Formatting logic lives in `src/format.ts` and is deliberately free of TUI imports
so it can be unit tested in isolation.

## Release

Publishing is automated: pushing a `v*` tag that matches `package.json`'s version
triggers the [`release`](.github/workflows/release.yml) workflow, which runs the
tests, publishes to npm via trusted publishing (OIDC) and creates the GitHub
release with generated notes.

```sh
npm version patch   # or minor / major: bumps package.json, commits, tags
git push --follow-tags
```

## License

MIT — see [LICENSE](./LICENSE).