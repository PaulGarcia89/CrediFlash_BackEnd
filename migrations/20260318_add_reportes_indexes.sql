CREATE INDEX IF NOT EXISTS idx_cuotas_fecha_vencimiento_estado
  ON public.cuotas (fecha_vencimiento, estado);

CREATE INDEX IF NOT EXISTS idx_cuotas_fecha_pago
  ON public.cuotas (fecha_pago);

CREATE INDEX IF NOT EXISTS idx_prestamos_status_fecha_inicio
  ON public.prestamos (status, fecha_inicio);
