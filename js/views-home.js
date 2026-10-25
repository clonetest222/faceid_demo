/* Trang chủ công khai + chi tiết phim (khách vãng lai xem được, đăng nhập khi chọn ghế).
   Bố cục: hero (phim hot / ưu đãi) → đặt vé nhanh → Đang chiếu | Sắp chiếu → ưu đãi & tiện ích → cách mua vé → footer. */
"use strict";
const HOME_IMG = id => `https://images.unsplash.com/photo-${id}?w=1600&q=70&auto=format&fit=crop`;
/** Dữ liệu mô tả phim, ngày khởi chiếu, ảnh nền – nằm ngoài CSDL (server chỉ lưu id, tên, nhãn, thời lượng, poster) */
const FILM_META = {
  f1: { desc: "Cậu bé tí hon Tin cùng nhóm bạn đồ chơi lên đường cứu khu vườn khỏi lũ sâu khổng lồ. Phim hoạt hình gia đình, lồng tiếng Việt.", backdrop: HOME_IMG("1558060370-d644479cb6f7"), hot: true },
  f2: { desc: "Chú mèo Mướp lạc giữa thành phố lớn và hành trình tìm đường về nhà với sự giúp đỡ của những người bạn bốn chân.", backdrop: HOME_IMG("1514888286974-6c03e2ca1dba") },
  f3: { desc: "Hai anh em vượt dãy Hồng Lĩnh trong mùa gió chướng để tìm người cha mất tích. Cảnh quay hùng vĩ tại Hà Tĩnh – Nghệ An.", backdrop: HOME_IMG("1506905925346-21bda4d32df4"), hot: true },
  f4: { desc: "Một vụ án khép kín trong phòng số 7 của khách sạn cổ. Mỗi nhân chứng kể một câu chuyện khác nhau. Ai nói dối?", backdrop: HOME_IMG("1517604931442-7e0c8ed2963c"), hot: true },
  f5: { desc: "Đêm xuống, phố cổ không còn là nơi của người sống. Phim kinh dị Việt gắn nhãn T18, không dành cho người yếu tim.", backdrop: HOME_IMG("1509248961158-e54f6934749c") },
  f6: { desc: "Phi hành đoàn Aurora mắc kẹt trên hành tinh băng khi ngôi sao chủ sắp tắt. Bom tấn khoa học viễn tưởng định dạng IMAX.", backdrop: HOME_IMG("1446776653964-20c1d3a81b06") },
  f7: { desc: "Mùa hè kỳ diệu của cô bé Nấm ở làng chài, nơi những chiếc thuyền biết kể chuyện. Hoạt hình Việt Nam cho cả gia đình.", backdrop: HOME_IMG("1462331940025-496dfbfc7564") },
  f8: { desc: "Thám tử Lâm lần theo kẻ săn mồi chỉ ra tay trong đêm mưa. Hồi hộp tới phút cuối, nhãn T16.", backdrop: HOME_IMG("1485846234645-a62644f84728") },
};
const fmeta = f => FILM_META[f.id] || { desc: "", backdrop: f.img, hot: false };
const RELEASE_TXT = f => f.release ? `Khởi chiếu ${ddmm(new Date(f.release))}` : "";
/** Phim có suất từ hôm nay trở đi (đang chiếu) và phim sắp chiếu (chưa có suất, có ngày khởi chiếu tương lai) */
/* đang chiếu = có suất từ hôm nay trở đi ở bất kỳ cơ sở nào (phim thử nghiệm không có suất thì không hiện) */
const nowShowing = () => { const t0 = new Date(); t0.setHours(0, 0, 0, 0); return S.films.filter(f => f.active !== false && !isUpcoming(f) && S.shows.some(s => s.filmId === f.id && s.status !== "cancelled" && new Date(s.start) >= t0)); };
const comingSoon = () => S.films.filter(f => f.active !== false && isUpcoming(f)).sort((a, b) => new Date(a.release) - new Date(b.release));
const firstShowOf = fid => S.shows.filter(s => s.filmId === fid && s.status !== "cancelled" && new Date(s.start) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start))[0];

