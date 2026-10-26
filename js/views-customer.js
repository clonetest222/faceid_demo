/* Màn khách hàng: Lịch chiếu → Chọn ghế → Thanh toán → Vé của tôi; Vé đoàn; Tài khoản. Bố cục theo wireframe phương án A. */
"use strict";
const poster = (f, cls) => f.img ? `<img src="${f.img}" alt="" loading="lazy" class="${cls} rounded-lg bg-secondary object-cover">` : `<div class="${cls} grid place-items-center rounded-lg bg-secondary text-muted" title="Chưa có ảnh">${ic("film", "size-5")}</div>`;
const showLine = sh => `${dayLabel(sh.start)} · ${hhmm(sh.start)} – ${hhmm(new Date(sh.start).getTime() + film(sh.filmId).dur * 60000)} · ${placeOf(sh)} · ${formatOf(sh)}`;
/** Nút chọn rạp trên đầu trang khách: "Nghệ An · CineVin Vinh Centre" */
const cinemaButton = (cls = "") => { const c = curCinema(); return `<button type="button" data-act="cinema-pick" class="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-xl px-2 py-1.5 text-left hover:bg-item-hover ${cls}" aria-label="Chọn rạp: ${esc(c.name)}">${ic("map-pin", "size-4 shrink-0 text-muted")}<span class="min-w-0"><span class="block truncate text-sm font-medium leading-tight">${esc(c.name)}</span><span class="block truncate text-xs text-muted">${esc(c.city)} · ${esc(c.district)}</span></span>${ic("chevron-down", "size-4 shrink-0 text-muted")}</button>`; };
function dayLabel(d) { const x = new Date(d), t = new Date(); t.setHours(0, 0, 0, 0); const diff = Math.round((new Date(x).setHours(0, 0, 0, 0) - t) / 864e5); return (diff === 0 ? "Hôm nay" : diff === 1 ? "Ngày mai" : WEEKDAY[x.getDay()]) + " " + ddmm(x); }

/* ---------- khung app khách ---------- */
function customerShell(active, body, { bottomNav = true, footer = false, dark = false } = {}) {
  const u = Auth.user;
  const nav = u ? (u.guest ? [["home", "Trang chủ", "house"], ["lich", "Lịch chiếu", "calendar-days"], ["ve", "Vé của tôi", "ticket"], ["taikhoan", "Tài khoản", "circle-user-round"]]
      : [["home", "Trang chủ", "house"], ["lich", "Lịch chiếu", "calendar-days"], ["ve", "Vé của tôi", "ticket"], ["doan", "Vé đoàn", "users"], ["taikhoan", "Tài khoản", "circle-user-round"]])
    : [["home", "Trang chủ", "house"], ["lich", "Lịch chiếu", "calendar-days"], ["dangnhap", "Đăng nhập", "log-in"]];
  const who = u ? `<a href="#/taikhoan" class="ml-auto flex items-center gap-2 rounded-xl p-1 hover:bg-item-hover" aria-label="Tài khoản">
        <span class="hidden text-right sm:block"><span class="block text-sm font-medium leading-tight">${esc(S.user.linked ? S.user.name : u.name)}</span><span class="block text-xs text-muted">${u.guest ? "Khách vãng lai · " + esc(u.email || "") : "Khách · " + (S.user.linked ? "đã liên kết VNeID" : "chưa liên kết VNeID")}</span></span>
        ${avatar(S.user.linked ? S.user.name : u.name)}
      </a>`
    : `<div class="ml-auto flex items-center gap-2"><a href="#/dangky" class="${B.ghost} hidden min-h-9 px-3 sm:inline-flex">Tạo tài khoản</a><a href="#/dangnhap" class="${B.primary} min-h-9 px-4">${ic("log-in")}Đăng nhập</a></div>`;
  return `
  <header class="glass-bar sticky top-0 z-30 border-b border-border/60 ${dark ? "hdr-dark" : ""}">
    <div class="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
      <a href="#/home" aria-label="CineVin – trang chủ">${LOGO}</a>
      ${cinemaButton("hidden max-w-[260px] md:flex")}
      <nav class="hidden items-center gap-1 md:flex" aria-label="Điều hướng chính">${nav.filter(n => n[0] !== "taikhoan" && n[0] !== "dangnhap").map(([k, l]) => `<a href="#/${k}" ${k === active ? 'aria-current="page"' : ""} class="flex h-10 items-center rounded-xl px-3 text-sm ${k === active ? "bg-secondary font-medium text-foreground" : "text-foreground/70 hover:bg-item-hover hover:text-foreground"}">${l}</a>`).join("")}</nav>
      ${who}
    </div>
  </header>
  <main class="mx-auto max-w-[1200px] p-4 sm:p-6 ${bottomNav ? "pb-24 md:pb-6" : ""} ${dark ? "pt-0 sm:pt-0" : ""}">${body}</main>
  ${footer ? footerHtml() : ""}
  ${bottomNav ? `<nav class="glass-bar fixed inset-x-0 bottom-0 z-30 grid h-16 border-t border-border/60 pb-[env(safe-area-inset-bottom)] md:hidden" style="grid-template-columns:repeat(${nav.length},1fr)" aria-label="Điều hướng dưới">${nav.map(([k, l, i]) => `<a href="#/${k}" ${k === active ? 'aria-current="page"' : ""} class="flex flex-col items-center justify-center gap-1 text-xs ${k === active ? "font-medium text-primary" : "text-muted"}">${ic(i, "size-5")}${l}</a>`).join("")}</nav>` : ""}`;
}

