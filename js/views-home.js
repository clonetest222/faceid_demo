/* Trang chủ công khai + chi tiết phim (khách vãng lai xem được, đăng nhập khi chọn ghế).
   Bố cục: hero (phim hot / ưu đãi) → đặt vé nhanh → Đang chiếu | Sắp chiếu → ưu đãi & tiện ích → cách mua vé → footer. */
"use strict";
const HOME_IMG = id => `https://images.unsplash.com/photo-${id}?w=1600&q=70&auto=format&fit=crop`;
/** Mô tả, ảnh nền, phim hot: từ danh mục CGV (js/films-cgv.js) */
const fmeta = f => { const m = CGV_BY_ID[f.id] || {}; return { desc: m.desc || "", backdrop: m.backdrop || f.img, hot: !!m.hot, director: m.director || "", cast: m.cast || "", unrated: !!m.unrated }; };
const RELEASE_TXT = f => f.release ? `Khởi chiếu ${ddmm(new Date(f.release))}` : "";
/** Phim có suất từ hôm nay trở đi (đang chiếu) và phim sắp chiếu (chưa có suất, có ngày khởi chiếu tương lai) */
/* đang chiếu = có suất từ hôm nay trở đi ở bất kỳ cơ sở nào (phim thử nghiệm không có suất thì không hiện) */
const nowShowing = () => { const t0 = new Date(); t0.setHours(0, 0, 0, 0); return S.films.filter(f => f.active !== false && !isUpcoming(f) && S.shows.some(s => s.filmId === f.id && s.status !== "cancelled" && new Date(s.start) >= t0)); };
const comingSoon = () => S.films.filter(f => f.active !== false && isUpcoming(f)).sort((a, b) => new Date(a.release) - new Date(b.release));
const firstShowOf = fid => S.shows.filter(s => s.filmId === fid && s.status !== "cancelled" && new Date(s.start) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start))[0];

/* ---------- các mảnh ---------- */
const POSTER_CARD = (f, { upcoming = false } = {}) => `<article class="group grid content-start gap-2.5">
  <button type="button" data-act="${upcoming ? "film-detail" : "film-book"}" data-v="${f.id}" class="relative block aspect-[2/3] w-full cursor-pointer overflow-hidden rounded-2xl bg-secondary text-left" aria-label="${upcoming ? "Chi tiết" : "Đặt vé"} ${esc(f.title)}">
    ${f.img ? `<img src="${f.img}" alt="Poster ${esc(f.title)}" loading="lazy" class="size-full object-cover transition-transform duration-500 group-hover:scale-105">` : `<span class="grid size-full place-items-center text-muted">${ic("film", "size-8")}</span>`}
    <span class="absolute left-2 top-2">${rate(f.rating)}</span>
    ${upcoming ? `<span class="absolute bottom-2 left-2 rounded-md bg-foreground/80 px-2 py-0.5 text-xs font-medium text-surface backdrop-blur">${RELEASE_TXT(f)}</span>` : fmeta(f).hot ? `<span class="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">${ic("flame", "size-3")}Hot</span>` : ""}
  </button>
  <div class="min-w-0"><h3 class="line-clamp-1 text-sm font-semibold">${esc(f.title)}</h3><p class="text-xs text-muted">${esc(f.genre)} · ${f.dur} phút</p></div>
  ${upcoming ? `<button type="button" class="${B.outline} min-h-9" data-act="remind" data-v="${f.id}">${ic("bell")}Nhắc tôi</button>`
    : `<div class="flex gap-2"><button type="button" class="${B.primary} min-h-9 flex-1" data-act="film-book" data-v="${f.id}">${ic("ticket")}Đặt vé</button><button type="button" class="${B.icon} size-9 border border-border-strong bg-surface" data-act="film-detail" data-v="${f.id}" aria-label="Chi tiết ${esc(f.title)}">${ic("info")}</button></div>`}
</article>`;

/* ---------- Hero coverflow (theo mẫu "Voyage"): nền = ảnh phim đang chọn làm mờ, 5 poster xếp phối cảnh đối xứng,
   tiêu đề in hoa lớn đè lên thẻ giữa; kéo / vuốt xoay mượt có quán tính rồi tự hít vào thẻ gần nhất; mũi tên, chấm, phím ← →, tự chuyển 6 giây. ---------- */
