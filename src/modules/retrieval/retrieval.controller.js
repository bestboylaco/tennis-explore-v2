import {
  retrieveRelevantChunks,
} from "./retrieval.service.js";

export async function retrieveChunksController(req, res) {
  const {
    question,
    limit = 5,
  } = req.body;

  const result = await retrieveRelevantChunks(
    question,
    Number(limit)
  );

  return res.status(200).json({
    success: true,
    message: "Relevant chunks retrieved successfully.",
    data: result,
  });
}