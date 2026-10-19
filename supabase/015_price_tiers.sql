-- CineVin – migration 015: bảng giá hạng A / hạng B sửa được. Chạy SAU 014. Chạy lại nhiều lần không sao.
--   Hạng giá của cơ sở (A = thành phố lớn, B = tỉnh) trước đây cố định trong mã; nay quản lý chuỗi tự đặt
--   (ví dụ hạng A người lớn ngày thường 115.000 → 150.000). Cơ sở có bảng giá riêng (006/011) vẫn ưu tiên bảng riêng.
create table if not exists public.price_tiers (
  id text primary key check (id in ('A', 'B')),
  name text not null,
  prices jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.price_tiers enable row level security;
drop policy if exists "read_all" on public.price_tiers; create policy "read_all" on public.price_tiers for select to anon, authenticated using (true);
do $$ begin alter publication supabase_realtime add table public.price_tiers; exception when duplicate_object then null; end $$;
insert into public.price_tiers (id, name, prices) values
  ('A', 'Hạng A – Hà Nội, TP.HCM', '{"weekday":{"adult":115000,"child":68000,"senior":83000,"u22":70000},"wed":{"adult":79000,"child":68000,"senior":79000,"u22":70000},"weekend":{"adult":135000,"child":68000,"senior":93000,"u22":70000},"vip":5500,"couple":26000,"gold":60000,"imax":80000,"s3d":{"weekday":32000,"weekend":53000},"holiday":11000}'::jsonb),
  ('B', 'Hạng B – tỉnh', '{"weekday":{"adult":70000,"child":50000,"senior":50000,"u22":60000},"wed":{"adult":60000,"child":50000,"senior":60000,"u22":60000},"weekend":{"adult":85000,"child":58000,"senior":58000,"u22":60000},"vip":5500,"couple":16000,"gold":40000,"imax":60000,"s3d":{"weekday":32000,"weekend":32000},"holiday":11000}'::jsonb)
on conflict (id) do nothing;

create or replace function public.save_price_tier_s(p_token uuid, p_tier text, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; d text; a text;
begin
  u := _need(p_token, array['quanly']);
  if u.cinema_id is not null then raise exception 'forbidden'; end if;   -- hạng giá dùng chung toàn chuỗi
  if p_tier not in ('A', 'B') then raise exception 'bad_input'; end if;
  foreach d in array array['weekday', 'wed', 'weekend'] loop
    foreach a in array array['adult', 'u22', 'child', 'senior'] loop
      if jsonb_typeof(p->d->a) <> 'number' or (p->d->>a)::numeric < 0 then raise exception 'bad_input'; end if;
    end loop;
    if (p->d->>'adult')::numeric <= 0 then raise exception 'bad_input'; end if;
  end loop;
  update price_tiers set prices = p, updated_at = now() where id = p_tier;
  perform _admin_log(u.username, format('bảng giá hạng %s: người lớn %s / %s / %s', p_tier, p->'weekday'->>'adult', p->'wed'->>'adult', p->'weekend'->>'adult'));
end $$;
grant execute on function public.save_price_tier_s(uuid, text, jsonb) to anon, authenticated;