/* ---------- các mảnh ---------- */
const POSTER_CARD = (f, { upcoming = false } = {}) => `<article class="group grid content-start gap-2.5">
  <button type="button" data-act="film-detail" data-v="${f.id}" class="relative block aspect-[2/3] w-full cursor-pointer overflow-hidden rounded-2xl bg-secondary text-left" aria-label="Chi tiết ${esc(f.title)}">
    ${f.img ? `<img src="${f.img}" alt="Poster ${esc(f.title)}" loading="lazy" class="size-full object-cover transition-transform duration-500 group-hover:scale-105">` : `<span class="grid size-full place-items-center text-muted">${ic("film", "size-8")}</span>`}
    <span class="absolute left-2 top-2">${rate(f.rating)}</span>
    ${upcoming ? `<span class="absolute bottom-2 left-2 rounded-md bg-foreground/80 px-2 py-0.5 text-xs font-medium text-surface backdrop-blur">${RELEASE_TXT(f)}</span>` : fmeta(f).hot ? `<span class="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">${ic("flame", "size-3")}Hot</span>` : ""}
  </button>
  <div class="min-w-0"><h3 class="line-clamp-1 text-sm font-semibold">${esc(f.title)}</h3><p class="text-xs text-muted">${esc(f.genre)} · ${f.dur} phút</p></div>
  ${upcoming ? `<button type="button" class="${B.outline} min-h-9" data-act="remind" data-v="${f.id}">${ic("bell")}Nhắc tôi</button>`
    : `<div class="flex gap-2"><button type="button" class="${B.primary} min-h-9 flex-1" data-act="film-book" data-v="${f.id}">${ic("ticket")}Đặt vé</button><button type="button" class="${B.icon} size-9 border border-border-strong bg-surface" data-act="film-detail" data-v="${f.id}" aria-label="Chi tiết ${esc(f.title)}">${ic("info")}</button></div>`}
</article>`;

