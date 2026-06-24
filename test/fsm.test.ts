import { createMachine, Machine, InvalidTransitionError, GuardRejectedError } from "../src/index.js";

// ── Traffic light fixture ─────────────────────────────────────────────────────

type TrafficState = "red" | "green" | "yellow";
type TrafficEvent = "GO" | "SLOW" | "STOP";

function trafficLight() {
  return createMachine<TrafficState, TrafficEvent>({
    initial: "red",
    states: {
      red:    { on: { GO:   { to: "green"  } } },
      green:  { on: { SLOW: { to: "yellow" } } },
      yellow: { on: { STOP: { to: "red"    } } },
    },
  });
}

// ── Basic transitions ─────────────────────────────────────────────────────────

describe("basic transitions", () => {
  test("starts in initial state", () => {
    expect(trafficLight().state).toBe("red");
  });

  test("transitions on valid event", async () => {
    const m = trafficLight();
    await m.send("GO");
    expect(m.state).toBe("green");
  });

  test("chain of transitions", async () => {
    const m = trafficLight();
    await m.send("GO");
    await m.send("SLOW");
    await m.send("STOP");
    expect(m.state).toBe("red");
  });

  test("send() returns new state", async () => {
    const m = trafficLight();
    const s = await m.send("GO");
    expect(s).toBe("green");
  });

  test("is() helper", async () => {
    const m = trafficLight();
    expect(m.is("red")).toBe(true);
    await m.send("GO");
    expect(m.is("red")).toBe(false);
    expect(m.is("green")).toBe(true);
  });

  test("can() returns true for valid events", () => {
    const m = trafficLight();
    expect(m.can("GO")).toBe(true);
    expect(m.can("SLOW")).toBe(false);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("error cases", () => {
  test("throws InvalidTransitionError for undefined event", async () => {
    const m = trafficLight();
    await expect(m.send("SLOW")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  test("InvalidTransitionError has from/event fields", async () => {
    const m = trafficLight();
    try {
      await m.send("STOP");
    } catch (e) {
      expect((e as InvalidTransitionError).from).toBe("red");
      expect((e as InvalidTransitionError).event).toBe("STOP");
    }
  });
});

// ── Guards ────────────────────────────────────────────────────────────────────

describe("guards", () => {
  type State = "locked" | "unlocked";
  type Event = "INSERT_COIN" | "PUSH";

  interface Ctx { coins: number }

  function turnstile(coins = 0) {
    return createMachine<State, Event, Ctx>({
      initial: "locked",
      context: { coins },
      states: {
        locked: {
          on: {
            INSERT_COIN: {
              to: "unlocked",
              guard: (ctx) => { ctx.coins++; return true; },
            },
            PUSH: {
              to: "locked",
              guard: (ctx) => ctx.coins === 0,
            },
          },
        },
        unlocked: {
          on: {
            PUSH: { to: "locked" },
            INSERT_COIN: {
              to: "unlocked",
              guard: (ctx) => { ctx.coins++; return true; },
            },
          },
        },
      },
    });
  }

  test("guard passes → transitions", async () => {
    const m = turnstile();
    await m.send("INSERT_COIN");
    expect(m.state).toBe("unlocked");
  });

  test("guard mutation on context", async () => {
    const m = turnstile();
    await m.send("INSERT_COIN");
    expect(m.context.coins).toBe(1);
  });

  test("guard returning false throws GuardRejectedError", async () => {
    const m = turnstile(1); // already has coins → PUSH guard: coins===0 fails
    await m.send("INSERT_COIN"); // go unlocked
    // Now try PUSH then INSERT_COIN while unlocked, then try locked push with coins>0
    const m2 = createMachine<State, Event, Ctx>({
      initial: "locked",
      context: { coins: 1 },
      states: {
        locked: {
          on: {
            PUSH: { to: "unlocked", guard: (ctx) => ctx.coins === 0 },
            INSERT_COIN: { to: "unlocked" },
          },
        },
        unlocked: { on: { PUSH: { to: "locked" } } },
      },
    });
    await expect(m2.send("PUSH")).rejects.toBeInstanceOf(GuardRejectedError);
  });

  test("async guard supported", async () => {
    const m = createMachine<"a" | "b", "GO">({
      initial: "a",
      states: {
        a: { on: { GO: { to: "b", guard: async () => { return true; } } } },
        b: {},
      },
    });
    await m.send("GO");
    expect(m.state).toBe("b");
  });

  test("multiple candidate transitions — first passing guard wins", async () => {
    type S = "pending" | "approved" | "rejected";
    type E = "DECIDE";
    interface C { score: number }
    const m = createMachine<S, E, C>({
      initial: "pending",
      context: { score: 70 },
      states: {
        pending: {
          on: {
            DECIDE: [
              { to: "approved", guard: (ctx) => ctx.score >= 60 },
              { to: "rejected" },
            ],
          },
        },
        approved: {},
        rejected: {},
      },
    });
    await m.send("DECIDE");
    expect(m.state).toBe("approved");

    const m2 = createMachine<S, E, C>({
      initial: "pending",
      context: { score: 40 },
      states: {
        pending: {
          on: {
            DECIDE: [
              { to: "approved", guard: (ctx) => ctx.score >= 60 },
              { to: "rejected" },
            ],
          },
        },
        approved: {},
        rejected: {},
      },
    });
    await m2.send("DECIDE");
    expect(m2.state).toBe("rejected");
  });
});

// ── Actions ───────────────────────────────────────────────────────────────────

describe("actions", () => {
  test("onEnter fires on state entry", async () => {
    const log: string[] = [];
    const m = createMachine<"a" | "b", "GO">({
      initial: "a",
      states: {
        a: { on: { GO: { to: "b" } } },
        b: { onEnter: [() => { log.push("enter:b"); }] },
      },
    });
    await m.send("GO");
    expect(log).toEqual(["enter:b"]);
  });

  test("onExit fires on state exit", async () => {
    const log: string[] = [];
    const m = createMachine<"a" | "b", "GO">({
      initial: "a",
      states: {
        a: {
          onExit: [() => { log.push("exit:a"); }],
          on: { GO: { to: "b" } },
        },
        b: {},
      },
    });
    await m.send("GO");
    expect(log).toEqual(["exit:a"]);
  });

  test("transition actions fire between exit and enter", async () => {
    const log: string[] = [];
    const m = createMachine<"a" | "b", "GO">({
      initial: "a",
      states: {
        a: {
          onExit: [() => log.push("exit:a")],
          on: { GO: { to: "b", actions: [() => log.push("transition")] } },
        },
        b: { onEnter: [() => log.push("enter:b")] },
      },
    });
    await m.send("GO");
    expect(log).toEqual(["exit:a", "transition", "enter:b"]);
  });

  test("multiple actions fire in order", async () => {
    const log: number[] = [];
    const m = createMachine<"a" | "b", "GO">({
      initial: "a",
      states: {
        a: { on: { GO: { to: "b", actions: [() => log.push(1), () => log.push(2)] } } },
        b: {},
      },
    });
    await m.send("GO");
    expect(log).toEqual([1, 2]);
  });

  test("async actions supported", async () => {
    const results: string[] = [];
    const m = createMachine<"a" | "b", "GO">({
      initial: "a",
      states: {
        a: {
          on: {
            GO: {
              to: "b",
              actions: [async () => { await Promise.resolve(); results.push("done"); }],
            },
          },
        },
        b: {},
      },
    });
    await m.send("GO");
    expect(results).toEqual(["done"]);
  });

  test("event name passed to actions", async () => {
    let received = "";
    const m = createMachine<"a" | "b", "GO">({
      initial: "a",
      states: {
        a: { on: { GO: { to: "b", actions: [(_, ev) => { received = ev; }] } } },
        b: {},
      },
    });
    await m.send("GO");
    expect(received).toBe("GO");
  });
});

// ── Context ───────────────────────────────────────────────────────────────────

describe("context", () => {
  test("initial context is accessible", () => {
    const m = createMachine<"idle", "NOP", { count: number }>({
      initial: "idle",
      context: { count: 42 },
      states: { idle: {} },
    });
    expect(m.context.count).toBe(42);
  });

  test("actions can mutate context", async () => {
    interface Ctx { hits: number }
    const m = createMachine<"a" | "b", "GO", Ctx>({
      initial: "a",
      context: { hits: 0 },
      states: {
        a: { on: { GO: { to: "b", actions: [(ctx) => { ctx.hits++; }] } } },
        b: {},
      },
    });
    await m.send("GO");
    expect(m.context.hits).toBe(1);
  });
});

// ── Subscribe ─────────────────────────────────────────────────────────────────

describe("subscribe", () => {
  test("listener called on transition", async () => {
    const m = trafficLight();
    const calls: Array<{ state: string; prev: string; event: string }> = [];
    m.subscribe((state, prev, event) => calls.push({ state, prev, event }));
    await m.send("GO");
    expect(calls).toEqual([{ state: "green", prev: "red", event: "GO" }]);
  });

  test("unsubscribe stops notifications", async () => {
    const m = trafficLight();
    const calls: string[] = [];
    const unsub = m.subscribe((s) => calls.push(s));
    await m.send("GO");
    unsub();
    await m.send("SLOW");
    expect(calls).toEqual(["green"]);
  });

  test("multiple listeners supported", async () => {
    const m = trafficLight();
    const a: string[] = [], b: string[] = [];
    m.subscribe((s) => a.push(s));
    m.subscribe((s) => b.push(s));
    await m.send("GO");
    expect(a).toEqual(["green"]);
    expect(b).toEqual(["green"]);
  });
});

// ── reachableStates ───────────────────────────────────────────────────────────

describe("reachableStates", () => {
  test("returns all states reachable from initial", () => {
    const m = trafficLight();
    const reachable = m.reachableStates();
    expect(reachable).toEqual(new Set(["red", "green", "yellow"]));
  });

  test("unreachable states not included", () => {
    const m = createMachine<"a" | "b" | "unreachable", "GO">({
      initial: "a",
      states: {
        a: { on: { GO: { to: "b" } } },
        b: {},
        unreachable: {},
      },
    });
    expect(m.reachableStates().has("unreachable")).toBe(false);
  });
});

// ── Real-world: vending machine ───────────────────────────────────────────────

describe("vending machine", () => {
  type VState = "idle" | "has_money" | "dispensing" | "error";
  type VEvent = "INSERT" | "SELECT" | "COLLECT" | "RESET";
  interface VCtx { balance: number; item: string }

  function vending() {
    return createMachine<VState, VEvent, VCtx>({
      initial: "idle",
      context: { balance: 0, item: "" },
      states: {
        idle: {
          on: {
            INSERT: {
              to: "has_money",
              actions: [(ctx) => { ctx.balance += 100; }],
            },
          },
        },
        has_money: {
          on: {
            INSERT: {
              to: "has_money",
              actions: [(ctx) => { ctx.balance += 100; }],
            },
            SELECT: [
              {
                to: "dispensing",
                guard: (ctx) => ctx.balance >= 150,
                actions: [(ctx, _) => { ctx.item = "cola"; ctx.balance -= 150; }],
              },
              { to: "error" },
            ],
            RESET: { to: "idle", actions: [(ctx) => { ctx.balance = 0; }] },
          },
        },
        dispensing: {
          on: { COLLECT: { to: "idle", actions: [(ctx) => { ctx.item = ""; }] } },
        },
        error: {
          on: { RESET: { to: "idle", actions: [(ctx) => { ctx.balance = 0; }] } },
        },
      },
    });
  }

  test("happy path: insert twice, select, collect", async () => {
    const m = vending();
    await m.send("INSERT");
    await m.send("INSERT");
    expect(m.context.balance).toBe(200);
    await m.send("SELECT");
    expect(m.state).toBe("dispensing");
    expect(m.context.item).toBe("cola");
    expect(m.context.balance).toBe(50);
    await m.send("COLLECT");
    expect(m.state).toBe("idle");
  });

  test("insufficient balance goes to error", async () => {
    const m = vending();
    await m.send("INSERT"); // 100 cents — not enough for 150
    await m.send("SELECT");
    expect(m.state).toBe("error");
  });

  test("reset from error", async () => {
    const m = vending();
    await m.send("INSERT");
    await m.send("SELECT"); // error
    await m.send("RESET");
    expect(m.state).toBe("idle");
    expect(m.context.balance).toBe(0);
  });
});

// ── No-context machine ────────────────────────────────────────────────────────

describe("no context", () => {
  test("machine works without context option", async () => {
    const m = createMachine<"a" | "b", "GO">({
      initial: "a",
      states: {
        a: { on: { GO: { to: "b" } } },
        b: {},
      },
    });
    await m.send("GO");
    expect(m.state).toBe("b");
  });
});
