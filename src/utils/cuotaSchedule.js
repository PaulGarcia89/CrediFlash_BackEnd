const FRIDAY_INDEX = 5;

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

const formatDateOnly = (value) => {
  const date = normalizeToNoon(value);
  if (!date) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getNextFridayStrict = (referenceDate = new Date()) => {
  const base = normalizeToNoon(referenceDate) || normalizeToNoon(new Date());
  const dayOfWeek = base.getDay();
  let daysUntilFriday = (FRIDAY_INDEX - dayOfWeek + 7) % 7;

  if (daysUntilFriday === 0) {
    daysUntilFriday = 7;
  }

  const nextFriday = new Date(base);
  nextFriday.setDate(nextFriday.getDate() + daysUntilFriday);
  nextFriday.setHours(12, 0, 0, 0);
  return nextFriday;
};

const resolveWeeklyFirstDueDate = ({
  fechaInicio = null,
  fechaAprobacion = null,
  fechaPrimerPago = null,
  fechaPrimerVencimiento = null
} = {}) => {
  const baseDate = normalizeToNoon(fechaInicio) || normalizeToNoon(fechaAprobacion) || new Date();
  const nextFriday = getNextFridayStrict(baseDate);
  const explicitCandidate =
    normalizeToNoon(fechaPrimerVencimiento) || normalizeToNoon(fechaPrimerPago);

  if (!explicitCandidate) {
    return nextFriday;
  }

  if (explicitCandidate.getDay() !== FRIDAY_INDEX) {
    return nextFriday;
  }

  if (explicitCandidate.getTime() < nextFriday.getTime()) {
    return nextFriday;
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
  getNextFridayStrict,
  normalizeToNoon,
  parseFlexibleDate,
  resolveWeeklyFirstDueDate
};
