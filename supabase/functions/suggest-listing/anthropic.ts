// Calls Claude via the official Anthropic SDK, forcing structured output
// through a single tool whose schema is built fresh per request from the
// live category taxonomy. Not unit-tested (see index.ts's header note) --
// this is a real network call with no mocking layer in this repo.

import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0';

import { LISTING_CONDITIONS } from './parse.ts';
import type { CategoryPath } from './categories.ts';

/**
 * ROADMAP 4.1's recorded decision: Anthropic Claude Haiku 4.5, pinned to
 * this exact dated snapshot. Chosen over a frontier model for cost-per-call
 * on a rate-limited, per-listing suggestion feature -- "good enough, cheap,
 * fast" beats frontier reasoning here. No `thinking`/`effort` params: Haiku
 * 4.5 does not support either.
 */
export const SUGGESTION_MODEL = 'claude-haiku-4-5-20251001';

const TOOL_NAME = 'suggest_listing';

const PROMPT_TEXT =
  'These are photos of a second-hand item a seller is listing on a marketplace app. ' +
  'Look at the photos and call the suggest_listing tool with your best-guess listing details: ' +
  'a concise, buyer-friendly title; a short honest description of what is visible (condition, ' +
  'material, notable features or flaws -- never invent details you cannot see); the item\'s ' +
  'condition; the single most accurate category_path from the exact list you were given; and a ' +
  'realistic price range in ILS agorot (integer minor units, so ₪50.00 is 5000) for a used item ' +
  'of this kind sold secondhand in Israel. If photos make a field genuinely unclear, make your ' +
  'best reasonable estimate rather than refusing -- you must always call the tool.';

/**
 * Builds the single forced tool. `category_path` is an enum of exact
 * "Group > Leaf" strings built fresh from the live `categories` table --
 * never a hardcoded list -- so it can never drift from the real seeded
 * taxonomy (see categories.ts).
 */
export function buildSuggestionTool(categoryPaths: CategoryPath[]): Anthropic.Tool {
  const categoryPathValues = categoryPaths.map((entry) => entry.path);

  return {
    name: TOOL_NAME,
    description:
      'Suggest listing fields for a second-hand marketplace item, based on photos of it.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          maxLength: 120,
          description: 'A concise, buyer-friendly listing title.',
        },
        description: {
          type: 'string',
          maxLength: 5000,
          description: 'A short, honest description of what is visible in the photos.',
        },
        condition: {
          type: 'string',
          enum: [...LISTING_CONDITIONS],
          description: 'The item\'s condition.',
        },
        category_path: {
          type: 'string',
          enum: categoryPathValues,
          description: 'The single most accurate category, as an exact "Group > Leaf" string from this list.',
        },
        price_min_amount: {
          type: 'integer',
          minimum: 0,
          description: 'Low end of the suggested price range, in ILS agorot (integer minor units; 100 = ₪1).',
        },
        price_max_amount: {
          type: 'integer',
          minimum: 0,
          description: 'High end of the suggested price range, in ILS agorot.',
        },
      },
      required: ['title', 'description', 'condition', 'category_path', 'price_min_amount', 'price_max_amount'],
      additionalProperties: false,
    },
  };
}

/**
 * Sends up to 4 photos (cover first) plus the prompt, forces the model to
 * call `suggest_listing` via `tool_choice`, and returns the raw
 * (untrusted) tool input for parse.ts to validate. Throws on any SDK/
 * network error or if the model somehow stops without a tool_use block --
 * index.ts maps both to the `ai_unavailable` response reason.
 */
export async function callSuggestionModel(
  apiKey: string,
  photosBase64: string[],
  categoryPaths: CategoryPath[],
): Promise<unknown> {
  const client = new Anthropic({ apiKey });
  const tool = buildSuggestionTool(categoryPaths);

  const imageBlocks: Anthropic.ImageBlockParam[] = photosBase64.map((data) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data },
  }));

  const response = await client.messages.create({
    model: SUGGESTION_MODEL,
    max_tokens: 1024,
    tools: [tool],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: [...imageBlocks, { type: 'text', text: PROMPT_TEXT }],
      },
    ],
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );
  if (!toolUseBlock) {
    throw new Error(`Model did not return a tool_use block (stop_reason=${response.stop_reason})`);
  }
  return toolUseBlock.input;
}
