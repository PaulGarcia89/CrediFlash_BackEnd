const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getDocumentStorageState,
  deduplicateDocuments,
  normalizeUploadPath
} = require('../src/utils/documentStorage');

test('getDocumentStorageState detecta archivos existentes dentro de uploads', () => {
  const relativePath = `uploads/test-document-storage-${Date.now()}.pdf`;
  const absolutePath = path.join(__dirname, '..', relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, 'pdf-test');

  try {
    const state = getDocumentStorageState(relativePath);

    assert.equal(state.valid, true);
    assert.equal(state.exists, true);
    assert.equal(state.relativePath, normalizeUploadPath(relativePath));
    assert.equal(state.absolutePath, path.resolve(path.join(__dirname, '..'), normalizeUploadPath(relativePath)));
  } finally {
    fs.rmSync(path.dirname(absolutePath), { recursive: true, force: true });
  }
});

test('getDocumentStorageState rechaza rutas fuera de uploads', () => {
  const state = getDocumentStorageState('../etc/passwd');

  assert.equal(state.valid, false);
  assert.equal(state.exists, false);
  assert.equal(state.relativePath, normalizeUploadPath('../etc/passwd'));
});

test('deduplicateDocuments consolida documentos repetidos por huella estable', () => {
  const docs = deduplicateDocuments([
    {
      cliente_id: 'cliente-1',
      solicitud_id: 'solicitud-1',
      storage_path: 'uploads/clientes/a.pdf',
      nombre: 'a.pdf',
      tipo_documento: 'IDENTIDAD',
      size_bytes: 120
    },
    {
      cliente_id: 'cliente-1',
      solicitud_id: 'solicitud-1',
      storage_path: 'uploads/clientes/a.pdf',
      nombre: 'a.pdf',
      tipo_documento: 'IDENTIDAD',
      size_bytes: 120
    },
    {
      cliente_id: 'cliente-1',
      solicitud_id: 'solicitud-2',
      storage_path: 'uploads/clientes/b.pdf',
      nombre: 'b.pdf',
      tipo_documento: 'ESTADO_CUENTA',
      size_bytes: 220
    }
  ]);

  assert.equal(docs.length, 2);
  assert.equal(docs[0].storage_path, 'uploads/clientes/a.pdf');
  assert.equal(docs[1].storage_path, 'uploads/clientes/b.pdf');
});
