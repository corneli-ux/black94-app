/**
 * websearch.ts — Web search integration
 *
 * Uses the z-ai-web-dev-sdk to fetch web search results.
 * This runs on a backend-compatible API; in React Native it calls
 * a Firebase Cloud Function or direct REST endpoint.
 *
 * For now, we use the built-in fetch API with a search endpoint.
 */

export interface WebSearchResult {
  url: string;
  name: string;
  snippet: string;
  hostName: string;
}

/**
 * Searches the web for the given query.
 * Returns an array of search results.
 */
export async function searchWeb(query: string, numResults: number = 10): Promise<WebSearchResult[]> {
  if (!query.trim()) return [];

  try {
    // Use Firebase Functions callable endpoint for web search
    // The function proxies to z-ai-web-dev-sdk on the backend
    const response = await fetch(
      'https://us-central1-black94.cloudfunctions.net/webSearch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, num: numResults }),
      }
    );

    if (!response.ok) {
      console.warn('[WebSearch] Function returned status:', response.status);
      return [];
    }

    const data = await response.json();

    if (Array.isArray(data)) {
      return data.slice(0, numResults).map((item: any) => ({
        url: item.url || '',
        name: item.name || item.title || '',
        snippet: item.snippet || item.description || '',
        hostName: item.host_name || new URL(item.url || 'https://example.com').hostname,
      }));
    }

    return [];
  } catch (e) {
    // Cloud function may not be deployed yet — gracefully fall back
    console.warn('[WebSearch] Search failed (function may not be deployed):', e);
    return [];
  }
}
