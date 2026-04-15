#!/usr/bin/env node

require('dotenv').config();

const { Sequelize, QueryTypes } = require('sequelize');
const { getDocumentStorageState, deduplicateDocuments } = require('../src/utils/documentStorage');

const buildSequelize = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL no configurada');
  }

  return new Sequelize(databaseUrl, {
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    },
    logging: false
  });
};

const main = async () => {
  const sequelize = buildSequelize();
  const cleanup = process.argv.includes('--cleanup');

  await sequelize.authenticate();

  const solicitudDocs = await sequelize.query(
    `
      SELECT id, cliente_id, solicitud_id, nombre_original AS nombre, tipo_documento, ruta, size_bytes, creado_en
      FROM public.solicitud_documentos
      ORDER BY creado_en DESC
    `,
    { type: QueryTypes.SELECT }
  );

  const clienteDocs = await sequelize.query(
    `
      SELECT id, cliente_id, NULL::uuid AS solicitud_id, nombre, tipo AS tipo_documento, ruta, size_bytes, creado_en
      FROM public.cliente_documentos
      ORDER BY creado_en DESC
    `,
    { type: QueryTypes.SELECT }
  );

  const allDocs = deduplicateDocuments(
    [...solicitudDocs, ...clienteDocs].map((doc) => {
      const storage = getDocumentStorageState(doc.ruta);
      return {
        ...doc,
        storage_path: storage.relativePath,
        exists: storage.exists,
        valid: storage.valid
      };
    })
  );

  const disponibles = allDocs.filter((doc) => doc.valid && doc.exists);
  const huerfanos = allDocs.filter((doc) => !doc.valid || !doc.exists);

  console.log(JSON.stringify({
    total: allDocs.length,
    disponibles: disponibles.length,
    huerfanos: huerfanos.length
  }, null, 2));

  if (huerfanos.length > 0) {
    console.log('Documentos huérfanos o sin archivo:');
    huerfanos.slice(0, 50).forEach((doc) => {
      console.log(`- ${doc.id} | cliente=${doc.cliente_id} | solicitud=${doc.solicitud_id || ''} | ruta=${doc.ruta || ''}`);
    });
  }

  if (cleanup && huerfanos.length > 0) {
    const idsHuerfanos = huerfanos.map((doc) => doc.id).filter(Boolean);
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        'DELETE FROM public.solicitud_documentos WHERE id = ANY(:ids)',
        {
          replacements: { ids: idsHuerfanos },
          type: QueryTypes.DELETE,
          transaction
        }
      );
    });

    console.log(`Eliminados ${idsHuerfanos.length} registros huérfanos de solicitud_documentos.`);
  }

  await sequelize.close();
};

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
