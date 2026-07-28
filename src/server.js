import app from "./app.js";
import { env } from "./config/env.js";
import {
  connectMongoDB,
  disconnectMongoDB,
} from "./infrastructure/database/mongodb.service.js";

let server;
let isShuttingDown = false;

async function startServer() {
  try {
    await connectMongoDB();

    server = app.listen(env.port, () => {
      console.log(`🎾 TennisExplore V2 server running on port ${env.port}`);
    });
  } catch {
    console.error("❌ TennisExplore V2 failed to start.");
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