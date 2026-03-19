const express = require('express');
const router = express.Router();
const { authenticateToken, requirePermission } = require('../middleware/auth');

const WEEKLY_FACTOR = 12 / 52;

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const round = (value, decimals = 2) => Number(toNumber(value, 0).toFixed(decimals));

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'si', 'sí'].includes(normalized);
  }
  return Boolean(value);
};

const getAliasValue = (body, aliases = [], fallback = null) => {
  for (const key of aliases) {
    if (body[key] !== undefined && body[key] !== null && String(body[key]).trim() !== '') {
      return body[key];
    }
  }
  return fallback;
};

const getNonNegativeAliasNumber = (body, aliases = [], label = 'valor', fallback = 0) => {
  const raw = getAliasValue(body, aliases, null);
  if (raw === null) return fallback;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${label} debe ser un número mayor o igual a 0`);
  }
  return numeric;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toWeekly = (monthlyValue) => monthlyValue * WEEKLY_FACTOR;

const calculateCuotaSemanal = ({ monto, tasaSemanal, semanas }) => {
  const n = Math.max(Math.floor(toNumber(semanas, 0)), 1);
  const principal = Math.max(toNumber(monto, 0), 0);
  const rate = Math.max(toNumber(tasaSemanal, 0), 0);

  if (principal <= 0) return 0;

  const interesTotal = principal * rate * n;
  return round((principal + interesTotal) / n);
};

const inferRateByPd = (pd) => {
  if (pd < 0.15) return 0.006;
  if (pd < 0.30) return 0.009;
  return 0.012;
};

const invertMontoFromCuota = ({ cuotaObjetivo, tasaSemanal, semanas }) => {
  const cuota = Math.max(toNumber(cuotaObjetivo, 0), 0);
  const n = Math.max(Math.floor(toNumber(semanas, 0)), 1);
  const r = Math.max(toNumber(tasaSemanal, 0), 0);

  if (cuota <= 0) return 0;

  return round((cuota * n) / (1 + r * n));
};

const getRatingFromScore = (score) => {
  if (score >= 750) return 'A';
  if (score >= 680) return 'B';
  if (score >= 620) return 'C';
  return 'D';
};

const evaluateWeeklyScoring = (body = {}) => {
  const edad = toNumber(body.edad, NaN);
  const sexo = String(body.sexo || '').toUpperCase();
  const tiempoSemanas = toNumber(body.tiempoSemanas, NaN);
  const objetivoPrestamo = String(body.objetivoPrestamo || '').toLowerCase();
  const esReferido = parseBoolean(body.esReferido);
  const tieneGarantia = parseBoolean(body.tieneGarantia);
  const montoSolicitado = toNumber(body.montoSolicitado, NaN);
  const ingresosMensuales = toNumber(body.ingresosMensuales, NaN);
  const otrasDeudasMensuales = toNumber(body.otrasDeudasMensuales, 0);
  const documentosCompletos = parseBoolean(body.documentosCompletos);
  const statusLegal = String(getAliasValue(body, ['statusLegal', 'status_legal'], 'NO_ESPECIFICADO')).toUpperCase();
  const tiempoTrabajo = getNonNegativeAliasNumber(body, ['tiempoTrabajo', 'tiempo_trabajo', 'antiguedadLaboralMeses'], 'tiempoTrabajo', 0);
  const casaPropiaAlquiler = String(getAliasValue(body, ['casaPropiaAlquiler', 'casa_propia_alquiler'], 'OTRO')).toUpperCase();
  const montoAuto = toNumber(getAliasValue(body, ['montoAuto', 'monto_auto'], 0), 0);
  const pagoAutoMensual = toNumber(getAliasValue(body, ['pagoAutoMensual', 'pagoAuto', 'pago_auto'], 0), 0);
  const gastosMensualesEstimados = toNumber(getAliasValue(body, ['gastosMensualesEstimados', 'estimados_gastos_mensuales'], 0), 0);
  const deudasActualesPagosMinimosMensuales = toNumber(getAliasValue(body, ['deudasActualesPagosMinimosMensuales', 'deudasActualesPagosMinimos', 'deudas_actuales_pagos_minimos'], 0), 0);
  const valorGarantia = toNumber(getAliasValue(body, ['valorGarantia', 'valor_garantia'], 0), 0);

  const errores = [];
  if (!Number.isFinite(edad) || edad < 18 || edad > 80) errores.push('edad debe estar entre 18 y 80');
  if (!['M', 'F'].includes(sexo)) errores.push('sexo debe ser M o F');
  if (!Number.isFinite(tiempoSemanas) || tiempoSemanas < 4 || tiempoSemanas > 208) errores.push('tiempoSemanas debe estar entre 4 y 208');
  if (!Number.isFinite(montoSolicitado) || montoSolicitado <= 0) errores.push('montoSolicitado debe ser mayor a 0');
  if (!Number.isFinite(ingresosMensuales) || ingresosMensuales <= 0) errores.push('ingresosMensuales debe ser mayor a 0');
  if (tiempoTrabajo < 0) errores.push('tiempoTrabajo debe ser un número mayor o igual a 0');
  if (errores.length > 0) {
    const error = new Error('Errores de validación');
    error.details = errores;
    throw error;
  }

  const inputNormalizado = {
    ingresosSemanales: round(toWeekly(ingresosMensuales)),
    otrasDeudasSemanales: round(toWeekly(otrasDeudasMensuales)),
    pagoAutoSemanal: round(toWeekly(pagoAutoMensual)),
    gastosSemanalesEstimados: round(toWeekly(gastosMensualesEstimados)),
    deudasActualesPagosMinimosSemanales: round(toWeekly(deudasActualesPagosMinimosMensuales))
  };

  const ingresoNetoSemanal = round(
    inputNormalizado.ingresosSemanales
    - inputNormalizado.otrasDeudasSemanales
    - inputNormalizado.pagoAutoSemanal
    - inputNormalizado.gastosSemanalesEstimados
    - inputNormalizado.deudasActualesPagosMinimosSemanales
  );

  const cargaFinancieraSemanal = inputNormalizado.ingresosSemanales > 0
    ? (
      (inputNormalizado.otrasDeudasSemanales
      + inputNormalizado.pagoAutoSemanal
      + inputNormalizado.deudasActualesPagosMinimosSemanales)
      / inputNormalizado.ingresosSemanales
    )
    : 0;

  const ratioGastosIngresoSemanal = inputNormalizado.ingresosSemanales > 0
    ? (
      (inputNormalizado.gastosSemanalesEstimados)
      / inputNormalizado.ingresosSemanales
    )
    : 0;

  const loanToIncomeSemanal = (inputNormalizado.ingresosSemanales > 0 && tiempoSemanas > 0)
    ? (montoSolicitado / (inputNormalizado.ingresosSemanales * tiempoSemanas))
    : 0;

  const collateralCoverage = montoSolicitado > 0
    ? Math.min(valorGarantia / montoSolicitado, 3)
    : 0;

  const estabilidadLaboral = Math.min(tiempoTrabajo / 24, 1);
  const formalidad = statusLegal === 'FORMAL' ? 1 : 0;
  const documentacion = documentosCompletos ? 1 : 0;
  const referido = esReferido ? 1 : 0;
  const garantia = tieneGarantia ? 1 : 0;

  const viviendaScore = casaPropiaAlquiler === 'PROPIA'
    ? 1.0
    : casaPropiaAlquiler === 'ALQUILER'
      ? 0.6
      : casaPropiaAlquiler === 'FAMILIAR'
        ? 0.4
        : 0.3;

  const z = -1.10
    + 1.90 * cargaFinancieraSemanal
    + 1.20 * loanToIncomeSemanal
    - 1.30 * estabilidadLaboral
    - 0.80 * formalidad
    - 0.60 * documentacion
    - 0.70 * collateralCoverage
    - 0.30 * referido
    - 0.20 * garantia
    - 0.15 * viviendaScore;

  const pd = 1 / (1 + Math.exp(-z));
  const odds = pd / (1 - pd);
  const scoreRaw = 600 - 50 * Math.log(odds);
  const score = Math.round(clamp(scoreRaw, 300, 850));
  const rating = getRatingFromScore(score);

  const factorPrudencia = pd < 0.15 ? 0.7 : pd < 0.30 ? 0.6 : 0.5;
  const capacidadPagoSemanal = round(Math.max(0, ingresoNetoSemanal * factorPrudencia));

  const tasaInteresSemanal = inferRateByPd(pd);
  let plazoOfertaSemanas = Math.max(Math.floor(tiempoSemanas), 1);

  let cuotaSemanal = calculateCuotaSemanal({
    monto: montoSolicitado,
    tasaSemanal: tasaInteresSemanal,
    semanas: plazoOfertaSemanas
  });

  while (cuotaSemanal > capacidadPagoSemanal && plazoOfertaSemanas < 156) {
    plazoOfertaSemanas += 1;
    cuotaSemanal = calculateCuotaSemanal({
      monto: montoSolicitado,
      tasaSemanal: tasaInteresSemanal,
      semanas: plazoOfertaSemanas
    });
  }

  const paymentCapacityRatio = cuotaSemanal > 0 ? capacidadPagoSemanal / cuotaSemanal : 0;

  const valorRealizableGarantia = round(valorGarantia * 0.7);
  const recoveryRate = montoSolicitado > 0 ? Math.min(valorRealizableGarantia / montoSolicitado, 1) : 0;
  const lgd = round(1 - recoveryRate, 4);
  const expectedLoss = round(pd * lgd * montoSolicitado);

  const razones = [];
  let estado = 'REVISION';

  const rechazar = (
    ingresoNetoSemanal <= 0
    || !documentosCompletos
    || paymentCapacityRatio < 1
    || pd >= 0.4
    || cargaFinancieraSemanal > 0.65
  );

  if (rechazar) {
    estado = 'RECHAZADO';
    if (ingresoNetoSemanal <= 0) razones.push('Ingreso neto semanal no cubre obligaciones básicas');
    if (!documentosCompletos) razones.push('Documentación incompleta');
    if (paymentCapacityRatio < 1) razones.push('La cuota semanal supera la capacidad de pago');
    if (pd >= 0.4) razones.push('Probabilidad de incumplimiento elevada');
    if (cargaFinancieraSemanal > 0.65) razones.push('Carga financiera semanal excesiva');
  } else {
    const aprobar = (
      pd < 0.25
      && paymentCapacityRatio >= 1.2
      && score >= 680
      && ingresoNetoSemanal > 0
      && documentosCompletos
    );

    if (aprobar) {
      estado = 'APROBADO';
      razones.push('Capacidad semanal sólida para cubrir la cuota');
      razones.push('Riesgo controlado con PD por debajo de 25%');
      razones.push('Score en rango aprobable');
    } else {
      estado = 'REVISION';
      if (pd >= 0.25 && pd < 0.4) razones.push('PD en rango de revisión manual');
      if (paymentCapacityRatio >= 1 && paymentCapacityRatio < 1.2) razones.push('Cobertura de pago semanal ajustada');
      if (statusLegal !== 'FORMAL' && tieneGarantia) razones.push('Estatus legal no formal, mitigado con garantía');
      if (score >= 620 && score < 680) razones.push('Score intermedio requiere validación adicional');
      if (razones.length === 0) razones.push('Caso intermedio, requiere validación manual');
    }
  }

  const montoMaximoSugerido = invertMontoFromCuota({
    cuotaObjetivo: capacidadPagoSemanal,
    tasaSemanal: tasaInteresSemanal,
    semanas: plazoOfertaSemanas
  });

  const montoAprobado = estado === 'APROBADO'
    ? round(Math.min(montoSolicitado, montoMaximoSugerido))
    : estado === 'REVISION'
      ? round(Math.min(montoSolicitado * 0.9, montoMaximoSugerido))
      : round(Math.min(montoSolicitado * 0.8, montoMaximoSugerido));

  const cuotaOferta = calculateCuotaSemanal({
    monto: montoAprobado,
    tasaSemanal: tasaInteresSemanal,
    semanas: plazoOfertaSemanas
  });

  const totalPagarOferta = round(montoAprobado + montoAprobado * tasaInteresSemanal * plazoOfertaSemanas);

  const features = {
    ingresoNetoSemanal,
    cargaFinancieraSemanal: round(cargaFinancieraSemanal, 4),
    estabilidadLaboral: round(estabilidadLaboral, 4),
    formalidad,
    documentacion,
    referido,
    garantia,
    viviendaScore
  };

  return {
    inputNormalizado,
    features,
    riesgo: {
      probaIncum: round(pd, 4),
      score,
      rating
    },
    capacidadPago: {
      factorPrudencia,
      capacidadPagoSemanal,
      cuotaSemanal: cuotaSemanal,
      paymentCapacityRatio: round(paymentCapacityRatio, 4)
    },
    perdidaEsperada: {
      montoCredito: round(montoSolicitado),
      expectedLoss
    },
    decision: {
      estado,
      razones
    },
    oferta: {
      montoAprobado,
      plazoSemanas: plazoOfertaSemanas,
      tasaInteresSemanal: round(tasaInteresSemanal, 4),
      cuotaSemanal: cuotaOferta,
      totalPagar: totalPagarOferta
    },
    // Compatibilidad parcial con consumo anterior del frontend
    resumen: {
      scoreFinal: score,
      decision: estado,
      aprobado: estado === 'APROBADO',
      riesgoTotal: pd < 0.25 ? 'BAJO' : pd < 0.4 ? 'MODERADO' : 'ALTO',
      montoSolicitado: round(montoSolicitado),
      capacidadPagoSemanal
    }
  };
};

const handleEvaluate = (req, res) => {
  try {
    const result = evaluateWeeklyScoring(req.body || {});
    res.locals.audit_metadata = {
      tipo_reporte: 'SCORING_CLIENTE_NUEVO_SEMANAL',
      estado: result.decision.estado,
      pd: result.riesgo.probaIncum,
      score: result.riesgo.score
    };
    return res.json({
      message: 'Evaluación semanal generada correctamente',
      timestamp: new Date().toISOString(),
      ...result
    });
  } catch (error) {
    const statusCode = error?.details ? 400 : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Error interno evaluando scoring semanal',
      errores: error?.details || undefined
    });
  }
};

router.post('/new-client', authenticateToken, requirePermission('ratings.run'), handleEvaluate);
router.post('/evaluate-weekly', authenticateToken, requirePermission('ratings.run'), handleEvaluate);

router.get('/new-client/variables', authenticateToken, requirePermission('ratings.run'), (_req, res) => {
  res.json({
    success: true,
    message: 'Variables del modelo semanal de cliente nuevo',
    variables: {
      obligatorias: ['edad', 'sexo', 'tiempoSemanas', 'montoSolicitado', 'ingresosMensuales'],
      opcionales: [
        'objetivoPrestamo',
        'esReferido',
        'tieneGarantia',
        'antiguedadLaboralMeses',
        'statusLegal',
        'tiempoTrabajo',
        'tiempo_trabajo',
        'casaPropiaAlquiler',
        'pagoAutoMensual',
        'gastosMensualesEstimados',
        'deudasActualesPagosMinimosMensuales',
        'valorGarantia'
      ]
    }
  });
});

module.exports = router;
