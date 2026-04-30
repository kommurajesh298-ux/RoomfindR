import { requireAuthenticatedUser } from "../_shared/auth.ts";
import { errorResponse, handleCorsPreflight, jsonResponse } from "../_shared/http.ts";

const normalize = (value: unknown) => String(value || "").trim();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflight(req);
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const { supabase, user } = await requireAuthenticatedUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const chatId = normalize(body.chatId || body.chat_id);

    if (!chatId) {
      return errorResponse(req, 400, "Chat id is required", "chat_id_required");
    }

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (accountError) throw accountError;

    const { data: chat, error: chatError } = await supabase
      .from("chats")
      .select("id, participants, property_id, title, last_message, last_message_time, unread_counts, created_at, updated_at")
      .eq("id", chatId)
      .maybeSingle();
    if (chatError) throw chatError;
    if (!chat) {
      return errorResponse(req, 404, "Chat not found", "chat_not_found");
    }

    const participants = Array.isArray(chat.participants)
      ? chat.participants.map((value) => String(value))
      : [];
    const isAdmin = String(account?.role || "") === "admin";
    if (!isAdmin && !participants.includes(user.id)) {
      return errorResponse(req, 403, "Chat access denied", "chat_access_denied");
    }

    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("id, chat_id, sender_id, content, message_type, image_url, is_read, created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (messagesError) throw messagesError;

    return jsonResponse(req, {
      success: true,
      chat,
      messages: messages || [],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to fetch chat snapshot";
    const status = /missing bearer token|invalid or expired auth token/i.test(message)
      ? 401
      : /chat access denied/i.test(message)
        ? 403
        : 500;

    return errorResponse(req, status, message, "chat_snapshot_error");
  }
});
