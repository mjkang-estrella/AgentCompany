export const DEFAULT_HIGHLIGHT_COLOR = "amber";
const CONTEXT_CHARS = 48;

export const clampRange = (startOffset, endOffset, maxLength) => {
  const start = Math.max(0, Math.min(Number(startOffset) || 0, maxLength));
  const end = Math.max(start, Math.min(Number(endOffset) || 0, maxLength));
  return { start, end };
};

export const trimWhitespaceRange = (fullText, startOffset, endOffset) => {
  const { start, end } = clampRange(startOffset, endOffset, fullText.length);
  let nextStart = start;
  let nextEnd = end;

  while (nextStart < nextEnd && /\s/u.test(fullText[nextStart] || "")) {
    nextStart += 1;
  }

  while (nextEnd > nextStart && /\s/u.test(fullText[nextEnd - 1] || "")) {
    nextEnd -= 1;
  }

  return {
    end: nextEnd,
    start: nextStart
  };
};

export const buildHighlightContext = (fullText, startOffset, endOffset) => {
  const { start, end } = trimWhitespaceRange(fullText, startOffset, endOffset);
  return {
    endOffset: end,
    prefixText: fullText.slice(Math.max(0, start - CONTEXT_CHARS), start),
    selectedText: fullText.slice(start, end),
    startOffset: start,
    suffixText: fullText.slice(end, Math.min(fullText.length, end + CONTEXT_CHARS))
  };
};

export const highlightsOverlap = (left, right) =>
  Math.max(left.startOffset, right.startOffset) < Math.min(left.endOffset, right.endOffset);

const scoreMatch = (fullText, index, selectedText, prefixText, suffixText) => {
  let score = 0;
  const before = fullText.slice(Math.max(0, index - prefixText.length), index);
  const after = fullText.slice(index + selectedText.length, index + selectedText.length + suffixText.length);

  if (prefixText && before.endsWith(prefixText)) {
    score += prefixText.length + 20;
  }

  if (suffixText && after.startsWith(suffixText)) {
    score += suffixText.length + 20;
  }

  return score;
};

export const resolveHighlightOffsets = (fullText, highlight) => {
  if (!fullText || !highlight?.selectedText) {
    return null;
  }

  const trimmed = buildHighlightContext(fullText, highlight.startOffset, highlight.endOffset);
  if (
    trimmed.selectedText &&
    fullText.slice(trimmed.startOffset, trimmed.endOffset) === highlight.selectedText
  ) {
    return {
      endOffset: trimmed.endOffset,
      startOffset: trimmed.startOffset
    };
  }

  let bestMatch = null;
  let bestScore = -1;
  let searchIndex = 0;

  while (true) {
    const matchIndex = fullText.indexOf(highlight.selectedText, searchIndex);
    if (matchIndex === -1) {
      break;
    }

    const score = scoreMatch(
      fullText,
      matchIndex,
      highlight.selectedText,
      highlight.prefixText || "",
      highlight.suffixText || ""
    );

    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        endOffset: matchIndex + highlight.selectedText.length,
        startOffset: matchIndex
      };
    }

    searchIndex = matchIndex + Math.max(1, highlight.selectedText.length);
  }

  return bestMatch;
};
