"use strict";

// PCB-Control: Gerber wizard (first version).
//
// Uploads Gerber/Excellon files to the backend (src/pcb2gcode.js), which runs the command line tool
// pcb2gcode and returns the generated G-code files. Each file can be loaded into the G-code editor
// or saved. Nothing here sends anything to the machine: the user starts the job as usual.
//
// Parameters are stored per computer in localStorage, like the other wizards.
// Selected files and the generated G-code stay in memory until the program is closed, so the
// wizard can be opened again after milling one file to load the next one.

const PCB_GERBER_STORAGE_KEY = 'pcbGerberWizard';

// id -> default value (mm, mm/min, RPM, s)
const PCB_GERBER_DEFAULTS = {
  zsafe: 2,
  zchange: 20,
  spinupTime: 1,
  zeroStart: true,
  oneDrill: false,
  zeroAtEdge: false,
  millDiameter: 0.2,
  isolationWidth: 0,
  millingOverlap: 50,
  zwork: -0.05,
  millFeed: 200,
  millVertFeed: 50,
  millSpeed: 10000,
  cutterDiameter: 1,
  zcut: -1.7,
  cutInfeed: 0.6,
  cutFeed: 150,
  cutVertFeed: 50,
  cutSpeed: 10000,
  zdrill: -1.8,
  drillFeed: 50,
  drillSpeed: 10000,
};

const PCB_GERBER_LAYERS = [
  {id: 'front', label: 'Front copper', hint: 'e.g. *-F_Cu.gbr, *.GTL'},
  {id: 'back', label: 'Back copper', hint: 'e.g. *-B_Cu.gbr, *.GBL'},
  {id: 'outline', label: 'Board outline', hint: 'e.g. *-Edge_Cuts.gbr, *.GKO, *.GM1'},
  {id: 'drill', label: 'Drill file', hint: 'Excellon, e.g. *.drl, *.xln'},
];

const PCB_GERBER_CHECKBOXES = ['zeroStart', 'oneDrill', 'zeroAtEdge'];

// kept until the program is closed
var pcbGerberResult = null; // last answer from the backend
var pcbGerberFiles = {}; // layer id -> File
var pcbGerberLoaded = {}; // G-code file name -> time it was loaded into the editor

function pcbGerberNumberRow(id, label, unit, title) {
  return `
    <div class="row mb-1">
      <label class="cell-sm-6" style="padding-top:5px;" ${title ? `title="${title}"` : ''}>${label}${title ? ' <span class="far fa-question-circle"></span>' : ''}</label>
      <div class="cell-sm-6">
        <input id="pcbGerber_${id}" type="number" step="any" data-role="input" data-append="${unit}" data-clear-button="false" data-editable="true">
      </div>
    </div>`;
}

