require('dotenv').config();

const { sequelize } = require('../src/models');
const { buildClienteNombreCompleto } = require('../src/utils/clienteDisplay');

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const verbose = args.has('--verbose');

const main = async () => {
  await sequelize.authenticate();

  const rows = await sequelize.query(
    `
      SELECT
        p.id AS prestamo_id,
        p.nombre_completo AS nombre_completo_registro,
        c.nombre,
        c.apellido
      FROM public.prestamos p
      INNER JOIN public.solicitudes s ON s.id = p.solicitud_id
      INNER JOIN public.clientes c ON c.id = s.cliente_id
    `,
    { type: sequelize.QueryTypes.SELECT }
  );

  const cambios = rows
    .map((row) => {
      const nombreCompletoActual = buildClienteNombreCompleto(row);
      const nombreRegistro = String(row.nombre_completo_registro || '').trim();
      return {
        prestamoId: row.prestamo_id,
        nombreActual: nombreCompletoActual,
        nombreRegistro,
        requiereActualizacion: nombreCompletoActual && nombreCompletoActual !== nombreRegistro
      };
    })
    .filter((item) => item.requiereActualizacion);

  console.log(`Préstamos revisados: ${rows.length}`);
  console.log(`Préstamos con nombre desincronizado: ${cambios.length}`);

  if (!applyChanges) {
    if (verbose) {
      cambios.slice(0, 25).forEach((item) => {
        console.log(`- ${item.prestamoId}: "${item.nombreRegistro}" -> "${item.nombreActual}"`);
      });
    }
    console.log('Ejecuta con --apply para aplicar los cambios.');
    return;
  }

  const transaction = await sequelize.transaction();
  try {
    for (const item of cambios) {
      await sequelize.query(
        `
          UPDATE public.prestamos
          SET nombre_completo = :nombreCompleto
          WHERE id = :prestamoId
        `,
        {
          replacements: {
            prestamoId: item.prestamoId,
            nombreCompleto: item.nombreActual
          },
          transaction
        }
      );
      if (verbose) {
        console.log(`Actualizado ${item.prestamoId}`);
      }
    }

    await transaction.commit();
    console.log('Reconciliación de nombres completada.');
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

main()
  .then(() => sequelize.close())
  .catch((error) => {
    console.error('Error reconciliando nombres de préstamos:', error);
    sequelize.close().finally(() => process.exit(1));
  });
