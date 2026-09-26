import { capability, validateParameters } from './registry.js';
self.onmessage = ({ data }) => {
  try {
    const c = capability(data.templateId, data.templateVersion),
      parameters = validateParameters(c, data.parameters);
    const step = Math.max(0, Math.min(100, Number(data.step) || 0));
    const result = c.compute(parameters, step);
    if (!Object.values(result.values).every(Number.isFinite)) throw Error('NUMERIC_UNSTABLE');
    self.postMessage({ runRevision: data.runRevision, step, result });
  } catch (e) {
    self.postMessage({
      runRevision: data.runRevision,
      step: data.step,
      error: e instanceof Error ? e.message : '计算失败',
    });
  }
};
