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

function getProfileName(profile) {
  return profile?.full_name || profile?.email?.split("@")[0] || "Friend";
}

function normalizeProfile(profile) {
  const displayName = getProfileName(profile);

  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    displayName,
    initials: getRoomInitials(displayName)
  };
}

async function fetchUserRooms(userId) {
  const membershipQuery = await supabase
    .from("room_members")
    .select("room_id, rooms(id, room_name, is_group, description, created_at)")
    .eq("user_id", userId);

  if (!membershipQuery.error) {
    const baseRooms = (membershipQuery.data ?? [])
      .map((membership) => membership.rooms)
      .filter(Boolean)
      .map(normalizeRoom);

    const roomIds = baseRooms.map((room) => room.id);

    if (roomIds.length === 0) {
      return [];
    }

    const membersQuery = await supabase
      .from("room_members")
      .select("room_id, user_id")
      .in("room_id", roomIds);

    if (membersQuery.error) {
      return baseRooms;
    }

    const profileIds = [
      ...new Set((membersQuery.data ?? []).map((membership) => membership.user_id).filter(Boolean))
    ];
    const profilesById = new Map();

    if (profileIds.length > 0) {
      const profilesQuery = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", profileIds);

      if (!profilesQuery.error) {
        for (const profile of profilesQuery.data ?? []) {
          profilesById.set(profile.id, profile);
        }
      }
    }

    const membersByRoom = new Map();
    for (const membership of membersQuery.data ?? []) {
      const current = membersByRoom.get(membership.room_id) ?? [];
      current.push(membership);
      membersByRoom.set(membership.room_id, current);
    }

    return baseRooms.map((room) => {
      if (room.is_group) {
        return room;
      }

      const roomMembers = membersByRoom.get(room.id) ?? [];
      const friendMembership = roomMembers.find((member) => member.user_id !== userId);
      const friendProfile = friendMembership ? profilesById.get(friendMembership.user_id) : null;
      const friend = friendProfile ? normalizeProfile(friendProfile) : null;

      if (!friend) {
        return room;
      }

      return {
        ...room,
        room_name: friend.displayName,
        initials: friend.initials,
        preview: friend.email ?? "Direct message"
      };
    });
  }

  const directRoomQuery = await supabase
    .from("rooms")
    .select("id");

  if (directRoomQuery.error) {
    throw membershipQuery.error;
  }

  return (directRoomQuery.data ?? []).map(normalizeRoom);
}

