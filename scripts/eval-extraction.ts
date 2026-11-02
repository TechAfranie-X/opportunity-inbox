// Usage: npm run eval:extraction
import { evaluateExtraction } from "../lib/recruiting/eval.ts";
import { buildDemoMailbox } from "../lib/recruiting/fixtures.ts";

const report = evaluateExtraction(buildDemoMailbox(new Date()));
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
console.log(`emails: ${report.total} (${report.recruiting} recruiting, ${report.noise} noise)`);
console.log(`type ${pct(report.typeAccuracy)} · company ${pct(report.companyAccuracy)} · role ${pct(report.roleAccuracy)} · date ${pct(report.dateAccuracy)} · noise rejected ${pct(report.noiseRejected)}`);
for (const m of report.mismatches) {
  console.log(`  ✗ [${m.field}] "${m.subject}" expected=${JSON.stringify(m.expected)} actual=${JSON.stringify(m.actual)}`);
}
process.exit(report.mismatches.length === 0 ? 0 : 1);
