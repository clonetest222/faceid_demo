/* Trình thiết kế phòng chiếu (quản lý / kỹ thuật) – đủ đơn giản để ai cũng làm được:
   ① chọn kích thước (hoặc mẫu sẵn) → ② kéo loại ghế thả vào sơ đồ (hoặc chọn bút rồi tô, kéo chữ hàng để đổi hàng, "Di chuyển" để kéo ghế sang chỗ khác)
   → ③ xem phòng 3D ngay bên cạnh (bấm ghế trong 3D cũng sửa được), bảng góc nhìn + doanh thu tối đa → Lưu.
   Dữ liệu lưu đúng như trước (save_room_s: rows, cols, seat_map, couple, blocked…) nên lịch, bán vé, 3D của khách dùng ngay. */
"use strict";
const RD = { on: false, cid: null, isNew: false, meta: {}, rows: 8, cols: 12, types: {}, layout: null, custom: false, tool: "vip", focus: null, mode: "seat", theatre: false, undo: [], redo: [], drag: null, dirty: false, orig: "" };
/* Trường tuỳ chỉnh (id, nhãn, kiểu, đường dẫn trong layout, bước, gợi ý). Đơn vị mét / độ. */
const RD_CUSTOM = [
  ["blocks", "Khối ghế mỗi hàng", "text", "blocks", null, "vd 6,14,6 → lối đi giữa các khối"], ["aisle", "Lối đi rộng (m)", "number", "aisle", .1, ""], ["pitch", "Bước ghế (m)", "number", "pitch", .02, "ghế thường .58 · ghế nằm .92"],
  ["rowSpacing", "Bước hàng (m)", "number", "rowSpacing", .05, ""], ["rise", "Bậc dốc mỗi hàng (m)", "number", "rise", .05, "cao hơn = nhìn thoáng hơn"], ["firstZ", "Hàng đầu cách màn (m)", "number", "firstZ", .5, ""],
  ["screenW", "Màn rộng (m)", "number", "screen.width", .5, ""], ["screenH", "Màn cao (m)", "number", "screen.height", .25, ""], ["screenB", "Mép dưới màn cao (m)", "number", "screen.bottom", .1, ""], ["screenC", "Bán kính cong màn (m)", "number", "screen.curveRadius", 1, "0 = phẳng · IMAX 30 · Grand 36 · Dolby 42 (bán kính nhỏ = cong nhiều)"],
  ["seatStyle", "Kiểu ghế", "select", "seatStyle", null, ""], ["fov", "Góc nhìn lý tưởng (độ)", "number", "fovTarget", 1, "dùng để chấm điểm ghế"],
  ["wall", "Màu tường", "color", "room.wall", null, ""], ["floor", "Màu sàn", "color", "room.floor", null, ""], ["ceiling", "Màu trần", "color", "room.ceiling", null, ""], ["uph", "Màu rèm / bọc", "color", "materials.upholstery", null, ""], ["amb", "Đèn nền", "color", "lighting.ambient", null, ""], ["sconce", "Số đèn hông", "number", "lighting.sconceCount", 1, "0 = tắt"],
];
const RD_SEAT_STYLES = [["standard", "Ghế thường"], ["recliner", "Ghế nằm (recliner)"], ["luxury", "Sofa / Luxury"], ["fx", "Ghế chuyển động (4DX)"]];
const rdGet = (o, path) => path.split(".").reduce((a, k) => a == null ? a : a[k], o);
const rdSet = (o, path, v) => { const ks = path.split("."); let a = o; ks.slice(0, -1).forEach(k => { if (!a[k] || typeof a[k] !== "object") a[k] = {}; a = a[k]; }); a[ks[ks.length - 1]] = v; };
/** Áp mẫu phòng: kích thước, công nghệ, khối ghế, màn hình, màu; VIP ở các hàng giữa (trừ ghế sát tường) */
function rdPreset(id) {
  const p = ROOM_PRESETS[id]; if (!p) return; rdSnap(); const cols = p.blocks.reduce((a, b) => a + b, 0);
  RD.rows = p.rows; RD.cols = cols; RD.types = {}; RD.layout = { preset: id, blocks: p.blocks.slice() }; RD.meta.kind = p.kind; RD.custom = false;
  if (p.rows > 2) { const r0 = Math.floor(p.rows * .4); [r0, r0 + 1, r0 + 2].filter(i => i < p.rows).forEach(i => { for (let j = 1; j < cols - 1; j++) RD.types[seatId(i, j)] = "vip"; }); }
  else if (p.seatStyle === "luxury") for (let i = 0; i < p.rows; i++) for (let j = 0; j < cols; j++) RD.types[seatId(i, j)] = "vip";
  RD.focus = null; RD.dirty = true;
}
/** Đổi một trường tuỳ chỉnh (từ ô nhập) → ghi vào layout (giữ mẫu gốc làm nền) */
function rdCustomSet(fid, raw) {
  const f = RD_CUSTOM.find(x => x[0] === fid); if (!f) return; const [, , type, path] = f; if (!RD.layout) RD.layout = { preset: roomLayout(rdRoom()).preset };
  let v = raw; if (type === "number") { v = parseFloat(String(raw).replace(",", ".")); if (!isFinite(v)) return; v = Math.max(0, v); }
  if (fid === "blocks") { v = String(raw).split(/[,\s;x×]+/).map(n => parseInt(n, 10)).filter(n => n > 0); if (!v.length) return; const sum = v.reduce((a, b) => a + b, 0); if (sum !== RD.cols && sum >= 1 && sum <= 30) { RD.cols = sum; for (const sid of Object.keys(RD.types)) if (+sid.slice(1) > sum) delete RD.types[sid]; } }
  rdSet(RD.layout, path, v); RD.dirty = true;
}
const RD_TOOL_TXT = { std: "Ghế bình thường, giá cơ bản", vip: "Ghế VIP: êm hơn, có phụ thu", couple: "Ghế đôi: 2 chỗ liền nhau, khách lấy cả cặp", blocked: "Ghế hỏng / bảo trì: không bán", move: "Kéo một ghế thả sang ô khác để đổi chỗ" };