function pcbGerberTemplate() {
  const fileRows = PCB_GERBER_LAYERS.map((layer) => `
    <div class="row mb-1">
      <label class="cell-sm-3" style="padding-top:3px;">${layer.label}</label>
      <div class="cell-sm-9">
        <input id="pcbGerberFile_${layer.id}" type="file" style="width:100%;" onchange="pcbGerberFileChanged('${layer.id}', this)">
        <small class="dark">${layer.hint}</small>
      </div>
    </div>`).join('');

  return `
  <form onsubmit="return false;" style="max-height:calc(100vh - 240px); overflow-y:auto; overflow-x:hidden; padding-right:10px;">
    <div class="row mb-2 pb-2 border-bottom bd-dialog">
      <div class="cell-sm-9" id="pcbGerberToolStatus"><i class="fas fa-spinner fa-pulse"></i> Searching for pcb2gcode…</div>
      <div class="cell-sm-3 text-right">
        <button type="button" class="button small" onclick="pcbGerberChoosePath()" title="Select the pcb2gcode program on this computer">Select pcb2gcode…</button>
      </div>
    </div>

    <div class="mb-2 pb-2 border-bottom bd-dialog">
      <b>Files</b> <small class="dark">(at least one; the files must come from the same board export)</small>
      ${fileRows}
    </div>

    <div class="row mb-2 pb-2 border-bottom bd-dialog">
      <div class="cell-sm-6">
        <b>Isolation milling</b> <small class="dark">(front / back copper)</small>
        ${pcbGerberNumberRow('millDiameter', 'Tool diameter', 'mm', 'Effective cutting width of the engraving bit at the milling depth')}
        ${pcbGerberNumberRow('isolationWidth', 'Isolation width', 'mm', 'Minimum width of copper removed around the tracks.\\n0 = a single pass with the tool')}
        ${pcbGerberNumberRow('millingOverlap', 'Overlap', '%', 'Overlap between passes if more than one pass is needed')}
        ${pcbGerberNumberRow('zwork', 'Milling depth', 'mm', 'Z while milling, negative (below the copper surface = Z0)')}
        ${pcbGerberNumberRow('millFeed', 'Feed', 'mm/min')}
        ${pcbGerberNumberRow('millVertFeed', 'Plunge feed', 'mm/min')}
        ${pcbGerberNumberRow('millSpeed', 'Spindle', 'RPM')}
      </div>
      <div class="cell-sm-6">
        <b>General</b>
        ${pcbGerberNumberRow('zsafe', 'Safe height', 'mm', 'Z for rapid moves between cuts')}
        ${pcbGerberNumberRow('zchange', 'Tool change height', 'mm', 'Z for the tool change pause (M0)')}
        ${pcbGerberNumberRow('spinupTime', 'Spindle spin-up', 's', 'Dwell after starting the spindle')}
        <div class="row mb-1">
          <label class="cell-sm-6" style="padding-top:5px;" title="Moves the lower left corner of the board to X0 Y0">Zero at lower left <span class="far fa-question-circle"></span></label>
          <div class="cell-sm-6">
            <input id="pcbGerber_zeroStart" type="checkbox" data-role="checkbox" data-style="2">
          </div>
        </div>
      </div>
    </div>

    <div class="row mb-2 pb-2 border-bottom bd-dialog">
      <div class="cell-sm-6">
        <b>Board outline</b>
        ${pcbGerberNumberRow('cutterDiameter', 'Cutter diameter', 'mm')}
        ${pcbGerberNumberRow('zcut', 'Cut depth', 'mm', 'Final Z, negative: board thickness plus a little')}
        ${pcbGerberNumberRow('cutInfeed', 'Depth per pass', 'mm')}
        ${pcbGerberNumberRow('cutFeed', 'Feed', 'mm/min')}
        ${pcbGerberNumberRow('cutVertFeed', 'Plunge feed', 'mm/min')}
        ${pcbGerberNumberRow('cutSpeed', 'Spindle', 'RPM')}
        <div class="row mb-1">
          <label class="cell-sm-6" style="padding-top:5px;" title="X0 Y0 is the lower left corner of the finished board edge,
the cutter path of the outline runs outside of it (minus the cutter radius).
Needs an outline file, applies to all layers.">Zero at board edge <span class="far fa-question-circle"></span></label>
          <div class="cell-sm-6">
            <input id="pcbGerber_zeroAtEdge" type="checkbox" data-role="checkbox" data-style="2">
          </div>
        </div>
      </div>
      <div class="cell-sm-6">
        <b>Drilling</b> <small class="dark">(from the front side)</small>
        ${pcbGerberNumberRow('zdrill', 'Drill depth', 'mm', 'Final Z, negative')}
        ${pcbGerberNumberRow('drillFeed', 'Plunge feed', 'mm/min')}
        ${pcbGerberNumberRow('drillSpeed', 'Spindle', 'RPM')}
        <div class="row mb-1">
          <label class="cell-sm-6" style="padding-top:5px;" title="Drills all holes with one bit, without stops for tool changes.
Only one stop (M0) at the start to insert the bit. pcb2gcode names the largest hole size there,
use the bit you want.">One drill for all holes <span class="far fa-question-circle"></span></label>
          <div class="cell-sm-6">
            <input id="pcbGerber_oneDrill" type="checkbox" data-role="checkbox" data-style="2">
          </div>
        </div>
        <small class="dark">Otherwise each drill size stops with M0 for a tool change. Set Z zero again after each tool change.</small>
      </div>
    </div>

    <div class="row mb-2">
      <div class="cell-sm-12">
        <button type="button" id="pcbGerberGenerateBtn" class="button success" onclick="pcbGerberGenerate()"><i class="fas fa-cogs"></i> Generate G-code</button>
        <button type="button" class="button ml-2" onclick="pcbGerberResetDefaults()">Default values</button>
        <span id="pcbGerberBusy" class="ml-2" style="display:none;"><i class="fas fa-spinner fa-pulse"></i> pcb2gcode is running…</span>
      </div>
    </div>

    <div id="pcbGerberResults"></div>
  </form>`;
}

