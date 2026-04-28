require('dotenv').config();

const { sequelize } = require('../src/models');

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const verbose = args.has('--verbose');

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const main = async () => {
  await sequelize.authenticate();

  const rows = await sequelize.query(
    `
      SELECT
        id,
        monto_solicitado,
        interes,
        num_semanas,
        total_pagar,
        pagos_semanales
      FROM public.prestamos
      WHERE num_semanas IS NOT NULL
        AND num_semanas > 0
    `,
    { type: sequelize.QueryTypes.SELECT }
  );

  const inconsistentes = rows
    .map((row) => {
      const total = round2(row.total_pagar);
      const semanas = Number(row.num_semanas) || 0;
      const esperado = semanas > 0 ? round2(total / semanas) : total;
      const actual = round2(row.pagos_semanales);
      const diff = round2(actual - esperado);
      return {
        id: row.id,
        totalPagar: total,
        pagosSemanalesActual: actual,
        pagosSemanalesEsperado: esperado,
        diferencia: diff,
        requiereActualizacion: Math.abs(diff) >= 0.01
      };
    })
    .filter((item) => item.requiereActualizacion);

  console.log(`Préstamos revisados: ${rows.length}`);
  console.log(`Préstamos inconsistentes: ${inconsistentes.length}`);

  if (!applyChanges) {
    if (verbose) {
      inconsistentes.slice(0, 50).forEach((item) => {
        console.log(
          `- ${item.id}: pagos_semanales=${item.pagosSemanalesActual} -> ${item.pagosSemanalesEsperado} (total=${item.totalPagar})`
        );
      });
    }
    console.log('Ejecuta con --apply para corregir pagos_semanales.');
    return;
  }

  const transaction = await sequelize.transaction();
  try {
    for (const item of inconsistentes) {
      await sequelize.query(
        `
          UPDATE public.prestamos
          SET pagos_semanales = :pagosSemanales
          WHERE id = :prestamoId
        `,
        {
          replacements: {
            prestamoId: item.id,
            pagosSemanales: item.pagosSemanalesEsperado
          },
          transaction
        }
      );

      if (verbose) {
        console.log(`Actualizado ${item.id}`);
      }
    }

    await transaction.commit();
    console.log('Reconciliación de montos de préstamo completada.');
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

main()
  .then(() => sequelize.close())
  .catch((error) => {
    console.error('Error reconciliando montos de préstamo:', error);
    sequelize.close().finally(() => process.exit(1));
  });
