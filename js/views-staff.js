/* Màn nhân viên / quản lý: Tổng quan, Suất chiếu, Soát vé, Bán tại quầy, Tài khoản & quyền. Khung sidebar theo wireframe A. */
"use strict";
const STAFF_NAV = [["tongquan", "Tổng quan", "layout-dashboard", ["quanly"]], ["suat", "Suất chiếu", "calendar-clock", ["quanly"]], ["soat", "Soát vé", "scan-line", ["nhanvien", "quanly"]], ["quay", "Bán tại quầy", "store", ["nhanvien", "quanly"]], ["kiemthu", "Kiểm thử", "flask-conical", ["quanly"]]];
const NET_TXT = { offline: ["Ngoại tuyến", "warn"], connecting: ["Đang kết nối…", "neutral"], online: ["Trực tuyến · realtime", "ok"], reconnecting: ["Đang kết nối lại…", "warn"], error: ["Không kết nối được – chạy ngoại tuyến", "bad"] };
const netBadge = () => { const [t, k] = NET_TXT[Remote.status] || [Remote.status, "neutral"]; return `<span data-net>${tone(t, k)}</span>`; };
function staffShell(active, title, sub, actions, body) {
  const u = Auth.user, role = u.role;
  const todayScans = S.tickets.filter(t => t.status === "used").length;
  const links = STAFF_NAV.filter(n => n[3].includes(role)).map(([k, l, i]) => `<a href="#/${k}" ${k === active ? 'aria-current="page"' : ""} class="flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm ${k === active ? "bg-secondary font-medium text-foreground" : "text-foreground/70 hover:bg-item-hover hover:text-foreground"}">${ic(i)}${l}${k === "soat" && todayScans ? `<span class="ml-auto text-xs tabular-nums ${k === active ? "text-foreground" : "text-muted"}">${todayScans}</span>` : ""}</a>`).join("");
  const side = `<div class="flex h-16 shrink-0 items-center border-b border-border px-5">${LOGO}</div>
    <nav class="flex flex-1 flex-col gap-1 overflow-y-auto p-3" aria-label="Điều hướng quản lý">${links}
      ${role === "quanly" ? `<p class="mt-4 flex h-10 items-center px-3 text-xs font-medium uppercase tracking-wide text-muted">Hệ thống</p>
      <a href="#/quyen" ${active === "quyen" ? 'aria-current="page"' : ""} class="flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm ${active === "quyen" ? "bg-secondary font-medium text-foreground" : "text-foreground/70 hover:bg-item-hover hover:text-foreground"}">${ic("shield-check")}Tài khoản &amp; quyền</a>` : ""}
    </nav>
    <div class="p-3"><div class="flex items-center gap-3 rounded-xl border border-border p-3">${avatar(u.name)}<span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${esc(u.name)}</span><span class="block text-xs text-muted">${Auth.ROLE_TXT[role]}</span></span><button type="button" class="${B.icon} -mr-1 size-8" data-act="logout" aria-label="Đăng xuất" title="Đăng xuất">${ic("log-out")}</button></div></div>`;
  return `<div class="flex min-h-screen">
    <aside class="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-surface lg:flex">${side}</aside>
    <aside class="drawer flex flex-col bg-surface shadow-modal lg:hidden" aria-label="Menu"><button type="button" class="sr-only" data-act="menu">Đóng menu</button>${side}</aside><div class="drawer-scrim lg:hidden" data-act="menu"></div>
    <div class="min-w-0 flex-1">
      <header class="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
        <button type="button" data-act="menu" class="${B.icon} -ml-2 lg:hidden" aria-label="Mở menu">${ic("menu", "size-5")}</button>
        <h1 class="truncate text-xl font-semibold">${title}</h1>
        ${sub ? `<span class="hidden truncate text-sm text-muted sm:inline">${sub}</span>` : ""}
        <div class="ml-auto flex items-center gap-2"><span class="hidden md:inline">${netBadge()}</span>${actions}</div>
      </header>
      <main class="p-4 sm:p-6">${body}</main>
    </div>
  </div>`;
}
function v403() {
  const home = HOME[Auth.user.role];
  const inner = `<div class="grid min-h-[60vh] place-items-center">${emptyState("shield-x", "Bạn không có quyền xem trang này", `Tài khoản ${esc(Auth.user.name)} (${Auth.ROLE_TXT[Auth.user.role]}) không được mở trang này. Máy chủ cũng từ chối các thao tác của trang dù có mở bằng đường dẫn.`, `<a href="#/${home}" class="${B.outline}">Về trang của tôi</a>`)}</div>`;
  return Auth.user.role === "khach" ? customerShell("", inner) : staffShell("", "Không có quyền", "", "", inner);
}

