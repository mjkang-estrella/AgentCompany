import { NextResponse } from "next/server";
import { createSessionWorkspace, getSessionSummaries } from "@/lib/clarification";

export async function GET() {
  return NextResponse.json({
    sessions: await getSessionSummaries(),
  });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { title?: string; initialIdea?: string };

    if (!payload.title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const workspace = await createSessionWorkspace({
      title: payload.title,
      initialIdea: payload.initialIdea ?? "",
    });

    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create session." },
      { status: 500 }
    );
  }
}
