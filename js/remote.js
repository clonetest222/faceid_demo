/* Remote – dữ liệu dùng chung qua Supabase (Postgres + Realtime).
   Đọc: tải một lần rồi nhận thay đổi realtime. Ghi: gọi hàm RPC (giữ ghế, bán vé, soát vé…) chạy nguyên tử phía server.
   Không cấu hình hoặc không kết nối được → app chạy ngoại tuyến như cũ. */
"use strict";
const Remote = (() => {
  const cfg = window.CINEVIN_CONFIG || {};
  let sb = null, online = false, status = "offline", listeners = [], v2 = false, v4 = null, v5 = null, v6 = null, v8 = null, v11 = false, catTimer = null;
  /** Danh mục rạp/phòng (006) và phim/phân phối (008) từ máy chủ → thay dữ liệu mẫu trong app */
  async function reloadCatalog() {
    if (!sb || !v6) return;
    const [c, r] = await Promise.all([sb.from("cinemas").select("*").order("id"), sb.from("rooms").select("*").order("id")]);
    const cat = { cinemas: c.error ? null : c.data, rooms: r.error ? null : r.data };
    if (v8) { const [f, cf, st] = await Promise.all([sb.from("films").select("*").order("created_at"), sb.from("cinema_films").select("*"), sb.from("seat_types").select("*")]); cat.films = f.error ? null : f.data; cat.cinemaFilms = cf.error ? null : cf.data; v11 = !st.error; cat.seatTypes = st.error ? null : st.data; }
    applyCatalog(cat);
  }
  const DEVICE = (() => { try { let d = localStorage.getItem("cinevin-device"); if (!d) { d = rid("DV", 8); localStorage.setItem("cinevin-device", d); } return d; } catch (e) { return rid("DV", 8); } })();
  const emit = () => listeners.forEach(f => f(status));

  // mã rạp: cột cinema_id (006) hoặc suy từ mã phòng "<rạp>-<phòng>"; dữ liệu cũ phòng "R1" → rạp đầu tiên
  const mapShow = r => ({ id: r.id, filmId: r.film_id, roomId: r.room_id, cinemaId: r.cinema_id || (String(r.room_id).includes("-") ? String(r.room_id).split("-")[0] : "086"), format: r.format || null, start: r.start_at, end: r.end_at, status: r.status || "on", cancelReason: r.cancel_reason || null });
  const mapTicket = r => ({ code: r.code, orderId: r.order_id, ownerUser: r.owner_user || null, viewerUser: r.viewer_user || null, device: r.device_id, owner: r.device_id === DEVICE && r.channel === "Online" ? "user" : "other", showId: r.show_id, seat: r.seat, viewerName: r.viewer_name, aud: r.aud, verified: r.verified, needDoc: r.need_doc, reason: r.reason, price: Number(r.price), status: r.status, channel: r.channel });
  const mapMember = m => ({ id: m.card, card: m.card, idx: m.idx, name: m.name, dob: m.dob, cls: m.cls, entered: m.entered, spot: m.spot });
  const mapGroup = (g, members) => ({ id: g.code, code: g.code, showId: g.show_id, seats: g.seats, teacher: g.teacher, teacherKey: g.teacher_key, org: g.org, total: Number(g.total), status: g.status, counted: g.counted, enteredCount: g.entered_count, faceOk: g.face_ok, faceScore: g.face_score, students: members.map(mapMember).sort((a, b) => a.idx - b.idx) });
  const mapLog = l => ({ t: l.t, type: l.type, msg: l.msg, ok: l.ok });

  async function rpc(name, args) { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data; }

  /** Kết nối, tạo lịch chiếu trong ngày nếu chưa có, tải dữ liệu vào S và lắng nghe realtime. */
  async function init(S, schedule, onChange) {
    if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) return false;
    status = "connecting"; emit();
    try {
      if (sb) { try { await sb.removeAllChannels(); } catch (e) {} }
      else sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      await rpc("ensure_schedule", { p_shows: schedule.rows, p_sold: schedule.sold });
      // migration 006: danh mục rạp/phòng của chuỗi (không có hàm → máy chủ chưa chạy 006, chạy theo mã phòng)
      if (v6 === null && typeof CINEMAS !== "undefined") { try { await rpc("ensure_cinemas", { p_cinemas: CINEMAS, p_rooms: ROOMS.map(r => ({ id: r.id, cinema_id: r.cinemaId, name: r.name, kind: r.kind, rows: r.rows, cols: r.cols, vip: r.vip, blocked: r.blocked, vip_seats: r.vipSeats, couple: r.couple, seat_map: r.seatMap || {} })) }); v6 = true; } catch (e) { v6 = /PGRST202|not find|does not exist/i.test(e.message || "") ? false : null; } }
      // migration 008: kho phim dùng chung + phân phối
      if (v6 && v8 === null && typeof FILMS !== "undefined") { try { await rpc("ensure_films", { p_films: FILMS.map(f => ({ id: f.id, title: f.title, rating: f.rating, dur: f.dur, genre: f.genre, img: f.img })) }); v8 = true; } catch (e) { v8 = /PGRST202|not find|does not exist/i.test(e.message || "") ? false : null; } }
      await reloadCatalog();
      const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - 1);
      // PostgREST trả tối đa 1000 dòng/truy vấn: chuỗi 7 rạp có hàng nghìn khoá ghế → tải theo trang
      const all = async build => { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await build().range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) return out; } };
      const [shRows, tkRows, gr, lg] = await Promise.all([
        all(() => sb.from("shows").select("*").gte("start_at", since.toISOString()).order("start_at")),
        all(() => sb.from("tickets").select("*").gte("created_at", since.toISOString()).order("created_at")),
        sb.from("groups").select("*, group_members(*)").gte("created_at", since.toISOString()),
        sb.from("audit_logs").select("*").order("id", { ascending: false }).limit(300),
      ]);
      for (const r of [gr, lg]) if (r.error) throw r.error;
      const sh = { data: shRows }, tk = { data: tkRows }, ids = sh.data.map(r => r.id);
      const lk = { data: ids.length ? await all(() => sb.from("seat_locks").select("*").in("show_id", ids).order("show_id").order("seat")) : [] };
      // suất kiểu cũ (phòng "R1", trước khi có chuỗi rạp) được ẩn khi đã có suất mang mã rạp; reset_demo xoá hẳn
      const legacy = r => !String(r.room_id).includes("-"), rowsSh = sh.data.some(r => !legacy(r)) ? sh.data.filter(r => !legacy(r)) : sh.data;
      S.shows = rowsSh.map(mapShow);
      S.seats = {}; S.shows.forEach(s => S.seats[s.id] = {});
      lk.data.forEach(l => { if (S.seats[l.show_id]) S.seats[l.show_id][l.seat] = { st: l.status, by: l.hold_id, until: l.until, grp: l.grp }; });
      S.tickets = tk.data.map(mapTicket).filter(t => S.seats[t.showId]);
      S.groups = gr.data.filter(g => S.seats[g.show_id]).map(g => mapGroup(g, g.group_members || []));
      S.logs = lg.data.map(mapLog);
      // bảng nhật ký xác thực (migration 002) – có thì tải, chưa có thì bỏ qua
      const vf = await sb.from("verifications").select("*").order("id", { ascending: false }).limit(60);
      v2 = !vf.error; S.verifs = v2 ? vf.data : [];
      await hasV4(); await hasV5();
      subscribe(S, onChange);
      online = true; status = "online"; emit();
      return true;
    } catch (e) {
      console.warn("Supabase:", e.message || e); online = false; status = "error"; emit(); return false;
    }
  }

  function subscribe(S, onChange) {
    const on = (table, fn) => ch.on("postgres_changes", { event: "*", schema: "public", table }, p => { try { fn(p); onChange(table); } catch (e) { console.warn(e); } });
    const ch = sb.channel("cinevin-db");
    on("shows", p => { if (p.eventType === "DELETE") { S.shows = S.shows.filter(s => s.id !== p.old.id); return; } const s = mapShow(p.new), i = S.shows.findIndex(x => x.id === s.id); i >= 0 ? S.shows[i] = s : S.shows.push(s); S.seats[s.id] ||= {}; });
    // chỉ đăng ký bảng đã có trên máy chủ: kênh realtime có bảng không tồn tại sẽ lỗi cả kênh (mất cả seat_locks)
    for (const t of [...(v6 ? ["cinemas"] : []), ...(v8 ? ["rooms", "films", "cinema_films"] : []), ...(v11 ? ["seat_types"] : [])]) on(t, () => { clearTimeout(catTimer); catTimer = setTimeout(() => reloadCatalog().then(() => onChange(t)).catch(() => {}), 400); });
    on("seat_locks", p => { if (p.eventType === "DELETE") { if (S.seats[p.old.show_id]) delete S.seats[p.old.show_id][p.old.seat]; return; } const l = p.new; (S.seats[l.show_id] ||= {})[l.seat] = { st: l.status, by: l.hold_id, until: l.until, grp: l.grp }; });
    on("tickets", p => { if (p.eventType === "DELETE") { S.tickets = S.tickets.filter(t => t.code !== p.old.code); return; } const t = mapTicket(p.new), i = S.tickets.findIndex(x => x.code === t.code); i >= 0 ? S.tickets[i] = { ...t, ownerUser: t.ownerUser || S.tickets[i].ownerUser, viewerUser: t.viewerUser || S.tickets[i].viewerUser } : S.tickets.push(t); });
    on("groups", p => { if (p.eventType === "DELETE") { S.groups = S.groups.filter(g => g.code !== p.old.code); return; } const old = S.groups.find(x => x.code === p.new.code); const g = mapGroup(p.new, []); g.students = old ? old.students : []; old ? Object.assign(old, g) : S.groups.push(g); });
    on("group_members", p => { if (p.eventType === "DELETE") return; const m = mapMember(p.new), g = S.groups.find(x => x.code === p.new.group_code); if (!g) return; const i = g.students.findIndex(x => x.card === m.card); i >= 0 ? Object.assign(g.students[i], m) : (g.students.push(m), g.students.sort((a, b) => a.idx - b.idx)); });
    on("audit_logs", p => { if (p.eventType === "INSERT") { S.logs.unshift(mapLog(p.new)); S.logs = S.logs.slice(0, 400); } });
    ch.subscribe(st => { status = st === "SUBSCRIBED" ? "online" : (st === "CLOSED" || st === "CHANNEL_ERROR" || st === "TIMED_OUT") ? "reconnecting" : status; emit(); });
    if (v2) sb.channel("cinevin-verif").on("postgres_changes", { event: "INSERT", schema: "public", table: "verifications" }, p => {
      S.verifs = [p.new, ...(S.verifs || []).filter(v => v.id !== p.new.id)].slice(0, 100); onChange("verifications");
    }).subscribe();
  }
  /** Đã chạy migration 004 (đăng nhập + QR ký) chưa: gọi thử session_info với token rỗng */
  async function hasV4() {
    if (v4 !== null) return v4;
    if (!ensureClient()) return (v4 = false);
    try { await rpc("session_info", { p_token: "00000000-0000-0000-0000-000000000000" }); v4 = true; }
    catch (e) { v4 = null; return false; }   // chưa có hàm (PGRST202) hoặc mất mạng: thử lại lần sau
    return v4;
  }
  /** Đã chạy migration 005 (hồ sơ khách, FaceID/VNeID login, voucher) chưa */
  async function hasV5() {
    if (v5 !== null) return v5;
    if (!(await hasV4())) return false;
    try { await rpc("my_vouchers", { p_token: "00000000-0000-0000-0000-000000000000" }); v5 = true; }
    catch (e) { v5 = /not_logged_in/.test(e.message || "") ? true : (/PGRST202|Could not find/.test((e.message || "") + (e.code || "")) ? false : null); }
    return !!v5;
  }
  /** Chỉ tạo client (trang điện thoại ghép nối không cần tải toàn bộ dữ liệu) */
  function ensureClient() {
    if (sb) return true;
    if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) return false;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } }); return true;
  }

  /** Tìm một vé chưa có trong bộ nhớ (ví dụ vừa bán ở máy khác, realtime chưa kịp tới). */
  async function fetchTicket(code) { const { data } = await sb.from("tickets").select("*").eq("code", code).maybeSingle(); return data ? mapTicket(data) : null; }
  async function fetchSeatTicket(show, seat) { const { data } = await sb.from("tickets").select("*").eq("show_id", show).eq("seat", seat).neq("status", "refunded").order("created_at", { ascending: false }).limit(1); return data && data[0] ? mapTicket(data[0]) : null; }
  async function fetchGroup(code) { const { data } = await sb.from("groups").select("*, group_members(*)").eq("code", code).maybeSingle(); return data ? mapGroup(data, data.group_members || []) : null; }

  return {
    init, rpc, fetchTicket, fetchSeatTicket, fetchGroup, ensureClient, hasV4, hasV5, DEVICE,
    get online() { return online; }, get status() { return status; }, get v2() { return v2; }, get v4() { return !!v4; }, get v5() { return !!v5; }, get v6() { return !!v6; }, get v8() { return !!v8; }, get v11() { return !!v11; }, reloadCatalog, get hasClient() { return !!sb; },
    onStatus(f) { listeners.push(f); },
  };
})();
