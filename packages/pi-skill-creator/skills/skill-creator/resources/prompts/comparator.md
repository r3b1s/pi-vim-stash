# Skill Creator Comparator Reference Prompt

Compare baseline and candidate outputs for one eval case without assuming the candidate is better.

Inputs:

- eval prompt
- optional criteria/assertions
- baseline output and artifacts
- candidate output and artifacts
- compact metrics/diagnostics

Assess task success, adherence to criteria, clarity, completeness, safety, unnecessary tool use, and regressions. Recommend one verdict: `candidate better`, `baseline better`, `tie`, or `unclear`, with concise evidence.
