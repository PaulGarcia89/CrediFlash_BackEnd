const ensureSolicitudFinancialColumns = async (sequelize) => {
  await sequelize.query(`
    ALTER TABLE public.solicitudes
      ADD COLUMN IF NOT EXISTS interes_porcentaje numeric(10,4) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS tasa_base numeric(10,4) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS tasa_variable numeric(10,4) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS interes_total numeric(15,2) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS numero_cuotas integer DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS valor_cuota numeric(15,2) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS fecha_fin timestamp without time zone NULL
  `);

  await sequelize.query(`
    UPDATE public.solicitudes
    SET
      interes_porcentaje = COALESCE(interes_porcentaje, tasa_variable, tasa_base),
      tasa_base = COALESCE(tasa_base, interes_porcentaje, tasa_variable),
      tasa_variable = COALESCE(tasa_variable, interes_porcentaje, tasa_base),
      interes_total = COALESCE(interes_total, monto_solicitado * COALESCE(interes_porcentaje, tasa_variable, tasa_base, 0) / 100),
      numero_cuotas = COALESCE(numero_cuotas, plazo_semanas),
      valor_cuota = COALESCE(valor_cuota, CASE
        WHEN COALESCE(numero_cuotas, plazo_semanas, 0) > 0 THEN
          ROUND((monto_solicitado + (monto_solicitado * COALESCE(interes_porcentaje, tasa_variable, tasa_base, 0) / 100)) / COALESCE(numero_cuotas, plazo_semanas), 2)
        ELSE NULL
      END)
    WHERE
      interes_porcentaje IS NULL
      OR tasa_base IS NULL
      OR tasa_variable IS NULL
      OR interes_total IS NULL
      OR numero_cuotas IS NULL
      OR valor_cuota IS NULL
  `);
};

module.exports = {
  ensureSolicitudFinancialColumns
};
