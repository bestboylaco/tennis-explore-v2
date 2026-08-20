import dotenv from "dotenv";

dotenv.config();

const requiredVariables = [
  "PORT",
  "MONGODB_URI",
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(
      `Missing required environment variable: ${variable}`
    );
  }
}

const port =
  Number(process.env.PORT);

if (
  !Number.isInteger(port) ||
  port <= 0
) {
  throw new Error(
    "PORT must be a positive integer."
  );
}

const structuredSourceDirs =
  (process.env.STRUCTURED_SOURCE_DIRS || "")
    .split(";")
    .map(
      (directory) =>
        directory.trim()
    )
    .filter(Boolean);


export const env =
  Object.freeze({
    nodeEnv:
      process.env.NODE_ENV ||
      "development",

    port,

    mongodbUri:
      process.env.MONGODB_URI,

    structuredSourceDirs,
  });