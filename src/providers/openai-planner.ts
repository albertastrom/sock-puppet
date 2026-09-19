import { persona, performanceJsonSchema } from "../harness/performance";
import { maxSpeeds, type Capabilities } from "../robot/types";
import type { State } from "@sock-puppet/robot/simulator";
import type { HistoryMessage, PerformancePlanner } from "./types";
import { apiKey } from "./openai-config";

export class OpenAIPlanner implements PerformancePlanner {
  constructor(private env: NodeJS.ProcessEnv = process.env) {}
  async plan(
    history: HistoryMessage[],
    capabilities: Capabilities,
    state: State,
    signal: AbortSignal,
    repair?: string,
  ) {
    const timeout = AbortSignal.timeout(30000);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey(this.env)}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.any([signal, timeout]),
      body: JSON.stringify({
        model: this.env.OPENAI_PLAN_MODEL ?? "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `${persona}\nLanguage: ${this.env.OPENAI_LANGUAGE ?? "en"}.\nDevice: ${JSON.stringify({ motors: capabilities.motors, maxSpeeds, display: capabilities.display, eyeModes: capabilities.eyeModes })}\nCurrent motors: ${JSON.stringify(state.motors)}`,
          },
          ...history,
          ...(repair
            ? [
                {
                  role: "system",
                  content: `Your previous turn failed validation: ${repair}. Return a corrected complete performance that uses version-1 motor and eye fields for the latest user turn.`,
                },
              ]
            : []),
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "puppet_performance",
            strict: true,
            schema: performanceJsonSchema,
          },
        },
        max_tokens: 6000,
      }),
    });
    if (!response.ok)
      throw new Error(`OpenAI chat request failed (${response.status})`);
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned no performance");
    return JSON.parse(content);
  }
}
