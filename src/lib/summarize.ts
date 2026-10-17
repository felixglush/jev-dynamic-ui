import type { ActionName } from "@/lib/jev/types";

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

function formatAmount(raw: string | undefined) {
  const amount = Number(raw);
  return raw && Number.isFinite(amount) ? money.format(amount) : null;
}

/** Turns "first_home_savings" into "first home savings" for display. */
function words(raw: string | undefined) {
  return raw ? raw.replaceAll("_", " ") : null;
}

/** "on 2030-01-15 monthly" for a scheduled payment, nothing for one that happens right away. */
function schedule(values: Record<string, string>) {
  const when = [values.date ? `on ${values.date}` : null, values.frequency ? words(values.frequency) : null];
  return when.filter(Boolean).join(" ") || null;
}

/** A one-line description of what the customer confirmed, built from the submitted form values. */
export function summarize(action: ActionName, values: Record<string, string>): string {
  const from = values.from_account ? `from ${words(values.from_account)}` : null;
  let parts: (string | null | undefined)[];
  switch (action) {
    case "add_etransfer_contact":
      parts = [values.name, values.email || values.phone ? `(${values.email || values.phone})` : null];
      break;
    case "send_etransfer":
      parts = [formatAmount(values.amount), values.recipient ? `to ${values.recipient}` : null, from];
      break;
    case "pay_credit_card":
      parts = [
        values.payment_option === "custom" ? formatAmount(values.amount) : `${words(values.payment_option)} payment`,
        from,
      ];
      break;
    case "open_account": {
      const deposit = formatAmount(values.initial_deposit);
      parts = [words(values.account_type), deposit ? `with ${deposit}` : null, deposit ? from : null];
      break;
    }
    case "transfer_between_accounts":
      parts = [
        formatAmount(values.amount),
        values.from_account ? `from ${words(values.from_account)}` : null,
        values.to_account ? `to ${words(values.to_account)}` : null,
        schedule(values),
      ];
      break;
    case "pay_bill":
      parts = [formatAmount(values.amount), values.payee ? `to ${values.payee}` : null, from, schedule(values)];
      break;
    case "add_payee":
      parts = [values.biller, values.account_number ? `(account ${values.account_number})` : null];
      break;
    case "manage_card":
      parts = [words(values.card_action), values.card ? `${words(values.card)} card` : null, values.reason ? `(${words(values.reason)})` : null];
      break;
    case "view_account":
      parts = [words(values.view) ?? "balance", values.account ? `for ${words(values.account)}` : null];
      break;
    case "request_etransfer":
      parts = [formatAmount(values.amount), values.from_person || values.from_email ? `from ${values.from_person || values.from_email}` : null];
      break;
    case "cancel_etransfer":
      parts = [formatAmount(values.amount), values.recipient ? `to ${values.recipient}` : null];
      break;
    case "setup_autodeposit":
      parts = [values.email || values.phone, values.deposit_account ? `into ${words(values.deposit_account)}` : null];
      break;
    case "dispute_transaction":
      parts = [formatAmount(values.amount), values.merchant ? `charge from ${values.merchant}` : null, values.reason ? `(${words(values.reason)})` : null];
      break;
    case "update_contact_info":
      parts = [words(values.contact_type), values.new_email || values.new_phone || values.new_address];
      break;
    default: {
      const unhandled: never = action;
      throw new Error(`No summary for action: ${String(unhandled)}`);
    }
  }
  return parts.filter(Boolean).join(" ");
}
