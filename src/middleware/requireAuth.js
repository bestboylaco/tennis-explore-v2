// Gates any route that must run as a real, signed-in account rather than a
// caller-declared role (threat model T-01). session.user is set at login
// (auth.controller.js) and cleared at logout; nothing else may write it.
export function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      success: false,
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Sign in to continue.",
      },
    });
  }

  req.user = req.session.user;

  return next();
}

// Narrower than requireAuth: signed in AND holding one of the listed roles.
// Always mount after requireAuth, which is what populates req.user.
export function requireRole(...allowedRoleIds) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Sign in to continue.",
        },
      });
    }

    if (!allowedRoleIds.includes(req.user.roleId)) {
      return res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Your role does not have access to this resource.",
        },
      });
    }

    return next();
  };
}
