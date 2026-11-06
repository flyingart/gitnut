//! GitNut desktop shell (R-UPD-5).
//!
//! On start: make sure `<GITNUT_HOME or ~/.gitnut>/bin/gitnut` exists and is at least as new as
//! the bundled sidecar, start `gitnut serve` when no daemon runs, then point the main window at
//! `<daemon url>/?token=<token>`. The daemon's web client updates that copy in place
//! (`update.apply`). The app itself updates with Tauri's updater (signed by our key, from
//! https://gitnut.dev/desktop/latest.json): it asks, installs, stops the daemon it started and
//! relaunches, and the new app's bundled daemon then replaces the old one.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

const EXE: &str = std::env::consts::EXE_SUFFIX;
const START_TIMEOUT: Duration = Duration::from_secs(30);
const UPDATE_FIRST_CHECK: Duration = Duration::from_secs(15);
const UPDATE_EVERY: Duration = Duration::from_secs(10 * 60);

/// Set when this app spawned `gitnut serve`, so quitting stops it again.
static STARTED_DAEMON: AtomicBool = AtomicBool::new(false);
/// Version the user answered "Later" for: not asked again until the app restarts.
static POSTPONED: Mutex<Option<String>> = Mutex::new(None);
/// Last startup error, re-shown if the loading page (re)loads after it was reported.
static LAST_ERROR: Mutex<Option<(String, String)>> = Mutex::new(None);

#[derive(serde::Deserialize, Default)]
struct Status {
    #[serde(default)]
    running: bool,
    #[serde(default)]
    url: Option<String>,
}

fn gitnut_home() -> PathBuf {
    if let Some(h) = std::env::var_os("GITNUT_HOME").filter(|h| !h.is_empty()) {
        return PathBuf::from(h);
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .unwrap_or_else(|| ".".into());
    PathBuf::from(home).join(".gitnut")
}

/// `gitnut` next to the app executable (Tauri strips the target triple from `externalBin`).
fn bundled_binary() -> Option<PathBuf> {
    let p = std::env::current_exe().ok()?.parent()?.join(format!("gitnut{EXE}"));
    p.exists().then_some(p)
}

fn command(bin: &Path) -> Command {
    let mut c = Command::new(bin);
    c.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    // ponytail: AppImage's runtime env (bundled GTK libs) would leak into git subprocesses;
    // drop the usual suspects. Extend the list if a distro still breaks.
    if std::env::var_os("APPIMAGE").is_some() {
        for k in ["LD_LIBRARY_PATH", "LD_PRELOAD", "GIO_EXTRA_MODULES", "GDK_PIXBUF_MODULE_FILE", "GTK_PATH", "GTK_EXE_PREFIX", "GTK_DATA_PREFIX", "GST_PLUGIN_SYSTEM_PATH", "GST_PLUGIN_SYSTEM_PATH_1_0"] {
            c.env_remove(k);
        }
    }
    c
}

fn exec(bin: &Path, args: &[&str]) -> Result<String, String> {
    let out = command(bin)
        .args(args)
        .output()
        .map_err(|e| format!("{} {}: {e}", bin.display(), args.join(" ")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(format!(
            "`gitnut {}` failed ({}): {}{}",
            args.join(" "),
            out.status,
            String::from_utf8_lossy(&out.stderr).trim(),
            String::from_utf8_lossy(&out.stdout).trim()
        ))
    }
}

/// First dotted number in `gitnut version` output, e.g. "gitnut 1.2.3" → [1, 2, 3].
fn parse_version(s: &str) -> Option<(Vec<u64>, bool)> {
    let tok = s.split_whitespace().map(|t| t.trim_start_matches('v')).find(|t| t.starts_with(|c: char| c.is_ascii_digit()))?;
    let (core, pre) = match tok.split_once('-') {
        Some((c, _)) => (c, true),
        None => (tok, false),
    };
    Some((core.split('.').map(|n| n.parse().unwrap_or(0)).collect(), pre))
}

/// True when `a` is newer than `b`. Pre-releases sort before the release.
fn newer(a: &str, b: &str) -> bool {
    match (parse_version(a), parse_version(b)) {
        (Some((x, xp)), Some((y, yp))) => {
            let n = x.len().max(y.len());
            for i in 0..n {
                let (p, q) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
                if p != q {
                    return p > q;
                }
            }
            !xp && yp
        }
        (Some(_), None) => true,
        _ => false,
    }
}

/// Copy the bundled daemon to `~/.gitnut/bin/gitnut` when missing or older. Returns the path to use.
fn ensure_binary() -> Result<PathBuf, String> {
    let target = gitnut_home().join("bin").join(format!("gitnut{EXE}"));
    let Some(bundled) = bundled_binary() else {
        return if target.exists() { Ok(target) } else { Err(format!("no bundled gitnut binary and none at {}", target.display())) };
    };
    if target.exists() {
        let have = exec(&target, &["version"]).unwrap_or_default();
        let ship = exec(&bundled, &["version"]).unwrap_or_default();
        if !newer(&ship, &have) {
            return Ok(target);
        }
        eprintln!("gitnut-desktop: updating {} ({have:?} -> {ship:?})", target.display());
    }
    let dir = target.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let tmp = dir.join(format!("gitnut.new{EXE}"));
    std::fs::copy(&bundled, &tmp).map_err(|e| format!("copy {} -> {}: {e}", bundled.display(), tmp.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755));
    }
    #[cfg(target_os = "macos")]
    let _ = Command::new("xattr").args(["-d", "com.apple.quarantine"]).arg(&tmp).output();
    // Windows can rename a running exe but not overwrite it.
    let old = dir.join(format!("gitnut.old{EXE}"));
    if target.exists() {
        let _ = std::fs::rename(&target, &old);
    }
    std::fs::rename(&tmp, &target).map_err(|e| format!("install {}: {e}", target.display()))?;
    let _ = std::fs::remove_file(&old);
    Ok(target)
}

fn status(bin: &Path) -> Status {
    command(bin)
        .args(["status", "--json"])
        .output()
        .ok()
        .and_then(|o| serde_json::from_slice(&o.stdout).ok())
        .unwrap_or_default()
}

fn log_tail(path: &Path) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(20)..].join("\n")
}

