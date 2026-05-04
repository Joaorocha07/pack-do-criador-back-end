const Layer = require("express/lib/router/layer");

const originalHandleRequest = Layer.prototype.handle_request;

Layer.prototype.handle_request = function handleRequest(req, res, next) {
  const fn = this.handle;

  if (fn.length > 3) {
    return originalHandleRequest.call(this, req, res, next);
  }

  try {
    const result = fn(req, res, next);

    if (result && typeof result.catch === "function") {
      result.catch(next);
    }
  } catch (error) {
    next(error);
  }
};
