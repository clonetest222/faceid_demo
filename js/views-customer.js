/* Màn khách hàng: Lịch chiếu → Chọn ghế → Thanh toán → Vé của tôi; Vé đoàn; Tài khoản. Bố cục theo wireframe phương án A. */
"use strict";
const poster = (f, cls) => f.img ? `<img src="${f.img}" alt="" loading="lazy" class="${cls} rounded-lg bg-secondary object-cover">` : `<div class="${cls} grid place-items-center rounded-lg bg-secondary text-muted" title="Chưa có ảnh">${ic("film", "size-5")}</div>`;
const showLine = sh => `${dayLabel(sh.start)} · ${hhmm(sh.start)} – ${hhmm(new Date(sh.start).getTime() + film(sh.filmId).dur * 60000)} · ${room(sh.roomId).name}`;
function dayLabel(d) { const x = new Date(d), t = new Date(); t.setHours(0, 0, 0, 0); const diff = Math.round((new Date(x).setHours(0, 0, 0, 0) - t) / 864e5); return (diff === 0 ? "Hôm nay" : diff === 1 ? "Ngày mai" : WEEKDAY[x.getDay()]) + " " + ddmm(x); }

/* ---------- khung app khách ---------- */
function customerShell(active, body, { bottomNav = true } = {}) {
  const u = Auth.user;
  const nav = [["lich", "Lịch chiếu", "calendar-days"], ["ve", "Vé của tôi", "ticket"], ["doan", "Vé đoàn", "users"], ["taikhoan", "Tài khoản", "circle-user-round"]];
  return `
  <header class="sticky top-0 z-30 border-b border-border bg-surface">
    <div class="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
      <a href="#/lich" aria-label="CineVin – lịch chiếu">${LOGO}</a>
      <nav class="hidden items-center gap-1 md:flex" aria-label="Điều hướng chính">${nav.slice(0, 3).map(([k, l]) => `<a href="#/${k}" ${k === active ? 'aria-current="page"' : ""} class="flex h-10 items-center rounded-xl px-3 text-sm ${k === active ? "bg-secondary font-medium text-foreground" : "text-foreground/70 hover:bg-item-hover hover:text-foreground"}">${l}</a>`).join("")}</nav>
      <a href="#/taikhoan" class="ml-auto flex items-center gap-2 rounded-xl p-1 hover:bg-item-hover" aria-label="Tài khoản">
        <span class="hidden text-right sm:block"><span class="block text-sm font-medium leading-tight">${esc(S.user.linked ? S.user.name : u.name)}</span><span class="block text-xs text-muted">Khách · ${S.user.linked ? "đã liên kết VNeID" : "chưa liên kết VNeID"}</span></span>
        ${avatar(S.user.linked ? S.user.name : u.name)}
      </a>
    </div>
  </header>
  <main class="mx-auto max-w-[1200px] p-4 sm:p-6 ${bottomNav ? "pb-24 md:pb-6" : ""}">${body}</main>
  ${bottomNav ? `<nav class="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-4 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Điều hướng dưới">${nav.map(([k, l, i]) => `<a href="#/${k}" ${k === active ? 'aria-current="page"' : ""} class="flex flex-col items-center justify-center gap-1 text-xs ${k === active ? "font-medium text-primary" : "text-muted"}">${ic(i, "size-5")}${l}</a>`).join("")}</nav>` : ""}`;
}

/* ---------- Lịch chiếu ---------- */
function dateStrip(days, cur, act) {
  return `<div class="-mx-4 overflow-x-auto px-4 scrollbar-clean sm:mx-0 sm:px-0"><div class="flex w-max gap-2">${days.map(d => { const x = new Date(d), on = d === cur, lab = dayLabel(x).split(" ")[0] === "Hôm" ? "Hôm nay" : dayLabel(x).replace(/ \d\d\/\d\d$/, "");
    return `<button type="button" data-act="${act}" data-v="${esc(d)}" aria-pressed="${on}" class="grid h-14 w-[84px] shrink-0 cursor-pointer place-content-center rounded-xl border text-center ${on ? "border-foreground bg-foreground text-surface" : "border-border-strong bg-surface hover:bg-button-hover"}"><span class="text-xs ${on ? "" : "text-muted"}">${lab}</span><span class="text-sm font-semibold tabular-nums">${ddmm(x)}</span></button>`; }).join("")}</div></div>`;
}
const showDays = () => { const t0 = new Date(); t0.setHours(0, 0, 0, 0); return [...new Set(S.shows.filter(s => new Date(s.start) >= t0).map(s => dayKey(s.start)))].sort((a, b) => new Date(a) - new Date(b)); };
function timeChip(s) {
  const left = freeSeats(s), past = new Date(s.start) <= new Date(), full = left === 0;
  const sub = past ? "Đã chiếu" : full ? "Hết ghế" : left <= 10 ? `Còn ${left} ghế` : room(s.roomId).name;
  return `<button type="button" data-act="pick-show" data-show="${s.id}" ${past || full ? "disabled" : ""} class="grid h-14 min-w-[92px] cursor-pointer content-center rounded-xl border px-3 text-left disabled:cursor-not-allowed ${past || full ? "border-border bg-background text-muted" : "border-border-strong bg-surface hover:bg-button-hover"}"><span class="text-base font-semibold tabular-nums ${past || full ? "line-through decoration-1" : ""}">${hhmm(s.start)}</span><span class="text-xs ${!past && !full && left <= 10 ? "font-medium text-warning" : "text-muted"}">${sub}</span></button>`;
}
function vLich() {
  const days = showDays(), today = dayKey(new Date());
  const cur = days.includes(S.view.day) ? S.view.day : (days.includes(today) ? today : days[0]);
  const now = new Date();
  const head = pageHead("Lịch chiếu", `CineVin Vinh · ${WEEKDAY[now.getDay()]}, ${dmy(now)} · bây giờ ${hhmm(now)}`);
  let list;
  if (!S.shows.length && Remote.status === "connecting") list = `<div class="grid gap-3 lg:grid-cols-2">${skelRows(4, "h-40")}</div>`;
  else {
    const films = S.films.map(f => [f, S.shows.filter(s => s.filmId === f.id && dayKey(s.start) === cur).sort((a, b) => new Date(a.start) - new Date(b.start))]).filter(x => x[1].length);
    list = !films.length ? card(emptyState("calendar-x", "Chưa có suất chiếu ngày này", "Rạp chưa lên lịch cho ngày đã chọn. Xem ngày khác hoặc quay lại sau.", days.length ? `<button class="${B.outline}" data-act="lich-day" data-v="${esc(days[0])}">Xem ${dayLabel(days[0]).toLowerCase()}</button>` : ""))
      : `<div class="grid gap-3 lg:grid-cols-2">${films.map(([f, ss]) => `<article class="flex gap-4 rounded-xl border border-border bg-surface p-4">
        ${poster(f, "h-[132px] w-[88px] shrink-0")}
        <div class="min-w-0 flex-1">
          <div class="flex items-start gap-2"><h2 class="line-clamp-2 min-w-0 flex-1 text-base font-semibold">${esc(f.title)}</h2>${rate(f.rating)}</div>
          <p class="mt-0.5 text-sm text-muted">${esc(f.genre)} · ${f.dur} phút</p>
          <div class="mt-3 flex flex-wrap gap-2">${ss.map(timeChip).join("")}</div>
        </div></article>`).join("")}</div>`;
  }
  return customerShell("lich", head + `<div class="mb-5">${dateStrip(days, cur, "lich-day")}</div>` + list);
}

