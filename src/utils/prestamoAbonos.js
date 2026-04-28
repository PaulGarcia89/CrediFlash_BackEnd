const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const ensurePrestamoAbonoParcialColumns = async (sequelize) => {
  await sequelize.query(`
    ALTER TABLE public.prestamos
    ADD COLUMN IF NOT EXISTS abono_parcial_acumulado DECIMAL(15,2) NOT NULL DEFAULT 0;
  `);
};

const summarizeLoanQuotas = (cuotas = []) => {
  const list = Array.isArray(cuotas) ? cuotas : [];

  return list.reduce((acc, cuota) => {
    const total = round2(cuota?.monto_total);
    const pagado = round2(cuota?.monto_pagado);
    const saldo = Math.max(round2(total - pagado), 0);
    const estado = String(cuota?.estado || '').trim().toUpperCase();
    const completada = total > 0
      ? pagado >= total
      : estado === 'PAGADO';

    if (completada) {
      acc.pagosHechos += 1;
    } else {
      acc.cuotasRestantes += 1;
      acc.saldoPendiente += saldo;
      if (acc.abonoParcialAcumulado === 0 && pagado > 0) {
        acc.abonoParcialAcumulado = pagado;
      }
    }

    return acc;
  }, {
    pagosHechos: 0,
    cuotasRestantes: 0,
    saldoPendiente: 0,
    abonoParcialAcumulado: 0
  });
};

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

const resolveLoanPaymentCounters = (prestamo = {}) => {
  const cuotas = Array.isArray(prestamo?.cuotas) ? prestamo.cuotas : [];
  if (cuotas.length > 0) {
    const resumen = summarizeLoanQuotas(cuotas);
    return {
      pagosHechos: resumen.pagosHechos,
      cuotasRestantes: resumen.cuotasRestantes,
      saldoPendiente: round2(resumen.saldoPendiente),
      abonoParcialAcumulado: round2(resumen.abonoParcialAcumulado)
    };
  }

  const numSemanas = Number(prestamo?.num_semanas);
  const pagosHechos = Number(prestamo?.pagos_hechos);
  const pagosPendientes = Number(prestamo?.pagos_pendientes);
  const pendiente = Number(prestamo?.pendiente);

  const pagosHechosNormalizado = Number.isFinite(pagosHechos) && pagosHechos >= 0
    ? Math.max(Math.floor(pagosHechos), 0)
    : 0;
  const cuotasRestantesNormalizadas = Number.isFinite(pagosPendientes) && pagosPendientes >= 0
    ? Math.max(Math.floor(pagosPendientes), 0)
    : Math.max((Number.isFinite(numSemanas) ? Math.floor(numSemanas) : 0) - pagosHechosNormalizado, 0);

  return {
    pagosHechos: pagosHechosNormalizado,
    cuotasRestantes: cuotasRestantesNormalizadas,
    saldoPendiente: Number.isFinite(pendiente) ? round2(Math.max(pendiente, 0)) : 0,
    abonoParcialAcumulado: round2(prestamo?.abono_parcial_acumulado || 0)
  };
};

module.exports = {
  ensurePrestamoAbonoParcialColumns,
  resolveAbonoParcialAcumulado,
  resolveLoanPaymentCounters,
  summarizeLoanQuotas
};
