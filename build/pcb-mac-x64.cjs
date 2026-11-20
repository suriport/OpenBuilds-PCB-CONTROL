// PCB-Control: local build of an Intel macOS app (.dmg), ad-hoc signed, nothing published.
// Uses the "build" section of package.json and only changes what is needed for a local build.
//
// Usage (in the project folder, after `nvm use`):
//   npx electron-builder --mac dmg --x64 --publish never --config build/pcb-mac-x64.cjs
// Result: dist-pcb/PCB-Control-<version>.dmg

const pkg = require('../package.json');

const config = JSON.parse(JSON.stringify(pkg.build));
// keep old builds and local drafts out of the app
config.files = config.files.filter((f) => f !== '').concat(['!dist/**', '!dist-pcb/**', '!pr-drafts/**']);
config.extraFiles = []; // the "ssl" folder no longer exists
config.directories = { output: 'dist-pcb', buildResources: 'build' };
config.mac.identity = '-'; // ad-hoc signature, no Apple developer account needed
config.publish = null;

module.exports = config;