/* ---------- Chọn ghế ---------- */
function seatMap(sh, selected, act) {
  const r = room(sh.roomId), half = Math.ceil(r.cols / 2);
  let h = `<div class="mx-auto mb-6 max-w-[520px]"><div class="h-1.5 rounded-full bg-foreground/20"></div><p class="mt-2 text-center text-xs text-muted">Màn hình</p></div><div class="overflow-x-auto pb-1"><div class="mx-auto grid w-max gap-0.5 sm:gap-1.5">`;
  for (let i = 0; i < r.rows; i++) {
    const L = String.fromCharCode(65 + i);
    h += `<div class="flex items-center gap-0.5 sm:gap-1.5"><span class="hidden w-4 text-center text-xs text-muted sm:block">${L}</span>`;
    for (let j = 0; j < r.cols; j++) {
      const sid = seatId(i, j), st = seatState(sh.id, sid), pick = selected.includes(sid), vip = r.vip.includes(i);
      const sold = st && st.st === "sold", held = st && st.st === "held" && !pick;
      const cls = pick ? "bg-primary text-primary-foreground border-primary" : sold ? "bg-secondary text-muted/60 border-secondary" : held ? "bg-background text-muted border-dashed border-muted/50" : vip ? "bg-surface border-warning/60 text-foreground hover:bg-warning-bg" : "bg-surface border-border-strong text-foreground hover:bg-button-hover";
      h += `<button type="button" data-act="${act}" data-seat="${sid}" ${sold || held ? "disabled" : ""} aria-pressed="${pick}" aria-label="Ghế ${sid}${vip ? " VIP" : ""}${sold ? ", đã bán" : held ? ", người khác đang giữ" : ""}" class="grid size-6 cursor-pointer place-items-center rounded-md border text-xs tabular-nums disabled:cursor-not-allowed sm:size-9 ${cls}">${sold ? ic("x", "size-3") : `<span class="hidden sm:inline">${j + 1}</span>`}</button>${j === half - 1 ? '<span class="w-1 sm:w-3"></span>' : ""}`;
    }
    h += `</div>`;
  }
  return h + `</div></div><div class="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted sm:flex sm:flex-wrap sm:justify-center sm:gap-x-5">
    <span class="flex items-center gap-1.5"><i class="size-4 rounded border border-border-strong bg-surface"></i>Thường ${vnd(S.prices.std)}</span>
    <span class="flex items-center gap-1.5"><i class="size-4 rounded border border-warning/60 bg-surface"></i>VIP ${vnd(S.prices.vip)}</span>
    <span class="flex items-center gap-1.5"><i class="size-4 rounded bg-primary"></i>Bạn chọn</span>
    <span class="flex items-center gap-1.5"><i class="size-4 rounded border border-dashed border-muted/50 bg-background"></i>Người khác đang giữ</span>
    <span class="flex items-center gap-1.5"><i class="size-4 rounded bg-secondary"></i>Đã bán</span></div>`;
}
function orderSummary(sh, seats, withNote = true) {
  const f = film(sh.filmId), r = room(sh.roomId), total = seats.reduce((a, s) => a + seatPrice(sh, s), 0);
  const vipN = seats.filter(s => isVip(r, s)).length;
  return `<div class="grid gap-3">
    <div class="flex items-center justify-between gap-3 text-sm"><span class="text-muted">Ghế</span><span class="text-right font-medium">${seats.length ? esc(seats.join(", ")) + (vipN ? ` · ${vipN === seats.length ? "VIP" : vipN + " VIP"}` : "") : "Chưa chọn"}</span></div>
    <div class="flex items-center justify-between gap-3 text-sm"><span class="text-muted">Giá vé</span><span class="tabular-nums">${seats.length ? `${seats.length} vé` : "–"}</span></div>
    <div class="flex items-center justify-between border-t border-border pt-3"><span class="font-medium">Tổng</span><span class="text-lg font-semibold tabular-nums">${vnd(total)}</span></div>
    ${withNote && RATINGS[f.rating] > 0 ? `<div class="flex items-start gap-2 rounded-xl bg-background p-3 text-xs text-muted">${ic("shield-check", "size-4 mt-px")}<span class="text-pretty">Phim ${f.rating}: bước thanh toán sẽ xác minh tuổi qua VNeID${S.user.linked ? " (đã liên kết, chỉ cần FaceID)" : " – liên kết một lần ở Tài khoản"}.</span></div>` : ""}
    ${S.draft && S.draft.until ? `<p class="flex items-center gap-1.5 text-xs text-muted">${ic("timer", "size-3.5")}Giữ ghế cho bạn trong <b class="tabular-nums text-foreground" data-hold-timer>--:--</b></p>` : ""}
  </div>`;
}
function vGhe() {
  const d = S.draft; if (!d || !show(d.showId)) return vLich();
  const sh = show(d.showId), f = film(sh.filmId);
  const head = `<button type="button" data-act="cancel-draft" class="mb-3 inline-flex h-8 cursor-pointer items-center gap-1 text-sm text-muted hover:text-foreground">${ic("chevron-left")}Lịch chiếu</button>
    <div class="mb-4 flex items-center gap-3">${poster(f, "h-16 w-11 shrink-0")}<div class="min-w-0"><div class="flex items-center gap-2"><h1 class="truncate text-xl font-semibold">${esc(f.title)}</h1>${rate(f.rating)}</div><p class="text-sm text-muted">${showLine(sh)}</p></div></div>`;
  const map = freeSeats(sh) === 0 && !d.seats.length ? card(emptyState("armchair", "Suất này đã hết ghế", "Tất cả ghế đã bán. Chọn suất khác cùng phim.", `<button class="${B.outline}" data-act="cancel-draft">Chọn suất khác</button>`)) : card(seatMap(sh, d.seats, "toggle-seat"), "!p-3 sm:!p-5");
  const go = `<button type="button" class="${B.primary} mt-1 w-full" data-act="to-checkout" ${d.seats.length ? "" : "disabled"}>Tiếp tục thanh toán</button>`;
  const total = d.seats.reduce((a, s) => a + seatPrice(sh, s), 0);
  const body = head + `<div class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"><div class="min-w-0">${map}</div>
    <aside class="hidden lg:block">${card(`<h2 class="mb-3 text-base font-semibold">Đơn của bạn</h2>${orderSummary(sh, d.seats)}<div class="mt-3">${go}</div>`, "sticky top-20")}</aside></div>
    <div class="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom))] lg:hidden"><div class="mx-auto flex max-w-[1200px] items-center gap-3"><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">${d.seats.length ? esc(d.seats.join(", ")) + " · " + vnd(total) : "Chọn ghế trên sơ đồ"}</p><p class="text-xs text-muted">${d.until ? `Giữ ghế <span data-hold-timer>--:--</span>` : `Tối đa ${S.params.maxTickets} ghế`}</p></div><button type="button" class="${B.primary}" data-act="to-checkout" ${d.seats.length ? "" : "disabled"}>Tiếp tục</button></div></div><div class="h-20 lg:hidden"></div>`;
  return customerShell("lich", body, { bottomNav: false });
}

