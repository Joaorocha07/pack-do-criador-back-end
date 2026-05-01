const { PrismaClient } = require("@prisma/client");
const { logError } = require("./error-logging");

const prisma = new PrismaClient();

async function connectPrisma({ retries = 3, delayMs = 1500 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await prisma.$connect();
      console.log("[prisma] Banco conectado.");
      return;
    } catch (error) {
      logError("[prisma] Falha ao conectar no banco.", error, { attempt, retries });

      if (attempt === retries) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = prisma;
module.exports.connectPrisma = connectPrisma;
