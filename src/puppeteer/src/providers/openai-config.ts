export function apiKey(env: NodeJS.ProcessEnv): string {
  const key = env.OPENAI_API_KEY;
  if (!key)
    throw new Error(
      "Set OPENAI_API_KEY in src/puppeteer/.env before starting a voice session",
    );
  return key;
}
