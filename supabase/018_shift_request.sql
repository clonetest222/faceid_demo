-- CineVin – migration 018: nhân viên tự đăng ký ca. Chạy SAU 017. Chạy lại nhiều lần không sao.
--   Nhân viên chọn ngày + ca (sáng / chiều / tối / tuỳ chỉnh) + vị trí → ca ở trạng thái "requested";
--   quản lý duyệt (confirmed) hoặc từ chối (declined) trên bảng ca / tab chấm công.
alter table public.shifts drop constraint if exists shifts_status_check;
alter table public.shifts add constraint shifts_status_check check (status in ('requested', 'planned', 'confirmed', 'declined', 'cancelled'));

create or replace function public.shift_request_s(p_token uuid, p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare u app_users; s_at timestamptz := (p->>'start_at')::timestamptz; e_at timestamptz := (p->>'end_at')::timestamptz; sid bigint; cid text;
begin
  u := _need(p_token, array['nhanvien', 'kythuat', 'phucvu', 'quanly']);
  cid := coalesce(u.cinema_id, p->>'cinema_id');
  if cid is null or not exists (select 1 from cinemas where id = cid) then raise exception 'unknown_cinema'; end if;
  if s_at is null or e_at is null or e_at <= s_at or e_at - s_at > interval '14 hours' then raise exception 'bad_input'; end if;
  if s_at < now() - interval '1 hour' then raise exception 'bad_input'; end if;
  if exists (select 1 from shifts x where x.username = u.username and x.status not in ('cancelled', 'declined') and x.start_at < e_at and x.end_at > s_at) then raise exception 'shift_overlap'; end if;
  insert into shifts (cinema_id, username, day, start_at, end_at, kind, duty, status, note, created_by)
  values (cid, u.username, (s_at at time zone 'Asia/Ho_Chi_Minh')::date, s_at, e_at, coalesce(p->>'kind', 'sang'), coalesce(p->>'duty', 'quay'), 'requested', p->>'note', u.username) returning id into sid;
  insert into audit_logs (type, msg, ok) values ('attend', format('@%s đăng ký ca %s %s–%s (%s)', u.username, to_char(s_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM'), to_char(s_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'), to_char(e_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'), coalesce(p->>'duty', 'quay')), true);
  return sid;
end $$;

create or replace function public.shift_approve_s(p_token uuid, p_id bigint, p_ok boolean)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; s shifts;
begin
  u := _need(p_token, array['quanly']);
  select * into s from shifts where id = p_id; if s.id is null then raise exception 'unknown_shift'; end if;
  if not _staff_scope(u, s.cinema_id) then raise exception 'wrong_cinema'; end if;
  update shifts set status = case when p_ok then 'confirmed' else 'declined' end where id = p_id;
  perform _admin_log(u.username, format('%s ca #%s @%s %s', case when p_ok then 'duyệt' else 'từ chối' end, p_id, s.username, to_char(s.start_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI')));
end $$;
grant execute on function public.shift_request_s(uuid, jsonb), public.shift_approve_s(uuid, bigint, boolean) to anon, authenticated;
