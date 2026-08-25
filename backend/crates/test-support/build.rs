//! Re-embed the SQLx migration list whenever a migration file is added or
//! changed: `sqlx::migrate!` embeds at compile time, but cargo does not
//! otherwise watch the migrations directory.
fn main() {
    println!("cargo:rerun-if-changed=../../migrations");
}