/* ---------- Lịch chiếu ---------- */
/** Khung cuộn ngang có nút tròn ‹ › ở hai mép (giống nút của hero), kéo/vuốt vẫn được; phần tử đang chọn tự cuộn vào giữa (stripFocus) */
const hscroll = (inner, cls = "", gap = "gap-1.5") => `<div class="relative min-w-0 ${cls}" data-strip-wrap><button type="button" class="strip-nav strip-nav-l" data-act="strip-scroll" data-v="-1" aria-label="Lùi">${ic("chevron-left", "size-4")}</button><button type="button" class="strip-nav strip-nav-r" data-act="strip-scroll" data-v="1" aria-label="Tiếp">${ic("chevron-right", "size-4")}</button><div class="-mx-4 overflow-x-auto px-4 scrollbar-clean sm:mx-0 sm:px-0" data-strip><div class="flex w-max items-start ${gap}">${inner}</div></div></div>`;
function dateStrip(days, cur, act) {
  return hscroll(days.map(d => { const x = new Date(d), on = d === cur, lab = dayLabel(x).split(" ")[0] === "Hôm" ? "Hôm nay" : dayLabel(x).replace(/ \d\d\/\d\d$/, ""), wk = x.getDay() === 0 || x.getDay() === 6;
    return `<button type="button" data-act="${act}" data-v="${esc(d)}" aria-pressed="${on}" class="grid h-14 w-[72px] shrink-0 cursor-pointer place-content-center rounded-xl border text-center transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-button-hover"}"><span class="text-[11px] ${on ? "text-primary-foreground/80" : wk ? "text-primary" : "text-muted"}">${lab}</span><span class="text-base font-semibold tabular-nums leading-tight">${ddmm(x).slice(0, 2)}</span><span class="text-[10px] ${on ? "text-primary-foreground/80" : "text-muted"}">th.${ddmm(x).slice(3)}</span></button>`; }).join(""));
}
const showDays = () => { const t0 = new Date(); t0.setHours(0, 0, 0, 0); return [...new Set(S.shows.filter(s => new Date(s.start) >= t0).map(s => dayKey(s.start)))].sort((a, b) => new Date(a) - new Date(b)); };
function timeChip(s) {
  const left = freeSeats(s), past = new Date(s.start) <= new Date(), full = left === 0, r = room(s.roomId);
  const sub = past ? "Đã chiếu" : full ? "Hết ghế" : left <= 10 ? `Còn ${left} ghế` : `${r.name.replace(" · ", " ")}`;
  return `<button type="button" data-act="pick-show" data-show="${s.id}" ${past || full ? "disabled" : ""} class="group grid h-[54px] min-w-[84px] cursor-pointer content-center rounded-xl border px-3 text-left transition-colors disabled:cursor-not-allowed ${past || full ? "border-border bg-background text-muted" : "border-border-strong bg-surface hover:border-primary hover:bg-primary-light"}"><span class="text-base font-semibold tabular-nums leading-tight ${past || full ? "line-through decoration-1" : "group-hover:text-primary"}">${hhmm(s.start)}</span><span class="text-[11px] ${!past && !full && left <= 10 ? "font-medium text-warning" : "text-muted"}">${sub}</span></button>`;
}
/** Nhóm suất theo phòng/định dạng của một rạp: [["2D Phụ đề", [suất…]], ["3D Phụ đề", [...]]] */
const byFormat = ss => { const m = new Map(); ss.forEach(s => { const k = formatOf(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); }); return [...m]; };
const fmtTag = k => `<span class="inline-flex h-6 shrink-0 items-center rounded-md bg-secondary px-1.5 text-xs font-medium">${esc(k)}</span>`;
/** Dãy suất của một phim tại một rạp trong ngày: ẩn suất đã chiếu khi vẫn còn suất tới, nhóm theo định dạng */
function showRow(ss) {
  const now = new Date(), coming = ss.filter(s => new Date(s.start) > now), list = coming.length ? coming : ss;
  const hidden = ss.length - list.length;
  return `<div class="grid gap-2">${byFormat(list).map(([k, l]) => `<div class="flex flex-wrap items-center gap-2">${fmtTag(k)}${l.map(timeChip).join("")}</div>`).join("")}${hidden ? `<p class="text-xs text-muted">${hidden} suất trước đó đã chiếu.</p>` : ""}${!coming.length ? `<p class="text-xs text-muted">Hôm nay đã hết suất, chọn ngày khác.</p>` : ""}</div>`;
}
/** Hàng phim trong lịch theo rạp */
function filmRow(f, ss) {
  const m = typeof fmeta === "function" ? fmeta(f) : {};
  return `<article class="grid grid-cols-[72px_minmax(0,1fr)] gap-4 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-[96px_minmax(0,1fr)] sm:p-5">
    <button type="button" data-act="film-detail" data-v="${f.id}" class="group relative block h-[108px] w-[72px] cursor-pointer overflow-hidden rounded-xl bg-secondary sm:h-36 sm:w-24" aria-label="Chi tiết ${esc(f.title)}">${poster(f, "size-full transition-transform duration-300 group-hover:scale-105")}</button>
    <div class="min-w-0">
      <div class="flex flex-wrap items-start gap-x-3 gap-y-1"><h2 class="min-w-0 text-base font-semibold leading-snug sm:text-lg"><button type="button" data-act="film-detail" data-v="${f.id}" class="cursor-pointer text-left hover:text-primary">${esc(f.title)}</button></h2>${rate(f.rating)}${m.hot ? badge("Hot", "bg-primary text-primary-foreground") : ""}</div>
      <p class="mt-0.5 text-sm text-muted">${esc(f.genre)} · ${f.dur} phút${m.desc ? ` · <span class="hidden sm:inline">${esc(m.desc.length > 90 ? m.desc.slice(0, 88).replace(/\s\S*$/, "") + "…" : m.desc)}</span>` : ""}</p>
      <div class="mt-3">${showRow(ss)}</div>
    </div></article>`;
}
function vLich() {
  const days = showDays(), today = dayKey(new Date());
  const cur = days.includes(S.view.day) ? S.view.day : (days.includes(today) ? today : days[0]);
  const now = new Date(), mode = S.view.lichMode === "phim" ? "phim" : "rap", c = curCinema();
  const tabs = seg([["rap", "Theo rạp", "map-pin"], ["phim", "Theo phim", "clapperboard"]], mode, "lich-mode");
  const head = pageHead("Lịch chiếu", `${days.length} ngày tới · ${WEEKDAY[now.getDay()]}, ${dmy(now)} · bây giờ ${hhmm(now)}`, tabs);
  const loading = !S.shows.length && Remote.status === "connecting", lq = (S.view.lichQ || "").trim().toLowerCase();
  const matchFilm = f => !lq || [f.title, f.genre, f.rating].some(x => (x || "").toLowerCase().includes(lq));
  // thanh lọc dính: rạp · ngày · tìm kiếm
  const bar = (left, search = true) => `<div class="glass sticky top-[4.25rem] z-20 -mx-4 mb-5 grid grid-cols-[minmax(0,1fr)] gap-3 px-4 py-3 sm:mx-0 sm:rounded-2xl sm:px-4 ${search ? "lg:grid-cols-[auto_minmax(0,1fr)_260px]" : "lg:grid-cols-[auto_minmax(0,1fr)]"} lg:items-center">${left}${dateStrip(days, cur, "lich-day")}${search ? searchBox("lich-q", "Tìm phim theo tên, thể loại, nhãn tuổi…", S.view.lichQ, "w-full") : ""}</div>`;
  let body;
  if (mode === "rap") {
    // Theo rạp: chọn rạp (nhớ trên máy) → ngày → phim → suất theo định dạng
    const left = `<div class="flex items-center gap-2 rounded-xl border border-border-strong bg-surface p-1 pr-2">${cinemaButton("min-w-[200px] max-w-[260px]")}<button type="button" class="${B.ghost} min-h-8 px-2 text-xs" data-act="cinema-pick">${ic("arrow-left-right", "size-3.5")}Đổi</button></div>`;
    let list;
    if (loading) list = `<div class="grid gap-3">${skelRows(4, "h-40")}</div>`;
    else {
      const films = S.films.filter(matchFilm).map(f => [f, showsOf(c.id).filter(s => s.filmId === f.id && dayKey(s.start) === cur).sort((a, b) => new Date(a.start) - new Date(b.start))]).filter(x => x[1].length);
      // phim còn suất tới xếp trước, phim đã chiếu hết trong ngày xuống cuối
      films.sort((a, b) => (b[1].some(s => new Date(s.start) > now) ? 1 : 0) - (a[1].some(s => new Date(s.start) > now) ? 1 : 0));
      list = !films.length ? card(lq ? emptyState("search-x", "Không có phim khớp", "Thử từ khoá khác hoặc xoá tìm kiếm.") : emptyState("calendar-x", "Chưa có suất chiếu ngày này", `${esc(c.name)} chưa lên lịch cho ngày đã chọn. Xem ngày khác, hoặc đổi sang rạp khác.`, `<button class="${B.outline}" data-act="cinema-pick">Đổi rạp</button>`))
        : `<p class="mb-3 text-sm text-muted">${films.length} phim · ${films.reduce((n, x) => n + x[1].length, 0)} suất tại <b class="text-foreground">${esc(c.name)}</b> ${dayLabel(cur).toLowerCase()} · ${esc(c.address)}</p><div class="grid gap-3">${films.map(([f, ss]) => filmRow(f, ss)).join("")}</div>`;
    }
    const soon = typeof comingSoon === "function" ? comingSoon().filter(matchFilm).slice(0, 10) : [];
    const soonBlock = soon.length && !lq ? `<section class="mt-8">${h2("Sắp chiếu", `<button type="button" data-act="soon-all" class="cursor-pointer text-sm text-muted hover:text-foreground">Xem tất cả</button>`)}${hscroll(soon.map(f => `<button type="button" data-act="film-detail" data-v="${f.id}" class="w-[120px] shrink-0 cursor-pointer text-left"><span class="relative block aspect-[2/3] overflow-hidden rounded-xl bg-secondary">${poster(f, "size-full")}<span class="absolute bottom-1.5 left-1.5 rounded-md bg-foreground/80 px-1.5 py-0.5 text-[10px] font-medium text-surface">${f.release ? "Khởi chiếu " + ddmm(new Date(f.release)) : "Sắp chiếu"}</span></span><span class="mt-1.5 block h-[34px] line-clamp-2 text-xs font-medium leading-snug">${esc(f.title)}</span></button>`).join(""), "strip-posters")}</section>` : "";
    body = head + bar(left) + list + soonBlock;
  } else {
    // Theo phim: chọn phim → ngày → tỉnh/thành → từng rạp (kể cả nhiều cơ sở cùng thành phố) → suất
    const filmsQ = S.films.filter(matchFilm).filter(f => S.shows.some(s => s.filmId === f.id && s.status !== "cancelled" && new Date(s.start) > now)), fid = filmsQ.some(f => f.id === S.view.lichFilm) ? S.view.lichFilm : (filmsQ[0] || S.films[0]).id, f = film(fid), m = typeof fmeta === "function" ? fmeta(f) : {};
    const filmRowHtml = `<div class="mb-4 grid gap-3">${searchBox("lich-q", "Tìm phim theo tên, thể loại, nhãn tuổi…", S.view.lichQ, "w-full sm:max-w-[380px]")}${hscroll(filmsQ.map(x => `<button type="button" data-act="lich-film" data-v="${x.id}" aria-pressed="${x.id === fid}" class="group w-[104px] shrink-0 cursor-pointer text-left"><span class="relative block aspect-[2/3] overflow-hidden rounded-xl bg-secondary transition-all ${x.id === fid ? "ring-2 ring-inset ring-primary" : "opacity-80 group-hover:opacity-100"}">${poster(x, "size-full")}<span class="absolute left-1.5 top-1.5">${rate(x.rating)}</span></span><span class="mt-1.5 block h-[34px] line-clamp-2 text-xs leading-snug ${x.id === fid ? "font-semibold" : "text-foreground/80"}">${esc(x.title)}</span></button>`).join(""), "strip-posters")}</div>`;
    const banner2 = `<section class="relative mb-5 overflow-hidden rounded-2xl bg-foreground text-surface">${m.backdrop ? `<img src="${m.backdrop}" alt="" class="absolute inset-0 size-full object-cover opacity-35 blur-sm" loading="lazy">` : ""}
      <div class="relative flex gap-4 p-4 sm:gap-5 sm:p-5">${poster(f, "h-[120px] w-20 shrink-0 shadow-modal sm:h-[150px] sm:w-[100px]")}<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2">${rate(f.rating)}${m.hot ? badge("Hot", "bg-primary text-primary-foreground") : ""}</div><h2 class="mt-1.5 text-xl font-bold leading-tight sm:text-2xl">${esc(f.title)}</h2><p class="mt-1 text-sm text-surface/70">${esc(f.genre)} · ${f.dur} phút · ${esc(RATING_TXT[f.rating] || "")}</p>${m.desc ? `<p class="mt-2 hidden max-w-prose text-pretty text-sm text-surface/80 sm:line-clamp-2">${esc(m.desc)}</p>` : ""}<div class="mt-3 flex gap-2"><button type="button" class="${BTN} min-h-9 border border-white/30 bg-white/10 text-surface hover:bg-white/20" data-act="film-detail" data-v="${f.id}">${ic("info")}Chi tiết</button></div></div></div></section>`;
    const ss = S.shows.filter(s => s.status !== "cancelled" && s.filmId === fid && dayKey(s.start) === cur);
    const cityList = cities().filter(ct => ss.some(s => cinemaOf(s).city === ct));
    const city = cityList.includes(S.view.lichCity) ? S.view.lichCity : (cityList.includes(c.city) ? c.city : cityList[0]);
    const cityRow = cityList.length ? `<div class="mb-3 flex flex-wrap gap-2">${cityList.map(ct => `<button type="button" data-act="lich-city" data-v="${esc(ct)}" aria-pressed="${ct === city}" class="h-9 cursor-pointer rounded-full border px-3 text-sm transition-colors ${ct === city ? "border-foreground bg-foreground text-surface" : "border-border-strong bg-surface hover:bg-button-hover"}">${esc(ct)} <span class="${ct === city ? "text-surface/70" : "text-muted"}">${cinemasIn(ct).filter(x => ss.some(s => cinemaOf(s).id === x.id)).length}</span></button>`).join("")}</div>` : "";
    let list;
    if (loading) list = `<div class="grid gap-3">${skelRows(3, "h-28")}</div>`;
    else if (!ss.length) list = card(emptyState("calendar-x", "Không rạp nào chiếu phim này trong ngày", "Chọn ngày khác hoặc phim khác."));
    else list = `<div class="grid gap-3">${cinemasIn(city).map(x => [x, ss.filter(s => cinemaOf(s).id === x.id).sort((a, b) => new Date(a.start) - new Date(b.start))]).filter(z => z[1].length).map(([x, l]) => `<article class="rounded-2xl border bg-surface p-4 sm:p-5 ${x.id === c.id ? "border-primary/60" : "border-border"}">
        <div class="flex flex-wrap items-start gap-2"><span class="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary font-mono text-xs">${x.id}</span><div class="min-w-0 flex-1"><h2 class="text-base font-semibold">${esc(x.name)}${x.id === c.id ? ` <span class="text-xs font-normal text-primary">· rạp đang chọn</span>` : ""}</h2><p class="text-xs text-muted">${esc(x.district)} · ${esc(x.address)}</p></div>${x.id === c.id ? "" : `<button type="button" class="${B.ghost} min-h-8 px-2 text-xs" data-act="cinema-set" data-v="${x.id}">Chọn rạp này</button>`}</div>
        <div class="mt-3 sm:pl-[3.25rem]">${showRow(l)}</div></article>`).join("")}</div>`;
    const left = `<button type="button" class="${B.outline} min-h-10 justify-start gap-2 px-3" data-act="lich-mode" data-v="rap">${ic("map-pin", "size-4 text-muted")}<span class="truncate">Xem theo rạp</span></button>`;
    // không phim nào khớp từ khoá: chỉ ô tìm + trạng thái rỗng (không hiện phim đầu tiên như thể khớp)
    if (!filmsQ.length) { body = head + `<div class="mb-4">${searchBox("lich-q", "Tìm phim theo tên, thể loại, nhãn tuổi…", S.view.lichQ, "w-full sm:max-w-[380px]")}</div>` + card(emptyState("search-x", "Không có phim đang chiếu khớp", `Không tìm thấy phim nào cho “${esc(S.view.lichQ)}”. Thử từ khoá khác, hoặc xem phim sắp chiếu ở trang chủ.`, `<button type="button" class="${B.outline}" data-act="search-clear" data-id="lich-q">${ic("x")}Xoá tìm kiếm</button><a href="#/home" data-act="home-tab" data-v="sapchieu" class="${B.ghost}">Phim sắp chiếu</a>`)); return customerShell("lich", body, { footer: true }); }
    body = head + filmRowHtml + banner2 + bar(left, false) + `<div class="mb-2 flex items-center gap-2 text-sm text-muted">Suất chiếu <b class="text-foreground">${dayLabel(cur).toLowerCase()}</b></div>` + cityRow + list;
  }
  return customerShell("lich", body, { footer: true });
}
/** Bảng chọn rạp: Tỉnh/Thành → các cơ sở (Nghệ An có 2 cơ sở cùng TP Vinh). */
function cinemaSheetHtml(city) {
  const c = curCinema(), ct = cities().includes(city) ? city : c.city;
  return `${sheetHead("Chọn rạp", "Tỉnh/Thành → Rạp. Lịch, giá vé và vé của bạn hiện theo rạp đã chọn.")}
    <div class="mb-3 flex flex-wrap gap-2">${cities().map(x => `<button type="button" data-act="cinema-city" data-v="${esc(x)}" aria-pressed="${x === ct}" class="h-9 cursor-pointer rounded-full border px-3 text-sm ${x === ct ? "border-foreground bg-foreground text-surface" : "border-border-strong bg-surface hover:bg-button-hover"}">${esc(x)} <span class="${x === ct ? "text-surface/70" : "text-muted"}">${cinemasIn(x).length}</span></button>`).join("")}</div>
    <div class="grid gap-2">${cinemasIn(ct).map(x => `<button type="button" data-act="cinema-set" data-v="${x.id}" aria-pressed="${x.id === c.id}" class="flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left ${x.id === c.id ? "border-foreground" : "border-border hover:bg-surface-hover"}"><span class="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary font-mono text-xs">${x.id}</span><span class="min-w-0 flex-1"><span class="block font-medium">${esc(x.name)}</span><span class="block text-xs text-muted">${esc(x.district)} · ${esc(x.address)}</span><span class="mt-1 block text-xs text-muted">${roomsOf(x.id).length} phòng · ${roomsOf(x.id).map(r => r.kind).filter((v, i, a) => a.indexOf(v) === i).join(", ")} · giá từ ${vnd(PRICE_TIERS[x.tier].weekday.u22)}</span></span>${x.id === c.id ? ic("check", "size-4 shrink-0 mt-1") : ""}</button>`).join("")}</div>`;
}

