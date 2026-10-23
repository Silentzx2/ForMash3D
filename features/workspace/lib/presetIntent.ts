export function getPresetIntentFromSearch(
  search: string,
  presets: Record<string, unknown>
): string | null {
  const intent = new URLSearchParams(search).get('intent');
  return intent && Object.hasOwn(presets, intent) ? intent : null;
}

export function getPromptFromSearch(search: string): string | null {
  return new URLSearchParams(search).get('prompt')?.trim() || null;
}

export function getModelFromSearch(search: string, supportedModelIds: readonly string[]): string | null {
  const model = new URLSearchParams(search).get('model');
  return model && supportedModelIds.includes(model) ? model : null;
}
