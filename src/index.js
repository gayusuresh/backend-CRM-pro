const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const config = require("./config");

const { auth, users } = require("./routes/auth");
const { routing, mappings } = require("./routes/config");

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors());
//app.use(cors({ origin: config.corsOrigin, credentials: false }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Incoming CollegeSera API (API-key auth, its own rate limit)
app.use("/api/v1/leads", require("./routes/ingest"));

// Admin panel API (JWT auth)
app.use(
  "/api",
  rateLimit({
    windowMs: 60e3,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use("/api/auth", auth);
app.use("/api/users", users);
app.use("/api/clients", require("./routes/clients"));
app.use("/api/routing", routing);
app.use("/api/mappings", mappings);
app.use("/api", require("./routes/leads"));

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error(err); // never log request bodies here: they may contain student PII
  res.status(500).json({ error: "Something went wrong on our side" });
});

mongoose
  .connect(config.mongoUri)
  .then(() => {
    app.listen(config.port, () =>
      console.log(`API listening on :${config.port}`),
    );
    if (config.runWorkerInApi) require("./worker").startWorker();
  })
  .catch((e) => {
    console.error("Mongo connection failed", e.message);
    process.exit(1);
  });

module.exports = app;
