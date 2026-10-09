import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import cors from "cors";
import session from "express-session";
import agentRoutes from "./modules/agent/agent.routes.js";

import { env } from "./config/env.js";
import { authConfig } from "./modules/auth/auth.config.js";
import { findActiveAdminUser } from "./modules/auth/models/user.model.js";
import { DynamoSessionStore } from "./infrastructure/sessionStore/dynamoSessionStore.js";
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
import visionRoutes from "./modules/vision/routes/vision.routes.js";
import ingestionRoutes from "./modules/ingestion/routes/ingestion.routes.js";

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

// TENISE-63: sessions moved off the MongoDB Atlas cluster onto the partner's
// DynamoDB table (DynamoSessionStore). Atlas's free (M0) tier occasionally
// served a session read as "not found" for a few tens of ms right after
// regenerate() on login wrote it, which is why this used to carry a
// ResilientMongoStore retry-on-read subclass. That workaround is NOT carried
// over here -- DynamoSessionStore's get() uses ConsistentRead instead, which
// removes the class of bug the retry was papering over rather than just
// retrying around it. See dynamoSessionStore.js's module comment for why that
// holds, and test/integration/dynamoSessionStore.test.js for the test that
// verifies it rather than assumes it.
app.use(
    session({
        secret:
            authConfig.sessionSecret,

        resave:
            false,

        saveUninitialized:
            false,

        store:
            new DynamoSessionStore({
                ttlSeconds:
                    authConfig.sessionMaxAgeMs / 1000,
            }),

        cookie: {
            httpOnly:
                true,

            maxAge:
                authConfig.sessionMaxAgeMs,

            sameSite:
                "lax",

            // Secure cookies require HTTPS; the demo runs over plain HTTP locally.
            secure:
                env.nodeEnv ===
                "production",
        },
    }),
);

/*
 * Optional local-development auto login, off unless a developer sets
 * ENABLE_DEV_AUTO_LOGIN=true in their own .env. Never inferred from
 * NODE_ENV -- CI runs with NODE_ENV unset too, and this must not turn on
 * there (see authConfig.devAutoLoginEnabled).
 */
app.use(
    async (
        req,
        res,
        next,
    ) => {
        if (
            !authConfig.devAutoLoginEnabled ||
            req.session.user
        ) {
            return next();
        }

        try {
            // Auto-login still resolves a real seeded account. This keeps development
            // history, audit records and access checks attached to the same identity
            // shape produced by the normal login flow.
            const admin =
                await findActiveAdminUser();

            if (!admin) {
                const error =
                    new Error(
                        "Development auto-login requires a seeded admin account. Run npm run seed:users first.",
                    );

                error.statusCode =
                    500;

                error.code =
                    "DEV_ADMIN_NOT_SEEDED";

                throw error;
            }

            req.session.user =
                admin.toSafeJSON();

            return next();
        } catch (error) {
            return next(
                error,
            );
        }
    },
);

app.use(
    express.static(
        publicDirectory,
    ),
);

app.use(
    telemetryMiddleware,
);

// Health route
app.get(
    "/api/health",
    (
        req,
        res,
    ) => {
        const mongodbStatus =
            getMongoDBStatus();

        const healthy =
            mongodbStatus ===
            "connected";

        return res
            .status(
                healthy
                    ? 200
                    : 503,
            )
            .json({
                success:
                    healthy,

                data: {
                    service:
                        "TennisExplore V2 API",

                    status:
                        healthy
                            ? "healthy"
                            : "degraded",

                    environment:
                        env.nodeEnv,

                    dependencies: {
                        mongodb:
                            mongodbStatus,
                    },

                    timestamp:
                        new Date()
                            .toISOString(),
                },
            });
    },
);

/*
 * The unified AI Coach is now the root page served by express.static.
 * Keep /explore only as a compatibility redirect for old bookmarks.
 */
app.get(
    "/explore",
    (
        req,
        res,
    ) => {
        res.redirect(
            302,
            "/",
        );
    },
);

app.get(
    "/platforms",
    (
        req,
        res,
    ) => {
        // `root` matters, not just style: without it, `send` checks every
        // segment of the full absolute path for a leading dot, starting from
        // the filesystem root -- not just relative to publicDirectory. Any
        // checkout living under a dot-directory (e.g. a `.claude/worktrees/`
        // agent sandbox) then 404s here even though the file exists, while
        // `express.static(publicDirectory)` above is unaffected because it
        // already passes `root` internally. Observed live during TENISE-68
        // verification (2026-10-01).
        res.sendFile(
            "platforms.html",
            { root: publicDirectory },
        );
    },
);

app.get(
    "/login",
    (
        req,
        res,
    ) => {
        res.sendFile(
            "login.html",
            { root: publicDirectory },
        );
    },
);

// Application routes
app.use(
    "/api/auth",
    authRoutes,
);

app.use(
    "/api/chat",
    requireAuth,
    chatRoutes,
);

app.use(
    "/api/conversations",
    requireAuth,
    conversationRoutes,
);

app.use(
    "/api/agent",
    requireAuth,
    agentRoutes,
);

app.use(
    "/api/vision",
    requireAuth,
    visionRoutes,
);

/*
 * Private PDF ingestion.
 *
 * Authentication runs before the upload route, so the server determines the
 * uploader role from the trusted session rather than accepting ACL information
 * from the browser.
 */
app.use(
    "/api/ingestion",
    requireAuth,
    ingestionRoutes,
);

app.use(
    "/api/sources",
    sourceRoutes,
);

// Internal-classified data; not a public route (threat model T-01).
app.use(
    "/api/telemetry",
    requireAuth,
    telemetryRoutes,
);

// serves the original file behind a citation, with its own access check
app.use(
    "/api/assets",
    requireAuth,
    assetRoutes,
);

// Says who accessed what -- gating this is as important as gating the
// access itself (threat model T-01). Admin-only, per the route's own
// original intent (§7 Data Gate).
app.use(
    "/api/audit",
    requireAuth,
    requireRole(
        "admin",
    ),
    auditRoutes,
);

app.use(
    "/api/quickquestions",
    requireAuth,
    quickQuestionRoutes,
);

// Error handling must come last
app.use(
    notFoundHandler,
);

app.use(
    errorHandler,
);

export default app;