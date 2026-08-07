import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import cors from "cors";

import { env } from "./config/env.js";
import { getMongoDBStatus } from "./infrastructure/database/mongodb.service.js";

import { notFoundHandler } from "./middleware/notFoundHandler.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { telemetryMiddleware } from "./middleware/telemetry.middleware.js";

import { sourceRoutes } from "./modules/sources/index.js";
import { telemetryRoutes } from "./modules/telemetry/index.js";
import { chatRoutes } from "./modules/chat/index.js";

import aiRoutes from "./modules/ai/index.js";
import retrievalRoutes from "./modules/retrieval/retrieval.routes.js";

import { initializeOrchestration } from "./modules/orchestration/index.js";

initializeOrchestration();

const app = express();

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);

/*
 * The frontend files live outside src, so an absolute path is used.
 * This prevents the static directory from depending on where npm is run.
 */

const publicDirectory = path.resolve(currentDirectory, "../public");

app.disable("x-powered-by");

// Global middleware
app.use(cors());
app.use(express.json());
app.use(express.static(publicDirectory));
app.use(telemetryMiddleware);

// Health route
app.get("/api/health", (req, res) => {
  const mongodbStatus = getMongoDBStatus();

  const healthy = mongodbStatus === "connected";

  return res
    .status(healthy ? 200 : 503)
    .json({
      success: healthy,

      data: {
        service: "TennisExplore V2 API",

        status: healthy
          ? "healthy"
          : "degraded",

        environment: env.nodeEnv,

        dependencies: {
          mongodb: mongodbStatus,
        },

        timestamp: new Date().toISOString(),
      },
    });
});

// Application routes
app.use("/api/chat", chatRoutes);
app.use("/api/sources", sourceRoutes);
app.use("/api/telemetry", telemetryRoutes);
app.use("/api/retrieval", retrievalRoutes);
app.use("/api/ai", aiRoutes);

// Error handling must come last
app.use(notFoundHandler);
app.use(errorHandler);

export default app;