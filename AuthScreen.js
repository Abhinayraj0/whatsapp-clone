import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { supabase, supabaseConfigError } from "./supabaseClient";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function registerProfileFallback(user, displayName) {
  if (!user?.id) {
    return;
  }

  const emailName = user.email?.split("@")[0] ?? "Member";
  const name = displayName.trim() || emailName;

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email,
      full_name: name,
      updated_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );

  if (error) {
    throw error;
  }
}

export default function AuthScreen() {
  const [mode, setMode] = useState("sign-in");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(supabaseConfigError);

  const isSignup = mode === "sign-up";

  const validation = useMemo(() => {
    if (isSignup && displayName.trim().length > 0 && displayName.trim().length < 2) {
      return "Name must be at least 2 characters.";
    }

    if (!emailPattern.test(email.trim())) {
      return "Enter a valid email address.";
    }

    if (password.length < 8) {
      return "Password must be at least 8 characters.";
    }

    return "";
  }, [displayName, email, password, isSignup]);

  const canSubmit = !supabaseConfigError && !validation && !isSubmitting;

  const handleSubmit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    setNotice("");
    setError(supabaseConfigError);

    if (supabaseConfigError) {
      return;
    }

    if (validation) {
      setError(validation);
      return;
    }

    setIsSubmitting(true);

    try {
      if (isSignup) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              full_name: displayName.trim()
            }
          }
        });

        if (signUpError) {
          throw signUpError;
        }

        if (data?.user) {
          try {
            await registerProfileFallback(data.user, displayName);
          } catch (profileError) {
            console.warn("Profile registration fallback deferred:", profileError.message);
          }
        }

        if (!data?.session) {
          setNotice("Account created. Check your email to confirm before signing in.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password
        });

        if (signInError) {
          throw signInError;
        }
      }
    } catch (submitError) {
      setError(submitError.message ?? "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode(isSignup ? "sign-in" : "sign-up");
    setNotice("");
    setError(supabaseConfigError);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.screen}
      >
        <View style={styles.backgroundPanel}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandKicker}>Forge</Text>
            <Text style={styles.brandTitle}>Your private command center.</Text>
            <Text style={styles.brandSubtitle}>Realtime direct messaging with verified identity and a calmer workspace.</Text>
            <View style={styles.featureGrid}>
              <View style={styles.featurePill}>
                <Text style={styles.featureValue}>Live</Text>
                <Text style={styles.featureLabel}>Delivery</Text>
              </View>
              <View style={styles.featurePill}>
                <Text style={styles.featureValue}>Private</Text>
                <Text style={styles.featureLabel}>Rooms</Text>
              </View>
              <View style={styles.featurePill}>
                <Text style={styles.featureValue}>Email</Text>
                <Text style={styles.featureLabel}>Discovery</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.segmentedControl}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setMode("sign-in")}
                style={[styles.segment, !isSignup && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, !isSignup && styles.segmentTextActive]}>Login</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setMode("sign-up")}
                style={[styles.segment, isSignup && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, isSignup && styles.segmentTextActive]}>Signup</Text>
              </Pressable>
            </View>

            <Text style={styles.cardTitle}>{isSignup ? "Create your account" : "Welcome back"}</Text>
            <Text style={styles.cardCopy}>
              {isSignup ? "Use your workspace email to join authorized rooms." : "Sign in to continue to your rooms."}
            </Text>

            {isSignup ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Display name</Text>
                <TextInput
                  autoCapitalize="words"
                  autoComplete="name"
                  onChangeText={setDisplayName}
                  placeholder="Avery Stone"
                  placeholderTextColor="#8a94a6"
                  style={styles.input}
                  value={displayName}
                />
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="you@company.com"
                placeholderTextColor="#8a94a6"
                style={styles.input}
                textContentType="emailAddress"
                value={email}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete={isSignup ? "new-password" : "password"}
                onChangeText={setPassword}
                onSubmitEditing={handleSubmit}
                placeholder="Minimum 8 characters"
                placeholderTextColor="#8a94a6"
                secureTextEntry
                style={styles.input}
                textContentType={isSignup ? "newPassword" : "password"}
                value={password}
              />
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {!error && notice ? <Text style={styles.noticeText}>{notice}</Text> : null}

            <TouchableOpacity
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={handleSubmit}
              style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>{isSignup ? "Create account" : "Sign in"}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity accessibilityRole="button" onPress={switchMode} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>
                {isSignup ? "Already have an account? Login" : "Need an account? Signup"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#07111f"
  },
  screen: {
    flex: 1
  },
  backgroundPanel: {
    flex: 1,
    paddingHorizontal: 22,
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#07111f"
  },
  brandBlock: {
    width: "100%",
    maxWidth: 430,
    marginBottom: 22
  },
  brandKicker: {
    color: "#67e8f9",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  brandTitle: {
    marginTop: 8,
    color: "#ffffff",
    fontSize: 40,
    lineHeight: 46,
    fontWeight: "900"
  },
  brandSubtitle: {
    marginTop: 10,
    color: "#b6c7d8",
    fontSize: 16,
    lineHeight: 23
  },
  featureGrid: {
    marginTop: 18,
    flexDirection: "row",
    gap: 8
  },
  featurePill: {
    flex: 1,
    minHeight: 58,
    borderRadius: 8,
    padding: 10,
    backgroundColor: "#10243c",
    borderWidth: 1,
    borderColor: "#1f3654"
  },
  featureValue: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900"
  },
  featureLabel: {
    marginTop: 4,
    color: "#8fb2c8",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  card: {
    width: "100%",
    maxWidth: 430,
    borderRadius: 8,
    padding: 22,
    backgroundColor: "#ffffff",
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 8
  },
  segmentedControl: {
    height: 44,
    padding: 4,
    borderRadius: 8,
    backgroundColor: "#edf2f7",
    flexDirection: "row"
  },
  segment: {
    flex: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center"
  },
  segmentActive: {
    backgroundColor: "#0f766e"
  },
  segmentText: {
    color: "#475569",
    fontSize: 14,
    fontWeight: "800"
  },
  segmentTextActive: {
    color: "#ffffff"
  },
  cardTitle: {
    marginTop: 24,
    color: "#172033",
    fontSize: 25,
    fontWeight: "900"
  },
  cardCopy: {
    marginTop: 6,
    marginBottom: 18,
    color: "#64748b",
    fontSize: 14,
    lineHeight: 20
  },
  fieldGroup: {
    marginBottom: 14
  },
  label: {
    marginBottom: 7,
    color: "#1f2937",
    fontSize: 13,
    fontWeight: "800"
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#d7dee8",
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: "#fbfdff",
    color: "#0f172a",
    fontSize: 16
  },
  errorText: {
    marginTop: 2,
    marginBottom: 12,
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: "700"
  },
  noticeText: {
    marginTop: 2,
    marginBottom: 12,
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "700"
  },
  primaryButton: {
    height: 50,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f766e"
  },
  primaryButtonDisabled: {
    opacity: 0.55
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900"
  },
  secondaryButton: {
    marginTop: 14,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryButtonText: {
    color: "#0f766e",
    fontSize: 14,
    fontWeight: "800"
  }
});
