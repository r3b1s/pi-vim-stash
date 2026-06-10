import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  freezeIterationEvalSet,
  materializeEvalMetadata,
  recordWithoutSkillBaseline,
  snapshotSkill,
  writeBenchmark,
  writeFeedback,
  writeRunEvalSet,
} from "../artifacts.js";
import { getRunRoot } from "../config.js";
import {
  approveEvalSet,
  inferToolProfile,
  proposeEvalSet,
  recommendCostFirstModel,
  writeEvalPreference,
} from "../eval-config.js";
import { runEvalBatch } from "../eval-runner.js";
import {
  aggregateBenchmarkFromConditions,
  analyzeBenchmarkPlaceholder,
  writeGrading,
} from "../grading.js";
import {
  loadReviewItems,
  ReviewPanelComponent,
  saveReviewPanelResult,
} from "../review-ui.js";
import {
  addSideThread,
  appendSummaryNote,
  createRun,
  latestActiveRun,
  listRuns,
  readState,
  runLabel,
  summarizeState,
  updateState,
} from "../storage.js";
import type { EvalSet, SkillCreatorState } from "../types.js";

const baseDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(baseDir, "..", "..");
const bundledSkillDir = join(packageRoot, "skills", "skill-creator");

const intentSchema = Type.Union([
  Type.Literal("unknown"),
  Type.Literal("create-new"),
  Type.Literal("improve-existing"),
  Type.Literal("run-evals"),
  Type.Literal("port-adapt"),
]);

const phaseSchema = Type.Union([
  Type.Literal("discover"),
  Type.Literal("draft"),
  Type.Literal("eval-planning"),
  Type.Literal("eval-running"),
  Type.Literal("review"),
  Type.Literal("improve"),
  Type.Literal("complete"),
]);

