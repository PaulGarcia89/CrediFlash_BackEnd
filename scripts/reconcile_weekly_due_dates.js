require('dotenv').config();

const { sequelize, Prestamo, Cuota } = require('../src/models');
const {
  buildWeeklyDueDates,
  formatDateOnly,
  normalizeToNoon
} = require('../src/utils/cuotaSchedule');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith('--')).map((arg) => arg.replace(/^--/, '')));
  const prestamoIdIndex = args.indexOf('--prestamo-id');

  return {
    apply: flags.has('apply'),
    verbose: flags.has('verbose'),
    force: flags.has('force'),
    prestamoId: prestamoIdIndex >= 0 ? args[prestamoIdIndex + 1] || null : null
  };
};

const toMiddayDate = (value) => {
  const date = normalizeToNoon(value);
  return date || null;
};

const datesMatch = (a, b) => formatDateOnly(a) === formatDateOnly(b);

const buildLoanSchedule = (prestamo = {}) => {
  const baseDate = prestamo.fecha_inicio || prestamo.fecha_aprobacion || null;
  const numSemanas = Number(prestamo.num_semanas) || 0;

  if (!baseDate || numSemanas <= 0) {
    return [];
  }

  return buildWeeklyDueDates({
    numSemanas,
    fechaInicio: baseDate,
    fechaAprobacion: prestamo.fecha_aprobacion || baseDate
  });
};

const main = async () => {
  const { apply, verbose, force, prestamoId } = parseArgs();

  await sequelize.authenticate();

  const where = {
    modalidad: 'SEMANAL'
  };

  if (prestamoId) {
    where.id = prestamoId;
  }

  const prestamos = await Prestamo.findAll({
    where,
    include: [{
      model: Cuota,
      as: 'cuotas'
    }],
    order: [['fecha_inicio', 'ASC']]
  });

  console.log(`Préstamos semanales revisados: ${prestamos.length}`);

  let procesados = 0;
  let fallidos = 0;
  let incidencias = 0;

  for (const prestamo of prestamos) {
    try {
      const cuotas = Array.isArray(prestamo.cuotas) ? [...prestamo.cuotas] : [];
      cuotas.sort((a, b) => {
        const fechaA = new Date(a.fecha_vencimiento || 0).getTime();
        const fechaB = new Date(b.fecha_vencimiento || 0).getTime();
        if (fechaA !== fechaB) return fechaA - fechaB;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });

      if (cuotas.length === 0) {
        if (verbose) {
          console.log(`- ${prestamo.id}: sin cuotas para revisar`);
        }
        continue;
      }

      if (!force) {
        const hasPaidCuotas = cuotas.some((cuota) => {
          const montoPagado = Number(cuota.monto_pagado || 0);
          const estado = String(cuota.estado || '').toUpperCase();
          return montoPagado > 0 || estado === 'PAGADO';
        });

        if (hasPaidCuotas) {
          if (verbose) {
            console.log(`- ${prestamo.id}: omitido porque ya tiene cuotas pagadas (usa --force para forzar)`);
          }
          continue;
        }
      }

      const expectedDates = buildLoanSchedule(prestamo);
      if (expectedDates.length === 0) {
        if (verbose) {
          console.log(`- ${prestamo.id}: sin base válida para recalcular`);
        }
        continue;
      }

      const expectedLastDate = expectedDates[expectedDates.length - 1];
      const currentDates = cuotas.map((cuota) => cuota.fecha_vencimiento);

      const cuotasConCambio = cuotas
        .map((cuota, index) => ({
          cuota,
          expectedDate: expectedDates[index] || null,
          currentDate: cuota.fecha_vencimiento || null
        }))
        .filter(({ expectedDate, currentDate }) => expectedDate && !datesMatch(expectedDate, currentDate));

      const prestamoFechaVencimientoActual = prestamo.fecha_vencimiento || null;
      const prestamoFechaVencimientoNuevo = toMiddayDate(expectedLastDate);
      const prestamoNecesitaCambio = !datesMatch(prestamoFechaVencimientoActual, prestamoFechaVencimientoNuevo);

      if (cuotasConCambio.length === 0 && !prestamoNecesitaCambio) {
        if (verbose) {
          console.log(`- ${prestamo.id}: ya está alineado`);
        }
        continue;
      }

      incidencias += cuotasConCambio.length + (prestamoNecesitaCambio ? 1 : 0);
      console.log(
        `Préstamo ${prestamo.id}: ${cuotasConCambio.length} cuotas con fecha distinta` +
        `${prestamoNecesitaCambio ? ', vencimiento final desalineado' : ''}`
      );

      if (verbose) {
        cuotasConCambio.slice(0, 50).forEach(({ cuota, expectedDate, currentDate }) => {
          console.log(
            `  Cuota ${cuota.id}: ${formatDateOnly(currentDate)} -> ${formatDateOnly(expectedDate)}`
          );
        });
        if (prestamoNecesitaCambio) {
          console.log(
            `  Préstamo fecha_vencimiento: ${formatDateOnly(prestamoFechaVencimientoActual)} -> ${formatDateOnly(prestamoFechaVencimientoNuevo)}`
          );
        }
      }

      if (apply) {
        await sequelize.transaction(async (transaction) => {
          for (const { cuota, expectedDate } of cuotasConCambio) {
            await cuota.update({
              fecha_vencimiento: formatDateOnly(expectedDate)
            }, { transaction });
          }

          await prestamo.update({
            fecha_vencimiento: prestamoFechaVencimientoNuevo
          }, { transaction });
        });

        procesados += 1;
      }
    } catch (error) {
      fallidos += 1;
      console.error(`No se pudo reconciliar el préstamo ${prestamo.id}: ${error.message}`);
    }
  }

  console.log(
    `Reconciliación terminada. Procesados=${procesados}, fallidos=${fallidos}, incidencias=${incidencias}.`
  );

  await sequelize.close();
};

main().catch(async (error) => {
  console.error('Error conciliando cronogramas semanales:', error);
  try {
    await sequelize.close();
  } catch (_error) {
    // ignore
  }
  process.exit(1);
});
