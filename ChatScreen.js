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

const CURRENT_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_ROOM_ID = "general";

function createLocalMessage(roomId, text, senderId = CURRENT_USER_ID) {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    room_id: roomId || DEFAULT_ROOM_ID,
    sender_id: senderId,
    text,
    created_at: new Date().toISOString(),
    is_local: true
  };
}

function createMockMessages(roomId) {
  return [
    createLocalMessage(
      roomId || DEFAULT_ROOM_ID,
      "Local preview mode is ready. Supabase has no rows yet, but messages you send will appear here immediately.",
      "mock-profile"
    )
  ];
}

export async function fetchMessages(roomId) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
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
    .select()
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Supabase insert returned no message row.");
  }

  return data;
}

export default function ChatScreen({ room, onBackPress, showBackButton }) {
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const listRef = useRef(null);

  const roomId = room?.id ?? DEFAULT_ROOM_ID;

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.room_id === roomId),
    [messages, roomId]
  );

  useEffect(() => {
    let isMounted = true;

    async function loadExistingMessages() {
      try {
        const existingMessages = await fetchMessages(roomId);

        if (isMounted) {
          setMessages((currentMessages) => {
            const otherRoomMessages = currentMessages.filter((message) => message.room_id !== roomId);
            const currentRoomMessages = currentMessages.filter((message) => message.room_id === roomId);

            if (existingMessages.length > 0) {
              return [...otherRoomMessages, ...existingMessages];
            }

            if (currentRoomMessages.length > 0) {
              return currentMessages;
            }

            return [...otherRoomMessages, ...createMockMessages(roomId)];
          });
        }
      } catch (error) {
        console.error("Failed to fetch messages:", error.message);

        if (isMounted) {
          setMessages((currentMessages) =>
            currentMessages.some((message) => message.room_id === roomId)
              ? currentMessages
              : createMockMessages(roomId)
          );
        }
      }
    }

    loadExistingMessages();

    // Supabase pushes only new rows from this room into the payload handler below.
    // The handler appends payload.new to React state, which updates FlatList immediately.
    const channel = supabase
      .channel(`messages:${roomId}`)
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
            const alreadyExists = currentMessages.some((message) => message.id === payload.new.id);

            if (alreadyExists) {
              return currentMessages;
            }

            return [...currentMessages, payload.new];
          });
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);

    return () => clearTimeout(timeout);
  }, [visibleMessages.length]);

  const handleSendMessage = useCallback(async () => {
    const trimmedText = messageText.trim();

    if (!trimmedText) {
      return;
    }

    setMessageText("");
    const localMessage = createLocalMessage(roomId, trimmedText, CURRENT_USER_ID);
    setMessages((currentMessages) => [...currentMessages, localMessage]);

    try {
      const savedMessage = await sendMessage(roomId, trimmedText, CURRENT_USER_ID);

      setMessages((currentMessages) => [
        ...currentMessages.filter(
          (message) => message.id !== localMessage.id && message.id !== savedMessage.id
        ),
        savedMessage
      ]);
    } catch (error) {
      console.error("Failed to send message:", error.message);
    }
  }, [messageText, roomId]);

  const renderMessage = ({ item }) => {
    const isMine = item.sender_id === CURRENT_USER_ID;

    return (
      <View style={[styles.messageRow, isMine ? styles.sentRow : styles.receivedRow]}>
        <View style={[styles.bubble, isMine ? styles.sentBubble : styles.receivedBubble]}>
          <Text style={[styles.messageText, isMine ? styles.sentText : styles.receivedText]}>
            {item.text}
          </Text>
          <Text style={[styles.messageTime, isMine ? styles.sentTime : styles.receivedTime]}>
            {formatMessageTime(item.created_at)}
          </Text>
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
            <Text style={styles.backButtonText}>‹</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{room?.initials ?? "GC"}</Text>
        </View>
        <View style={styles.headerTextGroup}>
          <Text numberOfLines={1} style={styles.roomName}>
            {room?.room_name ?? "General Chat"}
          </Text>
          <Text numberOfLines={1} style={styles.presenceText}>
            realtime ready
          </Text>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={visibleMessages}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderMessage}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
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
            onPress={handleSendMessage}
            style={[styles.sendButton, !messageText.trim() && styles.sendButtonDisabled]}
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
    borderRadius: 21,
    backgroundColor: "#128c7e",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: {
    color: "#ffffff",
    fontWeight: "800"
  },
  headerTextGroup: {
    flex: 1
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
  messagesContent: {
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 96
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
  messageTime: {
    marginTop: 4,
    alignSelf: "flex-end",
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
    borderRadius: 22,
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
    borderRadius: 22,
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
