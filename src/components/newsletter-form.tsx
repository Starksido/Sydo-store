"use client";

import { useState } from "react";

// Placeholder: no email provider is wired up yet, so submissions go nowhere.
export function NewsletterForm() {
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <p role="status" className="text-sm">
        Thank you. You&rsquo;re on the list.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <label className="flex-1">
        <span className="sr-only">Email address</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="Email address"
          className="h-12 w-full border-0 border-b border-ink bg-transparent px-0 text-base placeholder:text-muted"
        />
      </label>
      <button type="submit" className="btn btn-primary">
        Subscribe
      </button>
    </form>
  );
}