/* ---------- Thanh toán ---------- */
function vThanhToan() {
  const d = S.draft; if (!d || !d.seats.length) return vGhe();
  const sh = show(d.showId), f = film(sh.filmId);
  if (!d.assign || d.assign.length !== d.seats.length) d.assign = d.seats.map((_, i) => ({ viewer: { kind: S.user.linked && i === 0 ? "self" : "other" } }));
  const chk = checkOrder(sh, d.assign); let total = 0;
  const opts = [["other", "Người đi cùng (chưa xác thực)"], ["self", `Tôi – ${S.user.name}${S.user.linked ? "" : " (chưa xác thực)"}`], ...S.dependents.map(x => ["dep:" + x.id, `Con – ${x.name} (${ageAt(x.dob, sh.start)} tuổi)`])];
  const rows = d.seats.map((sid, i) => {
    const a = d.assign[i], r = chk.res[i], aud = audience(r.verified || r.level === "Cam kết" ? r.age : null), price = seatPrice(sh, sid) * (1 - aud.disc);
    if (!r.block) total += price;
    const val = a.viewer.kind === "dep" ? "dep:" + a.viewer.depId : a.viewer.kind;
    return `<div class="grid gap-2 border-b border-border py-3 last:border-0 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
      <span class="font-mono text-sm font-medium">${sid}</span>
      <div class="min-w-0">${selectBox("viewer-" + i, opts, val, { act: "assign", extra: `data-i="${i}"` })}<p class="mt-1 text-xs ${r.block ? "text-[var(--error-text)]" : "text-muted"}">${r.block ? esc(r.reason) : r.needDoc ? esc(r.reason) : r.verified ? `Đã xác thực · ${aud.label}` : aud.label}</p></div>
      <span class="text-right text-sm tabular-nums ${r.block ? "text-muted line-through" : ""}">${vnd(price)}</span></div>`;
  }).join("");
  d.total = total;
  const min = RATINGS[f.rating];
  const age = min > 0 ? (S.user.linked
    ? `<div class="flex items-center gap-3 rounded-xl border border-border p-3"><span class="grid size-9 place-items-center rounded-lg bg-success-bg text-success">${ic("scan-face")}</span><div class="min-w-0 flex-1"><p class="text-sm font-medium">Xác minh tuổi (${f.rating})</p><p class="text-pretty text-xs text-muted">VNeID · ${esc(S.user.name)}, ${ageAt(S.user.dob, new Date())} tuổi${S.user.passkey ? ` · xác nhận chính chủ bằng ${esc(Passkey.label())} khi bấm thanh toán` : ""}</p></div>${tone("Đã xác minh", "ok")}</div>`
    : `<div class="flex items-center gap-3 rounded-xl border border-border p-3"><span class="grid size-9 place-items-center rounded-lg bg-warning-bg text-warning">${ic("scan-face")}</span><div class="min-w-0 flex-1"><p class="text-sm font-medium">Xác minh tuổi (${f.rating})</p><p class="text-pretty text-xs text-muted">Chưa liên kết VNeID – tại cửa phải xuất trình giấy tờ.</p></div><button type="button" class="${B.outline} shrink-0" data-act="vneid-self">Liên kết</button></div>`) : "";
  const pay = S.view.payMethod || "momo";
  const methods = [["momo", "Ví MoMo", "wallet"], ["card", "Thẻ ngân hàng / VNPay QR", "credit-card"], ["counter", "Trả tại quầy (giữ 15 phút)", "store"]];
  const body = `<button type="button" data-act="back-seats" class="mb-3 inline-flex h-8 cursor-pointer items-center gap-1 text-sm text-muted hover:text-foreground">${ic("chevron-left")}Chọn ghế</button>
    ${pageHead("Thanh toán", `${esc(f.title)} · ${showLine(sh)}`, `<span class="text-sm text-muted">Giữ ghế <b class="tabular-nums text-foreground" data-hold-timer>--:--</b></span>`)}
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      ${card(`<h2 class="text-base font-semibold">Người xem từng ghế</h2><p class="mt-1 text-sm text-muted">Tuổi tính tại ngày chiếu để áp giá và kiểm tra nhãn ${f.rating}.</p><div class="mt-2">${rows}</div>
        ${chk.orderErr ? `<div class="mt-3">${banner("bad", "", esc(chk.orderErr))}</div>` : ""}${chk.res.some(r => r.block) ? `<div class="mt-3">${banner("bad", "", "Vé bị chặn sẽ không được bán. Đổi người xem hoặc quay lại bỏ ghế.")}</div>` : ""}`)}
      <aside class="grid content-start gap-4">
        ${card(`<h2 class="mb-3 text-base font-semibold">Phương thức</h2><div role="radiogroup" aria-label="Phương thức thanh toán" class="grid gap-2">${methods.map(([k, l, i]) => `<button type="button" role="radio" aria-checked="${k === pay}" data-act="pay-method" data-v="${k}" class="flex h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 text-left ${k === pay ? "border-focus ring-2 ring-focus" : "border-border-strong hover:bg-button-hover"}"><span class="grid size-4 place-items-center rounded-full border ${k === pay ? "border-primary" : "border-border-strong"}">${k === pay ? '<i class="size-2 rounded-full bg-primary"></i>' : ""}</span>${ic(i, "size-4 text-muted")}<span class="text-sm">${l}</span></button>`).join("")}</div>
          ${age ? `<div class="mt-3">${age}</div>` : ""}
          <div class="mt-4 flex items-center justify-between border-t border-border pt-4"><span class="font-medium">Tổng</span><span class="text-lg font-semibold tabular-nums">${vnd(total)}</span></div>
          <button type="button" class="${B.primary} mt-3 w-full min-h-11 md:min-h-10" data-act="pay-ok" ${chk.ok ? "" : "disabled"}>Thanh toán ${vnd(total)}</button>
          <p class="mt-2 text-center text-xs text-muted">Cổng thanh toán mô phỏng – không trừ tiền thật.</p>`)}
      </aside>
    </div>`;
  return customerShell("lich", body, { bottomNav: false });
}

