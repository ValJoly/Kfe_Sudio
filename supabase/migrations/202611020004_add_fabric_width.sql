alter table public.fabrics
  add column width numeric(10, 2),
  add column width_unit text,
  add constraint fabrics_width_pair check (
    (width is null and width_unit is null)
    or (
      width is not null
      and width >= 0
      and width_unit is not null
      and width_unit in ('centimetres', 'inches')
    )
  );
