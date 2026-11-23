// PCB-Control: copies a locally built pcb2gcode together with all libraries it needs into
// vendor/pcb2gcode/mac-x64, so the app can ship it (see build/pcb-mac-x64.cjs).
//
// pcb2gcode built with MacPorts loads its libraries from /opt/local, which other Macs do not have.
// This script copies them next to the program and changes the references inside the files
// (install_name_tool) to "next to the program", then signs everything again (ad-hoc).
// It also collects the license texts: pcb2gcode is GPL-3, the libraries are GPL/LGPL/MIT/BSD-like.
//
// Usage (in the project folder):
//   node build/bundle-pcb2gcode.mjs [path to pcb2gcode]
// Default path: ~/Projekte/build-pcb2gcode/pcb2gcode/build/pcb2gcode
// Needs: Xcode command line tools (otool, install_name_tool, codesign), MacPorts with the libraries.

import fs from 'fs';
import os from 'os';
import path from 'path';
import {execFileSync} from 'child_process';

const projectDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const source = path.resolve(process.argv[2] || path.join(os.homedir(), 'Projekte/build-pcb2gcode/pcb2gcode/build/pcb2gcode'));
const sourceRepo = path.resolve(path.dirname(source), '..');
const outDir = path.join(projectDir, 'vendor/pcb2gcode/mac-x64');
const libDir = path.join(outDir, 'lib');
const licenseDir = path.join(outDir, 'licenses');
const LIB_PREFIX = '/opt/local/';

function run(cmd, args) {
  return execFileSync(cmd, args, {encoding: 'utf8'});
}

// Libraries a Mach-O file loads (first line of otool -L is the file itself / its own id)
function dependencies(file) {
  return run('otool', ['-L', file]).split('\n').slice(1)
    .map((line) => line.trim().split(' ')[0])
    .filter((dep) => dep);
}

if (!fs.existsSync(source)) {
  console.error('pcb2gcode not found: ' + source);
  process.exit(1);
}

fs.rmSync(outDir, {recursive: true, force: true});
fs.mkdirSync(libDir, {recursive: true});
fs.mkdirSync(licenseDir, {recursive: true});

// 1. find all libraries from /opt/local, also the ones the libraries load
const libs = new Map(); // original path -> file name in lib/
const todo = [source];
while (todo.length > 0) {
  const file = todo.pop();
  for (const dep of dependencies(file)) {
    if (dep.startsWith('@')) {
      throw new Error(`${file} uses a relative library reference (${dep}), not supported by this script`);
    }
    if (dep.startsWith(LIB_PREFIX) && !libs.has(dep)) {
      const name = path.basename(dep);
      if ([...libs.values()].includes(name)) {
        throw new Error('Two libraries with the same name: ' + name);
      }
      libs.set(dep, name);
      todo.push(dep);
    }
  }
}

// 2. copy (the real file, not the symlink, under the name it is referenced with)
const exe = path.join(outDir, 'pcb2gcode');
fs.copyFileSync(source, exe);
fs.chmodSync(exe, 0o755);
for (const [orig, name] of libs) {
  const target = path.join(libDir, name);
  fs.copyFileSync(fs.realpathSync(orig), target);
  fs.chmodSync(target, 0o644);
}

// 3. change the references: program -> @executable_path/lib/x, library -> @loader_path/x
function relink(file, prefix, isLib) {
  const args = [];
  if (isLib) {
    args.push('-id', '@loader_path/' + path.basename(file));
  }
  for (const dep of dependencies(file)) {
    if (libs.has(dep)) {
      args.push('-change', dep, prefix + libs.get(dep));
    }
  }
  if (args.length > 0) {
    run('install_name_tool', [...args, file]);
  }
}
relink(exe, '@executable_path/lib/', false);
for (const name of libs.values()) {
  relink(path.join(libDir, name), '@loader_path/', true);
}

// 4. sign again (install_name_tool breaks the signatures), libraries first
for (const name of libs.values()) {
  run('codesign', ['--force', '--sign', '-', path.join(libDir, name)]);
}
run('codesign', ['--force', '--sign', '-', exe]);

// 5. check: nothing may point to /opt/local any more
for (const file of [exe, ...[...libs.values()].map((name) => path.join(libDir, name))]) {
  const left = dependencies(file).filter((dep) => dep.startsWith(LIB_PREFIX));
  if (left.length > 0) {
    throw new Error(`${file} still loads ${left.join(', ')}`);
  }
}
const version = run(exe, ['--version']).trim().split('\n')[0];

// 6. licenses: which MacPorts port provides which library
const ports = new Map(); // port -> [library names]
for (const [orig, name] of libs) {
  const answer = run('port', ['provides', fs.realpathSync(orig)]);
  const port = (answer.match(/is provided by: (\S+)/) || [])[1] || 'unknown';
  ports.set(port, (ports.get(port) || []).concat(name));
}

let commit = '';
try {
  commit = run('git', ['-C', sourceRepo, 'describe', '--tags', '--always']).trim() + ' (' +
    run('git', ['-C', sourceRepo, 'rev-parse', 'HEAD']).trim() + ')';
} catch {
  commit = 'unknown';
}
if (fs.existsSync(path.join(sourceRepo, 'COPYING'))) {
  fs.copyFileSync(path.join(sourceRepo, 'COPYING'), path.join(licenseDir, 'pcb2gcode-COPYING-GPL-3.txt'));
}

let table = '';
for (const [port, names] of [...ports].sort()) {
  let info = '';
  try {
    info = run('port', ['info', '--line', '--version', '--license', '--homepage', port]).trim().replace(/\t/g, ' | ');
  } catch {
    info = '?';
  }
  table += `- ${port}: ${info}\n    ${names.join(', ')}\n`;
  const docDir = path.join('/opt/local/share/doc', port);
  if (fs.existsSync(docDir)) {
    for (const file of fs.readdirSync(docDir)) {
      if (/copying|license|licence|copyright/i.test(file) && fs.statSync(path.join(docDir, file)).isFile()) {
        fs.copyFileSync(path.join(docDir, file), path.join(licenseDir, `${port}-${file}`));
      }
    }
  }
}

fs.writeFileSync(path.join(outDir, 'README.txt'), `pcb2gcode, shipped with PCB-Control
====================================

${version}
Source: https://github.com/pcb2gcode/pcb2gcode, ${commit}
License: GNU General Public License version 3, see licenses/pcb2gcode-COPYING-GPL-3.txt

PCB-Control runs pcb2gcode as a separate program. It was built on macOS with MacPorts:
  cmake -S . -B build -DBUILD_TESTING=OFF -DCMAKE_BUILD_TYPE=Release \\
    -DBoost_DIR=/opt/local/libexec/boost/1.76/lib/cmake/Boost-1.76.0 \\
    -DCMAKE_PREFIX_PATH="/opt/local/libexec/boost/1.76;/opt/local"
  cmake --build build
and bundled with build/bundle-pcb2gcode.mjs of PCB-Control.

The libraries in lib/ are unchanged copies from MacPorts (only the library references
were changed with install_name_tool so they are loaded from this folder). You may replace them
with your own builds. Source code of each library: see the homepage below, or the MacPorts
distfiles (https://distfiles.macports.org/<port>/, "port source <port>").
License texts that MacPorts installs are in licenses/.

MacPorts port: version | license | homepage
    libraries
${table}`);

console.log(`${version}\n${libs.size} libraries, ${ports.size} ports -> ${path.relative(projectDir, outDir)}`);
