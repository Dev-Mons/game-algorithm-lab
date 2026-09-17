import { executeEnvironment, type ExecutionOptions } from './environment-generation';
import type { GenerationDocument } from './document';
export function generateDocument(document:GenerationDocument, options:ExecutionOptions={}) {
  return executeEnvironment(document, options).result;
}
export function documentCatalog(document:GenerationDocument) { return document.catalog.tiles; }
