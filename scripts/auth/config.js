// scripts/auth/config.js
// Sign-In configuration. Single source of truth for the OAuth Client ID
// so we never have to grep the codebase to swap it.
//
// To get a new Client ID:
//   https://console.cloud.google.com/apis/credentials
//   project: dealerscan-prod
//   OAuth 2.0 Client IDs → DealerScan PWA (Web application)
//
// Authorized JavaScript origins MUST include https://dealerscan.live
// (and optionally http://localhost:8080 for local dev).

export const OAUTH_CLIENT_ID =
  "381110617094-9facj6bujq33ouona0930e0orcqoau1r.apps.googleusercontent.com";

// sessionStorage keys (scope: per-tab, dies on tab close — secure default)
export const TOKEN_KEY        = "ds.auth.token";
export const EMAIL_KEY        = "ds.auth.email";
export const NAME_KEY         = "ds.auth.name";
export const ROLE_KEY         = "ds.auth.role";
export const PICTURE_KEY      = "ds.auth.picture";
export const EXPIRES_AT_KEY   = "ds.auth.expiresAt";

// Dev-only "View as" override. When set, all API calls add viewAsEmail
// query param so the data layer impersonates another user. The actual
// auth token still belongs to the dev. Cleared on view-as-stop.
export const VIEW_AS_EMAIL_KEY = "ds.auth.viewAs.email";
export const VIEW_AS_NAME_KEY  = "ds.auth.viewAs.name";
