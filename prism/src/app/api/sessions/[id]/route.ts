import { NextResponse } from "next/server";
import { deleteSessionWorkspace, getSessionWorkspace, kickSessionReconciliation, updateSessionDraft } from "@/lib/clarification";
import { kickSessionMarketResearch } from "@/lib/research";

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

  if (workspace.marketReport && ["pending", "running"].includes(workspace.marketReport.status)) {
    kickSessionMarketResearch(params.id);
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

export async function DELETE(_: Request, { params }: Params) {
  try {
    const deleted = deleteSessionWorkspace(params.id);

    if (!deleted) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deletedId: params.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete session." },
      { status: 500 }
    );
  }
}
