// ==========================================
// DOM ELEMENT SELECTORS
// ==========================================
const authContainer = document.getElementById("auth-container");
const dashboardContainer = document.getElementById("dashboard-container");
const chatFrameArea = document.getElementById("chat-frame-area");
const chatMessagesBox = document.getElementById("chat-messages-box");
const chatInputText = document.getElementById("chat-input-text");
const chatSendForm = document.getElementById("chat-send-form");

const emailInput = document.getElementById("auth-email");
const passwordInput = document.getElementById("auth-password");
const userDisplayEmail = document.getElementById("user-display-email");
const authForm = document.getElementById("auth-form");
const authStatus = document.getElementById("auth-status");
const displayNameInput = document.getElementById("auth-display-name");
const displayNameGroup = document.getElementById("group-display-name");
const authModePrompt = document.getElementById("auth-mode-prompt");
const authModeToggle = document.getElementById("auth-mode-toggle");

const btnAuthAction = document.getElementById("btn-auth-action");
const btnSendMessage = document.getElementById("btn-send-message");
const btnLogout = document.getElementById("btn-logout");

// ==========================================
// CONFIGURATION VARIABLES
// ==========================================
let messageSubscription = null;
let isSignUpMode = false;

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  authStatus.textContent = "The authentication service could not be loaded. Please try again later.";
  throw new Error("Supabase JavaScript client failed to load.");
}

const supabaseInstance = supabase.createClient(
  SUPABASE_CONFIG.URL,
  SUPABASE_CONFIG.ANON_KEY,
);

// ==========================================
// AUTHENTICATION EXECUTION FLOW
// ==========================================
authModeToggle.addEventListener("click", () => {
  isSignUpMode = !isSignUpMode;
  displayNameGroup.hidden = !isSignUpMode;
  displayNameInput.required = isSignUpMode;
  passwordInput.autocomplete = isSignUpMode ? "new-password" : "current-password";
  btnAuthAction.textContent = isSignUpMode ? "Create Account" : "Enter Chat";
  authModePrompt.textContent = isSignUpMode ? "Already have an account?" : "Need an account?";
  authModeToggle.textContent = isSignUpMode ? "Sign in" : "Sign up";
  authStatus.textContent = isSignUpMode
    ? "Account creation must be enabled in your Supabase Auth settings."
    : "Sign in or create an account to test the chat.";
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  const displayName = displayNameInput.value.trim();
  authStatus.textContent = isSignUpMode ? "Creating account..." : "Signing in...";
  btnAuthAction.disabled = true;
  try {
    const result = isSignUpMode
      ? await supabaseInstance.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        })
      : await supabaseInstance.auth.signInWithPassword({ email, password });

    if (result.error) {
      authStatus.textContent = (isSignUpMode ? "Sign-up failed: " : "Sign-in failed: ") + result.error.message;
      console.error("Auth System Diagnostics:", result.error);
    } else if (isSignUpMode && !result.data.session) {
      authStatus.textContent = "Account created. Check your email to confirm it, then sign in.";
    }
  } catch (error) {
    console.error("Authentication request failed:", error);
    authStatus.textContent = "Could not reach the authentication service. Check your connection and try again.";
  } finally {
    btnAuthAction.disabled = false;
  }
});

btnLogout.addEventListener("click", async () => {
  btnLogout.disabled = true;
  try {
    const { error } = await supabaseInstance.auth.signOut();
    if (error) {
      console.error("Sign-out failed:", error);
      authStatus.textContent = "Could not sign out: " + error.message;
    }
  } catch (error) {
    console.error("Sign-out request failed:", error);
    authStatus.textContent = "Could not reach the authentication service. Try signing out again.";
  } finally {
    btnLogout.disabled = false;
  }
});

