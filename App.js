import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";
import AuthScreen from "./AuthScreen";
import ChatScreen from "./ChatScreen";
import { supabase } from "./supabaseClient";

function getRoomInitials(name = "Chat") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CH";
}

function normalizeRoom(room) {
  const roomName = room.room_name ?? room.name ?? "Untitled room";

  return {
    id: room.id,
    room_name: roomName,
    is_group: Boolean(room.is_group),
    initials: room.initials ?? getRoomInitials(roomName),
    preview: room.description ?? "Realtime room",
    unread: 0
  };
}

async function fetchUserRooms(userId) {
  const membershipQuery = await supabase
    .from("room_members")
    .select("room_id, rooms(id)")
    .eq("user_id", userId);

  if (!membershipQuery.error) {
    return (membershipQuery.data ?? [])
      .map((membership) => membership.rooms)
      .filter(Boolean)
      .map(normalizeRoom);
  }

  const directRoomQuery = await supabase
    .from("rooms")
    .select("id");

  if (directRoomQuery.error) {
    throw membershipQuery.error;
  }

  return (directRoomQuery.data ?? []).map(normalizeRoom);
}

async function ensureAuthenticatedProfile(user) {
  if (!user?.id) {
    return;
  }

  const metadataName = user.user_metadata?.full_name;
  const emailName = user.email?.split("@")[0] ?? "Member";

  await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email,
      full_name: metadataName || emailName,
      updated_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );
}

