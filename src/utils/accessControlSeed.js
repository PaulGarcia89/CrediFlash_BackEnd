const ROLE_DEFINITIONS = [
  { nombre: 'ADMINISTRADOR', prioridad: 1, descripcion: 'Acceso total al sistema' },
  { nombre: 'SUPERVISOR', prioridad: 2, descripcion: 'Control operativo y revisión' },
  { nombre: 'ANALISTA', prioridad: 3, descripcion: 'Operación diaria de solicitudes y clientes' }
];

const PERMISSION_DEFINITIONS = [
  { codigo: 'dashboard.view', modulo: 'DASHBOARD', categoria: 'ANALYTICS', nombre: 'Ver dashboard' },
  { codigo: 'clientes.view', modulo: 'CLIENTES', categoria: 'GESTION', nombre: 'Ver clientes' },
  { codigo: 'clientes.create', modulo: 'CLIENTES', categoria: 'GESTION', nombre: 'Crear clientes' },
  { codigo: 'clientes.edit', modulo: 'CLIENTES', categoria: 'GESTION', nombre: 'Editar clientes' },
  { codigo: 'solicitudes.view', modulo: 'SOLICITUDES', categoria: 'GESTION', nombre: 'Ver solicitudes' },
  { codigo: 'solicitudes.create', modulo: 'SOLICITUDES', categoria: 'GESTION', nombre: 'Crear solicitudes' },
  { codigo: 'solicitudes.approve', modulo: 'SOLICITUDES', categoria: 'DECISION', nombre: 'Aprobar solicitudes' },
  { codigo: 'solicitudes.reject', modulo: 'SOLICITUDES', categoria: 'DECISION', nombre: 'Rechazar solicitudes' },
  { codigo: 'prestamos.view', modulo: 'PRESTAMOS', categoria: 'GESTION', nombre: 'Ver préstamos' },
  { codigo: 'prestamos.create', modulo: 'PRESTAMOS', categoria: 'GESTION', nombre: 'Crear préstamos' },
  { codigo: 'prestamos.pay', modulo: 'PRESTAMOS', categoria: 'PAGOS', nombre: 'Registrar pago semanal' },
  { codigo: 'cuotas.view', modulo: 'CUOTAS', categoria: 'GESTION', nombre: 'Ver cuotas' },
  { codigo: 'cuotas.manage', modulo: 'CUOTAS', categoria: 'GESTION', nombre: 'Generar/editar cuotas' },
  { codigo: 'ratings.run', modulo: 'RATINGS', categoria: 'MODELOS', nombre: 'Ejecutar modelos de rating' },
  { codigo: 'analytics.view', modulo: 'REPORTES', categoria: 'ANALYTICS', nombre: 'Ver reportes/analytics' },
  { codigo: 'analistas.view', modulo: 'ANALISTAS', categoria: 'ADMIN', nombre: 'Ver analistas' },
  { codigo: 'analistas.manage', modulo: 'ANALISTAS', categoria: 'ADMIN', nombre: 'Crear/editar analistas' },
  { codigo: 'roles.view', modulo: 'ROLES', categoria: 'ADMIN', nombre: 'Ver roles y permisos' },
  { codigo: 'roles.manage', modulo: 'ROLES', categoria: 'ADMIN', nombre: 'Editar roles y permisos' }
];

const DEFAULT_ROLE_PERMISSION_CODES = {
  ADMINISTRADOR: PERMISSION_DEFINITIONS.map((item) => item.codigo),
  SUPERVISOR: [
    'dashboard.view',
    'clientes.view',
    'clientes.create',
    'clientes.edit',
    'solicitudes.view',
    'solicitudes.create',
    'solicitudes.approve',
    'solicitudes.reject',
    'prestamos.view',
    'prestamos.create',
    'prestamos.pay',
    'cuotas.view',
    'cuotas.manage',
    'ratings.run',
    'analytics.view',
    'analistas.view',
    'roles.view'
  ],
  ANALISTA: [
    'dashboard.view',
    'clientes.view',
    'clientes.create',
    'clientes.edit',
    'solicitudes.view',
    'solicitudes.create',
    'solicitudes.approve',
    'solicitudes.reject',
    'prestamos.view',
    'prestamos.create',
    'prestamos.pay',
    'cuotas.view',
    'ratings.run'
  ]
};

async function ensureAccessControlSeed(models, { transaction } = {}) {
  const { Role, Permiso, RolePermiso, Analista, AnalistaRole } = models;

  const roleMap = {};
  for (const roleDef of ROLE_DEFINITIONS) {
    const [role] = await Role.findOrCreate({
      where: { nombre: roleDef.nombre },
      defaults: {
        ...roleDef,
        estado: 'ACTIVO',
        created_at: new Date(),
        updated_at: new Date()
      },
      transaction
    });
    roleMap[role.nombre] = role;
  }

  const permisoMap = {};
  for (const permisoDef of PERMISSION_DEFINITIONS) {
    const [permiso] = await Permiso.findOrCreate({
      where: { codigo: permisoDef.codigo },
      defaults: {
        ...permisoDef,
        created_at: new Date(),
        updated_at: new Date()
      },
      transaction
    });
    permisoMap[permiso.codigo] = permiso;
  }

  for (const [roleName, codigos] of Object.entries(DEFAULT_ROLE_PERMISSION_CODES)) {
    const role = roleMap[roleName];
    if (!role) continue;

    for (const codigo of codigos) {
      const permiso = permisoMap[codigo];
      if (!permiso) continue;

      await RolePermiso.findOrCreate({
        where: {
          role_id: role.id,
          permiso_id: permiso.id
        },
        defaults: { created_at: new Date() },
        transaction
      });
    }
  }

  const analistas = await Analista.findAll({
    attributes: ['id', 'rol'],
    transaction
  });

  for (const analista of analistas) {
    const legacyRoleName = String(analista.rol || 'ANALISTA').toUpperCase();
    const assignedRole = roleMap[legacyRoleName] || roleMap.ANALISTA;
    if (!assignedRole) continue;

    await AnalistaRole.findOrCreate({
      where: { analista_id: analista.id },
      defaults: {
        role_id: assignedRole.id,
        created_at: new Date(),
        updated_at: new Date()
      },
      transaction
    });
  }

  return {
    roles: Object.keys(roleMap).length,
    permisos: Object.keys(permisoMap).length
  };
}

module.exports = {
  ensureAccessControlSeed,
  ROLE_DEFINITIONS,
  PERMISSION_DEFINITIONS
};
