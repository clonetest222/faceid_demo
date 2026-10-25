/* Seat3D – phòng chiếu 3D bằng three.js (WebGL), dựng theo nghiệp vụ "chọn ghế xem trước góc nhìn" của các rạp ảo:
   • Hình học phòng tính từ sơ đồ 2D của phòng (hàng × ghế, lối đi giữa, ghế VIP / đôi / bảo trì, trạng thái bán – giữ – của bạn):
     bước ghế 0,58 m, bước hàng 1 m, bậc dốc 0,25 m, hàng cong nhẹ, ghế hơi xoay về tâm; màn hình 1,85:1 đặt ở z = 0, ghế ở z > 0.
   • Mỗi ghế có BỘ SỐ ĐO từ vị trí mắt: khoảng cách, góc ngang, góc dọc, độ rộng màn hình trong tầm nhìn (mục tiêu 40°),
     immersion (% của trường nhìn 120°), và ĐIỂM HÌNH HỌC 0–100 theo 4 ưu tiên (cân bằng / đắm chìm / thoải mái / chính giữa).
     Xếp loại: ≥ 0,78 rất tốt · ≥ 0,55 tốt · còn lại kém. "Chọn ghế tốt nhất" = ghế trống điểm cao nhất.
   • Ghế đã bán có NGƯỜI NGỒI (thân, chân, đầu, tóc, tay – màu áo/da/tóc ngẫu nhiên ổn định theo mã ghế).
   • Chế độ "Từ ghế": máy quay ở mắt người ngồi; "Đứng dậy": nhân vật đứng tại ghế, máy quay phía sau trên cao, kéo để xoay, lăn chuột để lùi/tiến, bấm ghế để chọn.
   three.js + RoundedBoxGeometry + mergeGeometries nạp dạng ES module (importmap trong index.html) → window.THREE, window.THREE_X. */