function pcbGerberLoadSettings() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(PCB_GERBER_STORAGE_KEY) || '{}') || {};
  } catch {
    data = {};
  }
  return Object.assign({}, PCB_GERBER_DEFAULTS, data);
}

function pcbGerberShowSettings(data) {
  for (const id in PCB_GERBER_DEFAULTS) {
    if (PCB_GERBER_CHECKBOXES.includes(id)) {
      $('#pcbGerber_' + id).prop('checked', !!data[id]);
    } else {
      $('#pcbGerber_' + id).val(data[id]);
    }
  }
}

function pcbGerberReadSettings() {
  const data = {};
  for (const id in PCB_GERBER_DEFAULTS) {
    if (PCB_GERBER_CHECKBOXES.includes(id)) {
      data[id] = $('#pcbGerber_' + id).prop('checked');
    } else {
      const text = String($('#pcbGerber_' + id).val()).trim();
      data[id] = text === '' ? '' : Number(text);
    }
  }
  return data;
}

function pcbGerberSaveSettings() {
  try {
    localStorage.setItem(PCB_GERBER_STORAGE_KEY, JSON.stringify(pcbGerberReadSettings()));
  } catch {
    // not important
  }
}

function pcbGerberResetDefaults() {
  pcbGerberShowSettings(PCB_GERBER_DEFAULTS);
  pcbGerberSaveSettings();
}

function pcbGerberFileChanged(layerId, input) {
  if (input.files && input.files.length > 0) {
    pcbGerberFiles[layerId] = input.files[0];
  } else {
    delete pcbGerberFiles[layerId];
  }
}

// puts the files picked earlier back into the file fields of a newly opened dialog
function pcbGerberRestoreFiles() {
  PCB_GERBER_LAYERS.forEach((layer) => {
    const input = document.getElementById('pcbGerberFile_' + layer.id);
    const file = pcbGerberFiles[layer.id];
    if (input && file) {
      try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
      } catch {
        delete pcbGerberFiles[layer.id];
      }
    }
  });
}

function pcbGerberEscape(text) {
  return $('<div>').text(text == null ? '' : String(text)).html();
}

function pcbGerberShowToolStatus(info) {
  let html;
  if (info && info.path) {
    html = info.bundled ?
      `<i class="fas fa-check fg-green"></i> pcb2gcode: <span title="${pcbGerberEscape(info.path)}">built into PCB-Control</span>` :
      `<i class="fas fa-check fg-green"></i> pcb2gcode: <code>${pcbGerberEscape(info.path)}</code>`;
    html += info.version ? ` <small class="dark">(${pcbGerberEscape(info.version)})</small>` : ' <small class="fg-red">(version could not be read)</small>';
  } else {
    html = `<i class="fas fa-exclamation-triangle fg-red"></i> pcb2gcode was not found on this computer.
      Install it, or select the program with the button on the right.`;
  }
  $('#pcbGerberToolStatus').html(html);
  $('#pcbGerberGenerateBtn').prop('disabled', !(info && info.path));
}

