import { useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from "firebase/auth";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { AuthContext, type AppUser } from "@/contexts/auth-context";
import { getFirebaseAuth } from "./firebase";

function toAppUser(user: User | null): AppUser | null {
  if (!user) return null;
  return {
    id: user.uid,
    imageUrl: user.photoURL,
    fullName: user.displayName,
    firstName: user.displayName?.trim().split(/\s+/)[0] ?? null,
    emailAddress: user.email,
  };
}

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const auth = getFirebaseAuth();
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setAuthTokenGetter(null);
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setAuthTokenGetter(nextUser ? () => nextUser.getIdToken() : null);
      setUser(nextUser);
      setIsLoaded(true);
    });
    return () => {
      unsubscribe();
      setAuthTokenGetter(null);
    };
  }, [auth]);

  return (
    <AuthContext.Provider
      value={{
        user: toAppUser(user),
        isLoaded,
        isSignedIn: !!user,
        getToken: async () => auth.currentUser?.getIdToken() ?? null,
        signOut: async (options) => {
          await firebaseSignOut(auth);
          if (options?.redirectUrl) window.location.assign(options.redirectUrl);
        },
      }}
    >
      {isLoaded ? (
        children
      ) : (
        <div
          className="grid min-h-screen place-items-center bg-background"
          role="status"
          aria-label="Loading sign-in session"
        >
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      )}
    </AuthContext.Provider>
  );
}
