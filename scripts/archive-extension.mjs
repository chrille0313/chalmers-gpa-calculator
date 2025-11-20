import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const extensionDir = path.resolve(repoRoot, 'extension');
const releaseDir = path.resolve(repoRoot, 'release');

const versionArg = process.argv[2] ?? 'dev-build';
const zipName = `chalmers-gpa-calculator-${versionArg}.zip`;
const zipPath = path.join(releaseDir, zipName);

async function ensureExtensionBuild() {
  try {
    await access(extensionDir);
  } catch {
    throw new Error('Missing "extension" directory. Run "npm run build" before archiving.');
  }
}

function archiveDirectory(sourceDir, targetFile) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(targetFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function run() {
  await ensureExtensionBuild();
  await mkdir(releaseDir, { recursive: true });
  await archiveDirectory(extensionDir, zipPath);
  console.log(`[archive-extension] Created ${zipPath}`);
}

run().catch((error) => {
  console.error('[archive-extension] Failed to create archive', error);
  process.exitCode = 1;
});
