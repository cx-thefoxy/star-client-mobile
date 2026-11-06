//! Mojang library/argument rule evaluation.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Rule {
    pub action: RuleAction,
    #[serde(default)]
    pub os: Option<OsRule>,
    #[serde(default)]
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RuleAction { Allow, Disallow }

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct OsRule {
    pub name: Option<String>,
    pub arch: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Environment {
    pub os_name: String,
    pub os_arch: String,
    pub os_version: String,
    pub features: HashMap<String, bool>,
}

impl Environment {
    pub fn current(features: HashMap<String, bool>) -> Self {
        let os_name = match std::env::consts::OS {
            "windows" => "windows",
            "macos" => "osx",
            _ => "linux", // android reports OS "android"; Mojang rules call it linux
        };
        let os_arch = match std::env::consts::ARCH {
            "x86" => "x86",
            "aarch64" => "arm64",
            other => other,
        };
        Self {
            os_name: os_name.into(),
            os_arch: os_arch.into(),
            os_version: sysinfo::System::os_version().unwrap_or_default(),
            features,
        }
    }

    pub fn is_64bit(&self) -> bool { self.os_arch != "x86" }
}

pub fn rules_allow(rules: Option<&[Rule]>, env: &Environment) -> bool {
    let Some(rules) = rules else { return true };
    if rules.is_empty() { return true; }
    let mut allowed = false;
    for r in rules {
        if rule_matches(r, env) {
            allowed = r.action == RuleAction::Allow;
        }
    }
    allowed
}

fn rule_matches(r: &Rule, env: &Environment) -> bool {
    if let Some(os) = &r.os {
        if let Some(n) = &os.name { if n != &env.os_name { return false; } }
        if let Some(a) = &os.arch { if a != &env.os_arch { return false; } }
        if let Some(v) = &os.version {
            match regex::Regex::new(v) {
                Ok(re) => if !re.is_match(&env.os_version) { return false; },
                Err(_) => return false,
            }
        }
    }
    if let Some(f) = &r.features {
        for (k, want) in f {
            if env.features.get(k).copied().unwrap_or(false) != *want { return false; }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(os: &str, arch: &str) -> Environment {
        Environment { os_name: os.into(), os_arch: arch.into(), os_version: "10.0".into(), features: HashMap::new() }
    }
    fn rules(v: serde_json::Value) -> Vec<Rule> { serde_json::from_value(v).unwrap() }

    #[test]
    fn no_rules_allows() { assert!(rules_allow(None, &env("windows", "x86_64"))); }

    #[test]
    fn os_specific_allow() {
        let r = rules(serde_json::json!([{ "action": "allow", "os": { "name": "osx" } }]));
        assert!(!rules_allow(Some(&r), &env("windows", "x86_64")));
        assert!(rules_allow(Some(&r), &env("osx", "arm64")));
    }

    #[test]
    fn allow_then_disallow() {
        let r = rules(serde_json::json!([
            { "action": "allow" },
            { "action": "disallow", "os": { "name": "osx" } }
        ]));
        assert!(rules_allow(Some(&r), &env("windows", "x86_64")));
        assert!(!rules_allow(Some(&r), &env("osx", "x86_64")));
    }

    #[test]
    fn arch_and_version_regex() {
        let r = rules(serde_json::json!([{ "action": "allow", "os": { "name": "windows", "arch": "x86" } }]));
        assert!(!rules_allow(Some(&r), &env("windows", "x86_64")));
        let r = rules(serde_json::json!([{ "action": "allow", "os": { "name": "windows", "version": "^10\\." } }]));
        assert!(rules_allow(Some(&r), &env("windows", "x86_64")));
    }

    #[test]
    fn features() {
        let r = rules(serde_json::json!([{ "action": "allow", "features": { "has_custom_resolution": true } }]));
        let mut e = env("windows", "x86_64");
        assert!(!rules_allow(Some(&r), &e));
        e.features.insert("has_custom_resolution".into(), true);
        assert!(rules_allow(Some(&r), &e));
    }
}
