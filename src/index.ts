// ── Types ──────────────────────────────────────────────────────────────────────

/** A guard function — return false to cancel the transition. */
export type Guard<Context> = (ctx: Context, event: string) => boolean | Promise<boolean>;

/** A side-effect called when entering/leaving a state or on transition. Return value is ignored; async actions are awaited. */
export type Action<Context> = (ctx: Context, event: string) => unknown;

/** Config for a single transition. */
export interface TransitionConfig<State extends string, Context> {
  /** Target state after the transition. */
  to: State;
  /** Guard: if it returns false the transition is cancelled. */
  guard?: Guard<Context>;
  /** Actions run (in order) when this transition fires. */
  actions?: Action<Context>[];
}

/** Config for a single state. */
export interface StateConfig<State extends string, Event extends string, Context> {
  /** Actions run on every entry into this state. */
  onEnter?: Action<Context>[];
  /** Actions run on every exit from this state. */
  onExit?: Action<Context>[];
  /** Map of event → transition(s). First passing guard wins. */
  on?: Partial<Record<Event, TransitionConfig<State, Context> | TransitionConfig<State, Context>[]>>;
}

/** Top-level FSM definition passed to `createMachine`. */
export interface MachineConfig<
  State extends string,
  Event extends string,
  Context extends object = Record<string, never>
> {
  /** Initial state. */
  initial: State;
  /** Initial context (mutable user data carried through transitions). */
  context?: Context;
  /** State definitions. */
  states: Record<State, StateConfig<State, Event, Context>>;
}

/** A listener for state changes. */
export type Listener<State extends string, Context> = (
  state: State,
  prev: State,
  event: string,
  ctx: Context
) => void;

// ── Errors ─────────────────────────────────────────────────────────────────────

export class InvalidTransitionError extends Error {
  constructor(public readonly from: string, public readonly event: string) {
    super(`No transition for event "${event}" in state "${from}"`);
    this.name = "InvalidTransitionError";
  }
}

export class GuardRejectedError extends Error {
  constructor(public readonly from: string, public readonly event: string) {
    super(`Guard rejected transition for event "${event}" in state "${from}"`);
    this.name = "GuardRejectedError";
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function runAction<C>(action: Action<C>, ctx: C, event: string): Promise<void> {
  const result = action(ctx, event);
  if (result instanceof Promise) await result;
}

// ── Machine ────────────────────────────────────────────────────────────────────

export class Machine<
  State extends string,
  Event extends string,
  Context extends object = Record<string, never>
> {
  private _state: State;
  private _ctx: Context;
  private readonly _cfg: MachineConfig<State, Event, Context>;
  private readonly _listeners: Set<Listener<State, Context>> = new Set();

  constructor(cfg: MachineConfig<State, Event, Context>) {
    this._cfg = cfg;
    this._state = cfg.initial;
    this._ctx = cfg.context ?? ({} as Context);
  }

  /** Current state. */
  get state(): State {
    return this._state;
  }

  /** Current context (reference — mutations are visible immediately). */
  get context(): Context {
    return this._ctx;
  }

  /** True if the machine is in `s`. */
  is(s: State): boolean {
    return this._state === s;
  }

  /** True if there is at least one defined transition for `event` in the current state. */
  can(event: Event): boolean {
    const stateCfg = this._cfg.states[this._state];
    return !!(stateCfg.on && event in stateCfg.on);
  }

  /**
   * Fire `event`. Runs guards and actions, updates state.
   * @throws {InvalidTransitionError} if the event is not defined in the current state.
   * @throws {GuardRejectedError} if all guards reject the transition.
   */
  async send(event: Event): Promise<State> {
    const stateCfg = this._cfg.states[this._state];
    const raw = stateCfg.on?.[event];
    if (!raw) throw new InvalidTransitionError(this._state, event);

    const candidates = Array.isArray(raw) ? raw : [raw];
    let chosen: TransitionConfig<State, Context> | null = null;

    for (const t of candidates) {
      if (!t.guard || (await t.guard(this._ctx, event))) {
        chosen = t;
        break;
      }
    }
    if (!chosen) throw new GuardRejectedError(this._state, event);

    const prev = this._state;

    // onExit actions for the current state
    for (const a of stateCfg.onExit ?? []) await runAction(a, this._ctx, event);

    // transition actions
    for (const a of chosen.actions ?? []) await runAction(a, this._ctx, event);

    this._state = chosen.to;

    // onEnter actions for the new state
    const nextCfg = this._cfg.states[this._state];
    for (const a of nextCfg.onEnter ?? []) await runAction(a, this._ctx, event);

    this._notify(prev, event);
    return this._state;
  }

  /**
   * Subscribe to state transitions.
   * @returns Unsubscribe function.
   */
  subscribe(listener: Listener<State, Context>): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** All states reachable from the initial state via any event. */
  reachableStates(): Set<State> {
    const visited = new Set<State>();
    const queue: State[] = [this._cfg.initial];
    while (queue.length) {
      const s = queue.shift()!;
      if (visited.has(s)) continue;
      visited.add(s);
      const cfg = this._cfg.states[s];
      for (const t of Object.values(cfg.on ?? {})) {
        const arr = Array.isArray(t)
          ? (t as TransitionConfig<State, Context>[])
          : [t as TransitionConfig<State, Context>];
        for (const { to } of arr) if (!visited.has(to)) queue.push(to);
      }
    }
    return visited;
  }

  private _notify(prev: State, event: string): void {
    for (const l of this._listeners) l(this._state, prev, event, this._ctx);
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Create a new FSM instance.
 *
 * @example
 * const traffic = createMachine({
 *   initial: "red",
 *   states: {
 *     red:    { on: { GO:   { to: "green"  } } },
 *     green:  { on: { SLOW: { to: "yellow" } } },
 *     yellow: { on: { STOP: { to: "red"    } } },
 *   },
 * });
 * await traffic.send("GO");   // state → "green"
 * await traffic.send("SLOW"); // state → "yellow"
 */
export function createMachine<
  State extends string,
  Event extends string,
  Context extends object = Record<string, never>
>(cfg: MachineConfig<State, Event, Context>): Machine<State, Event, Context> {
  return new Machine(cfg);
}
