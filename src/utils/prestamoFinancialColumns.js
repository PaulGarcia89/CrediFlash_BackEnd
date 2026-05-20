const ensurePrestamoFinancialColumns = async (sequelize) => {
  await sequelize.query(`
    ALTER TABLE public.prestamos
      ADD COLUMN IF NOT EXISTS monto_original DECIMAL(15,2) NULL,
      ADD COLUMN IF NOT EXISTS interes_porcentaje DECIMAL(15,4) NULL,
      ADD COLUMN IF NOT EXISTS interes_total DECIMAL(15,2) NULL,
      ADD COLUMN IF NOT EXISTS numero_cuotas INTEGER NULL,
      ADD COLUMN IF NOT EXISTS fecha_fin TIMESTAMP WITHOUT TIME ZONE NULL,
      ADD COLUMN IF NOT EXISTS valor_cuota DECIMAL(15,2) NULL,
      ADD COLUMN IF NOT EXISTS abono_parcial_acumulado DECIMAL(15,2) NOT NULL DEFAULT 0
  `);

  await sequelize.query(`
    ALTER TABLE public.prestamos
      ALTER COLUMN interes TYPE DECIMAL(15,4)
      USING COALESCE(interes, 0)::DECIMAL(15,4)
  `);

  await sequelize.query(`
    UPDATE public.prestamos
    SET
      monto_original = COALESCE(monto_original, monto_solicitado, total_pagar),
      interes_porcentaje = COALESCE(interes_porcentaje, interes, 0),
      interes_total = COALESCE(interes_total, total_pagar - COALESCE(monto_solicitado, monto_original, 0)),
      numero_cuotas = COALESCE(numero_cuotas, num_semanas),
      fecha_fin = COALESCE(fecha_fin, fecha_vencimiento),
      valor_cuota = COALESCE(valor_cuota, pagos_semanales),
      abono_parcial_acumulado = COALESCE(abono_parcial_acumulado, 0)
    WHERE
      monto_original IS NULL
      OR interes_porcentaje IS NULL
      OR interes_total IS NULL
      OR numero_cuotas IS NULL
      OR fecha_fin IS NULL
      OR valor_cuota IS NULL
  `);
};

module.exports = {
  ensurePrestamoFinancialColumns
};
