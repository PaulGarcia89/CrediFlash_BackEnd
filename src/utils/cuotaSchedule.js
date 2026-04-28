const parseFlexibleDate = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    const cloned = new Date(value.getTime());
    return Number.isNaN(cloned.getTime()) ? null : cloned;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const localDate = new Date(`${trimmed}T12:00:00`);
      return Number.isNaN(localDate.getTime()) ? null : localDate;
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

const formatDateOnly = (value) => {
  const date = normalizeToNoon(value);
  if (!date) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getNextFridayStrict = (referenceDate = new Date()) => {
  return addDays(referenceDate, 7);
};

const getNextFridayOnOrAfter = (referenceDate = new Date()) => {
  return addDays(referenceDate, 7);
};

const getFirstWeeklyDueDate = (referenceDate = new Date()) => {
  return addDays(referenceDate, 7);
};

const resolveWeeklyFirstDueDate = ({
  fechaInicio = null,
  fechaAprobacion = null,
  fechaPrimerPago = null,
  fechaPrimerVencimiento = null
} = {}) => {
  const baseDate = normalizeToNoon(fechaInicio) || normalizeToNoon(fechaAprobacion) || new Date();
  const firstDue = getFirstWeeklyDueDate(baseDate);
  const explicitCandidate =
    normalizeToNoon(fechaPrimerVencimiento) || normalizeToNoon(fechaPrimerPago);

  if (!explicitCandidate) {
    return firstDue;
  }

  const expectedFirstDue = formatDateOnly(firstDue);
  const explicitDate = formatDateOnly(explicitCandidate);

  if (explicitDate !== expectedFirstDue) {
    return firstDue;
  }

  return explicitCandidate;
};

const buildWeeklyDueDates = ({
  numSemanas,
  fechaInicio = null,
  fechaAprobacion = null,
  fechaPrimerPago = null,
  fechaPrimerVencimiento = null
} = {}) => {
  const semanas = parseInt(numSemanas, 10) || 0;
  if (semanas <= 0) return [];

  const firstDue = resolveWeeklyFirstDueDate({
    fechaInicio,
    fechaAprobacion,
    fechaPrimerPago,
    fechaPrimerVencimiento
  });

  return Array.from({ length: semanas }, (_unused, index) => {
    const dueDate = new Date(firstDue);
    dueDate.setDate(dueDate.getDate() + (index * 7));
    dueDate.setHours(12, 0, 0, 0);
    return dueDate;
  });
};

module.exports = {
  buildWeeklyDueDates,
  formatDateOnly,
  getFirstWeeklyDueDate,
  getNextFridayStrict,
  getNextFridayOnOrAfter,
  normalizeToNoon,
  addDays,
  parseFlexibleDate,
  resolveWeeklyFirstDueDate
};
