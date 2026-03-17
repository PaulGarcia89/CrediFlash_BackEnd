const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ClienteEmailVerificacion = sequelize.define(
  'ClienteEmailVerificacion',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING(150),
      allowNull: false,
      unique: true
    },
    codigo_hash: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    intentos: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    max_intentos: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5
    },
    verified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    verified_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    send_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    last_sent_at: {
      type: DataTypes.DATE,
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
    tableName: 'clientes_email_verificaciones',
    timestamps: false
  }
);

module.exports = ClienteEmailVerificacion;
