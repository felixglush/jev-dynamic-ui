"use client";

import { useState } from "react";

import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionCall } from "@/lib/jev/types";

const SUBMIT_LABEL: Record<string, string> = {
  lock: "Lock Card",
  unlock: "Unlock Card",
  replace: "Order Replacement",
};

export function ManageCard({ call }: { call: Extract<ActionCall, { action: "manage_card" }> }) {
  const { card_action, card, reason } = call.params;
  const { params } = CATALOG.manage_card;
  // The reason only matters when replacing a card, so the form has to know which action is chosen.
  const [action, setAction] = useState(card_action.value ?? "");

  return (
    <ActionForm
      title="Manage Your Card"
      description="Lock it, unlock it, or get a replacement."
      submitLabel={SUBMIT_LABEL[action] ?? "Continue"}
    >
      <ParamField
        name="card_action"
        label="What to do"
        param={card_action}
        required
        options={params.card_action.options}
        onSelect={setAction}
      />
      <ParamField name="card" label="Which card" param={card} required options={params.card.options} />
      {action === "replace" && (
        <ParamField name="reason" label="Why" param={reason} required options={params.reason.options} />
      )}
    </ActionForm>
  );
}
