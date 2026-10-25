import { loginHref } from "../api/queries";

/** The login wall. A link, not a fetch: the browser must follow Discord's
 * redirect itself so its cookies and consent screen work. */
export function Login() {
  const next = new URLSearchParams(window.location.search).get("next") ?? "/";
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm space-y-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
        <h1 className="text-lg font-semibold">Discord Scraper</h1>
        <p className="text-xs text-[var(--color-muted)]">
          Sign in with the Discord account you use in this chat. The site asks for
          <code className="mx-1">identify</code> only.
        </p>
        <a
          href={loginHref(next)}
          className="block rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Continue with Discord
        </a>
      </div>
    </main>
  );
}
