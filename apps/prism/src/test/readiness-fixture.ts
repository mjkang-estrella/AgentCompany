import { EXAMPLE_SPEC, EXAMPLE_ACCEPTANCE } from "@/lib/example";
export const READY_SPEC = EXAMPLE_SPEC.replace(
  "_To be defined through clarification._",
  EXAMPLE_ACCEPTANCE,
);
