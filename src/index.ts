export interface Observer {
  record(): never;
}

export function createObserver(): Observer {
  throw new Error("@posteria/observer runtime is not implemented yet");
}