/* ---------- Vé của tôi ---------- */
const REVEAL = {};
const needsUnlock = t => t.status === "valid" && t.verified && RATINGS[film(show(t.showId)?.filmId).rating] > 0 && S.user.passkey && !(REVEAL[t.code] > Date.now());
const myTickets = () => S.tickets.filter(t => mine(t) && show(t.showId)).sort((a, b) => new Date(show(a.showId).start) - new Date(show(b.showId).start));
function ticketStatus(t) {
  const sh = show(t.showId), mins = (new Date(sh.start) - new Date()) / 60000;
  if (t.status === "used") return tone("Đã sử dụng", "neutral");
  if (t.status === "refunded") return tone("Đã hoàn tiền", "bad");
  if (endOf(sh) < new Date()) return tone("Đã qua", "neutral");
  if (mins <= 0) return tone("Đang chiếu", "warn");
  if (mins <= 120) return tone(`Bắt đầu sau ${Math.round(mins)} phút`, "warn");
  return tone(dayKey(sh.start) === dayKey(new Date()) ? "Hôm nay" : "Chưa đến ngày", "neutral");
}
/* QR động: máy chủ ký mã mới mỗi 15 giây; khung có watermark chạy + đồng hồ giây */
const QRLive = { code: null, payload: null, nextAt: 0, err: "", busy: false };
const qrLiveOn = () => Remote.v4 && Auth.token && ON();
async function refreshQr(code) {
  if (!qrLiveOn() || QRLive.busy) return;
  QRLive.busy = true;
  try {
    const r = await Remote.rpc("ticket_qr", { p_token: Auth.token, p_code: code });
    Object.assign(QRLive, { code, payload: r.payload, nextAt: new Date(r.next_at).getTime(), err: "" });
  } catch (e) { Object.assign(QRLive, { code, payload: null, err: Auth.message(e) }); }
  QRLive.busy = false;
  const box = $("#qr-box"); if (box && box.dataset.code === code) box.innerHTML = QRLive.payload ? qrSvg(QRLive.payload, "H") : qrSvg(code, "H");
}
function qrBlock(t, size = 220) {
  const live = qrLiveOn(), payload = live && QRLive.code === t.code && QRLive.payload ? QRLive.payload : null;
  if (live && (QRLive.code !== t.code || Date.now() >= QRLive.nextAt)) setTimeout(() => refreshQr(t.code));
  if (needsUnlock(t)) return `<button type="button" data-act="pk-reveal" data-code="${t.code}" class="mx-auto grid cursor-pointer place-items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-background text-center hover:bg-button-hover" style="width:${size + 24}px;height:${size + 24}px">${ic("lock-keyhole", "size-8 text-muted")}<span class="px-4 text-sm font-medium">Mở QR bằng ${esc(Passkey.label())}</span><span class="px-6 text-xs text-muted">Vé có giới hạn tuổi – chỉ chủ tài khoản mở được</span></button>`;
  return `<div class="relative mx-auto w-max rounded-2xl border border-border-strong bg-surface p-3">
      <div class="qr-wm pointer-events-none absolute inset-0 rounded-2xl"></div>
      <div id="qr-box" data-code="${t.code}" class="qr-box relative bg-surface" style="width:${size}px;height:${size}px">${qrSvg(payload || t.code, "H")}</div>
      <div class="relative mt-2 flex items-center justify-between text-xs text-muted"><span class="max-w-[60%] truncate">${esc(S.user.linked ? S.user.name : Auth.user.name)}</span><span class="tabular-nums" data-clock>${hhmmss(new Date())}</span></div>
    </div>
    ${live ? `<div class="mx-auto mt-3 flex w-max max-w-full items-center gap-2 text-xs text-muted"><svg viewBox="0 0 20 20" class="size-4 shrink-0 -rotate-90" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="var(--secondary)" stroke-width="3"/><circle data-ring class="ring-count" cx="10" cy="10" r="8" fill="none" stroke="var(--primary)" stroke-width="3" stroke-dasharray="50.3" stroke-dashoffset="0"/></svg><span class="text-pretty">Mã đổi sau <b class="tabular-nums text-foreground" data-count>15</b> giây · ảnh chụp màn hình sẽ bị từ chối</span></div>`
      : `<p class="mx-auto mt-3 max-w-xs text-center text-xs text-muted">${QRLive.err ? esc(QRLive.err) + " · " : ""}QR tĩnh (${!ON() ? "ngoại tuyến" : "máy chủ chưa bật QR động"}) – nhân viên sẽ đối chiếu thêm.</p>`}`;
}
function vVe() {
  const head = pageHead("Vé của tôi");
  const ts = myTickets();
  if (!ts.length && Remote.status === "connecting") return customerShell("ve", head + `<div class="grid gap-3">${skelRows(1, "h-[380px]")}${skelRows(3)}</div>`);
  if (!ts.length) return customerShell("ve", head + card(emptyState("ticket", "Bạn chưa có vé nào", "Vé mua xong sẽ nằm ở đây, kèm mã QR để vào rạp.", `<a href="#/lich" class="${B.outline}">Xem lịch chiếu</a>`)));
  const upcoming = ts.filter(t => t.status === "valid" && endOf(show(t.showId)) > new Date());
  const t = ts.find(x => x.code === S.view.tk) || upcoming[0] || ts[ts.length - 1], sh = show(t.showId), f = film(sh.filmId);
  const info = `<div class="flex items-start gap-3">${poster(f, "h-16 w-11 shrink-0")}<div class="min-w-0 flex-1"><div class="flex items-center gap-2"><h2 class="truncate text-base font-semibold">${esc(f.title)}</h2>${rate(f.rating)}</div><p class="text-sm text-muted">${dayLabel(sh.start)} · ${hhmm(sh.start)} · ${room(sh.roomId).name}</p></div></div>
    <dl class="mt-4 grid grid-cols-3 gap-3 text-sm"><div><dt class="text-xs text-muted">Ghế</dt><dd class="font-medium">${esc(t.seat)}</dd></div><div><dt class="text-xs text-muted">Mã vé</dt><dd class="font-mono font-medium">${t.code}</dd></div><div><dt class="text-xs text-muted">Tuổi</dt><dd class="font-medium">${t.needDoc ? "Kiểm tra tại cửa" : t.verified ? "Đã xác minh" : RATINGS[f.rating] ? "Kiểm tra tại cửa" : "Không giới hạn"}</dd></div></dl>
    ${t.status === "valid" && t.channel === "Online" && new Date(sh.start) > new Date() ? `<div class="mt-4 flex justify-end"><button type="button" class="${B.ghost}" data-act="refund" data-code="${t.code}">Hoàn vé</button></div>` : ""}`;
  const top = t.status === "valid" && endOf(sh) > new Date()
    ? `<div class="mb-4 flex items-center justify-between gap-2"><span class="text-sm font-medium">${t === upcoming[0] ? "Suất sắp tới" : "Vé đang xem"}</span>${ticketStatus(t)}</div>${qrBlock(t)}<div class="mt-5 border-t border-border pt-4">${info}</div>`
    : `<div class="mb-4 flex items-center justify-between gap-2"><span class="text-sm font-medium">Vé đang xem</span>${ticketStatus(t)}</div>${info}`;
  const others = ts.filter(x => x !== t);
  const body = head + `<div class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start">
    <section class="rounded-xl border border-border bg-surface p-4 sm:p-5">${top}</section>
    <section>${h2("Vé khác")}${others.length ? `<div class="overflow-hidden rounded-xl border border-border bg-surface">${others.map(x => { const s2 = show(x.showId), f2 = film(s2.filmId);
      return `<button type="button" data-act="ticket-pick" data-code="${x.code}" class="flex w-full cursor-pointer items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-surface-hover">${poster(f2, "h-14 w-10 shrink-0")}<span class="min-w-0 flex-1"><span class="block truncate font-medium">${esc(f2.title)}</span><span class="block text-xs text-muted">${dayLabel(s2.start)} · ${hhmm(s2.start)} · ${room(s2.roomId).name} · ${esc(x.seat)}</span></span>${ticketStatus(x)}</button>`; }).join("")}</div>` : `<p class="text-sm text-muted">Chưa có vé khác.</p>`}
    ${S.gifts.length ? `<div class="mt-4">${h2("Thẻ quà tặng")}<div class="flex flex-wrap gap-2">${S.gifts.map(g => tone(`${g.code} · ${vnd(g.amount)}`, "neutral")).join("")}</div></div>` : ""}</section></div>`;
  return customerShell("ve", body);
}

