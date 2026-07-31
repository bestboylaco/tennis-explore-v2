import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";

import { env } from "./config/env.js";
import { getMongoDBStatus } from "./infrastructure/database/mongodb.service.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFoundHandler.js";
import { telemetryMiddleware } from "./middleware/telemetry.middleware.js";
import { chatRoutes } from "./modules/chat/index.js";
import { sourceRoutes } from "./modules/sources/index.js";
import { telemetryRoutes } from "./modules/telemetry/index.js";

const app = express();

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);

/*
 * The public folder is outside src.
 * Using an absolute path ensures Express can find it regardless of
 * the directory from which the npm command is executed.
 */
const publicDirectory = path.resolve(currentDirectory, "../public");

app.disable("x-powered-by");

// Global middleware
app.use(cors());
app.use(express.json());

/*
 * Serve index.html, CSS files and browser JavaScript files
 * from the public directory.
 */
app.use(express.static(publicDirectory));

app.use(telemetryMiddleware);

// Health route
app.get("/api/health", (req, res) => {
    const mongodbStatus = getMongoDBStatus();
    const healthy = mongodbStatus === "connected";

    return res.status(healthy ? 200 : 503).json({
        success: healthy,
        data: {
            service: "TennisExplore V2 API",
            status: healthy ? "healthy" : "degraded",
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

// Error handling must remain after all normal routes
app.use(notFoundHandler);
app.use(errorHandler);

export default app;