function rdOpen(cid, r) {
  const c = cinema(cid), n = roomsOf(cid).length, isNew = !r;
  r = r || { id: `${cid}-R${n + 1}`, name: `Phòng ${n + 1}`, kind: "2D", rows: 8, cols: 12, vip: [3, 4, 5], vipSeats: [], couple: [], blocked: [], seatMap: {}, active: true, note: "" };
  Object.assign(RD, { on: true, cid, isNew, meta: { id: r.id, name: r.name, kind: r.kind || "2D", active: r.active !== false, note: r.note || "" }, rows: r.rows, cols: r.cols, types: {}, layout: r.layout ? JSON.parse(JSON.stringify(r.layout)) : null, custom: !!(r.layout && Object.keys(r.layout).length > 1), tool: "vip", focus: null, mode: "seat", theatre: false, undo: [], redo: [], drag: null, dirty: false });
  for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) { const sid = seatId(i, j), k = seatKind(r, sid); if (k !== "std") RD.types[sid] = k; }
  RD.orig = rdSig(); if (!c) return;
}
const rdSig = () => JSON.stringify([RD.rows, RD.cols, RD.types, RD.meta, RD.layout]);
/** Đối tượng phòng tạm theo trạng thái đang sửa – dùng chung seatKind / seatGroups / Seat3D */
const rdRoom = () => ({ id: RD.meta.id || "new", cinemaId: RD.cid, name: RD.meta.name, kind: RD.meta.kind, rows: RD.rows, cols: RD.cols, seatMap: RD.types, vip: [], vipSeats: [], couple: [], blocked: [], layout: RD.layout });
const rdGroups = () => seatGroups(rdRoom());
function rdSnap() { RD.undo.push(JSON.stringify([RD.rows, RD.cols, RD.types, RD.layout])); if (RD.undo.length > 60) RD.undo.shift(); RD.redo.length = 0; }
function rdRestore(s) { const [rows, cols, types, layout] = JSON.parse(s); RD.rows = rows; RD.cols = cols; RD.types = types; RD.layout = layout || null; }
/** Bỏ nhóm chứa ghế: mọi thành viên về thường */
function rdUngroup(sid) { const g = rdGroups().get(sid); if (!g) return; g.forEach(m => delete RD.types[m]); }
/** Áp loại ghế tại (i, j): loại nhiều chỗ lấy n ghế liền bên phải (hết hàng thì ngắn lại). Trả về số ghế đã áp. */
function rdApply(i, j, tid) {
  const ty = seatType(tid), n = ty.sellable && ty.persons > 1 ? Math.min(ty.persons, RD.cols - j) : 1, members = [];
  for (let jj = j; jj < j + n; jj++) { const m = seatId(i, jj); rdUngroup(m); members.push(m); }
  members.forEach(m => { if (tid === "std") delete RD.types[m]; else RD.types[m] = tid; });
  RD.focus = members[0]; RD.dirty = true; return n;
}
/** Đổi chỗ hai ghế (kéo thả "Di chuyển"): loại ghế đi theo, nhóm ghế đôi chuyển cả cặp nếu còn chỗ */
function rdMove(from, to) {
  if (from === to) return; const g = rdGroups().get(from), ty = RD.types[from] || "std", tt = RD.types[to] || "std";
  const [ti, tj] = [to.charCodeAt(0) - 65, +to.slice(1) - 1];
  if (g && g.length > 1) { g.forEach(m => delete RD.types[m]); rdApply(ti, tj, ty); return; }
  rdUngroup(to); delete RD.types[from]; if (tt !== "std" && tt !== ty) RD.types[from] = tt; if (ty !== "std") RD.types[to] = ty; RD.focus = to; RD.dirty = true;
}
/** Đổi hai hàng cho nhau (kéo chữ hàng) */
function rdSwapRows(a, b) {
  if (a === b) return; const take = i => { const o = {}; for (let j = 0; j < RD.cols; j++) { const k = RD.types[seatId(i, j)]; if (k) o[j] = k; } return o; };
  const A = take(a), B = take(b); for (let j = 0; j < RD.cols; j++) { delete RD.types[seatId(a, j)]; delete RD.types[seatId(b, j)]; if (B[j]) RD.types[seatId(a, j)] = B[j]; if (A[j]) RD.types[seatId(b, j)] = A[j]; } RD.dirty = true;
}
function rdResize(rows, cols) {
  rows = Math.min(26, Math.max(1, rows)); cols = Math.min(30, Math.max(1, cols)); if (rows === RD.rows && cols === RD.cols) return; rdSnap();
  RD.rows = rows; RD.cols = cols; Object.keys(RD.types).forEach(sid => { if (sid.charCodeAt(0) - 65 >= rows || +sid.slice(1) > cols) delete RD.types[sid]; }); RD.dirty = true;
}
/** Thống kê để quản lý hiểu ngay: số ghế từng loại, bán được, doanh thu tối đa một suất, phân bố góc nhìn */
function rdStats() {
  const c = cinema(RD.cid), r = rdRoom(), T = seatTypeList(), cnt = {}; T.forEach(t => cnt[t.id] = 0);
  let sellable = 0, revenue = 0; const lv = { great: 0, good: 0, less: 0 }, vipLess = [], stdGreat = [];
  const tier = tierOf(c), base = tier.weekday.adult, prio = "balanced";
  for (let i = 0; i < RD.rows; i++) for (let j = 0; j < RD.cols; j++) { const sid = seatId(i, j), k = RD.types[sid] || "std", t = seatType(k); cnt[k] = (cnt[k] || 0) + 1;
    if (t.sellable) { sellable++; const fixed = c.tier === "A" ? t.fixedA : t.fixedB, sur = Number(c.tier === "A" ? t.surchargeA : t.surchargeB) || 0; revenue += fixed != null ? Number(fixed) : base + sur / (t.persons || 1);
      const q = typeof Seat3D !== "undefined" ? Seat3D.rate(r, sid, prio) : null; if (q) { lv[q.level]++; if (k === "vip" && q.level === "less") vipLess.push(sid); if (k === "std" && q.level === "great") stdGreat.push(sid); } } }
  return { cnt, sellable, revenue, lv, vipLess, stdGreat, total: RD.rows * RD.cols };
}
/** Tự xếp VIP vào vùng nhìn đẹp nhất (ghế thường có điểm "rất tốt"), bỏ VIP ở ghế nhìn kém */
function rdAutoVip() { rdSnap(); const st = rdStats(); st.vipLess.forEach(sid => delete RD.types[sid]); st.stdGreat.forEach(sid => RD.types[sid] = "vip"); RD.dirty = true; return st.stdGreat.length; }