export default function App() {
  const { width } = useWindowDimensions();
  const isMobile = width < 760;
  const [session, setSession] = useState(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [rooms, setRooms] = useState([]);
  const [roomsError, setRoomsError] = useState("");
  const [isRoomsLoading, setIsRoomsLoading] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [isSidebarVisible, setIsSidebarVisible] = useState(!isMobile);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    setIsSidebarVisible(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        setSession(data.session);
        setIsSessionLoading(false);
      }
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsSessionLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadRooms() {
      if (!session?.user?.id) {
        setRooms([]);
        setSelectedRoomId(null);
        return;
      }

      setIsRoomsLoading(true);
      setRoomsError("");

      try {
        await ensureAuthenticatedProfile(session.user);
        const nextRooms = await fetchUserRooms(session.user.id);

        if (isMounted) {
          setRooms(nextRooms);
          setSelectedRoomId((currentRoomId) => {
            if (nextRooms.some((room) => room.id === currentRoomId)) {
              return currentRoomId;
            }

            return nextRooms[0]?.id ?? null;
          });
        }
      } catch (error) {
        if (isMounted) {
          setRooms([]);
          setSelectedRoomId(null);
          setRoomsError(error.message ?? "Unable to load rooms.");
        }
      } finally {
        if (isMounted) {
          setIsRoomsLoading(false);
        }
      }
    }

    loadRooms();

    return () => {
      isMounted = false;
    };
  }, [session?.user?.id]);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId]
  );

  const filteredRooms = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    if (!query) {
      return rooms;
    }

    return rooms.filter((room) => room.room_name.toLowerCase().includes(query));
  }, [rooms, searchText]);

  const showSidebar = !isMobile || isSidebarVisible;
  const showChat = !isMobile || !isSidebarVisible;

  const handleRoomPress = useCallback(
    (room) => {
      setSelectedRoomId(room.id);

      if (isMobile) {
        setIsSidebarVisible(false);
      }
    },
    [isMobile]
  );

  const handleSignOut = useCallback(async () => {
    setRooms([]);
    setSelectedRoomId(null);
    setSearchText("");
    await supabase.auth.signOut();
  }, []);

  const renderRoom = ({ item }) => {
    const isActive = item.id === selectedRoomId;

    return (
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => handleRoomPress(item)}
        style={[styles.roomItem, isActive && styles.roomItemActive]}
      >
        <View style={styles.roomAvatar}>
          <Text style={styles.roomAvatarText}>{item.initials}</Text>
        </View>
        <View style={styles.roomCopy}>
          <View style={styles.roomTitleRow}>
            <Text numberOfLines={1} style={styles.roomTitle}>
              {item.room_name}
            </Text>
            <Text style={styles.roomTime}>Live</Text>
          </View>
          <View style={styles.roomPreviewRow}>
            <Text numberOfLines={1} style={styles.roomPreview}>
              {item.preview}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (isSessionLoading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color="#ffffff" size="large" />
      </SafeAreaView>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#075e54" />
      <View style={styles.appShell}>
        {showSidebar ? (
          <View style={[styles.sidebar, isMobile && styles.mobileSidebar]}>
            <View style={styles.sidebarHeader}>
              <View style={styles.headerIdentity}>
                <Text style={styles.appTitle}>Chats</Text>
                <Text numberOfLines={1} style={styles.appSubtitle}>
                  {session.user.email}
                </Text>
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={handleSignOut}
                  style={styles.signOutButton}
                >
                  <Text style={styles.signOutButtonText}>Sign Out</Text>
                </TouchableOpacity>
                {isMobile ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => setIsSidebarVisible(false)}
                    style={styles.headerButton}
                  >
                    <Text style={styles.headerButtonText}>x</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            <View style={styles.searchWrap}>
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Search chats"
                placeholderTextColor="#87939a"
                style={styles.searchInput}
              />
            </View>

            {roomsError ? <Text style={styles.sidebarMessage}>{roomsError}</Text> : null}
            {!roomsError && isRoomsLoading ? (
              <View style={styles.sidebarLoader}>
                <ActivityIndicator color="#075e54" />
              </View>
            ) : null}
            {!roomsError && !isRoomsLoading && filteredRooms.length === 0 ? (
              <Text style={styles.sidebarMessage}>No authorized rooms found.</Text>
            ) : null}

            <FlatList
              data={filteredRooms}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderRoom}
              contentContainerStyle={styles.roomList}
              keyboardShouldPersistTaps="handled"
            />
          </View>
        ) : null}

        {showChat ? (
          <View style={styles.chatPanel}>
            {isMobile ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setIsSidebarVisible(true)}
                style={styles.mobileMenuButton}
              >
                <Text style={styles.mobileMenuButtonText}>Menu</Text>
              </TouchableOpacity>
            ) : null}
            {selectedRoom ? (
              <ChatScreen
                room={selectedRoom}
                session={session}
                showBackButton={isMobile}
                onBackPress={() => setIsSidebarVisible(true)}
              />
            ) : (
              <View style={styles.emptyChatPanel}>
                <Text style={styles.emptyChatTitle}>Select a room</Text>
                <Text style={styles.emptyChatCopy}>Messages appear after an authorized room is available.</Text>
              </View>
            )}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#075e54"
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a"
  },
  appShell: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#d8dbd5"
  },
  sidebar: {
    width: 380,
    maxWidth: "40%",
    backgroundColor: "#ffffff",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "#cfd8dc"
  },
  mobileSidebar: {
    width: "100%",
    maxWidth: "100%",
    flex: 1
  },
  sidebarHeader: {
    minHeight: 78,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: "#075e54",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  headerIdentity: {
    flex: 1,
    minWidth: 0
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  appTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "800"
  },
  appSubtitle: {
    marginTop: 2,
    color: "#c8e6df",
    fontSize: 13
  },
  signOutButton: {
    minHeight: 36,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)"
  },
  signOutButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800"
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)"
  },
  headerButtonText: {
    color: "#ffffff",
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "900"
  },
  searchWrap: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f0f2f5"
  },
  searchInput: {
    height: 42,
    borderRadius: 8,
    paddingHorizontal: 16,
    backgroundColor: "#ffffff",
    color: "#1f2933",
    fontSize: 15
  },
  sidebarLoader: {
    paddingVertical: 22
  },
  sidebarMessage: {
    paddingHorizontal: 18,
    paddingVertical: 18,
    color: "#64748b",
    fontSize: 14,
    lineHeight: 20
  },
  roomList: {
    paddingVertical: 4
  },
  roomItem: {
    minHeight: 76,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eef2f4"
  },
  roomItemActive: {
    backgroundColor: "#e9edef"
  },
  roomAvatar: {
    width: 50,
    height: 50,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#25d366"
  },
  roomAvatarText: {
    color: "#063b32",
    fontWeight: "900"
  },
  roomCopy: {
    flex: 1,
    minWidth: 0
  },
  roomTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  roomTitle: {
    flex: 1,
    color: "#1f2933",
    fontSize: 16,
    fontWeight: "700"
  },
  roomTime: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800"
  },
  roomPreviewRow: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  roomPreview: {
    flex: 1,
    color: "#60746f",
    fontSize: 14
  },
  chatPanel: {
    flex: 1,
    minWidth: 0
  },
  mobileMenuButton: {
    position: "absolute",
    top: 16,
    right: 14,
    zIndex: 10,
    minWidth: 58,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,94,84,0.92)"
  },
  mobileMenuButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900"
  },
  emptyChatPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#efeae2"
  },
  emptyChatTitle: {
    color: "#1f2933",
    fontSize: 22,
    fontWeight: "900"
  },
  emptyChatCopy: {
    marginTop: 8,
    color: "#60746f",
    fontSize: 15,
    textAlign: "center"
  }
});
