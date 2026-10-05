/* Haar – phát hiện khuôn mặt + mắt bằng Haar cascade của OpenCV (theo bài "Face Detection using Haar Cascades").
   Các bước như bài: ảnh xám → face_cascade.detectMultiScale → trong mỗi vùng mặt, eye_cascade.detectMultiScale.
   Dùng thêm: đếm chớp mắt (đang thấy 2 mắt → mất mắt vài khung → thấy lại) để chống ảnh tĩnh.
   Haar chỉ TÌM khuôn mặt, không biết là ai – việc so khớp 1:1 vẫn do face-api (FaceKit) làm.
   OpenCV.js nặng ~10 MB nên chỉ tải khi mở công cụ này. */
"use strict";
const Haar = (() => {
  const CV = "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js";
  const XML = "https://cdn.jsdelivr.net/gh/opencv/opencv@4.10.0/data/haarcascades/";
  let ready = null;
  function load(onProgress = () => {}) {
    if (ready) return ready;
    ready = (async () => {
      onProgress("Đang tải OpenCV.js (~10 MB)…");
      if (!window.cv || !window.cv.Mat) {
        await new Promise((res, rej) => { const s = document.createElement("script"); s.src = CV; s.async = true; s.onload = res; s.onerror = () => rej(new Error("Không tải được OpenCV.js")); document.head.appendChild(s); });
        // Không `await window.cv`: Module của Emscripten có hàm then() trả về chính nó → await lặp vô hạn, treo trang.
        // Chờ đến khi runtime sẵn sàng (có cv.Mat), qua onRuntimeInitialized hoặc kiểm tra định kỳ.
        await new Promise((res, rej) => {
          const t0 = Date.now();
          const tick = () => {
            const c = window.cv;
            if (c && c.Mat) return res();
            if (Date.now() - t0 > 60000) return rej(new Error("OpenCV.js khởi động quá lâu"));
            setTimeout(tick, 100);
          };
          if (window.cv && !window.cv.Mat) { const prev = window.cv.onRuntimeInitialized; window.cv.onRuntimeInitialized = () => { prev && prev(); res(); }; }
          tick();
        });
      }
      const cv = window.cv;
      onProgress("Đang tải bộ phân loại Haar…");
      for (const name of ["haarcascade_frontalface_default.xml", "haarcascade_eye.xml"]) {
        try { cv.FS_unlink("/" + name); } catch (e) {}
        const buf = new Uint8Array(await (await fetch(XML + name)).arrayBuffer());
        cv.FS_createDataFile("/", name, buf, true, false, false);
      }
      const face = new cv.CascadeClassifier(); face.load("haarcascade_frontalface_default.xml");
      const eye = new cv.CascadeClassifier(); eye.load("haarcascade_eye.xml");
      return { cv, face, eye };
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }
  /** Chạy trên một canvas (đã vẽ khung hình). Trả về {faces:[{x,y,w,h,eyes:[{x,y,w,h}]}], ms} */
  function detect(k, canvas) {
    const { cv, face, eye } = k, t = performance.now();
    const src = cv.imread(canvas), gray = new cv.Mat(), faces = new cv.RectVector(), out = [];
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.equalizeHist(gray, gray);
    face.detectMultiScale(gray, faces, 1.1, 4, 0, new cv.Size(60, 60), new cv.Size(0, 0));
    for (let i = 0; i < faces.size(); i++) {
      const f = faces.get(i), roi = gray.roi(new cv.Rect(f.x, f.y, f.width, Math.round(f.height * 0.6))), eyes = new cv.RectVector();
      eye.detectMultiScale(roi, eyes, 1.1, 6, 0, new cv.Size(Math.round(f.width / 10), Math.round(f.width / 10)), new cv.Size(0, 0));
      const es = []; for (let j = 0; j < eyes.size(); j++) { const e = eyes.get(j); es.push({ x: f.x + e.x, y: f.y + e.y, w: e.width, h: e.height }); }
      out.push({ x: f.x, y: f.y, w: f.width, h: f.height, eyes: es.slice(0, 2) });
      roi.delete(); eyes.delete();
    }
    src.delete(); gray.delete(); faces.delete();
    return { faces: out, ms: performance.now() - t };
  }
  /** Camera trực tiếp trong `host`. onStats({fps, ms, faces, eyes, blinks, tinyMs}). Trả về hàm dừng. */
  function runLive(host, { onStats = () => {}, onError = () => {}, compareTiny = true } = {}) {
    let stream = null, stopped = false, timer = 0;
    const stop = () => { stopped = true; clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); };
    (async () => {
      let k;
      try { k = await load(m => onStats({ status: m })); } catch (e) { return onError(e.message); }
      if (stopped) return;
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 } }, audio: false }); }
      catch (e) { return onError(e.name === "NotAllowedError" ? "Bạn chưa cho phép dùng camera." : "Không mở được camera."); }
      if (stopped) return stop();
      const video = document.createElement("video"); video.playsInline = true; video.muted = true; video.srcObject = stream;
      const work = document.createElement("canvas"), view = document.createElement("canvas");
      host.innerHTML = ""; host.appendChild(video); host.appendChild(view);
      await video.play().catch(() => {});
      let eyesSeen = 0, gone = 0, blinks = 0, frames = 0, t0 = performance.now(), tinyMs = null;
      const loop = async () => {
        if (stopped) return;
        if (video.readyState >= 2) {
          const w = 320, h = Math.round(video.videoHeight / video.videoWidth * 320) || 240;
          work.width = w; work.height = h; work.getContext("2d").drawImage(video, 0, 0, w, h);
          const r = detect(k, work); frames++;
          view.width = w; view.height = h; const ctx = view.getContext("2d"); ctx.clearRect(0, 0, w, h);
          ctx.lineWidth = 2;
          r.faces.forEach(f => { ctx.strokeStyle = "#4ade80"; ctx.strokeRect(f.x, f.y, f.w, f.h); ctx.strokeStyle = "#60a5fa"; f.eyes.forEach(e => ctx.strokeRect(e.x, e.y, e.w, e.h)); });
          const n = r.faces[0] ? r.faces[0].eyes.length : -1;
          if (n === 2) { if (gone >= 1 && gone <= 8 && eyesSeen >= 3) blinks++; eyesSeen++; gone = 0; }
          else if (n >= 0 && n < 2 && eyesSeen >= 3) gone++;
          if (gone > 8) { eyesSeen = 0; gone = 0; }
          if (compareTiny && window.faceapi && frames % 15 === 0) { try { tinyMs = (await FaceKit.timeDetect(work)).ms; } catch (e) {} }
          const fps = frames / ((performance.now() - t0) / 1000);
          onStats({ fps: Math.round(fps * 10) / 10, ms: Math.round(r.ms), faces: r.faces.length, eyes: n < 0 ? 0 : n, blinks, tinyMs: tinyMs == null ? null : Math.round(tinyMs) });
        }
        timer = setTimeout(loop, 30);
      };
      loop();
    })();
    return stop;
  }
  /** Chạy một lần trên ảnh người dùng chọn: trả về số mặt, số mắt, thời gian Haar và TinyFace */
  async function runImage(file, onProgress) {
    const k = await load(onProgress);
    const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
    const s = Math.min(1, 480 / img.naturalWidth), c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const r = detect(k, c);
    let tiny = null; try { tiny = await FaceKit.timeDetect(c); } catch (e) {}
    const ctx = c.getContext("2d"); ctx.lineWidth = 3;
    r.faces.forEach(f => { ctx.strokeStyle = "#16a34a"; ctx.strokeRect(f.x, f.y, f.w, f.h); ctx.strokeStyle = "#2563eb"; f.eyes.forEach(e => ctx.strokeRect(e.x, e.y, e.w, e.h)); });
    return { faces: r.faces.length, eyes: r.faces[0] ? r.faces[0].eyes.length : 0, ms: Math.round(r.ms), tinyMs: tiny ? Math.round(tiny.ms) : null, tinyFound: tiny ? tiny.found : null, dataUrl: c.toDataURL("image/jpeg", 0.85) };
  }
  return { load, detect, runLive, runImage };
})();