/* ---------- Vé đoàn (giáo viên) ---------- */
const FIRST = ["An", "Bảo", "Chi", "Dũng", "Giang", "Hà", "Hiếu", "Hoa", "Huy", "Khánh", "Lan", "Linh", "Long", "Mai", "Minh", "Nam", "Ngọc", "Nhung", "Phúc", "Quân", "Sơn", "Tâm", "Thảo", "Trang", "Tuấn", "Vy"];
const LAST = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Phan", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô"], MID = ["Văn", "Thị", "Minh", "Đức", "Thu", "Gia", "Ngọc", "Quốc", "Hải", "Bảo"];
function sampleClass(kind, n = 50) {
  const yr = new Date().getFullYear(); const list = [];
  for (let i = 0; i < n; i++) { let y = kind === "4A" ? yr - 10 : yr - 14, m = 1 + (i * 7 % 12), d = 1 + (i * 11 % 27); if (kind === "8A" && i === 17) { y = yr - 12; m = 12; d = 20; }
    list.push({ id: "hs" + i, name: `${LAST[i % LAST.length]} ${MID[(i * 3) % MID.length]} ${FIRST[(i * 5) % FIRST.length]}`, dob: `${y}-${pad(m)}-${pad(d)}`, cls: kind, parentOk: false, entered: false }); }
  return list;
}
function groupRule(rating, students, when) {
  const min = RATINGS[rating];
  return students.map(s => { const age = ageAt(s.dob, when);
    if (rating === "K" && age < 13) return { ...s, age, ok: false, why: "Phim K: dưới 13 tuổi cần cha mẹ/người giám hộ – giáo viên không phải người giám hộ" };
    if (min && age < min) return { ...s, age, ok: false, why: `Chưa đủ ${min} tuổi tại ngày chiếu` };
    return { ...s, age, ok: true, why: "" }; });
}
const myGroups = () => S.groups.filter(g => show(g.showId) && (g.teacherKey === S.teacher.key || g.teacher === S.teacher.name));
function vDoan() {
  const t = S.teacher, g = S.view.gdraft;
  const head = pageHead("Vé đoàn", esc(t.org), t.linked ? tone(`${esc(t.name)} · đã xác thực`, "ok") : "");
  const intro = banner("info", "Không quét mặt 50 em", "Xác thực chặt một người lớn chịu trách nhiệm (VNeID + FaceID), kiểm tra tuổi cả lớp theo danh sách với nhãn phim, phát một mã QR cho cả đoàn. Phim P chỉ đếm người; phim từ T13 quét thẻ QR từng em và kiểm tra ngẫu nhiên.");
  let body = "";
  if (!t.linked) body = card(`<h2 class="text-base font-semibold">Bước 1 · Xác thực người phụ trách</h2><p class="mt-1 text-sm text-muted">Người duy nhất trong đoàn cần sinh trắc học.</p><button type="button" class="${B.primary} mt-4" data-act="vneid-teacher">Xác thực bằng VNeID</button>`);
  else if (!g) body = card(`<div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="text-base font-semibold">Tạo đơn vé đoàn</h2><p class="mt-1 text-sm text-muted">Tối thiểu ${S.params.groupMin} người · giảm ${Math.round(S.params.groupDiscount * 100)}% giá vé.</p></div><button type="button" class="${B.primary}" data-act="new-group">Tạo đơn mới</button></div>`);
  else {
    const steps = ["Suất", "Danh sách", "Kiểm tra tuổi", "Phụ huynh", "Cam kết"], sh = g.showId && show(g.showId), f = sh && film(sh.filmId);
    let inner = "";
    if (g.step === 0) inner = `<div class="grid gap-3 lg:grid-cols-2">${S.films.map(ff => { const ss = S.shows.filter(s => s.filmId === ff.id && new Date(s.start) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start)); if (!ss.length) return "";
      return `<article class="flex gap-4 rounded-xl border border-border p-4">${poster(ff, "h-24 w-16 shrink-0")}<div class="min-w-0 flex-1"><div class="flex items-start gap-2"><h3 class="min-w-0 flex-1 truncate font-semibold">${esc(ff.title)}</h3>${rate(ff.rating)}</div><div class="mt-3 flex flex-wrap gap-2">${ss.map(s => `<button type="button" data-act="g-show" data-show="${s.id}" class="grid h-12 cursor-pointer content-center rounded-xl border border-border-strong bg-surface px-3 text-left hover:bg-button-hover"><span class="text-sm font-semibold tabular-nums">${ddmm(s.start)} ${hhmm(s.start)}</span><span class="text-xs text-muted">${freeSeats(s)} ghế trống</span></button>`).join("")}</div></div></article>`; }).join("")}</div>`;
    else if (g.step === 1) inner = `<p class="text-sm">Tải danh sách học sinh (xuất từ phần mềm quản lý của trường). Mỗi dòng: <span class="font-mono">Họ tên, dd/mm/yyyy, Lớp</span>.</p>
      <div class="mt-3 flex flex-wrap gap-2"><button type="button" class="${B.outline}" data-act="g-sample" data-k="4A">Mẫu lớp 4A (50 em, 9–10 tuổi)</button><button type="button" class="${B.outline}" data-act="g-sample" data-k="8A">Mẫu lớp 8A (có 1 em 12 tuổi)</button></div>
      <div class="mt-3">${field("Hoặc dán danh sách", `<textarea id="g-csv" rows="4" class="${INPUT} !h-auto py-2" placeholder="Nguyễn Văn A, 12/05/2015, 4A"></textarea>`)}</div>
      <div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="${B.outline}" data-act="g-parse">Đọc danh sách</button><span class="text-sm text-muted">${g.students.length ? g.students.length + " học sinh" : ""}</span><button type="button" class="${B.primary} ml-auto" data-act="g-next" ${g.students.length >= S.params.groupMin ? "" : "disabled"}>Kiểm tra tuổi</button></div>`;
    else if (g.step === 2) { const chk = groupRule(f.rating, g.students, sh.start), bad = chk.filter(x => !x.ok);
      inner = `${bad.length ? banner("bad", `${bad.length} em không đủ điều kiện xem phim ${f.rating}`, "") : banner("ok", `Cả ${chk.length} em đủ điều kiện`, f.rating === "P" ? "Phim P: tại cửa chỉ cần đếm người." : "Tại cửa quét thẻ QR từng em.")}
        <div class="mt-3 max-h-[380px] overflow-auto rounded-xl border border-border"><table class="w-full text-sm"><thead class="sticky top-0 bg-surface"><tr class="border-b border-border text-left text-xs text-muted"><th class="px-3 py-2 font-medium">#</th><th class="px-3 py-2 font-medium">Họ tên</th><th class="px-3 py-2 font-medium">Ngày sinh</th><th class="px-3 py-2 text-right font-medium">Tuổi</th><th class="px-3 py-2 font-medium">Kết quả</th></tr></thead><tbody>${chk.map((s, i) => `<tr class="border-b border-border last:border-0"><td class="px-3 py-2 text-muted tabular-nums">${i + 1}</td><td class="px-3 py-2">${esc(s.name)}</td><td class="px-3 py-2 tabular-nums">${dmy(s.dob)}</td><td class="px-3 py-2 text-right tabular-nums">${s.age}</td><td class="px-3 py-2">${s.ok ? tone("Đạt", "ok") : `${tone("Không đạt", "bad")} <span class="text-xs text-muted">${esc(s.why)}</span>`}</td></tr>`).join("")}</tbody></table></div>
        <div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="${B.outline}" data-act="g-back">Quay lại</button>${bad.length ? `<button type="button" class="${B.outline}" data-act="g-drop">Bỏ ${bad.length} em</button><button type="button" class="${B.outline}" data-act="g-change">Chọn phim khác</button>` : ""}<button type="button" class="${B.primary} ml-auto" data-act="g-next" ${bad.length ? "disabled" : ""}>Tiếp tục</button></div>`; }
    else if (g.step === 3) { const need = S.params.parentRequired.includes(f.rating), done = g.students.filter(s => s.parentOk).length;
      inner = `<p class="text-pretty text-sm text-muted">${need ? `Phim ${f.rating}: phụ huynh xác nhận ngày sinh và đồng ý cho con tham gia qua VNeID (đồng thời là sự đồng ý xử lý dữ liệu của trẻ).` : `Phim ${f.rating}: không bắt buộc – nhà trường cam kết danh sách là đủ.`}</p>
        <div class="mt-3 flex items-center gap-3"><span class="text-sm font-medium tabular-nums">${done}/${g.students.length}</span><span class="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"><span class="block h-full rounded-full bg-chart-fill" style="width:${done / g.students.length * 100}%"></span></span></div>
        <div class="mt-3 flex flex-wrap gap-2"><button type="button" class="${B.outline}" data-act="g-sms">Gửi SMS cho ${g.students.length} phụ huynh</button><button type="button" class="${B.outline}" data-act="g-parent-one">Thử vai 1 phụ huynh</button><button type="button" class="${B.outline}" data-act="g-parent-many">Giả lập 90% xác nhận</button></div>
        <div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="${B.outline}" data-act="g-back">Quay lại</button>${need && done < g.students.length ? `<button type="button" class="${B.outline}" data-act="g-drop-unconfirmed">Bỏ các em chưa xác nhận</button>` : ""}<button type="button" class="${B.primary} ml-auto" data-act="g-next" ${need && done < g.students.length ? "disabled" : ""}>Tiếp tục</button></div>`; }
    else { const n = g.students.length + 1, unit = S.prices.std * (1 - S.params.groupDiscount);
      inner = `<div class="grid grid-cols-3 gap-3">${[["Số vé", n, `${g.students.length} HS + 1 phụ trách`], ["Giá vé đoàn", vnd(unit), ""], ["Tổng", vnd(unit * n), ""]].map(([l, v, s]) => `<div class="rounded-xl border border-border p-3"><p class="text-xs text-muted">${l}</p><p class="mt-1 text-base font-semibold tabular-nums">${v}</p>${s ? `<p class="text-xs text-muted">${s}</p>` : ""}</div>`).join("")}</div>
        <label class="mt-4 flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" id="g-commit" ${g.commit ? "checked" : ""} data-act="g-commit" class="mt-0.5 size-4 accent-[var(--primary)]"><span class="text-pretty">Tôi, ${esc(t.name)}, đại diện ${esc(t.org)}, cam kết danh sách và ngày sinh học sinh là chính xác và chịu trách nhiệm quản lý đoàn tại rạp.</span></label>
        <div class="mt-4 flex flex-wrap items-center gap-2"><button type="button" class="${B.outline}" data-act="g-back">Quay lại</button><button type="button" class="${B.primary} ml-auto" data-act="g-pay" ${g.commit ? "" : "disabled"}>Xác nhận & thanh toán chuyển khoản</button></div>`; }
    body = `<section class="rounded-xl border border-border bg-surface">
      <div class="flex flex-wrap items-center gap-3 border-b border-border p-4 sm:px-5"><h2 class="text-base font-semibold">Đơn ${g.id}</h2>${sh ? `<span class="text-sm text-muted">${esc(f.title)} · ${ddmm(sh.start)} ${hhmm(sh.start)}</span>` : ""}<button type="button" class="${B.ghost} ml-auto" data-act="g-cancel">Huỷ đơn</button></div>
      <ol class="flex gap-1 overflow-x-auto border-b border-border px-4 py-3 scrollbar-clean sm:px-5">${steps.map((s, i) => `<li class="flex shrink-0 items-center gap-2 pr-3 text-sm ${i === g.step ? "font-medium text-foreground" : i < g.step ? "text-foreground" : "text-muted"}"><span class="grid size-6 place-items-center rounded-full text-xs ${i === g.step ? "bg-primary text-primary-foreground" : i < g.step ? "bg-success-bg text-success" : "bg-secondary"}">${i < g.step ? ic("check", "size-3.5") : i + 1}</span>${s}</li>`).join("")}</ol>
      <div class="p-4 sm:p-5">${inner}</div></section>`;
  }
  const list = myGroups();
  const issued = list.length ? `<section class="mt-6">${h2("Đơn đã phát hành")}<div class="grid gap-3 lg:grid-cols-2">${list.map(gr => { const sh = show(gr.showId), f = film(sh.filmId), cards = RATINGS[f.rating] >= 13;
    return `<article class="rounded-xl border border-border bg-surface p-4"><div class="flex gap-4"><div class="qr-box size-24 shrink-0 rounded-lg border border-border p-1.5">${qrSvg(gr.code)}</div><div class="min-w-0 flex-1"><div class="flex items-center gap-2"><h3 class="truncate font-semibold">${esc(f.title)}</h3>${rate(f.rating)}</div><p class="text-sm text-muted">${ddmm(sh.start)} ${hhmm(sh.start)} · ${room(sh.roomId).name} · ${seatRows(gr.seats)}</p><p class="mt-1 font-mono text-sm">${gr.code}</p><div class="mt-2">${gr.status === "used" ? tone(`Đã vào ${gr.enteredCount}/${gr.students.length}`, "neutral") : tone(`${gr.students.length} HS + 1 phụ trách · chưa sử dụng`, "ok")}</div></div></div>
      ${cards ? `<details class="mt-3"><summary class="cursor-pointer text-sm text-muted hover:text-foreground">Thẻ QR cá nhân (${gr.students.length}) – in và phát cho từng em</summary><div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">${gr.students.map(s => `<div class="rounded-lg border border-border p-2 text-center"><div class="qr-box mx-auto size-20">${qrSvg(s.card)}</div><p class="mt-1 truncate text-xs font-medium">${esc(s.name)}</p><p class="font-mono text-xs text-muted">${s.card}</p></div>`).join("")}</div></details>` : ""}</article>`; }).join("")}</div></section>` : "";
  return customerShell("doan", head + `<div class="mb-4">${intro}</div>` + body + issued);
}

