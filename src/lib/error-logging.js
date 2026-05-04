function serializeError(error) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  return {
    name: error.name,
    message: error.message,
    code: error.code,
    clientVersion: error.clientVersion,
    meta: error.meta,
    stack: error.stack ? error.stack.split("\n").slice(0, 8).join("\n") : undefined
  };
}

function logError(scope, error, extra = {}) {
  const serialized = serializeError(error);

  console.error(scope, {
    ...extra,
    name: serialized.name,
    message: serialized.message,
    code: serialized.code,
    clientVersion: serialized.clientVersion,
    meta: serialized.meta,
    stack: serialized.stack
  });
}

module.exports = {
  logError,
  serializeError
};