/* ---------- Tổng quan ---------- */
function kpi(label, value, icon, sub = "") { return `<div class="rounded-xl border border-border bg-surface p-4"><div class="flex items-center justify-between gap-2"><span class="text-sm text-muted">${label}</span><span class="grid size-8 place-items-center rounded-lg bg-secondary text-muted">${ic(icon)}</span></div><p class="mt-2 text-xl font-semibold tabular-nums sm:text-2xl">${value}</p>${sub ? `<p class="mt-0.5 text-xs text-muted">${sub}</p>` : ""}</div>`; }
function dayStats(day) {
  const ss = S.shows.filter(s => dayKey(s.start) === day), cap = ss.reduce((a, s) => a + capacity(s), 0);
  const sold = ss.reduce((a, s) => a + (capacity(s) - freeSeats(s)), 0);
  const rev = S.tickets.filter(t => t.status !== "refunded" && ss.some(s => s.id === t.showId)).reduce((a, t) => a + t.price, 0) + S.groups.filter(g => ss.some(s => s.id === g.showId)).reduce((a, g) => a + g.total, 0);
  return { ss, cap, sold, rev, fill: cap ? Math.round(sold / cap * 100) : 0 };
}
function vTongQuan() {
  const st = dayStats(dayKey(new Date()));
  const byCh = {}; S.tickets.filter(t => t.status !== "refunded").forEach(t => byCh[t.channel || "Khác"] = (byCh[t.channel || "Khác"] || 0) + t.price); S.groups.forEach(g => byCh["Vé đoàn"] = (byCh["Vé đoàn"] || 0) + g.total);
  const max = Math.max(1, ...Object.values(byCh));
  const ageLogs = S.logs.filter(l => ["age", "gate", "spot", "doc", "vneid"].includes(l.type)).slice(0, 8);
  const body = `<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">${kpi("Suất hôm nay", st.ss.length, "calendar-clock")}${kpi("Ghế đã bán", st.sold, "armchair", `trên ${st.cap} ghế`)}${kpi("Lấp đầy", st.fill + "%", "gauge")}${kpi("Doanh thu vé bán qua hệ thống", vnd(st.rev).replace(/\.\d{3} đ$/, " nghìn đ"), "banknote")}</div>
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2 xl:items-start">
      ${card(`${h2("Suất hôm nay", `<a href="#/suat" class="text-sm text-muted hover:text-foreground">Xếp lịch</a>`)}<div class="-mx-4 overflow-x-auto sm:-mx-5"><table class="w-full min-w-[480px] text-sm"><thead><tr class="border-y border-border text-left text-xs text-muted"><th class="px-4 py-2.5 font-medium sm:px-5">Giờ</th><th class="px-4 py-2.5 font-medium">Phim</th><th class="px-4 py-2.5 font-medium">Phòng</th><th class="px-4 py-2.5 font-medium sm:px-5">Lấp đầy</th></tr></thead><tbody>${st.ss.sort((a, b) => new Date(a.start) - new Date(b.start)).map(s => { const fill = Math.round((capacity(s) - freeSeats(s)) / capacity(s) * 100); return `<tr class="border-b border-border last:border-0"><td class="px-4 py-3 font-medium tabular-nums sm:px-5">${hhmm(s.start)}</td><td class="px-4 py-3"><span class="flex items-center gap-2"><span class="max-w-[220px] truncate">${esc(film(s.filmId).title)}</span>${rate(film(s.filmId).rating)}</span></td><td class="whitespace-nowrap px-4 py-3 text-muted">${room(s.roomId).name}</td><td class="px-4 py-3 sm:px-5"><span class="flex items-center gap-2"><span class="h-1.5 w-14 overflow-hidden rounded-full bg-secondary"><span class="block h-full rounded-full bg-chart-fill" style="width:${fill}%"></span></span><span class="w-9 text-right tabular-nums text-muted">${fill}%</span></span></td></tr>`; }).join("")}</tbody></table></div>`)}
      <div class="grid gap-4">
        ${card(`${h2("Doanh thu theo kênh")}${Object.keys(byCh).length ? `<div class="grid gap-3">${Object.entries(byCh).map(([k, v]) => `<div><div class="flex items-center justify-between text-sm"><span>${esc(k)}</span><span class="tabular-nums">${vnd(v)}</span></div><span class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-secondary"><span class="block h-full rounded-full bg-chart-fill" style="width:${v / max * 100}%"></span></span></div>`).join("")}</div>` : `<p class="text-sm text-muted">Chưa có giao dịch hôm nay.</p>`}`)}
        ${card(`${h2("Nhật ký kiểm tra độ tuổi", `<span class="text-xs text-muted">Bằng chứng khi thanh tra</span>`)}${ageLogs.length ? `<ul class="grid">${ageLogs.map(l => `<li class="flex items-start gap-3 border-b border-border py-2.5 text-sm last:border-0"><span class="w-12 shrink-0 text-xs tabular-nums text-muted">${hhmm(l.t)}</span><span class="min-w-0 flex-1 text-pretty">${esc(l.msg)}</span>${l.ok ? tone("Đạt", "ok") : tone("Từ chối", "bad")}</li>`).join("")}</ul>` : `<p class="text-sm text-muted">Chưa có bản ghi.</p>`}`)}
      </div>
    </div>`;
  return staffShell("tongquan", "Tổng quan", `${WEEKDAY[new Date().getDay()]}, ${dmy(new Date())}`, `<button type="button" class="${B.outline}" data-act="reset">${ic("rotate-ccw")}<span class="hidden sm:inline">Đặt lại dữ liệu demo</span></button>`, body);
}

/* ---------- Suất chiếu ---------- */
function vSuat() {
  const days = showDays(), cur = days.includes(S.view.sday) ? S.view.sday : (days.includes(dayKey(new Date())) ? dayKey(new Date()) : days[0]);
  const st = dayStats(cur), now = new Date(), d0 = new Date(cur), H0 = 8, H1 = 25, span = H1 - H0;
  const pct = t => ((new Date(t) - d0) / 3600000 - H0) / span * 100;
  const f = S.view.ns || (S.view.ns = { film: "f3", room: "R1", day: cur, time: "" });
  // kiểm tra trùng ngay khi gõ giờ
  let clash = null, endTxt = "";
  if (/^\d{1,2}:\d{2}$/.test(f.time)) { const [h, m] = f.time.split(":").map(Number); const s0 = new Date(f.day); s0.setHours(h, m, 0, 0); const e0 = new Date(s0.getTime() + (film(f.film).dur + 15) * 60000); endTxt = `Kết thúc ${hhmm(new Date(s0.getTime() + film(f.film).dur * 60000))}, cộng 15 phút dọn phòng.`; clash = S.shows.find(s => s.roomId === f.room && new Date(s.start) < e0 && endOf(s) > s0); f._s0 = s0; f._e0 = e0; }
  const lanes = S.rooms.map(r => {
    const blocks = st.ss.filter(s => s.roomId === r.id).map(s => {
      const fm = film(s.filmId), end = new Date(new Date(s.start).getTime() + fm.dur * 60000), fill = Math.round((capacity(s) - freeSeats(s)) / capacity(s) * 100), past = end < now, live = new Date(s.start) <= now && end >= now;
      return `<div class="absolute ${clash && clash.roomId === r.id ? "top-1.5 h-[46px]" : "inset-y-1.5"} overflow-hidden rounded-lg border px-2 py-1 ${live ? "border-primary bg-primary-light" : past ? "border-border bg-background text-muted" : "border-border-strong bg-surface"}" style="left:${pct(s.start)}%;width:${pct(end) - pct(s.start)}%" title="${esc(fm.title)} · ${hhmm(s.start)}–${hhmm(end)} · lấp đầy ${fill}%"><span class="block truncate text-xs font-medium">${esc(fm.title)}</span><span class="block truncate text-xs tabular-nums ${live ? "text-foreground/80" : "text-muted"}">${hhmm(s.start)} · ${fill}%</span></div>`;
    }).join("");
    const draft = f._s0 && f.room === r.id && dayKey(f._s0) === cur ? `<div class="absolute ${clash ? "top-[56px] h-[34px] border-[var(--error)] bg-err-bg/70" : "inset-y-1.5 border-primary bg-primary-light"} rounded-lg border-2 border-dashed px-2 py-1" style="left:${pct(f._s0)}%;width:${pct(f._e0) - pct(f._s0)}%"><span class="block truncate text-xs font-medium ${clash ? "text-err" : ""}">${clash ? "Trùng giờ" : "Suất mới"}</span></div>` : "";
    return `<div class="flex border-b border-border last:border-0"><div class="w-24 shrink-0 border-r border-border px-3 py-3"><p class="text-sm font-medium">${r.name}</p><p class="text-xs text-muted">${r.rows * r.cols} ghế</p></div><div class="relative ${clash && clash.roomId === r.id ? "h-24" : "h-16"} flex-1 overflow-hidden">${blocks}${draft}</div></div>`;
  }).join("");
  const hours = Array.from({ length: 9 }, (_, i) => H0 + i * 2);
  const nowLine = dayKey(now) === cur ? `<span class="absolute inset-y-0 w-px bg-primary" style="left:${pct(now)}%"></span>` : "";
  const grid = `<div class="overflow-x-auto rounded-xl border border-border bg-surface"><div class="min-w-[1100px]"><div class="flex border-b border-border"><div class="w-24 shrink-0"></div><div class="relative h-8 flex-1">${hours.map(h => `<span class="absolute top-2 -translate-x-1/2 text-xs tabular-nums text-muted" style="left:${(h - H0) / span * 100}%">${h % 24}:00</span>`).join("")}${nowLine}</div></div>${lanes}</div></div>`;
  const form = card(`<div class="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h2 class="text-base font-semibold">Thêm suất</h2><p class="text-xs text-muted">${endTxt || "Giờ kết thúc = bắt đầu + thời lượng + 15 phút dọn phòng."}</p></div>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-start">
      ${field("Phim", selectBox("ns-film", S.films.map(x => [x.id, `${x.title} (${x.dur} phút)`]), f.film, { act: "ns" }))}
      ${field("Phòng", selectBox("ns-room", S.rooms.map(r => [r.id, `${r.name} · ${r.rows * r.cols} ghế`]), f.room, { act: "ns" }))}
      ${field("Ngày", selectBox("ns-day", days.map(d => [d, dayLabel(d)]), f.day, { act: "ns" }))}
      ${field("Giờ bắt đầu", input("ns-time", f.time, `placeholder="19:30" inputmode="numeric" maxlength="5" data-act="ns-time" ${clash ? 'aria-invalid="true"' : ""}`), clash ? `Trùng ${hhmm(clash.start)}–${hhmm(endOf(clash))} (${esc(film(clash.filmId).title)})` : "", !!clash)}
      <button type="button" class="${B.primary} min-h-11 md:min-h-10 xl:mt-[26px]" data-act="add-show" ${f._s0 && !clash ? "" : "disabled"}>Thêm suất</button>
    </div>`);
  const body = `<div class="mb-4">${dateStrip(days, cur, "suat-day")}</div>
    <div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">${kpi("Suất trong ngày", st.ss.length, "calendar-clock")}${kpi("Ghế đã bán", st.sold, "ticket")}${kpi("Lấp đầy", st.fill + "%", "armchair")}${kpi("Doanh thu", vnd(st.rev), "banknote")}</div>
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4"><div class="min-w-0">${grid}<p class="mt-2 text-xs text-muted">${nowLine ? "Vạch đỏ: bây giờ " + hhmm(now) + ". " : ""}Rê chuột lên suất để xem chi tiết. Gõ giờ ở ô dưới để thấy suất mới trên lưới trước khi thêm.</p></div><div>${form}</div></div>`;
  return staffShell("suat", "Suất chiếu", dmy(cur), `<button type="button" class="${B.primary}" data-act="focus-ns">${ic("plus")}<span class="hidden sm:inline">Thêm suất</span></button>`, body);
}

/* ---------- Soát vé ---------- */
const GATE = { method: "cam", stop: null, busy: false, last: "" };
const SCAN_TXT = { ok: ["Hợp lệ – đã cho vào", "ok"], doc: ["Cần kiểm tra giấy tờ", "warn"], used: ["Vé đã dùng", "bad"], refunded: ["Vé đã hoàn", "bad"], none: ["Không tìm thấy vé", "bad"], expired: ["QR hết hạn", "bad"], forged: ["QR giả / bị sửa", "bad"], static: ["Mã tĩnh – đối chiếu thêm", "warn"], group: ["Vé đoàn", "ok"], rejected: ["Từ chối", "bad"] };
function gateRecent() {
  const R = S.view.gateLog || [];
  if (!R.length) return card(emptyState("scan-line", "Chưa quét vé nào", "Kết quả mỗi lần quét sẽ hiện ở đây."));
  return `<div class="overflow-hidden rounded-xl border border-border bg-surface">${R.slice(0, 12).map(x => `<div class="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"><span class="w-16 shrink-0 text-xs tabular-nums text-muted">${hhmmss(x.t)}</span><span class="min-w-0 flex-1"><span class="block font-mono text-sm font-medium">${esc(x.code)}</span><span class="block truncate text-xs text-muted">${esc(x.detail)}</span></span>${tone(SCAN_TXT[x.kind][0], SCAN_TXT[x.kind][1])}</div>`).join("")}</div>`;
}
function gateInput() {
  const m = GATE.method;
  if (m === "cam") return `<div id="gate-stage" class="cam-stage aspect-[4/3] max-h-[340px] w-full"><div class="frame"></div><p class="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-3 py-1 text-xs text-white" id="gate-cam-msg">Đang mở camera…</p></div>`;
  if (m === "anh") return `<label class="drop grid cursor-pointer place-items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-10 text-center hover:bg-surface-hover" data-drop="gate">
      <span class="grid size-11 place-items-center rounded-xl bg-secondary text-muted">${ic("image-up", "size-5")}</span>
      <span><span class="block text-sm font-medium">Kéo ảnh QR vào đây hoặc <span class="text-primary underline underline-offset-2">chọn ảnh</span></span><span class="mt-1 block text-xs text-muted">PNG, JPG · ảnh chụp màn hình vé, ảnh in</span></span>
      <input type="file" accept="image/*" id="gate-file" class="sr-only"></label>`;
  if (m === "nfc") return card(Nfc.supported() ? `<div class="flex flex-wrap items-center gap-3"><span class="grid size-11 place-items-center rounded-xl bg-secondary text-muted">${ic("nfc", "size-5")}</span><div class="min-w-0 flex-1"><p class="font-medium">Chạm thẻ / sticker NFC vào mặt sau điện thoại</p><p class="text-sm text-muted">Thẻ chứa mã vé hoặc mã thẻ học sinh (NDEF).</p></div><button type="button" class="${B.primary}" data-act="gate-nfc">Bắt đầu đọc</button></div>` : banner("warn", "Thiết bị này không đọc được NFC", esc(Nfc.why())));
  return card(`<div class="flex flex-wrap items-end gap-3"><div class="min-w-[200px] flex-1">${field("Mã vé / mã đoàn", input("gate-code", "", `placeholder="VXXXXXX hoặc G-XXXXX" autocomplete="off" class="${INPUT} font-mono uppercase"`))}</div><button type="button" class="${B.primary} min-h-11 md:min-h-10" data-act="gate-scan">Kiểm tra</button></div><p class="mt-2 text-xs text-muted">Mã gõ tay là mã tĩnh: luôn đối chiếu thêm giấy tờ hoặc thông tin đặt vé.</p>`);
}
function gateResultCard() {
  const g = S.view.gate || {}, r = g.result;
  if (!r) return "";
  if (r.kind === "group") return groupPanel(r.code);
  const big = (t, icon, title, lines, actions = "") => `<div class="flex items-start gap-4 rounded-xl border border-border bg-surface p-4 sm:p-5" data-gate-result="${r.kind}">
    <span class="grid size-14 shrink-0 place-items-center rounded-xl ${TONE[t]}">${ic(icon, "size-7")}</span>
    <div class="min-w-0 flex-1"><p class="text-2xl font-semibold ${t === "ok" ? "text-success" : t === "bad" ? "text-err" : "text-warning"}">${title}</p>${lines}${actions ? `<div class="mt-3 flex flex-wrap gap-2">${actions}</div>` : ""}</div></div>`;
  const t = r.code && S.tickets.find(x => x.code === r.code), sh = t && show(t.showId), f = sh && film(sh.filmId);
  const tline = t ? `<p class="mt-1 text-sm">${esc(f.title)} ${rate(f.rating)} · ${hhmm(sh.start)} · ${room(sh.roomId).name} · <b>${esc(t.seat)}</b></p>` : "";
  const qline = r.qr ? `<p class="mt-1 text-xs text-muted">${esc(r.code)} · ${r.qr.status === "ok" ? `QR ký ${r.qr.age_seconds ?? 0} giây trước` : r.qr.status === "expired" ? `QR tạo cách đây ${r.qr.age_seconds} giây (quá 30 giây)` : r.qr.status === "forged" ? "chữ ký không khớp" : r.qr.status === "static" ? "không có chữ ký thời gian" : ""}${r.qr.record_id ? ` · lưu bản ghi #${r.qr.record_id}` : ""}${t && t.verified ? " · tuổi đã xác minh qua VNeID" : ""}</p>` : `<p class="mt-1 text-xs text-muted">${esc(r.code || "")}</p>`;
  if (r.kind === "ok") return big("ok", "check", "Hợp lệ – cho vào", tline + qline);
  if (r.kind === "expired") return big("bad", "timer-off", "QR hết hạn", `<p class="mt-1 text-sm text-pretty">Có thể là ảnh chụp màn hình. Yêu cầu khách mở vé trên app – mã đổi mỗi 15 giây.</p>` + qline);
  if (r.kind === "forged") return big("bad", "shield-alert", "QR giả hoặc bị sửa", `<p class="mt-1 text-sm">Chữ ký không do máy chủ CineVin tạo. Không cho vào.</p>` + qline);
  if (r.kind === "none") return big("bad", "search-x", "Không tìm thấy vé", `<p class="mt-1 text-sm">${ON() ? "Vé giả hoặc sai mã – đã đối chiếu với máy chủ." : "Vé giả, sai mã, hoặc bán ở máy khác (đang ngoại tuyến)."}</p>` + qline);
  if (r.kind === "used" || r.kind === "refunded") return big("bad", "ban", r.kind === "used" ? "Vé đã dùng" : "Vé đã hoàn", tline + `<p class="mt-1 text-sm">Không cho vào.</p>` + qline);
  if (r.kind === "static" || r.kind === "doc") {
    const why = r.kind === "static" ? "Mã tĩnh (gõ tay, ảnh cũ hoặc QR ngoại tuyến) – không chứng minh được vé đang mở trên app. Đối chiếu tên trên vé với giấy tờ." : esc(t.reason || "Người xem chưa xác thực tuổi.");
    return big("warn", "id-card", r.kind === "static" ? "Mã tĩnh – đối chiếu thêm" : "Cần kiểm tra giấy tờ", tline + `<p class="mt-1 text-pretty text-sm">${why}</p>` + qline,
      `<div class="w-full sm:w-56">${selectBox("gate-doc", ["Căn cước", "Căn cước điện tử VNeID", "Giấy khai sinh", "Thẻ học sinh", "Hộ chiếu", "Giấy phép lái xe"].map(x => [x, x]), S.view.gateDoc || "Căn cước", { act: "gate-doc-type" })}</div><button type="button" class="${B.primary}" data-act="gate-doc" data-code="${t.code}" data-ok="1">Đạt – cho vào</button><button type="button" class="${B.outline}" data-act="gate-doc" data-code="${t.code}" data-ok="0">Không đạt – từ chối</button>`);
  }
  return big("bad", "x", r.kind, qline);
}
function groupPanel(code) {
  const grp = S.groups.find(x => x.code === code); if (!grp) return "";
  const sh = show(grp.showId), f = film(sh.filmId), cards = RATINGS[f.rating] >= 13, g = S.view.gate;
  if (grp.status === "used") return banner("bad", "Vé đoàn đã sử dụng", `${grp.code} · đã vào ${grp.enteredCount ?? "?"}/${grp.students.length}`);
  const ent = grp.students.filter(s => s.entered).length;
  const head = `<div class="flex flex-wrap items-center gap-2"><span class="font-mono font-semibold">${grp.code}</span>${rate(f.rating)}<span class="text-sm">${esc(f.title)}</span><span class="text-sm text-muted">${hhmm(sh.start)} · ${room(sh.roomId).name} · ${seatRows(grp.seats)}</span></div>
    <div class="mt-3 flex flex-wrap items-center gap-2 text-sm"><span>Phụ trách: <b>${esc(grp.teacher)}</b></span>${tone("VNeID", "ok")}${grp.faceOk ? tone(`Khuôn mặt khớp${grp.faceScore != null ? " " + grp.faceScore + "%" : ""}`, "ok") : `<button type="button" class="${B.outline}" data-act="gate-face" data-code="${grp.code}">${ic("scan-face")}Đối chiếu khuôn mặt 1:1</button>`}</div>`;
  let body;
  if (!cards) body = `<div class="mt-4">${banner("ok", "Phim P – chỉ cần đếm người", `Chặn khi vượt ${grp.students.length} em.`)}</div>
    <div class="mt-4 flex flex-wrap items-center gap-2"><button type="button" class="${B.outline} size-10 !px-0" data-act="gate-count" data-d="-1" aria-label="Bớt 1">${ic("minus")}</button><span class="min-w-16 text-center text-2xl font-semibold tabular-nums" data-count-val>${grp.counted || 0}</span><span class="text-muted">/ ${grp.students.length}</span><button type="button" class="${B.outline} size-10 !px-0" data-act="gate-count" data-d="1" aria-label="Thêm 1">${ic("plus")}</button><button type="button" class="${B.outline}" data-act="gate-count" data-d="10">+10</button><button type="button" class="${B.primary} ml-auto" data-act="gate-finish">Hoàn tất (${grp.students.length - (grp.counted || 0)} vắng)</button></div>`;
  else { const spot = grp.spot || [];
    body = `<div class="mt-4">${banner("warn", `Phim ${f.rating} – quét thẻ QR từng em`, `Thẻ đã quét bị chặn; thẻ không thuộc đoàn bị từ chối; sau đó kiểm tra ngẫu nhiên ${S.params.spot} em.`)}</div>
      <div class="mt-4 flex items-center gap-3"><span class="text-sm font-medium tabular-nums">${ent}/${grp.students.length}</span><span class="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"><span class="block h-full rounded-full bg-chart-fill" style="width:${ent / grp.students.length * 100}%"></span></span></div>
      <div class="mt-3 flex flex-wrap gap-2"><button type="button" class="${B.primary}" data-act="gate-card-camera">${ic("camera")}Quét thẻ bằng camera</button>${Nfc.supported() ? `<button type="button" class="${B.outline}" data-act="gate-card-nfc">Chạm thẻ NFC</button>` : ""}<button type="button" class="${B.outline}" data-act="gate-next-card">Giả lập thẻ tiếp theo</button><button type="button" class="${B.ghost}" data-act="gate-dup">Giả lập quét lại</button><button type="button" class="${B.ghost}" data-act="gate-foreign">Giả lập thẻ lạ</button></div>
      ${g.cardMsg ? `<div class="mt-3">${banner(g.cardMsg.ok ? "ok" : "bad", "", esc(g.cardMsg.text))}</div>` : ""}
      ${spot.length ? `<div class="mt-4"><h3 class="mb-2 font-semibold">Kiểm tra ngẫu nhiên</h3><div class="overflow-hidden rounded-xl border border-border">${spot.map(id => { const s = grp.students.find(x => x.id === id); return `<div class="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2.5 last:border-0"><span class="min-w-0 flex-1"><span class="block text-sm font-medium">${esc(s.name)}</span><span class="block text-xs text-muted">${dmy(s.dob)} · lớp ${esc(s.cls)}</span></span>${s.spot === true ? tone("Khớp", "ok") : s.spot === false ? tone("Không khớp", "bad") : `<button type="button" class="${B.outline}" data-act="gate-spot" data-id="${s.id}" data-ok="1">Khớp</button><button type="button" class="${B.ghost}" data-act="gate-spot" data-id="${s.id}" data-ok="0">Không</button>`}</div>`; }).join("")}</div></div>` : `<button type="button" class="${B.outline} mt-4" data-act="gate-spotpick" ${ent ? "" : "disabled"}>Chọn ngẫu nhiên ${S.params.spot} em để đối chiếu</button>`}
      <div class="mt-4 flex justify-end"><button type="button" class="${B.primary}" data-act="gate-finish" ${spot.length && spot.every(id => grp.students.find(x => x.id === id).spot != null) ? "" : "disabled"}>Hoàn tất (${grp.students.length - ent} vắng)</button></div>`; }
  return card(head + body);
}
function vSoat() {
  const methods = [["cam", "Camera", "camera"], ["anh", "Ảnh QR", "image"], ["nfc", "NFC", "nfc"], ["ma", "Nhập mã", "keyboard"]];
  const body = `<div class="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4"><div><div class="overflow-x-auto scrollbar-clean">${seg(methods, GATE.method, "gate-method")}</div></div><div id="gate-input">${gateInput()}</div><div id="gate-result">${gateResultCard()}</div></div>
      <section><div class="mb-3 flex items-center justify-between"><h2 class="text-lg font-semibold">Vừa quét</h2><span class="text-sm text-muted">Hôm nay ${(S.view.gateLog || []).length} lượt</span></div><div id="gate-recent">${gateRecent()}</div></section></div>`;
  return staffShell("soat", "Soát vé", "Mọi cửa dùng chung dữ liệu realtime", "", body);
}

/* ---------- Bán tại quầy ---------- */
function vQuay() {
  const p = S.view.pos || (S.view.pos = { showId: null, seats: [], types: {}, docs: {} });
  const up = S.shows.filter(s => new Date(s.start) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start));
  let body = `<div class="mb-4 max-w-xl">${field("Suất chiếu", selectBox("pos-show", up.map(s => [s.id, `${dayLabel(s.start)} ${hhmm(s.start)} · ${film(s.filmId).title} (${film(s.filmId).rating}) · ${room(s.roomId).name}`]), p.showId, { act: "pos-show", placeholder: "Chọn suất…" }))}</div>`;
  if (!p.showId || !show(p.showId)) return staffShell("quay", "Bán tại quầy", "Dùng chung sơ đồ ghế với kênh trực tuyến", "", body + card(emptyState("store", "Chọn suất để bán vé", "Sơ đồ ghế cập nhật realtime với khách mua online.")));
  const sh = show(p.showId), f = film(sh.filmId);
  let summary = `<p class="text-sm text-muted">Bấm ghế trên sơ đồ để thêm vào đơn.</p>`;
  if (p.seats.length) { let total = 0; const need = [];
    const rows = p.seats.map(sid => { const ty = p.types[sid] || "adult", disc = { adult: 0, child: S.prices.child, u22: S.prices.u22, senior: S.prices.senior }[ty], nd = ty !== "adult" || RATINGS[f.rating] > 0; if (nd) need.push(sid);
      const doc = p.docs[sid], price = seatPrice(sh, sid) * (1 - (doc?.ok === false ? 0 : disc)); total += price;
      return `<div class="grid gap-2 border-b border-border py-3 last:border-0"><div class="flex items-center gap-2"><span class="w-10 font-mono text-sm font-medium">${sid}</span><div class="min-w-0 flex-1">${selectBox("pos-ty-" + sid, [["adult", "Người lớn"], ["child", "Trẻ em"], ["u22", "U22 / HSSV"], ["senior", "Người cao tuổi"]], ty, { act: "pos-type", extra: `data-seat="${sid}"` })}</div><span class="w-24 text-right text-sm tabular-nums">${vnd(price)}</span></div>
        ${nd ? `<div class="flex flex-wrap items-center gap-2 pl-12"><div class="min-w-[160px] flex-1">${selectBox("pos-doc-" + sid, ["Căn cước", "Căn cước điện tử VNeID", "Giấy khai sinh", "Thẻ học sinh", "Hộ chiếu"].map(x => [x, x]), doc?.type || "", { placeholder: "Giấy tờ khách xuất trình…" })}</div>${doc ? (doc.ok ? tone("Đạt", "ok") : tone("Không đạt", "bad")) : `<button type="button" class="${B.outline}" data-act="pos-docok" data-seat="${sid}" data-ok="1">Đạt</button><button type="button" class="${B.ghost}" data-act="pos-docok" data-seat="${sid}" data-ok="0">Không</button>`}</div>` : ""}</div>`; }).join("");
    const pending = need.filter(sid => !p.docs[sid]);
    summary = `${rows}<div class="mt-3 flex items-center justify-between border-t border-border pt-3"><span class="font-medium">Tổng</span><span class="text-lg font-semibold tabular-nums">${vnd(total)}</span></div>${pending.length ? `<p class="mt-2 text-xs text-muted">${pending.length} vé chưa ghi nhận giấy tờ (không lưu ảnh giấy tờ).</p>` : ""}
      <div class="mt-3 grid grid-cols-2 gap-2"><button type="button" class="${B.outline}" data-act="pos-pay" data-m="Tiền mặt" ${pending.length ? "disabled" : ""}>Tiền mặt</button><button type="button" class="${B.primary}" data-act="pos-pay" data-m="Thẻ/ví" ${pending.length ? "disabled" : ""}>Thẻ / ví</button></div>`; }
  body += `<div class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start"><div class="min-w-0">${card(seatMap(sh, p.seats, "pos-seat"), "!p-3 sm:!p-5")}</div>${card(`<h2 class="mb-1 text-base font-semibold">Đơn tại quầy</h2><p class="mb-2 text-sm text-muted">${esc(f.title)} ${f.rating} · ${hhmm(sh.start)} · ${room(sh.roomId).name}</p>${summary}`)}</div>`;
  return staffShell("quay", "Bán tại quầy", "Dùng chung sơ đồ ghế với kênh trực tuyến", "", body);
}