/* ---------- Tài khoản ---------- */
function vTaiKhoan() {
  const u = S.user, a = Auth.user;
  const idCard = u.linked
    ? `<div class="flex items-start gap-3"><span class="grid size-10 place-items-center rounded-lg bg-success-bg text-success">${ic("badge-check", "size-5")}</span><div class="min-w-0"><p class="font-semibold">${esc(u.name)}</p><p class="text-sm text-muted">Sinh ${dmy(u.dob)} · ${ageAt(u.dob, new Date())} tuổi · hạng ${tier()}</p><p class="mt-1 text-xs text-muted">Xác thực lúc ${new Date(u.verifiedAt).toLocaleString("vi-VN")} · ${esc(u.method || "")}${u.faceScore != null ? ` · tương đồng ${u.faceScore}%` : ""}</p></div></div>
       <p class="mt-3 text-pretty text-xs text-muted">Rạp chỉ lưu ngày sinh, mức và thời điểm xác thực – không lưu ảnh khuôn mặt.</p>
       <div class="mt-4 flex flex-wrap gap-2"><button type="button" class="${B.outline}" data-act="vneid-self">Xác thực lại</button><button type="button" class="${B.ghost}" data-act="unlink">Huỷ liên kết</button></div>`
    : `<p class="text-pretty text-sm text-muted">Liên kết VNeID một lần để được giá theo độ tuổi (trẻ em, U22, người cao tuổi) và vào thẳng phim T13–T18 không cần giấy tờ.</p><button type="button" class="${B.primary} mt-4" data-act="vneid-self">Liên kết VNeID + FaceID</button>`;
  const pk = !u.linked ? `<p class="text-sm text-muted">Liên kết VNeID trước.</p>`
    : u.passkey ? `<p class="text-sm">Đang bật · tạo ${new Date(u.passkey.createdAt).toLocaleDateString("vi-VN")} · ${u.passkey.alg === -7 ? "ES256" : "RS256"}</p><div class="mt-3 flex flex-wrap gap-2"><button type="button" class="${B.outline}" data-act="pk-test">Thử xác thực</button><button type="button" class="${B.ghost}" data-act="pk-del">Tắt</button></div>`
    : PK.avail ? `<button type="button" class="${B.outline}" data-act="pk-create">Bật ${esc(Passkey.label())}</button>` : `<p class="text-pretty text-sm text-muted">Thiết bị/trình duyệt này không có sinh trắc tích hợp, hoặc trang chưa chạy HTTPS.</p>`;
  const deps = S.dependents.map(d => `<div class="flex items-center gap-3 border-b border-border py-3 last:border-0">${avatar(d.name)}<div class="min-w-0 flex-1"><p class="truncate font-medium">${esc(d.name)}</p><p class="text-xs text-muted">${dmy(d.dob)} · ${ageAt(d.dob, new Date())} tuổi · ${esc(d.idMasked)}</p></div>${d.level === "VNeID" ? tone("VNeID", "ok") : tone("Cam kết", "warn")}<button type="button" class="${B.icon}" data-act="del-dep" data-id="${d.id}" aria-label="Xoá ${esc(d.name)}">${ic("trash-2")}</button></div>`).join("");
  const body = pageHead("Tài khoản", `${esc(a.name)} · @${esc(a.username)} · ${Auth.ROLE_TXT[a.role]}`, `<button type="button" class="${B.outline}" data-act="logout">${ic("log-out")}Đăng xuất</button>`) + `
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 lg:items-start">
      ${card(`<h2 class="mb-3 text-base font-semibold">Định danh VNeID</h2>${idCard}`)}
      ${card(`<h2 class="text-base font-semibold">${esc(Passkey.label())} cho tài khoản</h2><p class="mb-3 mt-1 text-pretty text-sm text-muted">Mỗi lần mua vé T13–T18 hoặc mở QR vé, thiết bị xác nhận đúng chủ tài khoản. Rạp chỉ nhận chữ ký số – không có khuôn mặt hay vân tay.</p>${pk}`)}
      ${card(`<div class="mb-1 flex items-center justify-between gap-2"><h2 class="text-base font-semibold">Người phụ thuộc</h2><button type="button" class="${B.outline}" data-act="add-dep" ${u.linked ? "" : "disabled"}>${ic("plus")}Thêm trẻ</button></div><p class="text-pretty text-sm text-muted">Trẻ dưới 14 tuổi thường chưa có thẻ căn cước. Cha mẹ đã xác thực khai báo con; con có tài khoản định danh thì xác nhận qua VNeID, chưa có thì cam kết theo giấy khai sinh.</p>${deps ? `<div class="mt-2">${deps}</div>` : ""}`)}
      ${card(`<h2 class="mb-3 text-base font-semibold">Kết nối</h2><div class="grid gap-2 text-sm"><div class="flex items-center justify-between gap-2"><span class="text-muted">Máy chủ</span>${netBadge()}</div><div class="flex items-center justify-between gap-2"><span class="text-muted">Đăng nhập</span>${a.offline ? tone("Ngoại tuyến – kiểm tra trên trình duyệt", "warn") : tone("Máy chủ xác thực", "ok")}</div><div class="flex items-center justify-between gap-2"><span class="text-muted">Điểm thành viên</span><span class="tabular-nums">${u.points}</span></div></div>`)}
    </div>`;
  return customerShell("taikhoan", body);
}