export default function skillCreatorExtension(pi: ExtensionAPI) {
  let activeRunId: string | undefined;
  let panelVisible = true;

  pi.on("resources_discover", () => ({ skillPaths: [bundledSkillDir] }));

  pi.on("before_agent_start", async (event, ctx) => {
    if (!activeRunId) return;
    const runRoot = getRunRoot(ctx.cwd, { env: process.env });
    let state: SkillCreatorState | undefined;
    try {
      state = await readState(runRoot, activeRunId);
    } catch {
      return;
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\n# Active skill-creator workflow\nThe /sc extension is active for run ${state.runId}. Use the bundled skill-creator guidance. Use sc_run for run state changes, sc_eval for eval orchestration, and sc_review for review state. Do not edit state.json directly. Current state:\n${summarizeState(state)}`,
    };
  });

  pi.registerCommand("sc", {
    description: "Start, resume, switch, or show the Pi skill-creator workflow",
    getArgumentCompletions(prefix) {
      const values = [
        "new",
        "resume",
        "switch",
        "show",
        "hide",
        "status",
        "list",
      ];
      const filtered = values.filter((value) => value.startsWith(prefix));
      return filtered.length
        ? filtered.map((value) => ({ value, label: value }))
        : null;
    },
    handler: async (args, ctx) => {
      const command = args.trim();
      const runRoot = getRunRoot(ctx.cwd, { env: process.env });
      const state = await handleScCommand(command, runRoot, ctx);
      if (state) {
        activeRunId = state.runId;
        renderWorkflowWidget(ctx, state, panelVisible);
        pi.sendMessage(
          {
            customType: "skill-creator-status",
            content: `Skill-creator workflow active.\n\n${summarizeState(state)}`,
            display: true,
            details: {
              runId: state.runId,
              runDir: state.rails.artifactPaths.runDir,
            },
          },
          { deliverAs: "nextTurn" },
        );
      }
    },
  });

  pi.registerTool({
    name: "sc_run",
    label: "Skill Creator Run",
    description:
      "Create, resume, read, list, or update Pi skill-creator run state. Use this instead of editing state.json directly.",
    promptSnippet: "Create, resume, inspect, or update skill-creator run state",
    promptGuidelines: [
      "Use sc_run for skill-creator workflow state changes; do not edit .pi/skill-creator/runs/*/state.json directly.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("create"),
        Type.Literal("resume"),
        Type.Literal("read"),
        Type.Literal("list"),
        Type.Literal("update"),
        Type.Literal("add_side_thread"),
        Type.Literal("append_summary"),
      ]),
      runId: Type.Optional(
        Type.String({
          description:
            "Run id to read, resume, or update. Defaults to latest active run.",
        }),
      ),
      goal: Type.Optional(
        Type.String({
          description: "Current workflow goal for create/update.",
        }),
      ),
      intent: Type.Optional(intentSchema),
      phase: Type.Optional(phaseSchema),
      status: Type.Optional(
        Type.Union([
          Type.Literal("active"),
          Type.Literal("reviewing"),
          Type.Literal("completed"),
          Type.Literal("parked"),
          Type.Literal("errored"),
        ]),
      ),
      nextSuggestedActions: Type.Optional(Type.Array(Type.String())),
      sideThreadTitle: Type.Optional(
        Type.String({
          description:
            "Title for action=add_side_thread after explicit user marker or confirmation.",
        }),
      ),
      sideThreadRelation: Type.Optional(Type.String()),
      sideThreadNotes: Type.Optional(Type.Array(Type.String())),
      sideThreadNextAction: Type.Optional(Type.String()),
      summaryHeading: Type.Optional(
        Type.String({ description: "Heading for action=append_summary." }),
      ),
      summaryBody: Type.Optional(
        Type.String({
          description: "Markdown body for action=append_summary.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const runRoot = getRunRoot(ctx.cwd, { env: process.env });
      if (params.action === "create") {
        const createOptions: Parameters<typeof createRun>[0] = {
          cwd: ctx.cwd,
          runRoot,
        };
        if (params.goal !== undefined) createOptions.goal = params.goal;
        if (params.intent !== undefined) createOptions.intent = params.intent;
        const state = await createRun(createOptions);
        activeRunId = state.runId;
        renderWorkflowWidget(ctx, state, panelVisible);
        return scResult(`Created skill-creator run ${state.runId}.`, state);
      }

      if (params.action === "list") {
        const runs = await listRuns(runRoot);
        return {
          content: [
            {
              type: "text",
              text: runs.length
                ? runs.map(runLabel).join("\n")
                : "No skill-creator runs found.",
            },
          ],
          details: {
            runs: runs.map((run) => ({
              runId: run.runId,
              status: run.status,
              intent: run.intent,
              phase: run.rails.phase,
              path: run.rails.artifactPaths.runDir,
            })),
          },
        };
      }

      const selected = params.runId
        ? await readState(runRoot, params.runId)
        : await latestActiveRun(runRoot);
      if (!selected)
        throw new Error(
          "No active skill-creator run found. Use sc_run action=create first.",
        );

      if (params.action === "resume" || params.action === "read") {
        activeRunId = selected.runId;
        renderWorkflowWidget(ctx, selected, panelVisible);
        return scResult(
          `${params.action === "resume" ? "Resumed" : "Read"} skill-creator run ${selected.runId}.`,
          selected,
        );
      }

      if (params.action === "append_summary") {
        if (!params.summaryBody)
          throw new Error("summaryBody is required for append_summary.");
        const heading = params.summaryHeading ?? "Update";
        const path = await appendSummaryNote(
          runRoot,
          selected.runId,
          heading,
          params.summaryBody,
        );
        return {
          content: [{ type: "text", text: `Appended ${heading} to ${path}.` }],
          details: { runId: selected.runId, path },
        };
      }

      if (params.action === "add_side_thread") {
        if (!params.sideThreadTitle)
          throw new Error("sideThreadTitle is required for add_side_thread.");
        const options: Parameters<typeof addSideThread>[2] = {
          title: params.sideThreadTitle,
        };
        if (params.sideThreadRelation !== undefined)
          options.relation = params.sideThreadRelation;
        if (params.sideThreadNotes !== undefined)
          options.notes = params.sideThreadNotes;
        if (params.sideThreadNextAction !== undefined)
          options.nextAction = params.sideThreadNextAction;
        const state = await addSideThread(runRoot, selected.runId, options);
        renderWorkflowWidget(ctx, state, panelVisible);
        return scResult(
          `Added side thread to skill-creator run ${selected.runId}.`,
          state,
        );
      }

      const patch: Parameters<typeof updateState>[2] = {};
      if (params.status !== undefined) patch.status = params.status;
      if (params.intent !== undefined) patch.intent = params.intent;
      if (params.phase !== undefined) patch.phase = params.phase;
      if (params.goal !== undefined) patch.currentGoal = params.goal;
      if (params.nextSuggestedActions !== undefined)
        patch.nextSuggestedActions = params.nextSuggestedActions;
      const state = await updateState(runRoot, selected.runId, patch);
      activeRunId = state.runId;
      renderWorkflowWidget(ctx, state, panelVisible);
      return scResult(`Updated skill-creator run ${state.runId}.`, state);
    },
  });

  pi.registerTool({
    name: "sc_eval",
    label: "Skill Creator Eval",
    description:
      "Orchestrate skill-creator eval planning artifacts, immutable snapshots, feedback, condition artifacts, and benchmark aggregation. Requires user-approved prompts/settings before execution.",
    promptSnippet: "Plan or run skill-creator candidate/baseline eval batches",
    promptGuidelines: [
      "Use sc_eval for skill-creator eval batches after the user approves prompts and settings.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("status"),
        Type.Literal("propose_evals"),
        Type.Literal("write_evals"),
        Type.Literal("approve_evals"),
        Type.Literal("create_iteration"),
        Type.Literal("snapshot_candidate"),
        Type.Literal("snapshot_old"),
        Type.Literal("record_without_skill"),
        Type.Literal("materialize_metadata"),
        Type.Literal("write_feedback"),
        Type.Literal("write_benchmark"),
        Type.Literal("run_batch"),
        Type.Literal("grade_condition"),
        Type.Literal("aggregate_benchmark"),
        Type.Literal("analyze_benchmark"),
      ]),
      runId: Type.Optional(Type.String()),
      iteration: Type.Optional(Type.Number()),
      evalSet: Type.Optional(
        Type.Any({
          description:
            "Upstream-compatible EvalSet object for write_evals/create_iteration/materialize_metadata.",
        }),
      ),
      skillName: Type.Optional(Type.String()),
      goal: Type.Optional(Type.String()),
      examples: Type.Optional(Type.Array(Type.String())),
      edgeCases: Type.Optional(Type.Array(Type.String())),
      successCriteria: Type.Optional(Type.Array(Type.String())),
      availableModels: Type.Optional(Type.Array(Type.String())),
      modelPreference: Type.Optional(Type.String()),
      thinkingLevel: Type.Optional(Type.String()),
      toolProfile: Type.Optional(
        Type.Union([
          Type.Literal("normal"),
          Type.Literal("broader"),
          Type.Literal("custom"),
        ]),
      ),
      concurrency: Type.Optional(Type.Number()),
      sourceSkillDir: Type.Optional(
        Type.String({
          description:
            "Source skill directory for snapshot_candidate/snapshot_old.",
        }),
      ),
      feedbackEntries: Type.Optional(Type.Array(Type.Any())),
      reviewComplete: Type.Optional(Type.Boolean()),
      benchmark: Type.Optional(Type.Any()),
      conditions: Type.Optional(
        Type.Array(
          Type.Any({
            description:
              "Array of { evalCase, condition, skillSnapshotDir? } for run_batch or aggregate_benchmark.",
          }),
        ),
      ),
      retainRawEvents: Type.Optional(Type.Boolean()),
      evalCase: Type.Optional(
        Type.Any({ description: "EvalCase for grade_condition." }),
      ),
      condition: Type.Optional(
        Type.String({ description: "Condition name for grade_condition." }),
      ),
      output: Type.Optional(
        Type.String({
          description: "Output text to grade for grade_condition.",
        }),
      ),
      analysisInput: Type.Optional(
        Type.Any({
          description: "Analyzer input metrics for analyze_benchmark.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const runRoot = getRunRoot(ctx.cwd, { env: process.env });
      const state = params.runId
        ? await readState(runRoot, params.runId)
        : await latestActiveRun(runRoot);
      if (!state) throw new Error("No active skill-creator run found.");
      const iteration =
        params.iteration ?? state.rails.activeIteration?.number ?? 1;

      if (params.action === "propose_evals") {
        const proposalInput: Parameters<typeof proposeEvalSet>[0] = {
          skillName: params.skillName ?? "candidate-skill",
          intent: state.intent,
        };
        const goal = params.goal ?? state.rails.currentGoal;
        if (goal !== undefined) proposalInput.goal = goal;
        if (params.examples !== undefined)
          proposalInput.examples = params.examples;
        if (params.edgeCases !== undefined)
          proposalInput.edgeCases = params.edgeCases;
        if (params.successCriteria !== undefined)
          proposalInput.successCriteria = params.successCriteria;
        const evalSet = proposeEvalSet(proposalInput);
        const profile = inferToolProfile({
          prompts: evalSet.evals.map((evalCase) => evalCase.prompt),
        });
        const recommendedModel = recommendCostFirstModel(
          params.availableModels ?? [],
        );
        const path = await writeRunEvalSet(state, evalSet);
        return {
          content: [
            {
              type: "text",
              text: `Proposed ${evalSet.evals.length} eval prompt(s) at ${path}. User approval is required before running.`,
            },
          ],
          details: {
            runId: state.runId,
            path,
            evalSet,
            recommendedModel,
            toolProfile: profile,
          },
        };
      }

      if (
        params.action === "write_evals" ||
        params.action === "approve_evals"
      ) {
        if (!params.evalSet)
          throw new Error("evalSet is required for writing evals.");
        let evalSet = params.evalSet as EvalSet;
        if (params.action === "approve_evals")
          evalSet = approveEvalSet(evalSet);
        const path = await writeRunEvalSet(state, evalSet);
        return {
          content: [
            {
              type: "text",
              text: `Wrote ${evalSet.evals.length} eval(s) to ${path}.`,
            },
          ],
          details: {
            runId: state.runId,
            path,
            approved: evalSet.pi?.approved === true,
          },
        };
      }

      if (params.action === "create_iteration") {
        const paths = await freezeIterationEvalSet(
          state,
          iteration,
          params.evalSet as EvalSet | undefined,
        );
        return {
          content: [
            {
              type: "text",
              text: `Created iteration ${iteration} at ${paths.iterationDir}.`,
            },
          ],
          details: { runId: state.runId, iteration, paths },
        };
      }

      if (params.action === "materialize_metadata") {
        if (!params.evalSet)
          throw new Error("evalSet is required for materialize_metadata.");
        const paths = await materializeEvalMetadata(
          state,
          iteration,
          params.evalSet as EvalSet,
        );
        return {
          content: [
            {
              type: "text",
              text: `Materialized ${paths.length} eval metadata file(s).`,
            },
          ],
          details: { runId: state.runId, iteration, paths },
        };
      }

      if (
        params.action === "snapshot_candidate" ||
        params.action === "snapshot_old"
      ) {
        if (!params.sourceSkillDir)
          throw new Error("sourceSkillDir is required for skill snapshots.");
        const condition =
          params.action === "snapshot_candidate" ? "with_skill" : "old_skill";
        const path = await snapshotSkill(
          state,
          iteration,
          params.sourceSkillDir,
          condition,
        );
        return {
          content: [
            {
              type: "text",
              text: `Snapshotted ${condition} skill to ${path}.`,
            },
          ],
          details: { runId: state.runId, iteration, condition, path },
        };
      }

      if (params.action === "record_without_skill") {
        const path = await recordWithoutSkillBaseline(state, iteration);
        return {
          content: [
            {
              type: "text",
              text: `Recorded without_skill baseline metadata at ${path}.`,
            },
          ],
          details: {
            runId: state.runId,
            iteration,
            condition: "without_skill",
            path,
          },
        };
      }

      if (params.action === "write_feedback") {
        const feedback = await writeFeedback(
          state,
          iteration,
          (params.feedbackEntries ?? []) as Parameters<typeof writeFeedback>[2],
          params.reviewComplete ?? false,
        );
        return {
          content: [
            {
              type: "text",
              text: `Wrote feedback for iteration ${iteration}.`,
            },
          ],
          details: { runId: state.runId, iteration, feedback },
        };
      }

      if (params.action === "write_benchmark") {
        if (!params.benchmark)
          throw new Error("benchmark is required for write_benchmark.");
        const benchmark = await writeBenchmark(
          state,
          iteration,
          params.benchmark as Parameters<typeof writeBenchmark>[2],
        );
        return {
          content: [
            {
              type: "text",
              text: `Wrote benchmark artifacts for iteration ${iteration}.`,
            },
          ],
          details: { runId: state.runId, iteration, benchmark },
        };
      }

      if (
        params.modelPreference ||
        params.thinkingLevel ||
        params.toolProfile ||
        params.concurrency !== undefined
      ) {
        const preference: Parameters<typeof writeEvalPreference>[1] = {
          toolProfile: params.toolProfile ?? "normal",
        };
        if (params.modelPreference !== undefined)
          preference.model = params.modelPreference;
        if (params.thinkingLevel !== undefined)
          preference.thinkingLevel = params.thinkingLevel as NonNullable<
            Parameters<typeof writeEvalPreference>[1]["thinkingLevel"]
          >;
        if (params.concurrency !== undefined)
          preference.concurrency = params.concurrency;
        const prefPath = await writeEvalPreference(state, preference);
        if (params.action === "status") {
          return {
            content: [
              { type: "text", text: `Saved eval preference to ${prefPath}.` },
            ],
            details: { runId: state.runId, prefPath },
          };
        }
      }

      if (params.action === "run_batch") {
        if (!params.conditions || params.conditions.length === 0)
          throw new Error("conditions are required for run_batch.");
        const batchSettings: Parameters<typeof runEvalBatch>[0] = {
          cwd: ctx.cwd,
          state,
          iteration,
          conditions: params.conditions as Parameters<
            typeof runEvalBatch
          >[0]["conditions"],
          retainRawEvents: params.retainRawEvents ?? true,
        };
        if (params.concurrency !== undefined)
          batchSettings.concurrency = params.concurrency;
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Running ${batchSettings.conditions.length} eval condition(s) for iteration ${iteration}...`,
            },
          ],
          details: {
            runId: state.runId,
            iteration,
            running: batchSettings.conditions.length,
          },
        });
        const results = await runEvalBatch(batchSettings);
        return {
          content: [
            {
              type: "text",
              text: `Completed ${results.length} eval condition run(s) for iteration ${iteration}.`,
            },
          ],
          details: {
            runId: state.runId,
            iteration,
            results: results.map((result) => ({
              evalId: result.evalId,
              condition: result.condition,
              paths: result.paths,
              metrics: result.metrics,
              diagnostics: result.diagnostics,
            })),
          },
        };
      }

      if (params.action === "grade_condition") {
        if (
          !params.evalCase ||
          !params.condition ||
          params.output === undefined
        )
          throw new Error(
            "evalCase, condition, and output are required for grade_condition.",
          );
        const grading = await writeGrading(
          state,
          iteration,
          params.evalCase as Parameters<typeof writeGrading>[2],
          params.condition as Parameters<typeof writeGrading>[3],
          params.output,
        );
        return {
          content: [
            {
              type: "text",
              text: `Wrote grading for ${grading.evalId}/${grading.condition}: ${grading.summary}`,
            },
          ],
          details: { runId: state.runId, iteration, grading },
        };
      }

      if (params.action === "aggregate_benchmark") {
        if (!params.conditions || params.conditions.length === 0)
          throw new Error("conditions are required for aggregate_benchmark.");
        const byEval = new Map<
          string,
          {
            evalCase: Parameters<
              typeof aggregateBenchmarkFromConditions
            >[2][number]["evalCase"];
            conditions: Parameters<
              typeof aggregateBenchmarkFromConditions
            >[2][number]["conditions"];
          }
        >();
        for (const item of params.conditions as Array<{
          evalCase: Parameters<
            typeof aggregateBenchmarkFromConditions
          >[2][number]["evalCase"];
          condition: Parameters<
            typeof aggregateBenchmarkFromConditions
          >[2][number]["conditions"][number];
        }>) {
          const current = byEval.get(item.evalCase.id) ?? {
            evalCase: item.evalCase,
            conditions: [],
          };
          current.conditions.push(item.condition);
          byEval.set(item.evalCase.id, current);
        }
        const benchmark = await aggregateBenchmarkFromConditions(
          state,
          iteration,
          [...byEval.values()],
        );
        return {
          content: [
            {
              type: "text",
              text: `Aggregated benchmark for iteration ${iteration}.`,
            },
          ],
          details: { runId: state.runId, iteration, benchmark },
        };
      }

      if (params.action === "analyze_benchmark") {
        const findings = analyzeBenchmarkPlaceholder(
          params.analysisInput ?? {},
        );
        return {
          content: [
            {
              type: "text",
              text: findings.length
                ? findings.map((f) => `${f.severity}: ${f.text}`).join("\n")
                : "No benchmark analyzer findings.",
            },
          ],
          details: { runId: state.runId, iteration, findings },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `sc_eval status: eval artifacts live under ${state.rails.artifactPaths.runDir}. User approval is required before batch execution.`,
          },
        ],
        details: {
          runId: state.runId,
          runDir: state.rails.artifactPaths.runDir,
          action: params.action,
        },
      };
    },
  });

  pi.registerTool({
    name: "sc_review",
    label: "Skill Creator Review",
    description:
      "Open review UI/fallback status, save feedback, mark review complete, and report persisted review status for skill-creator iterations.",
    promptSnippet: "Open or manage skill-creator eval review and feedback",
    promptGuidelines: [
      "Use sc_review when an eval iteration is ready for review or feedback needs to be saved.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("status"),
        Type.Literal("open"),
        Type.Literal("save_feedback"),
        Type.Literal("complete"),
      ]),
      runId: Type.Optional(Type.String()),
      iteration: Type.Optional(Type.Number()),
      feedbackEntries: Type.Optional(Type.Array(Type.Any())),
      evalSet: Type.Optional(Type.Any()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const runRoot = getRunRoot(ctx.cwd, { env: process.env });
      const state = params.runId
        ? await readState(runRoot, params.runId)
        : await latestActiveRun(runRoot);
      if (!state) throw new Error("No active skill-creator run found.");
      const iteration =
        params.iteration ?? state.rails.activeIteration?.number ?? 1;

      if (params.action === "save_feedback" || params.action === "complete") {
        const feedback = await writeFeedback(
          state,
          iteration,
          (params.feedbackEntries ?? []) as Parameters<typeof writeFeedback>[2],
          params.action === "complete",
        );
        const text =
          params.action === "complete"
            ? "Marked review complete"
            : "Saved review feedback";
        return {
          content: [
            { type: "text", text: `${text} for iteration ${iteration}.` },
          ],
          details: { runId: state.runId, iteration, feedback },
        };
      }

      if (params.action === "open" && ctx.hasUI) {
        if (params.evalSet) {
          const items = await loadReviewItems(
            state,
            iteration,
            params.evalSet as EvalSet,
          );
          const result = await ctx.ui.custom<
            import("../review-ui.js").ReviewPanelResult | undefined
          >(
            (_tui, theme, _kb, done) =>
              new ReviewPanelComponent(items, done, theme),
            {
              overlay: true,
              overlayOptions: {
                anchor: "right-center",
                width: "70%",
                minWidth: 80,
                margin: 1,
              },
            },
          );
          if (result) {
            await saveReviewPanelResult(state, iteration, result);
            return {
              content: [
                {
                  type: "text",
                  text: `Saved review feedback for iteration ${iteration}.`,
                },
              ],
              details: { runId: state.runId, iteration, result },
            };
          }
        }
        const choice = await ctx.ui.select("Skill Creator Review", [
          `Open fallback feedback.md for iteration ${iteration}`,
          "Show review status only",
          "Cancel",
        ]);
        if (choice?.startsWith("Open fallback")) {
          const feedback = await writeFeedback(state, iteration, [], false);
          return {
            content: [
              {
                type: "text",
                text: `Prepared feedback fallback for iteration ${iteration}.`,
              },
            ],
            details: { runId: state.runId, iteration, feedback },
          };
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Review status: run ${state.runId}, iteration ${iteration}. Review data is reconstructed from ${state.rails.artifactPaths.runDir}. Use feedback.md fallback when TUI is unavailable.`,
          },
        ],
        details: {
          runId: state.runId,
          runDir: state.rails.artifactPaths.runDir,
          iteration,
          action: params.action,
        },
      };
    },
  });

  async function handleScCommand(
    command: string,
    runRoot: string,
    ctx: ExtensionCommandContext,
  ): Promise<SkillCreatorState | undefined> {
    if (command === "hide") {
      panelVisible = false;
      ctx.ui.setWidget("skill-creator", undefined);
      ctx.ui.notify(
        "Skill-creator panel hidden. Use /sc show to restore.",
        "info",
      );
      return activeRunId
        ? readState(runRoot, activeRunId).catch(() => undefined)
        : undefined;
    }
    if (command === "show" || command === "status") {
      panelVisible = true;
      const state = activeRunId
        ? await readState(runRoot, activeRunId).catch(() => undefined)
        : await latestActiveRun(runRoot);
      if (!state)
        ctx.ui.notify(
          "No active skill-creator run. Use /sc new to create one.",
          "warning",
        );
      return state;
    }
    if (command === "new") return createRun({ cwd: ctx.cwd, runRoot });

    const runs = await listRuns(runRoot);
    if (command === "list") {
      const text = runs.length
        ? runs.map(runLabel).join("\n")
        : "No skill-creator runs found.";
      ctx.ui.notify(text, "info");
      return undefined;
    }

    const latest = runs.find(
      (run) => run.status === "active" || run.status === "reviewing",
    );
    if (!latest) return createRun({ cwd: ctx.cwd, runRoot });

    if (command === "resume" || command === "") {
      if (command === "resume" || !ctx.hasUI) return latest;
      const choice = await ctx.ui.select("Skill Creator", [
        `Continue latest: ${runLabel(latest)}`,
        "Start a new run",
        "Switch to another run",
        panelVisible ? "Hide workflow panel" : "Show workflow panel",
      ]);
      if (!choice) return latest;
      if (choice.startsWith("Continue")) return latest;
      if (choice.startsWith("Start"))
        return createRun({ cwd: ctx.cwd, runRoot });
      if (choice.startsWith("Hide")) {
        panelVisible = false;
        ctx.ui.setWidget("skill-creator", undefined);
        return latest;
      }
      if (choice.startsWith("Show")) {
        panelVisible = true;
        return latest;
      }
    }

    if (command === "switch" || command === "") {
      const selected = await ctx.ui.select(
        "Switch skill-creator run",
        runs.map(runLabel),
      );
      if (!selected) return latest;
      const index = runs.findIndex((run) => selected.startsWith(run.runId));
      return runs[index] ?? latest;
    }

    if (command) ctx.ui.notify(`Unknown /sc argument: ${command}`, "warning");
    return latest;
  }
}

function renderWorkflowWidget(
  ctx: { ui: ExtensionCommandContext["ui"] },
  state: SkillCreatorState,
  visible: boolean,
): void {
  if (!visible) return;
  ctx.ui.setWidget("skill-creator", summarizeState(state).split("\n"), {
    placement: "aboveEditor",
  });
}

function scResult(summary: string, state: SkillCreatorState) {
  return {
    content: [
      { type: "text" as const, text: `${summary}\n\n${summarizeState(state)}` },
    ],
    details: {
      runId: state.runId,
      status: state.status,
      intent: state.intent,
      phase: state.rails.phase,
      paths: state.rails.artifactPaths,
    },
  };
}
