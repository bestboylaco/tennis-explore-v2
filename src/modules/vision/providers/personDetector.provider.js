import path from "node:path";

import * as ort from "onnxruntime-node";

import sharp from "sharp";


const DEFAULT_MODEL_PATH =
  path.resolve(
    "models/vision/ssd_mobilenet_v1_12-int8.onnx",
  );


const PERSON_CLASS_ID =
  1;


/*
 * Convert a normalized model box into pixels.
 */
function convertBox(
  box,
  imageWidth,
  imageHeight,
) {
  const [
    top,
    left,
    bottom,
    right,
  ] = box;


  const x =
    Math.max(
      0,
      left * imageWidth,
    );

  const y =
    Math.max(
      0,
      top * imageHeight,
    );

  const width =
    Math.max(
      0,
      (right - left) *
      imageWidth,
    );

  const height =
    Math.max(
      0,
      (bottom - top) *
      imageHeight,
    );


  return {
    x,
    y,
    width,
    height,
  };
}


/*
 * Create a replaceable ONNX person detector.
 */
export function createPersonDetector({
  modelPath =
    DEFAULT_MODEL_PATH,
} = {}) {
  let sessionPromise =
    null;


  async function getSession() {
    if (!sessionPromise) {
      sessionPromise =
        ort.InferenceSession.create(
          modelPath,
        );
    }

    return sessionPromise;
  }


  async function detect(
    imageInput,
  ) {
    if (
      typeof imageInput !== "string" &&
      !Buffer.isBuffer(imageInput)
    ) {
      throw new TypeError(
        "Person detector requires an image path or Buffer.",
      );
    }


    /*
     * Convert the image to raw RGB pixels.
     */
    const {
      data,
      info,
    } =
      await sharp(
        imageInput,
      )
        .removeAlpha()
        .toColourspace(
          "srgb",
        )
        .raw()
        .toBuffer({
          resolveWithObject:
            true,
        });


    const {
      width,
      height,
      channels,
    } =
      info;


    if (channels !== 3) {
      throw new Error(
        `Expected 3 RGB channels but received ${channels}.`,
      );
    }


    /*
     * Model expects:
     * [batch, height, width, channels]
     */
    const tensor =
      new ort.Tensor(
        "uint8",
        new Uint8Array(
          data.buffer,
          data.byteOffset,
          data.byteLength,
        ),
        [
          1,
          height,
          width,
          3,
        ],
      );


    const session =
      await getSession();


    const result =
      await session.run({
        inputs:
          tensor,
      });


    const boxes =
      result
        .detection_boxes
        .data;

    const classes =
      result
        .detection_classes
        .data;

    const scores =
      result
        .detection_scores
        .data;

    const detectionCount =
      Math.floor(
        result
          .num_detections
          .data[0],
      );


    const detections = [];


    for (
      let index = 0;
      index < detectionCount;
      index += 1
    ) {
      const classId =
        Math.round(
          classes[index],
        );


      /*
       * This provider only exposes people.
       */
      if (
        classId !==
        PERSON_CLASS_ID
      ) {
        continue;
      }


      const boxOffset =
        index * 4;


      const box =
        [
          boxes[
            boxOffset
          ],

          boxes[
            boxOffset + 1
          ],

          boxes[
            boxOffset + 2
          ],

          boxes[
            boxOffset + 3
          ],
        ];


      detections.push({
        label:
          "person",

        classId,

        confidence:
          scores[index],

        box:
          convertBox(
            box,
            width,
            height,
          ),
      });
    }


    return {
      imageWidth:
        width,

      imageHeight:
        height,

      detections,
    };
  }


  return {
    detect,
  };
}