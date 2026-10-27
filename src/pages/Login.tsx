import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { signIn, getMySchoolMembership } from "../lib/auth";
import { isPlatformAdmin } from "../lib/platformAuth";
import { supabase } from "../lib/supabase";

type LoginMode = "signIn" | "forgot" | "reset";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<LoginMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(() => {
    const state = location.state as { accessDeniedReason?: string } | null;
    return state?.accessDeniedReason ?? "";
  });
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const state = location.state as { accessDeniedReason?: string } | null;
    if (state?.accessDeniedReason) {
      setError(state.accessDeniedReason);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    let mounted = true;

    // Supabase recovery links may deliver their parameters in the URL hash
    // (implicit flow) or query string. Detect the recovery link immediately so
    // the password form is visible even before the auth event is emitted.
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.replace(/^#/, ""),
    );
    const isRecoveryCallback =
      searchParams.get("type") === "recovery" ||
      hashParams.get("type") === "recovery";

    const callbackError =
      searchParams.get("error_description") ||
      hashParams.get("error_description");

    if (callbackError) {
      setMode("signIn");
      setError(decodeURIComponent(callbackError.replace(/\+/g, " ")));
    } else if (isRecoveryCallback) {
      setMode("reset");
      setError("");
      setSuccess("");
      setPassword("");
      setConfirmPassword("");
    }

    async function resolveInvitationCallback() {
      const rawSearch = window.location.search;
      const rawHash = window.location.hash;
      const currentSearchParams = new URLSearchParams(rawSearch);
      const currentHashParams = new URLSearchParams(rawHash.replace(/^#/, ""));

      let pendingInvitation = false;
      try {
        pendingInvitation =
          window.sessionStorage.getItem("schoolos.invitation.pending") === "true";
      } catch {
        pendingInvitation = false;
      }

      const hasInvitationUrl =
        currentSearchParams.has("confirmation_url") ||
        currentSearchParams.get("type") === "invite" ||
        currentSearchParams.has("token_hash") ||
        currentHashParams.get("type") === "invite";

      let hasRecoveredInvitationSession = false;
      if (pendingInvitation && !hasInvitationUrl) {
        const { data } = await supabase.auth.getSession();
        hasRecoveredInvitationSession = Boolean(data.session);
      }

      if (!mounted || (!hasInvitationUrl && !hasRecoveredInvitationSession)) {
        return;
      }

      const target = `/accept-invitation${rawSearch}${rawHash}`;
      navigate(target, { replace: true });
    }

    void resolveInvitationCallback();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("reset");
        setError("");
        setSuccess("");
        setPassword("");
        setConfirmPassword("");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, location.state]);

  function switchToSignIn() {
    setMode("signIn");
    setError("");
    setSuccess("");
    setPassword("");
    setConfirmPassword("");
  }

  function switchToForgotPassword() {
    setMode("forgot");
    setError("");
    setSuccess("");
    setPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (mode === "forgot") {
        const normalizedEmail = email.trim();

        if (!normalizedEmail) {
          setError("Please enter your email address.");
          return;
        }

        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          normalizedEmail,
          {
            redirectTo: `${window.location.origin}/reset-password`,
          },
        );

        if (resetError) {
          setError(resetError.message);
          return;
        }

        setSuccess(
          "If an account exists for this email, a password reset link has been sent. Check your inbox and follow the link to set a new password.",
        );
        return;
      }

      if (mode === "reset") {
        if (!password || !confirmPassword) {
          setError("Please enter and confirm your new password.");
          return;
        }

        if (password !== confirmPassword) {
          setError("The passwords do not match.");
          return;
        }

        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError || !sessionData.session) {
          setError(
            "This password reset link is invalid or has expired. Please request a new reset link and open it on this device.",
          );
          return;
        }

        const { error: updateError } = await supabase.auth.updateUser({
          password,
        });

        if (updateError) {
          setError(updateError.message);
          return;
        }

        await supabase.auth.signOut();
        setMode("signIn");
        setPassword("");
        setConfirmPassword("");
        setSuccess("Your password has been updated. You can now sign in.");
        return;
      }

      const { error: signInError } = await signIn(email, password);

      if (signInError) {
        setError(signInError.message);
        return;
      }

      // Check school/platform access immediately after authentication.
      // This prevents a suspended school user from being navigated into
      // the dashboard even for a moment.
      const { data: schoolAccessData, error: schoolAccessError } =
        await supabase.rpc("get_my_school_access");

      if (schoolAccessError) {
        console.error(
          "School access check failed after sign in:",
          schoolAccessError,
        );
        await supabase.auth.signOut();
        setError(
          "We could not verify your school access. Please try again.",
        );
        return;
      }

      const schoolAccess = schoolAccessData as {
        allowed: boolean;
        has_school: boolean;
        school_status: string | null;
        reason: string | null;
        is_platform_admin: boolean;
      };

      if (!schoolAccess.allowed && schoolAccess.has_school) {
        const message =
          schoolAccess.reason === "school_suspended"
            ? "Your school account has been suspended. Please contact your school administrator or MojaSchool support for assistance."
            : schoolAccess.reason === "school_archived"
              ? "Your school account has been archived. Please contact your school administrator or MojaSchool support for assistance."
              : "Your school account is currently unavailable. Please contact your school administrator or MojaSchool support for assistance.";

        await supabase.auth.signOut();
        setError(message);
        return;
      }

      // Platform Super Admins are not school members. Resolve platform
      // access before checking school membership so they go to /admin
      // instead of being incorrectly sent to school setup.
      const { isAdmin, error: adminError } = await isPlatformAdmin();

      if (adminError) {
        console.error("Platform admin access check failed:", adminError);
        setError(
          "Your account was signed in, but platform access could not be verified. Please try again.",
        );
        return;
      }

      if (isAdmin) {
        navigate("/admin", { replace: true });
        return;
      }

      const { membership, error: membershipError } =
        await getMySchoolMembership();

      if (membershipError) {
        setError(membershipError.message);
        return;
      }

      if (!membership) {
        navigate("/setup-school");
      } else {
        navigate("/");
      }
    } finally {
      setLoading(false);
    }
  }

  const isSignIn = mode === "signIn";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";

  return (
    <div className="min-h-screen w-full min-w-0 overflow-x-hidden bg-MojaSchoolr-background lg:grid lg:grid-cols-[minmax(0,1fr)_520px]">
      {/* Brand panel */}
      <section className="hidden min-h-screen bg-MojaSchoolr-900 px-10 py-10 text-white lg:flex lg:items-center lg:justify-center xl:px-16">
        <div className="w-full max-w-xl">
          
            <img
              src="/MojaSchool-white.svg"
              alt="MojaSchool"
              className="h-auto w-[180px]"
            />

          <div className="mt-14 max-w-lg">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-MojaSchoolr-200">
              School management
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
              Everything your school needs, in one place.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-MojaSchoolr-100">
              Manage students, academics, attendance, communication and school
              operations from one platform.
            </p>
          </div>
        </div>
      </section>

      {/* Form panel */}
      <main className="flex min-h-screen w-full min-w-0 items-center justify-center overflow-x-hidden px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
        <div className="w-full min-w-0 max-w-sm">
          <div className="mb-8 lg:hidden">
            <img
              src="/MojaSchool-white.svg"
              alt="MojaSchool"
              className="h-auto w-[180px]"
            />
            </div>

          {isForgot || isReset ? (
            <button
              type="button"
              onClick={switchToSignIn}
              className="mb-6 inline-flex items-center gap-2 rounded-md text-sm font-medium text-MojaSchoolr-text-secondary transition hover:text-MojaSchoolr-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-MojaSchoolr-500 focus-visible:ring-offset-2"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back to sign in
            </button>
          ) : null}

          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-MojaSchoolr-text">
              {isSignIn
                ? "Welcome back"
                : isForgot
                  ? "Forgot your password?"
                  : "Set a new password"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-MojaSchoolr-text-secondary">
              {isSignIn
                ? "Sign in to your school account."
                : isForgot
                  ? "Enter your email and we'll send you a link to reset your password."
                  : "Choose a new password for your MojaSchoolr account."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 w-full min-w-0 space-y-5">
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700"
              >
                {error}
              </div>
            )}

            {success && (
              <div
                role="status"
                className="flex gap-3 rounded-lg border border-MojaSchoolr-200 bg-MojaSchoolr-50 px-4 py-3 text-sm leading-6 text-MojaSchoolr-800"
              >
                <CheckCircle2
                  size={18}
                  className="mt-0.5 shrink-0 text-MojaSchoolr-600"
                  aria-hidden="true"
                />
                <span>{success}</span>
              </div>
            )}

            {!isReset && (
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-sm font-medium text-MojaSchoolr-text-secondary"
                >
                  Email
                </label>

                <div className="relative">
                  <Mail
                    size={17}
                    aria-hidden="true"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-MojaSchoolr-text-muted"
                  />

                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@school.com"
                    autoComplete="email"
                    required
                    className="h-11 w-full rounded-lg border border-MojaSchoolr-border bg-white pl-10 pr-4 text-sm text-MojaSchoolr-text outline-none transition placeholder:text-slate-400 focus:border-MojaSchoolr-500 focus:ring-2 focus:ring-MojaSchoolr-100"
                  />
                </div>
              </div>
            )}

            {!isForgot && (
              <>
                <div>
                  <label
                    htmlFor="password"
                    className="mb-1.5 block text-sm font-medium text-MojaSchoolr-text-secondary"
                  >
                    {isReset ? "New password" : "Password"}
                  </label>

                  <div className="relative">
                    <LockKeyhole
                      size={17}
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-MojaSchoolr-text-muted"
                    />

                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={
                        isReset
                          ? "Enter your new password"
                          : "Enter your password"
                      }
                      autoComplete={
                        isReset ? "new-password" : "current-password"
                      }
                      required
                      className="h-11 w-full rounded-lg border border-MojaSchoolr-border bg-white pl-10 pr-11 text-sm text-MojaSchoolr-text outline-none transition placeholder:text-slate-400 focus:border-MojaSchoolr-500 focus:ring-2 focus:ring-MojaSchoolr-100"
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      className="absolute right-2.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-MojaSchoolr-text-muted transition hover:bg-MojaSchoolr-50 hover:text-MojaSchoolr-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-MojaSchoolr-500 focus-visible:ring-offset-1"
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                {isReset && (
                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="mb-1.5 block text-sm font-medium text-MojaSchoolr-text-secondary"
                    >
                      Confirm new password
                    </label>

                    <div className="relative">
                      <LockKeyhole
                        size={17}
                        aria-hidden="true"
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-MojaSchoolr-text-muted"
                      />

                      <input
                        id="confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(event) =>
                          setConfirmPassword(event.target.value)
                        }
                        placeholder="Re-enter your new password"
                        autoComplete="new-password"
                        required
                        className="h-11 w-full rounded-lg border border-MojaSchoolr-border bg-white pl-10 pr-11 text-sm text-MojaSchoolr-text outline-none transition placeholder:text-slate-400 focus:border-MojaSchoolr-500 focus:ring-2 focus:ring-MojaSchoolr-100"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setShowConfirmPassword((value) => !value)
                        }
                        aria-label={
                          showConfirmPassword
                            ? "Hide confirmed password"
                            : "Show confirmed password"
                        }
                        className="absolute right-2.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-MojaSchoolr-text-muted transition hover:bg-MojaSchoolr-50 hover:text-MojaSchoolr-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-MojaSchoolr-500 focus-visible:ring-offset-1"
                      >
                        {showConfirmPassword ? (
                          <EyeOff size={17} />
                        ) : (
                          <Eye size={17} />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {isSignIn && (
              <div className="-mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={switchToForgotPassword}
                  className="rounded-md text-sm font-medium text-MojaSchoolr-600 transition hover:text-MojaSchoolr-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-MojaSchoolr-500 focus-visible:ring-offset-2"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex h-11 w-full items-center justify-center rounded-lg bg-MojaSchoolr-600 text-sm font-semibold text-white transition hover:bg-MojaSchoolr-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-MojaSchoolr-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? isForgot
                  ? "Sending reset link..."
                  : isReset
                    ? "Updating password..."
                    : "Signing in..."
                : isForgot
                  ? "Send reset link"
                  : isReset
                    ? "Update password"
                    : "Sign in"}
            </button>

            {isSignIn && (
              <p className="pt-1 text-center text-sm text-MojaSchoolr-text-secondary">
                Don't have an account?{" "}
                <Link
                  to="/signup"
                  className="font-medium text-MojaSchoolr-600 transition hover:text-MojaSchoolr-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-MojaSchoolr-500 focus-visible:ring-offset-2"
                >
                  Create an account
                </Link>
              </p>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
