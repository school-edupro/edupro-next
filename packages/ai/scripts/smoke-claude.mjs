// Sends one real request through ClaudeProvider so the provider is exercised against the Claude API.
// Reads ANTHROPIC_API_KEY (and optionally AI_MODEL, ANTHROPIC_BASE_URL) from the environment; never
// stores the key. Run from the repo root after `pnpm --filter @edupro/ai build`:
//   set -a; source .env; set +a; pnpm --filter @edupro/ai smoke:claude
import { ClaudeProvider } from '../dist/index.js';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set; add it to .env (it stays local) and run again.');
  process.exit(2);
}
const provider = new ClaudeProvider({
  apiKey,
  model: process.env.AI_MODEL,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  timeoutMs: 45_000,
});

const tools = [
  {
    name: 'fee_defaulters',
    description: 'Students of one class whose fee balance is above a threshold.',
    inputSchema: {
      type: 'object',
      properties: {
        className: { type: 'string', description: 'Class name such as VI' },
        minBalance: { type: 'number', description: 'Minimum outstanding balance in rupees' },
      },
      required: ['className'],
    },
  },
];

const started = Date.now();
const first = await provider.complete({
  system:
    'You are the EduPro school ERP assistant. Answer only through the tools offered; never invent figures.',
  messages: [{ role: 'user', content: 'Which students of class VI owe more than 5,000?' }],
  tools,
  maxTokens: 300,
  temperature: 0,
  metadata: { userId: 'smoke' },
});
console.log('model     :', first.model);
console.log('stop      :', first.stopReason);
console.log('latency   :', `${first.latencyMs} ms`);
console.log('usage     :', first.usage);
console.log('tool calls:', JSON.stringify(first.toolCalls));
if (first.text) console.log('text      :', first.text);

const call = first.toolCalls[0];
if (!call || call.name !== 'fee_defaulters') {
  console.error('FAIL: expected a fee_defaulters tool call');
  process.exit(1);
}
const args = /** @type {{ className?: string; minBalance?: number }} */ (call.input);
if (String(args.className ?? '').toUpperCase() !== 'VI' || Number(args.minBalance) !== 5000) {
  console.error('FAIL: unexpected tool arguments', args);
  process.exit(1);
}
console.log(
  `PASS: the provider mapped the question to fee_defaulters(VI, 5000) in ${Date.now() - started} ms`,
);
