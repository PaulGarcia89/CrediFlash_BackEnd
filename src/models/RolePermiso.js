const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RolePermiso = sequelize.define(
  'RolePermiso',
  {
    role_id: {
      type: DataTypes.UUID,
      allowNull: false,
      primaryKey: true
    },
    permiso_id: {
      type: DataTypes.UUID,
      allowNull: false,
      primaryKey: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: 'role_permisos',
    timestamps: false,
    underscored: true
  }
);

module.exports = RolePermiso;
