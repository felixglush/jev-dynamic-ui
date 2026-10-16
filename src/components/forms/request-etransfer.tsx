"use client";

import { useState } from "react";

import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import type { ActionCall } from "@/lib/jev/types";

export function RequestEtransfer({ call }: { call: Extract<ActionCall, { action: "request_etransfer" }> }) {
  const { from_person, from_email, amount } = call.params;
  // A request needs someone to ask: a name or an email will do, so each is required only while the other is empty.
  const [person, setPerson] = useState(from_person.value ?? "");
  const [email, setEmail] = useState(from_email.value ?? "");

  return (
    <ActionForm
      title="Request Money"
      description="Ask someone to send you money by e-Transfer."
      submitLabel="Send Request"
    >
      <ParamField name="from_person" label="Request from" param={from_person} required={email.trim() === ""} onValue={setPerson} />
      <ParamField name="from_email" label="Their email" param={from_email} type="email" required={person.trim() === ""} onValue={setEmail} />
      <ParamField name="amount" label="Amount (CAD)" param={amount} required type="number" placeholder="0.00" />
    </ActionForm>
  );
}
