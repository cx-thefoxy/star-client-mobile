use serde::{Serialize, Serializer};

/// Every failure that can cross the IPC boundary. Messages must never contain secrets.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("network error: {0}")]
    Network(String),
    #[error("temporary network error: {0}")]
    NetworkTransient(String),
    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid data: {0}")]
    InvalidData(String),
    #[error("integrity check failed for {path}: {reason}")]
    Integrity { path: String, reason: String },
    #[error("not found: {0}")]
    NotFound(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("authentication error: {0}")]
    Auth(String),
    #[error("Microsoft sign-in is not configured")]
    AuthNotConfigured,
    #[error("account must sign in again")]
    AuthExpired,
    #[error("java error: {0}")]
    Java(String),
    #[error("operation cancelled")]
    Cancelled,
    #[error("already running: {0}")]
    AlreadyRunning(String),
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("not enough disk space: {0}")]
    DiskSpace(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Network(_) => "network",
            AppError::NetworkTransient(_) => "network_transient",
            AppError::Io(_) => "io",
            AppError::InvalidData(_) => "invalid_data",
            AppError::Integrity { .. } => "integrity",
            AppError::NotFound(_) => "not_found",
            AppError::Unsupported(_) => "unsupported",
            AppError::Auth(_) => "auth",
            AppError::AuthNotConfigured => "auth_not_configured",
            AppError::AuthExpired => "auth_expired",
            AppError::Java(_) => "java",
            AppError::Cancelled => "cancelled",
            AppError::AlreadyRunning(_) => "already_running",
            AppError::Validation(_) => "validation",
            AppError::DiskSpace(_) => "disk_space",
        }
    }

    /// Transient failures are retried by the downloader.
    pub fn is_transient(&self) -> bool {
        matches!(self, AppError::NetworkTransient(_) | AppError::Integrity { .. })
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        // Strip URLs: they can contain query parameters we never want in logs.
        let transient = e.is_timeout() || e.is_connect() || e.is_request() || e.is_body();
        let msg = crate::auth::redact::redact(&e.without_url().to_string());
        if transient {
            AppError::NetworkTransient(msg)
        } else {
            AppError::Network(msg)
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::InvalidData(e.to_string())
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(e: zip::result::ZipError) -> Self {
        AppError::InvalidData(format!("archive: {e}"))
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &crate::auth::redact::redact(&self.to_string()))?;
        st.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
