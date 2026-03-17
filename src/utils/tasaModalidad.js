const MODALIDADES_PERMITIDAS = ['SEMANAL', 'QUINCENAL', 'MENSUAL'];

const normalizarModalidad = (modalidad) => String(modalidad || 'SEMANAL').trim().toUpperCase();

const calcularTasaEfectivaPorModalidad = ({ modalidad, tasaBase, plazoSemanas }) => {
  const modalidadNormalizada = normalizarModalidad(modalidad);

  if (!MODALIDADES_PERMITIDAS.includes(modalidadNormalizada)) {
    throw new Error('modalidad inválida. Use SEMANAL, QUINCENAL o MENSUAL');
  }

  const base = Number(tasaBase);
  const semanas = Number(plazoSemanas);

  if (!Number.isFinite(base) || base <= 0) {
    throw new Error('tasa_base debe ser mayor a 0');
  }

  if (!Number.isFinite(semanas) || semanas <= 0) {
    throw new Error('plazo_semanas debe ser mayor a 0');
  }

  let tasaEfectiva = base;

  if (modalidadNormalizada === 'QUINCENAL') {
    tasaEfectiva = base * 2;
  } else if (modalidadNormalizada === 'MENSUAL') {
    const meses = Math.max(Math.ceil(semanas / 4), 1);
    tasaEfectiva = base / meses;
  }

  if (!Number.isFinite(tasaEfectiva) || tasaEfectiva <= 0) {
    throw new Error('No se pudo calcular la tasa efectiva');
  }

  return {
    modalidad: modalidadNormalizada,
    tasa_base: Number(base.toFixed(4)),
    tasa_variable: Number(tasaEfectiva.toFixed(4))
  };
};

module.exports = {
  MODALIDADES_PERMITIDAS,
  normalizarModalidad,
  calcularTasaEfectivaPorModalidad
};
