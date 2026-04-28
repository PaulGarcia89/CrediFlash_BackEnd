const ensurePrestamoAbonoParcialColumns = async (sequelize) => {
  await sequelize.query(`
    ALTER TABLE public.prestamos
    ADD COLUMN IF NOT EXISTS abono_parcial_acumulado DECIMAL(15,2) NOT NULL DEFAULT 0;
  `);
};

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const resolveAbonoParcialAcumulado = (cuotas = []) => {
  if (!Array.isArray(cuotas) || cuotas.length === 0) return 0;

  const cuotaPendiente = cuotas.find((cuota) => {
    const total = round2(cuota.monto_total);
    const pagado = round2(cuota.monto_pagado);
    return total > pagado;
  });

  if (!cuotaPendiente) return 0;
  return round2(cuotaPendiente.monto_pagado);
};

module.exports = {
  ensurePrestamoAbonoParcialColumns,
  resolveAbonoParcialAcumulado
};
