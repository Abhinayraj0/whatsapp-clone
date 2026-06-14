import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
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
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  const roomId = room?.id ?? null;
  const userId = session?.user?.id ?? null;

  const canSend = useMemo(
    () => Boolean(roomId && userId && messageText.trim()),
    [messageText, roomId, userId]
  );

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

  const renderMessage = ({ item }) => {
    const isMine = item.sender_id === userId;

    return (
      <View style={[styles.messageRow, isMine ? styles.sentRow : styles.receivedRow]}>
        <View style={[styles.bubble, isMine ? styles.sentBubble : styles.receivedBubble]}>
          <Text style={[styles.messageText, isMine ? styles.sentText : styles.receivedText]}>
            {item.text}
          </Text>
          <View style={styles.metaRow}>
            {item.is_pending ? <Text style={styles.pendingText}>Sending</Text> : null}
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
            realtime secured
          </Text>
        </View>
      </View>

      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderMessage}
        contentContainerStyle={[styles.messagesContent, messages.length === 0 && styles.emptyMessagesContent]}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{isLoading ? "Loading messages" : "No messages yet"}</Text>
            <Text style={styles.emptyCopy}>
              {isLoading ? "Fetching the latest room history." : "Start the conversation in this room."}
            </Text>
          </View>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        style={styles.inputDock}
      >
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
      </KeyboardAvoidingView>
    </View>
  );
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
    backgroundColor: "#efeae2"
  },
  header: {
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d9d0c5",
    backgroundColor: "#f7f5f2",
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
    color: "#075e54",
    fontSize: 34,
    lineHeight: 34
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: "#128c7e",
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
    color: "#1f2933",
    fontSize: 17,
    fontWeight: "700"
  },
  presenceText: {
    marginTop: 2,
    color: "#60746f",
    fontSize: 13
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
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 96
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
    color: "#1f2933",
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
  sentRow: {
    justifyContent: "flex-end"
  },
  receivedRow: {
    justifyContent: "flex-start"
  },
  bubble: {
    maxWidth: "78%",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6
  },
  sentBubble: {
    backgroundColor: "#dcf8c6",
    borderTopRightRadius: 2
  },
  receivedBubble: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 2
  },
  messageText: {
    fontSize: 16,
    lineHeight: 21
  },
  sentText: {
    color: "#1f2933"
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
    color: "#61785d",
    fontSize: 11,
    fontWeight: "700"
  },
  messageTime: {
    fontSize: 11
  },
  sentTime: {
    color: "#61785d"
  },
  receivedTime: {
    color: "#7b8794"
  },
  inputDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: "#f0f2f5",
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
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    backgroundColor: "#ffffff",
    color: "#1f2933",
    fontSize: 16
  },
  sendButton: {
    minWidth: 64,
    height: 44,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#128c7e"
  },
  sendButtonDisabled: {
    opacity: 0.5
  },
  sendButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800"
  }
});
