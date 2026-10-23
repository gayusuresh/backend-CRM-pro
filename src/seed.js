const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { User } = require('./models');

(async () => {
  await mongoose.connect(config.mongoUri);
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@collegesera.com').toLowerCase();
  if (await User.exists({ email })) return console.log('Admin already exists');
  await User.create({
    name: "Admin",
    email,
    role: "admin",
    passwordHash: await bcrypt.hash(
      process.env.SEED_ADMIN_PASSWORD || "Admin12345678",
      12,
    ),
  });
  console.log(`Created admin ${email}. Change the password after first login.`);
  await mongoose.disconnect();
})();
