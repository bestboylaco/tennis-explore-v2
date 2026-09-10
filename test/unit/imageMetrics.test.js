import test from "node:test";

import assert from "node:assert/strict";

import {
  mkdtemp,
  rm,
} from "node:fs/promises";

import os from "node:os";

import path from "node:path";

import sharp from "sharp";

import {
  measureImageMetrics,
} from "../../src/modules/vision/index.js";


async function createTemporaryDirectory() {
  return mkdtemp(
    path.join(
      os.tmpdir(),
      "tennis-explore-vision-",
    ),
  );
}


test(
  "measures image dimensions and technical metrics",
  async () => {
    const directory =
      await createTemporaryDirectory();

    const imagePath =
      path.join(
        directory,
        "neutral.png",
      );


    try {
      await sharp({
        create: {
          width:
            320,

          height:
            180,

          channels:
            3,

          background: {
            r: 128,
            g: 128,
            b: 128,
          },
        },
      })
        .png()
        .toFile(
          imagePath,
        );


      const metrics =
        await measureImageMetrics(
          imagePath,
        );


      assert.equal(
        metrics.width,
        320,
      );

      assert.equal(
        metrics.height,
        180,
      );


      assert.ok(
        Math.abs(
          metrics.brightness -
          128,
        ) < 1,
      );


      assert.ok(
        Number.isFinite(
          metrics.contrast,
        ),
      );


      assert.ok(
        Number.isFinite(
          metrics.sharpness,
        ),
      );
    } finally {
      await rm(
        directory,
        {
          recursive:
            true,

          force:
            true,
        },
      );
    }
  },
);


test(
  "distinguishes dark and bright images",
  async () => {
    const directory =
      await createTemporaryDirectory();

    const darkPath =
      path.join(
        directory,
        "dark.png",
      );

    const brightPath =
      path.join(
        directory,
        "bright.png",
      );


    try {
      await sharp({
        create: {
          width:
            200,

          height:
            100,

          channels:
            3,

          background: {
            r: 20,
            g: 20,
            b: 20,
          },
        },
      })
        .png()
        .toFile(
          darkPath,
        );


      await sharp({
        create: {
          width:
            200,

          height:
            100,

          channels:
            3,

          background: {
            r: 220,
            g: 220,
            b: 220,
          },
        },
      })
        .png()
        .toFile(
          brightPath,
        );


      const darkMetrics =
        await measureImageMetrics(
          darkPath,
        );


      const brightMetrics =
        await measureImageMetrics(
          brightPath,
        );


      assert.ok(
        darkMetrics.brightness <
        brightMetrics.brightness,
      );


      assert.ok(
        darkMetrics.brightness <
        30,
      );


      assert.ok(
        brightMetrics.brightness >
        200,
      );
    } finally {
      await rm(
        directory,
        {
          recursive:
            true,

          force:
            true,
        },
      );
    }
  },
);


test(
  "reports greater contrast for a high-variation image",
  async () => {
    const directory =
      await createTemporaryDirectory();

    const flatPath =
      path.join(
        directory,
        "flat.png",
      );

    const checkerPath =
      path.join(
        directory,
        "checker.png",
      );


    try {
      await sharp({
        create: {
          width:
            64,

          height:
            64,

          channels:
            3,

          background: {
            r: 128,
            g: 128,
            b: 128,
          },
        },
      })
        .png()
        .toFile(
          flatPath,
        );


      const width =
        64;

      const height =
        64;

      const channels =
        3;

      const pixels =
        Buffer.alloc(
          width *
          height *
          channels,
        );


      for (
        let y = 0;
        y < height;
        y += 1
      ) {
        for (
          let x = 0;
          x < width;
          x += 1
        ) {
          const value =
            (
              (
                Math.floor(
                  x / 8,
                ) +
                Math.floor(
                  y / 8,
                )
              ) %
              2
            ) === 0
              ? 0
              : 255;


          const offset =
            (
              (
                y * width
              ) +
              x
            ) *
            channels;


          pixels[offset] =
            value;

          pixels[
            offset + 1
          ] =
            value;

          pixels[
            offset + 2
          ] =
            value;
        }
      }


      await sharp(
        pixels,
        {
          raw: {
            width,
            height,
            channels,
          },
        },
      )
        .png()
        .toFile(
          checkerPath,
        );


      const flatMetrics =
        await measureImageMetrics(
          flatPath,
        );


      const checkerMetrics =
        await measureImageMetrics(
          checkerPath,
        );


      assert.ok(
        checkerMetrics.contrast >
        flatMetrics.contrast,
      );


      assert.ok(
        checkerMetrics.sharpness >
        flatMetrics.sharpness,
      );
    } finally {
      await rm(
        directory,
        {
          recursive:
            true,

          force:
            true,
        },
      );
    }
  },
);

test(
  "detects heavily clipped dark and bright images",
  async () => {
    const directory =
      await createTemporaryDirectory();

    const blackPath =
      path.join(
        directory,
        "black.png",
      );

    const whitePath =
      path.join(
        directory,
        "white.png",
      );


    try {
      await sharp({
        create: {
          width:
            100,

          height:
            100,

          channels:
            3,

          background: {
            r: 0,
            g: 0,
            b: 0,
          },
        },
      })
        .png()
        .toFile(
          blackPath,
        );


      await sharp({
        create: {
          width:
            100,

          height:
            100,

          channels:
            3,

          background: {
            r: 255,
            g: 255,
            b: 255,
          },
        },
      })
        .png()
        .toFile(
          whitePath,
        );


      const blackMetrics =
        await measureImageMetrics(
          blackPath,
        );

      const whiteMetrics =
        await measureImageMetrics(
          whitePath,
        );


      assert.equal(
        blackMetrics
          .shadowClippingRatio,
        1,
      );

      assert.equal(
        blackMetrics
          .highlightClippingRatio,
        0,
      );


      assert.equal(
        whiteMetrics
          .shadowClippingRatio,
        0,
      );

      assert.equal(
        whiteMetrics
          .highlightClippingRatio,
        1,
      );
    } finally {
      await rm(
        directory,
        {
          recursive:
            true,

          force:
            true,
        },
      );
    }
  },
);



test(
  "rejects an invalid image input",
  async () => {
    await assert.rejects(
      () =>
        measureImageMetrics(
          "",
        ),

      /non-empty image path or Buffer/,
    );
  },
);