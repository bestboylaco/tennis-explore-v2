import mongoose from "mongoose";
import Source from "../models/source.model.js";

export async function createSource(sourceData) {
  return Source.create(sourceData);
}

export async function getAllSources() {
  return Source.find({ isActive: true }).sort({
    createdAt: -1,
  });
}

export async function getSourceById(sourceId) {
  if (!mongoose.isValidObjectId(sourceId)) {
    return null;
  }

  return Source.findOne({
    _id: sourceId,
    isActive: true,
  });
}

export async function archiveSource(sourceId) {
  if (!mongoose.isValidObjectId(sourceId)) {
    return null;
  }

  return Source.findOneAndUpdate(
    {
      _id: sourceId,
      isActive: true,
    },
    {
      isActive: false,
    },
    {
      new: true,
      runValidators: true,
    }
  );
}

export async function attachFileToSource(sourceId, fileData) {
  if (!mongoose.isValidObjectId(sourceId)) {
    return null;
  }

  return Source.findOneAndUpdate(
    {
      _id: sourceId,
      isActive: true,
    },
    {
      file: fileData,
      processingStatus: "uploaded",
    },
    {
      new: true,
      runValidators: true,
    }
  );
}

export async function updateSourceProcessingStatus(
  sourceId,
  processingStatus
) {
  if (!mongoose.isValidObjectId(sourceId)) {
    return null;
  }

  return Source.findOneAndUpdate(
    {
      _id: sourceId,
      isActive: true,
    },
    {
      processingStatus,
    },
    {
      new: true,
      runValidators: true,
    }
  );
}