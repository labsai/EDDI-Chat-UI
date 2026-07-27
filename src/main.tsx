/* ──────────────────────────────────────────────
   EDDI Chat UI — Entry Point
   ────────────────────────────────────────────── */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import { ChatProvider } from "@/store/chat-store";
import { ChatWidget } from "@/components/ChatWidget";
import { AgentPicker } from "@/components/AgentPicker";
import "@/styles/chat.css";

function App() {
  return (
    <ChatProvider>
      <BrowserRouter>
        <Routes>
          {/* Managed agent route */}
          <Route
            path="/chat/managed/:intent/:userId"
            element={<ChatWidget />}
          />
          {/* Direct agent route with userId */}
          <Route
            path="/chat/:environment/:agentId/:userId"
            element={<ChatWidget />}
          />
          {/* Direct agent route (userId via query param) */}
          <Route
            path="/chat/:environment/:agentId"
            element={<ChatWidget />}
          />
          {/* No agent in the URL — offer the ones this instance actually has.
              Redirecting to a made-up agent id here used to dead-end on a spinner. */}
          <Route path="/chat/:environment" element={<AgentPicker />} />
          <Route path="*" element={<AgentPicker />} />
        </Routes>
      </BrowserRouter>
    </ChatProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
