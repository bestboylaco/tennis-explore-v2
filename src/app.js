import express from "express";
import cors from "cors";

import { env } from "./config/env.js";
import { getMongoDBStatus } from "./infrastructure/database/mongodb.service.js";
import { notFoundHandler } from "./middleware/notFoundHandler.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { sourceRoutes } from "./modules/sources/index.js";

const app = express();

app.disable("x-powered-by");

// Global middleware
app.use(cors());
app.use(express.json());

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
app.use("/api/sources", sourceRoutes);

// Error handling must come last
app.use(notFoundHandler);
app.use(errorHandler);

export default app;