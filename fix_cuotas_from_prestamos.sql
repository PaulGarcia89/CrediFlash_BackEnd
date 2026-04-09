BEGIN;

DELETE FROM public.cuotas
WHERE prestamo_id IN (
  SELECT id FROM public.prestamos WHERE COALESCE(num_semanas,0) > 0
);

WITH p AS (
  SELECT
    id AS prestamo_id,
    fecha_inicio::date AS fecha_inicio,
    COALESCE(num_semanas,0)::int AS num_semanas,
    COALESCE(monto_solicitado,0)::numeric(15,2) AS monto_solicitado,
    COALESCE(ganancias,0)::numeric(15,2) AS ganancias,
    COALESCE(total_pagar,0)::numeric(15,2) AS total_pagar,
    GREATEST(COALESCE(pagos_hechos,0)::int, 0) AS pagos_hechos
  FROM public.prestamos
  WHERE COALESCE(num_semanas,0) > 0
),
s AS (
  SELECT p.*, gs.n AS cuota_num
  FROM p
  CROSS JOIN LATERAL generate_series(1, p.num_semanas) AS gs(n)
),
calc AS (
  SELECT
    prestamo_id,
    cuota_num,
    (fecha_inicio + (cuota_num * 7) * INTERVAL '1 day')::date AS fecha_vencimiento,
    ROUND((monto_solicitado / num_semanas)::numeric, 2) AS cap_base,
    ROUND((ganancias / num_semanas)::numeric, 2) AS int_base,
    ROUND((total_pagar / num_semanas)::numeric, 2) AS tot_base,
    monto_solicitado,
    ganancias,
    total_pagar,
    num_semanas,
    pagos_hechos
  FROM s
),
ins AS (
  INSERT INTO public.cuotas (
    prestamo_id, fecha_vencimiento, monto_capital, monto_interes, monto_total,
    estado, fecha_pago, monto_pagado, observaciones
  )
  SELECT
    c.prestamo_id,
    c.fecha_vencimiento,
    CASE
      WHEN c.cuota_num < c.num_semanas THEN c.cap_base
      ELSE ROUND((c.monto_solicitado - (c.cap_base * (c.num_semanas - 1)))::numeric, 2)
    END,
    CASE
      WHEN c.cuota_num < c.num_semanas THEN c.int_base
      ELSE ROUND((c.ganancias - (c.int_base * (c.num_semanas - 1)))::numeric, 2)
    END,
    CASE
      WHEN c.cuota_num < c.num_semanas THEN c.tot_base
      ELSE ROUND((c.total_pagar - (c.tot_base * (c.num_semanas - 1)))::numeric, 2)
    END,
    CASE WHEN c.cuota_num <= c.pagos_hechos THEN 'PAGADO' ELSE 'PENDIENTE' END,
    CASE WHEN c.cuota_num <= c.pagos_hechos THEN NOW() ELSE NULL END,
    CASE
      WHEN c.cuota_num <= c.pagos_hechos THEN
        CASE
          WHEN c.cuota_num < c.num_semanas THEN c.tot_base
          ELSE ROUND((c.total_pagar - (c.tot_base * (c.num_semanas - 1)))::numeric, 2)
        END
      ELSE 0
    END,
    'Cuota ' || c.cuota_num || ' de ' || c.num_semanas
  FROM calc c
  RETURNING 1
)
UPDATE public.prestamos p
SET
  pagos_hechos = x.pagos_hechos,
  pagos_pendientes = x.pagos_pendientes,
  pagado = x.pagado,
  pendiente = x.pendiente,
  status = CASE
    WHEN x.pagos_pendientes <= 0 OR x.pendiente <= 0 THEN 'PAGADO'
    ELSE 'LE QUEDAN ' || x.pagos_pendientes || ' PAGOS POR PAGAR'
  END
FROM (
  SELECT
    c.prestamo_id,
    COUNT(*) FILTER (WHERE c.estado = 'PAGADO')::int AS pagos_hechos,
    COUNT(*) FILTER (WHERE c.estado <> 'PAGADO')::int AS pagos_pendientes,
    ROUND(SUM(COALESCE(c.monto_pagado,0))::numeric, 2) AS pagado,
    ROUND(SUM(GREATEST(COALESCE(c.monto_total,0) - COALESCE(c.monto_pagado,0),0))::numeric, 2) AS pendiente
  FROM public.cuotas c
  GROUP BY c.prestamo_id
) x
WHERE p.id = x.prestamo_id;

COMMIT;
