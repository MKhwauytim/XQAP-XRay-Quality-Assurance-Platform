export const ALLOWED_OPERATORS = ["+", "-", "*", "/", "=", "<>", "<", "<=", ">", ">=", "and", "or", "not"] as const;

export const ALLOWED_FUNCTIONS = [
  "sum", "count", "distinctCount", "avg", "min", "max", "percentOfTotal", "ratio", "if", "filter",
] as const;

export type BinOp = "+" | "-" | "*" | "/" | "=" | "<>" | "<" | "<=" | ">" | ">=" | "and" | "or";
export type AllowedFn = typeof ALLOWED_FUNCTIONS[number];

export type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "col"; id: string }
  | { k: "measure"; id: string }
  | { k: "bin"; op: BinOp; l: Expr; r: Expr }
  | { k: "not"; e: Expr }
  | { k: "call"; fn: AllowedFn; args: Expr[] };

/** Exact argument count for each allowed function. */
export const FUNCTION_ARITY: ReadonlyMap<AllowedFn, number> = new Map<AllowedFn, number>([
  ["sum", 1], ["count", 1], ["distinctCount", 1], ["avg", 1], ["min", 1], ["max", 1],
  ["percentOfTotal", 1], ["ratio", 2], ["if", 3], ["filter", 2],
]);
