import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { label } from "@/lib/annotate/dataset";
import { formatTally, type Summary } from "@/lib/annotate/summary";

type Props = {
  summary: Summary;
  /** Jump to a message by its id. */
  onOpen: (id: string) => void;
};

function Stat({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{title}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      <dd className="text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}

/** How accurate Jev was on the messages reviewed so far. */
export function SummaryView({ summary, onOpen }: Props) {
  return (
    <section aria-labelledby="summary-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="summary-heading" className="text-lg font-semibold">
          Accuracy summary
        </h2>
        <p className="text-sm text-muted-foreground">
          Based on {summary.reviewed} of {summary.total} messages reviewed.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <Stat title="Right action" value={formatTally(summary.action)} hint="Picked the right form (or none)." />
        <Stat
          title="Right values"
          value={formatTally(summary.values)}
          hint="Each field, on messages with the right action."
        />
        <Stat title="Fully right" value={formatTally(summary.exact)} hint="Right action and every value." />
      </dl>

      <div className="grid gap-6 sm:grid-cols-2">
        <table className="h-fit w-full text-sm">
          <caption className="pb-2 text-left font-medium">Right action, by expected action</caption>
          <tbody>
            {summary.byExpectedAction.map((row) => (
              <tr key={row.action} className="border-t">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {label(row.action)}
                </th>
                <td className="py-1.5 text-right tabular-nums">{formatTally(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="h-fit w-full text-sm">
          <caption className="pb-2 text-left font-medium">Right action, by Jev&apos;s confidence</caption>
          <tbody>
            {summary.byConfidence.map((row) => (
              <tr key={row.label} className="border-t">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {row.label}
                </th>
                <td className="py-1.5 text-right tabular-nums">{formatTally(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Mistakes ({summary.mistakes.length})</h3>
        {summary.mistakes.length === 0 ? (
          <p className="text-sm text-muted-foreground">None so far.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {summary.mistakes.map(({ prediction, annotation, verdict }) => (
              <li key={prediction.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1 break-words">
                  <span className="text-muted-foreground tabular-nums">#{prediction.id}</span> {prediction.message}
                </span>
                <Badge variant={verdict === "wrong_action" ? "destructive" : "warning"}>
                  {verdict === "wrong_action"
                    ? `${prediction.predictedAction} → ${annotation.expectedAction}`
                    : "wrong values"}
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => onOpen(prediction.id)}>
                  Review
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
