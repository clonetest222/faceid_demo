-- 003: sửa reset_demo (Supabase chặn DELETE không có WHERE khi gọi qua API)
-- và xoá luôn ảnh gốc khuôn mặt mô phỏng để kiểm thử lại từ đầu.
create or replace function public.reset_demo()
returns void language sql security definer set search_path = public as $$
  delete from audit_logs where true; delete from group_members where true; delete from groups where true;
  delete from tickets where true; delete from seat_locks where true; delete from shows where true;
  delete from verifications where true;
  update mock_citizens set face_template = null, template_source = null, template_at = null where true;
$$;
grant execute on function public.reset_demo to anon, authenticated;
