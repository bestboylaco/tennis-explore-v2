import mongoose from "mongoose";

import {
  PROCESSING_STATUSES,
} from "../../../shared/constants/processingStatuses.js";

import {
  SOURCE_TYPES,
} from "../../../shared/constants/sourceTypes.js";

const sourceSchema =
  new mongoose.Schema(
    {
      title: {
        type: String,
        required: true,
        trim: true,
      },

      description: {
        type: String,
        trim: true,
        default: "",
      },

      sourceType: {
        type: String,
        enum: SOURCE_TYPES,
        required: true,
      },

      processingStatus: {
        type: String,
        enum: Object.values(
          PROCESSING_STATUSES
        ),
        default:
          PROCESSING_STATUSES.PENDING ||
          "pending",
      },

      file: {
        originalName: {
          type: String,
          trim: true,
        },

        mimeType: {
          type: String,
          trim: true,
        },

        size: {
          type: Number,
          min: 0,
        },

        uploadedAt: {
          type: Date,
        },

        storageProvider: {
          type: String,
          enum: ["s3"],
          default: "s3",
        },

        bucket: {
          type: String,
          trim: true,
        },

        key: {
          type: String,
          trim: true,
        },

        etag: {
          type: String,
          trim: true,
        },
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

export default mongoose.model(
  "Source",
  sourceSchema
);