import { NextResponse } from "next/server";
import { submitSessionAnswer } from "@/lib/clarification";

interface Params {
  params: {
    id: string;
  };
}

export async function POST(request: Request, { params }: Params) {
  try {
    const payload = (await request.json()) as {
      answer?: string;
      selectedChoiceKey?: string;
      selectedChoiceLabel?: string;
    };

    if (!payload.answer?.trim()) {
      return NextResponse.json({ error: "answer is required" }, { status: 400 });
    }

    const workspace = await submitSessionAnswer(params.id, {
      answer: payload.answer,
      selectedChoiceKey: payload.selectedChoiceKey,
      selectedChoiceLabel: payload.selectedChoiceLabel,
    });

    return NextResponse.json(workspace);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit answer.";
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
