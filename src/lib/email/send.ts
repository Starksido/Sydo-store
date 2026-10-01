// Sends email through Resend's HTTP API. Server-only: it uses the API key. No database access.
const API = "https://api.resend.com/emails";

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Resend sends one email per key within 24 hours, so a retried or repeated trigger (e.g. the same
   * order paid event handled twice) can't send it twice.
   */
  idempotencyKey?: string;
};

/**
 * Sends `email`, or throws. Without `RESEND_API_KEY` it sends nothing: in development it prints the
 * email (so links can be followed), in tests it stays quiet, and in production it throws.
 * Read on use, not at import, so building the app doesn't need the key.
 */
export async function sendEmail({ to, subject, html, text, idempotencyKey }: Email) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set.");
    if (process.env.NODE_ENV !== "test") console.info(`[email] not sent (no RESEND_API_KEY)\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return;
  }
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) throw new Error("EMAIL_FROM is not set.");

  const response = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`Resend refused the email (HTTP ${response.status}): ${detail}`);
  }
}

/**
 * Like `sendEmail`, but logs failures instead of throwing, for emails sent in the background where
 * nobody could act on the error. `label` names the email in the log (never the address).
 */
export async function trySendEmail(label: string, email: Email) {
  try {
    await sendEmail(email);
  } catch (error) {
    console.error(`[email] could not send ${label}`, error);
  }
}
