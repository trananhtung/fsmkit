# fsmkit

Lightweight zero-dependency finite state machine with full TypeScript support. Simple alternative to `xstate` and the abandoned `javascript-state-machine`.

[![npm](https://img.shields.io/npm/v/fsmkit)](https://www.npmjs.com/package/fsmkit)
[![npm downloads](https://img.shields.io/npm/dw/fsmkit)](https://www.npmjs.com/package/fsmkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why fsmkit?

| Package | Downloads/week | Problem |
|---------|---------------|---------|
| `xstate` | 4.2M | Actor-model complexity overkill for simple use cases |
| `javascript-state-machine` | 1.8M | **Abandoned since 2021**, no TypeScript types |
| `fsmkit` | — | Lightweight, typed, zero-dep — just state machines |

Inspired by Python's [`transitions`](https://github.com/pytransitions/transitions) (5.5k★), C#'s [`Stateless`](https://github.com/dotnet-state-machine/stateless) (5.5k★), and Ruby's [`AASM`](https://github.com/aasm/aasm) (4k★).

## Install

```bash
npm install fsmkit
```

## Quick start

```ts
import { createMachine } from "fsmkit";

type State = "red" | "green" | "yellow";
type Event = "GO" | "SLOW" | "STOP";

const traffic = createMachine<State, Event>({
  initial: "red",
  states: {
    red:    { on: { GO:   { to: "green"  } } },
    green:  { on: { SLOW: { to: "yellow" } } },
    yellow: { on: { STOP: { to: "red"    } } },
  },
});

traffic.state;           // "red"
await traffic.send("GO");
traffic.state;           // "green"
traffic.is("green");     // true
traffic.can("SLOW");     // true
traffic.can("STOP");     // false
```

## Context

Carry mutable state through transitions:

```ts
interface Ctx { balance: number }

const machine = createMachine<"idle" | "funded", "DEPOSIT" | "WITHDRAW", Ctx>({
  initial: "idle",
  context: { balance: 0 },
  states: {
    idle: {
      on: {
        DEPOSIT: {
          to: "funded",
          actions: [(ctx) => { ctx.balance += 100; }],
        },
      },
    },
    funded: {
      on: {
        WITHDRAW: {
          to: "idle",
          actions: [(ctx) => { ctx.balance = 0; }],
        },
      },
    },
  },
});

await machine.send("DEPOSIT");
machine.context.balance; // 100
```

## Guards

Conditionally allow or block transitions. First passing guard wins:

```ts
const checkout = createMachine<"cart" | "payment" | "error", "CHECKOUT", { items: number }>({
  initial: "cart",
  context: { items: 0 },
  states: {
    cart: {
      on: {
        CHECKOUT: [
          { to: "payment", guard: (ctx) => ctx.items > 0 },
          { to: "error" },   // fallback if guard fails
        ],
      },
    },
    payment: {},
    error: {},
  },
});
```

Guards can be async:

```ts
{ to: "approved", guard: async (ctx) => await checkCredit(ctx.userId) }
```

If all guards reject, `send()` throws a `GuardRejectedError`.

## Actions

Run side-effects on enter, exit, or transition. Actions can be sync or async:

```ts
const machine = createMachine<"off" | "on", "TOGGLE">({
  initial: "off",
  states: {
    off: {
      onEnter: [() => console.log("power off")],
      on: { TOGGLE: { to: "on", actions: [(_, ev) => console.log(`event: ${ev}`)] } },
    },
    on: {
      onExit: [(ctx) => cleanup(ctx)],
      on: { TOGGLE: { to: "off" } },
    },
  },
});
```

**Execution order** for a transition: `onExit` → `transition actions` → `onEnter`.

Actions returning a value have it ignored (no need to wrap in `{}`):

```ts
actions: [(ctx) => ctx.count++]  // fine — returned number is discarded
```

## Subscribe

React to every state change:

```ts
const unsub = machine.subscribe((state, prev, event, ctx) => {
  console.log(`${prev} → ${state} (${event})`);
});

// Later:
unsub(); // stop listening
```

## Reachability analysis

```ts
machine.reachableStates(); // Set<State> reachable from initial
```

## Error handling

```ts
import { InvalidTransitionError, GuardRejectedError } from "fsmkit";

try {
  await machine.send("INVALID");
} catch (e) {
  if (e instanceof InvalidTransitionError) {
    console.log(e.from, e.event); // current state, event name
  }
  if (e instanceof GuardRejectedError) {
    // all guards for this event rejected
  }
}
```

## Full API

### `createMachine(config)`

| Field | Type | Description |
|-------|------|-------------|
| `initial` | `State` | Starting state |
| `context` | `Context` | Initial mutable context |
| `states` | `Record<State, StateConfig>` | State definitions |

### `StateConfig`

| Field | Type | Description |
|-------|------|-------------|
| `on` | `Partial<Record<Event, Transition \| Transition[]>>` | Event → transition mapping |
| `onEnter` | `Action[]` | Run when entering this state |
| `onExit` | `Action[]` | Run when leaving this state |

### `TransitionConfig`

| Field | Type | Description |
|-------|------|-------------|
| `to` | `State` | Target state |
| `guard` | `(ctx, event) => boolean \| Promise<boolean>` | Optional condition |
| `actions` | `Action[]` | Side-effects for this transition |

### `Machine<State, Event, Context>`

| Member | Description |
|--------|-------------|
| `.state` | Current state |
| `.context` | Current context |
| `.is(s)` | `true` if current state equals `s` |
| `.can(event)` | `true` if event is defined in current state |
| `.send(event)` | Fire event, returns new state. May throw. |
| `.subscribe(fn)` | Listen to transitions, returns unsubscribe |
| `.reachableStates()` | `Set<State>` reachable from initial |

## Real-world example: vending machine

```ts
type S = "idle" | "has_money" | "dispensing";
type E = "INSERT" | "SELECT" | "COLLECT";
interface VCtx { balance: number; item: string }

const vending = createMachine<S, E, VCtx>({
  initial: "idle",
  context: { balance: 0, item: "" },
  states: {
    idle: {
      on: { INSERT: { to: "has_money", actions: [(ctx) => { ctx.balance += 100; }] } },
    },
    has_money: {
      on: {
        INSERT: { to: "has_money", actions: [(ctx) => { ctx.balance += 100; }] },
        SELECT: [
          {
            to: "dispensing",
            guard: (ctx) => ctx.balance >= 150,
            actions: [(ctx) => { ctx.item = "cola"; ctx.balance -= 150; }],
          },
        ],
      },
    },
    dispensing: {
      on: { COLLECT: { to: "idle", actions: [(ctx) => { ctx.item = ""; }] } },
    },
  },
});

await vending.send("INSERT");
await vending.send("INSERT");
await vending.send("SELECT");
vending.state;            // "dispensing"
vending.context.item;     // "cola"
vending.context.balance;  // 50
await vending.send("COLLECT");
vending.state;            // "idle"
```

## License

MIT
