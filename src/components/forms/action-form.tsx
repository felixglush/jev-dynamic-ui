"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  title: string;
  description: string;
  submitLabel: string;
  children: React.ReactNode;
};

/** The card, heading and submit button shared by every action. Each action supplies its own fields. */
export function ActionForm({ title, description, submitLabel, children }: Props) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <Card className="w-full max-w-md">
      {/* The browser checks `required` fields first and focuses the first empty one, so onSubmit
          only runs for a complete form. */}
      <form
        onSubmit={(event) => {
          event.preventDefault(); // no banking API is connected yet
          setSubmitted(true);
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
        <CardFooter className="flex-col items-start gap-2">
          <Button type="submit">{submitLabel}</Button>
          {/* Always in the page (just empty at first) so screen readers announce the text when it appears. */}
          <p role="status" className="text-sm text-muted-foreground">
            {submitted && "Demo only: no banking API is connected, so nothing was submitted."}
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
