export const ENGINE_ACTIONS = ["author", "run", "view"] as const;
export type EngineAction = (typeof ENGINE_ACTIONS)[number];
