import app from "./app.js";
import { env } from "./config/env.js";
import {
  connectMongoDB,
  disconnectMongoDB,
} from "./infrastructure/database/mongodb.service.js";
import {
  COLD_START_RESOURCES,
  QUERY_CLASSES,
  RUN_STATUSES,
  TELEMETRY_RUN_TYPES,
} from "./shared/constants/telemetry.js";
import {
  startTelemetryRun,
  withColdStartDetection,
} from "./modules/telemetry/services/telemetryRecorder.service.js";

let server;
let isShuttingDown = false;

async function startServer() {
  // Startup is measured too, so a slow first database connection is visible as
  // a flagged cold start instead of unexplained latency.
  const run = startTelemetryRun({
    runType: TELEMETRY_RUN_TYPES.STARTUP,
    queryClass: QUERY_CLASSES.NOT_APPLICABLE,
  });

  try {
    await withColdStartDetection(
      run,
      { resource: COLD_START_RESOURCES.MONGODB, stage: "mongodb_connect" },
      () => run.measureStage("mongodb_connect", () => connectMongoDB()),
    );

    server = app.listen(env.port, () => {
      console.log(`TennisExplore V2 server running on port ${env.port}`);
    });

    // Written after the connection is up, which is the first moment the
    // telemetry store is reachable.
    await run.finish(RUN_STATUSES.SUCCESS);
  } catch (error) {
    run.fail(error);

    const record = await run.finish(RUN_STATUSES.FAILED);

    // The telemetry store is the database that just failed to connect, so this
    // record cannot be written: persistTelemetryRecord skips on readyState !== 1
    // and returns null. Structured stderr is the only channel left, and a failed
    // startup is exactly the run worth keeping.
    console.error(
      "TELEMETRY_UNPERSISTED",
      JSON.stringify({
        recordId: record.recordId,
        runType: record.runType,
        status: record.status,
        startedAt: record.startedAt,
        totalDurationMs: record.totalDurationMs,
        coldStart: record.coldStart,
        error: record.error,
      }),
    );

    console.error("TennisExplore V2 failed to start.");
    process.exit(1);
  }
}

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`\n${signal} received. Shutting down gracefully...`);

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          console.log("HTTP server closed.");
          resolve();
        });
      });
    }

    await disconnectMongoDB();
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void startServer();