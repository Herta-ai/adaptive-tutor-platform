import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capabilities } from '../src/capabilities/registry.js';
import { builtInPaths } from '../src/domain/paths.js';
import { Store } from '../src/storage/database.js';
import { Courses } from '../src/domain/courses.js';
const root = mkdtempSync(join(tmpdir(), 'tutor-coverage-'));
const store = new Store(root);
const paths: { id: string; subject: string; nodes: number; scientificHumanReview: string }[] = [];
const boundExamples: {
  pathId: string;
  title: string;
  templateId: string;
  templateVersion: number;
  reference: string;
  families: number;
}[] = [];
try {
  const courses = new Courses(store);
  for (const path of builtInPaths) {
    const course = path.create(courses);
    const lessons = store.list('lesson', course.id);
    paths.push({
      id: path.id,
      subject: path.subject,
      nodes: lessons.length,
      scientificHumanReview: 'pending',
    });
    for (const lesson of lessons)
      for (const block of lesson.document.blocks) {
        if (!block.templateId) continue;
        const cap = capabilities.find(
          (c) => c.id === block.templateId && c.version === block.templateVersion,
        )!;
        boundExamples.push({
          pathId: path.id,
          title: lesson.document.title,
          templateId: cap.id,
          templateVersion: cap.version,
          reference: cap.reference,
          families: new Set(lesson.document.exercises.map((e: any) => e.familyId)).size,
        });
      }
  }
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}
const prd = readFileSync('docs/PRD.md', 'utf8');
const subjects = prd
  .split(/\r?\n/)
  .filter((l) => /^\| S\d{2} \|/.test(l))
  .map((line) => {
    const [, id, title, topics, interaction] = line.split('|').map((s) => s.trim());
    return {
      id,
      title,
      topics,
      interaction,
      templates: capabilities
        .filter((c) => c.subject === id)
        .map((c) => ({
          id: c.id,
          version: c.version,
          title: c.title,
          examples: boundExamples.filter(
            (e) => e.templateId === c.id && e.templateVersion === c.version,
          ),
        })),
      coverage: 'partial',
      scientificHumanReview: 'pending',
    };
  });
const report = {
  generatedAt: new Date().toISOString(),
  registeredTemplates: capabilities.length,
  subjectGroups: subjects.length,
  completeTeachingPaths: paths.filter((p) => p.nodes >= 3).length,
  requiredTeachingPaths: 8,
  fullyBoundDemonstrations: boundExamples.length,
  requiredBoundDemonstrations: 44,
  phase1Complete: false,
  subjects,
  paths,
};
writeFileSync('specs/phase-1/subject-coverage.json', JSON.stringify(report, null, 2));
writeFileSync(
  'specs/phase-1/subject-coverage.md',
  `# 学科覆盖追踪\n\n注册模板不等于完整学科验收。通过实际发布内置课程统计：${paths.length} 条三节点路径、${boundExamples.length} 个课程绑定演示；人工复核待完成。全部主题及八条路径仍未齐备。\n\n| 学科 | 已注册模板 | 完整主题要求 | 状态 |\n| --- | --- | --- | --- |\n` +
    subjects
      .map(
        (s) =>
          `| ${s.id} ${s.title} | ${s.templates.map((t) => '`' + t.id + '`').join('、')} | ${s.topics} | 部分实现，人工复核待完成 |`,
      )
      .join('\n') +
    '\n\n| 路径 | 节点/样例 | 模板版本 | 家族数 | 科学参考 |\n| --- | --- | --- | --- | --- |\n' +
    boundExamples
      .map(
        (e) =>
          `| ${e.pathId} | ${e.title} | ${e.templateId}@${e.templateVersion} | ${e.families} | ${e.reference} |`,
      )
      .join('\n') +
    '\n',
);
console.log(
  JSON.stringify({
    registeredTemplates: capabilities.length,
    subjectGroups: subjects.length,
    completeTeachingPaths: paths.length,
    phase1Complete: false,
  }),
);
process.exitCode = 1;