/* ---------- Chọn ghế ---------- */
/** opts.mine: ghế khách này đã mua (Set) · opts.inspect: nhân viên bấm ghế đã bán / đang giữ để tra cứu */
function seatMap(sh, selected, act, opts = {}) {
  const r = room(sh.roomId), aisles = aisleAfter(r), mine = opts.mine || new Set(), groups = seatGroups(r);
  const Lr = roomLayout(r);
  let h = `<div data-seat-wrap><div class="seat-zoom-outer" data-seat-zoom data-zoom-key="${esc(sh.id)}|${act}"><div class="seat-zoom-inner mx-auto grid w-max gap-1.5" data-seat-zoom-inner>${screenBarHtml(r, { seat: 36, gap: 6, aisle: 12, cls: "mb-3", label: `Màn hình · ${Lr.screen.width} m${Lr.screen.curveRadius ? " · cong" : ""}` })}`;
  for (let i = 0; i < r.rows; i++) {
    const L = String.fromCharCode(65 + i);
    h += `<div class="flex items-center gap-1.5 [--seat:2.25rem] [--gap:0.375rem]"><span class="w-4 text-center text-xs text-muted">${L}</span>`;
    for (let j = 0; j < r.cols; j++) {
      const sid = seatId(i, j), grp = groups.get(sid);
      if (grp && grp[0] !== sid) continue;   // ghế thành viên sau của ghế nhóm: đã vẽ chung với ghế đầu
      const members = grp || [sid], n = members.length, kind = seatKind(r, sid), ty = seatType(kind), special = kind !== "std", label = n > 1 ? `${members[0]}–${members[n - 1]}` : sid;
      const sts = members.map(m => seatState(sh.id, m)), pick = members.every(m => selected.includes(m));
      // ghế đã bán/giữ/của bạn giữ nguyên trạng thái dù sau đó bị đánh dấu bảo trì (vé vẫn còn hiệu lực)
      const own = members.every(m => mine.has(m)), sold = sts.some(x => x && x.st === "sold") && !own, held = sts.some(x => x && x.st === "held") && !pick, blk = !ty.sellable && !own && !sold && !held;
      const look = opts.inspect && !blk && (sold || held || own);
      const cls = blk ? "bg-background text-muted/40 border-border border-dashed cursor-not-allowed" : own ? "bg-success-bg text-success border-success/50" : pick ? "bg-primary text-primary-foreground border-primary" : sold ? "bg-secondary text-muted/60 border-secondary" : held ? "bg-background text-muted border-dashed border-muted/50" : seatColor(ty, "seat");
      const lastCol = j + n - 1, aisle = aisles.has(lastCol) ? '<span class="w-3"></span>' : "";
      // luôn hiện tên ghế (A1, B12…) như app CGV; ghế VIP phân biệt bằng màu + vương miện nhỏ ở góc
      const rateDot = !blk && !own && !sold && !held && !pick && typeof Seat3D !== "undefined" ? (() => { const q = Seat3D.rate(r, sid, Seat3D.PRIO[S.view.seatPriority] ? S.view.seatPriority : "balanced"); return q ? `<i class="seat-rate seat-rate-${q.level}" title="${q.text}"></i>` : ""; })() : "";
      const inner = (blk ? ic(ty.icon || "ban", "size-3") : own ? ic("check", "size-3.5") : sold ? ic("x", "size-3") : n > 1 ? `<span class="flex items-center gap-1 text-[10px]">${ty.icon && !pick ? ic(ty.icon, "size-3") : ""}${label}</span>` : `<span class="text-[10px] font-medium leading-none">${sid}</span>${special && ty.icon && !pick ? `<span class="absolute right-0.5 top-0.5 opacity-70">${ic(ty.icon, "size-2.5")}</span>` : ""}`) + rateDot;
      // ghế không bán (bảo trì…): không disabled để bấm vào vẫn nhận được thông báo
      h += `<button type="button" data-act="${blk ? "seat-blocked" : look ? "seat-info" : act}" data-seat="${sid}" ${n > 1 ? `data-group="${members.join(",")}"` : ""} ${!blk && (sold || held || own) && !look ? "disabled" : ""} aria-pressed="${pick}" ${blk ? 'aria-disabled="true"' : ""} ${n > 1 ? `style="width:calc(${n} * var(--seat) + ${n - 1} * var(--gap))"` : ""} title="Ghế ${label} · ${esc(ty.name)}${n > 1 ? ` (${n} chỗ, chọn là lấy cả ${n} ghế)` : ""}${blk ? " – không chọn được" : ""}" aria-label="Ghế ${label}${special ? " " + esc(ty.name) : ""}${n > 1 ? `, ${n} chỗ` : ""}${blk ? ", không bán – không chọn được" : own ? ", ghế của bạn (đã mua)" : sold ? ", đã bán" : held ? ", người khác đang giữ" : ""}${look ? " – bấm để xem" : ""}" class="relative grid size-9 cursor-pointer place-items-center rounded-md border text-xs tabular-nums disabled:cursor-not-allowed ${cls} ${look ? "hover:ring-2 hover:ring-focus" : ""}">${inner}</button>${aisle}`;
      j = lastCol;
    }
    h += `</div>`;
  }
  return h + `</div></div><div class="mt-2 flex items-center justify-center gap-1 text-xs text-muted"><button type="button" class="${B.icon} size-8" data-act="seat-zoom" data-v="out" aria-label="Thu nhỏ">${ic("minus")}</button><button type="button" class="min-w-[52px] cursor-pointer rounded-lg px-2 py-1 tabular-nums hover:bg-item-hover" data-act="seat-zoom" data-v="fit" title="Vừa khung"><span data-seat-zoom-pct>100%</span></button><button type="button" class="${B.icon} size-8" data-act="seat-zoom" data-v="in" aria-label="Phóng to">${ic("plus")}</button><span class="ml-2 hidden sm:inline">Lăn chuột giữ Ctrl để phóng · giữ chuột kéo để rê sang ghế khuất</span><span class="ml-2 sm:hidden">Chụm hai ngón để phóng</span></div><div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted sm:flex sm:flex-wrap sm:justify-center sm:gap-x-5">
    ${priceLegend(sh).types.filter(t => t.sellable).map(t => `<span class="flex items-center gap-1.5"><i class="grid size-4 place-items-center rounded border ${seatColor(t, "dot")}">${t.icon ? ic(t.icon, "size-2.5") : ""}</i>${esc(t.name)}${t.unitSize > 1 ? ` (${t.unitSize} ghế)` : t.persons > 1 ? ` (${t.persons} người)` : ""} ${vnd(t.price)}</span>`).join("")}
    <span class="flex items-center gap-1.5"><i class="size-4 rounded bg-primary"></i>Bạn chọn</span>
    <span class="flex items-center gap-1.5"><i class="seat-rate seat-rate-great !static"></i>Nhìn rất tốt</span><span class="flex items-center gap-1.5"><i class="seat-rate seat-rate-good !static"></i>Tốt</span><span class="flex items-center gap-1.5"><i class="seat-rate seat-rate-less !static"></i>Kém</span>
    <span class="flex items-center gap-1.5"><i class="size-4 rounded bg-secondary"></i>Đã bán</span>
    ${priceLegend(sh).types.filter(t => !t.sellable).map(t => `<span class="flex items-center gap-1.5"><i class="size-4 rounded border border-dashed border-border bg-background"></i>${esc(t.name)} (${t.n})</span>`).join("")}
    ${mine.size ? `<span class="flex items-center gap-1.5"><i class="size-4 rounded border border-success/50 bg-success-bg"></i>Ghế của bạn</span>` : ""}</div>
    ${opts.inspect ? `<p class="mt-3 text-center text-xs text-muted">Bấm ghế đã bán hoặc đang giữ để xem vé, người mua, đã vào phòng chưa.</p>` : ""}</div>`;
}
function orderSummary(sh, seats, withNote = true) {
  const f = film(sh.filmId), r = room(sh.roomId), total = seats.reduce((a, s) => a + seatPrice(sh, s), 0);
  const byType = {}; seats.forEach(s => { const k = seatKind(r, s); if (k !== "std") byType[k] = (byType[k] || 0) + 1; });
  const typeTxt = Object.entries(byType).map(([k, n]) => `${n} ${seatType(k).name}`).join(" · ");
  return `<div class="grid gap-3">
    <div class="flex items-center justify-between gap-3 text-sm"><span class="text-muted">Ghế</span><span class="text-right font-medium">${seats.length ? esc(seats.join(", ")) + (typeTxt ? ` · ${esc(typeTxt)}` : "") : "Chưa chọn"}</span></div>
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
    ${myTickets().some(t => t.showId === sh.id && t.status !== "refunded") ? `<div class="mb-4">${banner("info", "", `Bạn đã có vé suất này: ghế <b>${esc(myTickets().filter(t => t.showId === sh.id && t.status !== "refunded").map(t => t.seat).join(", "))}</b> (hiện màu xanh). Chọn thêm nếu muốn mua thêm vé.`, `<a href="#/ve" class="${B.outline} shrink-0">Xem vé</a>`)}</div>` : ""}
    <div class="mb-4 flex items-center gap-3">${poster(f, "h-16 w-11 shrink-0")}<div class="min-w-0"><div class="flex items-center gap-2"><h1 class="truncate text-xl font-semibold">${esc(f.title)}</h1>${rate(f.rating)}</div><p class="text-sm text-muted">${showLine(sh)}</p></div></div>`;
  const map = freeSeats(sh) === 0 && !d.seats.length ? card(emptyState("armchair", "Suất này đã hết ghế", "Tất cả ghế đã bán. Chọn suất khác cùng phim.", `<button class="${B.outline}" data-act="cancel-draft">Chọn suất khác</button>`)) : card(seatMap(sh, d.seats, "toggle-seat", { mine: new Set(myTickets().filter(t => t.showId === sh.id && t.status !== "refunded").map(t => t.seat)) }), "!p-3 sm:!p-5 !rounded-t-none !border-t-0");
  const go = `<button type="button" class="${B.primary} mt-1 w-full" data-act="to-checkout" ${d.seats.length ? "" : "disabled"}>Tiếp tục thanh toán</button>`;
  const total = d.seats.reduce((a, s) => a + seatPrice(sh, s), 0);
  // phòng chiếu 3D (three.js, nghiệp vụ rạp ảo): sơ đồ 2D | phòng 3D; ở 2D vẫn có khung "góc nhìn từ ghế" bên phải (dưới sơ đồ trên điện thoại)
  const r = room(sh.roomId), view = S.view.seatView === "3d" ? "3d" : "2d", s3mode = ["overview", "arrive"].includes(S.view.seat3dMode) ? S.view.seat3dMode : "seat", prio = Seat3D.PRIO[S.view.seatPriority] ? S.view.seatPriority : "balanced";
  const focus = d.seats[d.seats.length - 1], rt = focus ? Seat3D.rate(r, focus, prio) : null;
  const LV = { great: ["Rất tốt", "bg-success-bg text-success"], good: ["Tốt", "bg-[#dbeafe] text-[#1d4ed8]"], less: ["Kém", "bg-warning-bg text-warning"] };
  const lvBadge = l => `<span class="rounded-md px-2 py-0.5 text-xs font-medium ${LV[l][1]}">${LV[l][0]}</span>`;
  const viewHead = `<div class="mb-3 flex flex-wrap items-center justify-between gap-2"><p class="text-sm text-muted">${esc(r.name)} · ${r.rows} hàng × ${r.cols} ghế</p>${seg([["2d", "Sơ đồ 2D", "layout-grid"], ["3d", "Phòng 3D", "box"]], view, "seat-view")}</div>`;
  const modeSeg = seg([["seat", "Từ ghế", "eye"], ["overview", "Đứng dậy", "person-standing"], ["arrive", "Đi tới ghế", "footprints"]], s3mode, "seat3d-mode");
  const prioSeg = seg(Object.entries(Seat3D.PRIO).map(([k, v]) => [k, v.label]), prio, "seat-priority");
  const bestBtn = cls => `<button type="button" class="${cls}" data-act="seat-best">${ic("sparkles", "size-3.5 text-warning")}Chọn ghế tốt nhất</button>`;
  // bảng số đo như rạp ảo: khoảng cách, góc ngang, góc dọc, màn hình trong tầm nhìn, immersion, điểm hình học + ưu / nhược
  const tile = (l, v, id) => `<div class="rounded-lg border border-border bg-background px-3 py-2"><p class="text-[10px] font-medium uppercase tracking-wider text-muted">${l}</p><p class="mt-0.5 font-mono text-sm" data-seat-metric="${id}">${v}</p></div>`;
  const metricsHtml = rt ? `<div class="mt-3 flex flex-wrap items-center justify-between gap-2"><div><p class="text-[10px] font-medium uppercase tracking-wider text-muted">Ghế đang chọn</p><p class="text-lg font-semibold">Hàng ${rt.seat.row} · Ghế ${rt.seat.number}</p></div>${lvBadge(rt.level)}</div>
      <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">${tile("Khoảng cách", rt.metrics.distance.toFixed(1) + " m", "distance")}${tile("Góc ngang", (rt.metrics.hAngle >= 0 ? "+" : "") + rt.metrics.hAngle.toFixed(1) + "°", "h-angle")}${tile("Góc dọc", (rt.metrics.vAngle >= 0 ? "↑ " : "↓ ") + Math.abs(rt.metrics.vAngle).toFixed(1) + "°", "v-angle")}${tile("Màn hình trong tầm nhìn", rt.metrics.hFov.toFixed(0) + "° (mục tiêu " + rt.metrics.target + "°)", "fov")}${tile("Immersion", rt.metrics.immersion + "% của 120°", "immersion")}${tile("Điểm hình học", rt.score100 + " / 100", "score")}</div>
      ${rt.pros.length || rt.cons.length ? `<ul class="mt-2 grid gap-1 text-xs">${rt.pros.map(x => `<li class="flex gap-2 text-foreground">${ic("check", "mt-0.5 size-3.5 shrink-0 text-success")}${esc(x)}</li>`).join("")}${rt.cons.map(x => `<li class="flex gap-2 text-muted">${ic("circle-alert", "mt-0.5 size-3.5 shrink-0 text-warning")}${esc(x)}</li>`).join("")}</ul>` : ""}
      <p class="mt-2 text-[10px] text-muted">Tính từ vị trí mắt của ghế (${rt.seat.eye.map(v => v.toFixed(2)).join(", ")} m) so với tâm và các cạnh màn hình của phòng này.</p>` : `<p class="mt-3 text-sm text-muted">Chọn một ghế để xem khoảng cách, góc nhìn và điểm hình học.</p>`;
  const stage3d = `<div class="relative aspect-[4/3] overflow-hidden rounded-xl bg-black sm:aspect-[16/9]" data-seat3d>
      <div class="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2"><div class="pointer-events-auto">${modeSeg}</div>${bestBtn(`pointer-events-auto ${BTN} min-h-9 border border-white/30 bg-white/10 px-3 text-white backdrop-blur hover:bg-white/20`)}</div>
      <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-end justify-between gap-2 p-2 text-[11px] text-white/70"><span class="hidden sm:inline">${s3mode === "arrive" ? `${d.seats.length ? `${d.seats.length} người vào từ cửa trước, leo bậc tới ghế ${esc(d.seats.join(", "))} rồi ngồi` : "Chọn ghế để xem người đi tới ghế"}` : s3mode === "overview" ? "Kéo để xoay quanh bạn · lăn chuột để lùi / tiến · bấm ghế để chọn" : "Kéo để nhìn quanh · bấm đúp để nhìn thẳng màn hình"}</span>${s3mode === "arrive" && d.seats.length ? `<button type="button" class="pointer-events-auto ${BTN} min-h-8 border border-white/30 bg-white/10 px-2.5 text-white backdrop-blur hover:bg-white/20" data-act="seat3d-replay">${ic("rotate-ccw", "size-3.5")}Phát lại</button>` : ""}${focus ? `<span class="rounded-md bg-black/60 px-2 py-1 text-white">${esc(focus)} · ${esc(rt.text)} · ${rt.score100}/100</span>` : `<span>Chọn ghế để xem góc nhìn</span>`}</div></div>
    <div class="mt-3 flex flex-wrap items-center gap-2"><span class="text-xs text-muted">Ưu tiên</span>${prioSeg}<button type="button" class="${B.primary} ml-auto min-h-10 px-4" data-act="enter-theatre">${ic("clapperboard")}Vào rạp${focus ? ` · ${esc(focus)}` : ""}</button></div>
    <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"><span class="flex items-center gap-1.5"><i class="size-3 rounded-sm" style="background:#e3343c"></i>Bạn chọn</span><span class="flex items-center gap-1.5"><i class="size-3 rounded-sm" style="background:#7a1f24"></i>Trống</span><span class="flex items-center gap-1.5"><i class="size-3 rounded-sm" style="background:#8a5a16"></i>VIP</span><span class="flex items-center gap-1.5"><i class="size-3 rounded-sm" style="background:#8c2460"></i>Ghế đôi</span><span class="flex items-center gap-1.5"><i class="size-3 rounded-sm" style="background:#3d2a2c"></i>Đã bán (có người ngồi)</span><span class="flex items-center gap-1.5"><i class="size-3 rounded-sm" style="background:#1f7a3a"></i>Ghế của bạn</span></div>
    ${metricsHtml}`;
  const preview = card(`<div class="mb-2 flex items-center justify-between gap-2"><h2 class="whitespace-nowrap text-sm font-semibold">Góc nhìn từ ghế</h2>${seg([["seat", "Ghế", "eye"], ["overview", "Đứng", "person-standing"], ["arrive", "Đi tới", "footprints"]], s3mode, "seat3d-mode")}</div>
      <div class="relative aspect-[16/10] overflow-hidden rounded-xl bg-black" data-seat3d data-compact></div>
      ${rt ? `<div class="mt-2 flex items-center justify-between gap-2"><p class="text-sm"><b>${esc(focus)}</b> · điểm <b class="font-mono">${rt.score100}</b>/100</p>${lvBadge(rt.level)}</div><p class="mt-1 text-xs text-muted">${rt.metrics.distance.toFixed(1)} m · ngang ${(rt.metrics.hAngle >= 0 ? "+" : "") + rt.metrics.hAngle.toFixed(0)}° · dọc ${(rt.metrics.vAngle >= 0 ? "↑" : "↓")}${Math.abs(rt.metrics.vAngle).toFixed(0)}° · màn ${rt.metrics.hFov.toFixed(0)}°${rt.cons[0] ? ` · ${esc(rt.cons[0])}` : rt.pros[0] ? ` · ${esc(rt.pros[0])}` : ""}</p>` : `<p class="mt-2 text-pretty text-xs text-muted">Chọn ghế trên sơ đồ, khung này hiện cảnh nhìn từ ghế đó tới màn hình kèm điểm góc nhìn.</p>`}
      <div class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2"><span class="text-[11px] text-muted">Ưu tiên</span>${selectBox("seat-priority", Object.entries(Seat3D.PRIO).map(([k, v]) => [k, v.label]), prio, { act: "seat-priority" })}</div>
      <div class="mt-2 flex flex-wrap gap-2">${bestBtn(`${B.outline} min-h-8 px-2.5 text-xs`)}<button type="button" class="${B.outline} min-h-8 px-2.5 text-xs" data-act="seat-view" data-v="3d">${ic("box", "size-3.5")}Mở phòng 3D</button><button type="button" class="${B.primary} min-h-8 px-2.5 text-xs" data-act="enter-theatre">${ic("clapperboard", "size-3.5")}Vào rạp</button></div>`);
  const body = head + `<div class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"><div class="min-w-0">${card(viewHead + (view === "3d" ? stage3d : ""), view === "3d" ? "" : "!pb-0 !border-b-0 !rounded-b-none")}${view === "3d" ? "" : map}</div>
    <aside class="hidden min-w-0 lg:block"><div class="sticky top-20 grid min-w-0 gap-4">${card(`<h2 class="mb-3 text-base font-semibold">Đơn của bạn</h2>${orderSummary(sh, d.seats)}<div class="mt-3">${go}</div>`)}${view === "2d" ? preview : ""}</div></aside>
    ${view === "2d" ? `<div class="min-w-0 lg:hidden">${preview}</div>` : ""}</div>
    <div class="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom))] lg:hidden"><div class="mx-auto flex max-w-[1200px] items-center gap-3"><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">${d.seats.length ? esc(d.seats.join(", ")) + " · " + vnd(total) : "Chọn ghế trên sơ đồ"}</p><p class="text-xs text-muted">${d.until ? `Giữ ghế <span data-hold-timer>--:--</span>` : `Tối đa ${S.params.maxTickets} ghế`}</p></div><button type="button" class="${B.primary}" data-act="to-checkout" ${d.seats.length ? "" : "disabled"}>Tiếp tục</button></div></div><div class="h-20 lg:hidden"></div>`;
  return customerShell("lich", body + (S.view.theatre ? theatreHtml(sh, f, r) : ""), { bottomNav: false });
}

