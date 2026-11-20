"use strict";

// PCB-Control: webcam mounted on the machine.
//
// - Settings dialog, tab "Hardware": enable the camera, pick the camera, X/Y offset of the
//   image center to the spindle (stored for the later "XY zero with the camera" function).
// - Workspace tab "Cam" (only while enabled): live image with crosshair, rotate, mirror, zoom.
//
// The live image only runs while the Cam tab is visible. Nothing here sends anything to the machine.
// Settings are stored per computer in localStorage, like the other UI settings.
//
// Must be loaded before settings.js, which inserts pcbHardwareSettingsTab/-Section into its dialog
// and calls pcbShowHardwareSettings()/pcbApplyHardwareSettings().

var pcbCamera = {
  settings: {enabled: false, deviceId: '', deviceLabel: '', offsetX: 0, offsetY: 0},
  view: {crosshair: true, rotation: 0, flipH: false, flipV: false, zoom: 1},
  stream: null,
  starting: false,
};

const PCB_CAM_ZOOM_MIN = 1;
const PCB_CAM_ZOOM_MAX = 8;

// ---------- settings dialog, tab "Hardware" ----------

var pcbHardwareSettingsTab = `
  <li><a id="hardwareSettingsTab" href="#hardwareSettings" style="font-size:14px;"><i class="fas fa-microchip"></i> Hardware</a></li>`;

var pcbHardwareSettingsSection = `
<div class="section" id="hardwareSettings" style="height:500px; flex-direction:column; border-bottom: 0px;">
  <div class="row" style="margin-left:-4px; font-weight:700;">
    <input type="checkbox" data-role="checkbox" data-style="2" data-caption="Enable Camera" id="pcbCamEnableCheck" onclick="pcbCamSettingsEnableChanged()"/>
    <span class="far fa-question-circle ml-1 mt-2" title="Shows the image of a webcam mounted on the machine in a new &quot;Cam&quot; tab next to the 3D View"></span>
  </div>

  <div id="pcbCamSettingsBlock">
    <div class="row ml-3 mt-2">
      <label class="cell-sm-3" style="padding-left:0px; padding-top:5px;">Camera</label>
      <div class="cell-sm-7">
        <select id="pcbCamDeviceSelect" style="width:100%; height:32px;"></select>
      </div>
      <div class="cell-sm-2">
        <button class="button" title="Search for cameras again" onclick="pcbCamFillDeviceList(true)"><i class="fas fa-sync-alt"></i></button>
      </div>
    </div>
    <div class="row ml-3">
      <small id="pcbCamDeviceNote" class="cell-sm-12" style="padding-left:0px;"></small>
    </div>

    <div class="row ml-3 mt-2">
      <label class="cell-sm-3" style="padding-left:0px; padding-top:5px;">Offset <span class="far fa-question-circle ml-1"
        title="Distance from the spindle to the center of the camera image, in machine coordinates.
Offset = position of the image center minus position of the spindle.
Used later to set the XY zero with the camera."></span></label>
      <div class="cell-sm-4">
        <input id="pcbCamOffsetX" type="number" step="0.01" style="text-align:right;" data-role="input" data-prepend="X" data-append="mm" data-clear-button="false" data-editable="true"/>
      </div>
      <div class="cell-sm-4">
        <input id="pcbCamOffsetY" type="number" step="0.01" style="text-align:right;" data-role="input" data-prepend="Y" data-append="mm" data-clear-button="false" data-editable="true"/>
      </div>
    </div>
  </div>
</div>`;

function pcbCamLoadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('pcbCamera') || '{}');
    Object.assign(pcbCamera.settings, s);
  } catch {
    // keep defaults
  }
  try {
    const v = JSON.parse(localStorage.getItem('pcbCameraView') || '{}');
    Object.assign(pcbCamera.view, v);
  } catch {
    // keep defaults
  }
}

function pcbCamSaveSettings() {
  localStorage.setItem('pcbCamera', JSON.stringify(pcbCamera.settings));
}

function pcbCamSaveView() {
  localStorage.setItem('pcbCameraView', JSON.stringify(pcbCamera.view));
}