/* hero: mọi phim đang chiếu (hot trước) rồi tới mọi phim sắp chiếu theo ngày khởi chiếu */
const cfFilms = () => [...nowShowing().sort((a, b) => (fmeta(b).hot ? 1 : 0) - (fmeta(a).hot ? 1 : 0)), ...comingSoon()];
const CF = { p: 0, target: 0, drag: null, vel: 0, raf: 0, active: -1, pauseUntil: 0, t: 0, bg: 0 };
function coverflowHtml() {
  const films = cfFilms(); if (!films.length) return "";
  const idx = Math.min(films.length - 1, Math.max(0, Math.round(S.view.cfIdx || 0))), f = films[idx], m = fmeta(f);
  const cardHtml = (x, i) => { const up = isUpcoming(x), mx = fmeta(x);
    return `<button type="button" class="cf-card" data-act="cf-card" data-v="${i}" aria-label="${esc(x.title)}" tabindex="-1">
      ${x.img ? `<img src="${x.img}" alt="" draggable="false" loading="${Math.abs(i - idx) <= 2 ? "eager" : "lazy"}">` : `<span class="grid size-full place-items-center bg-neutral-800 text-white/40">${ic("film", "size-8")}</span>`}
      <span class="cf-badge-l">${rate(x.rating)}</span>
      <span class="cf-badge-r">${up ? `<span class="rounded-md bg-white/20 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">${RELEASE_TXT(x)}</span>` : mx.hot ? `<span class="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">${ic("flame", "size-3")}Hot</span>` : ""}</span>
      <span class="cf-cap"><span class="block truncate text-lg font-bold leading-tight">${esc(x.title)}</span><span class="mt-1.5 flex flex-wrap gap-1.5 text-xs text-white/85"><span class="rounded-md bg-white/15 px-1.5 py-0.5">${esc(x.genre)}</span><span class="rounded-md bg-white/15 px-1.5 py-0.5">${x.dur} phút</span></span></span>
    </button>`; };
  return `<section class="cf-hero" data-cf data-n="${films.length}" aria-roledescription="carousel" aria-label="Phim nổi bật">
    <div class="cf-bg" aria-hidden="true"><img class="cf-bg-img is-on" src="${m.backdrop || f.img || ""}" alt=""><img class="cf-bg-img" alt=""></div>
    <div class="cf-stage" data-cf-stage>${films.map(cardHtml).join("")}</div>
    <div class="cf-overlay" data-cf-overlay>${cfOverlay(f)}</div>
    <button type="button" class="cf-arrow cf-arrow-l" data-act="cf-prev" aria-label="Phim trước">${ic("chevron-left", "size-6")}</button>
    <button type="button" class="cf-arrow cf-arrow-r" data-act="cf-next" aria-label="Phim sau">${ic("chevron-right", "size-6")}</button>
    <div class="cf-dots" role="tablist" aria-label="Chọn phim">${films.length <= 12 ? films.map((_, i) => `<button type="button" role="tab" aria-selected="${i === idx}" data-act="cf-dot" data-v="${i}" aria-label="Phim ${i + 1}"></button>`).join("") : `<span class="cf-counter"><b data-cf-counter>${idx + 1}</b> / ${films.length}</span>`}</div>
    <p class="cf-hint">${nowShowing().length} phim đang chiếu · ${comingSoon().length} sắp chiếu · kéo để xoay</p>
  </section>`;
}
function cfOverlay(f) {
  const up = isUpcoming(f);
  const d1 = (fmeta(f).desc || "").split(/(?<=[.!?])\s/)[0] || "", short = d1.length > 150 ? d1.slice(0, 147).replace(/\s\S*$/, "") + "…" : d1;
  return `<p class="cf-tag"><b>${esc(f.title)}</b> · ${f.dur} phút · ${esc(RATING_TXT[f.rating] || "")}${up ? " · " + RELEASE_TXT(f) : ""}${short ? "<br>" + esc(short) : ""}</p>
    <div class="cf-cta">${up ? `<button type="button" class="${B.primary} min-h-11 px-5" data-act="remind" data-v="${f.id}">${ic("bell")}Nhắc tôi</button>` : `<button type="button" class="${B.primary} min-h-11 px-5" data-act="film-book" data-v="${f.id}">${ic("ticket")}Đặt vé ngay</button>`}<button type="button" class="${BTN} min-h-11 border border-white/35 bg-white/10 text-white backdrop-blur hover:bg-white/20" data-act="film-detail" data-v="${f.id}">Chi tiết</button></div>`;
}
const cfWrap = (d, n) => ((d % n) + n * 1.5) % n - n / 2;   // khoảng cách ngắn nhất trên vòng
function cfFrame() {
  const box = $("[data-cf]"); if (!box) { CF.raf = 0; return; }
  const n = +box.dataset.n, cards = $$(".cf-card", box), now = performance.now(), dt = Math.min(0.05, (now - (CF.t || now)) / 1000); CF.t = now;
  const mobile = innerWidth < 640, stepX = mobile ? 150 : 330, rot = mobile ? 24 : 24;
  if (!CF.drag) {
    if (Math.abs(CF.vel) > 0.02) { CF.p += CF.vel * dt; CF.vel *= Math.pow(0.05, dt); if (Math.abs(CF.vel) <= 0.3) { CF.target = Math.round(CF.p); CF.vel = 0; } }
    else { const diff = cfWrap(CF.target - CF.p, n); CF.p += diff * Math.min(1, dt * 7); if (Math.abs(diff) < 0.002) CF.p = CF.target;
      if (now > CF.pauseUntil && !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches && CF.p === CF.target) { CF.target = CF.target + 1; CF.pauseUntil = now + 6000; } }
  }
  cards.forEach((c, i) => { const d = cfWrap(i - CF.p, n), a = Math.abs(d), sg = Math.sign(d);
    c.style.transform = `translate(-50%, -50%) translateX(${d * stepX}px) translateZ(${-a * 150}px) rotateY(${-sg * Math.min(a, 2.2) * rot}deg) scale(${Math.max(.7, 1 - a * .07)})`;
    c.style.filter = `brightness(${Math.max(.3, 1 - a * .28)})`; c.style.opacity = a > 2.7 ? 0 : a > 2.2 ? (2.7 - a) / .5 : 1; c.style.zIndex = 30 - Math.round(a * 10);
    c.classList.toggle("is-active", a < .5); });
  const act = ((Math.round(CF.p) % n) + n) % n;
  if (act !== CF.active) { CF.active = act; S.view.cfIdx = act; const f = cfFilms()[act]; if (f) {
    const ov = $("[data-cf-overlay]", box); if (ov) { ov.innerHTML = cfOverlay(f); ov.classList.remove("cf-in"); void ov.offsetWidth; ov.classList.add("cf-in"); }
    const imgs = $$(".cf-bg-img", box), nxt = imgs[(CF.bg + 1) % 2]; nxt.src = fmeta(f).backdrop || f.img || ""; imgs.forEach((im, k) => im.classList.toggle("is-on", k === (CF.bg + 1) % 2)); CF.bg = (CF.bg + 1) % 2;
    $$("[data-act=cf-dot]", box).forEach((d, i) => d.setAttribute("aria-selected", String(i === act))); const ctr = $("[data-cf-counter]", box); if (ctr) ctr.textContent = act + 1; } }
  CF.raf = requestAnimationFrame(cfFrame);
}
function cfGo(v) { const box = $("[data-cf]"); if (!box) return; const n = +box.dataset.n; CF.vel = 0;
  if (v === "next") CF.target = Math.round(CF.p) + 1; else if (v === "prev") CF.target = Math.round(CF.p) - 1; else CF.target = Math.round(CF.p) + cfWrap(+v - Math.round(CF.p), n);
  CF.pauseUntil = performance.now() + 7000; }
