/* FaceKit – xác thực khuôn mặt chạy trong trình duyệt (face-api, mô hình tải từ jsDelivr).
   Luồng: phát hiện khuôn mặt → kiểm tra người thật (quay đầu HOẶC chớp mắt) → lấy đặc trưng → so khớp 1:1 với ảnh gốc.
   Tối ưu so với bản trước:
   - Bước tìm mặt / kiểm tra người thật chỉ chạy bộ phát hiện + 68 điểm mốc (ảnh 160px). Vector 128 số – phần nặng nhất –
     chỉ tính ở bước chụp cuối (ảnh 224px), nên mỗi khung hình nhẹ hơn khoảng 3–4 lần.
   - Tải trước mô hình ngay khi mở hộp thoại xác thực (preload), người dùng đọc màn đồng ý thì mô hình đã sẵn.
   - Vòng lặp setTimeout nối tiếp (không chồng khung khi máy chậm), dừng hẳn khi đóng.
   - Thêm chớp mắt (tỉ lệ mở mắt EAR từ điểm mốc 36–47) làm cách thứ hai kiểm tra người thật. */
"use strict";
const FaceKit = (() => {
  const LIB = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js";
  const MODEL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";
  const THRESHOLD = 0.5;          // khoảng cách Euclid tối đa coi là cùng một người
  let loading = null, backend = "";

  function loadLib() {
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      if (window.faceapi) return res();
      const s = document.createElement("script"); s.src = LIB; s.onload = res; s.onerror = () => rej(new Error("Không tải được thư viện nhận diện khuôn mặt"));
      document.head.appendChild(s);
    }).then(async () => {
      const f = window.faceapi;
      let okGl = false;
      try { okGl = await f.tf.setBackend("webgl"); } catch (e) {}
      if (!okGl) await f.tf.setBackend("cpu");
      await f.tf.ready(); backend = f.tf.getBackend();
      await Promise.all([f.nets.tinyFaceDetector.loadFromUri(MODEL), f.nets.faceLandmark68TinyNet.loadFromUri(MODEL), f.nets.faceRecognitionNet.loadFromUri(MODEL)]);
      return f;
    });
    loading.catch(() => { loading = null; });
    return loading;
  }
  const preload = () => { loadLib().catch(() => {}); };
  const hasCameraApi = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  async function hasCamera() {
    if (!hasCameraApi()) return false;
    try { const d = await navigator.mediaDevices.enumerateDevices(); return d.some(x => x.kind === "videoinput"); } catch (e) { return true; }
  }
  const fast = f => new f.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.45 });
  const full = f => new f.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
  const track = (f, input) => f.detectSingleFace(input, fast(f)).withFaceLandmarks(true);
  const detect = (f, input) => f.detectSingleFace(input, full(f)).withFaceLandmarks(true).withFaceDescriptor();
  // độ lệch mũi so với giữa khuôn mặt: ~0 khi nhìn thẳng, |x| lớn khi quay đầu
  function yaw(lm) { const p = lm.positions; const l = p[0].x, r = p[16].x; return (p[30].x - l) / (r - l) - 0.5; }
  // tỉ lệ mở mắt (EAR) trung bình hai mắt
  function ear(lm) {
    const p = lm.positions, d = (a, b) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
    const one = (a) => (d(a + 1, a + 5) + d(a + 2, a + 4)) / (2 * d(a, a + 3));
    return (one(36) + one(42)) / 2;
  }
  const mean = arr => { const out = new Float32Array(128); arr.forEach(d => d.forEach((v, i) => out[i] += v / arr.length)); return out; };

  // ---- ảnh gốc dự phòng trên thiết bị (khi máy chủ chưa có migration 002) ----
  const RK = k => "cinevin-ref-" + k;
  function getRef(key) { try { const v = localStorage.getItem(RK(key)); return v ? new Float32Array(JSON.parse(v)) : null; } catch (e) { return null; } }
  function setRef(key, d) { try { localStorage.setItem(RK(key), JSON.stringify(Array.from(d))); } catch (e) {} }
  function clearRef(key) { try { localStorage.removeItem(RK(key)); } catch (e) {} }
  function compare(ref, d) { const f = window.faceapi; const dist = f.euclideanDistance(ref, d); return { dist: Math.round(dist * 100) / 100, ok: dist <= THRESHOLD, score: Math.max(0, Math.round((1 - dist * dist / 2) * 100)) }; }

  const STEPS = ["Phát hiện khuôn mặt", "Người thật: quay đầu hoặc chớp mắt", "So khớp 1:1 với ảnh gốc"];
  const view = (title, sub, mirror = true) => `
    <div class="cam-stage ${mirror ? "mirror" : ""} mx-auto aspect-square w-full max-w-[320px]" id="fk-stage" data-state="idle"><div class="face-oval"></div></div>
    <div class="text-center"><p class="text-base font-medium" id="fk-msg" aria-live="polite">${esc(title)}</p><p class="mt-0.5 text-sm text-muted" id="fk-sub">${esc(sub || "")}</p></div>
    <ol class="grid gap-2">${STEPS.map((s, i) => `<li class="flex items-center gap-3 text-sm text-muted" id="fk-c${i + 1}" data-st=""><span class="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium">${i + 1}</span><span>${s}</span></li>`).join("")}</ol>
    <p class="text-center text-xs text-muted" id="fk-perf"></p>`;
  const OKI = `<svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-10"/></svg>`;
  function mark(host, n, st) {
    const c = $("#fk-c" + n, host); if (!c) return; c.dataset.st = st;
    c.className = "flex items-center gap-3 text-sm " + (st === "on" ? "font-medium text-foreground" : st === "done" ? "text-foreground" : "text-muted");
    const b = c.querySelector("span"); b.className = "grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium " + (st === "done" ? "bg-success-bg text-success" : st === "on" ? "bg-primary text-primary-foreground" : "bg-secondary");
    if (st === "done") b.innerHTML = OKI;
  }

  /** Quyết định khớp/không: ưu tiên so khớp ở máy chủ (serverMatch), lỗi thì so khớp trên thiết bị với ảnh gốc cục bộ */
  async function decide(d, { refKey, ref, serverMatch, live, method, liveBy }) {
    const desc = Array.from(d);
    if (serverMatch) {
      try { const s = await serverMatch(desc, live, method); return { ...s, live, liveBy, method, descriptor: desc, where: "server" }; }
      catch (e) { console.warn("serverMatch", e); }
    }
    if (!ref) { refKey && setRef(refKey, d); return { ok: true, enrolled: true, live, liveBy, descriptor: desc, method, dist: 0, score: 100, where: "device" }; }
    const c = compare(ref, d);
    return { ok: c.ok, enrolled: false, live, liveBy, descriptor: desc, method, ...c, where: "device", message: c.ok ? "" : "Khuôn mặt không khớp với ảnh gốc." };
  }

  /**
   * Chạy xác thực bằng camera trong `host`. opts: { refKey, ref?, serverMatch?, onResult(r) }
   * r: {ok, enrolled, live, liveBy:'turn'|'blink', dist, score, descriptor, method, recordId?, perf:{fps, ms}}
   */
  function runCamera(host, { refKey, ref = null, serverMatch = null, onResult }) {
    host.innerHTML = view("Đang tải mô hình nhận diện…", "Lần đầu mất khoảng 5–15 giây.");
    let stream = null, timer = 0, stopped = false;
    const msg = (t, s) => { const m = $("#fk-msg", host); if (m) m.textContent = t; if (s !== undefined) { const x = $("#fk-sub", host); if (x) x.textContent = s; } };
    const stop = () => { stopped = true; clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
    const stage = () => $("#fk-stage", host);
    const finish = r => { stop(); const st = stage(); if (st) st.dataset.state = r.ok ? "ok" : "bad"; onResult(r); };
    (async () => {
      let f;
      try { f = await loadLib(); } catch (e) { return finish({ ok: false, error: "model", message: e.message }); }
      if (stopped) return;
      msg("Đang mở camera…", "");
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } }, audio: false }); }
      catch (e) { return finish({ ok: false, error: "camera", message: e.name === "NotAllowedError" ? "Bạn chưa cho phép dùng camera." : "Không mở được camera trên thiết bị này." }); }
      if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      const video = document.createElement("video"); video.playsInline = true; video.muted = true; video.autoplay = true; video.srcObject = stream;
      const canvas = document.createElement("canvas");
      stage().prepend(video); stage().appendChild(canvas);
      await video.play().catch(() => {});
      mark(host, 1, "on"); msg("Đưa khuôn mặt vào khung oval", "Đủ sáng, không đeo khẩu trang.");
      let phase = "find", base = 0, earBase = 0, closed = false, liveBy = "", samples = [], frontal = 0, frames = 0, msSum = 0;
      const t0 = Date.now();
      const loop = async () => {
        if (stopped) return;
        if (video.readyState < 2) { timer = setTimeout(loop, 100); return; }
        try {
          if (Date.now() - t0 > 45000) return finish({ ok: false, error: "timeout", message: "Hết thời gian. Thử lại ở nơi đủ sáng." });
          const t1 = performance.now();
          const r = phase === "capture" ? await detect(f, video) : await track(f, video);
          const dt = performance.now() - t1; frames++; msSum += dt;
          if (frames % 5 === 0) { const p = $("#fk-perf", host); if (p) p.textContent = `${Math.round(msSum / frames)} ms/khung · ${backend.toUpperCase()}`; }
          const ctx = canvas.getContext("2d"); canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (!r) { stage().dataset.state = "idle"; if (phase === "find") msg("Đưa khuôn mặt vào khung oval"); frontal = 0; }
          else {
            stage().dataset.state = "track";
            const b = r.detection.box; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.width, b.height);
            const y = yaw(r.landmarks), e = ear(r.landmarks);
            if (phase === "find") {
              if (Math.abs(y) < 0.08) { frontal++; earBase = earBase ? earBase * 0.7 + e * 0.3 : e;
                if (frontal >= 3) { base = y; phase = "live"; mark(host, 1, "done"); mark(host, 2, "on"); msg("Quay đầu chậm sang một bên, hoặc chớp mắt", "Bước này chống dùng ảnh in hoặc màn hình."); } }
              else msg("Nhìn thẳng vào camera");
            } else if (phase === "live") {
              if (Math.abs(y - base) > 0.12) { liveBy = "turn"; phase = "back"; msg("Tốt. Giờ nhìn thẳng lại"); }
              else if (!closed && e < earBase * 0.72) closed = true;
              else if (closed && e > earBase * 0.88) { liveBy = "blink"; phase = "back"; msg("Tốt. Giữ nguyên, nhìn thẳng"); }
              else if (!closed) earBase = earBase * 0.9 + e * 0.1;
            } else if (phase === "back") {
              if (Math.abs(y) < 0.07) { phase = "capture"; mark(host, 2, "done"); mark(host, 3, "on"); msg("Đang chụp…"); }
            } else if (phase === "capture" && r.descriptor) {
              if (Math.abs(y) < 0.08) samples.push(r.descriptor);
              if (samples.length >= 3) {
                msg("Đang đối chiếu với CSDL…");
                const res = await decide(mean(samples), { refKey, ref, serverMatch, live: true, liveBy, method: "camera" });
                res.perf = { ms: Math.round(msSum / frames), backend };
                if (res.ok) mark(host, 3, "done");
                return finish(res);
              }
            }
          }
        } catch (err) { console.error(err); }
        timer = setTimeout(loop, 60);
      };
      loop();
    })();
    return stop;
  }

  /** Xác thực từ một ảnh (khi không có camera trực tiếp). Không kiểm tra được người thật. */
  async function runImage(host, file, { refKey, ref = null, serverMatch = null, onResult }) {
    host.innerHTML = view("Đang phân tích ảnh…", "Ảnh chỉ xử lý trong trình duyệt, không gửi đi.", false);
    const stage = $("#fk-stage", host);
    const img = new Image(); img.src = URL.createObjectURL(file); await img.decode().catch(() => {});
    stage.prepend(img);
    let f; try { f = await loadLib(); } catch (e) { return onResult({ ok: false, error: "model", message: e.message }); }
    mark(host, 1, "on");
    const t1 = performance.now();
    let r = null; try { r = await detect(f, img); } catch (e) { r = null; }
    const ms = Math.round(performance.now() - t1);
    if (!r) { stage.dataset.state = "bad"; return onResult({ ok: false, error: "noface", message: "Không thấy khuôn mặt trong ảnh." }); }
    mark(host, 1, "done"); mark(host, 3, "on");
    const res = await decide(r.descriptor, { refKey, ref, serverMatch, live: false, method: "ảnh" });
    res.perf = { ms, backend };
    stage.dataset.state = res.ok ? "ok" : "bad"; if (res.ok) mark(host, 3, "done");
    onResult(res);
  }
  /** Đo thời gian: chỉ phát hiện (TinyFace) trên một nguồn ảnh – dùng ở trang Kiểm thử để so với Haar */
  async function timeDetect(input) { const f = await loadLib(); const t = performance.now(); const r = await f.detectSingleFace(input, fast(f)); return { ms: performance.now() - t, found: !!r, box: r && r.box }; }
  return { loadLib, preload, hasCameraApi, hasCamera, runCamera, runImage, timeDetect, getRef, setRef, clearRef, THRESHOLD, get backend() { return backend; } };
})();
