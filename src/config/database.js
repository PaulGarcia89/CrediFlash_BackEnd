// src/config/database.js
require('dotenv').config();
const { Sequelize } = require('sequelize');

const environment = process.env.NODE_ENV || 'development';
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const databaseUrlRequiresSsl = hasDatabaseUrl && /sslmode=require/i.test(process.env.DATABASE_URL);
const forceSsl = process.env.DB_SSL === 'true';
const shouldUseSsl = environment === 'production' || databaseUrlRequiresSsl || forceSsl;

const commonConfig = {
  dialect: 'postgres',
  logging: environment === 'development' ? console.log : false,
  retry: {
    max: 5
  },
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
};

const sslConfig = shouldUseSsl
  ? {
      ssl: {
        require: true,
        rejectUnauthorized: false
      },
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      }
    }
  : {};

let sequelize;

if (hasDatabaseUrl) {
  const parsedUrl = new URL(process.env.DATABASE_URL);
  const dbName = parsedUrl.pathname.replace('/', '');
  const dbUser = decodeURIComponent(parsedUrl.username || '');
  const dbPassword = decodeURIComponent(parsedUrl.password || '');
  const dbHost = parsedUrl.hostname;
  const dbPort = parseInt(parsedUrl.port || 5432);

  sequelize = new Sequelize(
    dbName,
    dbUser,
    dbPassword,
    {
      host: dbHost,
      port: dbPort,
      ...commonConfig,
      ...sslConfig
    }
  );
} else {
  sequelize = new Sequelize(
      process.env.DB_NAME || 'crediflash',
      process.env.DB_USER || 'postgres',
      process.env.DB_PASSWORD || process.env.DB_PASS || 'postgres',
      {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || 5432),
        ...commonConfig,
        ...sslConfig
      }
    );
}

module.exports = sequelize;
