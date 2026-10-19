-- CineVin – migration 013: giá cứng cho loại ghế. Chạy SAU 012. Chạy lại nhiều lần không sao.
--   Mỗi loại ghế chọn một trong hai cách tính: (a) giá cơ bản × số người + phụ thu (như cũ), (b) GIÁ CỨNG theo hạng rạp A/B –
--   giá cuối cùng cho cả ghế (ghế đôi = cả cặp), không phụ thuộc ngày / đối tượng / loại phòng.
alter table public.seat_types add column if not exists fixed_a numeric;   -- null = không dùng giá cứng
alter table public.seat_types add column if not exists fixed_b numeric;

create or replace function public.save_seat_type_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; v_id text := p->>'id';
begin
  u := _need(p_token, array['quanly']);
  if u.cinema_id is not null then raise exception 'forbidden'; end if;
  if v_id !~ '^[a-z0-9_]{1,16}$' or length(trim(coalesce(p->>'name', ''))) < 1 then raise exception 'bad_input'; end if;
  if v_id in ('std', 'blocked') and coalesce((p->>'sellable')::boolean, v_id = 'std') <> (v_id = 'std') then raise exception 'bad_input'; end if;
  if (p->>'fixed_a') is not null and (p->>'fixed_a')::numeric <= 0 then raise exception 'bad_input'; end if;
  if (p->>'fixed_b') is not null and (p->>'fixed_b')::numeric <= 0 then raise exception 'bad_input'; end if;
  insert into seat_types (id, name, persons, surcharge_a, surcharge_b, fixed_a, fixed_b, color, icon, sellable, sort, active)
  values (v_id, trim(p->>'name'), coalesce((p->>'persons')::int, 1), coalesce((p->>'surcharge_a')::numeric, 0), coalesce((p->>'surcharge_b')::numeric, 0),
          (p->>'fixed_a')::numeric, (p->>'fixed_b')::numeric,
          coalesce(p->>'color', 'gray'), nullif(p->>'icon', ''), coalesce((p->>'sellable')::boolean, true), coalesce((p->>'sort')::int, 100), coalesce((p->>'active')::boolean, true))
  on conflict (id) do update set name = excluded.name, persons = excluded.persons, surcharge_a = excluded.surcharge_a, surcharge_b = excluded.surcharge_b,
    fixed_a = excluded.fixed_a, fixed_b = excluded.fixed_b, color = excluded.color, icon = excluded.icon, sellable = excluded.sellable, sort = excluded.sort, active = excluded.active;
  perform _admin_log(u.username, format('lưu loại ghế %s "%s" (%s người, %s%s)', v_id, trim(p->>'name'), coalesce((p->>'persons')::int, 1),
    case when (p->>'fixed_a') is not null then format('giá cứng A %s / B %s', p->>'fixed_a', p->>'fixed_b') else format('phụ thu A %s / B %s', coalesce((p->>'surcharge_a')::numeric, 0), coalesce((p->>'surcharge_b')::numeric, 0)) end,
    case when coalesce((p->>'sellable')::boolean, true) then '' else ', không bán' end));
end $$;
grant execute on function public.save_seat_type_s(uuid, jsonb) to anon, authenticated;
