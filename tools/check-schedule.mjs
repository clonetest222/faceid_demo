// Kiểm tra lịch mẫu buildSchedule(): mọi phim đang chiếu đều có suất, không trùng giờ trong phòng. node tools/check-schedule.mjs
import { readFileSync } from "node:fs"; import vm from "node:vm";
const src = readFileSync("js/data.js", "utf8"), a = src.indexOf("const CINEMAS = "), b = src.indexOf("const newProfile = ");
const code = `const pad = n => String(n).padStart(2, "0");` + readFileSync("js/films-cgv.js", "utf8").replace('"use strict";', "") + src.slice(a, b) + `
const r = buildSchedule().rows, day0 = r[0].id.slice(0, 8), d0 = r.filter(x => x.cinema_id === "086" && x.id.startsWith(day0));
console.log("tổng suất", r.length, "| phim có suất:", new Set(r.map(x => x.film_id)).size, "/", CGV_FILMS.filter(f => !f.soon).length, "đang chiếu");
d0.forEach(x => console.log(x.id, x.room_id, x.film_id, x.start_at.slice(11, 16) + "→" + x.end_at.slice(11, 16), "UTC"));
let bad = 0; const byRoom = {}; r.forEach(x => (byRoom[x.room_id + x.id.slice(0, 8)] ||= []).push(x));
for (const k in byRoom) { const l = byRoom[k].sort((p, q) => p.start_at < q.start_at ? -1 : 1); for (let i = 1; i < l.length; i++) if (l[i].start_at < l[i - 1].end_at) bad++; }
console.log("trùng giờ trong phòng:", bad, "| mã suất trùng:", r.length - new Set(r.map(x => x.id)).size);`;
vm.runInNewContext(code, { console, Date, Math, Array, Object, Set, String });
