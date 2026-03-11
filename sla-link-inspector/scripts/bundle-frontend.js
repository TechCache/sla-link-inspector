const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const frontendDir = path.join(__dirname, '..', 'src', 'frontend');
const outDir = path.join(frontendDir, 'build');

fs.mkdirSync(outDir, { recursive: true });

async function run() {
  try {
    await esbuild.build({
      entryPoints: [path.join(frontendDir, 'main.js')],
      bundle: true,
      format: 'iife',
      outfile: path.join(outDir, 'main.js'),
      platform: 'browser',
      target: ['es2020'],
    });
    console.log('Frontend bundled to src/frontend/build/main.js');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

run();
