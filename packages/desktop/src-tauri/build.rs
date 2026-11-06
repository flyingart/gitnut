fn main() {
    // The web client of the app's own daemon is remote content to Tauri: it may only call app
    // commands that are declared here and granted by a capability (added at runtime in lib.rs).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["desktop_version", "desktop_update_check", "desktop_update_install"]),
    ))
    .expect("tauri build script failed");
}
