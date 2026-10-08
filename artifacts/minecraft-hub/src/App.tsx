import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import Layout from "@/components/Layout";
import HomePage from "@/pages/home";
import UploadPage from "@/pages/upload";
import SettingsPage from "@/pages/settings";
import FileDetailPage from "@/pages/file-detail";
import ProfilePage from "@/pages/profile";
import UserProfilePage from "@/pages/user-profile";
import NotFound from "@/pages/not-found";
import { useTheme } from "@/hooks/use-theme";
import { LanguageProvider } from "@/contexts/language-context";
import { useAppAuth } from "@/contexts/auth-context";
import { FirebaseAuthProvider } from "@/auth/firebase-provider";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Clears the React Query cache whenever the signed-in user changes. */
function QueryCacheInvalidator() {
  const { user, isLoaded } = useAppAuth();
  const qc = useQueryClient();
  const prevIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    const id = user?.id ?? null;
    if (prevIdRef.current !== undefined && prevIdRef.current !== id) {
      qc.clear();
    }
    prevIdRef.current = id;
  }, [isLoaded, user?.id, qc]);

  return null;
}

function ThemeSyncer() {
  useTheme();
  return null;
}

function AppContent() {
  return (
    <>
      <QueryCacheInvalidator />
      <ThemeSyncer />
      <TooltipProvider>
        <Switch>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route>
            <Layout>
              <Switch>
                <Route path="/" component={HomePage} />
                <Route path="/upload" component={UploadPage} />
                <Route path="/settings" component={SettingsPage} />
                <Route path="/profile" component={ProfilePage} />
                <Route path="/u/:username" component={UserProfilePage} />
                <Route path="/files/:id" component={FileDetailPage} />
                <Route component={NotFound} />
              </Switch>
            </Layout>
          </Route>
        </Switch>
        <Toaster />
      </TooltipProvider>
    </>
  );
}

function AppRoutes() {
  const content = <AppContent />;

  return (
    <QueryClientProvider client={queryClient}>
      <FirebaseAuthProvider>{content}</FirebaseAuthProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <LanguageProvider>
      <WouterRouter base={basePath}>
        <AppRoutes />
      </WouterRouter>
    </LanguageProvider>
  );
}

export default App;
