CREATE TABLE IF NOT EXISTS public.pagos_bancarios_cargados (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL,
  nombre_completo character varying(200) NOT NULL,
  monto numeric(14,2) NOT NULL,
  fecha_pago date NOT NULL,
  archivo_nombre character varying(255) NOT NULL,
  fila_origen integer NOT NULL,
  estado character varying(20) NOT NULL DEFAULT 'VALIDO',
  observacion text NULL,
  creado_por_analista_id uuid NOT NULL,
  creado_en timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pagos_bancarios_cargados_pkey PRIMARY KEY (id),
  CONSTRAINT pagos_bancarios_cargados_estado_check CHECK (
    estado IN ('VALIDO', 'INVALIDO', 'PROCESADO', 'DUPLICADO')
  ),
  CONSTRAINT pagos_bancarios_cargados_creado_por_fk FOREIGN KEY (creado_por_analista_id)
    REFERENCES public.analistas (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT uq_pagos_bancarios_archivo_fila UNIQUE (
    nombre_completo, monto, fecha_pago, archivo_nombre, fila_origen
  )
);

CREATE INDEX IF NOT EXISTS idx_pagos_bancarios_lote_id
  ON public.pagos_bancarios_cargados (lote_id);

CREATE INDEX IF NOT EXISTS idx_pagos_bancarios_fecha_pago
  ON public.pagos_bancarios_cargados (fecha_pago);

CREATE INDEX IF NOT EXISTS idx_pagos_bancarios_creado_por
  ON public.pagos_bancarios_cargados (creado_por_analista_id);
