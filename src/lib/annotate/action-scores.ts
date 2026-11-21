/**
 * Scores a list of (expected action, predicted action) pairs: accuracy, precision and recall per
 * action, and which actions get mixed up. Used by `npm run action:eval`.
 *
 *   recall     of the messages that belong to an action, how many were sent there
 *   precision  of the messages sent to an action, how many belonged there
 */
export type ActionPair = { expected: string; predicted: string };

export function scoreActions(pairs: ActionPair[]) {
  const counts = new Map<string, { expected: number; predicted: number; correct: number }>();
  const count = (action: string) => {
    const entry = counts.get(action) ?? { expected: 0, predicted: 0, correct: 0 };
    counts.set(action, entry);
    return entry;
  };
  const confusions = new Map<string, { expected: string; predicted: string; count: number }>();
  let correct = 0;
  for (const { expected, predicted } of pairs) {
    count(expected).expected++;
    count(predicted).predicted++;
    if (expected === predicted) {
      count(expected).correct++;
      correct++;
    } else {
      const pair = confusions.get(`${expected}\0${predicted}`) ?? { expected, predicted, count: 0 };
      pair.count++;
      confusions.set(`${expected}\0${predicted}`, pair);
    }
  }
  return {
    total: pairs.length,
    correct,
    accuracy: pairs.length ? correct / pairs.length : 0,
    perAction: [...counts]
      .map(([action, c]) => ({
        action,
        ...c,
        precision: c.predicted ? c.correct / c.predicted : null,
        recall: c.expected ? c.correct / c.expected : null,
      }))
      .sort((a, b) => b.expected - a.expected || a.action.localeCompare(b.action)),
    confusions: [...confusions.values()].sort((a, b) => b.count - a.count),
  };
}
