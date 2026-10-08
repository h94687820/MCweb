import { createContext, useContext } from "react";

export type AppUser = {
  id: string;
  imageUrl: string | null;
  fullName: string | null;
  firstName: string | null;
  emailAddress: string | null;
};

export type SignOutOptions = {
  redirectUrl?: string;
};

export type AppAuthValue = {
  user: AppUser | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  getToken: () => Promise<string | null>;
  signOut: (options?: SignOutOptions) => Promise<void>;
};

export const AuthContext = createContext<AppAuthValue | null>(null);

export function useAppAuth(): AppAuthValue {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAppAuth must be used inside an auth provider");
  return auth;
}
