import {
  appendConversationMessage,
  createConversation,
  getConversation,
  listConversations,
} from "../services/conversation.service.js";

function notFound(res) {
  return res.status(404).json({
    success: false,
    error: {
      code: "CONVERSATION_NOT_FOUND",
      message: "Conversation not found.",
    },
  });
}

export async function listConversationsController(req, res) {
  const conversations = await listConversations(req.user.id);

  return res.status(200).json({
    success: true,
    data: conversations,
    meta: { count: conversations.length },
  });
}

export async function getConversationController(req, res) {
  const conversation = await getConversation(
    req.user.id,
    req.params.conversationId,
  );

  if (!conversation) return notFound(res);

  return res.status(200).json({
    success: true,
    data: conversation,
  });
}

export async function createConversationController(req, res) {
  const conversation = await createConversation(
    req.user.id,
    req.body?.message,
  );

  return res.status(201).json({
    success: true,
    data: conversation,
  });
}

export async function appendConversationMessageController(req, res) {
  const conversation = await appendConversationMessage(
    req.user.id,
    req.params.conversationId,
    req.body?.message,
  );

  if (!conversation) return notFound(res);

  return res.status(200).json({
    success: true,
    data: conversation,
  });
}
