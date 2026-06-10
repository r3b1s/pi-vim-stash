# Skill Creator Benchmark Analyzer Reference Prompt

Analyze benchmark artifacts for patterns that are not obvious from pass rates alone:

- flaky or non-discriminating eval prompts
- expectations that reward irrelevant behavior
- candidate regressions hidden by aggregate scores
- token, duration, cost, and tool-use tradeoffs
- missing-output or skill-load diagnostics
- whether a description/instruction change is likely to help

Return concise findings with artifact paths and evidence. Do not start another iteration automatically; ask the user whether to improve, rerun, or finish.
