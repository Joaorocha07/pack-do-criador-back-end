const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ALLOWED_IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp"
};

function storageRoot() {
  return path.resolve(process.env.STICKER_STORAGE_DIR || path.join(process.cwd(), ".private", "stickers"));
}

function stickerImageUrl(imageId) {
  return `/stickers/images/${imageId}`;
}

function stickerDownloadUrl(imageId) {
  return `/stickers/images/${imageId}/download`;
}

function safeContentDisposition(type, originalName) {
  const fallbackName = String(originalName || "sticker")
    .replace(/[\\/\r\n"]/g, "_")
    .slice(0, 180);

  return `${type}; filename="${fallbackName}"`;
}

function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: "png", mimeType: ALLOWED_IMAGE_TYPES.png };
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: "jpg", mimeType: ALLOWED_IMAGE_TYPES.jpg };
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: "webp", mimeType: ALLOWED_IMAGE_TYPES.webp };
  }

  return null;
}

function assertAllowedImage(file, maxBytes) {
  if (!file?.buffer?.length) {
    throw new Error("Arquivo vazio ou invalido.");
  }

  if (file.buffer.length > maxBytes) {
    throw new Error(`Arquivo ${file.originalName || ""} excede o limite de ${Math.round(maxBytes / 1024 / 1024)}MB.`);
  }

  if (!Object.values(ALLOWED_IMAGE_TYPES).includes(file.mimeType)) {
    throw new Error("Envie apenas imagens PNG, JPG, JPEG ou WEBP.");
  }

  const detected = detectImageType(file.buffer);

  if (!detected || detected.mimeType !== file.mimeType) {
    throw new Error("Assinatura do arquivo nao corresponde ao tipo de imagem informado.");
  }

  return detected;
}

async function saveStickerFile({ categoryId, originalName, buffer, extension }) {
  const filename = `${crypto.randomUUID()}.${extension}`;
  const storageKey = path.posix.join("categories", categoryId, filename);
  const targetDir = path.join(storageRoot(), "categories", categoryId);
  const targetPath = path.join(targetDir, filename);

  await fs.promises.mkdir(targetDir, { recursive: true });
  await fs.promises.writeFile(targetPath, buffer, { flag: "wx" });

  return {
    filename,
    originalName,
    storageKey,
    size: buffer.length
  };
}

function resolveStoragePath(storageKey) {
  const root = storageRoot();
  const resolved = path.resolve(root, storageKey);

  if (!resolved.startsWith(root + path.sep)) {
    throw new Error("Caminho de arquivo invalido.");
  }

  return resolved;
}

module.exports = {
  assertAllowedImage,
  resolveStoragePath,
  safeContentDisposition,
  saveStickerFile,
  stickerDownloadUrl,
  stickerImageUrl
};
