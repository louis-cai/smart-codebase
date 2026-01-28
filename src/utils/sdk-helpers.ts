/**
 * OpenCode SDK utility helpers
 * Provides common patterns for working with SDK responses and message parts
 */

import type { Part } from "@opencode-ai/sdk";

/**
 * Extract data from SDK response, throwing on error
 * @param response - SDK response object with data and optional error
 * @returns The data if present
 * @throws Error if response contains an error
 */
export function unwrapData<T>(response: { data?: T; error?: Error }): T {
  if (response.error) {
    throw response.error;
  }
  if (response.data === undefined) {
    throw new Error("Response contains no data");
  }
  return response.data;
}

/**
 * Extract text content from message parts array
 * @param parts - Array of message parts from SDK response
 * @returns Concatenated text from all text-type parts
 */
export function extractTextFromParts(parts: Part[]): string {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * Wrap a promise with a timeout
 * @param promise - Promise to wrap
 * @param timeoutMs - Timeout in milliseconds (default: 60000)
 * @returns Promise that rejects if timeout is exceeded
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 60000
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}
