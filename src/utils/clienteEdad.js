const MIN_AGE_FOR_CREDIT = 21;

const buildLocalDate = (year, month, day) => new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);

const normalizeDateOnly = (value) => {
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

    if (localMidnight) return new Date(value.getTime());
    if (utcMidnight) return buildLocalDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());

    const cloned = new Date(value.getTime());
    return Number.isNaN(cloned.getTime()) ? null : cloned;
  }

  const text = String(value).trim();
  if (!text) return null;

  const isoDateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const [, yyyy, mm, dd] = isoDateOnly;
    return buildLocalDate(yyyy, mm, dd);
  }

  const isoMidnightZ = text.match(/^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z$/);
  if (isoMidnightZ) {
    const [, yyyy, mm, dd] = isoMidnightZ;
    return buildLocalDate(yyyy, mm, dd);
  }

  const mmddyyyy = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mmddyyyy) {
    const [, mm, dd, yyyy] = mmddyyyy;
    return buildLocalDate(yyyy, mm, dd);
  }

  const mmddyyyyDash = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (mmddyyyyDash) {
    const [, mm, dd, yyyy] = mmddyyyyDash;
    return buildLocalDate(yyyy, mm, dd);
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateOnly = (value) => {
  const date = normalizeDateOnly(value);
  if (!date) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const calculateAgeYears = (fechaNacimiento, referenceDate = new Date()) => {
  const birthDate = normalizeDateOnly(fechaNacimiento);
  const today = normalizeDateOnly(referenceDate);

  if (!birthDate || !today) return null;

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  const dayDiff = today.getDate() - birthDate.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age;
};

const assertClienteEdadMinima = (cliente = {}, options = {}) => {
  const minAge = Number(options.minAge || MIN_AGE_FOR_CREDIT);
  const requireFechaNacimiento = options.requireFechaNacimiento !== false;
  const fechaNacimiento = cliente?.fecha_nacimiento ?? cliente?.fechaNacimiento ?? options.fechaNacimiento ?? null;
  const edad = calculateAgeYears(fechaNacimiento, options.referenceDate || new Date());

  if (!fechaNacimiento) {
    if (requireFechaNacimiento) {
      throw new Error('Debe registrar fecha_nacimiento antes de solicitar crédito');
    }
    return { edad: null, fecha_nacimiento: null, eligible: true };
  }

  if (edad === null || Number.isNaN(edad)) {
    throw new Error('fecha_nacimiento inválida');
  }

  if (edad < minAge) {
    throw new Error(`No se pueden otorgar créditos a menores de ${minAge} años`);
  }

  return {
    edad,
    fecha_nacimiento: normalizeDateOnly(fechaNacimiento),
    eligible: true
  };
};

const ensureClienteFechaNacimientoColumn = async (sequelize) => {
  await sequelize.query(`
    ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS fecha_nacimiento date NULL
  `);
};

module.exports = {
  MIN_AGE_FOR_CREDIT,
  calculateAgeYears,
  assertClienteEdadMinima,
  ensureClienteFechaNacimientoColumn,
  normalizeDateOnly,
  formatDateOnly
};
