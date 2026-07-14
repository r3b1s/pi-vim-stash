# pi-vim-stash

Vim-style modal editing with prompt stash for [pi](https://github.com/earendil-works/pi)'s TUI editor.

A fused extension combining [pi-vim](https://github.com/lajarre/pi-vim) (modal editor) and [pi-stash](https://github.com/maxpetretta/pi-stash) (prompt stash) into a single package.

## Design Principles

- **Minimal external dependencies.** The only declared dependencies are the pi platform peer packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`). Clipboard access uses the native Rust addon (`@mariozechner/clipboard`) that is already a transitive dependency of `@earendil-works/pi-coding-agent`, accessed via `createRequire` — no additional dependencies are declared. No other runtime dependencies.
- **No code from deprecated package namespaces in direct imports.** All direct imports use only the `@earendil-works` namespace.

## Features

### Vim modal editing

Full modal text editing inside pi's TUI editor:

- **Normal mode** — navigate with `h`/`j`/`k`/`l`, `w`/`b`/`e`, `{`/`}`, `gg`/`G`, `%`, `f`/`F`/`t`/`T`, and more
- **Insert mode** — `i`, `I`, `a`, `A`, `o`, `O`, `c`, `C`, `s`, `S` to enter
- **Operators** — `d` (delete), `y` (yank), `c` (change)
- **Visual modes** — `v` (character), `V` (line), `gv` to reselect the last selection
- **Registers** — unnamed register with optional system-clipboard mirror
- **Undo/redo** — `u`/`Ctrl+R` with branching history
- **Motions** — character, word, paragraph, matching pair, line-relative
- **Text objects** — `iw`/`aw` (word), `iW`/`aW` (WORD), ``` `i"`/`a"`/`i'`/`a'`/`i``/`a`` ``` (quoted), `i(`/`a(`/`i)`/`a)`/`ib`/`ab`/`i[`/`a[`/`i]`/`a]`/`i{`/`a{`/`i}`/`a}`/`iB`/`aB` (bracketed)
- **Ex commands** — `:q` / `:qa` (quit), `:q!` / `:qa!` (quit without confirmation)
- **Count prefixes** — `3dw`, `2j`, etc.
- **Clipboard integration** — yank/paste to/from system clipboard via native platform commands
- **Cursor shape** — block cursor in normal mode, beam cursor in insert mode
- **Mode-specific border/label colors** — configurable via settings

### Prompt stash

Temporarily shelve a prompt draft and restore it later, inspired by Claude Code:

**`Alt+S`** (configurable) —
- **Editor has content**: saves the current draft to `.pi/stash.md`, clears the editor
- **Editor is empty**: restores the stashed draft back into the editor

The stash also auto-restores after the next prompt submission, letting you shelve one prompt, send another, and pick up where you left off.

## Install

```bash
pi install npm:@r3b1s/pi-vim-stash
```

Or straight from this repo:

```bash
pi install git:github.com/r3b1s/pi-vim-stash
```

## Usage

Once installed, pi automatically activates Vim-style modal editing in the TUI editor.

### Stash examples

```text
# While editing a long prompt, hit Alt+S to stash it
# → "Stashed prompt (auto-restores after submit)"

# Type and send a quick different prompt
# → Stash auto-restores into the editor

# Or clear the editor and hit Alt+S again
# → "Restored stashed prompt to the editor"

# Clear the editor and hit Alt+S when nothing is stashed
# → "Both the editor and stash are empty"
```

### Configuration

Set your preferred stash shortcut in `~/.pi/agent/keybindings.json`:

```json
{
  "pi-vim-stash.shortcut": "alt+s",
  "app.session.toggleSort": ["ctrl+s"]
}
```

Vim settings go under the `piVim` key in `~/.pi/agent/settings.json` or project `.pi/settings.json`:

```json
{
  "piVim": {
    "clipboardMirror": "all",
    "modeColors": {
      "normal": "borderAccent",
      "insert": "borderMuted",
      "visual": "borderAccent",
      "visualLine": "borderAccent",
      "ex": "warning"
    },
    "syncBorderColorWithMode": true
  }
}
```

`clipboardMirror` can be `"all"` (mirror all deletes/changes/yanks), `"yank"` (mirror only yanks), or `"never"` (no system clipboard sync).

Settings are read from global settings first, then per-project settings override.

## Package structure

```
src/
├── index.ts                  # Extension entry point, ModalEditor class (~3866 lines)
├── stash.ts                  # Prompt stash/restore shortcut and hooks
├── motions.ts                # Motion calculation utilities
├── text-objects.ts           # Text object range resolution
├── visual.ts                 # Visual-mode selection math
├── visual-render.ts          # Visual-mode highlight overlay
├── word-boundary-cache.ts    # Word boundary cache (performance)
├── settings.ts               # Settings reader (piVim config key)
├── clipboard-policy.ts       # Clipboard mirror policy types/validation
└── types.ts                  # Shared types and constants
```

## Development

```bash
mise install     # tool versions (node, pnpm)
pnpm install
pnpm run check   # tsc --noEmit
pnpm run lint    # biome + eslint
pnpm run test    # vitest
```

`scripts/pi-dev` starts an isolated pi environment that loads the extension from this checkout (sources listed in `.pi-dev/dev-sources.json`).

## License

MIT — see [LICENSE](./LICENSE).

## Credits

- [pi-vim](https://github.com/lajarre/pi-vim) by lajarre — Vim modal editing for pi
- [pi-stash](https://github.com/maxpetretta/pi-stash) by Max Petretta — prompt stash for pi
- [pi-vim-keys](https://github.com/0xKahi/pi-vim-keys) by 0xKahi — visual mode render-overlay pattern and word-wrap parity approach
- [pi-vimmode](https://github.com/pekochan069/pi-vimmode) by pekochan069 — pure range helpers and visual-selection math for visual mode
