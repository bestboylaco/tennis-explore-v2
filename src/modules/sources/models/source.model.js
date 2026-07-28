import mongoose from "mongoose";
import { SOURCE_TYPES } from "../../../shared/constants/sourceTypes.js";
import { PROCESSING_STATUSES } from "../../../shared/constants/processingStatuses.js";

const sourceSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    sourceType: {
      type: String,
      required: true,
      enum: SOURCE_TYPES,
    },

    processingStatus: {
      type: String,
      enum: PROCESSING_STATUSES,
      default: "pending",
    },

    isActive: {
        type: Boolean,
        default: true,
    },
  },
  {
    timestamps: true,
  }
);

const Source = mongoose.model("Source", sourceSchema);

export default Source;