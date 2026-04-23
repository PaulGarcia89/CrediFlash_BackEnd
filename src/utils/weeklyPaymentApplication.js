const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const cloneDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toPlainQuota = (quota = {}) => ({
  ...quota,
  monto_total: round2(quota.monto_total),
  monto_pagado: round2(quota.monto_pagado),
  monto_fee_acumulado: round2(quota.monto_fee_acumulado),
  monto_penalizacion_acumulada: round2(quota.monto_penalizacion_acumulada),
  fecha_pago: cloneDate(quota.fecha_pago),
  observaciones: quota.observaciones || null
});

const applyWeeklyPaymentToQuotas = ({
  cuotas = [],
  montoPagoRecibido,
  montoPenalizacion = 0,
  montoFee = 0,
  motivoFee = null,
  now = new Date()
} = {}) => {
  const pago = round2(montoPagoRecibido);
  const penalizacion = round2(montoPenalizacion);
  const fee = round2(montoFee);
  const cargos = round2(penalizacion + fee);
  const timestamp = cloneDate(now) || new Date();

  if (!Array.isArray(cuotas) || cuotas.length === 0) {
    throw new Error('No hay cuotas para aplicar el pago');
  }

  if (pago <= 0) {
    throw new Error('El monto del pago debe ser mayor a 0');
  }

  if (pago < cargos) {
    throw new Error('El monto ingresado no cubre los cargos adicionales');
  }

  const cuotasActualizadas = cuotas.map(toPlainQuota);
  const cuotaBase = cuotasActualizadas[0];
  const cuotasAjustadas = [];
  const notaBasePago = `Aplicación de pago semanal: recibido=${pago.toFixed(2)}, objetivo=${round2(cuotaBase.monto_total).toFixed(2)}, penalización=${penalizacion.toFixed(2)}, fee=${fee.toFixed(2)}${motivoFee ? `, motivo_fee=${motivoFee}` : ''}, fecha=${timestamp.toISOString()}`;

  if (cargos > 0) {
    cuotaBase.monto_total = round2(cuotaBase.monto_total + cargos);
    cuotaBase.monto_penalizacion_acumulada = round2(cuotaBase.monto_penalizacion_acumulada + penalizacion);
    cuotaBase.monto_fee_acumulado = round2(cuotaBase.monto_fee_acumulado + fee);
    cuotaBase.motivo_fee = motivoFee
      ? (cuotaBase.motivo_fee ? `${cuotaBase.motivo_fee}\n${motivoFee}` : motivoFee)
      : cuotaBase.motivo_fee;
  }

  const saldoActual = round2(cuotaBase.monto_total - cuotaBase.monto_pagado);
  const aplicadoActual = round2(Math.min(pago, saldoActual));
  cuotaBase.monto_pagado = round2(cuotaBase.monto_pagado + aplicadoActual);
  cuotaBase.observaciones = cuotaBase.observaciones
    ? `${cuotaBase.observaciones}\n${notaBasePago}`
    : notaBasePago;

  if (cuotaBase.monto_pagado >= cuotaBase.monto_total) {
    cuotaBase.monto_pagado = round2(cuotaBase.monto_total);
    cuotaBase.estado = 'PAGADO';
    cuotaBase.fecha_pago = timestamp;
  } else {
    cuotaBase.estado = 'PENDIENTE';
    cuotaBase.fecha_pago = cuotaBase.fecha_pago || null;
  }

  const excedenteOriginal = round2(pago - aplicadoActual);
  let excedente = excedenteOriginal;

  if (excedente > 0) {
    for (let index = 1; index < cuotasActualizadas.length && excedente > 0; index += 1) {
      const cuotaDestino = cuotasActualizadas[index];
      const saldoDestino = round2(cuotaDestino.monto_total - cuotaDestino.monto_pagado);
      if (saldoDestino <= 0) continue;

      const aplicadoDestino = round2(Math.min(excedente, saldoDestino));
      cuotaDestino.monto_pagado = round2(cuotaDestino.monto_pagado + aplicadoDestino);
      cuotaDestino.observaciones = cuotaDestino.observaciones
        ? `${cuotaDestino.observaciones}\nAjuste ADELANTADO desde cuota ${cuotaBase.id}: -${aplicadoDestino.toFixed(2)}`
        : `Ajuste ADELANTADO desde cuota ${cuotaBase.id}: -${aplicadoDestino.toFixed(2)}`;

      if (cuotaDestino.monto_pagado >= cuotaDestino.monto_total) {
        cuotaDestino.monto_pagado = round2(cuotaDestino.monto_total);
        cuotaDestino.estado = 'PAGADO';
        cuotaDestino.fecha_pago = timestamp;
      } else {
        cuotaDestino.estado = 'PENDIENTE';
      }

      cuotasAjustadas.push({
        cuota_id: cuotaDestino.id,
        ajuste: -aplicadoDestino,
        nuevo_monto: round2(cuotaDestino.monto_total)
      });

      excedente = round2(excedente - aplicadoDestino);
    }
  }

  const pagadoTotal = round2(cuotasActualizadas.reduce((sum, cuota) => {
    return sum + Math.min(round2(cuota.monto_pagado), round2(cuota.monto_total));
  }, 0));
  const pendienteTotal = round2(cuotasActualizadas.reduce((sum, cuota) => {
    return sum + Math.max(round2(cuota.monto_total - cuota.monto_pagado), 0);
  }, 0));
  const cuotasPendientes = cuotasActualizadas.filter((cuota) => round2(cuota.monto_total - cuota.monto_pagado) > 0).length;
  const pagosHechos = cuotasActualizadas.length - cuotasPendientes;
  const prestamoPagado = cuotasPendientes === 0 && pendienteTotal <= 0;
  const tipoAplicacion = excedenteOriginal > 0
    ? 'ADELANTADO'
    : (aplicadoActual >= saldoActual ? 'COMPLETO' : 'PARCIAL');

  return {
    cuotasActualizadas,
    cuotasAjustadas,
    tipoAplicacion,
    montoAplicadoActual: aplicadoActual,
    saldoPendienteTotal: pendienteTotal,
    pagadoTotal,
    cuotasRestantes: cuotasPendientes,
    pagosHechos,
    prestamoPagado,
    faltante: tipoAplicacion === 'PARCIAL' ? round2(saldoActual - aplicadoActual) : 0,
    excedente: excedenteOriginal,
    excedente_remanente: excedente,
    notaBasePago
  };
};

module.exports = {
  applyWeeklyPaymentToQuotas,
  round2
};
