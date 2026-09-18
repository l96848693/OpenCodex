import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AppErrorBoundary, MobileApp } from "./App";
import { reportClientError } from "./services/mobile-api";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true } },
});

window.addEventListener("error", (event) => reportClientError("mobile_render_error", event.error || event.message));
window.addEventListener("unhandledrejection", (event) => reportClientError("mobile_unhandled_rejection", event.reason));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/mobile">
          <MobileApp />
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>
);
