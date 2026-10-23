const crypto = require('crypto');
const { encryptionKey } = require('../config');

const key = Buffer.from(encryptionKey, 'hex');

// AES-256-GCM. Stored as iv.tag.ciphertext (base64 segments).
exports.encrypt = (plain) => {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
};

exports.decrypt = (payload) => {
  if (!payload) return '';
  const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
};