/* ---------- Thanh toán ---------- */
function vThanhToan() {
  const d = S.draft; if (!d || !d.seats.length) return vGhe();
  const sh = show(d.showId), f = film(sh.filmId);
  if (!d.assign || d.assign.length !== d.seats.length) d.assign = d.seats.map((_, i) => ({ viewer: { kind: S.user.linked && i === 0 ? "self" : "other" } }));
  const chk = checkOrder(sh, d.assign); let total = 0;
  const friendPending = d.assign.some(a => a.viewer.kind === "friend" && !a.viewer.user);
  const guestMode = !Auth.user || Auth.user.guest;   // khách vãng lai: chưa có tài khoản / chưa xác thực → mọi ghế "người xem chưa xác thực"
  const opts = guestMode ? [["other", "Người xem (chưa xác thực tuổi)"]]
    : [["other", "Người đi cùng (chưa xác thực)"], ["self", `Tôi – ${S.user.name}${S.user.linked ? "" : " (chưa xác thực)"}`], ...S.dependents.map(x => ["dep:" + x.id, `Con – ${x.name} (${ageAt(x.dob, sh.start)} tuổi)`]), ...(Remote.v5 ? [["friend", "Bạn đi cùng có tài khoản CineVin…"]] : [])];
  const rows = d.seats.map((sid, i) => {
    const a = d.assign[i], r = chk.res[i], aud = audience(r.verified || r.level === "Cam kết" ? r.age : null), price = seatPrice(sh, sid, aud.key);
    if (!r.block) total += price;
    const val = a.viewer.kind === "dep" ? "dep:" + a.viewer.depId : a.viewer.kind;
    const fr = a.viewer.kind === "friend" ? (a.viewer.user
        ? `<div class="mt-2 flex items-center gap-2 rounded-xl border border-border p-2 text-sm">${avatar(a.viewer.name)}<span class="min-w-0 flex-1"><span class="block truncate font-medium">${esc(a.viewer.name)} <span class="font-mono text-xs text-muted">@${esc(a.viewer.user)}</span></span><span class="block text-xs text-muted">${a.viewer.verified ? `Đã xác thực VNeID · ${a.viewer.age} tuổi tại ngày chiếu · vé vào thẳng` : "Chưa xác thực VNeID – kiểm tra giấy tờ tại cửa"}</span></span>${a.viewer.verified ? tone("VNeID", "ok") : tone("Chưa xác thực", "warn")}<button type="button" class="${B.icon} size-8" data-act="friend-clear" data-i="${i}" aria-label="Bỏ">${ic("x")}</button></div>`
        : `<div class="mt-2 flex gap-2"><input id="friend-${i}" placeholder="Email, SĐT hoặc tên đăng nhập của bạn" autocapitalize="none" class="${INPUT}"><button type="button" class="${B.outline} min-h-11 md:min-h-10 shrink-0" data-act="friend-check" data-i="${i}">Kiểm tra</button></div><p class="mt-1 text-xs text-muted">Vé sẽ hiện trong “Vé của tôi” của bạn ấy; đã xác thực VNeID thì ở cửa không cần giấy tờ.</p>`) : "";
    return `<div class="grid gap-2 border-b border-border py-3 last:border-0 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
      <span class="font-mono text-sm font-medium">${sid}</span>
      <div class="min-w-0">${selectBox("viewer-" + i, opts, val, { act: "assign", extra: `data-i="${i}"` })}${fr}<p class="mt-1 text-xs ${r.block ? "text-[var(--error-text)]" : "text-muted"}">${a.viewer.kind === "friend" && !a.viewer.user ? "Nhập tài khoản của bạn đi cùng rồi bấm Kiểm tra." : r.block ? esc(r.reason) : r.needDoc ? esc(r.reason) : r.verified ? `Đã xác thực · ${aud.label}` : aud.label}</p></div>
      <span class="text-right text-sm tabular-nums ${r.block ? "text-muted line-through" : ""}">${vnd(price)}</span></div>`;
  }).join("");
  d.gross = total;
  const v = d.voucher, disc = v ? (v.kind === "gift" ? Math.min(Number(v.amount), total) : Math.round(total * v.percent / 100)) : 0;
  const maxPts = Math.min(S.user.points || 0, Math.floor(Math.max(0, total - disc) / 1000)), usePts = Math.min(d.points || 0, maxPts);
  d.discount = disc; d.points = usePts; d.total = Math.max(0, total - disc - usePts * 1000);
  const promo = Remote.v5 && Auth.user && !Auth.user.guest ? `<div class="mt-4 grid gap-2 border-t border-border pt-4">
          ${v ? `<div class="flex items-center justify-between gap-2 text-sm"><span class="flex items-center gap-2">${ic("ticket-percent", "size-4 text-success")}<span><b class="font-mono">${esc(v.code)}</b> · ${v.kind === "gift" ? "thẻ quà tặng" : "giảm " + v.percent + "%"}</span></span><span class="flex items-center gap-2 tabular-nums text-success">−${vnd(disc)}<button type="button" class="${B.icon} size-8" data-act="voucher-clear" aria-label="Bỏ mã">${ic("x")}</button></span></div>`
             : `<div class="flex gap-2"><input id="voucher" placeholder="Mã giảm giá / thẻ quà tặng" autocapitalize="characters" class="${INPUT} font-mono uppercase"><button type="button" class="${B.outline} min-h-11 md:min-h-10 shrink-0" data-act="voucher-apply">Áp dụng</button></div>`}
          <div class="flex items-center justify-between gap-2 text-sm"><span>Điểm thưởng <span class="text-muted">(có ${S.user.points || 0} · 1 điểm = 1.000 đ)</span></span>${usePts ? `<span class="flex items-center gap-2 tabular-nums text-success">−${vnd(usePts * 1000)}<button type="button" class="${B.icon} size-8" data-act="points-use" data-v="0" aria-label="Không dùng điểm">${ic("x")}</button></span>` : `<button type="button" class="${B.ghost} min-h-8 px-2" data-act="points-use" data-v="max" ${maxPts ? "" : "disabled"}>Dùng ${maxPts} điểm</button>`}</div>
        </div>` : "";
  const min = RATINGS[f.rating];
  const age = min > 0 ? (S.user.linked
    ? `<div class="flex items-center gap-3 rounded-xl border border-border p-3"><span class="grid size-9 place-items-center rounded-lg bg-success-bg text-success">${ic("scan-face")}</span><div class="min-w-0 flex-1"><p class="text-sm font-medium">Xác minh tuổi (${f.rating})</p><p class="text-pretty text-xs text-muted">VNeID · ${esc(S.user.name)}, ${ageAt(S.user.dob, new Date())} tuổi${S.user.passkey ? ` · xác nhận chính chủ bằng ${esc(Passkey.label())} khi bấm thanh toán` : ""}</p></div>${tone("Đã xác minh", "ok")}</div>`
    : `<div class="flex items-center gap-3 rounded-xl border border-border p-3"><span class="grid size-9 place-items-center rounded-lg bg-warning-bg text-warning">${ic("scan-face")}</span><div class="min-w-0 flex-1"><p class="text-sm font-medium">Xác minh tuổi (${f.rating})</p><p class="text-pretty text-xs text-muted">Chưa liên kết VNeID – tại cửa phải xuất trình giấy tờ.</p></div>${Auth.user && !Auth.user.guest ? `<button type="button" class="${B.outline} shrink-0" data-act="vneid-self">Liên kết</button>` : ""}</div>`) : "";
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
          ${promo}
          <div class="mt-4 grid gap-1 border-t border-border pt-4">${disc || usePts ? `<div class="flex items-center justify-between text-sm text-muted"><span>Giá vé</span><span class="tabular-nums">${vnd(total)}</span></div>` : ""}<div class="flex items-center justify-between"><span class="font-medium">Tổng thanh toán</span><span class="text-lg font-semibold tabular-nums">${vnd(d.total)}</span></div></div>
          ${S.user.confirmEvery && S.user.passkey ? `<p class="mt-2 flex items-center gap-1.5 text-xs text-muted">${ic("fingerprint", "size-3.5")}Sẽ xác nhận bằng ${esc(Passkey.label())} khi bấm thanh toán.</p>` : ""}
          ${Auth.user ? `<button type="button" class="${B.primary} mt-3 w-full min-h-11 md:min-h-10" data-act="pay-ok" ${chk.ok && !friendPending ? "" : "disabled"}>Thanh toán ${vnd(d.total)}</button>
          <p class="mt-2 text-center text-xs text-muted">Cổng thanh toán mô phỏng – không trừ tiền thật.${Remote.v21 && Auth.user.email ? ` Vé gửi về <b class="text-foreground">${esc(Auth.user.email)}</b>.` : ""}</p>` : guestCheckout()}`)}
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
  // nhiều vé cùng suất (mua cho bạn bè)
  const sameShow = ts.filter(x => x.showId === t.showId && x.status === t.status && x.ownerUser === t.ownerUser);
  // mặc định: MỘT QR cho cả đơn (quét vé nào cũng ra cả đơn ở cửa); "Tách từng vé" để gửi riêng cho bạn bè đến lẻ
  const split = !!S.view.splitQr, grp = sameShow.length > 1;
  const seatTabs = !grp ? "" : split
    ? `<div class="mb-3 -mx-1 overflow-x-auto px-1 scrollbar-clean"><div class="flex w-max items-center gap-1.5"><span class="mr-1 text-xs text-muted">${sameShow.length} vé · ghế</span>${sameShow.map(x => `<button type="button" data-act="ticket-pick" data-code="${x.code}" aria-pressed="${x === t}" class="h-8 cursor-pointer rounded-full px-3 text-sm tabular-nums ${x === t ? "bg-foreground text-surface" : "bg-secondary hover:bg-secondary-hover"}">${esc(x.seat)}</button>`).join("")}<button type="button" data-act="qr-split" class="ml-1 h-8 cursor-pointer rounded-full border border-border-strong px-3 text-xs hover:bg-button-hover">Gộp lại</button></div></div>`
    : `<div class="mb-3 flex items-start gap-3 rounded-xl bg-background p-3"><span class="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-foreground">${ic("users")}</span><span class="min-w-0 flex-1"><span class="block text-sm font-medium">1 QR cho cả đơn · ${sameShow.length} vé</span><span class="block text-xs text-muted">Ghế ${esc(sameShow.map(x => x.seat).join(", "))}. Nhân viên quét một lần, cả nhóm cùng vào.</span></span><button type="button" data-act="qr-split" class="shrink-0 text-xs font-medium underline underline-offset-2">Tách từng vé</button></div>`;
  const mailLine = Remote.v21 && Auth.user.email && t.channel === "Online" && t.ownerUser === Auth.user.username
    ? `<p class="mt-3 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">${ic("mail", "size-3.5")}Vé đã gửi về <b class="text-foreground">${esc(Auth.user.email)}</b> · <button type="button" class="cursor-pointer font-medium text-foreground underline underline-offset-2" data-act="mail-view" data-ref="${esc(t.orderId || "")}">Xem email</button></p>` : "";
  const guestBar = Auth.user.guest ? `<div class="mb-4">${banner("info", "", `Bạn đang mua không cần tài khoản (<b>${esc(Auth.user.email || "")}</b>). Vé đã gửi về email; mở lại bất cứ lúc nào ở <a href="#/tracuu" class="underline underline-offset-2">Tra cứu vé</a>. Tạo tài khoản bằng email này để giữ vé lâu dài và tích điểm.`, `<button type="button" class="${B.outline} shrink-0" data-act="guest-upgrade">${ic("user-plus")}Tạo tài khoản</button>`)}</div>` : "";
  const info = `<div class="flex items-start gap-3">${poster(f, "h-16 w-11 shrink-0")}<div class="min-w-0 flex-1"><div class="flex items-center gap-2"><h2 class="truncate text-base font-semibold">${esc(f.title)}</h2>${rate(f.rating)}</div><p class="text-sm text-muted">${dayLabel(sh.start)} · ${hhmm(sh.start)} · ${placeOf(sh)} · ${formatOf(sh)}</p></div></div>
    ${t.viewerUser && t.viewerUser === Auth.user.username && t.ownerUser !== Auth.user.username ? `<p class="mt-3 flex items-center gap-1.5 text-xs text-muted">${ic("gift", "size-3.5")}Vé do <b class="font-mono">@${esc(t.ownerUser)}</b> mua cho bạn.</p>` : t.viewerUser && t.ownerUser === Auth.user.username ? `<p class="mt-3 flex items-center gap-1.5 text-xs text-muted">${ic("user-check", "size-3.5")}Vé của bạn đi cùng <b>${esc(t.viewerName)}</b> (<span class="font-mono">@${esc(t.viewerUser)}</span>)${t.verified ? " · đã xác thực, vào thẳng" : " · kiểm tuổi ở cửa"}.</p>` : ""}
    <dl class="mt-4 grid grid-cols-3 gap-3 text-sm"><div><dt class="text-xs text-muted">Ghế</dt><dd class="font-medium">${grp && !split ? esc(sameShow.map(x => x.seat).join(", ")) : esc(t.seat)}</dd></div><div><dt class="text-xs text-muted">Mã vé</dt><dd class="font-mono font-medium">${t.code}</dd></div><div><dt class="text-xs text-muted">Tuổi</dt><dd class="font-medium">${t.needDoc ? "Kiểm tra tại cửa" : t.verified ? "Đã xác minh" : RATINGS[f.rating] ? "Kiểm tra tại cửa" : "Không giới hạn"}</dd></div></dl>
    ${mailLine}
    ${new Date(sh.start) > new Date() || endOf(sh) > new Date() ? `<div class="mt-4 flex flex-wrap items-center justify-between gap-2">
      ${new Date(sh.start) > new Date() && freeSeats(sh) > 0 ? `<button type="button" class="${B.outline}" data-act="buy-more" data-show="${sh.id}">${ic("user-plus")}Mua thêm vé cùng suất</button>` : `<span class="text-xs text-muted">${freeSeats(sh) === 0 ? "Suất đã hết ghế" : "Suất đang chiếu"}</span>`}
      ${t.status === "valid" && t.channel === "Online" && new Date(sh.start) > new Date() ? `<button type="button" class="${B.ghost}" data-act="refund" data-code="${t.code}">Hoàn vé</button>` : ""}</div>` : ""}`;
  const seatsAll = sameShow.map(x => x.seat), arrive = t.status === "valid" && endOf(sh) > new Date() ? `<section class="mb-4 rounded-xl border border-border bg-surface p-4 sm:p-5"><div class="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 class="text-base font-semibold">${ic("footprints", "mr-1.5 inline size-4 text-muted")}Đường vào ghế của bạn</h2><p class="text-sm text-muted">${seatsAll.length} người (${esc(seatsAll.join(", "))}) vào từ cửa trước, leo bậc tới hàng rồi ngồi – đúng ${esc(room(sh.roomId).name)}, ${esc(cinemaOf(sh).name)}.</p></div><button type="button" class="${B.outline} min-h-9 px-3" data-act="seat3d-replay">${ic("rotate-ccw", "size-4")}Phát lại</button></div><div class="relative aspect-[16/9] overflow-hidden rounded-xl bg-black" data-seat3d data-seat3d-ve data-show="${sh.id}" data-seats="${esc(seatsAll.join(","))}"></div></section>` : "";
  const top = t.status === "valid" && endOf(sh) > new Date()
    ? `<div class="mb-4 flex items-center justify-between gap-2"><span class="text-sm font-medium">${t === upcoming[0] ? "Suất sắp tới" : "Vé đang xem"}${grp && !split ? ` · đơn ${sameShow.length} vé` : ""}</span>${ticketStatus(t)}</div>${seatTabs}${qrBlock(t)}<div class="mt-5 border-t border-border pt-4">${info}</div>`
    : `<div class="mb-4 flex items-center justify-between gap-2"><span class="text-sm font-medium">Vé đang xem</span>${ticketStatus(t)}</div>${seatTabs}${info}`;
  // "Vé khác": gom theo suất, mỗi suất một dòng với danh sách ghế
  const groups = []; ts.filter(x => !sameShow.includes(x)).forEach(x => { const k = x.showId + "|" + x.status; let g = groups.find(y => y.k === k); if (!g) groups.push(g = { k, showId: x.showId, items: [] }); g.items.push(x); });
  const vq = (S.view.veQ || "").trim().toLowerCase();
  const others = groups.filter(g => !vq || g.items.some(x => { const s2 = show(x.showId); return [film(s2.filmId).title, x.code, x.seat, cinemaOf(s2).name, ddmm(s2.start), x.status === "used" ? "đã xem" : x.status === "refunded" ? "đã hoàn" : "sắp chiếu"].join(" ").toLowerCase().includes(vq); }));
  const body = head + guestBar + `<div class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start">
    <section class="rounded-xl border border-border bg-surface p-4 sm:p-5">${top}</section>
    <section>${arrive}${h2("Vé khác", searchBox("ve-q", "Tìm vé theo phim, mã, ghế, rạp, ngày…", S.view.veQ, "w-full max-w-[320px]"))}${others.length ? `<div class="overflow-hidden rounded-xl border border-border bg-surface">${others.map(g => { const x = g.items[0], s2 = show(g.showId), f2 = film(s2.filmId), seats = g.items.map(y => y.seat);
      return `<button type="button" data-act="ticket-pick" data-code="${x.code}" class="flex w-full cursor-pointer items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-surface-hover">${poster(f2, "h-14 w-10 shrink-0")}<span class="min-w-0 flex-1"><span class="block truncate font-medium">${esc(f2.title)}${g.items.length > 1 ? ` <span class="text-sm font-normal text-muted">· ${g.items.length} vé</span>` : ""}</span><span class="block truncate text-xs text-muted">${dayLabel(s2.start)} · ${hhmm(s2.start)} · ${placeOf(s2)} · ghế ${esc(seats.slice(0, 6).join(", "))}${seats.length > 6 ? ` +${seats.length - 6}` : ""}</span></span>${ticketStatus(x)}</button>`; }).join("")}</div>` : `<p class="text-sm text-muted">${vq ? "Không có vé khớp từ khoá." : "Chưa có vé khác. Mua thêm vé cho bạn bè bằng nút “Mua thêm vé cùng suất”, hoặc <a href=\"#/lich\" class=\"font-medium text-foreground underline underline-offset-2\">xem lịch chiếu</a>."}</p>`}
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
    if (g.step === 0) inner = `<div class="grid gap-3 lg:grid-cols-2">${S.films.map(ff => { const ss = S.shows.filter(s => s.status !== "cancelled" && s.filmId === ff.id && new Date(s.start) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start)); if (!ss.length) return "";
      return `<article class="flex gap-4 rounded-xl border border-border p-4">${poster(ff, "h-24 w-16 shrink-0")}<div class="min-w-0 flex-1"><div class="flex items-start gap-2"><h3 class="min-w-0 flex-1 truncate font-semibold">${esc(ff.title)}</h3>${rate(ff.rating)}</div><div class="mt-3 flex flex-wrap gap-2">${ss.map(s => `<button type="button" data-act="g-show" data-show="${s.id}" class="grid h-12 cursor-pointer content-center rounded-xl border border-border-strong bg-surface px-3 text-left hover:bg-button-hover"><span class="text-sm font-semibold tabular-nums">${ddmm(s.start)} ${hhmm(s.start)}</span><span class="text-xs text-muted">${esc(cinemaOf(s).name.replace("CineVin ", ""))} · ${freeSeats(s)} ghế trống</span></button>`).join("")}</div></div></article>`; }).join("")}</div>`;
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
    else { const n = g.students.length + 1, unit = Math.round(priceLegend(sh).std * (1 - S.params.groupDiscount) / 1000) * 1000;
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
    return `<article class="rounded-xl border border-border bg-surface p-4"><div class="flex gap-4"><div class="qr-box size-24 shrink-0 rounded-lg border border-border p-1.5">${qrSvg(gr.code)}</div><div class="min-w-0 flex-1"><div class="flex items-center gap-2"><h3 class="truncate font-semibold">${esc(f.title)}</h3>${rate(f.rating)}</div><p class="text-sm text-muted">${ddmm(sh.start)} ${hhmm(sh.start)} · ${placeOf(sh)} · ${seatRows(gr.seats)}</p><p class="mt-1 font-mono text-sm">${gr.code}</p><div class="mt-2">${gr.status === "used" ? tone(`Đã vào ${gr.enteredCount}/${gr.students.length}`, "neutral") : tone(`${gr.students.length} HS + 1 phụ trách · chưa sử dụng`, "ok")}</div></div></div>
      ${cards ? `<details class="mt-3"><summary class="cursor-pointer text-sm text-muted hover:text-foreground">Thẻ QR cá nhân (${gr.students.length}) – in và phát cho từng em</summary><div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">${gr.students.map(s => `<div class="rounded-lg border border-border p-2 text-center"><div class="qr-box mx-auto size-20">${qrSvg(s.card)}</div><p class="mt-1 truncate text-xs font-medium">${esc(s.name)}</p><p class="font-mono text-xs text-muted">${s.card}</p></div>`).join("")}</div></details>` : ""}</article>`; }).join("")}</div></section>` : "";
  return customerShell("doan", head + `<div class="mb-4">${intro}</div>` + body + issued);
}

