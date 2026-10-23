require('dotenv').config();

const required = (k) => {
  if (!process.env[k]) throw new Error(`Missing env var ${k}`);
  return process.env[k];
};

const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri:
    process.env.MONGO_URI ||
    "mongodb+srv://gayathrim_db_user:root@cluster0.r7jhteo.mongodb.net/",
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  jwtSecret: required("JWT_SECRET"),
  ingestKeys: required("INGEST_API_KEYS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  encryptionKey: required("ENCRYPTION_KEY"),
  //corsOrigin: process.env.CORS_ORIGIN,
  //corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY || 10),
  runWorkerInApi: process.env.RUN_WORKER_IN_API === "true",
  logTtlDays: Number(process.env.LOG_TTL_DAYS || 90),
};

if (!/^[0-9a-fA-F]{64}$/.test(config.encryptionKey)) {
  throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
}

module.exports = config;
