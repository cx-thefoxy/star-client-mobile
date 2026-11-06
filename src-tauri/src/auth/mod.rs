//! Microsoft account sign-in for Minecraft Java Edition.
//! Flow: Entra ID auth code + PKCE (loopback redirect) → Xbox Live user token → XSTS →
//! Minecraft services login_with_xbox → entitlements + profile checks.
pub mod config;
pub mod flow;
pub mod pkce;
pub mod redact;
pub mod store;
pub mod xbox;
