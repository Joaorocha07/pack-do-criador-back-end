const bcrypt = require("bcryptjs");
const crypto = require("crypto");

function generateTemporaryPassword() {
  return crypto.randomBytes(9).toString("base64url");
}

function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = {
  comparePassword,
  generateTemporaryPassword,
  hashPassword
};
