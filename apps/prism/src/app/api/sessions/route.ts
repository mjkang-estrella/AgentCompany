import { NextResponse } from "next/server";
import { EXAMPLE_SPEC } from "@/lib/example";
import { createSessionWorkspace, getSessionSummaries, updateSessionDraft } from "@/lib/clarification";

export async function GET() {
  return NextResponse.json({
    sessions: await getSessionSummaries(),
  });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { title?: string; initialIdea?: string; example?: boolean };

    if (!payload.title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const workspace = await createSessionWorkspace({
      title: payload.title,
      initialIdea: payload.initialIdea ?? "",
    });

    const result = payload.example ? await updateSessionDraft(workspace.session.id, EXAMPLE_SPEC) : workspace;
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create session." },
      { status: 500 }
    );
  }
}
