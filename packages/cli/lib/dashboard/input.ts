/**
 * Re-export barrel for backward compatibility.
 * All input handling logic has been split into input/ submodules.
 */
export { createInputHandler, createCommandHandler } from './input/index.js';

export type {
  InkKey,
  InputHandlerContext,
  CommandSuggestion,
  CreateInputHandlerParams,
  CreateCommandHandlerParams,
} from './input/index.js';
