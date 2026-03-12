const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const frontendDir = path.join(__dirname, '..', 'src', 'frontend');
const outDir = path.join(frontendDir, 'build');
const adminDir = path.join(__dirname, '..', 'src', 'admin');
const adminOutDir = path.join(adminDir, 'build');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(adminOutDir, { recursive: true });

function run() {
  try {
    esbuild.buildSync({
      entryPoints: [path.join(frontendDir, 'main.js')],
      bundle: true,
      format: 'iife',
      outfile: path.join(outDir, 'main.js'),
      platform: 'browser',
      target: ['es2020'],
    });
    const indexPath = path.join(frontendDir, 'index.html');
    let indexHtml = fs.readFileSync(indexPath, 'utf8');
    const version = Date.now();
    indexHtml = indexHtml.replace(
      /(src="build\/main\.js)(?:\?v=\d+)*"/,
      `$1?v=${version}"`
    );
    fs.writeFileSync(indexPath, indexHtml);
    console.log('Frontend bundled to src/frontend/build/main.js');

    esbuild.buildSync({
      entryPoints: [path.join(adminDir, 'admin.js')],
      bundle: true,
      format: 'iife',
      outfile: path.join(adminOutDir, 'main.js'),
      platform: 'browser',
      target: ['es2020'],
    });
    console.log('Admin UI bundled to src/admin/build/main.js');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

run();
