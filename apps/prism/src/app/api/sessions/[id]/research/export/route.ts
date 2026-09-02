import { NextResponse } from "next/server";
import { getSessionWorkspace } from "@/lib/clarification";

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

  if (!workspace.marketReport?.markdown_content) {
    return NextResponse.json(
      { error: "No market research report is available." },
      { status: 409 }
    );
  }

  return new NextResponse(workspace.marketReport.markdown_content, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slugify(
        workspace.session.title
      )}-market-research.md"`,
    },
  });
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "prism-spec"
  );
}