function cfAuto() {
  const box = $("[data-cf]"); if (!box) return; CF.t = 0; CF.active = -1;
  if (!box.dataset.bound) { box.dataset.bound = "1"; CF.p = CF.target = Math.round(S.view.cfIdx || 0); CF.vel = 0; CF.pauseUntil = performance.now() + 6000;
    const stage = $("[data-cf-stage]", box), kpx = () => 1 / (innerWidth < 640 ? 150 : 330);   // thẻ / px kéo
    stage.addEventListener("pointerdown", e => { if (e.button) return; CF.drag = { x: e.clientX, p: CF.p, moved: false, lastX: e.clientX, lastT: performance.now(), v: 0 }; CF.vel = 0; });
    stage.addEventListener("pointermove", e => { const d = CF.drag; if (!d) return; const now = performance.now(); CF.p = d.p - (e.clientX - d.x) * kpx(); if (Math.abs(e.clientX - d.x) > 6) d.moved = true; const dt = Math.max(1, now - d.lastT); d.v = -(e.clientX - d.lastX) * kpx() / dt * 1000; d.lastX = e.clientX; d.lastT = now; });
    const end = () => { const d = CF.drag; if (!d) return; CF.drag = null; CF.vel = Math.max(-6, Math.min(6, d.v)); if (Math.abs(CF.vel) <= 0.3) { CF.vel = 0; CF.target = Math.round(CF.p); } CF.pauseUntil = performance.now() + 7000; if (d.moved) { stage.dataset.swiped = "1"; setTimeout(() => delete stage.dataset.swiped, 80); } };
    addEventListener("pointerup", end); addEventListener("pointercancel", end);   // thả chuột ngoài khung vẫn kết thúc kéo; không bắt pointer để click vào thẻ còn tới được thẻ
    stage.addEventListener("wheel", e => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 20) { e.preventDefault(); cfGo(e.deltaX > 0 ? "next" : "prev"); } }, { passive: false });
    box.addEventListener("keydown", e => { if (e.key === "ArrowRight") cfGo("next"); if (e.key === "ArrowLeft") cfGo("prev"); });
    box.addEventListener("mouseenter", () => { CF.pauseUntil = Infinity; }); box.addEventListener("mouseleave", () => { CF.pauseUntil = performance.now() + 3000; });
  }
  if (!CF.raf) CF.raf = requestAnimationFrame(cfFrame);
}
/* tương thích với app.js cũ */
const heroAuto = cfAuto, heroGo = cfGo;

