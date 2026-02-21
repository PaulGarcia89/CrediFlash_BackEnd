// src/controllers/analistaController.js
const { Analista, Role } = require("../models");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");

const SALT_ROUNDS = 10;

const mapAnalistaWithRole = (analista) => {
  if (!analista) return null;
  const payload = analista.toJSON ? analista.toJSON() : analista;
  const accessRole = Array.isArray(payload.roles_acceso) && payload.roles_acceso.length > 0
    ? payload.roles_acceso[0]
    : null;

  return {
    ...payload,
    access_role: accessRole
      ? {
          id: accessRole.id,
          nombre: accessRole.nombre,
          prioridad: accessRole.prioridad,
          estado: accessRole.estado
        }
      : null
  };
};

class AnalistaController {
  // ✅ REGISTRAR NUEVO ANALISTA
  async registrarAnalista(req, res) {
    try {
      const {
        nombre,
        apellido,
        email,
        password,
        telefono,
        rol,
        codigo_analista,
        departamento,
      } = req.body;

      if (!nombre || !apellido || !email || !password) {
        return res.status(400).json({
          success: false,
          message: "Nombre, apellido, email y contraseña son requeridos",
        });
      }

      if (String(password).length < 6) {
        return res.status(400).json({
          success: false,
          message: "La contraseña debe tener al menos 6 caracteres",
        });
      }

      const emailNormalizado = String(email).trim().toLowerCase();

      const exists = await Analista.findOne({ where: { email: emailNormalizado } });
      if (exists) {
        return res.status(400).json({
          success: false,
          message: "El email ya está registrado",
        });
      }

      // ✅ Hash real antes de guardar
      const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);

      const analista = await Analista.create({
        nombre: String(nombre).trim(),
        apellido: String(apellido).trim(),
        email: emailNormalizado,
        password: passwordHash,
        telefono: telefono ? String(telefono).trim() : null,
        rol: rol || "ANALISTA",
        estado: "ACTIVO",
        codigo_analista: codigo_analista ? String(codigo_analista).trim() : null,
        departamento: departamento ? String(departamento).trim() : null,
        fecha_registro: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });

      if (!process.env.JWT_SECRET) {
        return res.status(500).json({
          success: false,
          message: "Falta JWT_SECRET en variables de entorno",
        });
      }

      const token = jwt.sign(
        {
          id: analista.id,
          email: analista.email,
          rol: analista.rol,
          nombre: `${analista.nombre} ${analista.apellido}`,
        },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
      );

      return res.status(201).json({
        success: true,
        message: "✅ Analista registrado exitosamente",
        data: {
          token,
          user: {
            id: analista.id,
            nombre: analista.nombre,
            apellido: analista.apellido,
            email: analista.email,
            rol: analista.rol,
            telefono: analista.telefono,
            estado: analista.estado,
            codigo_analista: analista.codigo_analista,
            departamento: analista.departamento,
            fecha_registro: analista.fecha_registro,
          },
        },
      });
    } catch (error) {
      console.error("❌ Error en registrarAnalista:", error);
      return res.status(500).json({
        success: false,
        message: "Error en el servidor",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // ✅ LOGIN REAL (SIN BYPASS)
  async login(req, res) {
    try {
      const { email, password } = req.body;
  
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email y contraseña son requeridos",
        });
      }
  
      const emailNormalizado = String(email).trim().toLowerCase();
  
      // ✅ OJO: traer el password usando scope
      const analista = await Analista.scope("withPassword").findOne({
        where: { email: emailNormalizado },
      });
  
      if (!analista) {
        return res.status(401).json({ success: false, message: "Credenciales inválidas" });
      }
  
      if (analista.estado !== "ACTIVO") {
        return res.status(401).json({ success: false, message: "Cuenta desactivada" });
      }
  
      if (!analista.password) {
        // Esto solo pasaría si el scope no funcionó o el registro está corrupto
        return res.status(500).json({
          success: false,
          message: "El usuario no tiene password válido en DB",
        });
      }
  
      const ok = await bcrypt.compare(String(password), analista.password);
  
      if (!ok) {
        return res.status(401).json({ success: false, message: "Credenciales inválidas" });
      }
  
      if (!process.env.JWT_SECRET) {
        return res.status(500).json({ success: false, message: "Falta JWT_SECRET en variables de entorno" });
      }
  
      await analista.update({ ultimo_acceso: new Date(), updated_at: new Date() });

      const analistaConAcceso = await Analista.findByPk(analista.id, {
        attributes: { exclude: ['password'] },
        include: [
          {
            model: Role,
            as: 'roles_acceso',
            attributes: ['id', 'nombre', 'prioridad', 'estado'],
            through: { attributes: [] }
          }
        ]
      });
  
      const token = jwt.sign(
        { id: analista.id, email: analista.email, rol: analista.rol },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
      );
  
      // ✅ responde sin password
      return res.json({
        success: true,
        message: "✅ Login exitoso",
        data: {
          token,
          user: {
            ...mapAnalistaWithRole(analistaConAcceso)
          },
        },
      });
    } catch (error) {
      console.error("❌ Error en login:", error);
      return res.status(500).json({
        success: false,
        message: "Error en el servidor",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // ✅ PERFIL (requiere middleware auth que setee req.user)
  async getPerfil(req, res) {
    try {
      const analista = await Analista.findByPk(req.user.id, {
        attributes: { exclude: ["password"] },
        include: [
          {
            model: Role,
            as: 'roles_acceso',
            attributes: ['id', 'nombre', 'prioridad', 'estado'],
            through: { attributes: [] }
          }
        ]
      });

      if (!analista) {
        return res.status(404).json({
          success: false,
          message: "Analista no encontrado",
        });
      }

      return res.json({
        success: true,
        message: "✅ Perfil obtenido",
        data: mapAnalistaWithRole(analista),
      });
    } catch (error) {
      console.error("❌ Error getPerfil:", error);
      return res.status(500).json({
        success: false,
        message: "Error en el servidor",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // ✅ ACTUALIZAR PERFIL (cambia password con hash real)
  async updatePerfil(req, res) {
    try {
      const { nombre, apellido, telefono, password_actual, nueva_password } = req.body;

      const analista = await Analista.findByPk(req.user.id);
      if (!analista) {
        return res.status(404).json({
          success: false,
          message: "Analista no encontrado",
        });
      }

      const updates = {};

      if (nombre !== undefined) updates.nombre = String(nombre).trim();
      if (apellido !== undefined) updates.apellido = String(apellido).trim();
      if (telefono !== undefined) updates.telefono = telefono ? String(telefono).trim() : null;

      if (password_actual && nueva_password) {
        const ok = await bcrypt.compare(String(password_actual), analista.password);
        if (!ok) {
          return res.status(400).json({
            success: false,
            message: "La contraseña actual es incorrecta",
          });
        }

        if (String(nueva_password).length < 6) {
          return res.status(400).json({
            success: false,
            message: "La nueva contraseña debe tener al menos 6 caracteres",
          });
        }

        updates.password = await bcrypt.hash(String(nueva_password), SALT_ROUNDS);
      }

      await analista.update({ ...updates, updated_at: new Date() });

      const analistaActualizado = await Analista.findByPk(req.user.id, {
        attributes: { exclude: ["password"] },
      });

      return res.json({
        success: true,
        message: "✅ Perfil actualizado exitosamente",
        data: analistaActualizado,
      });
    } catch (error) {
      console.error("❌ Error updatePerfil:", error);
      return res.status(500).json({
        success: false,
        message: "Error en el servidor",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // ✅ LISTAR ANALISTAS (solo admin/supervisor) -> asume middleware que valida rol
  async listarAnalistas(req, res) {
    try {
      const { page = 1, limit = 20, rol, estado, search } = req.query;
      const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      const where = {};
      if (rol) where.rol = rol;
      if (estado) where.estado = estado;

      if (search) {
        where[Op.or] = [
          { nombre: { [Op.iLike]: `%${search}%` } },
          { apellido: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } },
          { codigo_analista: { [Op.iLike]: `%${search}%` } },
        ];
      }

      const { count, rows } = await Analista.findAndCountAll({
        where,
        attributes: { exclude: ["password"] },
        include: [
          {
            model: Role,
            as: 'roles_acceso',
            attributes: ['id', 'nombre', 'prioridad', 'estado'],
            through: { attributes: [] }
          }
        ],
        order: [["fecha_registro", "DESC"]],
        limit: parseInt(limit, 10),
        offset,
      });

      return res.json({
        success: true,
        message: "✅ Lista de analistas",
        data: rows.map((item) => mapAnalistaWithRole(item)),
        pagination: {
          total: count,
          page: parseInt(page, 10),
          totalPages: Math.ceil(count / parseInt(limit, 10)),
          limit: parseInt(limit, 10),
        },
      });
    } catch (error) {
      console.error("❌ Error listarAnalistas:", error);
      return res.status(500).json({
        success: false,
        message: "Error en el servidor",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // ✅ OBTENER ANALISTA POR ID
  async getAnalistaById(req, res) {
    try {
      const { id } = req.params;

      const analista = await Analista.findByPk(id, {
        attributes: { exclude: ["password"] },
        include: [
          {
            model: Role,
            as: 'roles_acceso',
            attributes: ['id', 'nombre', 'prioridad', 'estado'],
            through: { attributes: [] }
          }
        ]
      });

      if (!analista) {
        return res.status(404).json({
          success: false,
          message: "Analista no encontrado",
        });
      }

      return res.json({
        success: true,
        message: "✅ Analista encontrado",
        data: mapAnalistaWithRole(analista),
      });
    } catch (error) {
      console.error("❌ Error getAnalistaById:", error);
      return res.status(500).json({
        success: false,
        message: "Error en el servidor",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // ✅ ACTUALIZAR ANALISTA (solo admin)
  async updateAnalista(req, res) {
    try {
      const { id } = req.params;
      const { nombre, apellido, telefono, rol, estado, password, codigo_analista, departamento } =
        req.body;

      const analista = await Analista.findByPk(id);
      if (!analista) {
        return res.status(404).json({
          success: false,
          message: "Analista no encontrado",
        });
      }

      const updates = {};
      if (nombre !== undefined) updates.nombre = String(nombre).trim();
      if (apellido !== undefined) updates.apellido = String(apellido).trim();
      if (telefono !== undefined) updates.telefono = telefono ? String(telefono).trim() : null;
      if (rol !== undefined) updates.rol = rol;
      if (estado !== undefined) updates.estado = estado;
      if (codigo_analista !== undefined)
        updates.codigo_analista = codigo_analista ? String(codigo_analista).trim() : null;
      if (departamento !== undefined)
        updates.departamento = departamento ? String(departamento).trim() : null;

      if (password) {
        if (String(password).length < 6) {
          return res.status(400).json({
            success: false,
            message: "La contraseña debe tener al menos 6 caracteres",
          });
        }
        updates.password = await bcrypt.hash(String(password), SALT_ROUNDS);
      }

      await analista.update({ ...updates, updated_at: new Date() });

      const actualizado = await Analista.findByPk(id, {
        attributes: { exclude: ["password"] },
      });

      return res.json({
        success: true,
        message: "✅ Analista actualizado exitosamente",
        data: actualizado,
      });
    } catch (error) {
      console.error("❌ Error updateAnalista:", error);
      return res.status(500).json({
        success: false,
        message: "Error en el servidor",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // ✅ DESACTIVAR ANALISTA (soft delete)
  async deleteAnalista(req, res) {
    try {
      const { id } = req.params;

      const analista = await Analista.findByPk(id);
      if (!analista) {
        return res.status(404).json({
          success: false,
          message: "Analista no encontrado",
        });
      }

      await analista.update({
        estado: "INACTIVO",
        updated_at: new Date(),
      });

      return res.json({
        success: true,
        message: "✅ Analista desactivado exitosamente",
      });
    } catch (error) {
      console.error("❌ Error deleteAnalista:", error);
      return res.status(500).json({
        success: false,
        message: "Error en el servidor",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
}

module.exports = new AnalistaController();
