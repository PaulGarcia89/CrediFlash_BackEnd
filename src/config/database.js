// src/config/database.js
require('dotenv').config();
const { Sequelize } = require('sequelize');

const environment = process.env.NODE_ENV || 'development';

const sequelize = new Sequelize(
  process.env.DB_NAME || 'crediflash',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'postgres',
  {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || 5432),
    dialect: 'postgres',
    logging: environment === 'development' ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: false,
      underscored: true,
      freezeTableName: true
    }
  }
);

module.exports = sequelize;