/** Đặt vé nhanh: Rạp → Phim → Ngày → Suất → Đặt */
function quickBookHtml() {
  const qb = S.view.qb || (S.view.qb = {}), c = CINEMAS.some(x => x.id === qb.cinema) ? cinema(qb.cinema) : curCinema();
  const ss = showsOf(c.id).filter(s => new Date(s.start) > new Date());
  const films = S.films.filter(f => ss.some(s => s.filmId === f.id)), fid = films.some(f => f.id === qb.film) ? qb.film : (films[0] || {}).id;
  const days = [...new Set(ss.filter(s => s.filmId === fid).map(s => dayKey(s.start)))].sort((a, b) => new Date(a) - new Date(b)), day = days.includes(qb.day) ? qb.day : days[0];
  const times = ss.filter(s => s.filmId === fid && dayKey(s.start) === day).sort((a, b) => new Date(a.start) - new Date(b.start)), sid = times.some(s => s.id === qb.show) ? qb.show : (times[0] || {}).id;
  const col = (label, inner) => `<label class="grid gap-1 text-xs font-medium text-muted">${label}${inner}</label>`;
  return `<section class="glass relative z-20 -mt-10 mb-8 rounded-2xl p-3 sm:mx-6 sm:-mt-12 sm:p-4" aria-label="Đặt vé nhanh">
    <div class="grid gap-2 sm:grid-cols-[1.2fr_1.2fr_1fr_1fr_auto] sm:items-end">
      ${col("Rạp", selectBox("qb-cinema", CINEMAS.map(x => [x.id, x.name]), c.id, { act: "qb-cinema" }))}
      ${col("Phim", selectBox("qb-film", films.map(f => [f.id, f.title]), fid, { act: "qb-film", placeholder: "Chưa có suất" }))}
      ${col("Ngày", selectBox("qb-day", days.map(d => [d, dayLabel(d)]), day, { act: "qb-day", placeholder: "—" }))}
      ${col("Suất", selectBox("qb-show", times.map(s => [s.id, `${hhmm(s.start)} · ${formatOf(s)}${freeSeats(s) === 0 ? " · hết ghế" : ""}`]), sid, { act: "qb-show", placeholder: "—" }))}
      <button type="button" class="${B.primary} min-h-11 sm:min-h-10" data-act="quick-book" ${sid ? "" : "disabled"}>${ic("zap")}Đặt vé nhanh</button>
    </div></section>`;
}
const SECTION_HEAD = (title, sub = "", right = "") => `<div class="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 class="text-xl font-bold tracking-tight">${title}</h2>${sub ? `<p class="mt-0.5 text-sm text-muted">${sub}</p>` : ""}</div>${right}</div>`;
const PERKS = [
  ["popcorn", "Combo bắp nước", "Đặt kèm vé, nhận tại quầy không xếp hàng. Combo 2 người từ 79.000 đ.", "Ưu đãi"],
  ["badge-check", "Xác thực VNeID một lần", "Mua vé trẻ em, U22, người cao tuổi online; phim T13–T18 không phải trình giấy tờ ở cửa.", "Tiện ích"],
  ["qr-code", "QR vé đổi mỗi 15 giây", "Vé điện tử chống chụp màn hình, một QR cho cả nhóm bạn. Quên vé? Nhân viên tra theo khuôn mặt.", "An toàn"],
  ["users", "Vé đoàn cho trường học", "Giáo viên xác thực một lần, kiểm tra tuổi cả lớp theo danh sách, một mã QR cho cả đoàn.", "Trường học"],
  ["gift", "Hoàn vé về thẻ quà tặng", "Hoàn vé trước giờ chiếu, tiền về thẻ quà tặng dùng 180 ngày; tích 5% điểm mỗi lần mua.", "Thành viên"],
  ["map-pin", "7 cơ sở · 4 tỉnh/thành", "Nghệ An, Hà Nội, TP. Hồ Chí Minh, Đà Nẵng. Vé của bạn hiện theo rạp đã chọn.", "Hệ thống"],
];
function footerHtml() {
  const c = curCinema();
  return `<footer class="mt-12 border-t border-border bg-surface">
    <div class="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
      <div>${LOGO}<p class="mt-3 text-pretty text-sm text-muted">Hệ thống bán vé xem phim chuỗi nhiều cơ sở, xác thực độ tuổi bằng VNeID và FaceID. Demo đồ án Nhóm 05 – Đại học Vinh.</p></div>
      <nav aria-label="Phim"><h3 class="mb-2 text-sm font-semibold">Phim</h3><ul class="grid gap-1.5 text-sm text-muted"><li><a href="#/home" class="hover:text-foreground">Đang chiếu</a></li><li><a href="#/home" data-act="home-tab" data-v="sapchieu" class="hover:text-foreground">Sắp chiếu</a></li><li><a href="#/lich" class="hover:text-foreground">Lịch chiếu theo rạp</a></li></ul></nav>
      <nav aria-label="Hỗ trợ"><h3 class="mb-2 text-sm font-semibold">Hỗ trợ</h3><ul class="grid gap-1.5 text-sm text-muted"><li><a href="#/ve" class="hover:text-foreground">Vé của tôi</a></li><li><a href="#/doan" class="hover:text-foreground">Vé đoàn trường học</a></li><li><a href="#/taikhoan" class="hover:text-foreground">Liên kết VNeID</a></li></ul></nav>
      <div><h3 class="mb-2 text-sm font-semibold">${esc(c.name)}</h3><address class="not-italic text-sm text-muted">${esc(c.address)}<br>${esc(c.district)}, ${esc(c.city)}<br>Hotline <a href="tel:${esc(c.hotline.replace(/\s/g, ""))}" class="font-medium text-foreground">${esc(c.hotline)}</a> · 8:00 – 22:00</address></div>
    </div>
    <div class="border-t border-border"><p class="mx-auto max-w-[1200px] px-4 py-4 text-xs text-muted sm:px-6">© 2026 CineVin · Nhãn phim theo Luật Điện ảnh 2022: P, K, T13, T16, T18 · Ảnh minh hoạ Unsplash.</p></div>
  </footer>`;
}

