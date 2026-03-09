import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface PromptMessage {
  role: "assistant" | "user";
  content: string;
}

export type StructuredJsonTask = "question_generation" | "ambiguity_scoring" | "spec_rewrite";

type ProviderName = "anthropic" | "openai";

interface ProviderStep {
  provider: ProviderName;
  model: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

const OUROBOROS_PRIMARY_MODEL = "claude-opus-4-6";
const GPT_FALLBACK_MODEL = "gpt-5.4";
const OUROBOROS_MAX_TOKENS = 2048;

const TASK_PROVIDER_SETTINGS: Record<StructuredJsonTask, { primary: ProviderStep; fallback: ProviderStep }> = {
  question_generation: {
    primary: {
      provider: "anthropic",
      model: OUROBOROS_PRIMARY_MODEL,
      temperature: 0.7,
      maxTokens: OUROBOROS_MAX_TOKENS,
    },
    fallback: {
      provider: "openai",
      model: GPT_FALLBACK_MODEL,
      reasoningEffort: "medium",
    },
  },
  ambiguity_scoring: {
    primary: {
      provider: "anthropic",
      model: OUROBOROS_PRIMARY_MODEL,
      temperature: 0.1,
      maxTokens: OUROBOROS_MAX_TOKENS,
    },
    fallback: {
      provider: "openai",
      model: GPT_FALLBACK_MODEL,
      reasoningEffort: "low",
    },
  },
  spec_rewrite: {
    primary: {
      provider: "anthropic",
      model: OUROBOROS_PRIMARY_MODEL,
      temperature: 0.2,
      maxTokens: OUROBOROS_MAX_TOKENS,
    },
    fallback: {
      provider: "openai",
      model: GPT_FALLBACK_MODEL,
      reasoningEffort: "low",
    },
  },
};

let cachedClient: OpenAI | null = null;
let cachedAnthropicClient: Anthropic | null = null;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return cachedClient;
}

function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  if (!cachedAnthropicClient) {
    cachedAnthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  return cachedAnthropicClient;
}

export function hasOpenAiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function hasStructuredJsonProvider(): boolean {
  return hasAnthropicKey() || hasOpenAiKey();
}

export function getStructuredJsonProviderPlan(task: StructuredJsonTask): ProviderStep[] {
  const settings = TASK_PROVIDER_SETTINGS[task];
  const steps: ProviderStep[] = [];

  if (hasAnthropicKey()) {
    steps.push({ ...settings.primary });
  }

  if (hasOpenAiKey()) {
    steps.push({ ...settings.fallback });
  }

  return steps;
}

export function parseJsonObject<T>(raw: string): T {
  const trimmed = raw.trim();
  const blockMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/i);
  const candidate = blockMatch?.[1] ?? trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;

  return JSON.parse(candidate) as T;
}

function extractOutputText(response: any): string {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  if (Array.isArray(response?.output)) {
    const chunks: string[] = [];

    for (const item of response.output) {
      if (!Array.isArray(item?.content)) {
        continue;
      }

      for (const content of item.content) {
        const text =
          typeof content?.text === "string"
            ? content.text
            : typeof content?.output_text === "string"
              ? content.output_text
              : "";

        if (text) {
          chunks.push(text);
        }
      }
    }

    if (chunks.length > 0) {
      return chunks.join("\n").trim();
    }
  }

  return "";
}

function extractAnthropicText(response: Anthropic.Messages.Message): string {
  return response.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function requestWithAnthropic<T>(
  step: ProviderStep,
  input: {
    systemPrompt: string;
    messages: PromptMessage[];
  }
): Promise<T> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: step.model,
    max_tokens: step.maxTokens ?? OUROBOROS_MAX_TOKENS,
    temperature: step.temperature ?? 0.7,
    system: input.systemPrompt,
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  });
  const output = extractAnthropicText(response);

  if (!output) {
    throw new Error("Anthropic returned an empty response.");
  }

  return parseJsonObject<T>(output);
}

async function requestWithOpenAi<T>(
  step: ProviderStep,
  input: {
    schemaName: string;
    schema: Record<string, unknown>;
    systemPrompt: string;
    messages: PromptMessage[];
  }
): Promise<T> {
  const client = getClient();
  const requestBody: Record<string, unknown> = {
    model: step.model,
    reasoning: {
      effort: step.reasoningEffort ?? "low",
    },
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: input.systemPrompt }],
      },
      ...input.messages.map((message) => ({
        role: message.role,
        content: [{ type: "input_text", text: message.content }],
      })),
    ],
    text: {
      format: {
        type: "json_schema",
        name: input.schemaName,
        schema: input.schema,
        strict: true,
      },
    },
  };

  const response = await client.responses.create(requestBody as any);
  const output = extractOutputText(response);

  if (!output) {
    throw new Error("OpenAI returned an empty response.");
  }

  return parseJsonObject<T>(output);
}

export async function requestStructuredJson<T>(input: {
  task: StructuredJsonTask;
  schemaName: string;
  schema: Record<string, unknown>;
  systemPrompt: string;
  messages: PromptMessage[];
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<T> {
  const plan = getStructuredJsonProviderPlan(input.task);
  let lastError: unknown = null;

  for (const step of plan) {
    try {
      if (step.provider === "anthropic") {
        return await requestWithAnthropic<T>(step, {
          systemPrompt: input.systemPrompt,
          messages: input.messages,
        });
      }

      return await requestWithOpenAi<T>(step, {
        schemaName: input.schemaName,
        schema: input.schema,
        systemPrompt: input.systemPrompt,
        messages: input.messages,
      });
    } catch (error) {
      lastError = error;
      console.error(
        `[Prism] ${step.provider} ${step.model} failed for ${input.task}; ${step.provider === "anthropic" ? "trying fallback if available" : "no further fallback configured"}.`,
        error
      );
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("No LLM provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
}
