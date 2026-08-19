import dotenv from "dotenv";

dotenv.config();

const requiredVariables = ["PORT", "MONGODB_URI"];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`Missing required environment variable: ${variable}`);
  }
}

const port = Number(process.env.PORT);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.");
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port,
  mongodbUri: process.env.MONGODB_URI,

  // T-08: cors() was previously called with no origin at all, allowing any
  // page in any browser to call this API. The frontend is same-origin (it is
  // served by this same Express app), so the only legitimate caller is this
  // origin unless a deployment explicitly names another one.
  allowedOrigin: process.env.ALLOWED_ORIGIN || `http://localhost:${port}`,
});