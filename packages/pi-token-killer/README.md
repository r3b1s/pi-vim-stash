# pi-token-killer

[RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) extension for [pi-coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent). It transparently routes eligible bash commands through `rtk` to reduce LLM token consumption by 60-90%.

This extension requires `rtk`: https://github.com/rtk-ai/rtk

The goal is minimalism. This package simply hooks an existing RTK installation into pi. Other RTK-related npm packages I found appear to reimplement RTK output filtering or add extra behavior.

This extension does not replace the functionality of the original `rtk` tool. It only uses pi hooks to route eligible shell commands through RTK, while keeping RTK responsible for command execution and output optimization.

## Install

Install via git:

```bash
pi install git:https://github.com/r3b1s/pi-token-killer
```

Or add it to your pi agent extensions config (for example, `.pi/extensions/` or `settings.json`) if you are using a local checkout:

```
/path/to/pi-token-killer
```

`rtk` must be installed and available on your `PATH`.

## How it works

1. On startup, it parses `rtk help` and stores the available RTK subcommands.
2. It removes systemic/meta RTK commands from that set, keeping only optimizer commands.
3. It intercepts `bash` tool calls and prefixes matching optimizer commands with `rtk`.
4. It maps common aliases where RTK uses a different subcommand, such as `cat` → `rtk read` and `rg` → `rtk grep`.
5. It skips commands that are already prefixed with `rtk`, interactive commands, heredocs, and commands RTK does not expose as optimizers.
6. It fails open: if `rtk` is missing or parsing fails, the original command runs unchanged. If RTK appears later, the extension retries parsing on the next rewrite attempt.
7. It injects RTK meta-command documentation into the system prompt.

## Meta commands

```bash
rtk gain              # Show token savings analytics
rtk gain --history    # Show command usage history
rtk discover          # Find missed optimization opportunities
rtk session           # Show RTK adoption across recent sessions
rtk proxy <cmd>       # Run command without rtk filtering
rtk rewrite <cmd>     # Show how RTK would rewrite a raw command
```
