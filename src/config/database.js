import mongoose from "mongoose";

export function configureMongoDB() {
  mongoose.set("strictQuery", true);

  return mongoose;
}