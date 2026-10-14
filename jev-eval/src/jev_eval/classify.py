"""Turn a chat query into an action call: which action, and the value of each of its parameters.

Following TypeSafe's function-calling pattern, each query is ONE request that asks, in parallel:
- "__action__": which action should handle the query (plus a "none" option), and
- "<action>.<param>": every parameter of EVERY action, speculatively.
Code then keeps only the chosen action's answers. One round trip instead of two.
"""

import asyncio
from dataclasses import dataclass, field

from typesafe_sdk import AsyncTypeSafeClient, Choice, Question, TypeSafeError

from jev_eval.candidates import FINDERS, normalize
from jev_eval.catalog import Catalog, Param

ACTION_QUESTION = "__action__"
NONE = "none"


@dataclass
class ParamValue:
    value: str | None  # None when the query doesn't give it
    confidence: float | None


@dataclass
class ActionCall:
    query: str
    action: str | None = None  # None when no catalog action fits
    confidence: float | None = None
    params: dict[str, ParamValue] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)  # required params the UI must ask for
    error: str | None = None

    @property
    def weakest(self) -> float | None:
        """The least certain judgment in the call; a good single number to threshold on."""
        values = [self.confidence] + [p.confidence for p in self.params.values() if p.value is not None]
        known = [v for v in values if v is not None]
        return min(known) if known else None


def _param_question(param: Param, query: str) -> Choice | None:
    if param.type == "choice":
        options: dict[str, str | None] = dict(param.options)
    else:
        found = FINDERS[param.type](query)
        if not found:
            return None  # nothing to pick from, so the value is simply absent
        options = {span: None for span in found}
    options[NONE] = "The query does not give this; none of these is the requested value."
    return Choice(instructions=param.question, criteria=options)


def build_questions(catalog: Catalog, query: str) -> dict[str, Question]:
    action_options: dict[str, str | None] = {name: a.description for name, a in catalog.actions.items()}
    action_options[NONE] = "None of these actions; the query asks for something else or no banking action."
    questions: dict[str, Question] = {
        ACTION_QUESTION: Choice(instructions="Which action in the banking app should handle `query`?", criteria=action_options)
    }
    for action in catalog.actions.values():
        for param in action.params.values():
            question = _param_question(param, query)
            if question is not None:
                questions[f"{action.name}.{param.name}"] = question
    return questions


async def classify_one(client: AsyncTypeSafeClient, catalog: Catalog, query: str) -> ActionCall:
    # State is what Jev reads; instructions refer to these fields by name.
    state = {"query": query, "context": catalog.context} if catalog.context else {"query": query}
    try:
        response = await client.system_one(state=state, questions=build_questions(catalog, query))
    except TypeSafeError as error:
        return ActionCall(query, error=f"{type(error).__name__}: {error}")

    chosen = response.choices[ACTION_QUESTION]
    call = ActionCall(query, confidence=chosen.confidence)
    if chosen.choice == NONE:
        return call
    call.action = chosen.choice

    for param in catalog.actions[call.action].params.values():
        answer = response.choices.get(f"{call.action}.{param.name}")
        if answer is None or answer.choice == NONE:
            call.params[param.name] = ParamValue(None, answer.confidence if answer else None)
            if param.required:
                call.missing.append(param.name)
        else:
            call.params[param.name] = ParamValue(normalize(param.type, answer.choice), answer.confidence)
    return call


async def classify(queries: list[str], catalog: Catalog, *, api_key: str, model: str | None = None, concurrency: int = 8) -> list[ActionCall]:
    limit = asyncio.Semaphore(concurrency)  # caps requests in flight

    async with AsyncTypeSafeClient(api_key=api_key, model=model) as client:

        async def bounded(query: str) -> ActionCall:
            async with limit:
                return await classify_one(client, catalog, query)

        return await asyncio.gather(*(bounded(q) for q in queries))  # results keep input order
