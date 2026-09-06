import mongoose from "mongoose";

import Conversation from "../models/conversation.model.js";

const MAX_TITLE_LENGTH = 58;

function normaliseUserId(userId) {
  if (!mongoose.isValidObjectId(userId)) return null;

  return new mongoose.Types.ObjectId(userId);
}

function titleFromQuestion(question) {
  const compact = String(question ?? "").replace(/\s+/g, " ").trim();

  if (!compact) return "New conversation";
  if (compact.length <= MAX_TITLE_LENGTH) return compact;

  return `${compact.slice(0, MAX_TITLE_LENGTH - 3).trimEnd()}...`;
}

function normaliseMessage(message) {
  const role = message?.role;
  const content = String(message?.content ?? "").trim();

  if (!["user", "assistant"].includes(role) || !content) {
    const error = new Error("A conversation message requires a valid role and content.");
    error.statusCode = 400;
    error.code = "INVALID_CONVERSATION_MESSAGE";
    throw error;
  }

  return {
    role,
    content,
    citations: Array.isArray(message?.citations) ? message.citations : [],
    table: message?.table ?? null,
    sql: typeof message?.sql === "string" ? message.sql : null,
    grounding: message?.grounding ?? null,
    createdAt: new Date(),
  };
}

function toSummary(conversation) {
  return {
    id: String(conversation._id),
    title: conversation.title,
    messageCount: conversation.messageCount,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt,
  };
}

export async function listConversations(userId) {
  const ownerId = normaliseUserId(userId);

  if (!ownerId) return [];

  const conversations = await Conversation.find({ userId: ownerId })
    .select("title messageCount createdAt updatedAt lastMessageAt")
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .lean();

  return conversations.map(toSummary);
}

export async function getConversation(userId, conversationId) {
  const ownerId = normaliseUserId(userId);

  if (!ownerId || !mongoose.isValidObjectId(conversationId)) return null;

  const conversation = await Conversation.findOne({
    _id: conversationId,
    userId: ownerId,
  }).lean();

  if (!conversation) return null;

  return {
    ...toSummary(conversation),
    messages: conversation.messages ?? [],
  };
}

export async function createConversation(userId, firstMessage) {
  const ownerId = normaliseUserId(userId);

  if (!ownerId) {
    const error = new Error("The signed-in account could not be resolved.");
    error.statusCode = 401;
    error.code = "ACCOUNT_CONTEXT_REQUIRED";
    throw error;
  }

  const message = normaliseMessage(firstMessage);

  if (message.role !== "user") {
    const error = new Error("A conversation must begin with a user message.");
    error.statusCode = 400;
    error.code = "INVALID_CONVERSATION_START";
    throw error;
  }

  const conversation = await Conversation.create({
    userId: ownerId,
    title: titleFromQuestion(message.content),
    messages: [message],
    messageCount: 1,
    lastMessageAt: message.createdAt,
  });

  return {
    ...toSummary(conversation),
    messages: conversation.messages,
  };
}

export async function appendConversationMessage(userId, conversationId, nextMessage) {
  const ownerId = normaliseUserId(userId);

  if (!ownerId || !mongoose.isValidObjectId(conversationId)) return null;

  const message = normaliseMessage(nextMessage);

  const conversation = await Conversation.findOneAndUpdate(
    {
      _id: conversationId,
      userId: ownerId,
    },
    {
      $push: { messages: message },
      $inc: { messageCount: 1 },
      $set: { lastMessageAt: message.createdAt },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!conversation) return null;

  return toSummary(conversation);
}
