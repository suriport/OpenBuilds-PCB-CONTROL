// pcb2gcode.js - PCB-Control: Gerber wizard backend
//
// Runs the command line tool pcb2gcode (https://github.com/pcb2gcode/pcb2gcode) on Gerber/Excellon
// files that the UI uploads, and returns the generated G-code files as text.
//
// - POST /pcb2gcode: multipart form with the files (front, back, outline, drill) and a JSON field
//   "params" with the milling parameters. Responds with JSON {ok, files: {name: gcode}, log, args}.
// - socket 'pcb2gcodeStatus': where pcb2gcode was found and its version.
// - socket 'pcb2gcodeChoosePath': native file dialog on THIS computer to pick the executable.
//   The path can only be set through this dialog (never sent by a client), so a client in the
//   network cannot make the app run an arbitrary program.
//
// Nothing here sends anything to the machine. The G-code is only loaded into the editor by the UI.

// System dependencies
import path from 'path';
import fs from 'fs';
import os from 'os';
import {execFile} from 'child_process';
import multer from 'multer';
import {dialog, app as electronApp} from 'electron';

// App dependencies
import {
  debug_log,
  persistentConfig,
  savePersistentConfig,
} from './core.js';

import {jogWindowAPI} from './jogWindowAPI.js';

import {
  app,
  addConnectionHandler,
} from './server.js';


const MAX_FILE_SIZE = 50 * 1024 * 1024; // per Gerber file
const RUN_TIMEOUT_MS = 5 * 60 * 1000; // pcb2gcode can take a while on large boards
const LAYERS = ['front', 'back', 'outline', 'drill'];

// GUI apps on macOS do not get the PATH of the shell, so look in the usual places, too
const SEARCH_DIRS = [
  '/opt/local/bin', // MacPorts
  '/opt/homebrew/bin', // Homebrew (Apple Silicon)
  '/usr/local/bin', // Homebrew (Intel), own builds
  '/usr/bin',
];

// Numeric parameters: name -> [pcb2gcode option, min, max]
// Ranges are only a plausibility check against typing errors, values in mm, mm/min and RPM.
const NUMBER_PARAMS = {
  zsafe: ['zsafe', 0.5, 50],
  zchange: ['zchange', 1, 100],
  millDiameter: ['mill-diameters', 0.01, 5],
  isolationWidth: ['isolation-width', 0, 20],
  millingOverlap: ['milling-overlap', 1, 99], // %
  zwork: ['zwork', -2, 0],
  millFeed: ['mill-feed', 1, 5000],
  millVertFeed: ['mill-vertfeed', 1, 5000],
  millSpeed: ['mill-speed', 0, 100000],
  cutterDiameter: ['cutter-diameter', 0.1, 10],
  zcut: ['zcut', -10, 0],
  cutInfeed: ['cut-infeed', 0.05, 10],
  cutFeed: ['cut-feed', 1, 5000],
  cutVertFeed: ['cut-vertfeed', 1, 5000],
  cutSpeed: ['cut-speed', 0, 100000],
  zdrill: ['zdrill', -10, 0],
  drillFeed: ['drill-feed', 1, 5000],
  drillSpeed: ['drill-speed', 0, 100000],
  spinupTime: ['spinup-time', 0, 60], // s
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: MAX_FILE_SIZE, files: LAYERS.length},
}).fields(LAYERS.map((name) => ({name: name, maxCount: 1})));


function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// pcb2gcode shipped with the app (build/bundle-pcb2gcode.mjs), in development from vendor/
function bundledPcb2gcode() {
  if (process.platform !== 'darwin' || process.arch !== 'x64' && process.arch !== 'arm64') {
    return null;
  }
  const dir = electronApp.isPackaged ?
    path.join(process.resourcesPath, 'pcb2gcode') :
    path.join(electronApp.getAppPath(), 'vendor/pcb2gcode/mac-x64');
  const exePath = path.join(dir, 'pcb2gcode');
  return isExecutable(exePath) ? exePath : null;
}

