import { buildSupportingSpecContext, isQuestionTooSimilar } from "@/lib/questioning";

describe("questioning helpers", () => {
  it("builds supporting spec context from meaningful sections only", () => {
    const context = buildSupportingSpecContext(`# Prism

## Overview

A voice journaling tool.

## Problem

_To be defined through clarification._

## Goals

- Help users capture fast reflections

## Constraints

- Stay lightweight
`);

    expect(context).toContain("## Overview");
    expect(context).toContain("## Goals");
    expect(context).toContain("## Constraints");
    expect(context).not.toContain("## Problem");
  });

  it("detects near-duplicate questions", () => {
    expect(
      isQuestionTooSimilar(
        "How will you decide that this spec is successful enough to implement or ship?",
        ["How will you decide this spec is successful enough to ship?"]
      )
    ).toBe(true);
  });
});
