import mongoose from "mongoose";

import { env } from "../../config/env.js";
import { configureMongoDB } from "../../config/database.js";

configureMongoDB();

export async function connectMongoDB() {
  try {
    const connection = await mongoose.connect(env.mongodbUri, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log(
      `MongoDB connected: ${connection.connection.host}/${connection.connection.name}`,
    );

    return connection;
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    throw error;
  }
}

export async function disconnectMongoDB() {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
  console.log("MongoDB disconnected.");
}

export function getMongoDBStatus() {
  const statuses = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  return statuses[mongoose.connection.readyState] || "unknown";
}