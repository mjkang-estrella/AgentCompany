import { NextResponse } from "next/server";
import { startSessionMarketResearch } from "@/lib/research";

interface Params {
  params: {
    id: string;
  };
}

export async function POST(_: Request, { params }: Params) {
  try {
    const workspace = startSessionMarketResearch(params.id);
    return NextResponse.json(workspace);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start market research.";
    const status =
      /not found/i.test(message) ? 404
        : /80% clarification score/i.test(message) ? 409
        : /EXA_API_KEY/i.test(message) ? 503
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
