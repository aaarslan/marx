// electron-builder afterPack hook: ad-hoc sign the .app so Apple Silicon
// accepts it. Without a bundle signature, macOS blocks unsigned apps copied
// from a DMG ("can't be opened" / "damaged") even though they run from
// the build directory. Ad-hoc signing needs no Apple Developer certificate;
// Gatekeeper then treats the app as "signed but unnotarized", which users
// can open via right-click → Open on first run.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`\n[after-pack] ad-hoc signing ${appPath}`);
  execFileSync(
    'codesign', ['--force', '--deep', '--sign', '-', '--identifier', 'com.marx.scanner', appPath],
    { stdio: 'inherit' }
  );
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=1', appPath], { stdio: 'inherit' });
};
