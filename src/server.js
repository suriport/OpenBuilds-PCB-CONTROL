// server.js handles the http server backend for Electron

// System dependencies
import {
  Server as ioServer
} from 'socket.io';
import express from 'express';
import path from 'path';
import ip from 'ip';
import http from 'http';
import crypto from 'crypto';
import net from 'net';
// import https from 'https';


// App dependencies
import {
  rootDir,
  debug_log,
  status,
  config,
} from './core.js';


// PCB-Control: Zugriffsschutz gegen fremde Webseiten im Browser
// Erlaubt sind nur Anfragen an eine lokale Adresse (localhost, IP, Rechnername, *.local), die entweder
// - den Sitzungsschlüssel mitbringen (das App-Fenster, das von file:// geladen wird), oder
// - von genau dieser Adresse stammen (mobile Jog-Oberfläche im Browser) bzw. keine Herkunft senden (z. B. curl).
const sessionToken = crypto.randomBytes(32).toString('hex'); // neu bei jedem Programmstart, wird nicht gespeichert

function getSessionToken() {
  return sessionToken;
}

function isAllowedHost(hostHeader) {
  if (!hostHeader) {
    return false;
  }
  let hostname;
  try {
    hostname = new URL('http://' + hostHeader).hostname.toLowerCase();
  } catch {
    return false;
  }
  hostname = hostname.replace(/^\[/, '').replace(/\]$/, ''); // IPv6 [::1] -> ::1
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    return true;
  }
  if (net.isIP(hostname)) {
    return true;
  }
  return hostname.indexOf('.') === -1; // Rechnername ohne Domain
}

function hasValidToken(req) {
  let token;
  try {
    token = new URL(req.url, 'http://localhost').searchParams.get('token');
  } catch {
    return false;
  }
  if (!token || token.length !== sessionToken.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(sessionToken));
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) {
    return true;
  }
  try {
    return new URL(origin).host.toLowerCase() === req.headers.host.toLowerCase();
  } catch {
    return false; // z. B. Origin "null"
  }
}

function isTrustedRequest(req) {
  return isAllowedHost(req.headers.host) && (hasValidToken(req) || isSameOrigin(req));
}

function checkRequestOrigin(req, res, next) {
  const isReadOnly = (req.method === 'GET' || req.method === 'HEAD');
  if (!isAllowedHost(req.headers.host) || (!isReadOnly && !isTrustedRequest(req))) {
    debug_log('Blocked request: ' + req.method + ' ' + req.path + ' Host: ' + req.headers.host + ' Origin: ' + req.headers.origin);
    return res.status(403).send('Forbidden');
  }
  if (req.headers.origin !== undefined && hasValidToken(req)) {
    // das App-Fenster (file://) darf die Antwort lesen
    res.set('Access-Control-Allow-Origin', req.headers.origin);
  }
  next();
}

// Global variables
const io = new ioServer({
  // Verbindungsaufbau nur vom App-Fenster (Schlüssel) oder von der eigenen Adresse
  allowRequest: function(req, callback) {
    const allowed = isTrustedRequest(req);
    if (!allowed) {
      debug_log('Blocked Socket.IO connection: Host: ' + req.headers.host + ' Origin: ' + req.headers.origin);
    }
    callback(null, allowed);
  }
});
const app = express();
// PCB-Control: die Prüfung muss als Erstes registriert werden, weil andere Module (files.js, grblSender.js)
// ihre Endpunkte schon vor initServer() anlegen und Express in Registrierungsreihenfolge arbeitet
app.use(checkRequestOrigin);
var httpServer;
var connectionHandlers = [];
var docReadyHandlers = [];

function addConnectionHandler(handler) {
  removeConnectionHandler(handler);
  connectionHandlers.push(handler);
}

function removeConnectionHandler(handler) {
  let index = connectionHandlers.indexOf(handler);
  if (index >= 0) {
    connectionHandlers.splice(index, 1);
  }
}

function addDocReadyHandler(handler) {
  removeDocReadyHandler(handler);
  docReadyHandlers.push(handler);
}

function removeDocReadyHandler(handler) {
  let index = docReadyHandlers.indexOf(handler);
  if (index >= 0) {
    docReadyHandlers.splice(index, 1);
  }
}

function onDocReady(callback) {
  serverEmit('status', status);
  const result = {
    platform: process.platform,
  };
  docReadyHandlers.forEach((x) => x(result));
  callback(result);
}

function onConnection(socket) {
  debug_log("New IO Connection ");

  connectionHandlers.forEach((x) => x(socket));

  socket.on('docReady', onDocReady);
}

function httpServerSuccess() {
  debug_log('http:  listening on:' + ip.address() + ":" + config.webPort);
}

function httpServerError(error) {
  // If unable to start (port in use) - try next port in array from config.nextWebPort()
  console.error(error.message);
  const nextWebPort = config.nextWebPort();
  if (typeof nextWebPort == "number") {
    httpServer.listen(nextWebPort);
  }
}

function initServer() {
  app.use(express.static(path.join(rootDir, "app")));

  httpServer = http.Server(app).listen(config.webPort, '0.0.0.0', httpServerSuccess).on('error', httpServerError);
  io.attach(httpServer);

// eslint-disable-next-line no-warning-comments
/* Disable HTTPS, since the keys are out of date. It is not practical for a software with infrequent releases to use keys
that expire in 3 months. Besides, the private keys are included in the open source so there is no real security

  //Note when renewing Convert zerossl cert first `openssl.exe rsa -in domain-key.key -out domain-key.key`
  // fix error:    App threw an error during load
  //               Error: error:06000066:public key routines:OPENSSL_internal:DECODE_ERROR

  const httpsOptions = {
    key: fs.readFileSync(path.join(rootDir, 'privkey1.pem')),
    cert: fs.readFileSync(path.join(rootDir, 'fullchain1.pem'))
  };

  const httpsSrever = https.createServer(httpsOptions, app).listen(3001, function() {
    console.log("SUCCESS HTTPS");
    debug_log('https: listening on:' + ip.address() + ":3001");
  });
  io.attach(httpsSrever);
*/

  io.on('connection', onConnection);
}

function serverEmit(event, data) {
  io.sockets.emit(event, data);
}

function serverEmitOutput(data) {
  io.sockets.emit('data', data);
}

export {
  app,
  getSessionToken,
  serverEmit,
  serverEmitOutput,
  addConnectionHandler,
  removeConnectionHandler,
  addDocReadyHandler,
  removeDocReadyHandler,
  initServer,
};