function pcbGerberChoosePath() {
  socket.emit('pcb2gcodeChoosePath', {}, pcbGerberShowToolStatus);
}

function openGerberWizard() {
  Metro.dialog.create({
    title: "<i class='fas fa-microchip'></i> Gerber to G-code Wizard (pcb2gcode)",
    content: pcbGerberTemplate(),
    toTop: true,
    width: 900,
    clsDialog: 'dark',
    actions: [{
      caption: "Close",
      cls: "js-dialog-close",
      onclick: pcbGerberSaveSettings,
    }]
  });
  pcbGerberShowSettings(pcbGerberLoadSettings());
  // save every change right away, also when the dialog is closed in another way
  $('#pcbGerberResults').closest('form').on('change', 'input[id^="pcbGerber_"]', pcbGerberSaveSettings);
  pcbGerberRestoreFiles();
  if (pcbGerberResult) {
    pcbGerberShowResults(pcbGerberResult);
  }
  socket.emit('pcb2gcodeStatus', {}, pcbGerberShowToolStatus);
}

// Rough check in the browser, the backend checks the ranges again
function pcbGerberCheckSettings(data, hasCopper, hasOutline, hasDrill) {
  const errors = [];
  const needed = ['zsafe', 'zchange', 'spinupTime'];
  if (hasCopper) {
    needed.push('millDiameter', 'isolationWidth', 'millingOverlap', 'zwork', 'millFeed', 'millVertFeed', 'millSpeed');
  }
  if (hasOutline) {
    needed.push('cutterDiameter', 'zcut', 'cutInfeed', 'cutFeed', 'cutVertFeed', 'cutSpeed');
  }
  if (hasDrill) {
    needed.push('zdrill', 'drillFeed', 'drillSpeed');
  }
  needed.forEach((id) => {
    if (data[id] === '' || !Number.isFinite(data[id])) {
      errors.push('Missing value: ' + id);
    }
  });
  if (data.zsafe <= 0) errors.push('Safe height must be above 0');
  if (data.zchange < data.zsafe) errors.push('Tool change height must not be below the safe height');
  if (hasCopper && data.zwork >= 0) errors.push('Milling depth must be negative');
  if (hasOutline && data.zcut >= 0) errors.push('Cut depth must be negative');
  if (hasDrill && data.zdrill >= 0) errors.push('Drill depth must be negative');
  return errors;
}

function pcbGerberGenerate() {
  const settings = pcbGerberReadSettings();
  pcbGerberSaveSettings();

  const formData = new FormData();
  const selected = {};
  PCB_GERBER_LAYERS.forEach((layer) => {
    const input = document.getElementById('pcbGerberFile_' + layer.id);
    if (input && input.files && input.files.length > 0) {
      formData.append(layer.id, input.files[0], input.files[0].name);
      selected[layer.id] = input.files[0].name;
    }
  });

  if (Object.keys(selected).length === 0) {
    pcbGerberShowError('Please select at least one file.');
    return;
  }
  const errors = pcbGerberCheckSettings(settings, !!(selected.front || selected.back), !!selected.outline, !!selected.drill);
  if (errors.length > 0) {
    pcbGerberShowError(errors.join('<br>'));
    return;
  }

  formData.append('params', JSON.stringify(settings));
  $('#pcbGerberGenerateBtn').prop('disabled', true);
  $('#pcbGerberBusy').show();
  $('#pcbGerberResults').empty();

  fetch(withServerToken(serverURL + '/pcb2gcode'), {method: 'POST', body: formData})
    .then((response) => response.json())
    .then((result) => {
      pcbGerberResult = result;
      pcbGerberLoaded = {};
      pcbGerberShowResults(result);
    })
    .catch((err) => pcbGerberShowError('Request failed: ' + pcbGerberEscape(err)))
    .finally(() => {
      $('#pcbGerberGenerateBtn').prop('disabled', false);
      $('#pcbGerberBusy').hide();
    });
}

