function parseContentType(contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  return boundary?.[1] || boundary?.[2] || null;
}

function parseHeaders(headerText) {
  return headerText.split("\r\n").reduce((headers, line) => {
    const separator = line.indexOf(":");

    if (separator === -1) {
      return headers;
    }

    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    return headers;
  }, {});
}

function parseDisposition(disposition) {
  const result = {};

  for (const part of String(disposition || "").split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    const key = rawKey.trim();
    const value = rawValue.join("=").trim().replace(/^"|"$/g, "");

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

function splitMultipart(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = buffer.indexOf(delimiter);

  while (cursor !== -1) {
    let start = cursor + delimiter.length;

    if (buffer.subarray(start, start + 2).toString() === "--") {
      break;
    }

    if (buffer.subarray(start, start + 2).toString() === "\r\n") {
      start += 2;
    }

    const next = buffer.indexOf(delimiter, start);

    if (next === -1) {
      break;
    }

    let end = next;

    if (buffer.subarray(end - 2, end).toString() === "\r\n") {
      end -= 2;
    }

    parts.push(buffer.subarray(start, end));
    cursor = next;
  }

  return parts;
}

function parseMultipartFiles({ fieldName = "files", maxTotalBytes }) {
  return async function multipartFiles(req, res, next) {
    const boundary = parseContentType(req.headers["content-type"]);

    if (!boundary) {
      return res.status(400).json({ error: "Envie multipart/form-data com o campo files." });
    }

    const chunks = [];
    let received = 0;
    let tooLarge = false;

    req.on("data", (chunk) => {
      received += chunk.length;

      if (received > maxTotalBytes) {
        tooLarge = true;
        return;
      }

      chunks.push(chunk);
    });

    req.on("error", (error) => {
      if (error.message.includes("limite")) {
        return res.status(413).json({ error: error.message });
      }

      return next(error);
    });

    req.on("end", () => {
      try {
        if (tooLarge) {
          const maxMb = Math.floor(maxTotalBytes / 1024 / 1024);
          return res.status(413).json({
            error: `Upload excede o limite total permitido de ${maxMb}MB. Envie menos arquivos por vez.`
          });
        }

        const files = [];
        const body = Buffer.concat(chunks);

        for (const part of splitMultipart(body, boundary)) {
          const separator = part.indexOf(Buffer.from("\r\n\r\n"));

          if (separator === -1) {
            continue;
          }

          const headers = parseHeaders(part.subarray(0, separator).toString("utf8"));
          const disposition = parseDisposition(headers["content-disposition"]);

          if (disposition.name !== fieldName || !disposition.filename) {
            continue;
          }

          files.push({
            fieldName: disposition.name,
            originalName: disposition.filename,
            mimeType: headers["content-type"],
            buffer: part.subarray(separator + 4)
          });
        }

        req.files = files;
        return next();
      } catch (error) {
        return next(error);
      }
    });
  };
}

module.exports = { parseMultipartFiles };