function heroSlides() {
  const hot = nowShowing().filter(f => fmeta(f).hot).slice(0, 3);
  const slides = hot.map(f => ({ img: fmeta(f).backdrop, tag: `Đang chiếu · ${esc(f.genre)}`, title: f.title, text: fmeta(f).desc, rating: f.rating, cta: `<button type="button" class="${B.primary} min-h-11 px-5" data-act="film-book" data-v="${f.id}">${ic("ticket")}Đặt vé ngay</button><button type="button" class="${BTN} min-h-11 border border-white/40 bg-white/15 text-white backdrop-blur hover:bg-white/25" data-act="film-detail" data-v="${f.id}">Chi tiết</button>` }));
  slides.push({ img: HOME_IMG("1578849278619-e73505e9610f"), tag: "Ưu đãi tháng này", title: "Combo bắp nước đồng giá 79.000 đ", text: "Bắp rang bơ cỡ lớn + 2 nước ngọt khi mua vé online. Áp dụng tại mọi cơ sở CineVin.", cta: `<a href="#/lich" class="${B.primary} min-h-11 px-5">${ic("popcorn")}Xem lịch chiếu</a>` });
  slides.push({ img: HOME_IMG("1489599849927-2ee91cede3ba"), tag: "Thành viên mới", title: "Giảm 10% với mã CHAONHOM05", text: "Tạo tài khoản, liên kết VNeID một lần để mua vé trẻ em, U22, người cao tuổi ngay trên web – không cần ra quầy.", cta: `<button type="button" class="${B.primary} min-h-11 px-5" data-act="promo-copy">${ic("copy")}Sao chép mã</button>${Auth.user ? "" : `<a href="#/dangky" class="${BTN} min-h-11 border border-white/40 bg-white/15 text-white backdrop-blur hover:bg-white/25">Tạo tài khoản</a>`}` });
  return slides;
}
function heroHtml() {
  const slides = heroSlides();
  return `<section class="relative -mx-4 mb-6 overflow-hidden sm:mx-0 sm:rounded-3xl" data-hero aria-roledescription="carousel" aria-label="Phim nổi bật và ưu đãi">
    <div class="relative aspect-[4/5] sm:aspect-[21/9] min-h-[380px]">
      ${slides.map((s, i) => `<div class="hero-slide absolute inset-0 transition-opacity duration-700 ${i ? "opacity-0" : ""}" data-slide="${i}" ${i ? 'aria-hidden="true"' : ""}>
        <img src="${s.img}" alt="" class="size-full object-cover" ${i ? 'loading="lazy"' : ""}>
        <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10 sm:bg-gradient-to-r sm:from-black/80 sm:via-black/40 sm:to-transparent"></div>
        <div class="absolute inset-x-0 bottom-0 p-5 sm:inset-y-0 sm:left-0 sm:flex sm:max-w-[560px] sm:flex-col sm:justify-center sm:p-10">
          <div class="glass-dark rounded-2xl p-4 sm:p-6 text-white">
            <p class="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-white/80">${s.rating ? rate(s.rating) : ""}${s.tag}</p>
            <h2 class="text-balance text-2xl font-bold leading-tight sm:text-3xl">${esc(s.title)}</h2>
            <p class="mt-2 line-clamp-2 text-pretty text-sm text-white/85 sm:line-clamp-3">${esc(s.text)}</p>
            <div class="mt-4 flex flex-wrap gap-2">${s.cta}</div>
          </div>
        </div></div>`).join("")}
      <div class="absolute bottom-14 right-4 z-10 flex items-center gap-1.5 sm:bottom-16 sm:right-6" role="tablist" aria-label="Chọn slide">${slides.map((_, i) => `<button type="button" role="tab" aria-selected="${!i}" data-act="hero-dot" data-v="${i}" class="h-2 cursor-pointer rounded-full bg-white/60 transition-all aria-selected:w-6 aria-selected:bg-white w-2" aria-label="Slide ${i + 1}"></button>`).join("")}</div>
      <button type="button" class="absolute left-3 top-1/2 z-10 hidden size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/20 text-white backdrop-blur hover:bg-white/35 sm:grid" data-act="hero-dot" data-v="prev" aria-label="Slide trước">${ic("chevron-left", "size-5")}</button>
      <button type="button" class="absolute right-3 top-1/2 z-10 hidden size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/20 text-white backdrop-blur hover:bg-white/35 sm:grid" data-act="hero-dot" data-v="next" aria-label="Slide sau">${ic("chevron-right", "size-5")}</button>
    </div></section>`;
}
/* chuyển slide bằng DOM, không vẽ lại trang */
let HERO_TIMER = null;
function heroGo(v) {
  const box = $("[data-hero]"); if (!box) return;
  const slides = $$(".hero-slide", box), dots = $$("[data-act=hero-dot][data-v]", box).filter(d => /^\d+$/.test(d.dataset.v));
  let cur = slides.findIndex(s => !s.classList.contains("opacity-0")); if (cur < 0) cur = 0;
  const n = slides.length, next = v === "next" ? (cur + 1) % n : v === "prev" ? (cur - 1 + n) % n : Math.min(n - 1, Math.max(0, +v));
  slides.forEach((s, i) => { s.classList.toggle("opacity-0", i !== next); s.toggleAttribute("aria-hidden", i !== next); });
  dots.forEach((d, i) => d.setAttribute("aria-selected", String(i === next)));
}
function heroAuto() { clearInterval(HERO_TIMER); HERO_TIMER = setInterval(() => { if (!$("[data-hero]")) return clearInterval(HERO_TIMER); if (document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) return; heroGo("next"); }, 5500); }

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
    ${heroHtml()}${quickBookHtml()}
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
  return customerShell("home", body, { footer: true });
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
  setTimeout(() => { if (routeName() !== "home" && routeName() !== "") return; PROMO_SHEET = openSheet(promoHtml(), { label: "Khuyến mại", onClose: () => { PROMO_SHEET = null; } }); }, 900);
}
