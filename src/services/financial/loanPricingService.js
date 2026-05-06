const { buildInstallmentDates, normalizeToNoon, round2 } = require('./scheduleService');

const normalizeModalidad = (modalidad = 'SEMANAL') => String(modalidad || 'SEMANAL').trim().toUpperCase();

const resolveNumeroCuotas = ({ numeroCuotas, plazoSemanas, modalidad } = {}) => {
  const explicit = Number(numeroCuotas);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }

  const legacy = Number(plazoSemanas);
  if (Number.isFinite(legacy) && legacy > 0) {
    return Math.floor(legacy);
  }

  if (normalizeModalidad(modalidad) === 'MENSUAL') {
    return 1;
  }

  return 0;
};

const calculateFlatLoanPricing = ({
  montoOriginal,
  interesPorcentaje,
  modalidad = 'SEMANAL',
  numeroCuotas,
  plazoSemanas,
  fechaInicio = null,
  fechaAprobacion = null,
  fechaPrimerPago = null,
  fechaPrimerVencimiento = null
} = {}) => {
  const monto = round2(montoOriginal);
  const interes = Number(interesPorcentaje) || 0;
  const modalidadNormalizada = normalizeModalidad(modalidad);
  const cuotas = resolveNumeroCuotas({ numeroCuotas, plazoSemanas, modalidad: modalidadNormalizada });

  const interesTotal = round2(monto * (interes / 100));
  const totalPagar = round2(monto + interesTotal);

  const capitalBase = cuotas > 0 ? round2(monto / cuotas) : monto;
  const interesBase = cuotas > 0 ? round2(interesTotal / cuotas) : interesTotal;
  const valorBase = cuotas > 0 ? round2(totalPagar / cuotas) : totalPagar;

  const scheduleDates = buildInstallmentDates({
    modalidad: modalidadNormalizada,
    numeroCuotas: cuotas,
    fechaInicio,
    fechaAprobacion,
    fechaPrimerPago,
    fechaPrimerVencimiento
  });

  const cronograma = [];
  let acumuladoCapital = 0;
  let acumuladoInteres = 0;
  let acumuladoTotal = 0;

  for (let index = 1; index <= cuotas; index += 1) {
    const esUltima = index === cuotas;
    const capitalProgramado = esUltima
      ? round2(monto - acumuladoCapital)
      : capitalBase;
    const interesProgramado = esUltima
      ? round2(interesTotal - acumuladoInteres)
      : interesBase;
    const totalProgramado = esUltima
      ? round2(totalPagar - acumuladoTotal)
      : valorBase;

    acumuladoCapital = round2(acumuladoCapital + capitalProgramado);
    acumuladoInteres = round2(acumuladoInteres + interesProgramado);
    acumuladoTotal = round2(acumuladoTotal + totalProgramado);

    cronograma.push({
      numero_cuota: index,
      fecha_vencimiento: scheduleDates[index - 1] || normalizeToNoon(fechaInicio) || new Date(),
      capital_programado: capitalProgramado,
      interes_programado: interesProgramado,
      total_programado: totalProgramado,
      estado: 'PENDIENTE',
      capital_pagado: 0,
      interes_pagado: 0,
      mora_pagada: 0,
      saldo_restante: totalProgramado,
      monto_capital: capitalProgramado,
      monto_interes: interesProgramado,
      monto_total: totalProgramado,
      monto_pagado: 0,
      observaciones: `Cuota ${index} de ${cuotas}`
    });
  }

  const fechaFin = cronograma.length > 0
    ? cronograma[cronograma.length - 1].fecha_vencimiento
    : normalizeToNoon(fechaInicio) || null;

  return {
    monto_original: monto,
    interes_porcentaje: Number(interes.toFixed(4)),
    interes_total: interesTotal,
    total_pagar: totalPagar,
    modalidad: modalidadNormalizada,
    numero_cuotas: cuotas,
    valor_cuota: valorBase,
    capital_por_cuota: cuotas > 0 ? capitalBase : monto,
    interes_por_cuota: cuotas > 0 ? interesBase : interesTotal,
    fecha_inicio: normalizeToNoon(fechaInicio) || null,
    fecha_fin: fechaFin,
    cronograma
  };
};

module.exports = {
  calculateFlatLoanPricing,
  normalizeModalidad,
  resolveNumeroCuotas
};
