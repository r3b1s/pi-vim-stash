# pi-tmux-sessionizer

Spawn subagents as real `pi` processes in detached tmux windows — full TUI observability, external control, and session file result extraction.

## Features

- **Full TUI visibility** — each subagent runs in its own tmux window with the complete pi TUI, tool calls, thinking indicators, and model responses visible in real-time
- **One session per parent** — all subagents for a parent pi session are grouped in a single tmux session (`_pi-sub-<id>`) with one window per subagent
- **Standard tmux navigation** — `C-b n`/`p`/`0-9` to switch between subagent windows, `C-b d` to detach
- **External control** — steer subagents by typing directly in their tmux window, or use the `steer_subagent` tool
- **Result extraction** — completion detected by monitoring the subagent's JSONL session file; results extracted from the last assistant message
- **No tmux dependency on parent** — your main pi session runs normally; tmux is only needed for subagent spawning

## Installation

```bash
pi install npm:@r3b1s/pi-tmux-sessionizer
```

## Requirements

- **tmux** must be installed on your system:
  - macOS: `brew install tmux`
  - Ubuntu/Debian: `apt install tmux`
  - Fedora: `dnf install tmux`
- **pi** CLI (obviously)

## Usage

Once installed, the extension registers:

- `subagent` — spawn a subagent in a tmux window (standalone mode only; when `pi-subagents-deterministic` is installed, PSD's `subagent` tool routes through PTS's tmux spawner)
- `get_subagent_result` — retrieve a subagent's result
- `steer_subagent` — send a message or Ctrl+C to a subagent

### Attaching to the tmux session

To watch subagent execution in real-time:

```bash
tmux attach -t _pi-sub-<parentSessionId>
```

Replace `<parentSessionId>` with the session ID shown in the tool output. Use `tmux list-sessions` to find active sessions.

### Steer by typing

While attached to the tmux session, you can type directly into any subagent's window — it's received as user input by the pi process.

### Kill subagents

- From tmux: press `Ctrl+C` in the subagent's window
- From the `steer_subagent` tool: set `kill: true`

## Composition with pi-subagents-deterministic

Install both packages for the best experience:

```bash
pi install npm:@r3b1s/pi-subagents-deterministic
pi install npm:@r3b1s/pi-tmux-sessionizer
```

When both are installed:
- **PSD** handles model routing from `model-routing.yml` — deterministic model selection with fallback
- **PTS** handles tmux spawning — each subagent runs in its own tmux window for full observability
- **PSD's `subagent` tool** wins the name collision and routes through PTS's spawner

## How it works

1. On the first subagent spawn, PTS creates a detached tmux session named `_pi-sub-<parentSessionId>`
2. Each subagent gets its own tmux window with a `pi --session-id <id> "<prompt>"` command
3. A config directory is created at `$PI_CODING_AGENT_DIR/tmp/subagents/<parentId>/<agentId>/` with isolated settings, auth, and models
4. The session JSONL file is monitored for completion (user message → assistant text + 3s inactivity)
5. On parent session shutdown, the tmux session and config directories are cleaned up

## License

MIT