/* ---------- Tài khoản ---------- */
/* Khối "Nhận vé qua email" trong trang thanh toán cho khách chưa đăng nhập (021): email → mã 6 số → phiên khách → nút Thanh toán hiện ra */
function guestCheckout() {
  const g = GUEST, can = !Remote.v4 || Remote.v21;
  const head = `<div class="mt-4 border-t border-border pt-4"><p class="text-sm font-medium">Nhận vé qua email</p><p class="mt-0.5 text-xs text-muted">Không cần tài khoản. Có tài khoản? <a href="#/dangnhap" class="underline underline-offset-2">Đăng nhập</a> để tích điểm (ghế đang giữ vẫn còn).</p>`;
  if (!can) return `${head}<p class="mt-3 text-sm text-muted">Máy chủ chưa bật mua vé không cần tài khoản (migration 021) – đăng nhập để tiếp tục.</p></div>`;
  const err = g.err ? `<p class="text-sm text-[var(--error-text)]" role="alert">${esc(g.err)}</p>` : "";
  if (g.step === "code") return `${head}<form class="mt-3 grid gap-3" data-form="guest-verify" novalidate>
      <p class="text-sm">${g.mailed ? `Supabase đã gửi mã xác nhận tới <b>${esc(g.email)}</b> – kiểm tra hộp thư, cả mục Spam. Mã có hiệu lực 10 phút.` : `Mã xác nhận cho <b>${esc(g.email)}</b>.`}</p>
      ${g.demoCode ? `<div class="rounded-xl border border-dashed border-border-strong bg-background p-3 text-sm"><p class="text-xs text-muted">Chế độ demo (chưa cấu hình SMTP cho Supabase) nên mã hiện ở đây:</p><p class="mt-1 font-mono text-2xl font-bold tracking-[.3em]">${esc(g.demoCode)}</p></div>` : ""}
      ${field("Mã xác nhận", `<input id="g-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="Mã trong email" class="${INPUT} !h-12 text-center font-mono text-xl tracking-[.3em]">`)}${err}
      <button type="submit" class="${B.primary} min-h-12" ${g.busy ? "disabled" : ""}>${g.busy ? "Đang kiểm tra…" : `${ic("check")}Xác nhận email`}</button>
      <div class="flex justify-between text-xs"><button type="button" class="cursor-pointer text-muted underline underline-offset-2" data-act="guest-back">Đổi email</button><button type="button" class="cursor-pointer text-muted underline underline-offset-2" data-act="guest-resend">Gửi lại mã</button></div></form></div>`;
  return `${head}<form class="mt-3 grid gap-3" data-form="guest-send" novalidate>
      ${field("Email nhận vé", `<input id="g-email" type="email" autocomplete="email" inputmode="email" placeholder="ban@example.com" class="${INPUT} !h-12" value="${esc(g.email)}">`)}
      <div class="grid gap-3 sm:grid-cols-2">${field("Họ và tên", `<input id="g-name" autocomplete="name" placeholder="Nguyễn Văn A" class="${INPUT} !h-12" value="${esc(g.name)}">`)}${field("Số điện thoại (tuỳ chọn)", `<input id="g-phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="09xx xxx xxx" class="${INPUT} !h-12" value="${esc(g.phone)}">`)}</div>${err}
      <button type="submit" class="${B.primary} min-h-12" ${g.busy ? "disabled" : ""}>${g.busy ? "Đang gửi mã…" : `${ic("mail")}Gửi mã xác nhận`}</button>
      <p class="text-pretty text-xs text-muted">Mã xác nhận (6–8 số) gửi về email để chắc bạn nhận được vé; email dùng một lần (10 phút) bị từ chối. Phim giới hạn tuổi sẽ kiểm giấy tờ tại cửa.</p></form></div>`;
}

/* Màn "Vào rạp" (toàn màn hình, như Enter theatre của rạp ảo): phòng 3D phủ kín, Từ ghế / Đứng dậy / Đi lại (WASD + chuột trên PC, joystick + vuốt trên điện thoại),
   đến gần ghế trống → "Ngồi xuống (E)"; xoay ngang / dọc đều tự co giãn (ResizeObserver), nút toàn màn hình. */
function theatreHtml(sh, f, r) {
  const d = S.draft, mode = S.view.seat3dMode === "overview" ? "overview" : S.view.seat3dMode === "walk" ? "walk" : "seat", focus = d.seats[d.seats.length - 1], rt = focus ? Seat3D.rate(r, focus, Seat3D.PRIO[S.view.seatPriority] ? S.view.seatPriority : "balanced") : null;
  const seatTxt = rt ? `Hàng ${rt.seat.row} · Ghế ${rt.seat.number}` : "Chưa chọn ghế";
  const modeSeg = seg([["seat", "Từ ghế", "eye"], ["overview", "Đứng dậy", "person-standing"], ["walk", "Đi lại", "footprints"]], mode, "seat3d-mode");
  const hint = mode === "walk" ? `<span class="mouse-only">W A S D / mũi tên: đi · Shift: chạy · kéo chuột: nhìn · V: đổi ngôi nhìn · E: ngồi · Esc: thoát</span><span class="touch-only-inline">Joystick trái để đi · vuốt phải để nhìn · chạm ghế gần để ngồi</span>`
    : mode === "overview" ? "Kéo để xoay quanh bạn · lăn chuột để lùi / tiến · bấm ghế để chọn" : "Kéo để nhìn quanh · bấm đúp để nhìn thẳng màn hình";
  return `<div class="theatre fixed inset-0 z-[70] bg-black text-white" data-theatre>
    <div class="absolute inset-0" data-seat3d data-theatre-stage></div>
    <div class="theatre-top pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2 sm:p-3">
      <div class="pointer-events-auto flex min-w-0 items-center gap-2"><button type="button" class="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25" data-act="exit-theatre" aria-label="Thoát rạp">${ic("arrow-left", "size-5")}</button>
        <div class="hidden min-w-0 rounded-xl bg-black/50 px-3 py-1.5 backdrop-blur sm:block"><p class="truncate text-sm font-semibold">${esc(f.title)}</p><p class="truncate text-[11px] text-white/70">${esc(r.name)} · ${seatTxt}${rt ? ` · ${rt.score100}/100` : ""}</p></div></div>
      <div class="pointer-events-auto flex shrink-0 items-center gap-2">${modeSeg}<button type="button" class="touch-only size-10 items-center justify-center rounded-full bg-primary text-primary-foreground" data-act="theatre-pay" aria-label="Thanh toán">${ic("ticket", "size-5")}</button><button type="button" class="grid size-10 cursor-pointer place-items-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25" data-act="theatre-fullscreen" aria-label="Toàn màn hình">${ic("maximize", "size-5")}</button></div>
    </div>
    ${mode === "walk" ? `<div class="theatre-joy touch-only absolute bottom-6 left-6 z-10" data-joystick><div class="joy-base"><div class="joy-knob" data-joy-knob></div></div></div>
      <div class="touch-only absolute bottom-6 right-6 z-10 flex-col gap-2"><button type="button" class="joy-btn" data-act="seat3d-view">${ic("video", "size-5")}</button><button type="button" class="joy-btn" data-run-btn>${ic("zap", "size-5")}</button></div>
      <div class="pointer-events-none absolute inset-x-0 bottom-20 z-10 hidden justify-center near-prompt" data-near-prompt><button type="button" class="pointer-events-auto flex items-center gap-2 rounded-full border border-warning/60 bg-black/85 px-4 py-2 text-sm font-medium text-warning backdrop-blur hover:bg-black" data-act="seat-sit"><kbd class="rounded border border-warning/60 px-1.5 py-0.5 font-mono text-xs">E</kbd><span data-near-text>Ngồi xuống</span></button></div>` : ""}
    <div class="theatre-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-2 text-[11px] text-white/70 sm:p-3"><span class="rounded-md bg-black/50 px-2 py-1 ${mode === "walk" ? "mouse-only" : ""}">${hint}</span><span class="mouse-only"><button type="button" class="pointer-events-auto ${B.primary} min-h-10 px-4" data-act="theatre-pay">${ic("ticket")}Thanh toán${d.seats.length ? ` ${d.seats.length} vé` : ""}</button></span></div>
    ${S.view.theatrePay ? theatrePayHtml(sh, f, r) : ""}
  </div>`;
}

/* Tra cứu vé mua không tài khoản: mã vé / mã đơn + email/* Tra cứu vé mua không tài khoản: mã vé / mã đơn + email → phiên xem vé 2 giờ (021). Link trong mail: #/tracuu?ma=<mã đơn> */
/** Bảng Thanh toán ngay trong rạp (không rời rạp): có ghế → đơn + Tiếp tục thanh toán; chưa có ghế → báo và nút Tự động chọn ghế đẹp sáng lên */
function theatrePayHtml(sh, f, r) {
  const d = S.draft, n = d.seats.length, total = d.seats.reduce((a, s) => a + seatPrice(sh, s), 0), groups = seatGroups(r);
  const row = s => { const q = typeof Seat3D !== "undefined" ? Seat3D.rate(r, s) : null, k = seatKind(r, s), g = groups.get(s);
    return `<div class="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2"><span class="grid h-9 min-w-10 place-items-center rounded-lg bg-primary px-1.5 font-mono text-sm font-semibold text-primary-foreground">${esc(s)}</span><span class="min-w-0 flex-1 truncate text-sm">${esc(seatType(k).name)}${q ? ` · ${esc(q.text)}` : ""}</span><span class="text-sm font-semibold tabular-nums">${vnd(seatPrice(sh, s))}</span><button type="button" class="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-white/15" data-act="toggle-seat" data-seat="${esc(s)}" ${g && g.length > 1 ? `data-group="${esc(g.join(","))}"` : ""} aria-label="Bỏ ghế ${esc(s)}">${ic("x", "size-4")}</button></div>`; };
  const body = n ? `<p class="text-sm text-white/70">${esc(f.title)} · ${hhmm(sh.start)} · ${esc(r.name)}</p><div class="mt-3 grid gap-2">${d.seats.map(row).join("")}</div>
      <div class="mt-3 flex items-center justify-between border-t border-white/15 pt-3"><span class="text-sm text-white/70">${n} vé</span><span class="text-2xl font-bold tabular-nums">${vnd(total)}</span></div>
      <div class="mt-4 grid grid-cols-2 gap-2"><button type="button" class="${B.outline} min-h-11 border-white/30 bg-white/10 text-white hover:bg-white/20" data-act="theatre-pay-close">${ic("armchair")}Chọn thêm ghế</button><button type="button" class="${B.primary} min-h-11" data-act="exit-theatre-pay">${ic("ticket")}Tiếp tục thanh toán</button></div>`
    : `<div class="grid justify-items-center gap-3 py-2 text-center"><span class="grid size-14 place-items-center rounded-2xl bg-white/10 text-warning">${ic("armchair", "size-7")}</span><p class="text-base font-semibold">Bạn chưa chọn ghế nào</p><p class="text-sm text-white/70">Bấm một ghế trống trong rạp (hoặc đi tới ghế rồi bấm E), hoặc để hệ thống chọn ghế nhìn đẹp nhất cho bạn.</p>
      <button type="button" class="${B.primary} theatre-best-btn mt-1 min-h-12 px-5 text-base" data-act="theatre-best">${ic("sparkles")}Tự động chọn ghế đẹp</button><button type="button" class="${B.ghost} min-h-9 text-white/80 hover:bg-white/10" data-act="theatre-pay-close">Để tôi tự chọn</button></div>`;
  return `<div class="theatre-pay absolute inset-0 z-20 flex items-end justify-center bg-black/55 p-3 sm:items-center" data-theatre-pay>
    <div class="w-full max-w-md rounded-2xl border border-white/15 bg-[#141214] p-4 text-white shadow-modal sm:p-5" data-theatre-pay-box>
      <div class="mb-2 flex items-center justify-between gap-2"><h2 class="text-base font-semibold">${n ? "Đơn của bạn" : "Thanh toán"}</h2><button type="button" class="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-white/15" data-act="theatre-pay-close" aria-label="Đóng">${ic("x", "size-5")}</button></div>${body}</div></div>`;
}

function vTraCuu() {
  const ma = (location.hash.match(/[?&]ma=([^&]+)/) || [])[1] || "";
  const body = pageHead("Tra cứu vé", "Vé mua không cần tài khoản: nhập mã vé hoặc mã đơn (có trong email) và email đã dùng khi mua") + `
    <div class="grid gap-4 lg:grid-cols-[480px_minmax(0,1fr)] lg:items-start">
      ${card(`<form class="grid gap-4" data-form="tracuu" novalidate>
        ${field("Mã vé hoặc mã đơn", `<input id="tc-code" placeholder="VD: V8K2M1 hoặc D7H3…" autocapitalize="characters" spellcheck="false" class="${INPUT} !h-12 font-mono uppercase" value="${esc(decodeURIComponent(ma))}">`)}
        ${field("Email đã nhận vé", `<input id="tc-email" type="email" inputmode="email" autocomplete="email" placeholder="ban@example.com" class="${INPUT} !h-12">`)}
        ${TRACUU.err ? `<p class="text-sm text-[var(--error-text)]" role="alert">${esc(TRACUU.err)}</p>` : ""}
        <button type="submit" class="${B.primary} min-h-12" ${TRACUU.busy ? "disabled" : ""}>${TRACUU.busy ? "Đang tìm…" : `${ic("search")}Mở vé`}</button>
        <p class="text-pretty text-xs text-muted">Mở xong bạn xem được mã QR vào rạp, mua thêm vé cùng suất hoặc hoàn vé trước giờ chiếu 30 phút. Có tài khoản? <a href="#/dangnhap" class="underline underline-offset-2">Đăng nhập</a>.</p></form>`)}
      ${card(`<h2 class="text-base font-semibold">Mua vé không cần tài khoản</h2><ol class="mt-3 grid gap-3 text-sm text-muted">${[["Chọn suất và ghế", "Bấm giờ chiếu ở Lịch chiếu, chọn ghế trên sơ đồ – không cần đăng nhập, ghế giữ 5 phút."], ["Xác nhận email, thanh toán", "Nhập email + họ tên, nhận mã 6 số (email dùng một lần bị từ chối), nhập mã rồi thanh toán."], ["Nhận vé qua email", "Mail có phim, rạp, ghế, mã vé và nút mở QR. QR đổi mỗi 15 giây nên luôn mở trên điện thoại."]].map(([t, d], i) => `<li class="flex gap-3"><span class="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">${i + 1}</span><span><b class="text-foreground">${t}</b><br>${d}</span></li>`).join("")}</ol>`)}
    </div>`;
  return customerShell("tracuu", body);
}

function vTaiKhoan() {
  const u = S.user, a = Auth.user, v5 = Remote.v5 && a.token;
  if (a.guest) {   // khách vãng lai: chỉ email/tên, mời tạo tài khoản thật (vé chuyển sang)
    const body = pageHead("Tài khoản khách", `${esc(a.name)} · mua không cần tài khoản`, `<button type="button" class="${B.outline}" data-act="logout">${ic("log-out")}Thoát</button>`) + `
      <div class="grid gap-4 lg:grid-cols-2 lg:items-start">
        ${card(`<h2 class="mb-3 text-base font-semibold">Thông tin nhận vé</h2><dl class="grid gap-2 text-sm">${[["Email", esc(a.email || "")], ["Họ tên", esc(a.name)], ["Số điện thoại", a.phone ? esc(a.phone) : `<span class="text-muted">chưa có</span>`], ["Phiên", a.offline ? tone("Ngoại tuyến – trình duyệt", "warn") : tone("Khách vãng lai · 2 giờ", "neutral")]].map(([k, v]) => `<div class="flex justify-between gap-3 border-b border-border py-1.5 last:border-0"><dt class="text-muted">${k}</dt><dd class="text-right">${v}</dd></div>`).join("")}</dl>
          <p class="mt-3 text-pretty text-xs text-muted">Vé của bạn đã gửi về email. Hết phiên vẫn mở lại được ở <a href="#/tracuu" class="underline underline-offset-2">Tra cứu vé</a> bằng mã vé + email.</p>`)}
        ${card(`<h2 class="text-base font-semibold">Tạo tài khoản để giữ vé &amp; tích điểm</h2><ul class="mt-2 grid gap-1 pl-5 text-sm text-muted" style="list-style:disc"><li>Vé đã mua chuyển sang tài khoản mới (cùng email)</li><li>Tích 5% điểm thưởng, dùng mã khuyến mãi, thẻ quà tặng khi hoàn vé</li><li>Xác thực VNeID + FaceID để mua vé theo tuổi và vào thẳng phim T13–T18</li></ul>
          <button type="button" class="${B.primary} mt-4 w-full" data-act="guest-upgrade">${ic("user-plus")}Tạo tài khoản với ${esc(a.email || "email này")}</button>`)}
      </div>`;
    return customerShell("taikhoan", body);
  }
  // null/undefined = cần tải lại (sau khi thanh toán, hoàn vé); cờ loading tránh gọi trùng khi render nhiều lần
  if (v5 && !S.view.vouchers && !S.view.vouchersLoading) { S.view.vouchersLoading = true; Remote.rpc("my_vouchers", { p_token: a.token }).then(r => { S.view.vouchers = r; }).catch(() => { S.view.vouchers = []; }).finally(() => { S.view.vouchersLoading = false; render(); }); }
  const idCard = u.linked
    ? `<div class="flex items-start gap-3"><span class="grid size-10 place-items-center rounded-lg bg-success-bg text-success">${ic("badge-check", "size-5")}</span><div class="min-w-0"><p class="font-semibold">${esc(u.name)}</p><p class="text-sm text-muted">Sinh ${dmy(u.dob)} · ${ageAt(u.dob, new Date())} tuổi · hạng ${tier()}</p><p class="mt-1 text-xs text-muted">Xác thực lúc ${new Date(u.verifiedAt).toLocaleString("vi-VN")} · ${esc(u.method || "")}${u.faceScore != null ? ` · tương đồng ${u.faceScore}%` : ""}${v5 ? " · lưu trên máy chủ" : " · chỉ trên thiết bị này"}</p></div></div>
       <p class="mt-3 text-pretty text-xs text-muted">Rạp chỉ lưu ngày sinh, mức và thời điểm xác thực – không lưu ảnh khuôn mặt. Đã liên kết thì đăng nhập được bằng FaceID hoặc VNeID.</p>
       <div class="mt-4 flex flex-wrap gap-2"><button type="button" class="${B.outline}" data-act="vneid-self">Xác thực lại</button><button type="button" class="${B.ghost}" data-act="unlink">Huỷ liên kết</button></div>`
    : `${banner("warn", "Chưa xác thực", "Vé phim T13–T18 phải kiểm giấy tờ ở cửa; chưa đăng nhập được bằng FaceID / VNeID.")}<p class="mt-3 text-pretty text-sm text-muted">Liên kết VNeID một lần để được giá theo độ tuổi (trẻ em, U22, người cao tuổi) và vào thẳng phim T13–T18.</p><button type="button" class="${B.primary} mt-4" data-act="vneid-self">Liên kết VNeID + FaceID</button>`;
  const pk = !u.linked ? `<p class="text-sm text-muted">Liên kết VNeID trước.</p>`
    : u.passkey ? `<p class="text-sm">Đang bật · tạo ${new Date(u.passkey.createdAt).toLocaleDateString("vi-VN")} · ${u.passkey.alg === -7 ? "ES256" : "RS256"}</p><div class="mt-3 flex flex-wrap gap-2"><button type="button" class="${B.outline}" data-act="pk-test">Thử xác thực</button><button type="button" class="${B.ghost}" data-act="pk-del">Tắt</button></div>`
    : PK.avail ? `<button type="button" class="${B.outline}" data-act="pk-create">Bật ${esc(Passkey.label())}</button>` : `<p class="text-pretty text-sm text-muted">Thiết bị/trình duyệt này không có sinh trắc tích hợp, hoặc trang chưa chạy HTTPS.</p>`;
  const toggle = `<button type="button" role="switch" aria-checked="${!!u.confirmEvery}" data-act="pref-confirm" class="mt-3 flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border-strong p-3 text-left hover:bg-button-hover ${u.passkey ? "" : "opacity-60"}" ${u.passkey ? "" : "disabled"}><span class="relative h-6 w-11 shrink-0 rounded-full transition-colors ${u.confirmEvery ? "bg-primary" : "bg-secondary"}"><span class="absolute top-0.5 size-5 rounded-full bg-surface shadow-popover transition-[left] ${u.confirmEvery ? "left-[22px]" : "left-0.5"}"></span></span><span class="min-w-0"><span class="block text-sm font-medium">Xác nhận mỗi lần đặt vé</span><span class="block text-xs text-muted">${u.passkey ? "Quét " + esc(Passkey.label()) + " trước khi thanh toán mọi đơn, kể cả phim P/K." : "Bật " + esc(Passkey.label()) + " trước."}</span></span></button>`;
  const deps = S.dependents.map(d => `<div class="flex items-center gap-3 border-b border-border py-3 last:border-0">${avatar(d.name)}<div class="min-w-0 flex-1"><p class="truncate font-medium">${esc(d.name)}</p><p class="text-xs text-muted">${dmy(d.dob)} · ${ageAt(d.dob, new Date())} tuổi · ${esc(d.idMasked)}</p></div>${d.level === "VNeID" ? tone("VNeID", "ok") : tone("Cam kết", "warn")}<button type="button" class="${B.icon}" data-act="del-dep" data-id="${d.id}" aria-label="Xoá ${esc(d.name)}">${ic("trash-2")}</button></div>`).join("");
  // lịch sử đặt vé: gom theo đơn
  const orders = {}; myTickets().forEach(t => { (orders[t.orderId || t.code] ||= []).push(t); });
  const hist = Object.values(orders).sort((x, y) => new Date(show(y[0].showId).start) - new Date(show(x[0].showId).start)).slice(0, 12).map(ts => { const s = show(ts[0].showId), f = film(s.filmId), st = ts.every(t => t.status === "refunded") ? tone("Đã hoàn", "bad") : ts.every(t => t.status === "used") ? tone("Đã xem", "neutral") : endOf(s) < new Date() ? tone("Đã qua", "neutral") : tone("Sắp chiếu", "ok");
    return `<button type="button" data-act="hist-open" data-code="${ts[0].code}" class="flex w-full cursor-pointer items-center gap-3 border-b border-border py-3 text-left last:border-0 hover:bg-surface-hover">${poster(f, "h-12 w-9 shrink-0")}<span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${esc(f.title)}</span><span class="block text-xs text-muted">${dayLabel(s.start)} ${hhmm(s.start)} · ghế ${esc(ts.map(t => t.seat).join(", "))} · ${vnd(ts.reduce((a, t) => a + t.price, 0))}</span></span>${st}</button>`; }).join("");
  const vs = S.view.vouchers;
  const vouchers = !v5 ? (S.gifts.length ? S.gifts.map(g => `<div class="flex items-center justify-between border-b border-border py-2 text-sm last:border-0"><span class="font-mono">${g.code}</span><span class="tabular-nums">${vnd(g.amount)}</span></div>`).join("") : `<p class="text-sm text-muted">Chưa có voucher.</p>`)
    : vs === null ? skelRows(2, "h-9") : !vs.length ? `<p class="text-sm text-muted">Chưa có voucher. Hoàn vé sẽ tạo thẻ quà tặng ở đây.</p>`
    : vs.map(x => `<div class="flex items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0 ${x.used_at ? "opacity-50" : ""}"><span class="min-w-0"><span class="font-mono font-medium">${esc(x.code)}</span><span class="block text-xs text-muted">${x.kind === "gift" ? "Thẻ quà tặng" : "Khuyến mãi"}${x.expires_at ? " · đến " + ddmm(x.expires_at) + "/" + new Date(x.expires_at).getFullYear() : ""}${x.used_at ? " · đã dùng" : ""}</span></span><span class="tabular-nums">${x.kind === "gift" ? vnd(x.amount) : "−" + x.percent + "%"}</span></div>`).join("");
  const body = pageHead("Tài khoản", `${esc(a.name)} · @${esc(a.username)} · ${Auth.ROLE_TXT[a.role]}`, `<button type="button" class="${B.outline}" data-act="logout">${ic("log-out")}Đăng xuất</button>`) + `
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 lg:items-start">
      ${card(`<div class="mb-3 flex items-center justify-between gap-2"><h2 class="text-base font-semibold">Thông tin tài khoản</h2>${u.linked ? tone("Đã xác thực VNeID", "ok") : tone("Chưa xác thực", "warn")}</div>
        <dl class="grid gap-2 text-sm">${[["Họ tên", esc(a.name)], ["Tên đăng nhập", "@" + esc(a.username)], ["Email", a.email ? esc(a.email) : `<span class="text-muted">chưa có</span>`], ["Số điện thoại", a.phone ? esc(a.phone) : `<span class="text-muted">chưa có</span>`], ["Điểm thưởng", `<span class="tabular-nums">${u.points ?? 0}</span> · hạng ${tier()}`], ["Đăng nhập", a.offline ? tone("Ngoại tuyến – trình duyệt", "warn") : tone("Máy chủ xác thực", "ok")]].map(([k, v]) => `<div class="flex items-start justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0"><dt class="text-muted">${k}</dt><dd class="text-right">${v}</dd></div>`).join("")}</dl>`)}
      ${card(`<h2 class="mb-3 text-base font-semibold">Định danh VNeID</h2>${idCard}`)}
      ${card(`${h2("Lịch sử đặt vé", `<a href="#/ve" class="text-sm text-muted hover:text-foreground">Vé của tôi</a>`)}${hist ? `<div>${hist}</div>` : `<p class="text-sm text-muted">Chưa đặt vé nào.</p>`}`)}
      ${card(`<h2 class="mb-3 text-base font-semibold">Voucher & thẻ quà tặng</h2>${vouchers}<p class="mt-3 text-xs text-muted">Nhập mã ở bước thanh toán. Điểm thưởng: 5% giá vé, 1 điểm = 1.000 đ.</p>`)}
      ${card(`<h2 class="text-base font-semibold">${esc(Passkey.label())} cho tài khoản</h2><p class="mb-3 mt-1 text-pretty text-sm text-muted">Mua vé T13–T18 hoặc mở QR vé thì thiết bị xác nhận đúng chủ tài khoản. Rạp chỉ nhận chữ ký số – không có khuôn mặt hay vân tay.</p>${pk}${toggle}`)}
      ${card(`<div class="mb-1 flex items-center justify-between gap-2"><h2 class="text-base font-semibold">Người phụ thuộc</h2><button type="button" class="${B.outline}" data-act="add-dep" ${u.linked ? "" : "disabled"}>${ic("plus")}Thêm trẻ</button></div><p class="text-pretty text-sm text-muted">Trẻ dưới 14 tuổi thường chưa có thẻ căn cước. Cha mẹ đã xác thực khai báo con; con có tài khoản định danh thì xác nhận qua VNeID, chưa có thì cam kết theo giấy khai sinh.</p>${deps ? `<div class="mt-2">${deps}</div>` : ""}`)}
    </div>`;
  return customerShell("taikhoan", body);
}
