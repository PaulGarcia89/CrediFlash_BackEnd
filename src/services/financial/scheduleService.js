const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const buildLocalDate = (year, month, day) => new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);

const parseFlexibleDate = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;

    const localMidnight =
      value.getHours() === 0 &&
      value.getMinutes() === 0 &&
      value.getSeconds() === 0 &&
      value.getMilliseconds() === 0;
    const utcMidnight =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;

    if (localMidnight) {
      const cloned = new Date(value.getTime());
      cloned.setHours(12, 0, 0, 0);
      return cloned;
    }

    if (utcMidnight) {
      return buildLocalDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
    }

    const cloned = new Date(value.getTime());
    return Number.isNaN(cloned.getTime()) ? null : cloned;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) {
      const [, yyyy, mm, dd] = isoDateOnly;
      return buildLocalDate(yyyy, mm, dd);
    }

    const isoMidnightZ = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z$/);
    if (isoMidnightZ) {
      const [, yyyy, mm, dd] = isoMidnightZ;
      return buildLocalDate(yyyy, mm, dd);
    }

    const mmddyyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (mmddyyyy) {
      const [, mm, dd, yyyy] = mmddyyyy;
      return buildLocalDate(yyyy, mm, dd);
    }

    const mmddyyyyDash = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (mmddyyyyDash) {
      const [, mm, dd, yyyy] = mmddyyyyDash;
      return buildLocalDate(yyyy, mm, dd);
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeToNoon = (value) => {
  const date = parseFlexibleDate(value);
  if (!date) return null;

  date.setHours(12, 0, 0, 0);
  return date;
};

const addDays = (value, days = 0) => {
  const date = normalizeToNoon(value);
  if (!date) return null;

  const result = new Date(date);
  result.setDate(result.getDate() + Number(days || 0));
  result.setHours(12, 0, 0, 0);
  return result;
};

const addMonths = (value, months = 0) => {
  const date = normalizeToNoon(value);
  if (!date) return null;

  const result = new Date(date);
  result.setMonth(result.getMonth() + Number(months || 0));
  result.setHours(12, 0, 0, 0);
  return result;
};

const formatDateOnly = (value) => {
  const date = normalizeToNoon(value);
  if (!date) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getIntervalSpec = (modalidad = 'SEMANAL') => {
  const normalized = String(modalidad || 'SEMANAL').trim().toUpperCase();
  if (normalized === 'QUINCENAL') return { type: 'days', value: 14 };
  if (normalized === 'MENSUAL') return { type: 'days', value: 30 };
  return { type: 'days', value: 7 };
};

const addInterval = (value, modalidad, multiplier = 1) => {
  const spec = getIntervalSpec(modalidad);
  const units = Number(multiplier || 0);
  if (!Number.isFinite(units) || units <= 0) return normalizeToNoon(value);

  if (spec.type === 'months') {
    return addMonths(value, spec.value * units);
  }
  return addDays(value, spec.value * units);
};

const resolveFirstDueDate = ({
  modalidad = 'SEMANAL',
  fechaInicio = null,
  fechaAprobacion = null,
  fechaPrimerPago = null,
  fechaPrimerVencimiento = null
} = {}) => {
  const baseDate = normalizeToNoon(fechaInicio) || normalizeToNoon(fechaAprobacion) || new Date();
  const expectedFirstDue = addInterval(baseDate, modalidad, 1);
  const explicitCandidate = normalizeToNoon(fechaPrimerVencimiento) || normalizeToNoon(fechaPrimerPago);

  if (explicitCandidate && formatDateOnly(explicitCandidate) === formatDateOnly(expectedFirstDue)) {
    return explicitCandidate;
  }

  return expectedFirstDue;
};

const buildInstallmentDates = ({
  modalidad = 'SEMANAL',
  numeroCuotas = 0,
  fechaInicio = null,
  fechaAprobacion = null,
  fechaPrimerPago = null,
  fechaPrimerVencimiento = null
} = {}) => {
  const cuotas = parseInt(numeroCuotas, 10) || 0;
  if (cuotas <= 0) return [];

  const firstDue = resolveFirstDueDate({
    modalidad,
    fechaInicio,
    fechaAprobacion,
    fechaPrimerPago,
    fechaPrimerVencimiento
  });

  return Array.from({ length: cuotas }, (_unused, index) => {
    const dueDate = addInterval(firstDue, modalidad, index);
    return dueDate || normalizeToNoon(firstDue);
  });
};

module.exports = {
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
};
