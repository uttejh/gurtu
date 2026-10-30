import { spawnSync } from 'node:child_process';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

try { process.loadEnvFile(); } catch { /* Deployment environment may export variables directly. */ }

const projectUrl = process.env.SUPABASE_URL;
const apiKey = process.env.OPENAI_API_KEY;
if (!projectUrl || !apiKey) {
  console.error('Set SUPABASE_URL and OPENAI_API_KEY in the ignored local .env first.');
  process.exit(1);
}

let projectRef;
try {
  projectRef = new URL(projectUrl).hostname.split('.')[0];
} catch {
  console.error('SUPABASE_URL is not a valid project URL.');
  process.exit(1);
}
if (!projectRef || projectRef === 'localhost' || projectRef === '127') {
  console.error('Set SUPABASE_URL to the hosted Supabase project before uploading Edge Function secrets.');
  process.exit(1);
}

const secretLines = [
  `OPENAI_API_KEY=${apiKey}`,
  `OPENAI_TEXT_MODEL=${process.env.OPENAI_TEXT_MODEL || 'gpt-6-luna'}`,
  `OPENAI_TRANSCRIPTION_MODEL=${process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-transcribe'}`,
];
if (process.env.APP_ORIGINS) secretLines.push(`APP_ORIGINS=${process.env.APP_ORIGINS}`);

const secretFile = path.join('.supabase', 'edge-secrets.tmp');
await mkdir('.supabase', { recursive: true, mode: 0o700 });
await writeFile(secretFile, `${secretLines.join('\n')}\n`, { mode: 0o600 });
await chmod(secretFile, 0o600);
try {
  const result = spawnSync('supabase', ['secrets', 'set', '--env-file', secretFile, '--project-ref', projectRef], { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exitCode = 1;
} finally {
  await rm(secretFile, { force: true });
}
if (process.exitCode === 1) console.error('The Edge Function secrets were not confirmed. Check Supabase CLI login and project access.');
else console.log('OpenAI Edge Function secrets were uploaded; the temporary local file was removed.');
