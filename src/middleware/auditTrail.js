const { AuditLog } = require('../models');

const MAX_STRING_LENGTH = 500;
const MAX_METADATA_KEYS = 30;
const SENSITIVE_KEYS = new Set([
  'password',
  'nueva_password',
  'password_actual',
  'token',
  'authorization',
  'documentos',
  'contrato_credito'
]);

const toShortText = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value);
  if (text.length <= MAX_STRING_LENGTH) return text;
  return `${text.slice(0, MAX_STRING_LENGTH)}...`;
};

const sanitizeObject = (input, depth = 0) => {
  if (input === null || input === undefined) return input;
  if (depth > 2) return '[depth_limited]';

  if (Array.isArray(input)) {
    return input.slice(0, 10).map((item) => sanitizeObject(item, depth + 1));
  }

  if (typeof input === 'object') {
    const entries = Object.entries(input).slice(0, MAX_METADATA_KEYS);
    const result = {};
    entries.forEach(([key, value]) => {
      if (SENSITIVE_KEYS.has(String(key).toLowerCase())) return;
      if (typeof value === 'string') {
        result[key] = toShortText(value);
        return;
      }
      result[key] = sanitizeObject(value, depth + 1);
    });
    return result;
  }

  if (typeof input === 'string') return toShortText(input);
  return input;
};

const inferModule = (endpoint = '') => {
  if (endpoint.includes('/api/clientes')) return 'Clientes';
  if (endpoint.includes('/api/solicitudes')) return 'Solicitudes';
  if (endpoint.includes('/api/prestamos')) return 'Préstamos';
  if (endpoint.includes('/api/cuotas')) return 'Cuotas';
  if (endpoint.includes('/api/roles')) return 'Roles';
  if (endpoint.includes('/api/analistas')) return 'Analistas';
  if (endpoint.includes('/api/documentos')) return 'Documentos';
  if (endpoint.includes('/api/reportes')) return 'Reportes';
  if (endpoint.includes('/api/auth')) return 'Auth';
  if (endpoint.includes('/api/analytics')) return 'Analytics';
  if (endpoint.includes('/api/ratings')) return 'Ratings';
  return 'Sistema';
};

const inferEntity = (endpoint = '') => {
  if (endpoint.includes('/api/clientes')) return 'cliente';
  if (endpoint.includes('/api/solicitudes')) return 'solicitud';
  if (endpoint.includes('/api/prestamos')) return 'prestamo';
  if (endpoint.includes('/api/cuotas')) return 'cuota';
  if (endpoint.includes('/api/roles')) return 'rol';
  if (endpoint.includes('/api/analistas')) return 'analista';
  if (endpoint.includes('/api/documentos')) return 'documento';
  if (endpoint.includes('/api/reportes/pagos-bancarios')) return 'pago_bancario_cargado';
  return null;
};

const inferAction = ({ method, endpoint, statusCode }) => {
  const path = String(endpoint || '');
  const verb = String(method || '').toUpperCase();
  const isError = Number(statusCode || 0) >= 400;

  if (path.includes('/login')) return isError ? 'Intento de login fallido' : 'Login exitoso';
  if (path.includes('/logout')) return isError ? 'Logout fallido' : 'Logout';
  if (path.includes('/reset-password')) return isError ? 'Intento de reset de contraseña fallido' : 'Reset de contraseña';
  if (path.includes('/aprobar') || path.includes('/prestamos/solicitud/')) return isError ? 'Intento de aprobar solicitud fallido' : 'Aprobó solicitud y creó préstamo';
  if (path.includes('/rechazar')) return isError ? 'Intento de rechazo de solicitud fallido' : 'Rechazó solicitud';
  if (path.includes('/pago-semanal') || path.includes('/:id/pago')) return isError ? 'Intento de registrar pago fallido' : 'Registró pago';
  if (path.includes('/notificar-email')) return 'NOTIFICAR_EMAIL_MANUAL';
  if (path.includes('/notificar-whatsapp')) return 'NOTIFICAR_WHATSAPP_MANUAL';
  if (path.includes('/pagos-bancarios/cargar')) return isError ? 'CARGA_PAGOS_BANCARIOS_ERROR' : 'CARGA_PAGOS_BANCARIOS';
  if (path.includes('/reportes/generar')) return isError ? 'GENERACION_REPORTE_ERROR' : 'GENERACION_REPORTE';
  if (path.includes('/rol-acceso')) return isError ? 'Intento de asignación de rol fallido' : 'Asignó rol';
  if (path.includes('/permisos')) return isError ? 'Intento de actualización de permisos fallido' : 'Actualizó permisos';

  if (verb === 'POST') return isError ? 'Creación fallida' : 'Creó registro';
  if (verb === 'PUT' || verb === 'PATCH') return isError ? 'Actualización fallida' : 'Actualizó registro';
  if (verb === 'DELETE') return isError ? 'Eliminación fallida' : 'Eliminó registro';
  if (verb === 'GET') return isError ? 'Consulta fallida' : 'Consultó información';
  return isError ? 'Operación fallida' : 'Operación exitosa';
};

const inferEntityId = (req) =>
  req.params?.id ||
  req.params?.clienteId ||
  req.params?.solicitudId ||
  req.params?.prestamoId ||
  req.params?.analistaId ||
  null;

const resolveEndpointTemplate = (req) => {
  const base = req.baseUrl || '';
  const routePath = req.route?.path || '';
  if (routePath) return `${base}${routePath}`;
  return String(req.originalUrl || '').split('?')[0];
};

const auditTrail = (req, res, next) => {
  const startedAt = Date.now();
  const endpointTemplate = resolveEndpointTemplate(req);
  const modulo = inferModule(endpointTemplate);
  const entidad = inferEntity(endpointTemplate);
  const entityId = inferEntityId(req);
  let responseMessage = null;

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object') {
      responseMessage = body.message || null;
    }
    return originalJson(body);
  };

  res.on('finish', () => {
    const statusCode = res.statusCode;
    if (endpointTemplate.includes('/api/logs')) return;
    if (!endpointTemplate.startsWith('/api/')) return;

    const payload = {
      created_at: new Date(),
      analista_id: req.user?.id || null,
      analista_nombre: req.user?.nombre || null,
      analista_email: req.user?.email || null,
      rol_nombre: req.user?.rol || null,
      modulo,
      accion: res.locals?.audit_action || inferAction({ method: req.method, endpoint: endpointTemplate, statusCode }),
      entidad,
      entidad_id: entityId,
      metodo_http: req.method,
      endpoint: endpointTemplate,
      status_code: statusCode,
      resultado: statusCode === 403 ? 'FORBIDDEN' : statusCode >= 400 ? 'ERROR' : 'SUCCESS',
      ip: req.ip || req.headers['x-forwarded-for'] || null,
      user_agent: toShortText(req.headers['user-agent'] || ''),
      request_id: req.request_id || null,
      metadata: sanitizeObject({
        query: req.query,
        body: req.body,
        params: req.params,
        audit: res.locals?.audit_metadata || null,
        duration_ms: Date.now() - startedAt
      }),
      error_message: statusCode >= 400
        ? toShortText(responseMessage || res.locals?.error_message || res.locals?.message || null)
        : null
    };

    AuditLog.create(payload).catch((error) => {
      console.error('Error registrando audit log:', error.message);
    });
  });

  next();
};

module.exports = {
  auditTrail
};
