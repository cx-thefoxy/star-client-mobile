//! Secret redaction for logs, errors and diagnostic reports.
use std::sync::OnceLock;

fn patterns() -> &'static [regex::Regex] {
    static P: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    P.get_or_init(|| {
        [
            // JWTs (Minecraft access tokens, XSTS tokens)
            r"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}",
            // key=value style secrets
            r#"(?i)(access_token|refresh_token|accessToken|code_verifier|identityToken|RpsTicket|Authorization|[?&]code)(["']?\s*[:=]\s*["']?)(Bearer\s+)?[^\s"'&,}]+"#,
            // Microsoft opaque tokens (M.C5xx_ / EwB...)
            r"\bM\.[A-Za-z0-9_]{3,}\.[A-Za-z0-9_!*\-$]{20,}",
            r"\bEw[A-Za-z0-9+/=_\-]{60,}",
            // --accessToken <value>
            r"(--accessToken\s+)\S+",
        ]
        .iter()
        .map(|p| regex::Regex::new(p).expect("valid regex"))
        .collect()
    })
}

pub fn redact(input: &str) -> String {
    let p = patterns();
    let mut s = p[0].replace_all(input, "<redacted-jwt>").into_owned();
    s = p[1].replace_all(&s, "$1$2<redacted>").into_owned();
    s = p[2].replace_all(&s, "<redacted-token>").into_owned();
    s = p[3].replace_all(&s, "<redacted-token>").into_owned();
    s = p[4].replace_all(&s, "$1<redacted>").into_owned();
    s
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn redacts_known_shapes() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop";
        assert!(!redact(&format!("token {jwt}")).contains("eyJhbGci"));
        let r = redact("refresh_token=M.C507_BAY.0.U.-abcdefghijklmnopqrstuvwxyz123 rest");
        assert!(!r.contains("abcdefghijklmnop"), "{r}");
        assert!(redact("--accessToken secret123 --version 1.21").contains("--accessToken <redacted>"));
        assert!(!redact(r#"{"access_token":"abc.def"}"#).contains("abc.def"));
        assert_eq!(redact("plain message 1.21.1"), "plain message 1.21.1");
    }
}
