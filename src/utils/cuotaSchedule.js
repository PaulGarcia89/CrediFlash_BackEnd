const {
  addDays,
  addInterval,
  addMonths,
  buildInstallmentDates,
  formatDateOnly,
  getIntervalSpec,
  normalizeToNoon,
  parseFlexibleDate,
  resolveFirstDueDate,
  round2
} = require('../services/financial/scheduleService');

const buildWeeklyDueDates = ({
  numSemanas,
  fechaInicio = null,
  fechaAprobacion = null,
  fechaPrimerPago = null,
  fechaPrimerVencimiento = null
} = {}) => {
  const semanas = parseInt(numSemanas, 10) || 0;
  if (semanas <= 0) return [];

  return buildInstallmentDates({
    modalidad: 'SEMANAL',
    numeroCuotas: semanas,
    fechaInicio,
    fechaAprobacion,
    fechaPrimerPago,
    fechaPrimerVencimiento
  });
};

const getFirstWeeklyDueDate = (referenceDate = new Date()) => addDays(referenceDate, 7);

const getNextFridayStrict = (referenceDate = new Date()) => addDays(referenceDate, 7);

const getNextFridayOnOrAfter = (referenceDate = new Date()) => addDays(referenceDate, 7);

module.exports = {
  addDays,
  addInterval,
  addMonths,
  buildInstallmentDates,
  buildWeeklyDueDates,
  formatDateOnly,
  getFirstWeeklyDueDate,
  getIntervalSpec,
  getNextFridayStrict,
  getNextFridayOnOrAfter,
  normalizeToNoon,
  parseFlexibleDate,
  resolveFirstWeeklyDueDate: resolveFirstDueDate,
  resolveWeeklyFirstDueDate: resolveFirstDueDate,
  round2
};
