import type { BackgroundAIMessage, BackgroundAIResponse } from '../shared/aiTypes';
import { getAISettings } from '../shared/storage';

const AI_ENDPOINT =
  import.meta.env.VITE_AI_ENDPOINT ?? 'http://127.0.0.1:8787/api/interpret-command';
const AI_REQUEST_TIMEOUT_MS = 12000;

chrome.runtime.onInstalled.addListener(() => {
  console.info('[UI Remix] Extension installed.');
});

chrome.runtime.onMessage.addListener((message: BackgroundAIMessage, _sender, sendResponse) => {
  if (message?.type !== 'UI_REMIX_AI_INTERPRET_COMMAND') {
    return false;
  }

  void interpretCommand(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      } satisfies BackgroundAIResponse);
    });

  return true;
});

async function interpretCommand(message: BackgroundAIMessage): Promise<BackgroundAIResponse> {
  const settings = await getAISettings();
  if (!settings.enabled) {
    return {
      ok: false,
      error: 'AI is disabled.'
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(settings.accessToken ? { 'x-ui-remix-access-token': settings.accessToken } : {})
      },
      body: JSON.stringify(message.request),
      signal: controller.signal
    });

    const json = (await response.json()) as BackgroundAIResponse;
    if (!response.ok) {
      return {
        ok: false,
        error: json.error ?? `AI endpoint failed with ${response.status}`
      };
    }

    return json;
  } finally {
    clearTimeout(timeout);
  }
}
