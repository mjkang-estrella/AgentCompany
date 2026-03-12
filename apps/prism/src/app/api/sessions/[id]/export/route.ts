import { NextResponse } from "next/server";
import { getSessionWorkspace } from "@/lib/clarification";
import { buildExportBundle } from "@/lib/export";

interface Params {
  params: {
    id: string;
  };
}

export async function GET(_: Request, { params }: Params) {
  const workspace = await getSessionWorkspace(params.id);

  if (!workspace) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (!workspace.session.is_ready) {
    return NextResponse.json({ error: "Session is not ready for export yet." }, { status: 409 });
  }

  return new NextResponse(buildExportBundle(workspace), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slugify(workspace.session.title)}.md"`,
    },
  });
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "prism-spec";
}
