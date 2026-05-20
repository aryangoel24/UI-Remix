import type { ContentMessage, ContentMessageResponse } from '../shared/types';

const CONTENT_SCRIPT_FILE = 'assets/content.js';

export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] ?? null);
    });
  });
}

export async function sendMessageToActiveTab(
  message: ContentMessage
): Promise<ContentMessageResponse> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error('No active tab is available.');
  }

  try {
    return await sendMessage(tab.id, message);
  } catch (error) {
    if (!shouldAttemptContentScriptInjection(error)) {
      throw error;
    }

    await injectContentScript(tab.id);
    return sendMessage(tab.id, message);
  }
}

function sendMessage(tabId: number, message: ContentMessage): Promise<ContentMessageResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: ContentMessageResponse | undefined) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!response) {
        reject(new Error('Content script did not respond.'));
        return;
      }

      resolve(response);
    });
  });
}

function injectContentScript(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: [CONTENT_SCRIPT_FILE]
      },
      () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve();
      }
    );
  });
}

function shouldAttemptContentScriptInjection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Receiving end does not exist') ||
    message.includes('Could not establish connection')
  );
}
