// Chụp một trang HTML thành PNG độ nét cao (Edge headless + CDP).
// Chạy: node tools/render-png.mjs docs/nghiep-vu.html docs/nghiep-vu.png [rộng=1880] [tỉ lệ=2]
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [src, out, width = 1880, scale = 2] = process.argv.slice(2);
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9351, sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "render-"))}`, "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
const t = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +width, height: 1000, deviceScaleFactor: +scale, mobile: false });
await send("Page.navigate", { url: pathToFileURL(resolve(src)).href });
await sleep(2500);
await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
const h = (await send("Runtime.evaluate", { expression: "document.documentElement.scrollHeight", returnByValue: true })).result.result.value;
await send("Emulation.setDeviceMetricsOverride", { width: +width, height: h, deviceScaleFactor: +scale, mobile: false });
await sleep(500);
const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync(out, Buffer.from(r.result.data, "base64"));
console.log(`Đã lưu ${out} (${width}×${h} px CSS, ×${scale})`);
edge.kill(); process.exit(0);