async function searchProfilesByEmail(query, currentUserId) {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length < 3) {
    return [];
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc("search_users_by_email", {
    search_email: normalizedQuery
  });

  if (!rpcError && Array.isArray(rpcData)) {
    return rpcData
      .filter((profile) => profile.id !== currentUserId)
      .map(normalizeProfile);
  }

  if (
    rpcError?.message?.includes("search_users_by_email") ||
    rpcError?.message?.includes("function") ||
    rpcError?.code === "PGRST202"
  ) {
    throw new Error("Database setup required. Run supabase-rls-policies.sql in Supabase SQL Editor, then refresh this app.");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .ilike("email", `%${normalizedQuery}%`)
    .neq("id", currentUserId)
    .limit(8);

  if (error) {
    if (error.message?.includes("profiles.email") || error.message?.includes("'email' column")) {
      throw new Error("Database setup required. Your profiles table needs an email column. Run supabase-rls-policies.sql, then refresh.");
    }

    throw error;
  }

  return (data ?? []).map(normalizeProfile);
}

async function createDirectChat(friendProfile, currentUserId) {
  const { data: rpcRoomId, error: rpcError } = await supabase.rpc("create_direct_chat", {
    friend_user_id: friendProfile.id
  });

  if (!rpcError && rpcRoomId) {
    return rpcRoomId;
  }

  const { data: existingMemberships, error: membershipsError } = await supabase
    .from("room_members")
    .select("room_id, user_id, rooms(id, is_group)")
    .in("user_id", [currentUserId, friendProfile.id]);

  if (!membershipsError) {
    const roomMemberCounts = new Map();

    for (const membership of existingMemberships ?? []) {
      if (membership.rooms?.is_group) {
        continue;
      }

      const current = roomMemberCounts.get(membership.room_id) ?? new Set();
      current.add(membership.user_id);
      roomMemberCounts.set(membership.room_id, current);
    }

    for (const [roomId, members] of roomMemberCounts.entries()) {
      if (members.has(currentUserId) && members.has(friendProfile.id)) {
        return roomId;
      }
    }
  }

  const roomPayload = {
    name: getProfileName(friendProfile),
    room_name: getProfileName(friendProfile),
    is_group: false,
    description: `Direct chat with ${friendProfile.email}`
  };

  let { data: room, error: roomError } = await supabase
    .from("rooms")
    .insert(roomPayload)
    .select("id")
    .single();

  if (roomError?.message?.includes("'name' column") || roomError?.message?.includes("rooms.name")) {
    const retry = await supabase
      .from("rooms")
      .insert({
        room_name: roomPayload.room_name,
        is_group: roomPayload.is_group,
        description: roomPayload.description
      })
      .select("id")
      .single();

    room = retry.data;
    roomError = retry.error;
  }

  if (roomError) {
    throw roomError;
  }

  await insertRoomMember(room.id, currentUserId, "owner");
  await insertRoomMember(room.id, friendProfile.id, "member");

  return room.id;
}

async function insertRoomMember(roomId, userId, role) {
  const { error } = await supabase.from("room_members").insert({
    room_id: roomId,
    user_id: userId
  });

  if (!error || error.code === "23505") {
    return;
  }

  const { error: roleInsertError } = await supabase.from("room_members").insert({
    room_id: roomId,
    user_id: userId,
    role
  });

  if (roleInsertError && roleInsertError.code !== "23505") {
    throw roleInsertError;
  }
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
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [friendSearchText, setFriendSearchText] = useState("");
  const [friendResults, setFriendResults] = useState([]);
  const [friendSearchError, setFriendSearchError] = useState("");
  const [friendSearchNotice, setFriendSearchNotice] = useState("");
  const [isFriendSearching, setIsFriendSearching] = useState(false);
  const [addingFriendId, setAddingFriendId] = useState(null);

  useEffect(() => {
    if (!isMobile) {
      setIsSidebarVisible(false);
      return;
    }

    if (!selectedRoomId) {
      setIsSidebarVisible(true);
    }
  }, [isMobile, selectedRoomId]);

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

  const loadRooms = useCallback(async (preferredRoomId = null) => {
    if (!session?.user?.id) {
      setRooms([]);
      setSelectedRoomId(null);
      return [];
    }

    setIsRoomsLoading(true);
    setRoomsError("");

    try {
      await ensureAuthenticatedProfile(session.user);
      const nextRooms = await fetchUserRooms(session.user.id);

      setRooms(nextRooms);
      setSelectedRoomId((currentRoomId) => {
        if (preferredRoomId && nextRooms.some((room) => room.id === preferredRoomId)) {
          return preferredRoomId;
        }

        if (nextRooms.some((room) => room.id === currentRoomId)) {
          return currentRoomId;
        }

        return null;
      });

      return nextRooms;
    } catch (error) {
      setRooms([]);
      setSelectedRoomId(null);
      setRoomsError(error.message ?? "Unable to load rooms.");
      return [];
    } finally {
      setIsRoomsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    let isMounted = true;

    if (!session?.user?.id) {
      setRooms([]);
      setSelectedRoomId(null);
      return () => {
        isMounted = false;
      };
    }

    loadRooms().then(() => {
      if (!isMounted) {
        return;
      }
    });

    return () => {
      isMounted = false;
    };
  }, [loadRooms, session?.user?.id]);

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
    setFriendSearchText("");
    setFriendResults([]);
    setFriendSearchError("");
    setFriendSearchNotice("");
    await supabase.auth.signOut();
  }, []);

  const handleFriendSearch = useCallback(async () => {
    const query = friendSearchText.trim();

    setFriendSearchError("");
    setFriendSearchNotice("");
    setFriendResults([]);

    if (!session?.user?.id) {
      return;
    }

    if (query.length < 3) {
      setFriendSearchError("Type at least 3 characters of an email address.");
      return;
    }

    setIsFriendSearching(true);

    try {
      const results = await searchProfilesByEmail(query, session.user.id);
      setFriendResults(results);

      if (results.length === 0) {
        setFriendSearchError("No matching users found.");
      } else {
        setFriendSearchNotice(`${results.length} verified ${results.length === 1 ? "person" : "people"} found.`);
      }
    } catch (searchError) {
      setFriendSearchError(searchError.message ?? "Unable to search users.");
    } finally {
      setIsFriendSearching(false);
    }
  }, [friendSearchText, session?.user?.id]);

  const handleAddFriend = useCallback(async (friend) => {
    if (!session?.user?.id) {
      return;
    }

    setAddingFriendId(friend.id);
    setFriendSearchError("");
    setFriendSearchNotice("");

    try {
      const roomId = await createDirectChat(friend, session.user.id);
      await loadRooms(roomId);
      setSelectedRoomId(roomId);
      setFriendResults([]);
      setFriendSearchText("");
      setFriendSearchNotice(`Chat with ${friend.displayName} is ready.`);

      if (isMobile) {
        setIsSidebarVisible(false);
      }
    } catch (addError) {
      setFriendSearchError(addError.message ?? "Unable to create chat.");
    } finally {
      setAddingFriendId(null);
    }
  }, [isMobile, loadRooms, session?.user?.id]);

  const handleRefreshRooms = useCallback(() => {
    loadRooms();
  }, [loadRooms]);

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
                <Text style={styles.appKicker}>Forge</Text>
                <Text style={styles.appTitle}>Command Center</Text>
                <Text numberOfLines={1} style={styles.appSubtitle}>
                  {session.user.email}
                </Text>
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={handleRefreshRooms}
                  style={styles.headerButton}
                >
                  <Text style={styles.headerButtonText}>R</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={handleSignOut}
                  style={styles.signOutButton}
                >
                  <Text style={styles.signOutButtonText}>Sign Out</Text>
                </TouchableOpacity>
                {isMobile && selectedRoomId ? (
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
                placeholder="Search people, rooms, messages"
                placeholderTextColor="#87939a"
                style={styles.searchInput}
              />
              <View style={styles.sidebarStats}>
                <View style={styles.statPill}>
                  <Text style={styles.statValue}>{rooms.length}</Text>
                  <Text style={styles.statLabel}>Chats</Text>
                </View>
                <View style={styles.statPill}>
                  <Text style={styles.statValue}>{rooms.filter((room) => !room.is_group).length}</Text>
                  <Text style={styles.statLabel}>Direct</Text>
                </View>
                <View style={styles.statPill}>
                  <Text style={styles.statValue}>Live</Text>
                  <Text style={styles.statLabel}>Realtime</Text>
                </View>
              </View>
            </View>

            <View style={styles.friendFinder}>
              <Text style={styles.sectionLabel}>Add friend by email</Text>
              <View style={styles.friendSearchRow}>
                <TextInput
                  value={friendSearchText}
                  onChangeText={setFriendSearchText}
                  onSubmitEditing={handleFriendSearch}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="friend@gmail.com"
                  placeholderTextColor="#87939a"
                  style={styles.friendSearchInput}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={isFriendSearching}
                  onPress={handleFriendSearch}
                  style={[styles.findButton, isFriendSearching && styles.findButtonDisabled]}
                >
                  <Text style={styles.findButtonText}>{isFriendSearching ? "..." : "Find"}</Text>
                </TouchableOpacity>
              </View>
              {friendSearchError ? <Text style={styles.friendSearchError}>{friendSearchError}</Text> : null}
              {!friendSearchError && friendSearchNotice ? (
                <Text style={styles.friendSearchNotice}>{friendSearchNotice}</Text>
              ) : null}
              {friendResults.map((friend) => (
                <View key={friend.id} style={styles.friendResult}>
                  <View style={styles.friendAvatar}>
                    <Text style={styles.friendAvatarText}>{friend.initials}</Text>
                  </View>
                  <View style={styles.friendCopy}>
                    <Text numberOfLines={1} style={styles.friendName}>{friend.displayName}</Text>
                    <Text numberOfLines={1} style={styles.friendEmail}>{friend.email}</Text>
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={addingFriendId === friend.id}
                    onPress={() => handleAddFriend(friend)}
                    style={styles.addButton}
                  >
                    <Text style={styles.addButtonText}>
                      {addingFriendId === friend.id ? "..." : "Add"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            {roomsError ? <Text style={styles.sidebarMessage}>{roomsError}</Text> : null}
            {!roomsError && isRoomsLoading ? (
              <View style={styles.sidebarLoader}>
                <ActivityIndicator color="#075e54" />
              </View>
            ) : null}
            {!roomsError && !isRoomsLoading && filteredRooms.length === 0 ? (
              <View style={styles.sidebarEmpty}>
                <Text style={styles.sidebarEmptyTitle}>No conversations here yet</Text>
                <Text style={styles.sidebarEmptyCopy}>Find a friend by email and start a private chat.</Text>
              </View>
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
            {isMobile && !selectedRoom ? (
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
                <Text style={styles.emptyChatTitle}>Choose your next conversation</Text>
                <Text style={styles.emptyChatCopy}>Your chats stay closed until you open them. Search, add a friend, or pick a room from the command center.</Text>
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
    backgroundColor: "#07111f"
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
    backgroundColor: "#07111f"
  },
  sidebar: {
    width: 430,
    maxWidth: "42%",
    backgroundColor: "rgba(248,250,252,0.88)",
    backdropFilter: "blur(22px)",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "rgba(203,213,225,0.55)"
  },
  mobileSidebar: {
    width: "100%",
    maxWidth: "100%",
    flex: 1
  },
  sidebarHeader: {
    minHeight: 112,
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: "rgba(7,17,31,0.92)",
    backdropFilter: "blur(24px)",
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
    fontSize: 26,
    fontWeight: "800"
  },
  appKicker: {
    marginBottom: 4,
    color: "#67e8f9",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  appSubtitle: {
    marginTop: 4,
    color: "#a7b6c8",
    fontSize: 13
  },
  signOutButton: {
    minHeight: 36,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f3654"
  },
  signOutButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800"
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f3654"
  },
  headerButtonText: {
    color: "#ffffff",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900"
  },
  searchWrap: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: "rgba(238,244,248,0.78)"
  },
  searchInput: {
    height: 46,
    borderRadius: 8,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,255,255,0.82)",
    backdropFilter: "blur(16px)",
    color: "#1f2933",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#dbe7ef"
  },
  sidebarStats: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8
  },
  statPill: {
    flex: 1,
    minHeight: 54,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "#dbe7ef"
  },
  statValue: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "900"
  },
  statLabel: {
    marginTop: 3,
    color: "#64748b",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  friendFinder: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    backgroundColor: "rgba(238,244,248,0.78)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#dbe3ea"
  },
  sectionLabel: {
    marginBottom: 8,
    color: "#425466",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  friendSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  friendSearchInput: {
    flex: 1,
    height: 46,
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: "rgba(255,255,255,0.82)",
    color: "#1f2933",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#dbe7ef"
  },
  findButton: {
    height: 46,
    minWidth: 70,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f766e"
  },
  findButtonDisabled: {
    opacity: 0.6
  },
  findButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900"
  },
  friendSearchError: {
    marginTop: 8,
    color: "#a16207",
    fontSize: 12,
    fontWeight: "700"
  },
  friendSearchNotice: {
    marginTop: 8,
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800"
  },
  friendResult: {
    marginTop: 10,
    minHeight: 64,
    borderRadius: 8,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.82)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  friendAvatar: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#38bdf8"
  },
  friendAvatarText: {
    color: "#082f49",
    fontSize: 12,
    fontWeight: "900"
  },
  friendCopy: {
    flex: 1,
    minWidth: 0
  },
  friendName: {
    color: "#1f2933",
    fontSize: 14,
    fontWeight: "800"
  },
  friendEmail: {
    marginTop: 2,
    color: "#64748b",
    fontSize: 12
  },
  addButton: {
    minWidth: 58,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#102a43"
  },
  addButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900"
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
  sidebarEmpty: {
    margin: 14,
    borderRadius: 8,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.84)",
    borderWidth: 1,
    borderColor: "#e2e8f0"
  },
  sidebarEmptyTitle: {
    color: "#172033",
    fontSize: 16,
    fontWeight: "900"
  },
  sidebarEmptyCopy: {
    marginTop: 6,
    color: "#64748b",
    fontSize: 13,
    lineHeight: 19
  },
  roomList: {
    paddingVertical: 8
  },
  roomItem: {
    minHeight: 84,
    marginHorizontal: 10,
    marginVertical: 4,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "#ffffff"
  },
  roomItemActive: {
    backgroundColor: "#e6fffb",
    borderColor: "#99f6e4"
  },
  roomAvatar: {
    width: 54,
    height: 54,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#67e8f9"
  },
  roomAvatarText: {
    color: "#0e3a47",
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
    fontWeight: "900"
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
    color: "#64748b",
    fontSize: 14
  },
  chatPanel: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "#07111f"
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
    backgroundColor: "#07111f"
  },
  emptyChatTitle: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "900"
  },
  emptyChatCopy: {
    maxWidth: 420,
    marginTop: 10,
    color: "#9fb4ca",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center"
  }
});