function pcbGerberShowError(html) {
  $('#pcbGerberResults').html(`<div class="remark alert">${html}</div>`);
}

// Strips comments "( … )" and "; …" so that only real commands are checked
function pcbGerberStripComments(line) {
  return line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').toUpperCase();
}

// Facts the user should look at before running the file
function pcbGerberAnalyze(gcode) {
  const unsupported = new Set();
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let toolChanges = 0;
  gcode.split('\n').forEach((rawLine) => {
    const line = pcbGerberStripComments(rawLine);
    const z = line.match(/Z\s*(-?\d*\.?\d+)/);
    if (z) {
      minZ = Math.min(minZ, Number(z[1]));
      maxZ = Math.max(maxZ, Number(z[1]));
    }
    const x = line.match(/X\s*(-?\d*\.?\d+)/);
    if (x) {
      minX = Math.min(minX, Number(x[1]));
      maxX = Math.max(maxX, Number(x[1]));
    }
    const y = line.match(/Y\s*(-?\d*\.?\d+)/);
    if (y) {
      minY = Math.min(minY, Number(y[1]));
      maxY = Math.max(maxY, Number(y[1]));
    }
    if (/\bM0*0\b/.test(line)) {
      toolChanges++;
    }
    // commands Grbl 1.1 does not support
    const bad = line.match(/G64|G8[1-9]|G91\.1|G4[12]|M0*6(?!\d)/g);
    if (bad) {
      bad.forEach((x) => unsupported.add(x));
    }
  });
  return {
    lines: gcode.split('\n').length,
    minZ: minZ === Infinity ? null : minZ,
    maxZ: maxZ === -Infinity ? null : maxZ,
    minX: minX === Infinity ? null : minX,
    maxX: maxX === -Infinity ? null : maxX,
    minY: minY === Infinity ? null : minY,
    maxY: maxY === -Infinity ? null : maxY,
    pauses: toolChanges,
    unsupported: Array.from(unsupported),
  };
}

