import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";
import { supabase } from "./supabaseClient";

export async function fetchMessages(roomId) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, room_id, sender_id, text, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function sendMessage(roomId, text, senderId) {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      room_id: roomId,
      sender_id: senderId,
      text
    })
    .select("id, room_id, sender_id, text, created_at")
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Supabase insert returned no message row.");
  }

  return data;
}

function createPendingMessage(roomId, text, senderId) {
  return {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    room_id: roomId,
    sender_id: senderId,
    text,
    created_at: new Date().toISOString(),
    is_pending: true
  };
}

export default function ChatScreen({ room, session, onBackPress, showBackButton }) {
  const { width } = useWindowDimensions();
  const isCompact = width < 560;
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  const roomId = room?.id ?? null;
  const userId = session?.user?.id ?? null;

  const canSend = useMemo(
    () => Boolean(roomId && userId && messageText.trim()),
    [messageText, roomId, userId]
  );

  const visibleMessages = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();

    if (!query) {
      return messages;
    }

    return messages.filter((message) => message.text?.toLowerCase().includes(query));
  }, [messages, messageSearch]);

  const timelineItems = useMemo(() => {
    const items = [];
    let lastDateLabel = "";

    for (const message of visibleMessages) {
      const dateLabel = formatMessageDate(message.created_at);

      if (dateLabel !== lastDateLabel) {
        items.push({
          id: `date-${dateLabel}`,
          type: "date",
          label: dateLabel
        });
        lastDateLabel = dateLabel;
      }

      items.push({
        ...message,
        type: "message"
      });
    }

    return items;
  }, [visibleMessages]);

  useEffect(() => {
    let isMounted = true;

    setMessages([]);
    setError("");

    if (!roomId || !userId) {
      return () => {
        isMounted = false;
      };
    }

    async function loadExistingMessages() {
      setIsLoading(true);

      try {
        const existingMessages = await fetchMessages(roomId);

        if (isMounted) {
          setMessages(existingMessages);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError.message ?? "Failed to fetch messages.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadExistingMessages();

    const channel = supabase
      .channel(`room:${roomId}:messages`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          setMessages((currentMessages) => {
            const incomingMessage = payload.new;
            const alreadyExists = currentMessages.some((message) => message.id === incomingMessage.id);

            if (alreadyExists) {
              return currentMessages;
            }

            const withoutPendingDuplicate = currentMessages.filter(
              (message) =>
                !(
                  message.is_pending &&
                  message.sender_id === incomingMessage.sender_id &&
                  message.text === incomingMessage.text
                )
            );

            return [...withoutPendingDuplicate, incomingMessage];
          });
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [roomId, userId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);

    return () => clearTimeout(timeout);
  }, [messages.length]);

  const handleSendMessage = useCallback(async () => {
    const trimmedText = messageText.trim();

    if (!roomId || !userId || !trimmedText) {
      return;
    }

    setMessageText("");
    setError("");
    const pendingMessage = createPendingMessage(roomId, trimmedText, userId);
    setMessages((currentMessages) => [...currentMessages, pendingMessage]);

    try {
      const savedMessage = await sendMessage(roomId, trimmedText, userId);

      setMessages((currentMessages) => [
        ...currentMessages.filter(
          (message) => message.id !== pendingMessage.id && message.id !== savedMessage.id
        ),
        savedMessage
      ]);
    } catch (sendError) {
      setMessages((currentMessages) => currentMessages.filter((message) => message.id !== pendingMessage.id));
      setError(sendError.message ?? "Failed to send message.");
      setMessageText(trimmedText);
    }
  }, [messageText, roomId, userId]);

  const handleQuickReply = useCallback((value) => {
    setMessageText((currentText) => {
      if (!currentText.trim()) {
        return value;
      }

      return `${currentText.trim()} ${value}`;
    });
  }, []);

  const renderMessage = ({ item }) => {
    if (item.type === "date") {
      return (
        <View style={styles.dateRow}>
          <Text style={styles.datePill}>{item.label}</Text>
        </View>
      );
    }

    const isMine = item.sender_id === userId;

    return (
      <View style={[styles.messageRow, isMine ? styles.sentRow : styles.receivedRow]}>
        <View style={[styles.bubble, isMine ? styles.sentBubble : styles.receivedBubble]}>
          <Text style={[styles.messageText, isMine ? styles.sentText : styles.receivedText]}>
            {item.text}
          </Text>
          <View style={styles.metaRow}>
            {item.is_pending ? <Text style={styles.pendingText}>Queued</Text> : null}
            <Text style={[styles.messageTime, isMine ? styles.sentTime : styles.receivedTime]}>
              {formatMessageTime(item.created_at)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {showBackButton ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onBackPress}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>{"<"}</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{room?.initials ?? "CH"}</Text>
        </View>
        <View style={styles.headerTextGroup}>
          <Text numberOfLines={1} style={styles.roomName}>
            {room?.room_name ?? "Chat"}
          </Text>
          <Text numberOfLines={1} style={styles.presenceText}>
            realtime secured - {messages.length} messages
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setIsSearchOpen((current) => !current)}
          style={[styles.headerIconButton, isSearchOpen && styles.headerIconButtonActive]}
        >
          <Text style={styles.headerIconButtonText}>S</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setIsDetailsOpen((current) => !current)}
          style={[styles.headerIconButton, isDetailsOpen && styles.headerIconButtonActive]}
        >
          <Text style={styles.headerIconButtonText}>I</Text>
        </TouchableOpacity>
      </View>

      {isSearchOpen ? (
        <View style={styles.searchPanel}>
          <TextInput
            value={messageSearch}
            onChangeText={setMessageSearch}
            placeholder="Search this conversation"
            placeholderTextColor="#8a99aa"
            style={styles.searchInput}
          />
          {messageSearch.trim() ? (
            <Text style={styles.searchMeta}>
              {visibleMessages.length} of {messages.length} messages
            </Text>
          ) : null}
        </View>
      ) : null}

      {isDetailsOpen ? (
        <View style={styles.detailsPanel}>
          <View style={styles.detailsMetric}>
            <Text style={styles.detailsValue}>{messages.length}</Text>
            <Text style={styles.detailsLabel}>Messages</Text>
          </View>
          <View style={styles.detailsMetric}>
            <Text style={styles.detailsValue}>Live</Text>
            <Text style={styles.detailsLabel}>Realtime</Text>
          </View>
          <View style={styles.detailsMetric}>
            <Text style={styles.detailsValue}>Private</Text>
            <Text style={styles.detailsLabel}>Room type</Text>
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <FlatList
        ref={listRef}
        data={timelineItems}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderMessage}
        contentContainerStyle={[styles.messagesContent, timelineItems.length === 0 && styles.emptyMessagesContent]}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {isLoading ? "Loading messages" : messageSearch.trim() ? "No matching messages" : "No messages yet"}
            </Text>
            <Text style={styles.emptyCopy}>
              {isLoading
                ? "Fetching the latest room history."
                : messageSearch.trim()
                  ? "Try a different word or clear search."
                  : "Start the conversation in this room."}
            </Text>
          </View>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        style={styles.inputDock}
      >
        <View style={styles.quickReplyRow}>
          {["On it", "Sounds good", "Call me"].map((reply) => (
            <TouchableOpacity
              key={reply}
              accessibilityRole="button"
              onPress={() => handleQuickReply(reply)}
              style={styles.quickReplyButton}
            >
              <Text style={styles.quickReplyText}>{reply}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.inputBar}>
          <TextInput
            value={messageText}
            onChangeText={setMessageText}
            placeholder="Message"
            placeholderTextColor="#718096"
            multiline
            style={styles.input}
            returnKeyType="send"
            onSubmitEditing={handleSendMessage}
          />
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!canSend}
            onPress={handleSendMessage}
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.composerMetaRow}>
          <Text style={styles.composerHint}>{isCompact ? "Realtime private room" : "Shift+Enter for a new line on desktop"}</Text>
          <Text style={styles.composerCount}>{messageText.length}/1000</Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function formatMessageDate(value) {
  const messageDate = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (messageDate.toDateString() === today.toDateString()) {
    return "Today";
  }

  if (messageDate.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: messageDate.getFullYear() === today.getFullYear() ? undefined : "numeric"
  }).format(messageDate);
}

function formatMessageTime(value) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#07111f"
  },
  header: {
    minHeight: 76,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d9e2ec",
    backgroundColor: "rgba(255,255,255,0.9)",
    backdropFilter: "blur(18px)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  backButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center"
  },
  backButtonText: {
    color: "#0f766e",
    fontSize: 34,
    lineHeight: 34
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: "#0f766e",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: {
    color: "#ffffff",
    fontWeight: "800"
  },
  headerTextGroup: {
    flex: 1,
    minWidth: 0
  },
  roomName: {
    color: "#172033",
    fontSize: 18,
    fontWeight: "900"
  },
  presenceText: {
    marginTop: 2,
    color: "#64748b",
    fontSize: 13
  },
  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef4f8",
    borderWidth: 1,
    borderColor: "#dbe7ef"
  },
  headerIconButtonActive: {
    backgroundColor: "#e6fffb",
    borderColor: "#99f6e4"
  },
  headerIconButtonText: {
    color: "#0f766e",
    fontSize: 14,
    fontWeight: "900"
  },
  searchPanel: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.88)",
    backdropFilter: "blur(18px)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  searchInput: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbe7ef",
    paddingHorizontal: 14,
    backgroundColor: "rgba(248,250,252,0.82)",
    backdropFilter: "blur(18px)",
    color: "#172033",
    fontSize: 14
  },
  searchMeta: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800"
  },
  detailsPanel: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: "#f8fafc",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
    flexDirection: "row",
    gap: 10
  },
  detailsMetric: {
    flex: 1,
    borderRadius: 8,
    padding: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0"
  },
  detailsValue: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "900"
  },
  detailsLabel: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  errorBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#fee2e2",
    color: "#991b1b",
    fontSize: 13,
    fontWeight: "700"
  },
  messagesContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 148,
    backgroundColor: "#eef4f8"
  },
  emptyMessagesContent: {
    flexGrow: 1
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24
  },
  emptyTitle: {
    color: "#172033",
    fontSize: 20,
    fontWeight: "900"
  },
  emptyCopy: {
    marginTop: 8,
    color: "#64748b",
    fontSize: 14,
    textAlign: "center"
  },
  messageRow: {
    flexDirection: "row",
    marginBottom: 10
  },
  dateRow: {
    alignItems: "center",
    marginBottom: 14,
    marginTop: 2
  },
  datePill: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: "hidden",
    backgroundColor: "#e2e8f0",
    color: "#475569",
    fontSize: 12,
    fontWeight: "900"
  },
  sentRow: {
    justifyContent: "flex-end"
  },
  receivedRow: {
    justifyContent: "flex-start"
  },
  bubble: {
    maxWidth: "76%",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  sentBubble: {
    backgroundColor: "#0f766e",
    borderTopRightRadius: 2
  },
  receivedBubble: {
    backgroundColor: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(12px)",
    borderTopLeftRadius: 2
  },
  messageText: {
    fontSize: 16,
    lineHeight: 21
  },
  sentText: {
    color: "#ffffff"
  },
  receivedText: {
    color: "#1f2933"
  },
  metaRow: {
    marginTop: 4,
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  pendingText: {
    color: "#cffafe",
    fontSize: 11,
    fontWeight: "700"
  },
  messageTime: {
    fontSize: 11
  },
  sentTime: {
    color: "#ccfbf1"
  },
  receivedTime: {
    color: "#7b8794"
  },
  inputDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(18px)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#d0d7de"
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: "#f8fafc",
    color: "#1f2933",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#dbe7ef"
  },
  sendButton: {
    minWidth: 72,
    height: 48,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f766e"
  },
  sendButtonDisabled: {
    opacity: 0.5
  },
  sendButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800"
  },
  quickReplyRow: {
    marginBottom: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  quickReplyButton: {
    height: 32,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef4f8",
    borderWidth: 1,
    borderColor: "#dbe7ef"
  },
  quickReplyText: {
    color: "#425466",
    fontSize: 12,
    fontWeight: "900"
  },
  composerMetaRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  composerHint: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700"
  },
  composerCount: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "900"
  }
});
