# RTK - Rust Token Killer

**Usage**: Token-optimized CLI proxy (60-90% savings on dev operations)

## Meta Commands (always use rtk directly)

```bash
rtk gain              # Show token savings analytics
rtk gain --history    # Show command usage history with savings
rtk discover          # Analyze history for missed optimization opportunities
rtk session           # Show RTK adoption across recent sessions
rtk proxy <cmd>       # Execute raw command without filtering (for debugging)
rtk rewrite <cmd>     # Show how RTK would rewrite a raw command
```

## How It Works

Eligible shell commands are automatically rewritten through RTK by the pi-token-killer extension.
The extension parses available RTK optimizer subcommands from `rtk help` and prefixes matching shell commands.
Example: `git status` becomes `rtk git status` transparently, producing compressed output.

Commands already prefixed with `rtk`, RTK meta commands, interactive commands, heredocs, and unsupported commands are left unchanged.
No manual prefixing is needed for supported optimizer commands. Just run commands normally.
