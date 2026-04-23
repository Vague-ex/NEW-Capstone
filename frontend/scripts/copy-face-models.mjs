import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const sourceDir = resolve(projectRoot, 'node_modules', 'modern-face-api', 'weights');
const targetDir = resolve(projectRoot, 'public', 'modern-face-models');

if (!existsSync(sourceDir)) {
  console.warn('[copy-face-models] Source not found, skipping:', sourceDir);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true, force: true });
console.log('[copy-face-models] Copied weights to', targetDir);