/* ---------- Tài khoản & quyền ---------- */
const PERMS = [["Xem lịch chiếu, mua vé, vé của tôi", 1, 0, 0], ["Vé đoàn (giáo viên)", 1, 0, 1], ["Soát vé, quét QR / NFC", 0, 1, 1], ["Bán tại quầy", 0, 1, 1], ["Thêm suất chiếu", 0, 0, 1], ["Tổng quan doanh thu", 0, 0, 1], ["Kiểm thử, đặt lại dữ liệu", 0, 0, 1], ["Tạo tài khoản nhân viên", 0, 0, 1]];
function vQuyen() {
  const users = S.view.users;
  if (!users && Remote.v4 && Auth.token && !S.view.usersLoading) { S.view.usersLoading = true; Remote.rpc("list_users", { p_token: Auth.token }).then(r => { S.view.users = r; }).catch(e => { S.view.users = []; toast(Auth.message(e), "bad"); }).finally(() => { S.view.usersLoading = false; render(); }); }
  const list = users || (Remote.v4 ? null : Auth.DEMO.map(d => ({ username: d.username, role: d.role, display_name: d.name })));
  const nu = S.view.nu || (S.view.nu = { role: "nhanvien" });
  const body = `<div class="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2 xl:items-start">
    ${card(`${h2("Phân quyền theo vai trò")}<div class="-mx-4 overflow-x-auto sm:-mx-5"><table class="w-full min-w-[420px] text-sm"><thead><tr class="border-y border-border text-left text-xs text-muted"><th class="px-4 py-2.5 font-medium sm:px-5">Chức năng</th><th class="px-3 py-2.5 text-center font-medium">Khách</th><th class="px-3 py-2.5 text-center font-medium">Nhân viên</th><th class="px-3 py-2.5 text-center font-medium sm:pr-5">Quản lý</th></tr></thead><tbody>${PERMS.map(([n, ...v]) => `<tr class="border-b border-border last:border-0"><td class="px-4 py-2.5 sm:px-5">${n}</td>${v.map(x => `<td class="px-3 py-2.5 text-center">${x ? `<span class="inline-grid size-6 place-items-center rounded-full bg-success-bg text-success" aria-label="Có">${ic("check", "size-3.5")}</span>` : `<span class="text-muted" aria-label="Không">–</span>`}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="mt-3 text-pretty text-xs text-muted">Máy chủ kiểm vai trò trong từng hàm bằng token phiên – ẩn nút trên giao diện chỉ là lớp phụ.</p>`)}
    <div class="grid gap-4">
      ${card(`${h2("Tài khoản", `<span class="text-xs text-muted">${Remote.v4 ? "Đọc từ máy chủ" : "Tài khoản demo (ngoại tuyến)"}</span>`)}${!list ? `<div class="grid gap-2">${skelRows(4, "h-12")}</div>` : `<div class="-mx-4 sm:-mx-5">${list.map(u => `<div class="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0 sm:px-5">${avatar(u.display_name)}<span class="min-w-0 flex-1"><span class="block truncate font-medium">${esc(u.display_name)}</span><span class="block font-mono text-xs text-muted">@${esc(u.username)}</span></span>${tone(Auth.ROLE_TXT[u.role], u.role === "quanly" ? "bad" : u.role === "nhanvien" ? "warn" : "neutral")}</div>`).join("")}</div>`}`)}
      ${card(`<h2 class="mb-3 text-base font-semibold">Tạo tài khoản nhân viên</h2>${!Remote.v4 ? banner("warn", "", "Cần chạy migration 004 trên Supabase để tạo tài khoản thật.") : `<div class="grid gap-3 sm:grid-cols-2">${field("Họ tên", input("nu-name", "", 'placeholder="Trần Thị Mai" autocomplete="off"'))}${field("Tên đăng nhập", input("nu-user", "", 'placeholder="soatve2" autocomplete="off" autocapitalize="none"'))}${field("Mật khẩu", input("nu-pass", "", 'type="password" placeholder="Ít nhất 6 ký tự" autocomplete="new-password"'))}${field("Vai trò", selectBox("nu-role", [["nhanvien", "Nhân viên"], ["quanly", "Quản lý"], ["khach", "Khách hàng"]], nu.role, { act: "nu-role" }))}</div><button type="button" class="${B.primary} mt-4 min-h-11 md:min-h-10" data-act="create-user">Tạo tài khoản</button>`}`)}
    </div></div>`;
  return staffShell("quyen", "Tài khoản & quyền", "", "", body);
}
