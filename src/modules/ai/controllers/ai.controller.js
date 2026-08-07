import {
  answerKnowledgeQuestion,
  answerKnowledgeQuestionStream,
} from "../services/ai.service.js";

/**
 * Handle knowledge-based AI questions.
 *
 * POST /api/ai/chat
 */
export async function handleKnowledgeQuestion(
  req,
  res
) {
  const {
    question,
    limit,
    temperature,
  } = req.body;

  const response =
    await answerKnowledgeQuestion({
      question,
      limit,
      temperature,
    });

  return res
    .status(200)
    .json(response);
}


/**
 * Stream a knowledge-based AI answer.
 *
 * POST /api/ai/chat/stream
 */
export async function handleKnowledgeQuestionStream(
  req,
  res
) {
  const {
    question,
    limit,
    temperature,
  } = req.body;

  res.status(200);

  res.setHeader(
    "Content-Type",
    "text/event-stream"
  );

  res.setHeader(
    "Cache-Control",
    "no-cache"
  );

  res.setHeader(
    "Connection",
    "keep-alive"
  );

  res.flushHeaders();

  const sendEvent = (
    event,
    data
  ) => {
    res.write(
      `event: ${event}\n`
    );

    res.write(
      `data: ${JSON.stringify(data)}\n\n`
    );
  };

  try {
    sendEvent(
      "start",
      {
        question,
      }
    );

    const finalResponse =
      await answerKnowledgeQuestionStream({
        question,
        limit,
        temperature,

        onChunk: async ({
          text,
          done,
          model,
        }) => {
          if (text) {
            sendEvent(
              "chunk",
              {
                text,
              }
            );
          }

          if (done) {
            sendEvent(
              "generation_complete",
              {
                model,
              }
            );
          }
        },
      });

    sendEvent(
      "complete",
      finalResponse
    );

    return res.end();
  } catch (error) {
    sendEvent(
      "error",
      {
        message:
          error instanceof Error
            ? error.message
            : "Unknown streaming error.",
      }
    );

    return res.end();
  }
}