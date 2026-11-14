// Renders the film to out/infernear-film.mp4 from the built page: every frame is seeked, not
// recorded in real time, so the output is exact; the soundtrack is synthesised by the same page.
//   FPS=60 (default)          frames per second
//   STILLS=12.5,30,61         save these moments as PNGs in out/stills/ (or STILLS_DIR) instead
//   AUDIO_ONLY=1              write only out/soundtrack.wav
// Uses the installed Google Chrome through Playwright, with its sandbox on.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright';

const fps = Number(process.env.FPS ?? 60);
const stills = process.env.STILLS?.split(',').map(Number);
const port = 4181;

const server = await preview({ preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/?capture`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
const duration = await page.evaluate(() => window.__duration);
mkdirSync('out', { recursive: true });

const run = (args) => new Promise((resolve, reject) => {
  const p = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
});

async function soundtrack() {
  const chunks = await page.evaluate(() => window.__soundtrack());
  const parts = [];
  for (let i = 0; i < chunks; i++) parts.push(Buffer.from(await page.evaluate(k => window.__soundtrackChunk(k), i), 'base64'));
  writeFileSync('out/soundtrack.wav', Buffer.concat(parts));
  console.log('wrote out/soundtrack.wav');
}

if (stills) {
  const dir = process.env.STILLS_DIR ?? 'out/stills';
  mkdirSync(dir, { recursive: true });
  for (const t of stills) {
    await page.evaluate(time => window.__seek(time), t);
    writeFileSync(`${dir}/${String(t.toFixed(2)).padStart(6, '0')}.png`, await page.screenshot({ type: 'png' }));
  }
  console.log(`saved ${stills.length} stills in ${dir}/`);
} else if (process.env.AUDIO_ONLY) {
  await soundtrack();
} else {
  await soundtrack();
  const frames = 'out/frames.mp4';
  const ffmpeg = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', frames], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => ffmpeg.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));
  const count = Math.round(duration * fps);
  for (let i = 0; i < count; i++) {
    await page.evaluate(time => window.__seek(time), i / fps);
    const png = await page.screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(png)) await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
    if (i % fps === 0) process.stdout.write(`\r${Math.round(i / fps)}s of ${duration}s`);
  }
  ffmpeg.stdin.end();
  await done;
  // Mux, with the soundtrack normalised to -14 LUFS for social video.
  await run(['-y', '-v', 'error', '-i', frames, '-i', 'out/soundtrack.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', 'out/infernear-film.mp4']);
  console.log(`\nwrote out/infernear-film.mp4 (${count} frames at ${fps} fps, with sound)`);
}

await browser.close();
await server.close();
