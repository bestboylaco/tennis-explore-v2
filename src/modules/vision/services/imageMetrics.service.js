import sharp from "sharp";


function isValidImageInput(value) {
  return (
    (
      typeof value === "string" &&
      value.trim().length > 0
    ) ||
    Buffer.isBuffer(value)
  );
}


function roundMetric(
  value,
  decimalPlaces = 3,
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return 0;
  }

  const multiplier =
    10 ** decimalPlaces;

  return (
    Math.round(
      value * multiplier,
    ) / multiplier
  );
}


// Estimate overall image brightness.
function calculateBrightness(
  channels,
) {
  if (
    !Array.isArray(channels) ||
    channels.length === 0
  ) {
    return 0;
  }

  if (channels.length === 1) {
    return channels[0].mean;
  }

  const red =
    channels[0]?.mean ?? 0;

  const green =
    channels[1]?.mean ?? red;

  const blue =
    channels[2]?.mean ?? red;

  return (
    (0.2126 * red) +
    (0.7152 * green) +
    (0.0722 * blue)
  );
}


// Estimate variation between light and dark pixels.
function calculateContrast(
  channels,
) {
  if (
    !Array.isArray(channels) ||
    channels.length === 0
  ) {
    return 0;
  }

  const visibleChannels =
    channels.slice(
      0,
      Math.min(
        channels.length,
        3,
      ),
    );

  const total =
    visibleChannels.reduce(
      (
        sum,
        channel,
      ) =>
        sum +
        (
          Number.isFinite(
            channel?.stdev,
          )
            ? channel.stdev
            : 0
        ),

      0,
    );

  return (
    total /
    visibleChannels.length
  );
}


// Count pixels that are nearly black or white.
function calculateClippingRatios(
  grayscalePixels,
) {
  if (
    !Buffer.isBuffer(
      grayscalePixels,
    ) ||
    grayscalePixels.length === 0
  ) {
    return {
      shadowClippingRatio:
        0,

      highlightClippingRatio:
        0,
    };
  }

  let shadowPixels =
    0;

  let highlightPixels =
    0;


  for (
    const value of grayscalePixels
  ) {
    if (value <= 15) {
      shadowPixels +=
        1;
    }

    if (value >= 240) {
      highlightPixels +=
        1;
    }
  }


  return {
    shadowClippingRatio:
      shadowPixels /
      grayscalePixels.length,

    highlightClippingRatio:
      highlightPixels /
      grayscalePixels.length,
  };
}


// Estimate random local pixel noise.
function calculateNoiseScore(
  grayscalePixels,
  denoisedPixels,
) {
  if (
    !Buffer.isBuffer(
      grayscalePixels,
    ) ||
    !Buffer.isBuffer(
      denoisedPixels,
    ) ||
    grayscalePixels.length ===
      0 ||
    grayscalePixels.length !==
      denoisedPixels.length
  ) {
    return 0;
  }


  const histogram =
    new Uint32Array(
      256,
    );


  for (
    let index = 0;
    index <
      grayscalePixels.length;
    index += 1
  ) {
    const difference =
      Math.abs(
        grayscalePixels[index] -
        denoisedPixels[index],
      );


    histogram[difference] +=
      1;
  }


  const targetCount =
    Math.ceil(
      grayscalePixels.length *
        0.75,
    );


  let cumulativeCount =
    0;


  for (
    let difference = 0;
    difference <
      histogram.length;
    difference += 1
  ) {
    cumulativeCount +=
      histogram[difference];


    if (
      cumulativeCount >=
      targetCount
    ) {
      return difference;
    }
  }


  return 0;
}


