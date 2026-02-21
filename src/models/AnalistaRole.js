const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AnalistaRole = sequelize.define(
  'AnalistaRole',
  {
    analista_id: {
      type: DataTypes.UUID,
      allowNull: false,
      primaryKey: true
    },
    role_id: {
      type: DataTypes.UUID,
      allowNull: false
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
    tableName: 'analista_roles',
    timestamps: false,
    underscored: true,
    hooks: {
      beforeCreate: (item) => {
        item.created_at = item.created_at || new Date();
        item.updated_at = new Date();
      },
      beforeUpdate: (item) => {
        item.updated_at = new Date();
      }
    }
  }
);

module.exports = AnalistaRole;
