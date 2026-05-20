const buildLocalDate = (year, month, day) => new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);

const parseDateSafe = (value) => {
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
      return new Date(value.getTime());
    }

    if (utcMidnight) {
      return buildLocalDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
    }

    return new Date(value.getTime());
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

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatMMDDYYYY = (value) => {
  const date = parseDateSafe(value);
  if (!date) return value ? String(value) : '-';

  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());

  return `${mm}/${dd}/${yyyy}`;
};

module.exports = {
  formatMMDDYYYY,
  parseDateSafe
};
