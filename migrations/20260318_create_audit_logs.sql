CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  analista_id uuid NULL,
  analista_nombre varchar(200) NULL,
  analista_email varchar(200) NULL,
  rol_nombre varchar(100) NULL,
  modulo varchar(100) NOT NULL,
  accion varchar(255) NOT NULL,
  entidad varchar(100) NULL,
  entidad_id varchar(100) NULL,
  metodo_http varchar(10) NULL,
  endpoint varchar(255) NULL,
  status_code int NULL,
  resultado varchar(20) NOT NULL DEFAULT 'SUCCESS',
  ip varchar(100) NULL,
  user_agent text NULL,
  request_id varchar(120) NULL,
  metadata jsonb NULL,
  error_message text NULL,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON public.audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_analista_id
  ON public.audit_logs (analista_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_modulo
  ON public.audit_logs (modulo);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entidad
  ON public.audit_logs (entidad, entidad_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_resultado
  ON public.audit_logs (resultado);
