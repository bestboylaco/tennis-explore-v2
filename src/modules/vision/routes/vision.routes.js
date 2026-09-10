import os from "node:os";

import express from "express";
import multer from "multer";

import {
  analyzeVisualEvidence,
} from "../controllers/vision.controller.js";


const router =
  express.Router();


const upload =
  multer({
    dest:
      os.tmpdir(),

    limits: {
      fileSize:
        15 *
        1024 *
        1024,
    },

    fileFilter(
      req,
      file,
      callback,
    ) {
      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
      ];


      if (
        !allowedTypes.includes(
          file.mimetype,
        )
      ) {
        const error =
          new Error(
            "Only JPEG, PNG and WebP images are supported.",
          );


        error.statusCode =
          400;

        error.code =
          "UNSUPPORTED_IMAGE_TYPE";


        callback(
          error,
        );

        return;
      }


      callback(
        null,
        true,
      );
    },
  });


router.post(
  "/analyze",

  upload.single(
    "image",
  ),

  (
    req,
    res,
    next,
  ) => {
    analyzeVisualEvidence(
      req,
      res,
    ).catch(
      next,
    );
  },
);


export default router;