// ==========================================
// REAL-TIME CHAT LOGIC
// ==========================================
function appendMessageToScreen(msg) {
  if (!msg || typeof msg.text !== "string") return;

  const messageElement = document.createElement("div");
  messageElement.className = "chat-bubble";
  messageElement.style.marginBottom = "8px";
  const username = document.createElement("strong");
  username.textContent = (msg.username || "Unknown user") + ":";
  const text = document.createElement("span");
  text.textContent = msg.text;
  messageElement.append(username, text);

  if (typeof msg.created_at === "string") {
    const sentAt = new Date(msg.created_at);
    if (Number.isFinite(sentAt.getTime())) {
      const timestamp = document.createElement("time");
      timestamp.className = "chat-timestamp";
      timestamp.dateTime = sentAt.toISOString();
      timestamp.textContent = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(sentAt);
      messageElement.appendChild(timestamp);
    }
  }

  chatMessagesBox.appendChild(messageElement);
  chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;
}

function showChatNotice(message) {
  const notice = document.createElement("p");
  notice.className = "chat-notice";
  notice.textContent = message;
  chatMessagesBox.replaceChildren(notice);
}

async function fetchChatHistory() {
  showChatNotice("Loading messages...");
  try {
    const { data: history, error } = await supabaseInstance
      .from("messages")
      .select("username, text, created_at")
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) {
      console.error("History fetch error:", error);
      showChatNotice("Failed to load messages. Please try again later.");
      return;
    }

    chatMessagesBox.replaceChildren();
    if (history && history.length > 0) {
      history.forEach(appendMessageToScreen);
    } else {
      showChatNotice("No messages yet. Start the conversation.");
    }
  } catch (error) {
    console.error("History fetch error:", error);
    showChatNotice("Could not reach message history. Check your connection and try again.");
  }
}

function initializeRealtimeChat() {
  if (messageSubscription) {
    supabaseInstance.removeChannel(messageSubscription);
  }

  messageSubscription = supabaseInstance
    .channel("vault-stream")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        if (payload && payload.new) {
          appendMessageToScreen(payload.new);
        }
      },
    )
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("Realtime channel error:", error || status);
        showChatNotice("Live updates are unavailable. Reload the page to reconnect.");
      }
    });
}

chatSendForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const textValue = chatInputText.value.trim();
  if (!textValue || textValue.length > 2000) return;

  btnSendMessage.disabled = true;
  try {
    const { data, error: sessionError } = await supabaseInstance.auth.getSession();
    if (sessionError) throw sessionError;
    const currentSession = data.session;
    if (!currentSession) {
      showChatNotice("Your session has expired. Sign in again.");
      return;
    }

    const profileName =
      currentSession.user.user_metadata?.display_name ||
      currentSession.user.email ||
      "Unknown user";

    const { error } = await supabaseInstance.from("messages").insert([
      {
        text: textValue,
        user_id: currentSession.user.id,
        username: profileName,
      },
    ]);

    if (error) throw error;
    chatInputText.value = "";
  } catch (error) {
    console.error("Message send failed:", error);
    showChatNotice("Message could not be sent. Check your connection and try again.");
  } finally {
    btnSendMessage.disabled = false;
  }
});

// ==========================================
// SESSION GATEKEEPER
// ==========================================
async function loadChatForSession(userId) {
  try {
    const { data, error } = await supabaseInstance.auth.getSession();
    if (error) throw error;
    if (!data.session || data.session.user.id !== userId) return;

    await fetchChatHistory();
    initializeRealtimeChat();
  } catch (error) {
    console.error("Chat initialization failed:", error);
    showChatNotice("Could not initialize chat. Reload the page to try again.");
  }
}

supabaseInstance.auth.onAuthStateChange((_event, session) => {
  if (session && session.user) {
    authContainer.style.display = "none";
    dashboardContainer.style.display = "block";
    chatFrameArea.style.display = "block";

    const displayName =
      session.user.user_metadata?.display_name || session.user.email;
    userDisplayEmail.textContent = displayName;

    window.setTimeout(() => {
      void loadChatForSession(session.user.id);
    }, 0);
  } else {
    authContainer.style.display = "block";
    dashboardContainer.style.display = "none";
    chatFrameArea.style.display = "none";
    userDisplayEmail.textContent = "";
    chatMessagesBox.replaceChildren();

    if (messageSubscription) {
      supabaseInstance.removeChannel(messageSubscription);
      messageSubscription = null;
    }
  }
});
