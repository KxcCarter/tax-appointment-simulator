import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/*
  Scene Desk (scene-desk.html) helper, dev server only: list, read and save the game's dialogue
  files in src/data/ so the tool can open and save them in one click. Nothing outside src/data/
  can be read or written, and only .ts / .js files.
*/
function sceneDeskFiles() {
  const dir = path.resolve('src/data');
  const safe = (name) => typeof name === 'string' && /^[\w.-]+\.(ts|js)$/.test(name) && fs.existsSync(path.join(dir, name));
  return {
    name: 'scene-desk-files',
    configureServer(server) {
      server.middlewares.use('/__scene-desk/files', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(fs.readdirSync(dir).filter((f) => /\.(ts|js)$/.test(f)).sort()));
      });
      server.middlewares.use('/__scene-desk/file', (req, res) => {
        const name = new URL(req.url, 'http://x').searchParams.get('name');
        if (!safe(name)) { res.statusCode = 404; res.end('Not a dialogue file'); return; }
        if (req.method === 'GET') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(fs.readFileSync(path.join(dir, name), 'utf8')); return; }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => { fs.writeFileSync(path.join(dir, name), body); res.end('saved'); });
          return;
        }
        res.statusCode = 405; res.end();
      });
    },
  };
}

export default defineConfig({
  // Rapier's compat build inlines its WASM, so the bundle is large by design.
  build: { chunkSizeWarningLimit: 6000 },
  plugins: [sceneDeskFiles()],
});
