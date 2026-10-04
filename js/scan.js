/* Scan – quét mã QR vé bằng camera sau (BarcodeDetector nếu trình duyệt có, nếu không dùng jsQR). */
"use strict";
const Scan = (() => {
  /** Bắt đầu quét trong `stage` (phần tử chứa). onCode(text) gọi một lần rồi dừng. Trả về hàm dừng. */
  function start(stage, onCode, onError) {
    let stream = null, raf = 0, stopped = false;
    const stop = () => { stopped = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); };
    (async () => {
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return onError("Trình duyệt không hỗ trợ camera hoặc trang không chạy HTTPS.");
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }); }
      catch (e) { return onError(e.name === "NotAllowedError" ? "Bạn chưa cho phép dùng camera." : "Không mở được camera."); }
      if (stopped) return stop();
      const video = document.createElement("video"); video.playsInline = true; video.muted = true; video.srcObject = stream;
      stage.innerHTML = ""; stage.appendChild(video); const fr = document.createElement("div"); fr.className = "frame"; stage.appendChild(fr);
      await video.play().catch(() => {});
      let detector = null;
      if ("BarcodeDetector" in window) { try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (e) {} }
      const cv = document.createElement("canvas"), ctx = cv.getContext("2d", { willReadFrequently: true });
      const tick = async () => {
        if (stopped) return;
        if (video.readyState >= 2) {
          try {
            if (detector) { const r = await detector.detect(video); if (r[0]) { stop(); return onCode(r[0].rawValue); } }
            else if (window.jsQR) {
              const w = video.videoWidth, h = video.videoHeight, s = Math.min(1, 640 / w); cv.width = w * s; cv.height = h * s;
              ctx.drawImage(video, 0, 0, cv.width, cv.height);
              const q = jsQR(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
              if (q && q.data) { stop(); return onCode(q.data); }
            }
          } catch (e) {}
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    })();
    return stop;
  }
  return { start };
})();
