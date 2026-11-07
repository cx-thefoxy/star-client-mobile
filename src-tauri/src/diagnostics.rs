//! Shareable diagnostic report. No tokens, no account emails, home directory anonymized.
use crate::auth::redact::redact;
use crate::paths::anonymize;
use crate::state::AppState;

pub async fn report(st: &AppState) -> String {
    let mut r = String::new();
    let s = st.settings.lock().await.clone();
    r += &format!("Star Client {}\n", env!("CARGO_PKG_VERSION"));
    r += &format!("OS: {} {} ({})\n", sysinfo::System::name().unwrap_or_default(), sysinfo::System::os_version().unwrap_or_default(), std::env::consts::ARCH);
    r += &format!("RAM: {} MB\n", st.total_ram_mb.unwrap_or(0));
    r += &format!("Data dir: {}\n", anonymize(&st.paths.root));
    r += &format!("Game dir: {}\n", anonymize(&st.dirs().await.root));
    r += &format!("Memory: {}-{} MB, auto Java: {}\n", s.java.min_memory_mb, s.java.max_memory_mb, s.java.auto);
    r += &format!("Downloads: concurrency {}, retries {}\n", s.downloads.concurrency, s.downloads.retries);
    let (_, auth) = crate::auth::config::load(&st.paths.root);
    r += &format!("Microsoft auth configured: {}\n", auth.configured);
    r += &format!("Accounts: {}\n", st.accounts.lock().await.list().0.len());
    r += "\nJava runtimes:\n";
    for j in crate::minecraft::java::detect(&st.paths.runtimes).await {
        r += &format!("  - {} (major {}, {}, managed {}) {}\n", j.version, j.major, j.arch, j.managed, anonymize(std::path::Path::new(&j.path)));
    }
    r += "\nInstances:\n";
    for i in st.instances.lock().await.list() {
        r += &format!("  - {:?} {} loader {:?} {:?} star {}\n", i.name, i.version_id, i.loader, i.loader_version, i.star_mod_enabled);
    }
    r += "\nRecent launcher log:\n";
    if let Some(tail) = latest_log_tail(&st.paths.logs, 12) { r += &truncate_lines(&tail, 400); }
    r += "\n\nLast game log (start of the newest launch-*.log, then its end):\n";
    match latest_game_log(&st.paths.logs.join("game")) {
        Some(g) => r += &g,
        None => r += "(no game log yet)\n",
    }
    redact(&r)
}

fn latest_log_tail(dir: &std::path::Path, lines: usize) -> Option<String> {
    let newest = std::fs::read_dir(dir).ok()?.flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("launcher"))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())?;
    let text = std::fs::read_to_string(newest.path()).ok()?;
    let v: Vec<&str> = text.lines().collect();
    Some(v[v.len().saturating_sub(lines)..].join("\n"))
}

/// Long single lines (the launch command with its classpath) are cut so the real messages stay readable.
fn truncate_lines(t: &str, max: usize) -> String {
    t.lines().map(|l| if l.len() > max { format!("{}... [{} chars]", &l[..l.char_indices().nth(max).map_or(l.len(), |(i, _)| i)], l.len()) } else { l.to_string() })
        .collect::<Vec<_>>().join("\n")
}

/// Whole newest game log: first 120 lines (the [star] steps) and last 220 lines (crash head / exit reason), long lines cut.
fn latest_game_log(dir: &std::path::Path) -> Option<String> {
    let newest = std::fs::read_dir(dir).ok()?.flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("launch-"))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())?;
    let text = String::from_utf8_lossy(&std::fs::read(newest.path()).ok()?).into_owned();
    let v: Vec<String> = truncate_lines(&text, 300).lines().map(String::from).collect();
    if v.len() <= 340 { return Some(v.join("\n")); }
    Some(format!("{}\n... [{} lines skipped] ...\n{}", v[..120].join("\n"), v.len() - 340, v[v.len() - 220..].join("\n")))
}
