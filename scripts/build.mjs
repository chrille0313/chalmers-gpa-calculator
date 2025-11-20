import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.resolve(rootDir, 'public');
const outDir = path.resolve(rootDir, 'extension');

async function copyPublicAssets() {
  try {
    const info = await stat(publicDir);
    if (!info.isDirectory()) {
      console.warn(`[build] "${publicDir}" is not a directory, skipping asset copy.`);
      return;
    }
  } catch {
    console.warn('[build] "public" directory not found, skipping asset copy.');
    return;
  }

  await cp(publicDir, outDir, { recursive: true });
  console.log('[build] Copied public assets.');
}

async function cleanOutDir() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
}

const buildOptions = {
  entryPoints: {
    'content-script': path.resolve(rootDir, 'src/content-script.ts'),
    popup: path.resolve(rootDir, 'src/popup.ts')
  },
  bundle: true,
  sourcemap: true,
  minify: true,
  target: ['chrome110'],
  format: 'esm',
  outdir: outDir,
  platform: 'browser',
  logLevel: 'info'
};

async function run() {
  await cleanOutDir();
  await esbuild.build(buildOptions);
  await copyPublicAssets();
  console.log('[build] Build completed.');
}

run().catch((error) => {
  console.error('[build] Failed to bundle extension:', error);
  process.exitCode = 1;
});
