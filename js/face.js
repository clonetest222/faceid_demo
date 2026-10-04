/* FaceKit – xác thực khuôn mặt chạy hoàn toàn trong trình duyệt (face-api, mô hình tải từ jsDelivr).
   Luồng: phát hiện khuôn mặt → kiểm tra người thật (quay đầu rồi nhìn thẳng) → lấy đặc trưng → so khớp 1:1 với ảnh gốc.
   "Ảnh gốc" thay cho ảnh trong CSDL quốc gia về dân cư: chỉ là vector đặc trưng 128 số, lưu trên chính thiết bị, có thể xoá. */
"use strict";
const FaceKit = (() => {
  const LIB = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js";
  const MODEL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";
  const THRESHOLD = 0.5;          // khoảng cách Euclid tối đa coi là cùng một người
  let loading = null;

  function loadLib() {
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      if (window.faceapi) return res();
      const s = document.createElement("script"); s.src = LIB; s.onload = res; s.onerror = () => rej(new Error("Không tải được thư viện nhận diện khuôn mặt"));
      document.head.appendChild(s);
    }).then(async () => {
      const f = window.faceapi;
      // WebGL nhanh nhất (điện thoại, máy tính thường có); không có thì dùng CPU
      let okGl = false;
      try { okGl = await f.tf.setBackend("webgl"); } catch (e) {}
      if (!okGl) await f.tf.setBackend("cpu");
      await f.tf.ready();
      await Promise.all([f.nets.tinyFaceDetector.loadFromUri(MODEL), f.nets.faceLandmark68TinyNet.loadFromUri(MODEL), f.nets.faceRecognitionNet.loadFromUri(MODEL)]);
      return f;
    });
    loading.catch(() => { loading = null; });
    return loading;
  }
  const hasCameraApi = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  async function hasCamera() {
    if (!hasCameraApi()) return false;
    try { const d = await navigator.mediaDevices.enumerateDevices(); return d.some(x => x.kind === "videoinput"); } catch (e) { return true; }
  }
  const opts = f => new f.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
  const detect = (f, input) => f.detectSingleFace(input, opts(f)).withFaceLandmarks(true).withFaceDescriptor();
  // độ lệch mũi so với giữa khuôn mặt: ~0 khi nhìn thẳng, |x| lớn khi quay đầu
  function yaw(lm) { const p = lm.positions; const l = p[0].x, r = p[16].x; return (p[30].x - l) / (r - l) - 0.5; }
  const mean = arr => { const out = new Float32Array(128); arr.forEach(d => d.forEach((v, i) => out[i] += v / arr.length)); return out; };

  // ---- ảnh gốc (mô phỏng CSDL dân cư) ----
  const RK = k => "cinevin-ref-" + k;
  function getRef(key) { try { const v = localStorage.getItem(RK(key)); return v ? new Float32Array(JSON.parse(v)) : null; } catch (e) { return null; } }
  function setRef(key, d) { try { localStorage.setItem(RK(key), JSON.stringify(Array.from(d))); } catch (e) {} }
  function clearRef(key) { try { localStorage.removeItem(RK(key)); } catch (e) {} }
  // độ tương đồng ≈ cos giữa hai vector đặc trưng (đã chuẩn hoá): 1 − d²/2. Ngưỡng 0,5 ⇔ ~88%.
  function compare(ref, d) { const f = window.faceapi; const dist = f.euclideanDistance(ref, d); return { dist: Math.round(dist * 100) / 100, ok: dist <= THRESHOLD, score: Math.max(0, Math.round((1 - dist * dist / 2) * 100)) }; }

  const view = (title, sub) => `
    <div class="face-stage" id="fk-stage"><div class="ph">${ICON_FACE}</div><div class="ring"></div></div>
    <p class="face-msg" id="fk-msg" aria-live="polite">${esc(title)}</p>
    <p class="small muted" style="text-align:center" id="fk-sub">${esc(sub || "")}</p>
    <div class="checks">
      <div class="check" id="fk-c1"><i>1</i>Phát hiện khuôn mặt</div>
      <div class="check" id="fk-c2"><i>2</i>Kiểm tra người thật: quay đầu sang một bên rồi nhìn thẳng</div>
      <div class="check" id="fk-c3"><i>3</i>So khớp 1:1 với ảnh gốc</div>
    </div>`;

  /**
   * Chạy xác thực bằng camera trong `host` (phần tử DOM).
   * opts: { refKey, ref?: Float32Array, onResult(r) }  — r: {ok, enrolled, live, dist, score, descriptor:number[], method, error?}
   * Trả về hàm huỷ.
   */
  function runCamera(host, { refKey, ref = null, onResult }) {
    host.innerHTML = view("Đang tải mô hình nhận diện…", "Lần đầu mất khoảng 5–15 giây.");
    let stream = null, timer = null, stopped = false;
    const msg = (t, s) => { const m = $("#fk-msg", host); if (m) m.textContent = t; if (s !== undefined) { const x = $("#fk-sub", host); if (x) x.textContent = s; } };
    const mark = (id, st) => { const c = $("#" + id, host); if (c) { c.classList.remove("on", "done"); c.classList.add(st); if (st === "done") c.querySelector("i").innerHTML = ICON_OK; } };
    const stop = () => { stopped = true; clearInterval(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
    const finish = r => { stop(); const st = $("#fk-stage", host); if (st) st.classList.add(r.ok ? "ok" : "bad"); onResult(r); };
    (async () => {
      let f;
      try { f = await loadLib(); } catch (e) { return finish({ ok: false, error: "model", message: e.message }); }
      if (stopped) return;
      msg("Đang mở camera…", "");
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } }, audio: false }); }
      catch (e) { return finish({ ok: false, error: "camera", message: e.name === "NotAllowedError" ? "Bạn chưa cho phép dùng camera." : "Không mở được camera trên thiết bị này." }); }
      if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      const stage = $("#fk-stage", host);
      const video = document.createElement("video"); video.playsInline = true; video.muted = true; video.autoplay = true; video.srcObject = stream;
      const canvas = document.createElement("canvas");
      stage.querySelector(".ph").replaceWith(video); stage.appendChild(canvas);
      await video.play().catch(() => {});
      mark("fk-c1", "on"); msg("Đưa khuôn mặt vào giữa khung", "Đủ sáng, không đeo khẩu trang.");
      let phase = "find", base = 0, turned = false, samples = [], frontal = 0; const t0 = Date.now(); let busy = false;
      timer = setInterval(async () => {
        if (busy || stopped || video.readyState < 2) return; busy = true;
        try {
          if (Date.now() - t0 > 45000) return finish({ ok: false, error: "timeout", message: "Hết thời gian. Thử lại ở nơi đủ sáng." });
          const r = await detect(f, video);
          const ctx = canvas.getContext("2d"); canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (!r) { if (phase === "find") msg("Đưa khuôn mặt vào giữa khung"); frontal = 0; return; }
          const b = r.detection.box; ctx.strokeStyle = "#3FB68B"; ctx.lineWidth = 4; ctx.strokeRect(b.x, b.y, b.width, b.height);
          const y = yaw(r.landmarks);
          if (phase === "find") {
            if (Math.abs(y) < 0.08) { frontal++; if (frontal >= 3) { base = y; phase = "turn"; mark("fk-c1", "done"); mark("fk-c2", "on"); msg("Quay đầu chậm sang trái hoặc phải", "Bước này chống dùng ảnh in hoặc màn hình."); } }
            else msg("Nhìn thẳng vào camera");
          } else if (phase === "turn") {
            if (Math.abs(y - base) > 0.12) { turned = true; phase = "back"; msg("Tốt. Giờ nhìn thẳng lại"); }
          } else if (phase === "back") {
            if (Math.abs(y) < 0.07) { samples.push(r.descriptor); if (samples.length >= 3) {
              mark("fk-c2", "done"); mark("fk-c3", "on");
              const d = mean(samples);
              if (!ref) { refKey && setRef(refKey, d); mark("fk-c3", "done"); return finish({ ok: true, enrolled: true, live: turned, descriptor: Array.from(d), method: "camera", dist: 0, score: 100 }); }
              const c = compare(ref, d); if (c.ok) mark("fk-c3", "done");
              return finish({ ok: c.ok, enrolled: false, live: turned, descriptor: Array.from(d), method: "camera", ...c, message: c.ok ? "" : "Khuôn mặt không khớp với ảnh gốc." });
            } }
          }
        } catch (e) { console.error(e); } finally { busy = false; }
      }, 180);
    })();
    return stop;
  }

  /** Xác thực từ một ảnh (khi không có camera trực tiếp). Không kiểm tra được người thật. */
  async function runImage(host, file, { refKey, ref = null, onResult }) {
    host.innerHTML = view("Đang phân tích ảnh…", "Ảnh chỉ xử lý trong trình duyệt, không gửi đi.");
    const stage = $("#fk-stage", host);
    const img = new Image(); img.src = URL.createObjectURL(file); await img.decode().catch(() => {});
    stage.querySelector(".ph").replaceWith(img);
    let f; try { f = await loadLib(); } catch (e) { return onResult({ ok: false, error: "model", message: e.message }); }
    let r = null; try { r = await detect(f, img); } catch (e) { r = null; }
    if (!r) { stage.classList.add("bad"); return onResult({ ok: false, error: "noface", message: "Không thấy khuôn mặt trong ảnh." }); }
    const d = r.descriptor;
    if (!ref) { refKey && setRef(refKey, d); stage.classList.add("ok"); return onResult({ ok: true, enrolled: true, live: false, descriptor: Array.from(d), method: "ảnh", dist: 0, score: 100 }); }
    const c = compare(ref, d); stage.classList.add(c.ok ? "ok" : "bad");
    onResult({ ok: c.ok, enrolled: false, live: false, descriptor: Array.from(d), method: "ảnh", ...c, message: c.ok ? "" : "Khuôn mặt không khớp với ảnh gốc." });
  }
  return { loadLib, hasCameraApi, hasCamera, runCamera, runImage, getRef, setRef, clearRef, THRESHOLD };
})();
