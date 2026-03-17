const formatMMDDYYYY = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = String(date.getFullYear());

  return `${mm}/${dd}/${yyyy}`;
};

module.exports = {
  formatMMDDYYYY
};
