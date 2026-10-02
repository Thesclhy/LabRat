import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { estimateDeepSeekInput } from '../../backend/src/research/qaTokenCount.js';
import { CITED_ANSWER_SYSTEM } from '../../backend/src/research/citedAnswer.js';
import { RESEARCH_TOOLS } from '../../backend/src/research/evidenceTools.js';

// Public/synthetic inputs only; never load environment files or request logs.
const cases = {
  english: 'The catalyst was prepared from zinc oxide and tested under nitrogen. '.repeat(300),
  chinese: '催化剂为氧化锌。温度为二百摄氏度，气氛为氮气。检查原始表格与正文是否一致。'.repeat(200),
  scientific: 'ZnO H₂O CO₂ Ni/Al2O3 Pt–Ru (111) −12.5 °C 3.25×10−4 mol·g−1·s−1 pH 7.2 🔬 🧪 '.repeat(160),
  identifiers: Array.from({ length: 250 }, (_, i) => createHash('sha256').update(String(i)).digest('hex')).join('\n'),
  table: JSON.stringify(Array.from({ length: 160 }, (_, i) => ({ catalyst: 'Ni/Al₂O₃', row: i, yield: 0.235, unit: '%', missing: null }))),
  mixed: '样品 sample Exp17_QA‐08; δ¹³C = −23.4‰; 低质量扫描不能确认数值。'.repeat(250),
  tools: 'Which pages report the catalyst preparation conditions?',
  history: JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user',
    content: i % 2 ? [{ type: 'tool_use', id: `t${i}`, name: 'read_document_page', input: { page: i, cursor: 4000 } }]
      : '催化剂稳定性 was reported in the source. '.repeat(80) }))),
};
const samples = Object.entries(cases).map(([id, text]) => {
  const body = { model: 'deepseek-v4-pro', max_tokens: 4000,
    messages: [{ role: 'system', content: CITED_ANSWER_SYSTEM }, { role: 'user', content: text }],
    tools: RESEARCH_TOOLS.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } })) };
  return { id, estimate: estimateDeepSeekInput(body), body };
});
const output = path.resolve(process.argv[2] || 'artifacts/docling-pdf-pages/tokenizer/calibration-input.json');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(samples));
console.log(JSON.stringify({ output, cases: samples.length }));
