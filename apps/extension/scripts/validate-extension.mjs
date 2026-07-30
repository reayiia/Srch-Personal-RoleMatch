import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const requiredFiles = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...manifest.content_scripts.flatMap((script) => script.js),
].filter(Boolean);

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));

if (missing.length > 0) {
  console.error(`Missing extension files:\n${missing.map((file) => `- ${file}`).join('\n')}`);
  process.exit(1);
}

console.log(`RoleMatch extension manifest valid with ${requiredFiles.length} referenced files.`);
