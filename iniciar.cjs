'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = __dirname;
const dataDir = path.join(root, 'data');
const url = 'http://127.0.0.1:4324';
async function health() {
  try {
    const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1000) });
    if (!r.ok) return { occupied: true };
    return { occupied: true, data: await r.json() };
  } catch (e) { return e.cause && e.cause.code === 'ECONNREFUSED' ? { occupied: false } : { occupied: true }; }
}
function ours(s) {
  return s.data?.app === 'fabrica-ia-facturas' && s.data?.instance === crypto.createHash('sha256').update(path.resolve(dataDir).toLowerCase()).digest('hex').slice(0, 16);
}
async function main() {
  const cur = await health();
  if (cur.occupied && ours(cur)) {
    console.log('Ya funciona: ' + url);
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  if (cur.occupied) throw new Error('Puerto 4324 ocupado.');
  const child = spawn(process.execPath, [path.join(root, 'server.cjs')], { cwd: root, env: { ...process.env, FACT_PORT: '4324', FACT_DATA_DIR: dataDir }, stdio: 'inherit' });
  for (let i = 0; i < 32; i++) {
    const s = await health();
    if (ours(s)) {
      console.log('\nFACTURAPRO LOCAL\n' + url + '\nDeja abierto. Ctrl+C.\nDatos: ' + dataDir + '\n');
      spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
      return;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  child.kill('SIGTERM');
  throw new Error('No arrancó.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
