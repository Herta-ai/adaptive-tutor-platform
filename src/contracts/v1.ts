import { z } from 'zod';

export const id = z.string().min(1).max(160);
export const text = z.string().min(1).max(60000);
export const finite = z.number().finite();
export const tolerance = finite.nonnegative();
export const objective = z.strictObject({ id, description: text });
export const source = z.strictObject({
  id,
  title: text,
  url: z.url().optional(),
  status: z.enum(['verified', 'suggested']),
  accessedAt: z.string().optional(),
  supportsBlockIds: z.array(id),
  license: z.string().optional(),
});
const option = z.strictObject({ id, label: text });
const baseExercise = { key: id, objectiveId: id, familyKey: id, prompt: text, explanation: text };
export const exercise = z.discriminatedUnion('kind', [
  z.strictObject({
    ...baseExercise,
    kind: z.literal('single_choice'),
    options: z.array(option).min(2).max(12),
    grading: z.strictObject({ correctOptionId: id }),
  }),
  z.strictObject({
    ...baseExercise,
    kind: z.literal('multiple_choice'),
    options: z.array(option).min(2).max(12),
    grading: z.strictObject({ correctOptionIds: z.array(id).min(1) }),
  }),
  z.strictObject({
    ...baseExercise,
    kind: z.literal('numeric'),
    grading: z.strictObject({
      expected: finite,
      unit: z.string().max(40),
      allowedUnits: z.array(z.string().max(40)).min(1),
      absTolerance: tolerance,
      relTolerance: tolerance,
    }),
  }),
  z.strictObject({
    ...baseExercise,
    kind: z.literal('parameter'),
    grading: z.strictObject({
      template: z.literal('parameter_targets'),
      targets: z
        .array(
          z.strictObject({
            key: id,
            expected: finite,
            absTolerance: tolerance,
            relTolerance: tolerance,
          }),
        )
        .min(1)
        .max(8),
      blockId: id,
    }),
  }),
]);
export type Exercise = z.infer<typeof exercise>;
export const modelInfo = z.strictObject({
  mode: z.enum(['computed', 'simplified', 'precomputed', 'illustrative']),
  assumptions: z.array(text),
  units: z.record(z.string(), z.string()),
  sourceIds: z.array(id),
  seed: z.number().int().optional(),
  tolerance: tolerance.optional(),
});
export const demoTypes = [
  'geometry2d',
  'function_plot',
  'math_manipulative',
  'scene3d',
  'matrix_lab',
  'data_chart',
  'simulation',
  'molecule',
  'process_diagram',
  'annotated_asset',
  'algorithm_trace',
  'code_lab',
  'ml_lab',
  'neural_lab',
] as const;
export const demoBlock = z.strictObject({
  blockId: id,
  type: z.enum(demoTypes),
  templateId: id,
  templateVersion: z.number().int().positive(),
  config: z.record(z.string(), z.unknown()),
  modelInfo,
  alt: text,
});
export const block = z.union([
  z.strictObject({
    blockId: id,
    type: z.literal('markdown'),
    role: z.enum(['goal', 'explanation', 'worked_example', 'recap']),
    text,
  }),
  z.strictObject({ blockId: id, type: z.literal('exercise_ref'), exerciseKey: id }),
  demoBlock,
]);
export const lessonDraft = z.strictObject({
  schemaVersion: z.literal('1.0'),
  title: text,
  blocks: z.array(block).min(4).max(64),
  exercises: z.array(exercise).min(3).max(18),
  sources: z.array(source).max(50),
  assetRefs: z.array(id).max(100),
});
export type LessonDraft = z.infer<typeof lessonDraft>;
export const curriculumDraft = z.strictObject({
  schemaVersion: z.literal('1.0'),
  title: text,
  summary: text,
  concepts: z
    .array(z.strictObject({ key: id, label: text }))
    .min(1)
    .max(80),
  nodes: z
    .array(
      z.strictObject({
        key: id,
        conceptKey: id,
        title: text,
        objectives: z
          .array(z.strictObject({ key: id, description: text }))
          .min(1)
          .max(3),
        estimatedMinutes: z.number().int().min(5).max(15),
      }),
    )
    .min(1)
    .max(80),
  edges: z.array(z.strictObject({ fromKey: id, toKey: id })).max(6400),
  sources: z.array(source),
});
export const patchProposal = z.strictObject({
  targetNodeId: id,
  objectiveId: id,
  cycleId: id,
  remediationEpochId: id,
  baseRevision: z.number().int().positive(),
  reason: text,
  evidenceAttemptIds: z.array(id).min(2),
  prerequisiteConceptRefs: z
    .array(z.union([id, z.strictObject({ newConceptKey: id, label: text })]))
    .min(1),
  newNodes: curriculumDraft.shape.nodes.min(0).max(2),
  reuseNodeIds: z.array(id),
  addedEdges: z.array(z.strictObject({ fromRef: id, toRef: id })).min(1),
});
export const diagnosisDraft = z.strictObject({
  schemaVersion: z.literal('1.0'),
  objectiveId: id,
  attemptIds: z.array(id).min(1),
  errorType: z.enum(['slip', 'misconception', 'prerequisite_gap', 'ambiguous_item', 'unknown']),
  confidence: finite.min(0).max(1),
  explanation: text,
  nextAction: z.enum(['hint', 'reexplain', 'practice', 'propose_patch', 'flag_item']),
  patchProposal: patchProposal.nullable(),
});
export const kinds = [
  'plan_course',
  'generate_lesson',
  'generate_exercises',
  'diagnose',
  'revise_lesson',
] as const;
export type Kind = (typeof kinds)[number];
export const draftSchemas = {
  plan_course: curriculumDraft,
  generate_lesson: lessonDraft,
  revise_lesson: lessonDraft,
  generate_exercises: z.strictObject({
    schemaVersion: z.literal('1.0'),
    exercises: z.array(exercise).min(1).max(18),
  }),
  diagnose: diagnosisDraft,
};
export const receipt = z.strictObject({
  schemaVersion: z.literal('1.0'),
  delivery: z.literal('mcp_draft'),
  kind: z.enum(kinds),
  draftId: id,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const createCourse = z.strictObject({
  clientRequestId: id,
  topic: z.string().min(1).max(200),
  goal: z.string().min(1).max(2000),
  profile: z.strictObject({
    background: z.string().max(4000),
    weeklyMinutes: z.number().int().min(1).max(10080),
    language: z.string().min(1).max(40),
    targetDate: z.iso.date().optional(),
  }),
});
export const componentState = z.strictObject({
  templateId: id,
  templateVersion: z.number().int().positive(),
  runRevision: z.number().int().nonnegative(),
  parameters: z.record(z.string(), z.unknown()),
  selectedIds: z.array(id).max(100),
  observables: z.record(z.string(), z.unknown()),
  step: z.number().int().nonnegative().optional(),
  time: finite.optional(),
  seed: z.number().int().optional(),
});
export const turn = z.strictObject({
  clientRequestId: id,
  question: z.string().min(1).max(2000),
  context: z.strictObject({
    nodeId: id,
    lessonVersion: z.number().int().positive(),
    blockId: id.nullable(),
    selection: z
      .strictObject({
        text: z.string().max(2000),
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().nonnegative(),
      })
      .nullable(),
    componentState: componentState.nullable(),
    activeAssignmentId: id.nullable(),
  }),
});
