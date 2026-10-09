import { useState, type FormEvent } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { Link, useLocation } from "wouter";
import { getFirebaseAuth } from "@/auth/firebase";
import { useLanguage } from "@/contexts/language-context";

type FirebaseAuthFormProps = {
  mode: "sign-in" | "sign-up";
};

export default function FirebaseAuthForm({ mode }: FirebaseAuthFormProps) {
  const [, setLocation] = useLocation();
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isSignIn = mode === "sign-in";

  function translatedAuthError(cause: unknown, fallback: string): string {
    const code =
      typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
        ? cause.code
        : "";
    switch (code) {
      case "auth/invalid-email":
        return t.auth.invalidEmail;
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
      case "auth/user-disabled":
        return t.auth.invalidCredentials;
      case "auth/email-already-in-use":
        return t.auth.emailInUse;
      case "auth/weak-password":
        return t.auth.weakPassword;
      case "auth/too-many-requests":
        return t.auth.tooManyRequests;
      case "auth/network-request-failed":
        return t.auth.networkError;
      case "auth/popup-closed-by-user":
        return t.auth.popupClosed;
      case "auth/popup-blocked":
        return t.auth.popupBlocked;
      default:
        return fallback;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const auth = getFirebaseAuth();
      if (isSignIn) {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
      setLocation("/");
    } catch (cause) {
      setError(translatedAuthError(cause, t.auth.authenticationFailed));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
      setLocation("/");
    } catch (cause) {
      setError(translatedAuthError(cause, t.auth.googleSignInFailed));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordReset() {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError(t.auth.enterEmailFirst);
      return;
    }
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
      setNotice(t.auth.resetEmailSent);
    } catch (cause) {
      setError(translatedAuthError(cause, t.auth.resetEmailFailed));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <section className="w-full max-w-md border border-border bg-card p-6 shadow-2xl sm:p-8">
        <div className="mb-7 text-center">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="WhiteWase" className="mx-auto mb-4 h-10 w-10 rounded-sm" />
          <h1 className="text-2xl font-bold text-foreground">{isSignIn ? t.auth.signInTitle : t.auth.signUpTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t.auth.brandSubtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">{t.auth.email}</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full border border-border bg-background px-3 py-2.5 text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">{t.auth.password}</span>
            <input
              type="password"
              autoComplete={isSignIn ? "current-password" : "new-password"}
              minLength={6}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full border border-border bg-background px-3 py-2.5 text-foreground outline-none focus:border-primary"
            />
          </label>

          {error && <p role="alert" className="break-words border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          {notice && <p role="status" className="border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? t.auth.pleaseWait : isSignIn ? t.auth.signIn : t.auth.signUp}
          </button>
        </form>

        {isSignIn && (
          <button type="button" onClick={() => void handlePasswordReset()} className="mt-3 w-full text-xs text-muted-foreground hover:text-primary">
            {t.auth.forgotPassword}
          </button>
        )}

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {t.auth.or}
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={() => void handleGoogleSignIn()}
          disabled={busy}
          className="w-full border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:border-primary/60 disabled:opacity-60"
        >
          {t.auth.continueWithGoogle}
        </button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {isSignIn ? t.auth.newToWhiteWase : t.auth.alreadyHaveAccount}{" "}
          <Link href={isSignIn ? "/sign-up" : "/sign-in"} className="font-medium text-primary hover:underline">
            {isSignIn ? t.auth.signUp : t.auth.signIn}
          </Link>
        </p>
      </section>
    </div>
  );
}
