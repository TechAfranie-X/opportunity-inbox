/** A regularised logistic regression on dense vectors (the on-device sentence embeddings). Deterministic; no dependencies. */
export type DenseModel = { w: Float64Array; b: number; mean: Float64Array; scale: number };

export function trainDense(samples: Array<{ x: number[]; y: 0 | 1 }>, opts: { epochs?: number; lr?: number; l2?: number } = {}): DenseModel {
  const { epochs = 200, lr = 0.1, l2 = 1e-2 } = opts;
  const d = samples[0].x.length;
  const mean = new Float64Array(d);
  for (const s of samples) for (let i = 0; i < d; i += 1) mean[i] += s.x[i] / samples.length;
  let scale = 0;
  for (const s of samples) for (let i = 0; i < d; i += 1) scale += (s.x[i] - mean[i]) ** 2;
  scale = Math.sqrt(scale / (samples.length * d)) || 1;
  const xs = samples.map((s) => Float64Array.from(s.x, (v, i) => (v - mean[i]) / scale));
  const w = new Float64Array(d);
  let b = 0;
  const pos = samples.filter((s) => s.y === 1).length || 1;
  const cw = [1, Math.min(10, (samples.length - pos) / pos)];
  for (let e = 0; e < epochs; e += 1) {
    const gw = new Float64Array(d);
    let gb = 0;
    for (let k = 0; k < samples.length; k += 1) {
      let z = b;
      for (let i = 0; i < d; i += 1) z += w[i] * xs[k][i];
      const g = (1 / (1 + Math.exp(-z)) - samples[k].y) * cw[samples[k].y];
      for (let i = 0; i < d; i += 1) gw[i] += g * xs[k][i];
      gb += g;
    }
    for (let i = 0; i < d; i += 1) w[i] -= (lr / samples.length) * (gw[i] + l2 * samples.length * w[i]);
    b -= (lr / samples.length) * gb;
  }
  return { w, b, mean, scale };
}

export function scoreDense(m: DenseModel, x: number[]): number {
  let z = m.b;
  for (let i = 0; i < x.length; i += 1) z += m.w[i] * ((x[i] - m.mean[i]) / m.scale);
  return 1 / (1 + Math.exp(-z));
}
