const { logError } = require("./error-logging");

const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 60 * 1000; // 60 seconds
const RECOVERY_TIMEOUT_MS = 30 * 1000; // 30 seconds
const BACKOFFS_MS = [100, 300, 900];
const MAX_ATTEMPTS = 3;

function shouldRetry(error) {
  // Don't retry 404 / 403 / validation errors — they won't change on retry
  if (error.name === "NoSuchKey" || error.name === "NotFound") return false;
  if (error.$metadata?.httpStatusCode === 404) return false;
  if (error.$metadata?.httpStatusCode === 403) return false;

  // Retry timeouts, network errors, and 5xx responses
  return true;
}

async function retryWithBackoff(operation, maxAttempts = MAX_ATTEMPTS) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts - 1;

      if (isLastAttempt || !shouldRetry(error)) {
        throw error;
      }

      const delay = BACKOFFS_MS[attempt];
      console.warn("[r2-resilience] Tentativa falhou, aguardando antes de tentar novamente.", {
        attempt: attempt + 1,
        maxAttempts,
        delayMs: delay,
        errorName: error.name,
        errorMessage: error.message
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

class R2CircuitBreaker {
  constructor() {
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = "CLOSED"; // CLOSED, OPEN, HALF_OPEN
  }

  async execute(operation) {
    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTime;

      if (elapsed > RECOVERY_TIMEOUT_MS) {
        console.log("[r2-resilience] Circuit breaker transitioning OPEN → HALF_OPEN.");
        this.state = "HALF_OPEN";
      } else {
        throw new Error("Circuit breaker is OPEN - R2 service unavailable");
      }
    }

    try {
      const result = await retryWithBackoff(operation);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  onSuccess() {
    if (this.state !== "CLOSED") {
      console.log("[r2-resilience] Circuit breaker transitioning → CLOSED (R2 recovered).", {
        previousState: this.state
      });
    }

    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = "CLOSED";
  }

  onFailure(error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= FAILURE_THRESHOLD && this.state !== "OPEN") {
      console.error("[r2-resilience] Circuit breaker transitioning → OPEN (falhas consecutivas no R2).", {
        failureCount: this.failureCount,
        windowMs: FAILURE_WINDOW_MS,
        errorName: error?.name,
        errorMessage: error?.message
      });
      this.state = "OPEN";
    } else {
      logError("[r2-resilience] Falha registrada no R2.", error, {
        failureCount: this.failureCount,
        state: this.state
      });
    }

    // Reset failure count if the last failure was outside the tracking window
    // so stale failures don't keep the breaker open forever
    if (this.lastFailureTime && Date.now() - this.lastFailureTime > FAILURE_WINDOW_MS) {
      this.failureCount = 1;
    }
  }
}

const r2CircuitBreaker = new R2CircuitBreaker();

module.exports = { r2CircuitBreaker, retryWithBackoff, shouldRetry };
