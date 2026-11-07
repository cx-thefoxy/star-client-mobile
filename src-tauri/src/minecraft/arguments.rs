//! Builds the exact argv for the Java process. Values are passed as discrete arguments
//! to `Command::args`, never through a shell.
use super::rules::{rules_allow, Environment};
use super::version_json::{Argument, VersionJson};
use crate::error::{AppError, AppResult};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct LaunchContext {
    pub player_name: String,
    pub uuid: String,
    pub access_token: String,
    pub xuid: String,
    pub user_type: String,
    pub version_name: String,
    pub version_type: String,
    pub game_dir: String,
    pub assets_root: String,
    pub assets_index_name: String,
    pub game_assets: String,
    pub natives_dir: String,
    pub library_dir: String,
    pub classpath: Vec<String>,
    pub resolution: Option<(u32, u32)>,
    pub fullscreen: bool,
    pub min_memory_mb: u32,
    pub max_memory_mb: u32,
    pub extra_jvm_args: Vec<String>,
    pub logging_config_path: Option<String>,
    pub launcher_version: String,
}

pub fn classpath_separator(env: &Environment) -> &'static str {
    if env.os_name == "windows" { ";" } else { ":" }
}

pub fn substitute(s: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find('}') {
            Some(end) => {
                let key = &after[..end];
                match vars.get(key) {
                    Some(v) => out.push_str(v),
                    None => { out.push_str("${"); out.push_str(key); out.push('}'); }
                }
                rest = &after[end + 1..];
            }
            None => { out.push_str(&rest[start..]); rest = ""; }
        }
    }
    out.push_str(rest);
    out
}

fn vars<'a>(ctx: &'a LaunchContext, env: &Environment) -> HashMap<&'static str, String> {
    let sep = classpath_separator(env);
    let (w, h) = ctx.resolution.unwrap_or((854, 480));
    HashMap::from([
        ("auth_player_name", ctx.player_name.clone()),
        ("version_name", ctx.version_name.clone()),
        ("game_directory", ctx.game_dir.clone()),
        ("assets_root", ctx.assets_root.clone()),
        ("game_assets", ctx.game_assets.clone()),
        ("assets_index_name", ctx.assets_index_name.clone()),
        ("auth_uuid", ctx.uuid.clone()),
        ("auth_access_token", ctx.access_token.clone()),
        ("auth_session", format!("token:{}:{}", ctx.access_token, ctx.uuid)),
        ("auth_xuid", ctx.xuid.clone()),
        ("clientid", String::new()),
        ("user_type", ctx.user_type.clone()),
        ("user_properties", "{}".to_string()),
        ("version_type", ctx.version_type.clone()),
        ("natives_directory", ctx.natives_dir.clone()),
        ("library_directory", ctx.library_dir.clone()),
        ("classpath_separator", sep.to_string()),
        ("classpath", ctx.classpath.join(sep)),
        ("launcher_name", "star-client".to_string()),
        ("launcher_version", ctx.launcher_version.clone()),
        ("resolution_width", w.to_string()),
        ("resolution_height", h.to_string()),
    ])
}

fn expand(args: &[Argument], env: &Environment, v: &HashMap<&str, String>, out: &mut Vec<String>) {
    for a in args {
        match a {
            Argument::Plain(s) => out.push(substitute(s, v)),
            Argument::Conditional { rules, value } => {
                if rules_allow(Some(rules), env) {
                    out.extend(value.values().into_iter().map(|s| substitute(s, v)));
                }
            }
        }
    }
}

/// Validate user-supplied JVM flags: each must be a single dash-prefixed token.
pub fn validate_extra_jvm_args(args: &[String]) -> AppResult<()> {
    for a in args {
        if !a.starts_with('-') || a.contains('\n') || a.contains('\0') || a.len() > 1024 {
            return Err(AppError::Validation(format!("invalid JVM argument: {a:?}")));
        }
        let lower = a.to_ascii_lowercase();
        if lower.starts_with("-xmx") || lower.starts_with("-xms") {
            return Err(AppError::Validation("set memory with the memory slider, not -Xmx/-Xms".into()));
        }
    }
    Ok(())
}

/// Returns the full argv after the java executable.
pub fn build(version: &VersionJson, ctx: &LaunchContext, env: &Environment) -> AppResult<Vec<String>> {
    validate_extra_jvm_args(&ctx.extra_jvm_args)?;
    let main_class = version.main_class.clone()
        .ok_or_else(|| AppError::InvalidData(format!("{} has no mainClass", version.id)))?;
    let v = vars(ctx, env);
    let mut out = vec![format!("-Xms{}M", ctx.min_memory_mb), format!("-Xmx{}M", ctx.max_memory_mb)];

    match &version.arguments {
        Some(args) if !args.jvm.is_empty() => expand(&args.jvm, env, &v, &mut out),
        _ => {
            if env.os_name == "windows" {
                out.push("-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump".into());
            }
            if env.os_name == "osx" { out.push("-XstartOnFirstThread".into()); }
            out.push(substitute("-Djava.library.path=${natives_directory}", &v));
            out.push("-Dminecraft.launcher.brand=star-client".into());
            out.push(substitute("-Dminecraft.launcher.version=${launcher_version}", &v));
            out.push("-cp".into());
            out.push(substitute("${classpath}", &v));
        }
    }
    out.extend(ctx.extra_jvm_args.iter().cloned());
    if let (Some(log), Some(path)) = (version.logging.as_ref().and_then(|l| l.client.as_ref()), &ctx.logging_config_path) {
        let mut lv = HashMap::new();
        lv.insert("path", path.clone());
        out.push(substitute(&log.argument, &lv));
    }
    out.push(main_class);

    let game_start = out.len();
    if let Some(args) = &version.arguments {
        expand(&args.game, env, &v, &mut out);
    }
    if let Some(legacy) = &version.minecraft_arguments {
        for tok in legacy.split_whitespace() { out.push(substitute(tok, &v)); }
        if let Some((w, h)) = ctx.resolution {
            if !out[game_start..].iter().any(|a| a == "--width") {
                out.extend(["--width".into(), w.to_string(), "--height".into(), h.to_string()]);
            }
        }
    }
    if ctx.fullscreen && !out[game_start..].iter().any(|a| a == "--fullscreen") {
        out.push("--fullscreen".into());
    }
    Ok(out)
}

