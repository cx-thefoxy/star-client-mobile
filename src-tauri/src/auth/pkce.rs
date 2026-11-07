use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

pub struct Pkce { pub verifier: String, pub challenge: String }

fn random_b64(n: usize) -> String {
    let mut b = vec![0u8; n];
    rand::rngs::OsRng.fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}

impl Pkce {
    /// RFC 7636: 43-128 char verifier, S256 challenge.
    pub fn new() -> Self {
        let verifier = random_b64(64);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Self { verifier, challenge }
    }
}

pub fn state() -> String { random_b64(24) }

/// Constant-time comparison for the OAuth `state` parameter.
pub fn eq_ct(a: &str, b: &str) -> bool {
    if a.len() != b.len() { return false; }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_shape() {
        let p = Pkce::new();
        assert!((43..=128).contains(&p.verifier.len()));
        assert_eq!(p.challenge.len(), 43);
        assert_eq!(p.challenge, URL_SAFE_NO_PAD.encode(Sha256::digest(p.verifier.as_bytes())));
        assert_ne!(Pkce::new().verifier, p.verifier);
    }

    #[test]
    fn rfc7636_vector() {
        let v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(URL_SAFE_NO_PAD.encode(Sha256::digest(v.as_bytes())), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn state_compare() {
        assert!(eq_ct("abc", "abc"));
        assert!(!eq_ct("abc", "abd"));
        assert!(!eq_ct("abc", "abcd"));
    }
}
