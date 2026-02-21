const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Permiso = sequelize.define(
  'Permiso',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    codigo: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: true
    },
    modulo: {
      type: DataTypes.STRING(80),
      allowNull: false
    },
    categoria: {
      type: DataTypes.STRING(80),
      allowNull: true
    },
    nombre: {
      type: DataTypes.STRING(120),
      allowNull: false
    },
    descripcion: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: 'permisos',
    timestamps: false,
    underscored: true,
    hooks: {
      beforeCreate: (permiso) => {
        permiso.created_at = permiso.created_at || new Date();
        permiso.updated_at = new Date();
      },
      beforeUpdate: (permiso) => {
        permiso.updated_at = new Date();
      }
    }
  }
);

module.exports = Permiso;