function pcbCamSettingsEnableChanged() {
  const enabled = $('#pcbCamEnableCheck').prop('checked');
  enableViaClass('#pcbCamSettingsBlock', enabled);
  $('#pcbCamSettingsBlock').find('input, select, button').prop('disabled', !enabled);
  if (enabled) {
    pcbCamFillDeviceList(false);
  }
}

// Fills the camera list. Camera names are only available after access was granted once,
// so ask for access first if needed (macOS shows its permission prompt the first time).
async function pcbCamFillDeviceList(askAccess) {
  const select = $('#pcbCamDeviceSelect');
  const note = $('#pcbCamDeviceNote');
  if (!navigator.mediaDevices) {
    note.text('Cameras are not available here.');
    return;
  }
  try {
    let devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (askAccess || devices.length === 0 || devices.every((d) => !d.label)) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({video: true});
        s.getTracks().forEach((t) => t.stop());
      } catch {
        // no access or no camera, handled below
      }
      devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    }

    const wanted = select.val() || pcbCamera.settings.deviceId;
    select.empty();
    devices.forEach((d, i) => {
      select.append($('<option>').val(d.deviceId).text(d.label || ('Camera ' + (i + 1))));
    });
    const match = devices.find((d) => d.deviceId === wanted) ||
                  devices.find((d) => d.label && d.label === pcbCamera.settings.deviceLabel);
    if (match) select.val(match.deviceId);

    if (devices.length === 0) {
      note.text('No camera found. Is it connected?');
    } else if (devices.every((d) => !d.label)) {
      note.text('No access to the camera. Allow it in System Settings > Privacy & Security > Camera.');
    } else {
      note.text('');
    }
  } catch (err) {
    note.text('Could not list cameras: ' + err.message);
  }
}

function pcbShowHardwareSettings() {
  $('#pcbCamEnableCheck').prop('checked', pcbCamera.settings.enabled);
  $('#pcbCamOffsetX').val(pcbCamera.settings.offsetX);
  $('#pcbCamOffsetY').val(pcbCamera.settings.offsetY);
  // put the last known camera into the list until the real list is loaded
  if (pcbCamera.settings.deviceId) {
    $('#pcbCamDeviceSelect').append($('<option>').val(pcbCamera.settings.deviceId).text(pcbCamera.settings.deviceLabel || 'Camera'));
  }
  pcbCamSettingsEnableChanged();
}

function pcbApplyHardwareSettings() {
  const s = pcbCamera.settings;
  const oldDevice = s.deviceId;
  const select = $('#pcbCamDeviceSelect');
  s.enabled = $('#pcbCamEnableCheck').prop('checked');
  if (select.val()) {
    s.deviceId = select.val();
    s.deviceLabel = select.find('option:selected').text();
  }
  const x = parseFloat($('#pcbCamOffsetX').val());
  const y = parseFloat($('#pcbCamOffsetY').val());
  s.offsetX = isFinite(x) ? x : 0;
  s.offsetY = isFinite(y) ? y : 0;
  pcbCamSaveSettings();

  if (s.deviceId !== oldDevice) {
    pcbCamStop(); // restart with the new camera
  }
  pcbCamUpdateTab();
}

// ---------- workspace tab "Cam" ----------

function pcbCamTabVisible() {
  return pcbCamera.settings.enabled && $('#tab-cam').hasClass('active') && !document.hidden;
}

// shows or hides the Cam tab according to the settings
function pcbCamUpdateTab() {
  const tabItem = $('#cameratab').parent();
  if (pcbCamera.settings.enabled) {
    tabItem.show();
  } else {
    if ($('#tab-cam').hasClass('active')) {
      activateContentTab('gcodeviewertab');
    }
    tabItem.hide();
  }
  pcbCamCheckRunning();
}

// starts or stops the live image depending on whether it can be seen
function pcbCamCheckRunning() {
  if (pcbCamTabVisible()) {
    pcbCamStart();
  } else {
    pcbCamStop();
  }
}