// Order: path picked by the user, then the shipped one, then the search
function findPcb2gcode() {
  if (persistentConfig.pcb2gcodePath && isExecutable(persistentConfig.pcb2gcodePath)) {
    return persistentConfig.pcb2gcodePath;
  }
  const bundled = bundledPcb2gcode();
  if (bundled) {
    return bundled;
  }
  const exeName = process.platform === 'win32' ? 'pcb2gcode.exe' : 'pcb2gcode';
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(SEARCH_DIRS);
  for (const dir of dirs) {
    if (dir) {
      const candidate = path.join(dir, exeName);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function getVersion(exePath) {
  return new Promise((resolve) => {
    execFile(exePath, ['--version'], {timeout: 10000}, (err, stdout, stderr) => {
      const text = ((stdout || '') + (stderr || '')).trim();
      resolve(err && !text ? null : text.split('\n')[0]);
    });
  });
}

async function getStatus() {
  const exePath = findPcb2gcode();
  return {
    path: exePath,
    bundled: !!exePath && exePath === bundledPcb2gcode(),
    configuredPath: persistentConfig.pcb2gcodePath,
    version: exePath ? await getVersion(exePath) : null,
  };
}

// Builds the command line. Throws an Error with a readable message on invalid input.
// edgeOffset {x, y}: optional origin shift in mm (see measureBoardEdge)
function buildArgs(params, layers, edgeOffset) {
  const args = [
    '--metric=true',
    '--metricoutput=true',
    // Grbl 1.1 does not know these commands, pcb2gcode would emit them otherwise
    '--nog64=true', // path blending (G64)
    '--nom6=true', // tool change (M6), M0 pause is used instead
    '--nog81=true', // drill canned cycles (G81)
    '--nog91-1=true', // G91.1 arc mode
    '--zero-start=' + (params.zeroStart || edgeOffset ? 'true' : 'false'),
  ];
  if (edgeOffset) {
    args.push('--x-offset=' + edgeOffset.x, '--y-offset=' + edgeOffset.y);
  }

  const needed = ['zsafe', 'zchange', 'spinupTime'];
  if (layers.front || layers.back) {
    needed.push('millDiameter', 'isolationWidth', 'millingOverlap', 'zwork', 'millFeed', 'millVertFeed', 'millSpeed');
  }
  if (layers.outline) {
    needed.push('cutterDiameter', 'zcut', 'cutInfeed', 'cutFeed', 'cutVertFeed', 'cutSpeed');
  }
  if (layers.drill) {
    needed.push('zdrill', 'drillFeed', 'drillSpeed');
  }

  for (const name of needed) {
    const [option, min, max] = NUMBER_PARAMS[name];
    const value = Number(params[name]);
    if (params[name] === '' || params[name] === null || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(`Invalid value for ${option}: "${params[name]}" (allowed: ${min} … ${max})`);
    }
    if (name === 'millingOverlap') {
      args.push(`--${option}=${value}%`);
    } else {
      args.push(`--${option}=${value}`);
    }
  }

  if (Number(params.zchange) < Number(params.zsafe)) {
    throw new Error('Tool change height (zchange) must not be below the safe height (zsafe)');
  }

  if (layers.drill) {
    // drill from the front, with the board lying front side up
    args.push('--drill-side=front');
    if (params.oneDrill) {
      args.push('--onedrill=true'); // all holes with one bit, no tool change stops
    }
  }
  if (layers.outline) {
    args.push('--cut-side=front');
  }

  for (const name of LAYERS) {
    if (layers[name]) {
      args.push(`--${name}=${layers[name]}`);
    }
  }
  return args;
}

// Smallest X and Y that the G-code moves to (comments removed)
function gcodeMinXY(gcode) {
  let minX = Infinity;
  let minY = Infinity;
  for (const rawLine of gcode.split('\n')) {
    const line = rawLine.replace(/\(.*?\)/g, '').replace(/;.*/, '').toUpperCase();
    for (const match of line.matchAll(/([XY])\s*(-?\d*\.?\d+)/g)) {
      const value = Number(match[2]);
      if (match[1] === 'X') {
        minX = Math.min(minX, value);
      } else {
        minY = Math.min(minY, value);
      }
    }
  }
  return {x: minX, y: minY};
}

// "Zero at board edge": with --zero-start pcb2gcode puts X0 Y0 at the outline's bounding box
// (including the line width of the outline drawing) grown by the cutter diameter, so the board
// edge ends up at about cutter diameter + half line width. A quick run with only the outline
// shows where the cutter path really is. The board edge is the path plus the cutter radius,
// so shifting by minus that puts the finished edge at X0 / Y0 on all layers.
async function measureBoardEdge(exePath, params, outlinePath, workDir) {
  const measureDir = fs.mkdtempSync(path.join(workDir, 'measure-'));
  const args = buildArgs(params, {outline: outlinePath}).map((arg) =>
    arg.startsWith('--zero-start=') ? '--zero-start=true' : arg);
  const result = await runPcb2gcode(exePath, args, measureDir);
  const ngcPath = path.join(measureDir, 'outline.ngc');
  if (!fs.existsSync(ngcPath)) {
    throw new Error('Could not measure the board outline (pcb2gcode: ' + (result.log || 'no output') + ')');
  }
  const min = gcodeMinXY(fs.readFileSync(ngcPath, 'utf8'));
  if (!Number.isFinite(min.x) || !Number.isFinite(min.y)) {
    throw new Error('Could not measure the board outline (no moves found)');
  }
  const radius = Number(params.cutterDiameter) / 2;
  const round = (value) => Math.round(value * 10000) / 10000;
  return {x: round(-(min.x + radius)), y: round(-(min.y + radius))};
}

function runPcb2gcode(exePath, args, workDir) {
  return new Promise((resolve) => {
    // no shell: arguments are passed directly, file names cannot inject commands
    execFile(exePath, args, {cwd: workDir, timeout: RUN_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024},
      (err, stdout, stderr) => {
        resolve({err: err, log: ((stdout || '') + (stderr || '')).trim()});
      });
  });
}

// app.post('/pcb2gcode')
function onPcb2gcodeRequest(req, res) {
  upload(req, res, async function(uploadErr) {
    if (uploadErr) {
      return res.json({ok: false, error: 'Upload failed: ' + uploadErr.message});
    }

    let workDir = null;
    try {
      const exePath = findPcb2gcode();
      if (!exePath) {
        return res.json({ok: false, error: 'pcb2gcode was not found on this computer'});
      }

      let params;
      try {
        params = JSON.parse(req.body.params || '{}');
      } catch {
        return res.json({ok: false, error: 'Invalid parameters'});
      }

      // Own empty folder for each run: pcb2gcode would also read a "millproject" file from its
      // working directory, and the uploaded files get fixed names (the original names are not used)
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-control-gerber-'));
      const files = req.files || {};
      const layers = {};
      for (const name of LAYERS) {
        if (files[name] && files[name][0] && files[name][0].size > 0) {
          const fileName = name + (name === 'drill' ? '.drl' : '.gbr');
          fs.writeFileSync(path.join(workDir, fileName), files[name][0].buffer);
          layers[name] = fileName;
        }
      }
      if (Object.keys(layers).length === 0) {
        return res.json({ok: false, error: 'No Gerber or drill file selected'});
      }
      let args;
      let edgeOffset = null;
      try {
        buildArgs(params, layers); // check the values before the measuring run
        if (params.zeroAtEdge && layers.outline) {
          edgeOffset = await measureBoardEdge(exePath, params, path.join(workDir, layers.outline), workDir);
          debug_log('pcb2gcode: board edge offset X' + edgeOffset.x + ' Y' + edgeOffset.y);
        }
        args = buildArgs(params, layers, edgeOffset);
      } catch (err) {
        return res.json({ok: false, error: err.message});
      }

      debug_log('pcb2gcode: ' + exePath + ' ' + args.join(' '));
      const result = await runPcb2gcode(exePath, args, workDir);

      const output = {};
      for (const fileName of fs.readdirSync(workDir)) {
        if (fs.statSync(path.join(workDir, fileName)).isFile() && fileName.toLowerCase().endsWith('.ngc')) {
          output[fileName] = fs.readFileSync(path.join(workDir, fileName), 'utf8');
        }
      }

      if (result.err && Object.keys(output).length === 0) {
        const reason = result.err.killed ? 'timeout' : ('exit code ' + result.err.code);
        return res.json({ok: false, error: 'pcb2gcode failed (' + reason + ')', log: result.log, args: args});
      }
      res.json({ok: true, files: output, log: result.log, args: args, edgeOffset: edgeOffset, edgeNotApplied: !!params.zeroAtEdge && !layers.outline, warning: result.err ? 'pcb2gcode reported an error, check the log' : ''});
    } catch (err) {
      debug_log(err);
      res.json({ok: false, error: err.toString()});
    } finally {
      if (workDir) {
        fs.rm(workDir, {recursive: true, force: true}, () => {});
      }
    }
  });
}

function choosePath(data, callback) {
  dialog.showOpenDialog(jogWindowAPI.getJogWindow(), {
    title: 'Select the pcb2gcode program',
    defaultPath: persistentConfig.pcb2gcodePath || '/opt/local/bin',
    properties: ['openFile', 'showHiddenFiles'],
  }).then(async (result) => {
    if (!result.canceled && result.filePaths.length > 0) {
      if (!isExecutable(result.filePaths[0])) {
        dialog.showMessageBox(jogWindowAPI.getJogWindow(), {
          type: 'error',
          buttons: ['OK'],
          message: result.filePaths[0] + ' is not an executable program.',
        });
      } else {
        persistentConfig.pcb2gcodePath = result.filePaths[0];
        savePersistentConfig();
      }
    }
    if (typeof callback === 'function') {
      callback(await getStatus());
    }
  }).catch((err) => debug_log(err));
}

function onConnection(socket) {
  socket.on('pcb2gcodeStatus', async (data, callback) => {
    if (typeof callback === 'function') {
      callback(await getStatus());
    }
  });

  socket.on('pcb2gcodeChoosePath', choosePath);
}

function initPcb2gcode() {
  app.post('/pcb2gcode', onPcb2gcodeRequest);
  addConnectionHandler(onConnection);
}

export {
  initPcb2gcode,
  buildArgs,
};
