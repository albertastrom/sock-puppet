import { OpenAIPlanner } from "./openai-planner";
import { OpenAIVoice } from "./openai-voice";
import type { Providers } from "./types";

export function createOpenAIProviders(
  env: NodeJS.ProcessEnv = process.env,
): Providers {
  return { voice: new OpenAIVoice(env), planner: new OpenAIPlanner(env) };
}