async function pcbCamStart() {
  if (pcbCamera.stream || pcbCamera.starting) return;
  pcbCamera.starting = true;
  pcbCamMessage('Starting camera...');
  try {
    const constraints = pcbCamera.settings.deviceId ?
      {video: {deviceId: {exact: pcbCamera.settings.deviceId}, width: {ideal: 1920}, height: {ideal: 1080}}} :
      {video: {width: {ideal: 1920}, height: {ideal: 1080}}};
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError') throw err;
      // the saved camera is gone (e.g. other USB port): fall back to its name
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const byLabel = devices.find((d) => d.label && d.label === pcbCamera.settings.deviceLabel);
      if (!byLabel) throw new Error('The selected camera "' + pcbCamera.settings.deviceLabel + '" was not found. Select a camera in Settings > Hardware.');
      pcbCamera.settings.deviceId = byLabel.deviceId;
      pcbCamSaveSettings();
      stream = await navigator.mediaDevices.getUserMedia({video: {deviceId: {exact: byLabel.deviceId}}});
    }
    if (!pcbCamTabVisible()) { // tab was left while starting
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    pcbCamera.stream = stream;
    const video = document.getElementById('pcbCamVideo');
    video.srcObject = stream;
    await video.play().catch(() => {});
    pcbCamMessage('');
  } catch (err) {
    let text = err.message || String(err);
    if (err.name === 'NotAllowedError') {
      text = 'No access to the camera. Allow it in System Settings > Privacy & Security > Camera, then restart the app.';
    } else if (err.name === 'NotReadableError') {
      text = 'The camera is in use by another program.';
    }
    pcbCamMessage(text);
  } finally {
    pcbCamera.starting = false;
  }
}

function pcbCamStop() {
  if (pcbCamera.stream) {
    pcbCamera.stream.getTracks().forEach((t) => t.stop());
    pcbCamera.stream = null;
  }
  const video = document.getElementById('pcbCamVideo');
  if (video) video.srcObject = null;
}

function pcbCamMessage(text) {
  $('#pcbCamMessage').text(text).toggle(!!text);
}

// fits the (rotated) image into the tab and applies rotation, mirroring and zoom
function pcbCamLayout() {
  const video = document.getElementById('pcbCamVideo');
  const area = document.getElementById('pcbCamArea');
  if (!video || !area || !video.videoWidth) return;

  const v = pcbCamera.view;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const turned = (v.rotation % 180) !== 0;
  const fit = Math.min(area.clientWidth / (turned ? vh : vw), area.clientHeight / (turned ? vw : vh));
  video.style.width = (vw * fit) + 'px';
  video.style.height = (vh * fit) + 'px';
  // applied right to left: zoom, rotate, then mirror on screen, then center
  video.style.transform = 'translate(-50%, -50%) scale(' + (v.flipH ? -1 : 1) + ',' + (v.flipV ? -1 : 1) + ') ' +
    'rotate(' + v.rotation + 'deg) scale(' + v.zoom + ')';

  $('#pcbCamCrosshair').toggle(v.crosshair);
  $('#pcbCamZoomLabel').text(v.zoom.toFixed(1) + 'x');
  $('#pcbCamCrosshairBtn').toggleClass('active', v.crosshair);
  $('#pcbCamFlipHBtn').toggleClass('active', v.flipH);
  $('#pcbCamFlipVBtn').toggleClass('active', v.flipV);
}

function pcbCamToggleCrosshair() {
  pcbCamera.view.crosshair = !pcbCamera.view.crosshair;
  pcbCamSaveView();
  pcbCamLayout();
}

function pcbCamRotate() {
  pcbCamera.view.rotation = (pcbCamera.view.rotation + 90) % 360;
  pcbCamSaveView();
  pcbCamLayout();
}

function pcbCamFlip(horizontal) {
  if (horizontal) {
    pcbCamera.view.flipH = !pcbCamera.view.flipH;
  } else {
    pcbCamera.view.flipV = !pcbCamera.view.flipV;
  }
  pcbCamSaveView();
  pcbCamLayout();
}

