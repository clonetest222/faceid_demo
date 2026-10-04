/* Remote – dữ liệu dùng chung qua Supabase (Postgres + Realtime).
   Đọc: tải một lần rồi nhận thay đổi realtime. Ghi: gọi hàm RPC (giữ ghế, bán vé, soát vé…) chạy nguyên tử phía server.
   Không cấu hình hoặc không kết nối được → app chạy ngoại tuyến như cũ. */
"use strict";
const Remote = (() => {
  const cfg = window.CINEVIN_CONFIG || {};
  let sb = null, online = false, status = "offline", listeners = [];
  const DEVICE = (() => { try { let d = localStorage.getItem("cinevin-device"); if (!d) { d = rid("DV", 8); localStorage.setItem("cinevin-device", d); } return d; } catch (e) { return rid("DV", 8); } })();
  const emit = () => listeners.forEach(f => f(status));

  const mapShow = r => ({ id: r.id, filmId: r.film_id, roomId: r.room_id, start: r.start_at, end: r.end_at });
  const mapTicket = r => ({ code: r.code, orderId: r.order_id, owner: r.device_id === DEVICE && r.channel === "Online" ? "user" : "other", showId: r.show_id, seat: r.seat, viewerName: r.viewer_name, aud: r.aud, verified: r.verified, needDoc: r.need_doc, reason: r.reason, price: Number(r.price), status: r.status, channel: r.channel });
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
      const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - 1);
      const [sh, tk, gr, lg] = await Promise.all([
        sb.from("shows").select("*").gte("start_at", since.toISOString()).order("start_at"),
        sb.from("tickets").select("*").gte("created_at", since.toISOString()),
        sb.from("groups").select("*, group_members(*)").gte("created_at", since.toISOString()),
        sb.from("audit_logs").select("*").order("id", { ascending: false }).limit(300),
      ]);
      for (const r of [sh, tk, gr, lg]) if (r.error) throw r.error;
      const ids = sh.data.map(r => r.id);
      const lk = ids.length ? await sb.from("seat_locks").select("*").in("show_id", ids) : { data: [] };
      if (lk.error) throw lk.error;
      S.shows = sh.data.map(mapShow);
      S.seats = {}; S.shows.forEach(s => S.seats[s.id] = {});
      lk.data.forEach(l => { (S.seats[l.show_id] ||= {})[l.seat] = { st: l.status, by: l.hold_id, until: l.until, grp: l.grp }; });
      S.tickets = tk.data.map(mapTicket);
      S.groups = gr.data.map(g => mapGroup(g, g.group_members || []));
      S.logs = lg.data.map(mapLog);
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
    on("seat_locks", p => { if (p.eventType === "DELETE") { if (S.seats[p.old.show_id]) delete S.seats[p.old.show_id][p.old.seat]; return; } const l = p.new; (S.seats[l.show_id] ||= {})[l.seat] = { st: l.status, by: l.hold_id, until: l.until, grp: l.grp }; });
    on("tickets", p => { if (p.eventType === "DELETE") { S.tickets = S.tickets.filter(t => t.code !== p.old.code); return; } const t = mapTicket(p.new), i = S.tickets.findIndex(x => x.code === t.code); i >= 0 ? S.tickets[i] = t : S.tickets.push(t); });
    on("groups", p => { if (p.eventType === "DELETE") { S.groups = S.groups.filter(g => g.code !== p.old.code); return; } const old = S.groups.find(x => x.code === p.new.code); const g = mapGroup(p.new, []); g.students = old ? old.students : []; old ? Object.assign(old, g) : S.groups.push(g); });
    on("group_members", p => { if (p.eventType === "DELETE") return; const m = mapMember(p.new), g = S.groups.find(x => x.code === p.new.group_code); if (!g) return; const i = g.students.findIndex(x => x.card === m.card); i >= 0 ? Object.assign(g.students[i], m) : (g.students.push(m), g.students.sort((a, b) => a.idx - b.idx)); });
    on("audit_logs", p => { if (p.eventType === "INSERT") { S.logs.unshift(mapLog(p.new)); S.logs = S.logs.slice(0, 400); } });
    ch.subscribe(st => { status = st === "SUBSCRIBED" ? "online" : (st === "CLOSED" || st === "CHANNEL_ERROR" || st === "TIMED_OUT") ? "reconnecting" : status; emit(); });
  }

  /** Tìm một vé chưa có trong bộ nhớ (ví dụ vừa bán ở máy khác, realtime chưa kịp tới). */
  async function fetchTicket(code) { const { data } = await sb.from("tickets").select("*").eq("code", code).maybeSingle(); return data ? mapTicket(data) : null; }
  async function fetchGroup(code) { const { data } = await sb.from("groups").select("*, group_members(*)").eq("code", code).maybeSingle(); return data ? mapGroup(data, data.group_members || []) : null; }

  return {
    init, rpc, fetchTicket, fetchGroup, DEVICE,
    get online() { return online; }, get status() { return status; },
    onStatus(f) { listeners.push(f); },
  };
})();
