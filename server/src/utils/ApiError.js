/**
 * Every error the API returns is shaped `{ error: { code, message } }`.
 * Clients branch on `code`; `message` is display copy. See PROJECT_INSTRUCTIONS.md §5.1.
 */
class ApiError extends Error {
  constructor(status, code, message, fields = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.expected = true;
  }

  static badRequest(message, code = 'BAD_REQUEST', fields = null) {
    return new ApiError(400, code, message, fields);
  }

  static unauthorized(message = 'You need to sign in to do that.', code = 'NOT_AUTHENTICATED') {
    return new ApiError(401, code, message);
  }

  static forbidden(message = 'You do not have access to that.', code = 'FORBIDDEN') {
    return new ApiError(403, code, message);
  }

  /** A charge the gateway refused. The checkout page routes on this code. */
  static paymentDeclined(message, code = 'PAYMENT_DECLINED') {
    return new ApiError(402, code, message);
  }

  static notFound(message = 'Not found.', code = 'NOT_FOUND') {
    return new ApiError(404, code, message);
  }

  static conflict(message, code = 'CONFLICT') {
    return new ApiError(409, code, message);
  }

  /**
   * The request was fine; this installation cannot serve it right now.
   *
   * Distinct from a 500 on purpose: nothing crashed and there is no stack to
   * read. It is what a request gets when it cannot be matched to a business -
   * an unknown host, or an installation with no default - where the honest
   * answer is "not configured for you" rather than an empty result set that
   * reads as "no matches".
   */
  static serviceUnavailable(message, code = 'SERVICE_UNAVAILABLE') {
    return new ApiError(503, code, message);
  }
}

/** Wraps an async route handler so rejections reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export { ApiError, asyncHandler };
export default ApiError;