function pcbCamSetZoom(zoom) {
  pcbCamera.view.zoom = Math.min(PCB_CAM_ZOOM_MAX, Math.max(PCB_CAM_ZOOM_MIN, zoom));
  pcbCamSaveView();
  pcbCamLayout();
}

// ---------- Set Cam Zero X / Y ----------
//
// SAFETY: these buttons only set the work zero of the active coordinate system with
// "G10 L20 P0 X.." / "Y..", the same command as the regular "Set Zero X" button, but with the
// camera offset instead of 0. The machine does not move. Only allowed while connected and idle.
//
// The point under the crosshair is spindle position + offset, so for that point to become 0,
// the spindle's current position gets the value -offset.

function pcbCamZeroAllowed() {
  return typeof laststatus !== 'undefined' && laststatus && laststatus.comms &&
         laststatus.comms.connectionStatus == 2; // connected and idle (no job, pause or alarm)
}

// value (in the controller's current units) that the spindle position gets
function pcbCamZeroValue(axis) {
  const offsetMm = axis === 'x' ? pcbCamera.settings.offsetX : pcbCamera.settings.offsetY;
  const inch = laststatus && laststatus.machine && laststatus.machine.modals &&
               laststatus.machine.modals.unitsmode === 'G20';
  let value = -offsetMm;
  if (inch) value = value / 25.4;
  if (Math.abs(value) < 1e-9) value = 0; // avoid "-0"
  return inch ? value.toFixed(4) : value.toFixed(3);
}

function pcbCamSetZero(axis) {
  if (!pcbCamZeroAllowed()) return;
  const letter = axis.toUpperCase();
  captureWcsHistory('Before <b>Set Cam Zero ' + letter + '</b>');
  sendGcode('G10 P0 L20 ' + letter + pcbCamZeroValue(axis));
}

function pcbCamUpdateZeroButtons() {
  if (!pcbCamera.settings.enabled) return;
  const allowed = pcbCamZeroAllowed();
  ['x', 'y'].forEach((axis) => {
    const letter = axis.toUpperCase();
    const offset = axis === 'x' ? pcbCamera.settings.offsetX : pcbCamera.settings.offsetY;
    const btn = $('#pcbCamZero' + letter + 'Btn');
    btn.prop('disabled', !allowed);
    enableViaClass(btn, allowed);
    const title = 'Sets ' + letter + '0 of the work coordinates to the point under the crosshair.\n' +
      'Uses Offset ' + letter + ' = ' + offset + ' mm from Settings > Hardware.\n' +
      (allowed ? 'Sends: G10 P0 L20 ' + letter + pcbCamZeroValue(axis) + ' (the machine does not move)' :
                 'Only available while the machine is connected and idle.');
    // only touch the title when it changes, so a tooltip that is just shown is not disturbed
    const wrap = $('#pcbCamZero' + letter + 'Wrap');
    if (wrap.data('pcbTitle') !== title) {
      wrap.data('pcbTitle', title);
      wrap.attr('title', title);
    }
  });
}

function pcbCamDocReady() {
  pcbCamLoadSettings();
  if (!document.getElementById('tab-cam')) return;

  const video = document.getElementById('pcbCamVideo');
  video.addEventListener('loadedmetadata', pcbCamLayout);
  new ResizeObserver(pcbCamLayout).observe(document.getElementById('pcbCamArea'));

  document.getElementById('pcbCamArea').addEventListener('wheel', (e) => {
    e.preventDefault();
    pcbCamSetZoom(pcbCamera.view.zoom * Math.pow(1.1, -e.deltaY / 100));
  }, {passive: false});

  // start/stop the live image when the Cam tab is shown or hidden
  new MutationObserver(pcbCamCheckRunning).observe(document.getElementById('tab-cam'), {attributes: true, attributeFilter: ['class']});
  document.addEventListener('visibilitychange', pcbCamCheckRunning);
  window.addEventListener('beforeunload', pcbCamStop);

  pcbCamUpdateTab();
  pcbCamLayout();
  pcbCamUpdateZeroButtons();
  setInterval(() => {
    if (pcbCamTabVisible()) pcbCamUpdateZeroButtons();
  }, 500);
}

$(document).ready(pcbCamDocReady);
