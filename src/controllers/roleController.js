const {
  sequelize,
  Role,
  Permiso,
  RolePermiso,
  Analista,
  AnalistaRole
} = require('../models');
const { ensureAccessControlSeed } = require('../utils/accessControlSeed');
const { getAnalistaPermissionCodes } = require('../middleware/auth');

const buildPermissionTree = (permisos = [], selectedCodes = new Set()) => {
  const treeByModulo = {};

  for (const permiso of permisos) {
    const modulo = permiso.modulo || 'GENERAL';
    const categoria = permiso.categoria || 'GENERAL';

    if (!treeByModulo[modulo]) {
      treeByModulo[modulo] = {
        modulo,
        categorias: {}
      };
    }

    if (!treeByModulo[modulo].categorias[categoria]) {
      treeByModulo[modulo].categorias[categoria] = {
        categoria,
        permisos: []
      };
    }

    treeByModulo[modulo].categorias[categoria].permisos.push({
      id: permiso.id,
      codigo: permiso.codigo,
      nombre: permiso.nombre,
      descripcion: permiso.descripcion,
      selected: selectedCodes.has(permiso.codigo)
    });
  }

  return Object.values(treeByModulo).map((moduloItem) => ({
    modulo: moduloItem.modulo,
    categorias: Object.values(moduloItem.categorias).map((categoriaItem) => ({
      categoria: categoriaItem.categoria,
      permisos: categoriaItem.permisos
    }))
  }));
};

const ensureAccessControlSchema = async () => {
  await Role.sync();
  await Permiso.sync();
  await RolePermiso.sync();
  await AnalistaRole.sync();
};

class RoleController {
  async seed(req, res) {
    try {
      await ensureAccessControlSchema();
      const result = await sequelize.transaction(async (transaction) =>
        ensureAccessControlSeed({ Role, Permiso, RolePermiso, Analista, AnalistaRole }, { transaction })
      );

      return res.json({
        success: true,
        message: 'Seed de roles y permisos ejecutado correctamente',
        data: result
      });
    } catch (error) {
      console.error('Error ejecutando seed de roles:', error);
      return res.status(500).json({
        success: false,
        message: 'Error ejecutando seed de roles'
      });
    }
  }

  async listRoles(req, res) {
    try {
      await ensureAccessControlSchema();
      const roles = await Role.findAll({
        order: [['prioridad', 'ASC'], ['nombre', 'ASC']]
      });

      if (roles.length === 0) {
        await sequelize.transaction(async (transaction) =>
          ensureAccessControlSeed({ Role, Permiso, RolePermiso, Analista, AnalistaRole }, { transaction })
        );
      }

      const finalRoles = await Role.findAll({
        order: [['prioridad', 'ASC'], ['nombre', 'ASC']]
      });

      const roleIds = finalRoles.map((role) => role.id);
      const assignments = await AnalistaRole.findAll({
        where: { role_id: roleIds },
        attributes: ['role_id']
      });

      const assignedByRole = assignments.reduce((acc, item) => {
        acc[item.role_id] = (acc[item.role_id] || 0) + 1;
        return acc;
      }, {});

      return res.json({
        success: true,
        data: finalRoles.map((role) => ({
          id: role.id,
          nombre: role.nombre,
          prioridad: role.prioridad,
          estado: role.estado,
          descripcion: role.descripcion,
          asignados: assignedByRole[role.id] || 0
        }))
      });
    } catch (error) {
      console.error('Error listando roles:', error);
      return res.status(500).json({
        success: false,
        message: 'Error listando roles'
      });
    }
  }

  async createRole(req, res) {
    try {
      await ensureAccessControlSchema();
      const { nombre, prioridad = 100, descripcion = null, estado = 'ACTIVO' } = req.body;

      if (!nombre || !String(nombre).trim()) {
        return res.status(400).json({
          success: false,
          message: 'nombre es requerido'
        });
      }

      const role = await Role.create({
        nombre: String(nombre).trim().toUpperCase(),
        prioridad: parseInt(prioridad, 10),
        descripcion,
        estado,
        created_at: new Date(),
        updated_at: new Date()
      });

      return res.status(201).json({
        success: true,
        message: 'Rol creado correctamente',
        data: role
      });
    } catch (error) {
      console.error('Error creando rol:', error);
      const message = error.name === 'SequelizeUniqueConstraintError'
        ? 'Ya existe un rol con ese nombre'
        : 'Error creando rol';
      return res.status(400).json({ success: false, message });
    }
  }

  async updateRole(req, res) {
    try {
      await ensureAccessControlSchema();
      const { id } = req.params;
      const { nombre, prioridad, estado, descripcion } = req.body;

      const role = await Role.findByPk(id);
      if (!role) {
        return res.status(404).json({
          success: false,
          message: 'Rol no encontrado'
        });
      }

      const updates = {};
      if (nombre !== undefined) updates.nombre = String(nombre).trim().toUpperCase();
      if (prioridad !== undefined) updates.prioridad = parseInt(prioridad, 10);
      if (estado !== undefined) updates.estado = estado;
      if (descripcion !== undefined) updates.descripcion = descripcion;
      updates.updated_at = new Date();

      await role.update(updates);

      return res.json({
        success: true,
        message: 'Rol actualizado correctamente',
        data: role
      });
    } catch (error) {
      console.error('Error actualizando rol:', error);
      return res.status(500).json({
        success: false,
        message: 'Error actualizando rol'
      });
    }
  }