/// Ensure a daemon runs and return the login URL for the web client.
fn start(window: &WebviewWindow) -> Result<Url, (String, String)> {
    let fail = |m: &str, d: String| (m.to_string(), d);
    show_status(window, "Checking the gitnut daemon…");
    let bin = ensure_binary().map_err(|e| fail("The gitnut binary is missing.", e))?;

    let mut st = status(&bin);
    if !st.running {
        show_status(window, "Starting the gitnut daemon…");
        let log_path = gitnut_home().join("desktop-daemon.log");
        let log = std::fs::OpenOptions::new().create(true).append(true).open(&log_path).map_err(|e| fail("Cannot write the daemon log.", e.to_string()))?;
        let mut child = command(&bin)
            .arg("serve")
            .stdout(log.try_clone().map_err(|e| fail("Cannot write the daemon log.", e.to_string()))?)
            .stderr(log)
            .spawn()
            .map_err(|e| fail("Could not run `gitnut serve`.", e.to_string()))?;
        STARTED_DAEMON.store(true, Ordering::SeqCst);
        let deadline = Instant::now() + START_TIMEOUT;
        loop {
            std::thread::sleep(Duration::from_millis(300));
            st = status(&bin);
            if st.running {
                break;
            }
            if let Ok(Some(code)) = child.try_wait() {
                STARTED_DAEMON.store(false, Ordering::SeqCst);
                return Err(fail(&format!("`gitnut serve` exited ({code})."), format!("{}\n\nLog: {}", log_tail(&log_path), log_path.display())));
            }
            if Instant::now() > deadline {
                return Err(fail("The gitnut daemon did not start within 30 seconds.", format!("{}\n\nLog: {}", log_tail(&log_path), log_path.display())));
            }
        }
        // Reap the child when it exits so it does not linger as a zombie.
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }

    let url = st.url.ok_or_else(|| fail("`gitnut status --json` returned no url.", String::new()))?;
    let token = exec(&bin, &["token"]).map_err(|e| fail("Could not read the access token.", e))?;
    let mut url = Url::parse(&url).map_err(|e| fail("The daemon reported an invalid url.", format!("{url}: {e}")))?;
    if !token.is_empty() {
        url.query_pairs_mut().append_pair("token", &token);
    }
    // the web client shows it in Settings; the bundle version (what the updater compares), not Cargo.toml
    url.query_pairs_mut().append_pair("app", &window.app_handle().package_info().version.to_string());
    Ok(url)
}

