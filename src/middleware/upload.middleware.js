import multer from "multer";

const storage =
  multer.memoryStorage();

function fileFilter(
  req,
  file,
  callback
) {
  const allowedMimeTypes = [
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/json",
    "text/csv",
  ];

  if (
    !allowedMimeTypes.includes(
      file.mimetype
    )
  ) {
    return callback(
      new Error(
        `Unsupported file type: ${file.mimetype}`
      )
    );
  }

  return callback(
    null,
    true
  );
}

const upload =
  multer({
    storage,

    fileFilter,

    limits: {
      fileSize:
        20 * 1024 * 1024,
    },
  });

export default upload;