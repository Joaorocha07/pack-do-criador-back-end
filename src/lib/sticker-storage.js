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

function storageDriver() {
  return String(process.env.STICKER_STORAGE_DRIVER || "local").trim().toLowerCase();
}

function storageProviderName() {
  return storageDriver() === "r2" ? "cloudflare-r2" : "local";
}

let r2Client;
let r2Commands;

function getR2Commands() {
  if (!r2Commands) {
    r2Commands = require("@aws-sdk/client-s3");
  }

  return r2Commands;
}

function getR2Client() {
  if (r2Client) {
    return r2Client;
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;

  if (!accountId && !process.env.R2_ENDPOINT) {
    throw new Error("Configure R2_ACCOUNT_ID ou R2_ENDPOINT para usar Cloudflare R2.");
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Configure R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY para usar Cloudflare R2.");
  }

  const { S3Client } = getR2Commands();

  r2Client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });

  return r2Client;
}

function r2Bucket() {
  if (!process.env.R2_BUCKET) {
    throw new Error("Configure R2_BUCKET para usar Cloudflare R2.");
  }

  return process.env.R2_BUCKET;
}

function stickerImageUrl(imageId) {
  return `/stickers/images/${imageId}`;
}

function stickerDownloadUrl(imageId) {
  return `/stickers/images/${imageId}/download`;
}

function stickerDeliveryMode() {
  return String(process.env.STICKER_DELIVERY_MODE || "proxy").trim().toLowerCase();
}

function encodeStorageKey(storageKey) {
  return String(storageKey || "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function publicStickerFileUrl(storageKey) {
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");

  if (!publicBaseUrl || !storageKey) {
    return null;
  }

  return `${publicBaseUrl}/${encodeStorageKey(storageKey)}`;
}

function shouldRedirectStickerDelivery() {
  return storageDriver() === "r2" && stickerDeliveryMode() === "redirect";
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

async function saveStickerFile({ categoryId, originalName, buffer, extension, mimeType }) {
  const filename = `${crypto.randomUUID()}.${extension}`;
  const storageKey = path.posix.join("categories", categoryId, filename);

  if (storageDriver() === "r2") {
    const { PutObjectCommand } = getR2Commands();

    await getR2Client().send(
      new PutObjectCommand({
        Bucket: r2Bucket(),
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType
      })
    );

    return {
      filename,
      originalName,
      storageKey,
      size: buffer.length
    };
  }

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

async function getStickerFile(storageKey) {
  if (storageDriver() === "r2") {
    const { GetObjectCommand } = getR2Commands();

    try {
      const object = await getR2Client().send(
        new GetObjectCommand({
          Bucket: r2Bucket(),
          Key: storageKey
        })
      );

      return {
        stream: object.Body,
        contentLength: object.ContentLength
      };
    } catch (error) {
      if (["NoSuchKey", "NotFound"].includes(error.name)) {
        return null;
      }

      throw error;
    }
  }

  const filePath = resolveStoragePath(storageKey);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return {
    stream: fs.createReadStream(filePath),
    contentLength: fs.statSync(filePath).size
  };
}

async function deleteStickerFile(storageKey) {
  if (storageDriver() === "r2") {
    const { DeleteObjectCommand } = getR2Commands();

    await getR2Client().send(
      new DeleteObjectCommand({
        Bucket: r2Bucket(),
        Key: storageKey
      })
    );
    return;
  }

  await fs.promises.unlink(resolveStoragePath(storageKey));
}

async function getStorageUsageFromProvider() {
  if (storageDriver() === "r2") {
    const { ListObjectsV2Command } = getR2Commands();
    let continuationToken;
    let totalBytes = 0;
    let totalObjects = 0;

    do {
      const result = await getR2Client().send(
        new ListObjectsV2Command({
          Bucket: r2Bucket(),
          ContinuationToken: continuationToken
        })
      );

      for (const object of result.Contents || []) {
        totalBytes += object.Size || 0;
        totalObjects += 1;
      }

      continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
    } while (continuationToken);

    return {
      source: storageProviderName(),
      totalBytes,
      totalObjects
    };
  }

  return {
    source: storageProviderName(),
    totalBytes: null,
    totalObjects: null
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
  deleteStickerFile,
  getStorageUsageFromProvider,
  getStickerFile,
  publicStickerFileUrl,
  shouldRedirectStickerDelivery,
  storageProviderName,
  resolveStoragePath,
  safeContentDisposition,
  saveStickerFile,
  stickerDownloadUrl,
  stickerImageUrl
};