fn js_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

fn show_status(window: &WebviewWindow, text: &str) {
    let _ = window.eval(format!("window.gitnutStatus && gitnutStatus({})", js_str(text)));
}

fn show_error(window: &WebviewWindow) {
    if let Some((msg, detail)) = LAST_ERROR.lock().unwrap().clone() {
        let _ = window.eval(format!("window.gitnutError && gitnutError({}, {})", js_str(&msg), js_str(&detail)));
    }
}

fn stop_daemon() {
    if STARTED_DAEMON.swap(false, Ordering::SeqCst) {
        let bin = gitnut_home().join("bin").join(format!("gitnut{EXE}"));
        let _ = exec(&bin, &["stop"]);
    }
}

/// Check for a new app version; on "Install and restart" install it and relaunch.
async fn check_update(app: &AppHandle) -> Result<(), String> {
    let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };
    if POSTPONED.lock().unwrap().as_deref() == Some(update.version.as_str()) {
        return Ok(());
    }
    let notes = update.body.clone().unwrap_or_default();
    let msg = format!(
        "GitNut {} is available (you have {}).\n\n{}\n\nInstall it now? GitNut restarts afterwards.",
        update.version,
        update.current_version,
        notes.lines().filter(|l| !l.trim().is_empty() && !l.starts_with('#')).take(6).collect::<Vec<_>>().join("\n")
    );
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .message(msg)
        .title("Update available")
        .buttons(MessageDialogButtons::OkCancelCustom("Install and restart".into(), "Later".into()))
        .show(move |ok| {
            let _ = tx.send(ok);
        });
    if !tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(false)).await.unwrap_or(false) {
        *POSTPONED.lock().unwrap() = Some(update.version.clone());
        return Ok(());
    }
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    // The new app ships a newer daemon: stop ours so the relaunched app installs and starts it.
    stop_daemon();
    app.restart();
}

fn spawn_update_checks(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio_sleep(UPDATE_FIRST_CHECK).await;
        loop {
            if let Err(e) = check_update(&app).await {
                eprintln!("gitnut-desktop: update check failed: {e}");
            }
            tokio_sleep(UPDATE_EVERY).await;
        }
    });
}

async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(|webview, payload| {
            // The local loading page is served from tauri:// (or http://tauri.localhost on Windows).
            let local = payload.url().host_str().map_or(true, |h| h == "localhost" || h == "tauri.localhost");
            if payload.event() == PageLoadEvent::Finished && local {
                if let Some(w) = webview.app_handle().get_webview_window(webview.label()) {
                    show_error(&w);
                }
            }
        })
        .setup(|app| {
            spawn_update_checks(app.handle().clone());
            let window = app.get_webview_window("main").expect("main window");
            std::thread::spawn(move || match start(&window) {
                Ok(url) => {
                    if let Err(e) = window.navigate(url) {
                        *LAST_ERROR.lock().unwrap() = Some(("Could not open the web client.".into(), e.to_string()));
                        show_error(&window);
                    }
                }
                Err(err) => {
                    eprintln!("gitnut-desktop: {}: {}", err.0, err.1);
                    *LAST_ERROR.lock().unwrap() = Some(err);
                    show_error(&window);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the GitNut app")
        .run(|_, event| {
            if let RunEvent::Exit = event {
                stop_daemon();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::newer;

    #[test]
    fn version_order() {
        assert!(newer("gitnut 0.2.0", "gitnut 0.1.9"));
        assert!(newer("0.1.10", "0.1.9"));
        assert!(!newer("0.1.0", "0.1.0"));
        assert!(newer("0.1.0", "0.1.0-beta.1"));
        assert!(!newer("0.1.0-beta.1", "0.1.0"));
        assert!(newer("1.0.0", "garbage"));
        assert!(!newer("garbage", "1.0.0"));
    }
}
