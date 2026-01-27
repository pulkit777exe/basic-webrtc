import DOMPurify from 'isomorphic-dompurify';

export function sanitizeText(text: string): string {
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [] });
}

export function validateChatMessage(text: string): { valid: boolean; error?: string } {
  if (!text || text.trim().length === 0) {
    return { valid: false, error: 'Message cannot be empty' };
  }

  if (text.length > 500) {
    return { valid: false, error: 'Message too long (max 500 characters)' };
  }

  // Check for spam patterns
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const urlMatches = text.match(urlPattern);
  if (urlMatches && urlMatches.length > 3) {
    return { valid: false, error: 'Too many links in message' };
  }

  return { valid: true };
}