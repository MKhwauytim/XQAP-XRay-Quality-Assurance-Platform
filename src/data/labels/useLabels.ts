import { useEffect, useState } from "react";
import { getLabels, subscribe, type Labels } from "./labelsStore";

export type { Labels };

export function useLabels(): Labels {
  const [labels, setLabels] = useState<Labels>(() => getLabels());
  useEffect(() => subscribe(() => setLabels(getLabels())), []);
  return labels;
}
