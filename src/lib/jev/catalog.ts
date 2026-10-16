/**
 * The action catalog: every action the banking app can perform and the parameters each one takes.
 *
 * This is the single source of truth. The classifier builds its Jev questions from it, the result
 * types in types.ts are derived from it, and the UI gets one component per entry. Add an action
 * here and TypeScript will point at every place that still needs updating.
 *
 * `as const` freezes the object into literal types ("send_etransfer", not just string), and
 * `satisfies` checks the shape without widening those literals back to plain strings.
 */

/** How a parameter's value is found. See candidates.ts for the non-choice types. */
export type ParamSpec =
  | { type: "name" | "email" | "phone" | "amount"; question: string; required?: boolean }
  | { type: "choice"; question: string; required?: boolean; options: Record<string, string> };

export type ActionSpec = {
  /** Shown to Jev as the description of this action, so it should say when the action applies. */
  description: string;
  params: Record<string, ParamSpec>;
};

/** Longest chat message accepted. Shared so the input's maxLength and the server check agree. */
export const MAX_MESSAGE_LENGTH = 500;

/** Judgments below this confidence are flagged for the customer to double-check. */
export const LOW_CONFIDENCE = 0.6;

const ACCOUNT_OPTIONS = {
  chequing: "The chequing account.",
  savings: "The savings account.",
} as const;

export const CATALOG = {
  add_etransfer_contact: {
    description:
      "Add a new person as an Interac e-Transfer recipient (a saved contact), without sending money yet.",
    params: {
      name: {
        type: "name",
        required: true,
        question:
          "What is the name or nickname of the person the customer wants to save as an e-Transfer contact in `query`? A relationship alone (like 'my sister') counts only if no name is given.",
      },
      email: {
        type: "email",
        question: "Which email address belongs to the new e-Transfer contact in `query`?",
      },
      phone: {
        type: "phone",
        question: "Which phone number belongs to the new e-Transfer contact in `query`?",
      },
    },
  },
  send_etransfer: {
    description: "Send money to another person by Interac e-Transfer.",
    params: {
      recipient: {
        type: "name",
        required: true,
        question:
          "Who is the person the customer wants to send money to in `query`? Pick their name or nickname.",
      },
      recipient_email: {
        type: "email",
        question: "Which email address should the e-Transfer in `query` be sent to?",
      },
      amount: {
        type: "amount",
        required: true,
        question: "How much money does the customer want to send by e-Transfer in `query`?",
      },
      from_account: {
        type: "choice",
        question: "Which of the customer's accounts should the e-Transfer in `query` come out of?",
        options: ACCOUNT_OPTIONS,
      },
    },
  },
  pay_credit_card: {
    description: "Make a payment toward the customer's credit card balance.",
    params: {
      payment_option: {
        type: "choice",
        required: true,
        question: "How much of the credit card balance does the customer want to pay in `query`?",
        options: {
          minimum: "The minimum payment due.",
          statement_balance: "The balance on the latest statement.",
          full_balance: "Everything owed right now; 'pay it off'.",
          custom: "A specific dollar amount the customer states.",
        },
      },
      amount: {
        type: "amount",
        question:
          "Which specific dollar amount does the customer want to pay toward the credit card in `query`?",
      },
      from_account: {
        type: "choice",
        question:
          "Which of the customer's accounts should the credit card payment in `query` come out of?",
        options: ACCOUNT_OPTIONS,
      },
    },
  },
  open_account: {
    description: "Open a new account or product with the bank.",
    params: {
      account_type: {
        type: "choice",
        required: true,
        question: "What kind of account does the customer want to open in `query`?",
        options: {
          chequing: "A chequing account for everyday banking.",
          savings: "A regular high-interest savings account.",
          tfsa: "A Tax-Free Savings Account (TFSA).",
          rrsp: "A Registered Retirement Savings Plan (RRSP).",
          fhsa: "A First Home Savings Account (FHSA).",
          gic: "A Guaranteed Investment Certificate (GIC) or term deposit.",
          credit_card: "A new credit card.",
        },
      },
      initial_deposit: {
        type: "amount",
        question:
          "How much money does the customer want to put into the new account when opening it in `query`?",
      },
    },
  },
} as const satisfies Record<string, ActionSpec>;
