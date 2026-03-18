const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  analista_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  analista_nombre: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  analista_email: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  rol_nombre: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  modulo: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  accion: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  entidad: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  entidad_id: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  metodo_http: {
    type: DataTypes.STRING(10),
    allowNull: true
  },
  endpoint: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  status_code: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  resultado: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'SUCCESS'
  },
  ip: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  user_agent: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  request_id: {
    type: DataTypes.STRING(120),
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'audit_logs',
  timestamps: false,
  indexes: [
    { fields: [{ name: 'created_at', order: 'DESC' }], name: 'idx_audit_logs_created_at' },
    { fields: ['analista_id'], name: 'idx_audit_logs_analista_id' },
    { fields: ['modulo'], name: 'idx_audit_logs_modulo' },
    { fields: ['entidad', 'entidad_id'], name: 'idx_audit_logs_entidad' },
    { fields: ['resultado'], name: 'idx_audit_logs_resultado' }
  ]
});

module.exports = AuditLog;
