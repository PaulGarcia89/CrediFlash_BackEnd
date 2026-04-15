const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const UPLOADS_ROOT = path.resolve(PROJECT_ROOT, 'uploads');

const normalizeUploadPath = (value = '') =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();

const resolveAbsoluteUploadPath = (relativePath = '') => path.resolve(PROJECT_ROOT, normalizeUploadPath(relativePath));

const isPathInsideUploadsRoot = (absolutePath = '') => {
  const normalizedAbsolutePath = path.resolve(String(absolutePath || ''));
  return normalizedAbsolutePath === UPLOADS_ROOT || normalizedAbsolutePath.startsWith(`${UPLOADS_ROOT}${path.sep}`);
};

const getDocumentStorageState = (relativePath = '') => {
  const normalizedRelativePath = normalizeUploadPath(relativePath);
  if (!normalizedRelativePath) {
    return {
      relativePath: null,
      absolutePath: null,
      exists: false,
      valid: false
    };
  }

  const absolutePath = resolveAbsoluteUploadPath(normalizedRelativePath);
  if (!isPathInsideUploadsRoot(absolutePath)) {
    return {
      relativePath: normalizedRelativePath,
      absolutePath,
      exists: false,
      valid: false
    };
  }

  return {
    relativePath: normalizedRelativePath,
    absolutePath,
    exists: fs.existsSync(absolutePath),
    valid: true
  };
};

const buildDocumentFingerprint = (documento = {}) => {
  const clienteId = String(documento.cliente_id || documento.clienteId || '').trim();
  const solicitudId = String(documento.solicitud_id || documento.solicitudId || '').trim();
  const storagePath = normalizeUploadPath(documento.storage_path || documento.ruta || '');
  const nombre = String(documento.nombre || documento.nombre_original || '').trim().toLowerCase();
  const tipo = String(documento.tipo_documento || documento.categoria || documento.tipo || '').trim().toLowerCase();
  const sizeBytes = String(documento.size_bytes ?? '').trim();

  return [clienteId, solicitudId, storagePath, nombre, tipo, sizeBytes].join('|');
};

const deduplicateDocuments = (documentos = []) => {
  const seen = new Set();

  return documentos.filter((documento) => {
    const fingerprint = buildDocumentFingerprint(documento);
    if (seen.has(fingerprint)) return false;

    seen.add(fingerprint);
    return true;
  });
};

module.exports = {
  PROJECT_ROOT,
  UPLOADS_ROOT,
  normalizeUploadPath,
  resolveAbsoluteUploadPath,
  isPathInsideUploadsRoot,
  getDocumentStorageState,
  buildDocumentFingerprint,
  deduplicateDocuments
};
