// Keep the local server alive when the desktop window closes, including training jobs.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'data/logs'), { recursive: true });
const log = fs.openSync(path.join(root, 'data/logs/desktop-server.log'), 'a');
const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
  cwd: root, detached: true, windowsHide: true,
  env: { ...process.env, PORT: '3270' }, stdio: ['ignore', log, log],
});
child.on('error', error => {
  fs.appendFileSync(path.join(root, 'data/logs/desktop-server.log'), `${new Date().toISOString()} ${error.stack}\n`);
  process.exitCode = 1;
});
child.once('spawn', () => {
  fs.writeFileSync(path.join(root, 'data/desktop-server.pid'), String(child.pid));
  child.unref();
});
fs.closeSync(log);