function pcbGerberShowResults(result) {
  let html = '';
  if (!result.ok) {
    html += `<div class="remark alert"><b>Error:</b> ${pcbGerberEscape(result.error)}</div>`;
  } else {
    if (result.edgeOffset) {
      html += `<div class="remark info">X0 Y0 = lower left corner of the board edge (origin shifted by X${result.edgeOffset.x} Y${result.edgeOffset.y} mm).</div>`;
    } else if (result.edgeNotApplied) {
      html += `<div class="remark warning">"Zero at board edge" needs an outline file, it was not applied.</div>`;
    }
    if (result.warning) {
      html += `<div class="remark warning">${pcbGerberEscape(result.warning)}</div>`;
    }
    // warnings printed by pcb2gcode, e.g. tool too large for the gaps between tracks
    const toolWarnings = Array.from(new Set((result.log || '').split('\n').filter((x) => /warning/i.test(x)).map((x) => x.trim())));
    if (toolWarnings.length > 0) {
      html += `<div class="remark warning"><b>pcb2gcode:</b><br>${toolWarnings.map(pcbGerberEscape).join('<br>')}</div>`;
    }
    const names = Object.keys(result.files).sort();
    if (names.length === 0) {
      html += `<div class="remark warning">pcb2gcode did not create any G-code file. Check the log below.</div>`;
    } else {
      html += `<table class="table compact striped" style="width:100%;"><thead><tr>
        <th>File</th><th>Lines</th><th>X range</th><th>Y range</th><th>Z range</th><th>M0 pauses</th><th></th></tr></thead><tbody>`;
      names.forEach((name) => {
        const info = pcbGerberAnalyze(result.files[name]);
        const zRange = info.minZ === null ? '–' : `${info.minZ} … ${info.maxZ} mm`;
        const fmt = (a, b) => (a === null ? '–' : `${a.toFixed(1)} … ${b.toFixed(1)}`);
        let warn = info.unsupported.length > 0
          ? `<br><small class="fg-red"><i class="fas fa-exclamation-triangle"></i> Contains commands Grbl 1.1 does not support: ${pcbGerberEscape(info.unsupported.join(', '))}</small>`
          : '';
        if (info.maxX !== null && info.maxX <= 0) {
          warn += `<br><small class="fg-orange"><i class="fas fa-exchange-alt"></i> Mirrored for the back side: all X values are negative,
            so X0 is the <b>right</b> edge of the flipped board</small>`;
        } else if (info.minX !== null && (info.minX < 0 || info.minY < 0)) {
          warn += `<br><small class="fg-orange"><i class="fas fa-exclamation-triangle"></i> Contains negative X/Y values</small>`;
        }
        html += `<tr>
          <td><b>${pcbGerberEscape(name)}</b>${pcbGerberLoaded[name]
            ? ` <span class="fg-green" title="Loaded into the G-code editor at ${pcbGerberLoaded[name]}"><i class="fas fa-check"></i> loaded ${pcbGerberLoaded[name]}</span>` : ''}${warn}</td>
          <td>${info.lines}</td>
          <td style="white-space:nowrap;">${fmt(info.minX, info.maxX)}</td>
          <td style="white-space:nowrap;">${fmt(info.minY, info.maxY)}</td>
          <td style="white-space:nowrap;">${zRange}</td>
          <td>${info.pauses}</td>
          <td class="text-right" style="white-space:nowrap;">
            <button type="button" class="button small success" onclick="pcbGerberLoadFile('${pcbGerberEscape(name)}')"><i class="fas fa-file-import"></i> Load</button>
            <button type="button" class="button small" onclick="pcbGerberSaveFile('${pcbGerberEscape(name)}')"><i class="fas fa-save"></i> Save…</button>
          </td></tr>`;
      });
      html += `</tbody></table>
        <small class="dark">Before running: check the Z range and the 3D View, set the zero (X/Y at the board corner,
        Z on the copper surface) and do a dry run above the board.</small>`;
    }
  }
  if (result.log || result.args) {
    html += `<details class="mt-2"><summary>pcb2gcode log</summary>
      <pre style="max-height:200px; overflow:auto; font-size:11px; white-space:pre-wrap;">${pcbGerberEscape((result.args ? 'pcb2gcode ' + result.args.join(' ') + '\n\n' : '') + (result.log || ''))}</pre></details>`;
  }
  $('#pcbGerberResults').html(html);
}

function pcbGerberLoadFile(name) {
  if (!pcbGerberResult || !pcbGerberResult.files || !(name in pcbGerberResult.files)) {
    return;
  }
  const state = (typeof laststatus !== 'undefined' && laststatus) ? laststatus.comms.connectionStatus : 0;
  if (state === 3 || state === 4) {
    Metro.toast.create("A job is running. Load the G-code after the job has finished.", null, 3000, "bg-darkRed fg-white");
    return;
  }
  const gcode = pcbGerberResult.files[name];
  editor.session.setValue(gcode);
  parseGcodeInWebWorker(gcode);
  loadedFileName = name;
  setWindowTitle();
  pcbGerberLoaded[name] = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  pcbGerberShowResults(pcbGerberResult);
  printLog("<span class='fg-darkRed'>[ Gerber Wizard ] </span><span class='fg-green'>G-code loaded: " + pcbGerberEscape(name) + "</span>");
  Metro.toast.create(pcbGerberEscape(name) + " loaded into the G-code editor", null, 2000, "bg-green fg-white");
}

function pcbGerberSaveFile(name) {
  if (!pcbGerberResult || !pcbGerberResult.files || !(name in pcbGerberResult.files)) {
    return;
  }
  const blob = new Blob([pcbGerberResult.files[name]], {type: 'text/plain'});
  invokeSaveAsDialogNew(blob, {
    id: 'gcode',
    title: 'Save G-code',
    fileName: name,
    filters: [
      {name: "G-code files", extensions: ["ngc", "gcode", "nc"]},
      {name: "All files", extensions: ["*"]},
    ],
  });
}
