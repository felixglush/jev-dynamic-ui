"use client";

import { createContext, use, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  title: string;
  description: string;
  submitLabel: string;
  children: React.ReactNode;
};

/**
 * Lets a parent take over what "submit" means. The chat's floating card provides one, so a
 * confirmed form is recorded in the sidebar and the card closes. Without a provider (the annotate
 * page) the form shows its own demo notice, as before.
 */
export type ActionHost = {
  onConfirm: (confirmed: { title: string; values: Record<string, string> }) => void;
};

export const ActionHostContext = createContext<ActionHost | null>(null);

/** The card, heading and submit button shared by every action. Each action supplies its own fields. */
export function ActionForm({ title, description, submitLabel, children }: Props) {
  const [submitted, setSubmitted] = useState(false);
  // `use` reads a context like useContext does; React 19 also lets it read promises.
  const host = use(ActionHostContext);

  const form = (
    // The browser checks `required` fields first and focuses the first empty one, so onSubmit
    // only runs for a complete form.
    <form
      onSubmit={(event) => {
        event.preventDefault(); // no banking API is connected yet
        if (host) {
          const values: Record<string, string> = {};
          for (const [key, value] of new FormData(event.currentTarget)) {
            if (typeof value === "string") values[key] = value.trim();
          }
          host.onConfirm({ title, values });
        } else {
          setSubmitted(true);
        }
      }}
      onKeyDown={(event) => {
        // Text boxes already submit on Enter; make dropdowns do the same so Return always confirms.
        if (event.key === "Enter" && event.target instanceof HTMLSelectElement) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
      className="flex flex-col gap-4"
    >
      <CardHeader>
        <CardTitle>
          <h2 className="text-balance">{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
      {host ? (
        <CardFooter className="flex-wrap justify-between gap-3">
          {/* Keyboard hints only make sense with a keyboard, so phones and tablets skip them. */}
          <p className="hidden items-center gap-3 text-xs text-muted-foreground pointer-fine:flex">
            <span>
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans">Return</kbd> to confirm
            </span>
            <span>
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans">Esc</kbd> to dismiss
            </span>
          </p>
          <Button type="submit" className="ml-auto rounded-full px-5">
            {submitLabel}
          </Button>
        </CardFooter>
      ) : (
        <CardFooter className="flex-col items-start gap-2">
          <Button type="submit">{submitLabel}</Button>
          {/* Always in the page (just empty at first) so screen readers announce the text when it appears. */}
          <p role="status" className="text-sm text-muted-foreground">
            {submitted && "Demo only: no banking API is connected, so nothing was submitted."}
          </p>
        </CardFooter>
      )}
    </form>
  );

  // Inside the floating card the card chrome would be doubled, so only the contents render.
  return host ? form : <Card className="w-full max-w-md">{form}</Card>;
}
