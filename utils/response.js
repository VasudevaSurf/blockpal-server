const { logger } = require("./logger");

class ResponseUtil {
  static success(res, data = null, message = "Success", statusCode = 200) {
    const response = {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    logger.info(`Success response: ${statusCode}`, {
      message,
      dataType: data ? typeof data : null,
    });

    return res.status(statusCode).json(response);
  }

  static error(
    res,
    message = "Internal Server Error",
    statusCode = 500,
    errors = null
  ) {
    const response = {
      success: false,
      message,
      ...(errors && { errors }),
      timestamp: new Date().toISOString(),
    };

    logger.error(`Error response: ${statusCode}`, { message, errors });

    return res.status(statusCode).json(response);
  }

  static validation(res, errors) {
    return this.error(res, "Validation failed", 400, errors);
  }

  static notFound(res, message = "Resource not found") {
    return this.error(res, message, 404);
  }

  static unauthorized(res, message = "Unauthorized access") {
    return this.error(res, message, 401);
  }

  static forbidden(res, message = "Access forbidden") {
    return this.error(res, message, 403);
  }

  static serverError(res, message = "Internal server error") {
    return this.error(res, message, 500);
  }

  static created(res, data = null, message = "Created successfully") {
    return this.success(res, data, message, 201);
  }

  static updated(res, data = null, message = "Updated successfully") {
    return this.success(res, data, message, 200);
  }

  static deleted(res, message = "Deleted successfully") {
    return this.success(res, null, message, 200);
  }

  static paginated(
    res,
    data,
    pagination,
    message = "Data retrieved successfully"
  ) {
    const response = {
      success: true,
      message,
      data,
      pagination,
      timestamp: new Date().toISOString(),
    };

    logger.info("Paginated response", {
      message,
      itemCount: data ? data.length : 0,
      pagination,
    });

    return res.status(200).json(response);
  }
}

module.exports = ResponseUtil;
