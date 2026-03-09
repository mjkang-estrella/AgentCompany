import { NextResponse } from "next/server";
import { getSessionWorkspace, kickSessionReconciliation, updateSessionDraft } from "@/lib/clarification";

interface Params {
  params: {
    id: string;
  };
}

export async function GET(_: Request, { params }: Params) {
  const workspace = getSessionWorkspace(params.id);

  if (!workspace) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (workspace.session.reconciliation_status !== "idle") {
    kickSessionReconciliation(params.id);
  }

  return NextResponse.json(workspace);
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const payload = (await request.json()) as { spec_content?: string };

    if (typeof payload.spec_content !== "string") {
      return NextResponse.json({ error: "spec_content must be a string." }, { status: 400 });
    }

    const workspace = updateSessionDraft(params.id, payload.spec_content);
    if (!workspace) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    return NextResponse.json(workspace);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update session." },
      { status: 500 }
    );
  }
}
