// Gộp toàn bộ migration thành một file để cài mới: node tools/build-schema.mjs → supabase/schema_full.sql
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase");
const files = ["schema.sql", ...readdirSync(DIR).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()];
const out = [`-- CineVin – schema đầy đủ (gộp ${files.length} file, sinh bởi tools/build-schema.mjs ${new Date().toISOString().slice(0, 10)}).`,
  `-- Cài mới: dán toàn bộ file này vào Supabase SQL Editor và chạy MỘT lần (mọi lệnh đều idempotent, chạy lại không sao).`,
  `-- Dự án đã chạy các migration lẻ: chỉ cần chạy các file còn thiếu theo thứ tự số (xem README).`,
  `-- Khoá: mọi bảng dữ liệu có PRIMARY KEY id bigint identity (019); mã nghiệp vụ (tên đăng nhập, mã vé, mã rạp…) là UNIQUE / khoá text có chủ đích.`, ""];
for (const f of files) { out.push(`-- ============================================================================`, `-- ${f}`, `-- ============================================================================`, readFileSync(join(DIR, f), "utf8").trim(), ""); }
writeFileSync(join(DIR, "schema_full.sql"), out.join("\n") + "\n");
console.log(`schema_full.sql: ${files.length} file, ${out.join("\n").length} ký tự`);
