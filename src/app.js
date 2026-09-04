import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import cors from "cors";
import session from "express-session";
import MongoStore from "connect-mongo";
import agentRoutes from "./modules/agent/agent.routes.js";

import { env } from "./config/env.js";
import { authConfig } from "./modules/auth/auth.config.js";
import User from "./modules/auth/models/user.model.js";
import { getMongoDBStatus } from "./infrastructure/database/mongodb.service.js";
import { notFoundHandler } from "./middleware/notFoundHandler.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireAuth, requireRole } from "./middleware/requireAuth.js";
import { telemetryMiddleware } from "./middleware/telemetry.middleware.js";
import { sourceRoutes } from "./modules/sources/index.js";
import { telemetryRoutes } from "./modules/telemetry/index.js";
import { chatRoutes } from "./modules/chat/index.js";
import { conversationRoutes } from "./modules/conversations/index.js";
import { quickQuestionRoutes } from "./modules/quickquestion/index.js";
import assetRoutes from "./modules/assets/asset.routes.js";
import auditRoutes from "./modules/audit/routes/audit.routes.js";
import authRoutes from "./modules/auth/routes/auth.routes.js";

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
// T-08: restricted to env.allowedOrigin rather than every origin -- see its
// definition in config/env.js for why the default is safe unchanged.
app.use(cors({ origin: env.allowedOrigin }));
app.use(express.json());

// Sessions back onto the same MongoDB Atlas cluster everything else uses, so
// there is no second datastore to run or fail independently. A session
// becomes req.session.user only at login (auth.controller.js) -- nothing
// upstream of that point is trusted with a role (threat model T-01).
app.use(
  session({
    secret: authConfig.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: env.mongodbUri }),
    cookie: {
      httpOnly: true,
      maxAge: authConfig.sessionMaxAgeMs,
      sameSite: "lax",
      // Secure cookies require HTTPS; the demo runs over plain HTTP locally.
      secure: env.nodeEnv === "production",
    },
  }),
);

/*
 * Optional local-development auto login, off unless a developer sets
 * ENABLE_DEV_AUTO_LOGIN=true in their own .env. Never inferred from
 * NODE_ENV -- CI runs with NODE_ENV unset too, and this must not turn on
 * there (see authConfig.devAutoLoginEnabled).
 */
app.use(async (req, res, next) => {
  if (!authConfig.devAutoLoginEnabled || req.session.user) {
    return next();
  }

  try {
    // Auto-login still resolves a real seeded account. This keeps development
    // history, audit records and access checks attached to the same identity
    // shape produced by the normal login flow.
    const admin = await User.findOne({
      roleId: "admin",
      isActive: true,
    });

    if (!admin) {
      const error = new Error(
        "Development auto-login requires a seeded admin account. Run npm run seed:users first.",
      );
      error.statusCode = 500;
      error.code = "DEV_ADMIN_NOT_SEEDED";
      throw error;
    }

    req.session.user = admin.toSafeJSON();
    return next();
  } catch (error) {
    return next(error);
  }
});
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

/*
 * The unified AI Coach is now the root page served by express.static.
 * Keep /explore only as a compatibility redirect for old bookmarks.
 */
app.get("/explore", (req, res) => {
  res.redirect(302, "/");
});

app.get("/platforms", (req, res) => {
  res.sendFile(path.join(publicDirectory, "platforms.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(publicDirectory, "login.html"));
});

// Application routes
app.use("/api/auth", authRoutes);
app.use("/api/chat", requireAuth, chatRoutes);
app.use("/api/conversations", requireAuth, conversationRoutes);
app.use("/api/agent", requireAuth, agentRoutes);
app.use("/api/sources", sourceRoutes);
// Internal-classified data; not a public route (threat model T-01).
app.use("/api/telemetry", requireAuth, telemetryRoutes);
// serves the original file behind a citation, with its own access check
app.use("/api/assets", assetRoutes);
// Says who accessed what -- gating this is as important as gating the
// access itself (threat model T-01). Admin-only, per the route's own
// original intent (§7 Data Gate).
app.use("/api/audit", requireAuth, requireRole("admin"), auditRoutes);
app.use("/api/quickquestions", requireAuth, quickQuestionRoutes);
// Error handling must come last
app.use(notFoundHandler);
app.use(errorHandler);

export default app;