/* ---------- Trang chủ ---------- */
function vHome() {
  const tab = S.view.homeTab === "sapchieu" ? "sapchieu" : "dangchieu", c = curCinema();
  const showing = nowShowing().sort((a, b) => (fmeta(b).hot ? 1 : 0) - (fmeta(a).hot ? 1 : 0)), soon = comingSoon();
  const loading = !S.shows.length && Remote.status === "connecting";
  const grid = list => `<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">${list.join("")}</div>`;
  const films = tab === "dangchieu"
    ? (loading ? `<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">${skelRows(5, "aspect-[2/3]")}</div>` : showing.length ? grid(showing.map(f => POSTER_CARD(f))) : card(emptyState("film", "Chưa có phim đang chiếu", "Quản lý chưa xếp lịch. Quay lại sau.")))
    : soon.length ? grid(soon.map(f => POSTER_CARD(f, { upcoming: true }))) : card(emptyState("calendar", "Chưa có phim sắp chiếu", "Theo dõi để nhận thông báo khi có phim mới."));
  const tabs = seg([["dangchieu", `Đang chiếu`], ["sapchieu", `Sắp chiếu`]], tab, "home-tab");
  const body = `<h1 class="sr-only">CineVin – đặt vé xem phim online tại ${esc(c.name)} và 6 cơ sở khác</h1>
    ${coverflowHtml()}${quickBookHtml()}
    <section class="mb-10" aria-labelledby="h-phim">${SECTION_HEAD(`<span id="h-phim">${tab === "dangchieu" ? "Phim đang chiếu" : "Phim sắp chiếu"}</span>`, tab === "dangchieu" ? `Tại ${esc(c.name)} và toàn hệ thống · lịch 10 ngày tới` : "Đặt lịch nhắc để không bỏ lỡ suất đầu tiên", tabs)}${films}</section>
    <section class="mb-10" aria-labelledby="h-uudai">${SECTION_HEAD(`<span id="h-uudai">Ưu đãi và tiện ích</span>`, "Những thứ làm CineVin khác rạp thường")}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${PERKS.map(([i, t, d, k]) => `<article class="flex gap-3 rounded-2xl border border-border bg-surface p-4"><span class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-light text-primary">${ic(i, "size-5")}</span><div class="min-w-0"><p class="text-xs font-medium uppercase tracking-wide text-muted">${k}</p><h3 class="mt-0.5 font-semibold">${t}</h3><p class="mt-1 text-pretty text-sm text-muted">${d}</p></div></article>`).join("")}</div></section>
    <section class="mb-6 overflow-hidden rounded-3xl bg-foreground text-surface" aria-labelledby="h-cach">
      <div class="grid gap-6 p-6 sm:grid-cols-[1.1fr_1fr] sm:items-center sm:p-10">
        <div><p class="text-xs font-medium uppercase tracking-wide text-surface/60">Mua vé trong 1 phút</p><h2 id="h-cach" class="mt-1 text-2xl font-bold">Ba bước là có vé</h2>
          <ol class="mt-5 grid gap-4">${[["Chọn phim và suất", "Lịch 10 ngày tại 7 cơ sở, lọc theo rạp hoặc theo phim."], ["Chọn ghế và thanh toán", "Sơ đồ ghế thời gian thực, giữ ghế 5 phút, giá tự áp theo tuổi đã xác thực."], ["Quét QR vào rạp", "QR đổi mỗi 15 giây trong Vé của tôi, không cần đổi vé in."]].map(([t, d], i) => `<li class="flex gap-3"><span class="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">${i + 1}</span><div><p class="font-semibold">${t}</p><p class="text-sm text-surface/70">${d}</p></div></li>`).join("")}</ol>
          <div class="mt-6 flex flex-wrap gap-2"><a href="#/lich" class="${B.primary} min-h-11 px-5">${ic("calendar-days")}Xem lịch chiếu</a>${Auth.user ? "" : `<a href="#/dangky" class="${BTN} min-h-11 border border-white/30 bg-white/10 text-surface hover:bg-white/20">Tạo tài khoản</a>`}</div></div>
        <img src="${HOME_IMG("1478720568477-152d9b164e26")}" alt="Phòng chiếu CineVin" loading="lazy" class="aspect-[4/3] w-full rounded-2xl object-cover">
      </div></section>`;
  return customerShell("home", body, { footer: true, dark: true });
}

/* ---------- Chi tiết phim ---------- */
function vChiTiet() {
  const f = S.films.find(x => x.id === S.view.detailFilm); if (!f) return vHome();
  const m = fmeta(f), up = isUpcoming(f), c = curCinema();
  const days = [...new Set(S.shows.filter(s => s.filmId === f.id && s.status !== "cancelled" && new Date(s.start) > new Date()).map(s => dayKey(s.start)))].sort((a, b) => new Date(a) - new Date(b));
  const day = days.includes(S.view.day) ? S.view.day : days[0];
  const ss = S.shows.filter(s => s.filmId === f.id && s.status !== "cancelled" && dayKey(s.start) === day);
  const byCinema = CINEMAS.map(x => [x, ss.filter(s => cinemaOf(s).id === x.id).sort((a, b) => new Date(a.start) - new Date(b.start))]).filter(z => z[1].length).sort((a, b) => (b[0].id === c.id) - (a[0].id === c.id));
  const sched = up ? banner("info", RELEASE_TXT(f), "Phim chưa mở bán. Bấm Nhắc tôi để nhận thông báo khi có suất.", `<button type="button" class="${B.outline} shrink-0" data-act="remind" data-v="${f.id}">${ic("bell")}Nhắc tôi</button>`)
    : !days.length ? card(emptyState("calendar-x", "Chưa có suất sắp tới", "Quản lý chưa xếp lịch cho phim này."))
    : `<div class="mb-4">${dateStrip(days, day, "lich-day")}</div><div class="grid gap-3">${byCinema.map(([x, list]) => `<article class="rounded-2xl border bg-surface p-4 ${x.id === c.id ? "border-foreground" : "border-border"}"><div class="flex flex-wrap items-start gap-2"><div class="min-w-0 flex-1"><h3 class="font-semibold">${esc(x.name)}${x.id === c.id ? ` <span class="text-xs font-normal text-muted">· rạp đang chọn</span>` : ""}</h3><p class="text-xs text-muted">${esc(x.district)} · ${esc(x.address)}</p></div></div><div class="mt-3 grid gap-2">${byFormat(list).map(([k, l]) => `<div class="flex flex-wrap items-center gap-2">${fmtTag(k)}${l.map(timeChip).join("")}</div>`).join("")}</div></article>`).join("")}</div>`;
  const body = `<nav class="mb-3 text-sm text-muted" aria-label="Đường dẫn"><a href="#/home" class="hover:text-foreground">Trang chủ</a> <span aria-hidden="true">/</span> <span class="text-foreground">${esc(f.title)}</span></nav>
    <section class="relative mb-6 overflow-hidden rounded-3xl bg-foreground text-surface">
      ${m.backdrop ? `<img src="${m.backdrop}" alt="" class="absolute inset-0 size-full object-cover opacity-40 blur-sm" loading="lazy">` : ""}
      <div class="relative grid gap-5 p-5 sm:grid-cols-[180px_1fr] sm:p-8">
        ${f.img ? `<img src="${f.img}" alt="Poster ${esc(f.title)}" class="aspect-[2/3] w-[140px] rounded-2xl object-cover shadow-modal sm:w-full">` : `<div class="grid aspect-[2/3] w-[140px] place-items-center rounded-2xl bg-white/10 sm:w-full">${ic("film", "size-8")}</div>`}
        <div class="min-w-0"><div class="flex flex-wrap items-center gap-2">${rate(f.rating)}${up ? badge(RELEASE_TXT(f), "bg-white/15 text-surface") : m.hot ? badge("Hot", "bg-primary text-primary-foreground") : ""}</div>
          <h1 class="mt-2 text-balance text-2xl font-bold sm:text-3xl">${esc(f.title)}</h1>
          <p class="mt-1 text-sm text-surface/70">${esc(f.genre)} · ${f.dur} phút · ${esc(RATING_TXT[f.rating] || "")}</p>
          <p class="mt-4 max-w-prose text-pretty text-sm text-surface/85">${esc(m.desc || "Chưa có mô tả.")}</p>
          ${m.director || m.cast ? `<dl class="mt-3 grid gap-1 text-sm text-surface/70">${m.director ? `<div><dt class="inline text-surface/50">Đạo diễn: </dt><dd class="inline">${esc(m.director)}</dd></div>` : ""}${m.cast ? `<div><dt class="inline text-surface/50">Diễn viên: </dt><dd class="inline">${esc(m.cast)}</dd></div>` : ""}</dl>` : ""}
          <div class="mt-5 flex flex-wrap gap-2">${up ? `<button type="button" class="${B.primary} min-h-11 px-5" data-act="remind" data-v="${f.id}">${ic("bell")}Nhắc tôi khi mở bán</button>` : `<a href="#suat" class="${B.primary} min-h-11 px-5">${ic("ticket")}Chọn suất</a>`}<button type="button" class="${BTN} min-h-11 border border-white/30 bg-white/10 text-surface hover:bg-white/20" data-act="share-film" data-v="${f.id}">${ic("share-2")}Chia sẻ</button></div></div>
      </div></section>
    <section id="suat" aria-labelledby="h-suat">${SECTION_HEAD(`<span id="h-suat">Lịch chiếu</span>`, up ? "" : "Chọn ngày rồi bấm giờ chiếu; đăng nhập khi chọn ghế.")}${sched}</section>`;
  return customerShell("lich", body, { footer: true });
}

/* ---------- Popup khuyến mại khi vào trang chủ (một lần mỗi phiên) ---------- */
function promoHtml() {
  return `<div class="-m-5 overflow-hidden rounded-2xl sm:-m-6">
    <div class="relative aspect-[16/9]"><img src="${HOME_IMG("1512149177596-f817c7ef5d4c")}" alt="" class="size-full object-cover"><div class="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent"></div>
      <button type="button" class="absolute right-3 top-3 grid size-9 cursor-pointer place-items-center rounded-full bg-white/25 text-white backdrop-blur hover:bg-white/40" data-m="close" aria-label="Đóng">${ic("x", "size-5")}</button>
      <div class="absolute inset-x-0 bottom-0 p-5 text-white"><p class="text-xs font-medium uppercase tracking-wide text-white/80">Chào thành viên mới</p><h2 class="mt-1 text-2xl font-bold">Giảm 10% + combo bắp nước 79K</h2></div></div>
    <div class="grid gap-3 p-5 sm:p-6"><p class="text-pretty text-sm text-muted">Nhập mã <b class="font-mono text-foreground">CHAONHOM05</b> ở bước thanh toán, mỗi tài khoản một lần. Liên kết VNeID để được giá U22, trẻ em, người cao tuổi ngay trên web.</p>
      <div class="flex flex-wrap gap-2"><button type="button" class="${B.primary} flex-1" data-act="promo-go">${ic("ticket")}Đặt vé ngay</button><button type="button" class="${B.outline}" data-act="promo-copy">${ic("copy")}Sao chép mã</button><button type="button" class="${B.ghost}" data-m="close">Để sau</button></div></div></div>`;
}
let PROMO_SHEET = null;
function maybePromo() {
  let seen = false; try { seen = sessionStorage.getItem("cinevin-promo") === "1"; } catch (e) {}
  if (seen || PROMO_SHEET || $("#modal-root").innerHTML) return;
  try { sessionStorage.setItem("cinevin-promo", "1"); } catch (e) {}
  setTimeout(() => { if (routeName() !== "home" && routeName() !== "") return; PROMO_SHEET = openSheet(promoHtml(), { label: "Khuyến mại", onClose: () => { PROMO_SHEET = null; } });
    // sheet tự xử lý nút của mình (bộ bắt click toàn cục bỏ qua #modal-root)
    PROMO_SHEET.el.onclick = e => { const b = e.target.closest("[data-act]"); if (b && A[b.dataset.act]) { A[b.dataset.act](b); return; } if (e.target.closest('[data-m="close"]') && PROMO_SHEET) PROMO_SHEET.close(); }; }, 900);
}
