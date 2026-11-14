import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { SITE_ORIGIN } from "@/app/lib/site";

export interface McpAuthConfig {
  issuer: string;
  jwksUrl: URL;
  /** Tokens must name it as their audience. */
  resource: string;
  resourceMetadataUrl: string;
}

export type Caller =
  | { kind: "anonymous" }
  | { kind: "user"; subject: string }
  | { kind: "invalid" }
  /** The signing keys couldn't be fetched. */
  | { kind: "unverifiable" };

const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
// Asymmetric only, so a public key can't be used as an HMAC secret.
const SIGNING_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];
const CLOCK_TOLERANCE_SECONDS = 30;

let cachedConfig: { key: string; config: McpAuthConfig | null } | undefined;

export function mcpAuthConfig(): McpAuthConfig | null {
  const domain = process.env.MCP_AUTHKIT_DOMAIN?.trim() ?? "";
  const resourceSetting = process.env.MCP_RESOURCE_URL?.trim() ?? "";
  const key = `${domain}\n${resourceSetting}`;
  if (cachedConfig?.key !== key) cachedConfig = { key, config: parseConfig(domain, resourceSetting) };
  return cachedConfig.config;
}

function parseConfig(domain: string, resourceSetting: string): McpAuthConfig | null {
  if (!domain) return null;
  try {
    const issuer = new URL(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`).origin;
    const resourceUrl = new URL(resourceSetting || `${SITE_ORIGIN}/api/mcp`);
    resourceUrl.hash = "";
    // RFC 8707 resources have no trailing slash; clients send the URL they were given.
    const resource = resourceUrl.href.replace(/\/$/, "");
    const path = resourceUrl.pathname === "/" ? "" : resourceUrl.pathname.replace(/\/$/, "");
    return {
      issuer,
      jwksUrl: new URL("/oauth2/jwks", issuer),
      resource,
      resourceMetadataUrl: `${resourceUrl.origin}${PROTECTED_RESOURCE_PATH}${path}`,
    };
  } catch {
    console.error("MCP auth is off: MCP_AUTHKIT_DOMAIN or MCP_RESOURCE_URL is not a valid URL.");
    return null;
  }
}

export function protectedResourceMetadata(config: McpAuthConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    resource_name: "EFT Toolset",
    resource_documentation: `${SITE_ORIGIN}/mcp`,
  };
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySet(config: McpAuthConfig) {
  let keys = keySets.get(config.jwksUrl.href);
  if (!keys) {
    keys = createRemoteJWKSet(config.jwksUrl, { timeoutDuration: 3_000 });
    keySets.set(config.jwksUrl.href, keys);
  }
  return keys;
}

const INVALID_TOKEN_ERRORS = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
];

export async function verifyAccessToken(token: string, config: McpAuthConfig): Promise<Caller> {
  try {
    const { payload } = await jwtVerify(token, keySet(config), {
      issuer: config.issuer,
      audience: config.resource,
      algorithms: SIGNING_ALGORITHMS,
      requiredClaims: ["sub", "exp"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    // AuthKit signs agent tokens with the same keys; only user tokens identify a person.
    if (typeof payload.sub !== "string" || !payload.sub || payload.sub_profile === "ai_agent") return { kind: "invalid" };
    return { kind: "user", subject: payload.sub };
  } catch (error) {
    if (INVALID_TOKEN_ERRORS.some((type) => error instanceof type)) return { kind: "invalid" };
    console.error("MCP access token could not be verified", error);
    return { kind: "unverifiable" };
  }
}

export async function identifyCaller(request: Request, config: McpAuthConfig | null): Promise<Caller> {
  if (!config) return { kind: "anonymous" };
  const match = /^Bearer(?:\s+(.*))?$/i.exec(request.headers.get("authorization")?.trim() ?? "");
  if (!match) return { kind: "anonymous" };
  const token = match[1]?.trim();
  return token ? verifyAccessToken(token, config) : { kind: "invalid" };
}

export type ChallengeReason = "sign_in" | "invalid_token";

const CHALLENGE_DESCRIPTIONS: Record<ChallengeReason, string> = {
  sign_in: "Anonymous use of EFT Toolset is rate limited right now. Sign in to EFT Toolset to keep going with your own limit.",
  invalid_token: "The access token is expired or invalid. Sign in again.",
};

/** RFC 6750 section 3: no error code when no token was sent. */
export function wwwAuthenticate(config: McpAuthConfig, reason: ChallengeReason) {
  const metadata = `Bearer resource_metadata="${config.resourceMetadataUrl}"`;
  if (reason === "sign_in") return metadata;
  return `${metadata}, error="invalid_token", error_description="${CHALLENGE_DESCRIPTIONS.invalid_token}"`;
}

/**
 * Whether a request comes from ChatGPT, which starts sign-in from a tool result's
 * _meta["mcp/www_authenticate"] rather than from a 401
 * (https://developers.openai.com/apps-sdk/build/auth). ChatGPT puts openai/* keys
 * (openai/subject, openai/session, openai/locale) in every tool call's _meta
 * (https://developers.openai.com/apps-sdk/reference), and its connector sends a User-Agent
 * of openai-mcp/<version>. Either is enough. Both can be spoofed, but a spoofer only changes
 * how its own challenge is shaped.
 */
export function isChatGptRequest(request: Request, params: unknown) {
  const meta = params && typeof params === "object" ? (params as { _meta?: unknown })._meta : undefined;
  if (meta && typeof meta === "object" && Object.keys(meta).some((key) => key.startsWith("openai/"))) return true;
  return /^openai-mcp\//i.test(request.headers.get("user-agent")?.trim() ?? "");
}

/** ChatGPT starts OAuth from this, and needs error and error_description in it. */
export function signInToolResult(config: McpAuthConfig, reason: ChallengeReason) {
  const description = CHALLENGE_DESCRIPTIONS[reason];
  const error = reason === "sign_in" ? "insufficient_scope" : "invalid_token";
  return {
    isError: true,
    content: [{ type: "text" as const, text: description }],
    _meta: {
      "mcp/www_authenticate": [
        `Bearer resource_metadata="${config.resourceMetadataUrl}", error="${error}", error_description="${description}"`,
      ],
    },
  };
}

export const OPTIONAL_OAUTH_SECURITY_SCHEMES = [{ type: "noauth" }, { type: "oauth2", scopes: [] as string[] }];
