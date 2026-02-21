const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Role = sequelize.define(
  'Role',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    nombre: {
      type: DataTypes.STRING(80),
      allowNull: false,
      unique: true
    },
    prioridad: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 100
    },
    estado: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'ACTIVO'
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
    tableName: 'roles',
    timestamps: false,
    underscored: true,
    hooks: {
      beforeCreate: (role) => {
        role.created_at = role.created_at || new Date();
        role.updated_at = new Date();
      },
      beforeUpdate: (role) => {
        role.updated_at = new Date();
      }
    }
  }
);

module.exports = Role;