  async getPermisoCatalog(req, res) {
    try {
      await ensureAccessControlSchema();
      const permisos = await Permiso.findAll({
        order: [['modulo', 'ASC'], ['categoria', 'ASC'], ['nombre', 'ASC']]
      });

      return res.json({
        success: true,
        data: buildPermissionTree(permisos, new Set())
      });
    } catch (error) {
      console.error('Error obteniendo catálogo de permisos:', error);
      return res.status(500).json({
        success: false,
        message: 'Error obteniendo catálogo de permisos'
      });
    }
  }

  async getRolePermissions(req, res) {
    try {
      await ensureAccessControlSchema();
      const { id } = req.params;

      const role = await Role.findByPk(id, {
        include: [
          {
            model: Permiso,
            as: 'permisos',
            through: { attributes: [] }
          }
        ]
      });

      if (!role) {
        return res.status(404).json({
          success: false,
          message: 'Rol no encontrado'
        });
      }

      const allPermisos = await Permiso.findAll({
        order: [['modulo', 'ASC'], ['categoria', 'ASC'], ['nombre', 'ASC']]
      });

      const selectedCodes = new Set((role.permisos || []).map((item) => item.codigo));
      const tree = buildPermissionTree(allPermisos, selectedCodes);

      return res.json({
        success: true,
        data: {
          role: {
            id: role.id,
            nombre: role.nombre,
            prioridad: role.prioridad,
            estado: role.estado,
            descripcion: role.descripcion
          },
          permisos_tree: tree,
          selected_permission_codes: [...selectedCodes]
        }
      });
    } catch (error) {
      console.error('Error obteniendo permisos del rol:', error);
      return res.status(500).json({
        success: false,
        message: 'Error obteniendo permisos del rol'
      });
    }
  }

  async updateRolePermissions(req, res) {
    try {
      await ensureAccessControlSchema();
      const { id } = req.params;
      const { permission_codes = [] } = req.body;

      if (!Array.isArray(permission_codes)) {
        return res.status(400).json({
          success: false,
          message: 'permission_codes debe ser un array'
        });
      }

      const role = await Role.findByPk(id);
      if (!role) {
        return res.status(404).json({
          success: false,
          message: 'Rol no encontrado'
        });
      }

      const permisos = await Permiso.findAll({
        where: { codigo: permission_codes }
      });

      if (permisos.length !== permission_codes.length) {
        return res.status(400).json({
          success: false,
          message: 'Uno o más códigos de permisos no existen'
        });
      }

      await sequelize.transaction(async (transaction) => {
        await RolePermiso.destroy({
          where: { role_id: role.id },
          transaction
        });

        if (permisos.length > 0) {
          const rows = permisos.map((permiso) => ({
            role_id: role.id,
            permiso_id: permiso.id,
            created_at: new Date()
          }));

          await RolePermiso.bulkCreate(rows, { transaction });
        }
      });

      return res.json({
        success: true,
        message: 'Permisos del rol actualizados correctamente',
        data: {
          role_id: role.id,
          permission_codes
        }
      });
    } catch (error) {
      console.error('Error actualizando permisos del rol:', error);
      return res.status(500).json({
        success: false,
        message: 'Error actualizando permisos del rol'
      });
    }
  }

  async assignRoleToAnalista(req, res) {
    try {
      await ensureAccessControlSchema();
      const { id } = req.params;
      const { role_id } = req.body;

      if (!role_id) {
        return res.status(400).json({
          success: false,
          message: 'role_id es requerido'
        });
      }

      const analista = await Analista.findByPk(id);
      if (!analista) {
        return res.status(404).json({
          success: false,
          message: 'Analista no encontrado'
        });
      }

      const role = await Role.findByPk(role_id);
      if (!role) {
        return res.status(404).json({
          success: false,
          message: 'Rol no encontrado'
        });
      }

      const [assignment, created] = await AnalistaRole.findOrCreate({
        where: { analista_id: analista.id },
        defaults: {
          role_id: role.id,
          created_at: new Date(),
          updated_at: new Date()
        }
      });

      if (!created) {
        await assignment.update({
          role_id: role.id,
          updated_at: new Date()
        });
      }

      if (role.nombre && analista.rol !== role.nombre) {
        await analista.update({
          rol: role.nombre,
          updated_at: new Date()
        });
      }

      return res.json({
        success: true,
        message: 'Rol asignado correctamente al analista',
        data: {
          analista_id: analista.id,
          role_id: role.id,
          role_nombre: role.nombre
        }
      });
    } catch (error) {
      console.error('Error asignando rol al analista:', error);
      return res.status(500).json({
        success: false,
        message: 'Error asignando rol al analista'
      });
    }
  }

  async getAnalistaPermissions(req, res) {
    try {
      await ensureAccessControlSchema();
      const { id } = req.params;
      const analista = await Analista.findByPk(id, {
        attributes: ['id', 'nombre', 'apellido', 'email', 'rol', 'estado']
      });

      if (!analista) {
        return res.status(404).json({
          success: false,
          message: 'Analista no encontrado'
        });
      }

      const assignment = await AnalistaRole.findOne({
        where: { analista_id: analista.id },
        include: [
          {
            model: Role,
            as: 'role'
          }
        ]
      });

      const permissionCodes = await getAnalistaPermissionCodes(analista.id);

      return res.json({
        success: true,
        data: {
          analista,
          access_role: assignment?.role
            ? {
                id: assignment.role.id,
                nombre: assignment.role.nombre,
                prioridad: assignment.role.prioridad,
                estado: assignment.role.estado
              }
            : null,
          permission_codes: permissionCodes
        }
      });
    } catch (error) {
      console.error('Error obteniendo permisos efectivos del analista:', error);
      return res.status(500).json({
        success: false,
        message: 'Error obteniendo permisos efectivos del analista'
      });
    }
  }
}

module.exports = new RoleController();
