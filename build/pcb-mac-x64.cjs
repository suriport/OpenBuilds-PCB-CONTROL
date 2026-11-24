// PCB-Control: local build of an Intel macOS app (.dmg), ad-hoc signed, nothing published.
// Uses the "build" section of package.json and only changes what is needed for a local build.
//
// Usage (in the project folder, after `nvm use`):
//   npx electron-builder --mac dmg --x64 --publish never --config build/pcb-mac-x64.cjs
// Result: dist-pcb/PCB-Control-<version>.dmg
// Run `node build/bundle-pcb2gcode.mjs` once before, so pcb2gcode is shipped with the app.

const pkg = require('../package.json');

const config = JSON.parse(JSON.stringify(pkg.build));
// keep old builds and local drafts out of the app
config.files = config.files.filter((f) => f !== '').concat(['!dist/**', '!dist-pcb/**', '!pr-drafts/**', '!vendor/**']);
// pcb2gcode with its libraries and license texts, created by `node build/bundle-pcb2gcode.mjs`
// (outside of app.asar, programs cannot be started from inside the archive)
config.extraResources = [{ from: 'vendor/pcb2gcode/mac-x64', to: 'pcb2gcode' }];
config.extraFiles = []; // the "ssl" folder no longer exists
config.directories = { output: 'dist-pcb', buildResources: 'build' };
// PCB-Control app icon (build/pcb/icon.icns, made from the PCB-Control icon image)
config.icon = 'build/pcb/icon.icns';
config.mac.icon = 'build/pcb/icon.icns';
if (config.dmg) config.dmg.icon = 'build/pcb/icon.icns';
// shown in the macOS "Get Info" window (otherwise built from "author" in package.json)
config.copyright = 'Copyright © ' + new Date().getFullYear() + ' github.com/suriport/OpenBuilds-PCB-CONTROL';
config.mac.identity = '-'; // ad-hoc signature, no Apple developer account needed
config.publish = null;

module.exports = config;