/* ---------- vẽ ---------- */
const RD_TOOL_COLORS = { std: "bg-surface border-border-strong", vip: "bg-warning-bg border-warning/60 text-warning", couple: "bg-[#fce7f3] border-[#f472b6] text-[#be185d]", blocked: "bg-background border-dashed border-border text-muted" };
function rdPalette() {
  const c = cinema(RD.cid), tools = seatTypeList().map(t => [t.id, t]).concat([["move", null]]);
  return tools.map(([id, t]) => { const on = RD.tool === id, name = t ? t.name : "Di chuyển", icon = t ? (t.icon || (id === "std" ? "armchair" : "square")) : "hand", cls = t ? (RD_TOOL_COLORS[id] || seatColor(t, "tool")) : "bg-surface border-border-strong";
    const price = t && t.sellable ? ((c.tier === "A" ? t.fixedA : t.fixedB) != null ? "giá cứng " + vnd(c.tier === "A" ? t.fixedA : t.fixedB) : (Number(c.tier === "A" ? t.surchargeA : t.surchargeB) || 0) ? "+" + vnd(Number(c.tier === "A" ? t.surchargeA : t.surchargeB)) : "giá cơ bản") : t ? "không bán" : "";
    return `<button type="button" draggable="false" data-act="rd-tool" data-v="${id}" aria-pressed="${on}" title="${esc(RD_TOOL_TXT[id] || t.name)}" class="rd-tool flex w-full cursor-grab items-center gap-2.5 rounded-xl border p-2 text-left transition ${cls} ${on ? "ring-2 ring-focus" : "hover:ring-2 hover:ring-border-strong"}"><span class="grid size-9 shrink-0 place-items-center rounded-lg border bg-surface">${ic(icon, "size-4")}</span><span class="min-w-0"><span class="block truncate text-sm font-medium">${esc(name)}${t && t.persons > 1 ? ` (${t.persons} chỗ)` : ""}</span><span class="block truncate text-[11px] opacity-80">${esc(RD_TOOL_TXT[id] || (t.sellable ? "Loại ghế tự tạo" : "Không bán"))}${price ? " · " + price : ""}</span></span></button>`; }).join("");
}
function rdGridHtml() {
  const groups = rdGroups(), r = rdRoom(), aisles = aisleAfter(r), L = roomLayout(r), P = ROOM_PRESETS[L.preset];
  let h = `${screenBarHtml(r, { seat: 28, gap: 4, aisle: 12, cls: "mb-3", label: `Màn hình · ${L.screen.width} m${L.screen.curveRadius ? " · cong" : ""}` })}
    <div class="rd-grid mx-auto grid w-max gap-1" data-rd-grid>`;
  for (let i = 0; i < RD.rows; i++) { const L = String.fromCharCode(65 + i);
    h += `<div class="flex items-center gap-1" data-row="${i}"><button type="button" data-rd-row="${i}" title="Kéo để đổi chỗ hàng ${L} với hàng khác · bấm: tô cả hàng" class="grid size-7 shrink-0 cursor-grab place-items-center rounded-md text-xs font-semibold text-muted hover:bg-item-hover">${L}</button>`;
    for (let j = 0; j < RD.cols; j++) { const sid = seatId(i, j), g = groups.get(sid); if (g && g[0] !== sid) continue; const n = g ? g.length : 1, k = RD.types[sid] || "std", t = seatType(k), q = typeof Seat3D !== "undefined" && t.sellable ? Seat3D.rate(r, sid) : null;
      h += `<button type="button" data-rd-seat="${sid}" data-i="${i}" data-j="${j}" title="${sid}${n > 1 ? `–${g[n - 1]}` : ""} · ${esc(t.name)}${q ? " · " + q.text : ""}" ${n > 1 ? `style="width:calc(${n} * 1.75rem + ${n - 1} * .25rem)"` : ""} class="rd-seat relative grid h-7 w-7 cursor-pointer place-items-center rounded-md border text-[10px] tabular-nums ${RD_TOOL_COLORS[k] || seatColor(t, "seat")} ${RD.focus === sid ? "ring-2 ring-primary" : ""}">${n > 1 ? `<span class="flex items-center gap-0.5">${t.icon ? ic(t.icon, "size-3") : ""}${j + 1}–${j + n}</span>` : k === "std" ? j + 1 : t.icon ? ic(t.icon, "size-3") : j + 1}${q ? `<i class="seat-rate seat-rate-${q.level}"></i>` : ""}</button>`;
      if (aisles.has(j + n - 1)) h += `<span class="w-3"></span>`; j += n - 1; }
    h += `</div>`; }
  return h + `</div>`;
}
/** Thẻ mẫu phòng (đo từ rạp thật) + nút Tuỳ chỉnh */
function rdPresetsHtml() {
  const L = roomLayout(rdRoom()), cur = L.preset;
  // ô minh hoạ: tường (màu mẫu) + màn hình (cong = bo đáy) + 3 vệt ghế theo số khối
  const swatch = p => `<span class="grid h-12 w-16 shrink-0 content-end justify-items-center gap-[3px] rounded-lg px-1.5 pb-1.5" style="background:${p.room.wall}"><span class="h-3.5 rounded-[2px]" style="width:${Math.min(90, 30 + p.screen.width * 2.4)}%;background:${p.screen.curveRadius ? "linear-gradient(#e3e9f1,#8fa0b5)" : "#dfe6ee"};${p.screen.curveRadius ? "border-radius:3px 3px 50% 50%/3px 3px 100% 100%" : ""}"></span><span class="flex w-full justify-center gap-[3px]">${p.blocks.map(b => `<span class="h-1 rounded-full" style="width:${Math.round(b / p.blocks.reduce((a, c) => a + c, 0) * 85)}%;background:${p.materials.upholstery}"></span>`).join("")}</span></span>`;
  const cards = ROOM_PRESET_IDS.map(id => { const p = ROOM_PRESETS[id], on = cur === id, cols = p.blocks.reduce((a, b) => a + b, 0);
    return `<button type="button" data-act="rd-preset" data-v="${id}" aria-pressed="${on}" title="${esc(p.tagline)}" class="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border p-2 text-left transition ${on ? "border-primary bg-primary-light ring-2 ring-primary/40" : "border-border bg-surface hover:border-border-strong"}">${swatch(p)}<span class="min-w-0 flex-1"><span class="flex items-center gap-1.5"><span class="grid size-5 shrink-0 place-items-center rounded bg-secondary text-[10px] font-bold">${p.code}</span><span class="truncate text-sm font-medium">${esc(p.name)}</span></span><span class="block truncate text-[11px] text-muted">${esc(p.tagline)}</span><span class="block text-[11px] tabular-nums text-muted">${p.rows} hàng × ${cols} ghế · khối ${p.blocks.join("+")} · ${esc(ROOM_KIND_TXT[p.kind] || p.kind)}</span></span></button>`; }).join("");
  const custom = `<button type="button" data-act="rd-custom" aria-pressed="${RD.custom}" class="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border border-dashed p-2 text-left ${RD.custom ? "border-primary bg-primary-light ring-2 ring-primary/40" : "border-border-strong hover:bg-item-hover"}"><span class="grid h-12 w-16 shrink-0 place-items-center rounded-lg bg-secondary">${ic("sliders-horizontal", "size-5")}</span><span class="min-w-0"><span class="block text-sm font-medium">Tuỳ chỉnh</span><span class="block text-[11px] text-muted">Khối ghế, lối đi, màn, màu, đèn… trên nền mẫu đang chọn</span></span></button>`;
  let fields = "";
  if (RD.custom) { fields = `<div class="mt-3 grid gap-3 rounded-xl border border-border bg-background p-3 sm:grid-cols-2 lg:grid-cols-3" data-rd-custom><p class="text-xs text-muted sm:col-span-2 lg:col-span-3">Đang chỉnh trên nền mẫu <b>${esc((ROOM_PRESETS[cur] || {}).name || cur)}</b>. Mọi số đổi là 3D bên phải đổi theo; chấm góc nhìn tính lại ngay.</p>` +
    RD_CUSTOM.map(([fid, label, type, path, step, hint]) => { const v = fid === "blocks" ? L.blocks.join(",") : rdGet(L, path);
      const inp = type === "select" ? sel("rd-l-" + fid, RD_SEAT_STYLES, v) : type === "color" ? `<input id="rd-l-${fid}" type="color" value="${esc(String(v || "#000000"))}" class="h-10 w-full cursor-pointer rounded-xl border border-border bg-surface p-1">` : input("rd-l-" + fid, v == null ? "" : String(v), `${type === "number" ? `type="number" min="0" step="${step}" inputmode="decimal"` : ""} data-rd-l="${fid}"`);
      return field(label, inp + (hint ? `<span class="text-[11px] text-muted">${esc(hint)}</span>` : "")); }).join("") + `</div>`; }
  return `<div class="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3" data-rd-presets>${cards}${custom}</div>${fields}`;
}
function rdStatsHtml() {
  const st = rdStats(), c = cinema(RD.cid), T = seatTypeList(), pct = n => st.sellable ? Math.round(n / st.sellable * 100) : 0;
  return `<div class="grid grid-cols-2 gap-2 text-sm"><div class="rounded-lg bg-background p-2"><p class="text-[11px] text-muted">Tổng ghế</p><p class="font-semibold">${st.total} <span class="text-xs font-normal text-muted">· bán được ${st.sellable}</span></p></div><div class="rounded-lg bg-background p-2"><p class="text-[11px] text-muted">Thu tối đa một suất</p><p class="font-semibold tabular-nums">${vnd(Math.round(st.revenue))}</p></div></div>
    <div class="mt-2 flex flex-wrap gap-1.5 text-xs">${T.filter(t => st.cnt[t.id]).map(t => `<span class="rounded-md border px-2 py-0.5 ${RD_TOOL_COLORS[t.id] || seatColor(t, "tool")}">${esc(t.name)} ${st.cnt[t.id]}</span>`).join("")}</div>
    <div class="mt-3"><p class="mb-1 text-[11px] text-muted">Góc nhìn (theo cách khách thấy khi chọn ghế)</p><div class="flex h-2 overflow-hidden rounded-full bg-secondary"><div class="bg-success" style="width:${pct(st.lv.great)}%"></div><div class="bg-[#3b82f6]" style="width:${pct(st.lv.good)}%"></div><div class="bg-[#9ca3af]" style="width:${pct(st.lv.less)}%"></div></div><p class="mt-1 text-xs text-muted"><span class="text-success">●</span> rất tốt ${st.lv.great} · <span class="text-[#3b82f6]">●</span> tốt ${st.lv.good} · <span class="text-[#9ca3af]">●</span> kém ${st.lv.less}</p></div>
    ${st.vipLess.length || st.stdGreat.length ? `<div class="mt-3 rounded-lg border border-warning/40 bg-warning-bg p-2 text-xs"><p class="font-medium text-warning">Gợi ý</p>${st.vipLess.length ? `<p class="mt-0.5">${st.vipLess.length} ghế VIP đang ở chỗ nhìn kém (${esc(st.vipLess.slice(0, 6).join(", "))}${st.vipLess.length > 6 ? "…" : ""}) – khách trả thêm nhưng xem không sướng.</p>` : ""}${st.stdGreat.length ? `<p class="mt-0.5">${st.stdGreat.length} ghế thường đang ở chỗ nhìn rất tốt – có thể nâng lên VIP (+${vnd(Number(c.tier === "A" ? seatType("vip").surchargeA : seatType("vip").surchargeB) || 0)}/vé).</p>` : ""}<button type="button" class="${B.outline} mt-2 min-h-8 px-2.5 text-xs" data-act="rd-autovip">${ic("sparkles", "size-3.5 text-warning")}Tự xếp VIP vào chỗ nhìn đẹp</button></div>` : `<p class="mt-3 text-xs text-success">${ic("check", "mr-1 inline size-3.5")}VIP đang nằm đúng vùng nhìn đẹp.</p>`}`;
}
function vPhongThietKe() {
  if (!RD.on) return vCoSo();
  const c = cinema(RD.cid), m = RD.meta, focus = RD.focus, r = rdRoom(), q = focus && typeof Seat3D !== "undefined" ? Seat3D.rate(r, focus) : null;
  const step = (n, t, d) => `<div class="flex gap-2"><span class="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">${n}</span><div><p class="text-sm font-medium">${t}</p><p class="text-xs text-muted">${d}</p></div></div>`;
  const top = `<div class="mb-4 grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-3">${step(1, "Chọn kích thước", "Mẫu sẵn hoặc +/− hàng, ghế.")}${step(2, "Kéo loại ghế vào sơ đồ", "Kéo thả, hoặc chọn bút rồi tô. Kéo chữ hàng để đổi hàng. \"Di chuyển\" để dời ghế.")}${step(3, "Xem 3D rồi Lưu", "Bên phải là phòng đúng như khách sẽ thấy. Bấm ghế trong 3D cũng sửa được.")}</div>`;
  const meta = `<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">${field("Mã phòng", input("rd-id", m.id, RD.isNew ? `placeholder="${RD.cid}-R1"` : "disabled"))}${field("Tên phòng", input("rd-name", m.name, 'placeholder="Phòng 3 · IMAX"'))}${field("Công nghệ", sel("rd-kind", ROOM_KINDS.map(k => [k, ROOM_KIND_TXT[k]]), m.kind))}<div class="flex items-end pb-2">${chk("rd-active", "Phòng đang hoạt động", m.active)}</div></div>`;
  const size = `<div class="mb-3 flex flex-wrap items-center gap-2"><span class="text-xs font-medium uppercase tracking-wide text-muted">Kích thước</span>
      <span class="inline-flex items-center rounded-xl border border-border bg-background"><button type="button" class="grid size-9 cursor-pointer place-items-center rounded-l-xl hover:bg-item-hover" data-act="rd-rows" data-v="-1" aria-label="Bớt hàng">${ic("minus", "size-4")}</button><span class="px-2 text-sm tabular-nums"><b>${RD.rows}</b> hàng</span><button type="button" class="grid size-9 cursor-pointer place-items-center rounded-r-xl hover:bg-item-hover" data-act="rd-rows" data-v="1" aria-label="Thêm hàng">${ic("plus", "size-4")}</button></span>
      <span class="inline-flex items-center rounded-xl border border-border bg-background"><button type="button" class="grid size-9 cursor-pointer place-items-center rounded-l-xl hover:bg-item-hover" data-act="rd-cols" data-v="-1" aria-label="Bớt ghế">${ic("minus", "size-4")}</button><span class="px-2 text-sm tabular-nums"><b>${RD.cols}</b> ghế / hàng</span><button type="button" class="grid size-9 cursor-pointer place-items-center rounded-r-xl hover:bg-item-hover" data-act="rd-cols" data-v="1" aria-label="Thêm ghế">${ic("plus", "size-4")}</button></span>
      <span class="text-xs text-muted">Lối đi theo khối ghế của mẫu (đổi ở Tuỳ chỉnh).</span></div>` + rdPresetsHtml();
  const toolbar = `<div class="mb-3 flex flex-wrap items-center gap-2"><button type="button" class="${B.outline} min-h-8 px-2.5 text-xs" data-act="rd-undo" ${RD.undo.length ? "" : "disabled"}>${ic("undo-2", "size-3.5")}Hoàn tác</button><button type="button" class="${B.outline} min-h-8 px-2.5 text-xs" data-act="rd-redo" ${RD.redo.length ? "" : "disabled"}>${ic("redo-2", "size-3.5")}Làm lại</button><button type="button" class="${B.outline} min-h-8 px-2.5 text-xs" data-act="rd-clear">${ic("eraser", "size-3.5")}Về toàn ghế thường</button><span class="ml-auto text-xs text-muted">${RD.dirty ? "Chưa lưu" : "Đã lưu"}</span></div>`;
  const body = top + `<div class="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[200px_minmax(0,1fr)_360px] xl:items-start">
    <aside class="xl:sticky xl:top-20"><div class="rounded-2xl border border-border bg-surface p-3"><p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Loại ghế – kéo vào sơ đồ</p><div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-1" data-rd-palette>${rdPalette()}</div>${isChainManager() ? `<button type="button" class="${B.ghost} mt-2 w-full min-h-8 text-xs" data-act="seattype-new">${ic("plus", "size-3.5")}Thêm loại ghế mới</button>` : ""}</div></aside>
    <div class="min-w-0">${card(`${meta}<div class="my-4 border-t border-border"></div>${size}${toolbar}<div class="overflow-x-auto pb-1" data-rd-wrap>${rdGridHtml()}</div><p class="mt-2 text-xs text-muted">${(() => { const L = roomLayout(r), P = ROOM_PRESETS[L.preset]; return `Màn ${L.screen.width}×${L.screen.height} m${L.screen.curveRadius ? `, cong bán kính ${L.screen.curveRadius} m` : ", phẳng"}${P ? ` · mẫu ${esc(P.name)}` : ""} · thanh màn hình vẽ đúng tỷ lệ với dàn ghế. ` })()}Chấm màu ở góc ghế = góc nhìn khách sẽ thấy (xanh lá rất tốt · xanh dương tốt · xám kém). ${field("Ghi chú", input("rd-note", m.note, 'placeholder="Đang thay máy chiếu – xong 20/10"')).replace('class="grid gap-1.5"', 'class="mt-3 grid gap-1.5"')}</p>`)}</div>
    <aside class="grid gap-4 xl:sticky xl:top-20">${card(`<div class="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 class="text-sm font-semibold">Phòng 3D – như khách thấy</h2><span class="flex flex-wrap items-center gap-2">${seg([["seat", "Từ ghế", "eye"], ["room", "Toàn cảnh", "map"]], RD.mode === "room" ? "room" : "seat", "rd-mode")}<button type="button" class="${B.outline} min-h-8 px-2.5 text-xs" data-act="rd-theatre" title="Phòng toàn màn hình: đi lại bằng W A S D, E ngồi thử ghế, E lần nữa đứng dậy">${ic("door-open", "size-3.5")}Vào rạp</button></span></div><div class="relative aspect-[16/10] overflow-hidden rounded-xl bg-black" data-seat3d data-seat3d-rd></div><p class="mt-2 text-xs ${q ? (q.level === "great" ? "text-success" : q.level === "less" ? "text-warning" : "text-foreground") : "text-muted"}">${focus && q ? `<b>${esc(focus)}</b> · ${esc(seatType(RD.types[focus] || "std").name)} · ${esc(q.text)} · ${q.score100}/100` : "Bấm một ghế trên sơ đồ để xem từ ghế đó. Bấm ghế trong 3D = tô bằng công cụ đang chọn."}</p>`)}
      ${card(`<h2 class="mb-2 text-sm font-semibold">Tổng kết</h2><div data-rd-stats>${rdStatsHtml()}</div>`)}
      <div class="flex flex-wrap gap-2"><button type="button" class="${B.primary} min-h-11 flex-1" data-act="rd-save">${ic("save")}Lưu phòng</button><button type="button" class="${B.outline} min-h-11" data-act="rd-back">Đóng</button>${!RD.isNew && Auth.user.role === "quanly" ? `<button type="button" class="${B.ghost} min-h-11 text-err" data-act="rd-del">${ic("trash-2")}Xoá</button>` : ""}</div></aside></div>`;
  return staffShell("coso", RD.isNew ? `Thêm phòng · ${esc(c.name)}` : `Thiết kế ${esc(m.name)} · ${esc(c.name)}`, `${RD.rows} hàng × ${RD.cols} ghế · kéo thả để sắp xếp`, `<button type="button" class="${B.outline}" data-act="rd-back">${ic("arrow-left")}<span class="hidden sm:inline">Cơ sở & phòng</span></button>`, body) + (RD.theatre ? rdTheatreHtml() : "");
}
/** Màn "Vào rạp" của trình thiết kế: như màn của khách (Từ ghế / Đứng dậy / Đi lại, joystick điện thoại, E ngồi thử, E lần nữa đứng dậy, Esc thoát) nhưng chạy trên phòng đang thiết kế (chưa cần lưu) */
function rdTheatreHtml() {
  const r = rdRoom(), c = cinema(RD.cid), mode = ["overview", "walk"].includes(RD.mode) ? RD.mode : "seat", focus = RD.focus, rt = focus && typeof Seat3D !== "undefined" ? Seat3D.rate(r, focus) : null, L = roomLayout(r), P = ROOM_PRESETS[L.preset];
  const modeSeg = seg([["seat", "Từ ghế", "eye"], ["overview", "Đứng dậy", "person-standing"], ["walk", "Đi lại", "footprints"]], mode, "rd-tmode");
  const hint = mode === "walk" ? `<span class="mouse-only">W A S D / mũi tên: đi · Shift: chạy · kéo chuột: nhìn · V: đổi ngôi nhìn · E: ngồi thử ghế gần · Esc: thoát</span><span class="touch-only-inline">Joystick trái để đi · vuốt phải để nhìn · chạm ghế gần để ngồi</span>`
    : mode === "overview" ? "Kéo để xoay quanh · lăn chuột để lùi / tiến · bấm ghế để ngồi thử" : "Kéo để nhìn quanh · bấm đúp để nhìn thẳng màn hình · E: đứng dậy đi lại";
  return `<div class="theatre fixed inset-0 z-[70] bg-black text-white" data-theatre data-rd-theatre>
    <div class="absolute inset-0" data-seat3d data-theatre-stage data-rd-theatre-stage></div>
    <div class="theatre-top pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2 sm:p-3">
      <div class="pointer-events-auto flex min-w-0 items-center gap-2"><button type="button" class="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25" data-act="rd-theatre-exit" aria-label="Thoát rạp">${ic("arrow-left", "size-5")}</button>
        <div class="hidden min-w-0 rounded-xl bg-black/50 px-3 py-1.5 backdrop-blur sm:block"><p class="truncate text-sm font-semibold">${esc(RD.meta.name || "Phòng mới")} · ${esc(c ? c.name : "")}</p><p class="truncate text-[11px] text-white/70">${P ? esc(P.name) + " · " : ""}${RD.rows} hàng × ${RD.cols} ghế · ${rt ? `Ghế ${esc(focus)} · ${esc(rt.text)} · ${rt.score100}/100` : "chưa ngồi ghế nào"}</p></div></div>
      <div class="pointer-events-auto flex shrink-0 items-center gap-2">${modeSeg}<button type="button" class="grid size-10 cursor-pointer place-items-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25" data-act="theatre-fullscreen" aria-label="Toàn màn hình">${ic("maximize", "size-5")}</button></div>
    </div>
    ${mode === "walk" ? `<div class="theatre-joy touch-only absolute bottom-6 left-6 z-10" data-joystick><div class="joy-base"><div class="joy-knob" data-joy-knob></div></div></div>
      <div class="touch-only absolute bottom-6 right-6 z-10 flex-col gap-2"><button type="button" class="joy-btn" data-act="seat3d-view">${ic("video", "size-5")}</button><button type="button" class="joy-btn" data-run-btn>${ic("zap", "size-5")}</button></div>
      <div class="pointer-events-none absolute inset-x-0 bottom-20 z-10 hidden justify-center near-prompt" data-near-prompt><button type="button" class="pointer-events-auto flex items-center gap-2 rounded-full border border-warning/60 bg-black/85 px-4 py-2 text-sm font-medium text-warning backdrop-blur hover:bg-black" data-act="rd-seat-sit"><kbd class="rounded border border-warning/60 px-1.5 py-0.5 font-mono text-xs">E</kbd><span data-near-text>Ngồi xuống</span></button></div>` : ""}
    <div class="theatre-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-2 text-[11px] text-white/70 sm:p-3"><span class="rounded-md bg-black/50 px-2 py-1 ${mode === "walk" ? "mouse-only" : ""}">${hint}</span></div>
  </div>`;
}
/** Vẽ lại phần sơ đồ + thống kê + 3D mà không vẽ lại cả trang (giữ thao tác kéo mượt) */
function rdRefresh() { const g = $("[data-rd-wrap]"), s = $("[data-rd-stats]"); if (g) g.innerHTML = rdGridHtml(); if (s) s.innerHTML = rdStatsHtml(); rdSync3d(); const u = $("[data-act=rd-undo]"), rdo = $("[data-act=rd-redo]"); if (u) u.disabled = !RD.undo.length; if (rdo) rdo.disabled = !RD.redo.length; }
function rdSync3d() {
  const el = RD.theatre ? $("[data-rd-theatre-stage]") : $("[data-seat3d-rd]"); if (!el || typeof Seat3D === "undefined") return;
  const r = rdRoom(), f = film(S.shows[0] ? S.shows[0].filmId : FILMS[0].id) || FILMS[0];
  const mode = RD.theatre ? (["overview", "walk"].includes(RD.mode) ? RD.mode : "seat") : (RD.mode === "room" ? "room" : "seat");
  if (RD.theatre) bindJoystick();
  Seat3D.mount(el, { room: r, groups: rdGroups(), selected: RD.focus ? [RD.focus] : [], focus: RD.focus, poster: f && f.img, title: RD.meta.name || "CineVin", mode, view: S.view.seat3dView || "first",
    stateOf: sid => seatType(RD.types[sid] || "std").sellable ? "free" : "blocked", kindOf: sid => { const k = RD.types[sid] || "std"; return k === "vip" ? "vip" : k === "couple" ? "couple" : seatType(k).sellable ? "std" : "blocked"; },
    // trong rạp: bấm / ngồi = chọn ghế để xem; ngoài rạp (khung xem trước): bấm = tô bằng công cụ đang chọn
    onPick: RD.theatre ? sid => { RD.focus = sid; RD.mode = "seat"; render(); }
      : sid => { const i = sid.charCodeAt(0) - 65, j = +sid.slice(1) - 1; rdSnap(); if (RD.tool === "move") { RD.focus = sid; } else if (RD.tool !== "std" && (RD.types[sid] || "std") === RD.tool) rdApply(i, j, "std"); else rdApply(i, j, RD.tool); rdRefresh(); },
    canSit: sid => seatType(RD.types[sid] || "std").sellable,
    onNear: n => { const p = $("[data-near-prompt]"), t = $("[data-near-text]"); if (!p) return; p.classList.toggle("hidden", !n); p.classList.toggle("flex", !!n); if (n && t) t.textContent = `Ngồi thử · Hàng ${n.row}, Ghế ${n.number}`; },
    onSit: sid => { RD.focus = sid; RD.mode = "seat"; render(); toast(`Ngồi thử ${sid} · E để đứng dậy`); },
    onStand: () => { if (!RD.theatre) return; RD.mode = "walk"; render(); } });
}
/* ---------- kéo thả trên sơ đồ (pointer events, chạy cả chuột lẫn cảm ứng) ---------- */
function rdBind() {
  const wrap = $("[data-rd-wrap]"); if (!wrap || wrap.dataset.bound) return; wrap.dataset.bound = "1";
  const cellAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest ? el.closest("[data-rd-seat]") : null; };
  const rowAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest ? el.closest("[data-rd-row]") : null; };
  let ghost = null; const showGhost = (label, cls) => { ghost = document.createElement("div"); ghost.className = `rd-ghost ${cls}`; ghost.textContent = label; document.body.appendChild(ghost); };
  const moveGhost = e => { if (ghost) { ghost.style.left = e.clientX + "px"; ghost.style.top = e.clientY + "px"; } };
  const endGhost = () => { if (ghost) { ghost.remove(); ghost = null; } };
  // kéo từ bảng công cụ
  const pal = $("[data-rd-palette]");
  pal.addEventListener("pointerdown", e => { const b = e.target.closest("[data-act=rd-tool]"); if (!b) return; RD.drag = { kind: "tool", tool: b.dataset.v, x: e.clientX, y: e.clientY, moved: false }; });
  // kéo trong sơ đồ: tô (bút), di chuyển ghế, đổi hàng
  wrap.addEventListener("pointerdown", e => { const cell = e.target.closest("[data-rd-seat]"), row = e.target.closest("[data-rd-row]");
    if (row) { RD.drag = { kind: "row", from: +row.dataset.rdRow, x: e.clientX, y: e.clientY, moved: false }; return; }
    if (!cell) return; e.preventDefault();
    if (RD.tool === "move") { RD.drag = { kind: "move", from: cell.dataset.rdSeat, x: e.clientX, y: e.clientY, moved: false }; return; }
    rdSnap(); RD.drag = { kind: "paint", x: e.clientX, y: e.clientY, moved: false, done: new Set() }; paint(cell); });
  const paint = cell => { const sid = cell.dataset.rdSeat; if (RD.drag.done.has(sid)) return; RD.drag.done.add(sid); const i = +cell.dataset.i, j = +cell.dataset.j;
    if (!RD.drag.moved && RD.tool !== "std" && (RD.types[sid] || "std") === RD.tool) rdApply(i, j, "std"); else rdApply(i, j, RD.tool); rdRefreshGrid(); };
  const rdRefreshGrid = () => { const g = $("[data-rd-wrap]"); if (g) g.innerHTML = rdGridHtml(); };
  document.addEventListener("pointermove", e => { const d = RD.drag; if (!d) return; if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 5 && !d.moved) { d.moved = true; if (d.kind === "tool") showGhost(d.tool === "move" ? "Di chuyển" : seatType(d.tool).name, RD_TOOL_COLORS[d.tool] || "bg-surface border-border-strong"); if (d.kind === "move") showGhost(d.from, RD_TOOL_COLORS[RD.types[d.from] || "std"] || ""); if (d.kind === "row") showGhost("Hàng " + String.fromCharCode(65 + d.from), "bg-surface border-border-strong"); }
    moveGhost(e); if (d.kind === "paint" && d.moved) { const c = cellAt(e.clientX, e.clientY); if (c) paint(c); }
    document.querySelectorAll(".rd-over").forEach(x => x.classList.remove("rd-over")); if (d.moved && d.kind !== "paint") { const t = d.kind === "row" ? rowAt(e.clientX, e.clientY) : cellAt(e.clientX, e.clientY); if (t) t.classList.add("rd-over"); } });
  document.addEventListener("pointerup", e => { const d = RD.drag; if (!d) return; RD.drag = null; endGhost(); document.querySelectorAll(".rd-over").forEach(x => x.classList.remove("rd-over"));
    if (d.kind === "tool") { if (!d.moved) { RD.tool = d.tool; render(); return; } const c = cellAt(e.clientX, e.clientY); if (c && d.tool !== "move") { rdSnap(); rdApply(+c.dataset.i, +c.dataset.j, d.tool); } RD.tool = d.tool; render(); return; }
    if (d.kind === "move") { const c = cellAt(e.clientX, e.clientY); if (d.moved && c && c.dataset.rdSeat !== d.from) { rdSnap(); rdMove(d.from, c.dataset.rdSeat); } else if (!d.moved) RD.focus = d.from; rdRefresh(); const p = $("[data-seat3d-rd]"); if (!d.moved) render(); return; }
    if (d.kind === "row") { const r = rowAt(e.clientX, e.clientY); if (d.moved && r && +r.dataset.rdRow !== d.from) { rdSnap(); rdSwapRows(d.from, +r.dataset.rdRow); rdRefresh(); } else if (!d.moved) { rdSnap(); for (let j = 0; j < RD.cols;) j += rdApply(d.from, j, RD.tool); rdRefresh(); } return; }
    if (d.kind === "paint") { rdRefresh(); if (!d.moved) render(); } });
  document.addEventListener("pointercancel", () => { RD.drag = null; endGhost(); });
}
