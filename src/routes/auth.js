const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { User } = require('../models');
const { jwtSecret } = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const audit = require('../utils/audit');

const loginLimiter = rateLimit({ windowMs: 15 * 60e3, limit: 20, standardHeaders: true, legacyHeaders: false });

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (email !== adminEmail || password !== adminPassword) {
    return res.status(401).json({
      error: "Email or password is incorrect",
    });
  }

  const payload = {
    id: "admin",
    email: adminEmail,
    name: "Admin",
    role: "admin",
  };

  const token = jwt.sign(payload, jwtSecret, {
    expiresIn: "8h",
  });

  return res.json({
    token,
    user: payload,
  });
});



router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// ---- User management (admin only) ----
const users = require('express').Router();
users.use(requireAuth, requireRole('admin'));

users.get('/', async (_req, res) => res.json(await User.find().select('-passwordHash').sort({ createdAt: 1 })));

users.post('/', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!email || !password || password.length < 10) return res.status(400).json({ error: 'Email and a password of at least 10 characters are required' });
  const u = await User.create({ name, email, role, passwordHash: await bcrypt.hash(password, 12) });
  audit(req, 'user.create', 'User', u.id, { email, role });
  res.status(201).json({ id: u.id });
});

users.put('/:id', async (req, res) => {
  const patch = {};
  for (const k of ['name', 'role', 'active']) if (req.body[k] !== undefined) patch[k] = req.body[k];
  if (req.body.password) patch.passwordHash = await bcrypt.hash(req.body.password, 12);
  await User.updateOne({ _id: req.params.id }, patch);
  audit(req, 'user.update', 'User', req.params.id, { fields: Object.keys(patch) });
  res.json({ ok: true });
});

module.exports = { auth: router, users };
