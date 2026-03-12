import { NextResponse } from "next/server";
import { runInBackground } from "@/lib/background";
import { runSessionMarketResearch, startSessionMarketResearch } from "@/lib/research";

export const maxDuration = 60;

interface Params {
  params: {
    id: string;
  };
}

export async function POST(_: Request, { params }: Params) {
  try {
    const { workspace, started } = await startSessionMarketResearch(params.id);

    if (started) {
      runInBackground(runSessionMarketResearch(params.id));
    }

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