"use strict";
const Seat3D = (() => {
  const PRIO = { balanced: { label: "Cân bằng", w: { fov: .35, angle: .25, vertical: .25, centered: .15 } }, immersion: { label: "Đắm chìm", w: { fov: .6, angle: .15, vertical: .15, centered: .1 } },
    comfort: { label: "Thoải mái", w: { fov: .2, angle: .2, vertical: .45, centered: .15 } }, centered: { label: "Chính giữa", w: { fov: .2, angle: .35, vertical: .1, centered: .35 } } };
  const COLORS = { up: 0x7a1f24, selected: 0xe3343c, near: 0xf59e0b, sold: 0x3d2a2c, held: 0x5b4b4e, mine: 0x1f7a3a, vip: 0x8a5a16, couple: 0x8c2460, blocked: 0x2a2729 };
  const CLOTH = ["#8B2323", "#1E3A5F", "#2D3748", "#2F4F4F", "#7C4A2D", "#4A5568", "#B8860B", "#1F4E5B", "#581845", "#2E4057", "#3D5A45", "#5C3D2E"], SKIN = ["#F7D5B8", "#EAC09F", "#D69C76", "#A66840", "#784421", "#502D17"], HAIR = ["#111111", "#2E1F14", "#4A321E", "#8B6C42", "#5E2918", "#787675"], PANTS = ["#181C24", "#252830", "#141619", "#2F3542", "#3A362D"];
  const deg = r => 180 * r / Math.PI, clamp01 = v => Math.max(0, Math.min(1, v)), hash = s => { let t = 0; for (let i = 0; i < s.length; i++) t = Math.imul(31, t) + s.charCodeAt(i) | 0; return Math.abs(t); };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], ang = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))));
  const st = { el: null, r: null, cam: null, scene: null, key: "", opts: {}, t: null, inst: {}, aud: null, audKey: null, avatar: null, pgeo: null, mode: "seat", eye: null, aim: null, from: null, to: null, t0: 0,
    yaw: 0, pitch: 0, dist: 1, drag: null, raf: 0, dirty: true, scrM: null, texKey: "", ro: null, bound: false, unsupported: false, _focus: null,
    ch: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, moving: false, running: false, view: "first", bob: 0 }, keys: { f: false, b: false, l: false, r: false, run: false }, joy: { x: 0, y: 0 }, near: null, ring: null, lastT: 0, keysBound: false };
  const ready = () => !!(window.THREE && window.THREE_X);
  const onReady = cb => ready() ? cb() : window.addEventListener("three-ready", cb, { once: true });

  /* ---------- hình học phòng từ sơ đồ 2D ---------- */
  const CACHE = new Map();
  function theatreOf(room) {
    const key = room.id + "|" + room.rows + "x" + room.cols + "|" + JSON.stringify(room.layout || null); if (CACHE.has(key)) return CACHE.get(key);
    // layout = mẫu phòng (IMAX, Dolby, 4DX…) + tuỳ chỉnh đã lưu; không có hàm roomLayout (trang độc lập) thì dùng mẫu tiêu chuẩn
    const L = typeof roomLayout === "function" ? roomLayout(room) : { blocks: [Math.ceil(room.cols / 2), room.cols - Math.ceil(room.cols / 2)].filter(b => b > 0), pitch: .58, aisle: 1.1, rowSpacing: 1, rise: .25, firstZ: 6, rowCurve: .006, faceCenter: .6, eyeHeight: 1.18, screen: { width: 12, height: 6.49, bottom: 1.6, curveRadius: 0 }, room: {}, materials: {}, lighting: {}, fovTarget: 40, seatStyle: "standard" };
    const blocks = L.blocks, seating = { rows: room.rows, blocks, pitch: L.pitch, aisle: L.aisle, rowSpacing: L.rowSpacing, rise: L.rise, firstZ: L.firstZ, rowCurve: L.rowCurve, faceCenter: L.faceCenter, eyeHeight: L.eyeHeight, style: L.seatStyle || "standard" };
    const seatW = blocks.reduce((a, b) => a + b * seating.pitch, 0) + seating.aisle * (blocks.length - 1);
    const roomW = Math.max(seatW + 3, +L.room.width || 0, 6), sw = Math.min(roomW - 1.5, Math.max(4, +L.screen.width || 12)), screen = { width: sw, height: sw * ((+L.screen.height || 6.49) / (+L.screen.width || 12)), bottom: +L.screen.bottom || 1.6, curveRadius: Math.max(0, +L.screen.curveRadius || 0) };
    const t = { seating, screen, screenCenter: [0, screen.bottom + screen.height / 2, 0], fovTarget: +L.fovTarget || 40, seatW, layout: L,
      room: { width: roomW, depth: seating.firstZ + room.rows * seating.rowSpacing + 3, height: Math.max(+L.room.height || 0, (room.rows - 1) * seating.rise + 5.5, screen.bottom + screen.height + 1.2) }, seats: [], byId: new Map() };
    for (let i = 0; i < room.rows; i++) { const L = String.fromCharCode(65 + i); let a = -seatW / 2, o = 1; const z0 = seating.firstZ + i * seating.rowSpacing, y = i * seating.rise;
      blocks.forEach(c => { for (let d = 0; d < c; d++) { const x = a + seating.pitch * (d + .5), z = z0 + x * x * seating.rowCurve, yaw = Math.atan2(x, z) * seating.faceCenter;
        const eye = [x - .02 * Math.sin(yaw), y + seating.eyeHeight, z + .06 * Math.cos(yaw)], s = { id: L + o, row: L, number: o, rowIndex: i, position: [x, y, z], yaw, eye, metrics: metricsOf(t, eye) };
        t.seats.push(s); t.byId.set(s.id, s); o++; } a += c * seating.pitch + seating.aisle; }); }
    CACHE.set(key, t); return t;
  }
  /** Số đo góc nhìn từ vị trí mắt tới màn hình (tâm + 4 cạnh) */
  function metricsOf(t, e) {
    const n = t.screen, r = t.screenCenter, mid = n.bottom + n.height / 2, ca = n.curveRadius ? n.width / (2 * n.curveRadius) : 0, ex = n.curveRadius ? n.curveRadius * Math.sin(ca) : n.width / 2, ez = n.curveRadius ? n.curveRadius * (1 - Math.cos(ca)) : 0;
    const edge = { left: [-ex, mid, ez], right: [ex, mid, ez], top: [0, n.bottom + n.height, 0], bottom: [0, n.bottom, 0] };
    const a = e[0] - r[0], o = e[2] - r[2], s = Math.hypot(a, o), l = Math.hypot(a, e[1] - r[1], o), c = deg(Math.atan2(a, o)), u = deg(Math.atan2(r[1] - e[1], s));
    const d = sub(edge.left, e), h = sub(edge.right, e), p = ang([d[0], 0, d[2]], [h[0], 0, h[2]]), f = ang(sub(edge.top, e), sub(edge.bottom, e)), m = deg(Math.atan2(n.bottom + n.height - e[1], s));
    const v = t.fovTarget, y = .45 * v;
    return { distance: l, hAngle: c, vAngle: u, hFov: p, vFov: f, topAngle: m, immersion: Math.round(p / 120 * 100), target: v,
      scores: { fov: Math.exp(-(((p - v) / y) ** 2)), angle: clamp01(1 - Math.abs(c) / 40), vertical: clamp01(1 - Math.max(0, u - 14, -6 - u) / 20) * clamp01(1 - Math.max(0, m - 38) / 20), centered: clamp01(1 - Math.abs(a) / (n.width / 2)) } };
  }
  const scoreOf = (m, p = "balanced") => { const w = (PRIO[p] || PRIO.balanced).w; return w.fov * m.scores.fov + w.angle * m.scores.angle + w.vertical * m.scores.vertical + w.centered * m.scores.centered; };
  const levelOf = s => s >= .78 ? "great" : s >= .55 ? "good" : "less";
  const LEVEL_TXT = { great: "Góc nhìn rất tốt", good: "Góc nhìn tốt", less: "Góc nhìn kém" };
  /** Đánh giá + số đo của một ghế (dùng ở sơ đồ 2D, khung xem và bảng số) */
  function rate(room, sid, priority = "balanced") {
    const t = theatreOf(room), s = t.byId.get(sid); if (!s) return null;
    const m = s.metrics, sc = scoreOf(m, priority), level = levelOf(sc), pros = [], cons = [];
    if (Math.abs(m.hAngle) < 8) pros.push("Gần như chính diện màn hình"); else if (Math.abs(m.hAngle) > 25) cons.push(`Lệch ngang ${Math.abs(m.hAngle).toFixed(0)}° – hình hơi méo`);
    if (Math.abs(m.hFov - m.target) < 6) pros.push("Màn hình lấp đầy tầm nhìn vừa đủ"); else if (m.hFov > m.target + 12) cons.push("Quá gần – phải đảo mắt để xem hết màn"); else if (m.hFov < m.target - 12) cons.push("Hơi xa – màn hình nhỏ trong tầm nhìn");
    if (m.vAngle > 14 || m.topAngle > 38) cons.push("Phải ngước cổ, mỏi khi xem lâu"); else if (m.vAngle > -6) pros.push("Không phải ngước hay cúi");
    return { level, text: LEVEL_TXT[level], score: sc, score100: Math.round(sc * 100), metrics: m, pros, cons, seat: s };
  }
  /** Ghế trống điểm cao nhất (cả nhóm ghế đôi phải trống) – như "Choose best seat" */
  function best(room, free, groups, priority = "balanced") {
    const t = theatreOf(room); let top = null;
    for (const s of t.seats) { const g = (groups && groups.get(s.id)) || [s.id]; if (g[0] !== s.id || !g.every(free)) continue;
      const v = scoreOf(s.metrics, priority) - 1e-4 * Math.abs(s.position[0]); if (!top || v > top.v) top = { sid: s.id, v }; }
    return top && top.sid;
  }

  /* ---------- dựng cảnh ---------- */
  const tex = (draw, repeat) => { const T = window.THREE, c = document.createElement("canvas"); c.width = c.height = 256; draw(c.getContext("2d")); const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(...repeat); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t; };
  const carpetTex = (a, b, rep) => tex(g => { g.fillStyle = a; g.fillRect(0, 0, 256, 256); g.strokeStyle = b; g.globalAlpha = .55; g.lineWidth = 3; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(i % 2 ? 0 : 256, i < 2 ? 0 : 256, 128, 0, Math.PI * 2); g.stroke(); } }, rep);
  const wallTex = (c, rep) => tex(g => { g.fillStyle = c; g.fillRect(0, 0, 256, 256); g.globalAlpha = .08; for (let y = 0; y < 256; y += 2) { g.fillStyle = y % 4 ? "#000" : "#fff"; g.fillRect(0, y, 256, 1); } }, rep);
  function seatGeo() {   // ghế tiêu chuẩn: đệm, lưng, tựa đầu (bọc vải) · vỏ lưng, tay vịn, hông (nhựa) · thanh ngang, chân (kim loại)
    const T = window.THREE, X = window.THREE_X, M = new T.Matrix4(), box = (w, h, d, rad) => rad ? new X.RoundedBoxGeometry(w, h, d, 2, rad) : new T.BoxGeometry(w, h, d);
    const at = (g, [x, y, z], rx = 0) => { M.makeRotationX(rx); M.setPosition(x, y, z); g.applyMatrix4(M); return g; };
    const part = list => { const g = X.mergeGeometries(list.map(x => x.index ? x.toNonIndexed() : x)); list.forEach(x => x.dispose()); return g; };
    const nx = g => g.index ? g.toNonIndexed() : g;
    return {
      up: part([at(box(.48, .12, .46, .05), [0, .45, -.05]), at(box(.48, .6, .11, .05), [0, .86, .2], .17), at(box(.44, .16, .12, .05), [0, 1.18, .26], .17)]),
      shell: part([at(box(.52, .72, .04, .02), [0, .88, .27], .17), at(box(.07, .06, .5, .03), [-.29, .66, 0]), at(box(.07, .06, .5, .03), [.29, .66, 0]), at(box(.05, .62, .36), [-.29, .33, .04]), at(box(.05, .62, .36), [.29, .33, .04])]),
      metal: part([at(box(.4, .06, .06), [0, .38, .06]), at(box(.05, .02, .4), [-.29, .01, .04]), at(box(.05, .02, .4), [.29, .01, .04])]),
    };
  }
  function personGeo() {   // người ngồi: thân, đùi + 2 cẳng chân, đầu, tóc, tay
    const T = window.THREE, X = window.THREE_X, tr = (g, x, y, z) => { g.translate(x, y, z); return g; };
    const torso = tr(new X.RoundedBoxGeometry(.32, .44, .2, 2, .04), 0, .22, 0);
    const nx = g => g.index ? g.toNonIndexed() : g;
    const lap = X.mergeGeometries([nx(tr(new X.RoundedBoxGeometry(.3, .12, .32, 2, .03), 0, -.06, -.16)), nx(tr(new T.BoxGeometry(.09, .42, .1), -.09, -.27, -.31)), nx(tr(new T.BoxGeometry(.09, .42, .1), .09, -.27, -.31))]);
    const head = new T.SphereGeometry(.088, 10, 8); head.scale(1, 1.15, 1);
    const hair = new T.SphereGeometry(.094, 10, 6, 0, Math.PI * 2, 0, .58 * Math.PI); hair.scale(1.02, 1.16, 1.02);
    const arm = X.mergeGeometries([nx(tr(new T.CylinderGeometry(.035, .032, .38, 8), 0, -.19, 0)), nx(tr(new T.SphereGeometry(.038, 8, 6), 0, -.38, 0))]);
    return { torso, lap, head, hair, arm };
  }
  function avatarGroup(shirt = 0xb91c1c, skin = 0xf0d5be, hair = 0x1a1a24, pants = 0x1f2937) {   // nhân vật đứng (áo đỏ = "bạn"); chân/tay là nhóm con có khớp để đi
    const T = window.THREE, g = new T.Group(), mk = (geo, color, p, extra = {}, parent = g) => { const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color, roughness: .7, ...extra })); m.position.set(...p); parent.add(m); return m; };
    mk(new T.SphereGeometry(.16, 16, 16), skin, [0, 1.55, 0], { roughness: .6 }); mk(new T.BoxGeometry(.3, .12, .32), hair, [0, 1.63, -.04], { roughness: .8 });
    mk(new T.BoxGeometry(.38, .58, .22), shirt, [0, 1.05, 0]);
    const dark = new T.Color(shirt).multiplyScalar(.8).getHex(), limb = (w, h, d, color, x, y, ly) => { const j = new T.Group(); j.position.set(x, y, 0); mk(new T.BoxGeometry(w, h, d), color, [0, ly, 0], {}, j); g.add(j); return j; };
    g.userData.arms = [limb(.09, .44, .1, dark, -.24, 1.25, -.22), limb(.09, .44, .1, dark, .24, 1.25, -.22)];
    g.userData.legs = [limb(.13, .74, .14, pants, -.11, .75, -.37), limb(.13, .74, .14, pants, .11, .75, -.37)];
    g.visible = false; g.traverse(o => { o.raycast = () => {}; }); return g;
  }
  /* ---------- "đi tới ghế": mỗi ghế đã chọn / đã mua một nhân vật vào từ CỬA BÊN PHÍA TRƯỚC (gần màn hình, như rạp thật),
     đi dọc lối đi trước hàng đầu tới lối đi gần nhất, LEO BẬC lên tới hàng, rẽ vào ghế rồi ngồi ---------- */
  function arriveBuild() {
    const T = window.THREE, t = st.t, se = t.seating, R = t.room, ids = (st.opts.arrive || []).filter(id => t.byId.get(id));
    arriveClear(); st.seated = new Set(); st.walkers = [];
    // tâm các lối đi giữa khối ghế; không có thì dùng lối đi hai bên tường
    const aisleX = []; { let a = -t.seatW / 2; se.blocks.slice(0, -1).forEach(b => { a += b * se.pitch; aisleX.push(a + se.aisle / 2); a += se.aisle; }); }
    if (!aisleX.length) aisleX.push(-t.seatW / 2 - .6, t.seatW / 2 + .6);
    ids.forEach((id, k) => { const s = t.byId.get(id), h = hash(id + "|arrive"), ax = aisleX.reduce((b, x) => Math.abs(x - s.position[0]) < Math.abs(b - s.position[0]) ? x : b, aisleX[0]);
      const g = avatarGroup(new T.Color(CLOTH[h % CLOTH.length]).getHex(), new T.Color(SKIN[(h >> 2) % SKIN.length]).getHex(), new T.Color(HAIR[(h >> 4) % HAIR.length]).getHex(), new T.Color(PANTS[(h >> 6) % PANTS.length]).getHex());
      const zRow = s.position[2] - .42 * se.rowSpacing;   // lối đi phía trước hàng ghế
      const zFront = Math.max(1.3, se.firstZ - 1.3), doorX = (ax >= 0 ? 1 : -1) * (R.width / 2 - .6);   // cửa bên, sát tường, phía trước hàng A
      const path = [[doorX, zFront], [ax, zFront], [ax, zRow], [s.position[0], zRow], [s.position[0], s.position[2] + .05]];
      g.position.set(doorX, 0, zFront); g.visible = false; st.scene.add(g);
      st.walkers.push({ id, seat: s, g, path, i: 0, t: 0, delay: k * .7 + .2, done: false, dist: 0 }); });
    st.arriveT = 0; st.arriveKey = ids.join(); st.dirty = true;
  }
  function arriveClear() { (st.walkers || []).forEach(w => { st.scene && st.scene.remove(w.g); w.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }); st.walkers = []; if (st.seated && st.seated.size) { st.seated = new Set(); st.audKey = null; } }
  /** Cao độ sàn tại z (theo bậc hàng) */
  function floorY(z) { const se = st.t.seating; if (z < se.firstZ - .4) return 0; const i = Math.floor((z - se.firstZ + .45 * se.rowSpacing) / se.rowSpacing); return Math.max(0, Math.min(se.rows - 1, i)) * se.rise; }
  function arriveStep(dt) {
    const sp = 1.9; let active = 0; st.arriveT += dt;
    st.walkers.forEach(w => { if (w.done) return; if (st.arriveT < w.delay) return; active++; w.g.visible = true;
      const [tx, tz] = w.path[w.i], px = w.g.position.x, pz = w.g.position.z, dx = tx - px, dz = tz - pz, d = Math.hypot(dx, dz);
      if (d < .04) { w.i++; if (w.i >= w.path.length) { w.done = true; w.g.visible = false; st.seated.add(w.id); st.audKey = null; audience(); return; } }
      else { const m = Math.min(d, sp * dt); w.g.position.x += dx / d * m; w.g.position.z += dz / d * m; w.g.rotation.y = Math.atan2(dx, dz); w.dist += m; }
      const y = w.i < 3 ? floorY(w.g.position.z) : w.seat.position[1]; w.g.position.y = y + Math.abs(Math.sin(w.dist * 4)) * .035;
      const sw = Math.sin(w.dist * 4) * .55; w.g.userData.legs[0].rotation.x = sw; w.g.userData.legs[1].rotation.x = -sw; w.g.userData.arms[0].rotation.x = -sw * .6; w.g.userData.arms[1].rotation.x = sw * .6; });
    return active > 0 || st.walkers.some(w => !w.done);
  }
  /** Máy quay cảnh đi tới ghế: đứng phía trước (gần màn hình), hơi thấp, nhìn lên nhóm đang leo bậc – như góc nhìn từ cửa vào; xong thì nhìn cả cụm ghế */
  function arrivePose() {
    const T = window.THREE, R = st.t.room, ws = st.walkers.filter(w => !w.done && w.g.visible), all = st.walkers;
    const pts = (ws.length ? ws : all).map(w => ws.length ? w.g.position : new T.Vector3(w.seat.position[0], w.seat.position[1], w.seat.position[2]));
    const c = pts.reduce((a, p) => a.add(p), new T.Vector3()).multiplyScalar(1 / Math.max(1, pts.length));
    // máy quay được phép lùi ra sau tường sau (tường vẽ một mặt nên không che) để luôn thấy người từ lúc bước vào
    const cx = Math.max(-R.width / 2 + .8, Math.min(R.width / 2 - .8, c.x - 2.4));
    if (ws.length) return { eye: new T.Vector3(cx, Math.max(1.4, c.y + 1.2), Math.max(.6, c.z - 4.6)), aim: new T.Vector3(c.x, c.y + 1, c.z + .4), fov: 64 };
    return { eye: new T.Vector3(cx, Math.max(1.6, c.y + 1.6), Math.max(.6, c.z - 4.2)), aim: new T.Vector3(c.x, c.y + .7, c.z), fov: 58 };
  }
  function build(room, opts) {
    const T = window.THREE, t = theatreOf(room), scene = new T.Scene(), R = t.room, sc = t.screen, se = t.seating;
    scene.background = new T.Color(0x070709); scene.fog = new T.Fog(0x070709, 22, 60);
    // --- ghế (3 lớp vật liệu, instanced) ---
    const geo = seatGeo(), n = t.seats.length, M = new T.Matrix4(), q = new T.Quaternion(), P = new T.Vector3(), S = new T.Vector3(1, 1, 1), E = new T.Euler();
    const L = t.layout || { room: {}, materials: {}, lighting: {} }, col = (v, d) => { try { return new T.Color(v || d); } catch (e) { return new T.Color(d); } }, hx = (v, d) => col(v, d).getHex();
    const wScale = { recliner: 1.35, luxury: 1.55, fx: 1.08 }[se.style] || 1;   // ghế nằm / sofa rộng hơn ghế thường
    const mats = { up: new T.MeshStandardMaterial({ color: 0xffffff, roughness: se.style === "recliner" || se.style === "luxury" ? .45 : .65, metalness: .08 }), shell: new T.MeshStandardMaterial({ color: hx(L.materials.plastic, "#141214"), roughness: .38, metalness: .16 }), metal: new T.MeshStandardMaterial({ color: hx(L.materials.metal, "#3a3a3d"), roughness: .25, metalness: .9 }) };
    const inst = {}; ["up", "shell", "metal"].forEach(k => { inst[k] = new T.InstancedMesh(geo[k], mats[k], n); inst[k].instanceMatrix.setUsage(T.DynamicDrawUsage); scene.add(inst[k]); });
    t.seats.forEach((s, k) => { const g = opts.groups && opts.groups.get(s.id); let sx = 1, x = s.position[0], show = true;
      if (g) { if (g[0] !== s.id) show = false; else { const last = t.byId.get(g[g.length - 1]); x = (s.position[0] + last.position[0]) / 2; sx = (last.position[0] - s.position[0]) / se.pitch + 1; } }
      P.set(x, s.position[1], s.position[2]); E.set(0, s.yaw, 0); q.setFromEuler(E); S.set(show ? sx * wScale : 1e-4, show ? 1 : 1e-4, show ? (wScale > 1.2 ? 1.25 : 1) : 1e-4); M.compose(P, q, S);
      Object.values(inst).forEach(m => m.setMatrixAt(k, M)); });
    Object.values(inst).forEach(m => { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); });
    // --- phòng: thảm, bậc, tường sọc, tường sau, tường màn hình, trần, sân khấu, lan can sau ---
    const fl = L.room.floor || "#3a1418", fl2 = L.room.floorAlt || "#24090c", wl = L.room.wall || "#2a1d1c";
    const carpet = carpetTex(fl, fl2, [R.width / 2, R.depth / 2]), riserT = carpetTex(fl, fl2, [R.width / 2, 1]), wallT = wallTex(wl, [R.depth / 3, R.height / 3]), backT = wallTex(wl, [R.width / 3, R.height / 3]);
    const mesh = (g, m, p, rot) => { const o = new T.Mesh(g, m); o.position.set(...p); if (rot) o.rotation.set(...rot); scene.add(o); return o; };
    mesh(new T.PlaneGeometry(R.width, R.depth + 2), new T.MeshStandardMaterial({ map: carpet, roughness: 1 }), [0, 0, R.depth / 2 - 1], [-Math.PI / 2, 0, 0]);
    for (let i = 1; i < se.rows; i++) { const y = i * se.rise, z1 = se.firstZ + (i - .5) * se.rowSpacing, z2 = i === se.rows - 1 ? R.depth : z1 + se.rowSpacing; mesh(new T.BoxGeometry(R.width, y, z2 - z1), new T.MeshStandardMaterial({ map: riserT, roughness: 1 }), [0, y / 2, (z1 + z2) / 2]); }
    const wallM = new T.MeshStandardMaterial({ map: wallT, roughness: .95 });
    mesh(new T.PlaneGeometry(R.depth + 2, R.height), wallM, [-R.width / 2, R.height / 2, R.depth / 2 - 1], [0, Math.PI / 2, 0]);
    mesh(new T.PlaneGeometry(R.depth + 2, R.height), wallM, [R.width / 2, R.height / 2, R.depth / 2 - 1], [0, -Math.PI / 2, 0]);
    mesh(new T.PlaneGeometry(R.width, R.height), new T.MeshStandardMaterial({ map: backT, roughness: .95 }), [0, R.height / 2, R.depth], [0, Math.PI, 0]);
    mesh(new T.PlaneGeometry(R.width, R.height), new T.MeshStandardMaterial({ color: 0x040404, roughness: 1 }), [0, R.height / 2, -1]);
    mesh(new T.PlaneGeometry(R.width, R.depth + 2), new T.MeshStandardMaterial({ color: hx(L.room.ceiling, "#0d0b0b"), roughness: 1, side: T.DoubleSide }), [0, R.height, R.depth / 2 - 1], [Math.PI / 2, 0, 0]);
    mesh(new T.BoxGeometry(R.width, .5, 1.8), new T.MeshStandardMaterial({ color: 0x0a0a0b, roughness: .9 }), [0, .25, .9]);
    mesh(new T.BoxGeometry(.9 * R.width, .06, .08), new T.MeshStandardMaterial({ color: 0x1a1a1c, metalness: .8, roughness: .3 }), [0, (se.rows - 1) * se.rise + .5, Math.min(R.depth - .05, se.firstZ + (se.rows - 1) * se.rowSpacing + .75 * se.rowSpacing)]);
    // --- màn hình (poster lên sau) + viền + rèm + loa tường ---
    const bend = (g, w) => { if (!sc.curveRadius) return g; const Rc = sc.curveRadius, p = g.attributes.position; for (let i = 0; i < p.count; i++) { const a = p.getX(i) / Rc; p.setXYZ(i, Rc * Math.sin(a), p.getY(i), Rc * (1 - Math.cos(a)) + p.getZ(i)); } g.computeVertexNormals(); return g; };
    st.scrM = new T.MeshBasicMaterial({ color: 0xffffff }); mesh(bend(new T.PlaneGeometry(sc.width, sc.height, sc.curveRadius ? 48 : 1, 1), sc.width), st.scrM, [0, sc.bottom + sc.height / 2, 0]);
    mesh(bend(new T.PlaneGeometry(sc.width + .5, sc.height + .5, sc.curveRadius ? 48 : 1, 1), sc.width + .5), new T.MeshStandardMaterial({ color: 0x000000, roughness: 1 }), [0, sc.bottom + sc.height / 2, -.03]);
    const curtM = new T.MeshStandardMaterial({ color: hx(L.materials.upholstery, "#5a1518"), roughness: .95 }); [-1, 1].forEach(s => mesh(new T.BoxGeometry(.9, R.height - .4, .35), curtM, [s * (sc.width / 2 + 1), R.height / 2 - .2, .2]));
    const spkM = new T.MeshStandardMaterial({ color: 0x111113, roughness: .6 }); for (let i = 0; i < 4; i++) { const z = 3 + i * (R.depth - 6) / 3; [-1, 1].forEach(s => mesh(new T.BoxGeometry(.3, .9, .5), spkM, [s * (R.width / 2 - .2), 3.6, z])); }
    // --- đèn: màn hình hắt sáng, đèn trần ấm, đèn hông (sconce) 4 cặp, đèn lối đi ---
    const lg = L.lighting || {}; scene.add(new T.AmbientLight(hx(lg.ambient, "#ffd2a8"), Math.max(.35, lg.ambientIntensity != null ? +lg.ambientIntensity : .55)));
    const glow = new T.PointLight(0xdbe4ff, 90, 45, 1.5); glow.position.set(0, sc.bottom + sc.height / 2, 1.5); scene.add(glow);
    const topL = new T.DirectionalLight(0xffe4c4, .25); topL.position.set(3, R.height, R.depth / 2); scene.add(topL);
    const nSc = lg.sconceCount != null ? Math.max(0, Math.min(12, +lg.sconceCount)) : 4, scHex = hx(lg.sconce, "#ffb370"), scM = new T.MeshBasicMaterial({ color: scHex });
    for (let i = 0; i < nSc; i++) { const z = 4 + i * (R.depth - 7) / Math.max(1, nSc - 1); [-1, 1].forEach(s => { mesh(new T.BoxGeometry(.12, .5, .25), scM, [s * (R.width / 2 - .06), 2.4, z]); const l = new T.PointLight(scHex, 10, 9, 1.6); l.position.set(s * (R.width / 2 - .5), 2.5, z); scene.add(l); }); }
    if (!nSc) { const fill = new T.PointLight(hx(lg.aisle, "#ffb35c"), 14, R.depth, 1.4); fill.position.set(0, R.height - .8, R.depth * .55); scene.add(fill); }
    // đèn lối đi: ở mép mỗi khối ghế (lối đi giữa) + hai bên tường
    const aisleM = new T.MeshBasicMaterial({ color: hx(lg.aisle, "#ffb35c") }), aisleX = []; { let a = -t.seatW / 2; se.blocks.slice(0, -1).forEach(b => { a += b * se.pitch; aisleX.push(a + se.aisle / 2); a += se.aisle; }); }
    for (let i = 0; i < se.rows; i++) { const z = se.firstZ + i * se.rowSpacing, y = i * se.rise + .03; aisleX.forEach(x => mesh(new T.BoxGeometry(.06, .04, .3), aisleM, [x, y, z])); mesh(new T.BoxGeometry(.3, .04, .06), aisleM, [-R.width / 2 + .6, y, z]); mesh(new T.BoxGeometry(.3, .04, .06), aisleM, [R.width / 2 - .6, y, z]); }
    // --- khán giả (ghế đã bán) + nhân vật đứng dậy ---
    st.pgeo = personGeo(); st.aud = null; st.audKey = null; st.avatar = avatarGroup(); scene.add(st.avatar);
    const ring = new T.Group(); const r1 = new T.Mesh(new T.RingGeometry(.38, .46, 32), new T.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: .65 })); r1.rotation.x = -Math.PI / 2; ring.add(r1);
    const r2 = new T.Mesh(new T.CircleGeometry(.15, 24), new T.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: .25 })); r2.rotation.x = -Math.PI / 2; r2.position.y = .01; ring.add(r2); ring.visible = false; ring.traverse(o => { o.raycast = () => {}; }); scene.add(ring); st.ring = ring;
    st.walkers = []; st.seated = null; st.arriveKey = ""; Object.assign(st, { scene, inst, t, texKey: "" });
  }
  /** người ngồi ở ghế đã bán: dựng lại khi danh sách ghế bán đổi */
  function audience() {
    const T = window.THREE, t = st.t, seated = st.seated || new Set(), sold = t.seats.filter(s => (st.opts.stateOf && st.opts.stateOf(s.id) === "sold") || seated.has(s.id)), key = sold.map(s => s.id).join();
    if (st.audKey === key) return; st.audKey = key;
    if (st.aud) { st.scene.remove(st.aud); st.aud.children.forEach(m => m.dispose()); st.aud = null; }
    if (!sold.length) { st.dirty = true; return; }
    const g = st.pgeo, mk = (geo, rough) => { const m = new T.InstancedMesh(geo, new T.MeshStandardMaterial({ roughness: rough, metalness: .03 }), sold.length); m.raycast = () => {}; return m; };
    const parts = { torso: mk(g.torso, .85), lap: mk(g.lap, .9), head: mk(g.head, .65), hair: mk(g.hair, .88), armL: mk(g.arm, .85), armR: mk(g.arm, .85) };
    const o = new T.Object3D(), c = new T.Color();
    sold.forEach((s, k) => { const h = hash(s.id + "|" + t.seats.length), cloth = CLOTH[h % CLOTH.length], skin = SKIN[(h >> 2) % SKIN.length], hair = HAIR[(h >> 4) % HAIR.length], pants = PANTS[(h >> 6) % PANTS.length], sc = .94 + (h % 20) / 20 * .12, lean = ((h % 15) - 7) / 7 * .06;
      const [x, y, z] = s.position, base = y + .45;
      const put = (m, px, py, pz, rx, ry, rz) => { o.position.set(px, py, pz); o.rotation.set(rx, ry, rz); o.scale.set(sc, sc, sc); o.updateMatrix(); m.setMatrixAt(k, o.matrix); };
      put(parts.torso, x, base, z, lean, s.yaw, 0); put(parts.lap, x, base, z, 0, s.yaw, 0);
      const hy = base + .22 + .22 + .09 * sc; put(parts.head, x, hy, z - .02, 0, s.yaw, 0); put(parts.hair, x, hy + .005, z - .02, 0, s.yaw, 0);
      put(parts.armL, x - .19 * sc, base + .42, z + .05, .35, s.yaw, .12); put(parts.armR, x + .19 * sc, base + .42, z + .05, .35, s.yaw, -.12);
      c.set(cloth); parts.torso.setColorAt(k, c); parts.armL.setColorAt(k, c); parts.armR.setColorAt(k, c); c.set(pants); parts.lap.setColorAt(k, c); c.set(skin); parts.head.setColorAt(k, c); c.set(hair); parts.hair.setColorAt(k, c); });
    st.aud = new T.Group(); Object.values(parts).forEach(m => { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; st.aud.add(m); }); st.scene.add(st.aud); st.dirty = true;
  }
  /** Poster phim lên màn hình: giữ tỷ lệ, nền là poster phóng to làm mờ; ảnh chéo miền không đọc được → màn chữ */
  function screenTex() {
    const T = window.THREE, key = st.opts.poster || st.opts.title || ""; if (st.texKey === key) return; st.texKey = key;
    const put = c => { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; st.scrM.map = t; st.scrM.needsUpdate = true; st.dirty = true; loop(); };
    const fallback = () => { const c = document.createElement("canvas"); c.width = 1024; c.height = 554; const g = c.getContext("2d"); const gr = g.createLinearGradient(0, 0, 1024, 554); gr.addColorStop(0, "#1e1b4b"); gr.addColorStop(1, "#7f1d1d"); g.fillStyle = gr; g.fillRect(0, 0, 1024, 554);
      g.fillStyle = "#fff"; g.font = "bold 64px Arial"; g.textAlign = "center"; g.fillText((st.opts.title || "CineVin").slice(0, 28), 512, 290); g.font = "28px Arial"; g.fillStyle = "rgba(255,255,255,.7)"; g.fillText("CineVin · phòng chiếu", 512, 350); put(c); };
    if (!st.opts.poster) return fallback();
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { try { const c = document.createElement("canvas"); c.width = 1024; c.height = 554; const g = c.getContext("2d");
      g.filter = "blur(18px) brightness(.45)"; g.drawImage(img, -60, -400, 1144, 1350); g.filter = "none";
      const k = Math.min(1024 / img.width, 554 / img.height), w = img.width * k, h = img.height * k; g.drawImage(img, (1024 - w) / 2, (554 - h) / 2, w, h); put(c); } catch (e) { fallback(); } };
    img.onerror = fallback; img.src = st.opts.poster;
  }
  function colorize() {
    const T = window.THREE, c = new T.Color(), o = st.opts, sel = new Set(o.selected || []);
    st.t.seats.forEach((s, k) => { const state = sel.has(s.id) ? "selected" : (o.stateOf ? o.stateOf(s.id) : "free"), kind = o.kindOf ? o.kindOf(s.id) : "std";
      c.setHex(state === "selected" ? COLORS.selected : state === "free" ? (kind === "vip" ? COLORS.vip : kind === "couple" ? COLORS.couple : kind === "blocked" ? COLORS.blocked : COLORS.up) : (COLORS[state] || COLORS.up));
      st.inst.up.setColorAt(k, c); });
    st.inst.up.instanceColor.needsUpdate = true; st.dirty = true;
  }
  /* ---------- máy quay ---------- */
  function focusSeat() { const sid = st.opts.focus || (st.opts.selected || [])[0]; return (sid && st.t.byId.get(sid)) || st.t.seats[Math.floor(st.t.seats.length * .55)]; }
  function pose() {
    const T = window.THREE, s = focusSeat(), [x, y, z] = s.position;
    if (st.mode === "walk") {   // đi lại: ngôi thứ nhất (mắt 1,55 m, lắc nhẹ khi đi) hoặc ngôi thứ ba (máy quay sau 2,4 m, cao 1 m)
      const c = st.ch, dir = new T.Vector3(-Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), -Math.cos(c.yaw) * Math.cos(c.pitch));
      if (c.view === "third") { const R = st.t.room, head = new T.Vector3(c.x, c.y + 1.25, c.z), ex = head.x + Math.sin(c.yaw) * 2.4, ez = head.z + Math.cos(c.yaw) * 2.4, ey = Math.max(.8, Math.min(R.height - .5, head.y + 1 - 1.5 * c.pitch));
        return { eye: new T.Vector3(Math.max(-R.width / 2 + .4, Math.min(R.width / 2 - .4, ex)), ey, Math.max(1, Math.min(R.depth - .4, ez))), aim: head.clone().add(new T.Vector3(0, .2, 0)), fov: 55 }; }
      const eye = new T.Vector3(c.x, c.y + 1.55 + (c.moving ? .035 * Math.sin(c.bob) : 0), c.z);
      return { eye, aim: eye.clone().add(dir.multiplyScalar(10)), fov: 62 };
    }
    if (st.mode === "arrive" && st.walkers && st.walkers.length) return arrivePose();
    if (st.mode === "room") {   // toàn cảnh phòng: máy quay cao phía sau, nhìn về màn hình; kéo xoay quanh tâm phòng, lăn chuột xa/gần
      const R = st.t.room, cz = (R.depth + 2) / 2, d = (R.depth * .85 + 4) * st.dist, yaw = st.yaw, pitch = Math.max(.2, Math.min(1.25, .55 + st.pitch));
      return { eye: new T.Vector3(Math.sin(yaw) * d * Math.cos(pitch), 1.5 + Math.sin(pitch) * d, cz + Math.cos(yaw) * d * Math.cos(pitch)), aim: new T.Vector3(0, 1.6, cz - 1), fov: 50 };
    }
    if (st.mode === "overview") {   // đứng dậy: nhân vật đứng tại ghế, máy quay phía sau trên cao (kéo: xoay quanh nhân vật; lăn: xa/gần)
      const d = 4.2 * st.dist, yaw = st.yaw, pitch = Math.max(.15, Math.min(1.1, .5 + st.pitch));
      return { eye: new T.Vector3(x + Math.sin(yaw) * d * Math.cos(pitch), y + 1.2 + Math.sin(pitch) * d, z + Math.cos(yaw) * d * Math.cos(pitch)), aim: new T.Vector3(x, y + 1.3, z - 2.5), fov: 55 };
    }
    const eye = new T.Vector3(s.eye[0], s.eye[1], s.eye[2]), c = st.t.screenCenter;
    const base = Math.atan2(c[0] - eye.x, c[2] - eye.z), yaw = base + st.yaw, pitch = Math.atan2(c[1] - eye.y, Math.hypot(c[0] - eye.x, c[2] - eye.z)) + st.pitch;
    return { eye, aim: new T.Vector3(eye.x + Math.sin(yaw) * 10 * Math.cos(pitch), eye.y + Math.sin(pitch) * 10, eye.z + Math.cos(yaw) * 10 * Math.cos(pitch)), fov: 68 };
  }
  function placeAvatar() {
    if (st.mode === "walk") { const c = st.ch; st.avatar.visible = c.view === "third"; st.avatar.position.set(c.x, c.y, c.z); st.avatar.rotation.y = c.yaw + Math.PI; return; }
    const s = focusSeat(); st.avatar.visible = st.mode === "overview";  if (st.mode === "arrive") st.avatar.visible = false; st.avatar.position.set(s.position[0], s.position[1], s.position[2] - .15); st.avatar.rotation.y = Math.PI + s.yaw; }
  /** Vật lý đi lại mỗi khung hình: WASD / mũi tên / joystick, Shift chạy; giới hạn trong phòng; y theo bậc hàng; ghế gần nhất < 1,35 m → gợi ý ngồi */
  function walkStep(dt) {
    const c = st.ch, k = st.keys, R = st.t.room, se = st.t.seating;
    let f = (k.f ? 1 : 0) - (k.b ? 1 : 0) - st.joy.y, r = (k.r ? 1 : 0) - (k.l ? 1 : 0) + st.joy.x;
    const mag = Math.hypot(f, r), moving = mag > .05;
    if (moving) { if (mag > 1) { f /= mag; r /= mag; } const sp = (k.run ? 4.4 : 2.4) * Math.min(dt, .1), fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
      c.x = Math.max(-R.width / 2 + .65, Math.min(R.width / 2 - .65, c.x + (fx * f + rx * r) * sp)); c.z = Math.max(1.2, Math.min(R.depth - .65, c.z + (fz * f + rz * r) * sp)); c.bob += dt * (k.run ? 14 : 9); }
    let ty = 0; if (c.z >= se.firstZ - .4) { const i = Math.floor((c.z - se.firstZ + .45 * se.rowSpacing) / se.rowSpacing); ty = Math.max(0, Math.min(se.rows - 1, i)) * se.rise; }
    c.y += (ty - c.y) * Math.min(1, dt * 8); c.moving = moving; c.running = moving && k.run;
    let near = null, best = 1.35; for (const s of st.t.seats) { if (st.opts.canSit && !st.opts.canSit(s.id)) continue; const d = Math.hypot(s.position[0] - c.x, s.position[2] - c.z); if (d < best) { best = d; near = s; } }
    if ((near && near.id) !== (st.near && st.near.id)) { st.near = near; if (st.ring) { st.ring.visible = !!near; if (near) st.ring.position.set(near.position[0], near.position[1] + .05, near.position[2]); } if (st.opts.onNear) st.opts.onNear(near ? { id: near.id, row: near.row, number: near.number } : null); }
    placeAvatar(); const p = pose(); st.eye.copy(p.eye); st.aim.copy(p.aim); if (Math.abs(st.cam.fov - p.fov) > .1) { st.cam.fov += (p.fov - st.cam.fov) * .1; st.cam.updateProjectionMatrix(); } st.dirty = true;
  }
  /** Đứng dậy khỏi ghế đang chọn và bắt đầu đi lại (vị trí: cạnh ghế, hướng về màn hình) */
  function startWalk() { const s = focusSeat(), c = st.ch; c.x = s.position[0] + (s.position[0] > 0 ? .6 : -.6); c.y = s.position[1]; c.z = s.position[2]; c.yaw = 0; c.pitch = 0; c.moving = false; st.near = null; if (st.ring) st.ring.visible = false; }
  function bindKeys() {
    if (st.keysBound) return; st.keysBound = true;
    const map = { KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r" };
    window.addEventListener("keydown", e => { if (!st.r) return; const t = e.target.tagName; if (/INPUT|TEXTAREA|SELECT/.test(t) || e.metaKey || e.ctrlKey || e.altKey) return;
      // đang ngồi (Từ ghế) mà bấm E = đứng dậy (chủ trang quyết định đi lại hay nhìn toàn cảnh)
      if (st.mode !== "walk") { if (e.code === "KeyE" && st.mode === "seat" && st.opts.onStand && st.el && st.el.getClientRects().length) { e.preventDefault(); st.opts.onStand(); } return; }
      if (map[e.code]) { st.keys[map[e.code]] = true; e.preventDefault(); } if (e.shiftKey) st.keys.run = true;
      if (e.code === "KeyE" && st.near && st.opts.onSit) { e.preventDefault(); st.opts.onSit(st.near.id); } if (e.code === "KeyV") { st.ch.view = st.ch.view === "first" ? "third" : "first"; placeAvatar(); st.dirty = true; } loop(); });
    window.addEventListener("keyup", e => { if (map[e.code]) st.keys[map[e.code]] = false; if (!e.shiftKey) st.keys.run = false; });
  }
  function goTo(animate) { const p = pose(); if (!st.eye) { st.eye = p.eye.clone(); st.aim = p.aim.clone(); }
    st.from = { eye: st.eye.clone(), aim: st.aim.clone(), fov: st.cam.fov }; st.to = p; st.t0 = animate ? performance.now() : 0; st.dirty = true; loop(); }
  function loop() { if (st.raf) return; st.raf = requestAnimationFrame(frame); }
  function frame(now) {
    st.raf = 0; if (!st.r) return;
    if (st.mode === "walk") { const dt = Math.min(.1, (now - (st.lastT || now)) / 1000); st.lastT = now; walkStep(dt); st.to = null; st.cam.position.copy(st.eye); st.cam.lookAt(st.aim); st.r.render(st.scene, st.cam); st.dirty = false; if (st.el) loop(); return; }
    if (st.mode === "arrive" && st.walkers && st.walkers.length) { const dt = Math.min(.1, (now - (st.lastT || now)) / 1000); st.lastT = now; const more = arriveStep(dt), p = arrivePose();
      if (!st.eye) { st.eye = p.eye.clone(); st.aim = p.aim.clone(); } st.eye.lerp(p.eye, .06); st.aim.lerp(p.aim, .08); st.cam.fov += (p.fov - st.cam.fov) * .05; st.cam.updateProjectionMatrix(); st.to = null;
      st.cam.position.copy(st.eye); st.cam.lookAt(st.aim); st.r.render(st.scene, st.cam); st.dirty = false;
      if (more || st.eye.distanceTo(p.eye) > .02) { if (st.el) loop(); } else if (!st.arrivedTold) { st.arrivedTold = true; st.opts.onArrived && st.opts.onArrived(); } return; }
    st.lastT = now;
    if (st.to) { const k = st.t0 ? Math.min(1, (now - st.t0) / 700) : 1, e = 1 - Math.pow(1 - k, 3);
      st.eye.lerpVectors(st.from.eye, st.to.eye, e); st.aim.lerpVectors(st.from.aim, st.to.aim, e); st.cam.fov = st.from.fov + (st.to.fov - st.from.fov) * e; st.cam.updateProjectionMatrix(); if (k >= 1) st.to = null; st.dirty = true; }
    if (st.dirty) { st.cam.position.copy(st.eye); st.cam.lookAt(st.aim); st.r.render(st.scene, st.cam); st.dirty = false; }
    if (st.to) loop();
  }
  function resize() { if (!st.r || !st.el) return; const w = st.el.clientWidth || 320, h = st.el.clientHeight || 200; st.r.setSize(w, h, false); st.cam.aspect = w / h; st.cam.updateProjectionMatrix(); st.dirty = true; loop(); }
  function bind(cv) {
    if (st.bound) return; st.bound = true;
    const live = () => { const p = pose(); st.to = null; st.eye.copy(p.eye); st.aim.copy(p.aim); st.dirty = true; loop(); };
    cv.addEventListener("pointerdown", e => { st.drag = { x: e.clientX, y: e.clientY, yaw: st.yaw, pitch: st.pitch, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", e => { const d = st.drag; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (st.mode === "walk") { const c = st.ch, k = .0032; c.yaw -= (e.clientX - (d.lx ?? d.x)) * k; c.pitch = Math.max(-.75, Math.min(.75, c.pitch - (e.clientY - (d.ly ?? d.y)) * k)); d.lx = e.clientX; d.ly = e.clientY; loop(); return; }
      const k = st.mode === "seat" ? .0045 : .006; st.yaw = d.yaw - dx * k; st.pitch = Math.max(-.6, Math.min(.6, d.pitch + dy * k * (st.mode === "seat" ? 1 : -1))); live(); });
    const up = e => { const d = st.drag; st.drag = null; if (!d || d.moved) return;
      if (st.mode === "walk") { if (st.near && st.opts.onSit) st.opts.onSit(st.near.id); return; }
      if (!st.opts.onPick) return; const T = window.THREE, rc = new T.Raycaster(), b = cv.getBoundingClientRect();
      rc.setFromCamera(new T.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1), st.cam);
      const hit = rc.intersectObjects([st.inst.up, st.inst.shell])[0]; if (hit && hit.instanceId != null) st.opts.onPick(st.t.seats[hit.instanceId].id); };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", () => { st.drag = null; });
    cv.addEventListener("wheel", e => { if (st.mode !== "overview" && st.mode !== "room") return; e.preventDefault(); st.dist = Math.max(.45, Math.min(2.2, st.dist * (e.deltaY > 0 ? 1.08 : .92))); live(); }, { passive: false });
    cv.addEventListener("dblclick", () => { st.yaw = 0; st.pitch = 0; st.dist = 1; goTo(true); });
  }
  /** Gắn / cập nhật khung 3D vào el (gọi sau mỗi lần vẽ lại trang). opts: room, groups, selected, focus, stateOf, kindOf, poster, title, mode ('seat'|'overview'), onPick */
  function mount(el, opts) {
    if (!el) return; st.el = el; st.opts = opts || {};
    if (!ready()) { if (!el.querySelector("[data-s3-wait]")) el.insertAdjacentHTML("beforeend", `<div data-s3-wait class="absolute inset-0 grid place-items-center text-xs text-white/60">Đang tải phòng 3D…</div>`); onReady(() => st.el && mount(st.el, st.opts)); return; }
    if (st.unsupported) return;
    const T = window.THREE, room = st.opts.room, key = room.id + "|" + room.rows + "x" + room.cols + "|" + JSON.stringify(room.seatMap || {}) + (room.couple || []).join() + (room.vip || []).join() + "|" + JSON.stringify(room.layout || null);
    if (!st.r) { try { st.r = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); }
      catch (e) { st.unsupported = true; el.insertAdjacentHTML("beforeend", `<div class="absolute inset-0 grid place-items-center p-4 text-center text-xs text-white/70">Trình duyệt không bật WebGL nên không xem được phòng 3D – vẫn chọn ghế trên sơ đồ 2D bình thường.</div>`); return; }
      st.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); st.r.outputColorSpace = T.SRGBColorSpace; st.r.toneMapping = T.ACESFilmicToneMapping; st.r.toneMappingExposure = 1.05;
      st.cam = new T.PerspectiveCamera(60, 1, .05, 90); st.r.domElement.className = "block size-full cursor-grab active:cursor-grabbing touch-none select-none"; bind(st.r.domElement); st.ro = new ResizeObserver(() => resize()); }
    if (st.key !== key) { st.key = key; st.eye = null; st.yaw = 0; st.pitch = 0; build(room, st.opts); }
    const wait = el.querySelector("[data-s3-wait]"); if (wait) wait.remove();
    if (st.r.domElement.parentElement !== el) { el.prepend(st.r.domElement); st.ro.disconnect(); st.ro.observe(el); }
    const mode = ["overview", "walk", "room", "arrive"].includes(st.opts.mode) ? st.opts.mode : "seat", modeChanged = st.mode !== mode, f = focusSeat().id, focusChanged = st._focus !== f;
    st.mode = mode; st._focus = f; if (modeChanged) { st.yaw = 0; st.pitch = 0; st.dist = 1; }
    if (mode === "arrive") { const k = (st.opts.arrive || []).join(); if (modeChanged || st.arriveKey !== k || st.replayAsk) { st.replayAsk = false; st.arrivedTold = false; arriveBuild(); st.eye = null; } }
    else if (st.walkers && st.walkers.length) arriveClear();
    bindKeys(); if (mode === "walk") { if (modeChanged) startWalk(); st.ch.view = st.opts.view === "third" ? "third" : "first"; }
    else if (st.ring) { st.ring.visible = false; st.near = null; }
    screenTex(); colorize(); audience(); placeAvatar(); resize(); if (mode === "walk" || mode === "arrive") { if (!st.eye) { const p = pose(); st.eye = p.eye.clone(); st.aim = p.aim.clone(); } st.lastT = 0; loop(); } else goTo(modeChanged || focusChanged);
  }
  function destroy() { if (!st.r) return; arriveClear(); st.ro && st.ro.disconnect(); st.r.domElement.remove(); st.r.dispose(); Object.assign(st, { r: null, cam: null, scene: null, key: "", el: null, bound: false, eye: null, raf: 0, aud: null, audKey: null, walkers: [], seated: null, arriveKey: "" }); }
  /** Phát lại cảnh đi tới ghế */
  function replay() { if (!st.r || !st.el) return; st.replayAsk = true; mount(st.el, st.opts); }
  /** Trạng thái cảnh đi tới ghế (kiểm thử): số nhân vật, số đã ngồi */
  function arriveState() { return { walkers: (st.walkers || []).length, seated: st.seated ? st.seated.size : 0, done: !!(st.walkers && st.walkers.length && st.walkers.every(w => w.done)) }; }
  /** Joystick cảm ứng (điện thoại): x = -1..1 trái/phải, y = -1..1 lên/xuống (âm = tiến) */
  /** Toạ độ màn hình (px trong khung) của một ghế – phục vụ kiểm thử / gợi ý */
  function screenPos(sid) { if (!st.r || !st.t) return null; const s = st.t.byId.get(sid); if (!s) return null; const T = window.THREE, v = new T.Vector3(s.position[0], s.position[1] + 1.05, s.position[2] + .2).project(st.cam), b = st.r.domElement.getBoundingClientRect(); return [b.left + (v.x + 1) / 2 * b.width, b.top + (1 - v.y) / 2 * b.height]; }
  function setJoystick(x, y) { st.joy.x = x || 0; st.joy.y = y || 0; loop(); }
  function setRun(on) { st.keys.run = !!on; }
  return { mount, destroy, rate, best, theatreOf, PRIO, setJoystick, setRun, screenPos, replay, arriveState, get near() { return st.near; }, get active() { return !!st.r; }, get el() { return st.el; } };
})();
