// Đổi tham số ?v= của mọi js/css nội bộ trong index.html để trình duyệt (và GitHub Pages) không dùng bản cũ. Chạy trước khi commit UI: node tools/bump-version.mjs
import { readFileSync, writeFileSync } from "node:fs";
const v = new Date().toISOString().replace(/\D/g, "").slice(0, 12), s = readFileSync("index.html", "utf8");
const out = s.replace(/(href="css\/app\.css|src="js\/[a-z-]+\.js)(\?v=\d+)?"/g, `$1?v=${v}"`);
writeFileSync("index.html", out); console.log("v=" + v, (out.match(/\?v=/g) || []).length + " tệp");
