import * as tf from '@tensorflow/tfjs';
self.onmessage = async ({ data }) => {
  const runId = data.runId,
    epochs = Math.max(1, Math.min(300, Math.floor(data.epochs)));
  let model: tf.Sequential | undefined,
    x: tf.Tensor2D | undefined,
    y: tf.Tensor2D | undefined,
    vx: tf.Tensor2D | undefined,
    vy: tf.Tensor2D | undefined;
  try {
    await tf.setBackend('cpu');
    await tf.ready();
    let state = 42;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) | 0;
      return (state >>> 0) / 4294967296;
    };
    const points = Array.from({ length: 80 }, () => [random() * 2 - 1, random() * 2 - 1]),
      labels = points.map(([a, b]) => [a * b > 0 ? 1 : 0]);
    x = tf.tensor2d(points.slice(0, 64));
    y = tf.tensor2d(labels.slice(0, 64));
    vx = tf.tensor2d(points.slice(64));
    vy = tf.tensor2d(labels.slice(64));
    model = tf.sequential();
    model.add(
      tf.layers.dense({
        inputShape: [2],
        units: 8,
        activation: 'tanh',
        kernelInitializer: tf.initializers.glorotUniform({ seed: 42 }),
      }),
    );
    model.add(
      tf.layers.dense({
        units: 1,
        activation: 'sigmoid',
        kernelInitializer: tf.initializers.glorotUniform({ seed: 43 }),
      }),
    );
    model.compile({
      optimizer: tf.train.adam(0.03),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy'],
    });
    const deadline = performance.now() + 30000;
    await model.fit(x, y, {
      epochs,
      batchSize: 16,
      shuffle: false,
      validationData: [vx, vy],
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          self.postMessage({
            runId,
            type: 'epoch',
            epoch: epoch + 1,
            loss: logs?.loss,
            validationLoss: logs?.val_loss,
            accuracy: logs?.acc,
            validationAccuracy: logs?.val_acc,
          });
          if (performance.now() > deadline) {
            model!.stopTraining = true;
          }
          await tf.nextFrame();
        },
      },
    });
    self.postMessage({
      runId,
      type: 'done',
      limited: performance.now() > deadline,
      parameters: model.countParams(),
    });
  } catch (e) {
    self.postMessage({
      runId,
      type: 'error',
      message: e instanceof Error ? e.message : '训练失败',
    });
  } finally {
    model?.dispose();
    x?.dispose();
    y?.dispose();
    vx?.dispose();
    vy?.dispose();
  }
};