/// Copy of argv safe for logs.
pub fn redacted(args: &[String], token: &str) -> Vec<String> {
    args.iter().map(|a| if !token.is_empty() && a.contains(token) { a.replace(token, "<redacted>") } else { a.clone() }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::minecraft::rules::Environment;

    fn ctx() -> LaunchContext {
        LaunchContext {
            player_name: "Steve".into(), uuid: "0123456789abcdef0123456789abcdef".into(),
            access_token: "SECRET_TOKEN".into(), xuid: "".into(), user_type: "msa".into(),
            version_name: "1.21.1".into(), version_type: "release".into(),
            game_dir: "C:/g".into(), assets_root: "C:/a".into(), assets_index_name: "17".into(),
            game_assets: "C:/a/virtual/legacy".into(), natives_dir: "C:/n".into(), library_dir: "C:/l".into(),
            classpath: vec!["a.jar".into(), "b.jar".into()], resolution: None, fullscreen: false,
            min_memory_mb: 512, max_memory_mb: 2048, extra_jvm_args: vec![], logging_config_path: Some("C:/log.xml".into()),
            launcher_version: "0.1.0".into(),
        }
    }
    fn env(features: &[(&str, bool)]) -> Environment {
        Environment { os_name: "windows".into(), os_arch: "x86_64".into(), os_version: "10.0".into(),
            features: features.iter().map(|(k, v)| (k.to_string(), *v)).collect() }
    }

    #[test]
    fn modern_arguments() {
        let v: VersionJson = serde_json::from_str(include_str!("../../../tests/fixtures/1.21.1.json")).unwrap();
        let a = build(&v, &ctx(), &env(&[])).unwrap();
        assert_eq!(&a[0..2], &["-Xms512M".to_string(), "-Xmx2048M".to_string()]);
        let cp = a.iter().position(|s| s == "-cp").unwrap();
        assert_eq!(a[cp + 1], "a.jar;b.jar");
        assert!(a.contains(&"-Djava.library.path=C:/n".to_string()));
        assert!(a.contains(&"-Dlog4j.configurationFile=C:/log.xml".to_string()));
        assert!(a.contains(&"net.minecraft.client.main.Main".to_string()));
        let t = a.iter().position(|s| s == "--accessToken").unwrap();
        assert_eq!(a[t + 1], "SECRET_TOKEN");
        assert!(!a.contains(&"--demo".to_string()));
        assert!(!a.contains(&"--width".to_string()));
        assert!(!a.iter().any(|s| s.contains("${auth")), "unresolved placeholder: {a:?}");
        // osx-only flag must not leak onto windows
        assert!(!a.contains(&"-XstartOnFirstThread".to_string()));
    }

    #[test]
    fn modern_custom_resolution_feature() {
        let v: VersionJson = serde_json::from_str(include_str!("../../../tests/fixtures/1.21.1.json")).unwrap();
        let mut c = ctx();
        c.resolution = Some((1280, 720));
        let a = build(&v, &c, &env(&[("has_custom_resolution", true)])).unwrap();
        let w = a.iter().position(|s| s == "--width").unwrap();
        assert_eq!(a[w + 1], "1280");
    }

    #[test]
    fn legacy_arguments() {
        let v: VersionJson = serde_json::from_str(include_str!("../../../tests/fixtures/1.8.9.json")).unwrap();
        let mut c = ctx();
        c.resolution = Some((1024, 768));
        c.fullscreen = true;
        let a = build(&v, &c, &env(&[])).unwrap();
        assert!(a.contains(&"-Djava.library.path=C:/n".to_string()));
        let main = a.iter().position(|s| s == "net.minecraft.client.main.Main").unwrap();
        let game = &a[main + 1..];
        assert!(game.windows(2).any(|w| w == ["--username", "Steve"]));
        assert!(game.windows(2).any(|w| w == ["--assetIndex", "17"]));
        assert!(game.windows(2).any(|w| w == ["--width", "1024"]));
        assert!(game.contains(&"--fullscreen".to_string()));
        assert!(game.windows(2).any(|w| w == ["--userProperties", "{}"]));
    }

    #[test]
    fn rejects_bad_extra_args() {
        assert!(validate_extra_jvm_args(&["-XX:+UseG1GC".into()]).is_ok());
        assert!(validate_extra_jvm_args(&["calc.exe".into()]).is_err());
        assert!(validate_extra_jvm_args(&["-Xmx99G".into()]).is_err());
    }

    #[test]
    fn redacts_token() {
        let r = redacted(&["--accessToken".into(), "SECRET_TOKEN".into()], "SECRET_TOKEN");
        assert_eq!(r[1], "<redacted>");
    }

    #[test]
    fn substitute_unknown_kept() {
        let v = HashMap::from([("a", "1".to_string())]);
        assert_eq!(substitute("${a}-${b}-${", &v), "1-${b}-${");
    }
}
