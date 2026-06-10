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
- **Operators** — `d` (delete), `y` (yank), `c` (change), `g~` (swap case), `gu`/`gU` (lower/upper), `>`/`<` (indent), `=` (format)
- **Visual modes** — `v` (character), `V` (line), `Ctrl+V` (block)
- **Registers** — `"a`..`"z` named registers, `"0` (last yank), `"` (unnamed), `"+` (system clipboard)
- **Macros** — `q<register>` to record, `q` or `<Esc>` to stop, `@<register>` to replay
- **Undo/redo** — `u`/`Ctrl+R` with branching history
- **Motions** — character, word, paragraph, matching pair, line-relative, scroll-based
- **Text objects** — `iw`/`aw` (word), `iW`/`aW` (WORD), `i"`/`a"` (quoted), `i(`/`a(` (bracketed)
- **Ex commands** — `:w` (write prompt), `:q` (quit), `:e` (edit/rerun)
- **Count prefixes** — `3dw`, `2j`, etc.
- **Clipboard integration** — yank/paste to/from system clipboard via native platform commands
- **Cursor shape** — block cursor in normal mode, beam cursor in insert mode
- **Mode-specific border/label colors** — configurable via settings

### Prompt stash

Temporarily shelve a prompt draft and restore it later, inspired by Claude Code:

**`Ctrl+S`** (configurable) —
- **Editor has content**: saves the current draft to `.pi/stash.md`, clears the editor
- **Editor is empty**: restores the stashed draft back into the editor

The stash also auto-restores after the next prompt submission, letting you shelve one prompt, send another, and pick up where you left off.

## Install

```bash
pi install git:github.com/r3b1s/pi-vim-stash
```

## Usage

Once installed, pi automatically activates Vim-style modal editing in the TUI editor.

### Stash examples

```text
# While editing a long prompt, hit Ctrl+S to stash it
# → "Stashed prompt (auto-restores after submit)"

# Type and send a quick different prompt
# → Stash auto-restores into the editor

# Or clear the editor and hit Ctrl+S again
# → "Restored stashed prompt to the editor"
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
    "clipboardMirror": false,
    "modeColors": {
      "normal": "borderAccent",
      "insert": "borderMuted",
      "ex": "warning"
    },
    "syncBorderColorWithMode": true
  }
}
```

Settings are read from global settings first, then per-project settings override.

## Package structure

```
pi-vim-stash/
├── index.ts                  # Extension entry point, ModalEditor class (~3400 lines)
├── stash.ts                  # Prompt stash/restore shortcut and hooks
├── motions.ts                # Motion calculation utilities
├── text-objects.ts           # Text object range resolution
├── word-boundary-cache.ts    # Word boundary cache (performance)
├── settings.ts               # Settings reader (piVim config key)
├── clipboard-policy.ts       # Clipboard mirror policy types/validation
├── types.ts                  # Shared types and constants
```

## License

MIT — see [LICENSE](./LICENSE).

## Credits

- [pi-vim](https://github.com/lajarre/pi-vim) by lajarre — Vim modal editing for pi
- [pi-stash](https://github.com/maxpetretta/pi-stash) by Max Petretta — prompt stash for pi
