// Renders the film to out/infernear-film.mp4, one frame at a time, from the built page.
// Every frame is seeked, not recorded in real time, so the output is exact and never drops frames.
//   FPS=60 (default)          frames per second
//   STILLS=12.5,30,61         instead of the video, save these moments as PNGs in out/stills/ (or STILLS_DIR)
// Uses the installed Google Chrome through Playwright, with its sandbox on.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright';

const fps = Number(process.env.FPS ?? 60);
const stills = process.env.STILLS?.split(',').map(Number);
const port = 4181;

const server = await preview({ preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/?capture`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
const duration = await page.evaluate(() => window.__duration);
mkdirSync('out', { recursive: true });

if (stills) {
  const dir = process.env.STILLS_DIR ?? 'out/stills';
  mkdirSync(dir, { recursive: true });
  for (const t of stills) {
    await page.evaluate(time => window.__seek(time), t);
    writeFileSync(`${dir}/${String(t.toFixed(2)).padStart(6, '0')}.png`, await page.screenshot({ type: 'png' }));
  }
  console.log(`saved ${stills.length} stills in ${dir}/`);
} else {
  const file = 'out/infernear-film.mp4';
  const ffmpeg = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => ffmpeg.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));
  const frames = Math.round(duration * fps);
  for (let i = 0; i < frames; i++) {
    await page.evaluate(time => window.__seek(time), i / fps);
    const png = await page.screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(png)) await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
    if (i % fps === 0) process.stdout.write(`\r${Math.round(i / fps)}s of ${duration}s`);
  }
  ffmpeg.stdin.end();
  await done;
  console.log(`\nwrote ${file} (${frames} frames at ${fps} fps)`);
}

await browser.close();
await server.close();