// Estimate JPEG-style 8x8 block boundaries.
function calculateBlockinessScore(
  grayscalePixels,
  width,
  height,
) {
  if (
    !Buffer.isBuffer(
      grayscalePixels,
    ) ||
    grayscalePixels.length ===
      0 ||
    !Number.isInteger(
      width,
    ) ||
    !Number.isInteger(
      height,
    ) ||
    width < 2 ||
    height < 2
  ) {
    return 0;
  }


  let boundaryDifference =
    0;

  let boundaryCount =
    0;

  let interiorDifference =
    0;

  let interiorCount =
    0;


  // Vertical pixel transitions.
  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    const rowOffset =
      y *
      width;


    for (
      let x = 1;
      x < width;
      x += 1
    ) {
      const currentIndex =
        rowOffset +
        x;

      const previousIndex =
        currentIndex -
        1;


      const difference =
        Math.abs(
          grayscalePixels[
            currentIndex
          ] -
          grayscalePixels[
            previousIndex
          ],
        );


      if (
        x % 8 ===
        0
      ) {
        boundaryDifference +=
          difference;

        boundaryCount +=
          1;
      } else {
        interiorDifference +=
          difference;

        interiorCount +=
          1;
      }
    }
  }


  // Horizontal pixel transitions.
  for (
    let y = 1;
    y < height;
    y += 1
  ) {
    const rowOffset =
      y *
      width;

    const previousRowOffset =
      (
        y -
        1
      ) *
      width;


    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      const difference =
        Math.abs(
          grayscalePixels[
            rowOffset +
            x
          ] -
          grayscalePixels[
            previousRowOffset +
            x
          ],
        );


      if (
        y % 8 ===
        0
      ) {
        boundaryDifference +=
          difference;

        boundaryCount +=
          1;
      } else {
        interiorDifference +=
          difference;

        interiorCount +=
          1;
      }
    }
  }


  if (
    boundaryCount === 0 ||
    interiorCount === 0
  ) {
    return 0;
  }


  const boundaryMean =
    boundaryDifference /
    boundaryCount;

  const interiorMean =
    interiorDifference /
    interiorCount;


  return Math.max(
    0,
    boundaryMean -
      interiorMean,
  );
}


export async function measureImageMetrics(
  imageInput,
) {
  if (
    !isValidImageInput(
      imageInput,
    )
  ) {
    throw new TypeError(
      "measureImageMetrics requires a non-empty image path or Buffer.",
    );
  }


  const [
    metadata,
    statistics,
    grayscaleResult,
    denoisedResult,
  ] =
    await Promise.all([
      sharp(
        imageInput,
      ).metadata(),

      sharp(
        imageInput,
      ).stats(),

      sharp(
        imageInput,
      )
        .greyscale()
        .raw()
        .toBuffer({
          resolveWithObject:
            true,
        }),

      sharp(
        imageInput,
      )
        .greyscale()
        .median(
          3,
        )
        .raw()
        .toBuffer({
          resolveWithObject:
            true,
        }),
    ]);


  if (
    !Number.isInteger(
      metadata.width,
    ) ||
    !Number.isInteger(
      metadata.height,
    )
  ) {
    throw new Error(
      "Unable to determine image dimensions.",
    );
  }


  const brightness =
    calculateBrightness(
      statistics.channels,
    );


  const contrast =
    calculateContrast(
      statistics.channels,
    );


  const noiseScore =
    calculateNoiseScore(
      grayscaleResult.data,
      denoisedResult.data,
    );


  const blockinessScore =
    calculateBlockinessScore(
      grayscaleResult.data,
      metadata.width,
      metadata.height,
    );


  const {
    shadowClippingRatio,
    highlightClippingRatio,
  } =
    calculateClippingRatios(
      grayscaleResult.data,
    );


  return {
    width:
      metadata.width,

    height:
      metadata.height,

    brightness:
      roundMetric(
        brightness,
      ),

    contrast:
      roundMetric(
        contrast,
      ),

    sharpness:
      roundMetric(
        statistics.sharpness,
      ),

    noiseScore:
      roundMetric(
        noiseScore,
      ),

    blockinessScore:
      roundMetric(
        blockinessScore,
      ),

    shadowClippingRatio:
      roundMetric(
        shadowClippingRatio,
        4,
      ),

    highlightClippingRatio:
      roundMetric(
        highlightClippingRatio,
        4,
      ),
  };
}