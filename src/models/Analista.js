// src/models/Analista.js
const { DataTypes } = require("sequelize");
const bcrypt = require("bcrypt");
const sequelize = require("../config/database"); // ajusta si tu ruta es distinta

const SALT_ROUNDS = 10;

// Helper: detectar si ya está hasheado con bcrypt
function looksLikeBcryptHash(value) {
  return typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);
}

const Analista = sequelize.define(
  "Analista",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    fecha_registro: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
    },
    nombre: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    apellido: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    telefono: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
      set(value) {
        // Normaliza email a minúsculas, sin espacios
        this.setDataValue("email", String(value || "").trim().toLowerCase());
      },
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
      // No devolver password por defecto en JSON
      get() {
        return this.getDataValue("password");
      },
    },
    rol: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "ANALISTA",
    },
    estado: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "ACTIVO",
    },
    ultimo_acceso: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    force_password_change: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    password_reset_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    codigo_analista: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    departamento: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "analistas",
    timestamps: false, // porque manejas created_at/updated_at manual
    underscored: true,
    hooks: {
      // ✅ Hash al crear
      beforeCreate: async (analista) => {
        // created/updated por si no vienen
        if (!analista.created_at) analista.created_at = new Date();
        analista.updated_at = new Date();
        if (!analista.fecha_registro) analista.fecha_registro = new Date();

        if (analista.password && !looksLikeBcryptHash(analista.password)) {
          analista.password = await bcrypt.hash(String(analista.password), SALT_ROUNDS);
        }
      },

      // ✅ Hash al actualizar SOLO si cambió password
      beforeUpdate: async (analista) => {
        analista.updated_at = new Date();

        if (analista.changed("password")) {
          const newPass = analista.password;

          // Evita doble hash si ya viene hasheado
          if (newPass && !looksLikeBcryptHash(newPass)) {
            analista.password = await bcrypt.hash(String(newPass), SALT_ROUNDS);
          }
        }
      },
    },
    defaultScope: {
      // ✅ Por defecto nunca retornes password en queries normales
      attributes: { exclude: ["password"] },
    },
    scopes: {
      // Si en login necesitas password:
      withPassword: {
        attributes: { include: ["password"] },
      },
    },
  }
);

// Opcional: método para comparar password (útil en controllers)
Analista.prototype.validPassword = function validPassword(plainPassword) {
  return bcrypt.compare(String(plainPassword), this.password);
};

module.exports = Analista;
