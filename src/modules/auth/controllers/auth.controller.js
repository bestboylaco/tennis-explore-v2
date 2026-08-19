import { authenticate } from "../services/auth.service.js";

export async function loginController(req, res) {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Email and password are required.",
      },
    });
  }

  // authenticate() throws InvalidCredentialsError (401) on any mismatch;
  // asyncHandler forwards it to errorHandler, which reads statusCode/code
  // off the error rather than this controller needing its own catch.
  const user = await authenticate(email, password);

  // Regenerating the session id on login (not just setting session.user on
  // the existing one) is what stops session fixation: a session id issued
  // before login must not become a valid, authenticated session after it.
  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });

  req.session.user = user.toSafeJSON();

  return res.status(200).json({
    success: true,
    data: req.session.user,
  });
}

export async function logoutController(req, res) {
  await new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });

  res.clearCookie("connect.sid");

  return res.status(200).json({ success: true, data: null });
}

export function getCurrentUserController(req, res) {
  if (!req.session?.user) {
    return res.status(200).json({ success: true, data: null });
  }

  return res.status(200).json({ success: true, data: req.session.user });
}
