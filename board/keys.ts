import type React from 'react';

/**
 * Keys for a box that saves, the same in every one: Enter saves, Shift+Enter adds a line, Escape cancels.
 * Enter while an input method is still putting a word together (Japanese, Chinese) picks the word; it
 * doesn't save half of it.
 */
export const saveKeys = (save: () => void, cancel?: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Escape' && cancel) { e.preventDefault(); cancel(); }
  else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); }
};
