import React, { useMemo, useState } from "react";
import {
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
import ChatScreen from "./ChatScreen";

const chatRooms = [
  {
    id: "general",
    room_name: "General Chat",
    is_group: true,
    initials: "GC",
    preview: "Perfect. The mobile keyboard behavior matters most.",
    unread: 2
  },
  {
    id: "product",
    room_name: "Product Team",
    is_group: true,
    initials: "PT",
    preview: "Can we review the realtime subscription flow?",
    unread: 0
  },
  {
    id: "maya",
    room_name: "Maya Patel",
    is_group: false,
    initials: "MP",
    preview: "I pushed the schema migration.",
    unread: 1
  },
  {
    id: "ops",
    room_name: "Launch Ops",
    is_group: true,
    initials: "LO",
    preview: "Production checklist is nearly ready.",
    unread: 0
  }
];

export default function App() {
  const { width } = useWindowDimensions();
  const isMobile = width < 760;
  const [selectedRoomId, setSelectedRoomId] = useState(chatRooms[0].id);
  const [isSidebarVisible, setIsSidebarVisible] = useState(!isMobile);
  const [searchText, setSearchText] = useState("");

  const selectedRoom = useMemo(
    () => chatRooms.find((room) => room.id === selectedRoomId) ?? chatRooms[0],
    [selectedRoomId]
  );

  const filteredRooms = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    if (!query) {
      return chatRooms;
    }

    return chatRooms.filter((room) => room.room_name.toLowerCase().includes(query));
  }, [searchText]);

  const showSidebar = !isMobile || isSidebarVisible;
  const showChat = !isMobile || !isSidebarVisible;

  const handleRoomPress = (room) => {
    setSelectedRoomId(room.id);

    if (isMobile) {
      setIsSidebarVisible(false);
    }
  };

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
            <Text style={styles.roomTime}>Now</Text>
          </View>
          <View style={styles.roomPreviewRow}>
            <Text numberOfLines={1} style={styles.roomPreview}>
              {item.preview}
            </Text>
            {item.unread > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{item.unread}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#075e54" />
      <View style={styles.appShell}>
        {showSidebar ? (
          <View style={[styles.sidebar, isMobile && styles.mobileSidebar]}>
            <View style={styles.sidebarHeader}>
              <View>
                <Text style={styles.appTitle}>Chats</Text>
                <Text style={styles.appSubtitle}>Expo + Supabase</Text>
              </View>
              {isMobile ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setIsSidebarVisible(false)}
                  style={styles.headerButton}
                >
                  <Text style={styles.headerButtonText}>×</Text>
                </TouchableOpacity>
              ) : null}
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

            <FlatList
              data={filteredRooms}
              keyExtractor={(item) => item.id}
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
                <Text style={styles.mobileMenuButtonText}>☰</Text>
              </TouchableOpacity>
            ) : null}
            <ChatScreen
              room={selectedRoom}
              showBackButton={isMobile}
              onBackPress={() => setIsSidebarVisible(true)}
            />
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
  appShell: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#d8dbd5"
  },
  sidebar: {
    width: 360,
    maxWidth: "38%",
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
    minHeight: 74,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: "#075e54",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
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
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)"
  },
  headerButtonText: {
    color: "#ffffff",
    fontSize: 28,
    lineHeight: 30
  },
  searchWrap: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f0f2f5"
  },
  searchInput: {
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 16,
    backgroundColor: "#ffffff",
    color: "#1f2933",
    fontSize: 15
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
    borderRadius: 25,
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
    color: "#7b8794",
    fontSize: 12
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
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#25d366"
  },
  unreadText: {
    color: "#063b32",
    fontSize: 12,
    fontWeight: "900"
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,94,84,0.92)"
  },
  mobileMenuButtonText: {
    color: "#ffffff",
    fontSize: 22,
    lineHeight: 24
  }
});
