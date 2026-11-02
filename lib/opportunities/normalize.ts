export type ParsedSender = {
  text: string;
  displayName: string;
  localPart: string;
  domain: string;
  email: string;
};

export function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function stripSubjectAnnotations(value: string) {
  return normalizeText(value).replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/g, "");
}

export function parseSender(from: string): ParsedSender {
  const text = normalizeText(from);
  const angle = from.match(/<([^>]+)>/);
  const emailRaw = (angle?.[1] ?? from.match(/[^\s<]+@[^\s>]+/)?.[0] ?? "").trim();
  const email = normalizeText(emailRaw);
  const [localPart = "", domain = ""] = email.split("@");
  const displayName = normalizeText(from.replace(/<[^>]+>/g, ""));

  return {
    text,
    displayName,
    localPart,
    domain,
    email,
  };
}

export function domainMatches(domain: string, listed: string) {
  return domain === listed || domain.endsWith(`.${listed}`);
}

export function hasContentFrame(subject: string) {
  return /\b(?:newsletters?|weekly digest|articles?|documentar(?:y|ies)|podcasts?|guides?|tutorials?|short courses?|course launch|learn how to|how to|watch now|watch our|read more|weekly update|tips?|career blog|blogs?)\b/.test(
    subject,
  );
}
