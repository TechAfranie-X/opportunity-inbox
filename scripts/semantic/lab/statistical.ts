import type { RecruitingEmail } from "../../../lib/recruiting/types.ts";
import { parseSender } from "../../../lib/opportunities/normalize.ts";

/**
 * A local statistical reader: hashed word and word-pair features of what a message says (subject, the start of the body, the sender's
 * domain), and a regularised logistic regression. It is a second opinion built from different evidence than the rule reader (what the
 * text is about, not which phrases fire), and runs on the machine with no dependency. It only ever scores; it never extracts a value.
 */
export const DIM = 1 << 15;

const STOP = new Set("the a an and or of to in on at for with your you we our is are be this that it as by from have has will can please if not no hi hello dear thanks thank regards best sincerely team".split(" "));

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % DIM;
}

export type Sparse = Map<number, number>;

export function features(email: Pick<RecruitingEmail, "from" | "subject" | "bodyText">): Sparse {
  const text = `${email.subject}\n${email.subject}\n${email.bodyText.slice(0, 1500)}`.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^a-z\s]/g, " ");
  const words = text.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const f: Sparse = new Map();
  const add = (k: string, v = 1) => { const i = hash(k); f.set(i, (f.get(i) ?? 0) + v); };
  for (let i = 0; i < words.length; i += 1) { add(`w:${words[i]}`); if (i + 1 < words.length) add(`b:${words[i]}_${words[i + 1]}`); }
  add(`d:${parseSender(email.from).domain}`);
  const norm = Math.sqrt([...f.values()].reduce((s, v) => s + v * v, 0)) || 1;
  for (const [i, v] of f) f.set(i, v / norm);
  return f;
}

export type Model = { w: Float64Array; b: number };

export function train(samples: Array<{ x: Sparse; y: 0 | 1 }>, opts: { epochs?: number; lr?: number; l2?: number } = {}): Model {
  const { epochs = 30, lr = 0.5, l2 = 1e-4 } = opts;
  const w = new Float64Array(DIM);
  let b = 0;
  const pos = samples.filter((s) => s.y === 1).length || 1;
  const weight = { 1: Math.min(10, (samples.length - pos) / pos), 0: 1 };
  for (let e = 0; e < epochs; e += 1) {
    for (let k = 0; k < samples.length; k += 1) {
      const s = samples[(k * 7919 + e * 104729) % samples.length]; // deterministic shuffle
      let z = b;
      for (const [i, v] of s.x) z += w[i] * v;
      const p = 1 / (1 + Math.exp(-z));
      const g = (p - s.y) * weight[s.y];
      for (const [i, v] of s.x) w[i] -= lr * (g * v + l2 * w[i]);
      b -= lr * g;
    }
  }
  return { w, b };
}

export function score(model: Model, x: Sparse): number {
  let z = model.b;
  for (const [i, v] of x) z += model.w[i] * v;
  return 1 / (1 + Math.exp(-z));
}
